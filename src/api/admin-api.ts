import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { DB } from "../db.js";
import { SecretBox, maskProxyUrl, maskSecret } from "../crypto.js";
import { checkProxy, parseProxyUrl } from "../proxy/dispatcher.js";
import { getProvider, listSupportedProviders } from "../providers/registry.js";
import type { ProviderKind } from "../providers/base.js";
import type { HealthChecker } from "../core/health.js";
import type { DispatcherCache } from "../proxy/cache.js";
import type { AppConfig } from "../config.js";
import { getSetting, setSetting } from "../db.js";

const ProxyInput = z.object({
  name: z.string().min(1).max(64),
  url: z.string().min(7),
});

const ProxyPatch = z.object({
  name: z.string().min(1).max(64).optional(),
  url: z.string().min(7).optional(),
});

const ProviderInput = z.object({
  kind: z.enum(["nvidia", "openrouter", "groq", "together", "ollama"]),
  priority: z.number().int().optional(),
  proxy_id: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  model_map: z.record(z.string(), z.string()).optional(),
  fallback_model: z.string().nullable().optional(),
});

const KeyInput = z.object({
  provider_id: z.string(),
  label: z.string().min(1).max(64),
  key: z.string().min(8),
});

const KeyPatch = z.object({
  label: z.string().min(1).max(64).optional(),
  reset: z.boolean().optional(),
});

