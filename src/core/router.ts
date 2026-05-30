import type { Dispatcher } from "undici";
import type { DB } from "../db.js";
import { SecretBox } from "../crypto.js";
import { KeyPool, parseRetryAfter } from "./keypool.js";
import { getProvider } from "../providers/registry.js";
import type { ChatRequest, ProviderKind, UpstreamResponse } from "../providers/base.js";
import { createDispatcher } from "../proxy/dispatcher.js";
import { resolveModelName, type ModelMap } from "../providers/model-aliases.js";

type ProviderRow = {
  id: string;
  kind: ProviderKind;
  enabled: number;
  priority: number;
  proxy_id: string | null;
  model_map: string | null;
  fallback_model: string | null;
};

type ProxyRow = {
  id: string;
  url_encrypted: string;
};

export type RouteAttempt = {
  providerId: string;
  providerKind: ProviderKind;
  keyId: string;
  status: number | "error";
  error?: string;
};

export type RouteResult =
  | { ok: true; response: UpstreamResponse; attempts: RouteAttempt[] }
  | { ok: false; attempts: RouteAttempt[]; error: string };

export class Router {
  private dispatcherCache = new Map<string, Dispatcher>();

  constructor(private db: DB, private box: SecretBox, private pool: KeyPool) {}

  private getProxyUrl(proxyId: string | null): string | null {
    if (!proxyId) return null;
    const row = this.db.prepare(`SELECT id, url_encrypted FROM proxies WHERE id = ?`).get(proxyId) as
      | ProxyRow
      | undefined;
    if (!row) return null;
    return this.box.decrypt(row.url_encrypted);
  }

  private getDispatcher(proxyId: string | null): Dispatcher | undefined {
    if (!proxyId) return undefined;
    const cached = this.dispatcherCache.get(proxyId);
    if (cached) return cached;
    const url = this.getProxyUrl(proxyId);
    if (!url) return undefined;
    const d = createDispatcher(url);
    if (d) this.dispatcherCache.set(proxyId, d);
    return d;
  }

  invalidateProxy(proxyId: string): void {
    const d = this.dispatcherCache.get(proxyId);
    if (d) d.close().catch(() => {});
    this.dispatcherCache.delete(proxyId);
  }

  private listProviders(): ProviderRow[] {
    return this.db
      .prepare(`SELECT id, kind, enabled, priority, proxy_id, model_map, fallback_model
                FROM providers WHERE enabled = 1 ORDER BY priority ASC, created_at ASC`)
      .all() as ProviderRow[];
  }

  private resolveModel(prov: ProviderRow, requested: string): string {
    let map: ModelMap | null = null;
    if (prov.model_map) {
      try { map = JSON.parse(prov.model_map) as ModelMap; } catch {}
    }
    return resolveModelName(requested, map, prov.fallback_model);
  }

  async route(req: ChatRequest, signal?: AbortSignal): Promise<RouteResult> {
    const attempts: RouteAttempt[] = [];
    const providers = this.listProviders();
    if (providers.length === 0) {
      return { ok: false, attempts, error: "no enabled providers configured" };
    }

    for (const prov of providers) {
      const provider = getProvider(prov.kind);
      const dispatcher = this.getDispatcher(prov.proxy_id);
      const keys = this.pool.listAliveByProvider(prov.id, Date.now());
      const resolvedReq: ChatRequest = { ...req, model: this.resolveModel(prov, req.model) };

      for (const key of keys) {
        const apiKey = this.pool.decrypt(key);
        let resp: UpstreamResponse;
        try {
          resp = await provider.chatCompletion(resolvedReq, apiKey, dispatcher, signal);
        } catch (err) {
          attempts.push({
            providerId: prov.id, providerKind: prov.kind, keyId: key.id,
            status: "error", error: (err as Error).message,
          });
          continue;
        }

        if (resp.status >= 200 && resp.status < 300) {
          this.pool.markUsed(key.id);
          attempts.push({ providerId: prov.id, providerKind: prov.kind, keyId: key.id, status: resp.status });
          return { ok: true, response: resp, attempts };
        }

        attempts.push({ providerId: prov.id, providerKind: prov.kind, keyId: key.id, status: resp.status });

        if (resp.status === 429) {
          this.pool.markCooling(key.id, parseRetryAfter(resp.headers), "429 rate limit");
          await drainBody(resp.body);
          continue;
        }
        if (resp.status === 401 || resp.status === 403) {
          this.pool.markDead(key.id, `auth failed (HTTP ${resp.status})`);
          await drainBody(resp.body);
          continue;
        }
        if (resp.status >= 500) {
          await drainBody(resp.body);
          continue;
        }

        return { ok: true, response: resp, attempts };
      }
    }

    return { ok: false, attempts, error: "all providers/keys exhausted" };
  }
}

async function drainBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!body) return;
  try {
    const reader = body.getReader();
    while (!(await reader.read()).done) {}
  } catch {}
}
