import type { Dispatcher } from "undici";
import type {
  ChatRequest, KeyCheckResult, Provider, ProviderKind, UpstreamResponse,
} from "./base.js";
import { classifyHttpError } from "./base.js";
import type { ModelMap } from "./model-aliases.js";
import { withTimeout } from "../util/signals.js";

export type OpenAICompatConfig = {
  kind: ProviderKind;
  displayName: string;
  baseUrl: string;
  defaultModels: string[];
  defaultModelMap: ModelMap;
  defaultFallbackModel: string;
  requiresAuth?: boolean;
  extraHeaders?: () => Record<string, string>;
};

const DEFAULT_UPSTREAM_TIMEOUT_MS = Number(process.env.LLM_GATE_UPSTREAM_TIMEOUT_MS ?? 120_000);
const KEY_CHECK_TIMEOUT_MS = 10_000;

export function makeOpenAIProvider(cfg: OpenAICompatConfig): Provider {
  const needsAuth = cfg.requiresAuth !== false;

  function authHeader(apiKey: string): Record<string, string> {
    return needsAuth ? { Authorization: `Bearer ${apiKey}` } : {};
  }

  return {
    kind: cfg.kind,
    displayName: cfg.displayName,
    baseUrl: cfg.baseUrl,
    defaultModels: cfg.defaultModels,
    defaultModelMap: cfg.defaultModelMap,
    defaultFallbackModel: cfg.defaultFallbackModel,

    async checkKey(apiKey: string, dispatcher?: Dispatcher): Promise<KeyCheckResult> {
      try {
        const res = await fetch(`${cfg.baseUrl}/models`, {
          headers: { ...authHeader(apiKey), ...(cfg.extraHeaders?.() ?? {}) },
          signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS),
          dispatcher,
        } as RequestInit & { dispatcher?: Dispatcher });
        if (res.ok) return { ok: true };
        return classifyHttpError(res.status);
      } catch (err) {
        return { ok: false, reason: "network", message: (err as Error).message };
      }
    },

    async chatCompletion(
      req: ChatRequest,
      apiKey: string,
      dispatcher?: Dispatcher,
      signal?: AbortSignal,
    ): Promise<UpstreamResponse> {
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: req.stream ? "text/event-stream" : "application/json",
          ...authHeader(apiKey),
          ...(cfg.extraHeaders?.() ?? {}),
        },
        body: JSON.stringify(req),
        signal: withTimeout(signal, DEFAULT_UPSTREAM_TIMEOUT_MS),
        dispatcher,
      } as RequestInit & { dispatcher?: Dispatcher });
      return { status: res.status, headers: res.headers, body: res.body };
    },
  };
}
