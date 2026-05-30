import type { Dispatcher } from "undici";
import type { ModelMap } from "./model-aliases.js";

export type ProviderKind = "nvidia" | "openrouter" | "groq" | "together" | "ollama";

export type KeyCheckResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "expired" | "rate_limited" | "network" | "unknown"; message: string };

export type ChatRequest = {
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  stream?: boolean;
  [k: string]: unknown;
};

export type UpstreamResponse = {
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
};

export interface Provider {
  kind: ProviderKind;
  displayName: string;
  baseUrl: string;
  defaultModels: string[];
  defaultModelMap: ModelMap;
  defaultFallbackModel: string;

  checkKey(apiKey: string, dispatcher?: Dispatcher): Promise<KeyCheckResult>;

  chatCompletion(
    req: ChatRequest,
    apiKey: string,
    dispatcher?: Dispatcher,
    signal?: AbortSignal,
  ): Promise<UpstreamResponse>;
}

export function classifyHttpError(status: number): KeyCheckResult {
  if (status === 401 || status === 403) {
    return { ok: false, reason: "invalid", message: `auth failed (HTTP ${status})` };
  }
  if (status === 429) {
    return { ok: false, reason: "rate_limited", message: "rate limited" };
  }
  return { ok: false, reason: "unknown", message: `HTTP ${status}` };
}
