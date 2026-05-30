import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { DB } from "../db.js";
import { SecretBox, maskProxyUrl, maskSecret } from "../crypto.js";
import { checkProxy, parseProxyUrl } from "../proxy/dispatcher.js";
import { getProvider, listSupportedProviders } from "../providers/registry.js";
import type { ProviderKind } from "../providers/base.js";
import type { Router } from "../core/router.js";
import type { HealthChecker } from "../core/health.js";
import { getSetting, setSetting } from "../db.js";

const ProxyInput = z.object({
  name: z.string().min(1).max(64),
  url: z.string().min(7),
});

const ProviderInput = z.object({
  kind: z.enum(["nvidia", "openrouter", "groq", "together", "ollama"]),
  priority: z.number().int().optional(),
  proxy_id: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

const KeyInput = z.object({
  provider_id: z.string(),
  label: z.string().min(1).max(64),
  key: z.string().min(8),
});

export function registerAdminApi(
  app: FastifyInstance,
  db: DB,
  box: SecretBox,
  router: Router,
  health: HealthChecker,
): void {
  app.get("/api/health", async () => ({ status: "ok", service: "llm-gate-admin" }));

  app.get("/api/supported-providers", async () => ({
    providers: listSupportedProviders().map((k) => {
      const p = getProvider(k);
      return { kind: k, displayName: p.displayName, defaultModels: p.defaultModels };
    }),
  }));

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

  app.post("/api/proxies/:id/check", async (req) => {
    const { id } = req.params as { id: string };
    const row = db.prepare(`SELECT url_encrypted FROM proxies WHERE id = ?`).get(id) as
      | { url_encrypted: string } | undefined;
    if (!row) return { error: "not found" };
    await health.checkOneProxy(id, box.decrypt(row.url_encrypted));
    router.invalidateProxy(id);
    return { ok: true };
  });

  app.delete("/api/proxies/:id", async (req) => {
    const { id } = req.params as { id: string };
    router.invalidateProxy(id);
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
        return {
          id: r.id, kind: r.kind, displayName: p.displayName,
          enabled: !!r.enabled, priority: r.priority, proxy_id: r.proxy_id,
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
    const id = randomUUID();
    db.prepare(
      `INSERT INTO providers (id, kind, enabled, priority, proxy_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      id, input.kind, input.enabled === false ? 0 : 1,
      input.priority ?? 100, input.proxy_id ?? null, Date.now(),
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
    const proxyUrl = provRow.proxy_id ? getProxyUrlById(db, box, provRow.proxy_id) : null;
    const { createDispatcher } = await import("../proxy/dispatcher.js");
    const dispatcher = createDispatcher(proxyUrl);
    const check = await provider.checkKey(input.key, dispatcher);
    dispatcher?.close().catch(() => {});

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

  app.delete("/api/keys/:id", async (req) => {
    const { id } = req.params as { id: string };
    db.prepare(`DELETE FROM api_keys WHERE id = ?`).run(id);
    return { ok: true };
  });

  app.post("/api/keys/:id/check", async (req) => {
    const { id } = req.params as { id: string };
    await health.checkAllKeys();
    return { ok: true, id };
  });

  app.post("/api/healthcheck/run", async () => {
    await health.runCycle();
    return { ok: true };
  });
}

function getProxyUrlById(db: DB, box: SecretBox, id: string): string | null {
  const row = db.prepare(`SELECT url_encrypted FROM proxies WHERE id = ?`).get(id) as
    | { url_encrypted: string } | undefined;
  return row ? box.decrypt(row.url_encrypted) : null;
}
