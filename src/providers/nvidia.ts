import type { Dispatcher } from "undici";
import { Provider, ChatRequest, KeyCheckResult, UpstreamResponse, classifyHttpError } from "./base.js";

const BASE_URL = "https://integrate.api.nvidia.com/v1";

export const NvidiaProvider: Provider = {
  kind: "nvidia",
  displayName: "NVIDIA NIM",
  baseUrl: BASE_URL,
  defaultModels: [
    "meta/llama-3.3-70b-instruct",
    "deepseek-ai/deepseek-r1",
    "qwen/qwen2.5-coder-32b-instruct",
  ],

  async checkKey(apiKey: string, dispatcher?: Dispatcher): Promise<KeyCheckResult> {
    try {
      const res = await fetch(`${BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
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
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: req.stream ? "text/event-stream" : "application/json",
      },
      body: JSON.stringify(req),
      signal,
      dispatcher,
    } as RequestInit & { dispatcher?: Dispatcher });
    return { status: res.status, headers: res.headers, body: res.body };
  },
};