export function registerAdminApi(
  app: FastifyInstance,
  db: DB,
  box: SecretBox,
  dispatchers: DispatcherCache,
  health: HealthChecker,
  cfg: AppConfig,
): void {
  app.get("/api/health", async () => ({ status: "ok", service: "llm-gate-admin" }));

  app.get("/api/supported-providers", async () => ({
    providers: listSupportedProviders().map((k) => {
      const p = getProvider(k);
      return { kind: k, displayName: p.displayName, defaultModels: p.defaultModels };
    }),
  }));

  app.get("/api/setup", async () => {
    const visibleHost = cfg.host === "0.0.0.0" || cfg.host === "::" ? "127.0.0.1" : cfg.host;
    return {
      endpoints: {
        proxy_base: `http://${visibleHost}:${cfg.proxyPort}`,
        openai_base: `http://${visibleHost}:${cfg.proxyPort}/v1`,
        anthropic_base: `http://${visibleHost}:${cfg.proxyPort}`,
        admin_base: `http://${visibleHost}:${cfg.uiPort}`,
      },
      auth: {
        required: !!cfg.authToken,
        token: cfg.authToken,
      },
      version: "0.2.0",
    };
  });

  app.get("/api/stats", async () => {
    const keyStats = db.prepare(
      `SELECT status, COUNT(*) AS c FROM api_keys GROUP BY status`
    ).all() as Array<{ status: string; c: number }>;
    const proxyStats = db.prepare(
      `SELECT status, COUNT(*) AS c FROM proxies GROUP BY status`
    ).all() as Array<{ status: string; c: number }>;
    const providerStats = db.prepare(
      `SELECT enabled, COUNT(*) AS c FROM providers GROUP BY enabled`
    ).all() as Array<{ enabled: number; c: number }>;
    const totalRequests = (db.prepare(`SELECT COALESCE(SUM(uses_total), 0) AS s FROM api_keys`).get() as { s: number }).s;

    const perProvider = db.prepare(
      `SELECT p.id, p.kind, COUNT(k.id) AS key_count,
              COALESCE(SUM(k.uses_total), 0) AS requests,
              COALESCE(SUM(CASE WHEN k.status = 'alive' THEN 1 ELSE 0 END), 0) AS alive_keys,
              COALESCE(SUM(CASE WHEN k.status = 'dead'  THEN 1 ELSE 0 END), 0) AS dead_keys
       FROM providers p LEFT JOIN api_keys k ON k.provider_id = p.id
       GROUP BY p.id ORDER BY p.priority`
    ).all() as Array<{ id: string; kind: ProviderKind; key_count: number; requests: number; alive_keys: number; dead_keys: number }>;

    const tally = (rows: Array<{ status?: string; enabled?: number; c: number }>, key: string) =>
      rows.find((r) => String((r as Record<string, unknown>)[key === "enabled" ? "enabled" : "status"]) === key)?.c ?? 0;

    return {
      totals: {
        requests: totalRequests,
        keys: {
          alive: tally(keyStats, "alive"),
          cooling: tally(keyStats, "cooling"),
          dead: tally(keyStats, "dead"),
          unknown: tally(keyStats, "unknown"),
          total: keyStats.reduce((a, r) => a + r.c, 0),
        },
        proxies: {
          alive: tally(proxyStats, "alive"),
          dead: tally(proxyStats, "dead"),
          unknown: tally(proxyStats, "unknown"),
          total: proxyStats.reduce((a, r) => a + r.c, 0),
        },
        providers: {
          enabled: providerStats.find((r) => r.enabled === 1)?.c ?? 0,
          disabled: providerStats.find((r) => r.enabled === 0)?.c ?? 0,
          total: providerStats.reduce((a, r) => a + r.c, 0),
        },
      },
      per_provider: perProvider.map((p) => ({
        id: p.id,
        kind: p.kind,
        displayName: getProvider(p.kind).displayName,
        keys: p.key_count,
        alive_keys: p.alive_keys,
        dead_keys: p.dead_keys,
        requests: p.requests,
      })),
    };
  });

  app.get("/api/proxies", async () => {
    const rows = db.prepare(`SELECT * FROM proxies ORDER BY created_at ASC`).all() as Array<{
      id: string; name: string; url_encrypted: string; type: string;
      status: string; last_check_at: number | null; last_exit_ip: string | null;
      last_country: string | null; last_latency_ms: number | null; last_error: string | null;
    }>;
    return {
      proxies: rows.map((r) => ({
        id: r.id, name: r.name, type: r.type, status: r.status,
        url_masked: maskProxyUrl(box.decrypt(r.url_encrypted)),
        last_check_at: r.last_check_at, last_exit_ip: r.last_exit_ip,
        last_country: r.last_country, last_latency_ms: r.last_latency_ms,
        last_error: r.last_error,
      })),
      default_proxy_id: getSetting(db, "default_proxy_id"),
    };
  });

  app.post("/api/proxies", async (req, reply) => {
    const input = ProxyInput.parse(req.body);
    const parsed = parseProxyUrl(input.url);
    const checkResult = await checkProxy(input.url);
    const id = randomUUID();
    db.prepare(
      `INSERT INTO proxies (id, name, url_encrypted, type, status, last_check_at,
                            last_exit_ip, last_country, last_latency_ms, last_error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, input.name, box.encrypt(input.url), parsed.protocol,
      checkResult.ok ? "alive" : "dead", Date.now(),
      checkResult.ip ?? null, checkResult.country ?? null,
      checkResult.latencyMs ?? null, checkResult.error ?? null, Date.now(),
    );
    reply.code(201);
    return { id, check: checkResult };
  });

  app.patch("/api/proxies/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const input = ProxyPatch.parse(req.body);
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (input.name !== undefined) { sets.push("name = ?"); vals.push(input.name); }
    if (input.url !== undefined) {
      const parsed = parseProxyUrl(input.url);
      sets.push("url_encrypted = ?", "type = ?");
      vals.push(box.encrypt(input.url), parsed.protocol);
    }
    if (sets.length === 0) return { ok: true };
    vals.push(id);
    db.prepare(`UPDATE proxies SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    dispatchers.invalidate(id);
    if (input.url !== undefined) {
      await health.checkOneProxy(id, input.url);
    }
    reply.code(200);
    return { ok: true };
  });

  app.post("/api/proxies/:id/check", async (req) => {
    const { id } = req.params as { id: string };
    const row = db.prepare(`SELECT url_encrypted FROM proxies WHERE id = ?`).get(id) as
      | { url_encrypted: string } | undefined;
    if (!row) return { error: "not found" };
    await health.checkOneProxy(id, box.decrypt(row.url_encrypted));
    return { ok: true };
  });

  app.delete("/api/proxies/:id", async (req) => {
    const { id } = req.params as { id: string };
    dispatchers.invalidate(id);
    db.prepare(`UPDATE providers SET proxy_id = NULL WHERE proxy_id = ?`).run(id);
    db.prepare(`DELETE FROM proxies WHERE id = ?`).run(id);
    return { ok: true };
  });

  app.put("/api/settings/default-proxy", async (req) => {
    const body = z.object({ proxy_id: z.string().nullable() }).parse(req.body);
    setSetting(db, "default_proxy_id", body.proxy_id);
    return { ok: true };
  });

  app.get("/api/providers", async () => {
    const rows = db.prepare(`SELECT * FROM providers ORDER BY priority ASC`).all() as Array<{
      id: string; kind: ProviderKind; enabled: number; priority: number; proxy_id: string | null;
      model_map: string | null; fallback_model: string | null;
    }>;
    return {
      providers: rows.map((r) => {
        const p = getProvider(r.kind);
        const keys = db
          .prepare(`SELECT id, label, status, last_check_at, last_error, uses_total, key_encrypted
                    FROM api_keys WHERE provider_id = ? ORDER BY created_at ASC`)
          .all(r.id) as Array<{
            id: string; label: string; status: string;
            last_check_at: number | null; last_error: string | null;
            uses_total: number; key_encrypted: string;
          }>;
        let modelMap: Record<string, string> = {};
        if (r.model_map) {
          try { modelMap = JSON.parse(r.model_map) as Record<string, string>; } catch {}
        }
        return {
          id: r.id, kind: r.kind, displayName: p.displayName,
          enabled: !!r.enabled, priority: r.priority, proxy_id: r.proxy_id,
          model_map: modelMap,
          fallback_model: r.fallback_model ?? p.defaultFallbackModel,
          default_models: p.defaultModels,
          keys: keys.map((k) => ({
            id: k.id, label: k.label, status: k.status,
            last_check_at: k.last_check_at, last_error: k.last_error,
            uses_total: k.uses_total, key_masked: maskSecret(box.decrypt(k.key_encrypted)),
          })),
        };
      }),
    };
  });

  app.post("/api/providers", async (req, reply) => {
    const input = ProviderInput.parse(req.body);
    if (!listSupportedProviders().includes(input.kind)) {
      reply.code(400);
      return { error: `provider not implemented yet: ${input.kind}` };
    }
    const impl = getProvider(input.kind);
    const id = randomUUID();
    db.prepare(
      `INSERT INTO providers (id, kind, enabled, priority, proxy_id, model_map, fallback_model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, input.kind, input.enabled === false ? 0 : 1,
      input.priority ?? 100, input.proxy_id ?? null,
      JSON.stringify(input.model_map ?? impl.defaultModelMap),
      input.fallback_model ?? impl.defaultFallbackModel,
      Date.now(),
    );
    reply.code(201);
    return { id };
  });

  app.patch("/api/providers/:id", async (req) => {
    const { id } = req.params as { id: string };
    const input = ProviderInput.partial().parse(req.body);
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (input.enabled !== undefined) { sets.push("enabled = ?"); vals.push(input.enabled ? 1 : 0); }
    if (input.priority !== undefined) { sets.push("priority = ?"); vals.push(input.priority); }
    if (input.proxy_id !== undefined) { sets.push("proxy_id = ?"); vals.push(input.proxy_id); }
    if (input.model_map !== undefined) { sets.push("model_map = ?"); vals.push(JSON.stringify(input.model_map)); }
    if (input.fallback_model !== undefined) { sets.push("fallback_model = ?"); vals.push(input.fallback_model); }
    if (sets.length === 0) return { ok: true };
    vals.push(id);
    db.prepare(`UPDATE providers SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    return { ok: true };
  });

  app.delete("/api/providers/:id", async (req) => {
    const { id } = req.params as { id: string };
    db.prepare(`DELETE FROM providers WHERE id = ?`).run(id);
    return { ok: true };
  });

  app.post("/api/keys", async (req, reply) => {
    const input = KeyInput.parse(req.body);
    const provRow = db.prepare(`SELECT id, kind, proxy_id FROM providers WHERE id = ?`).get(input.provider_id) as
      | { id: string; kind: ProviderKind; proxy_id: string | null }
      | undefined;
    if (!provRow) {
      reply.code(404);
      return { error: "provider not found" };
    }
    const provider = getProvider(provRow.kind);
    const dispatcher = provRow.proxy_id ? dispatchers.get(provRow.proxy_id) : undefined;
    const check = await provider.checkKey(input.key, dispatcher);

    const id = randomUUID();
    db.prepare(
      `INSERT INTO api_keys (id, provider_id, label, key_encrypted, status, last_check_at, last_error, uses_total, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(
      id, input.provider_id, input.label, box.encrypt(input.key),
      check.ok ? "alive" : (check.reason === "invalid" ? "dead" : "unknown"),
      Date.now(), check.ok ? null : check.message, Date.now(),
    );
    reply.code(201);
    return { id, check };
  });

  app.patch("/api/keys/:id", async (req) => {
    const { id } = req.params as { id: string };
    const input = KeyPatch.parse(req.body);
    if (input.label !== undefined) {
      db.prepare(`UPDATE api_keys SET label = ? WHERE id = ?`).run(input.label, id);
    }
    if (input.reset) {
      db.prepare(
        `UPDATE api_keys SET status='unknown', cooling_until=NULL, last_error=NULL,
         uses_total=0 WHERE id = ?`
      ).run(id);
    }
    return { ok: true };
  });

  app.delete("/api/keys/:id", async (req) => {
    const { id } = req.params as { id: string };
    db.prepare(`DELETE FROM api_keys WHERE id = ?`).run(id);
    return { ok: true };
  });

  app.post("/api/keys/:id/check", async () => {
    await health.checkAllKeys();
    return { ok: true };
  });

  app.post("/api/healthcheck/run", async () => {
    await health.runCycle();
    return { ok: true };
  });
}
