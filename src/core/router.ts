import type { DB } from "../db.js";
import { SecretBox } from "../crypto.js";
import { KeyPool, parseRetryAfter } from "./keypool.js";
import { getProvider } from "../providers/registry.js";
import type { ChatRequest, ProviderKind, UpstreamResponse } from "../providers/base.js";
import { resolveModelName, type ModelMap } from "../providers/model-aliases.js";
import { DispatcherCache } from "../proxy/cache.js";

type ProviderRow = {
  id: string;
  kind: ProviderKind;
  enabled: number;
  priority: number;
  proxy_id: string | null;
  model_map: string | null;
  fallback_model: string | null;
};

export type RouteAttempt = {
  providerId: string;
  providerKind: ProviderKind;
  keyId: string;
  status: number | "error" | "aborted";
  ms: number;
  error?: string;
};

export type RouteResult =
  | { ok: true; response: UpstreamResponse; attempts: RouteAttempt[] }
  | { ok: false; attempts: RouteAttempt[]; error: string };

export class Router {
  constructor(
    private db: DB,
    private box: SecretBox,
    private pool: KeyPool,
    private dispatchers: DispatcherCache,
  ) {}

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
      if (signal?.aborted) {
        return { ok: false, attempts, error: "request aborted by client" };
      }
      const provider = getProvider(prov.kind);
      const dispatcher = this.dispatchers.get(prov.proxy_id);
      const keys = this.pool.listAliveByProvider(prov.id, Date.now());
      const resolvedReq: ChatRequest = { ...req, model: this.resolveModel(prov, req.model) };

      for (const key of keys) {
        if (signal?.aborted) {
          return { ok: false, attempts, error: "request aborted by client" };
        }
        const apiKey = this.pool.decrypt(key);
        const started = Date.now();
        let resp: UpstreamResponse;
        try {
          resp = await provider.chatCompletion(resolvedReq, apiKey, dispatcher, signal);
        } catch (err) {
          const isAbort = signal?.aborted || (err as Error).name === "AbortError";
          attempts.push({
            providerId: prov.id, providerKind: prov.kind, keyId: key.id,
            status: isAbort ? "aborted" : "error",
            ms: Date.now() - started,
            error: (err as Error).message,
          });
          if (isAbort) return { ok: false, attempts, error: "request aborted by client" };
          continue;
        }

        const ms = Date.now() - started;

        if (resp.status >= 200 && resp.status < 300) {
          this.pool.markUsed(key.id);
          attempts.push({ providerId: prov.id, providerKind: prov.kind, keyId: key.id, status: resp.status, ms });
          return { ok: true, response: resp, attempts };
        }

        attempts.push({ providerId: prov.id, providerKind: prov.kind, keyId: key.id, status: resp.status, ms });

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
