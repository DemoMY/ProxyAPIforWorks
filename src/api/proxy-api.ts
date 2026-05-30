import type { FastifyInstance } from "fastify";
import type { Router } from "../core/router.js";
import type { ChatRequest } from "../providers/base.js";
import {
  anthropicToOpenAI,
  openAIResponseToAnthropic,
  translateStream,
  type AnthropicRequest,
} from "./anthropic-translate.js";

export function registerProxyApi(app: FastifyInstance, router: Router): void {
  app.get("/health", async () => ({ status: "ok", service: "llm-gate-proxy" }));

  app.post("/v1/chat/completions", async (req, reply) => {
    const body = req.body as ChatRequest | undefined;
    if (!body || typeof body !== "object" || !Array.isArray(body.messages)) {
      reply.code(400);
      return { error: { message: "invalid request body", type: "invalid_request_error" } };
    }

    const abort = new AbortController();
    req.raw.on("close", () => abort.abort());

    const result = await router.route(body, abort.signal);

    if (!result.ok) {
      reply.code(502);
      return {
        error: { message: result.error, type: "upstream_error", attempts: result.attempts },
      };
    }

    const upstream = result.response;
    reply.code(upstream.status);
    upstream.headers.forEach((v, k) => {
      const lk = k.toLowerCase();
      if (lk === "transfer-encoding" || lk === "content-encoding" || lk === "content-length") return;
      reply.header(k, v);
    });
    if (!upstream.body) return reply.send();
    return reply.send(upstream.body);
  });

  app.post("/v1/messages", async (req, reply) => {
    const body = req.body as AnthropicRequest | undefined;
    if (!body || typeof body !== "object" || !Array.isArray(body.messages) || !body.model) {
      reply.code(400);
      return { type: "error", error: { type: "invalid_request_error", message: "invalid request body" } };
    }

    const openaiReq = anthropicToOpenAI(body);

    const abort = new AbortController();
    req.raw.on("close", () => abort.abort());

    const result = await router.route(openaiReq, abort.signal);

    if (!result.ok) {
      reply.code(502);
      return {
        type: "error",
        error: {
          type: "api_error",
          message: result.error,
          attempts: result.attempts,
        },
      };
    }

    const upstream = result.response;

    if (upstream.status < 200 || upstream.status >= 300) {
      reply.code(upstream.status);
      upstream.headers.forEach((v, k) => {
        const lk = k.toLowerCase();
        if (lk === "transfer-encoding" || lk === "content-encoding" || lk === "content-length") return;
        reply.header(k, v);
      });
      return reply.send(upstream.body);
    }

    if (body.stream) {
      if (!upstream.body) {
        reply.code(502);
        return { type: "error", error: { type: "api_error", message: "empty upstream stream" } };
      }
      reply.code(200);
      reply.header("Content-Type", "text/event-stream");
      reply.header("Cache-Control", "no-cache, no-transform");
      reply.header("Connection", "keep-alive");
      return reply.send(translateStream(upstream.body, body.model));
    }

    const text = await new Response(upstream.body).text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch {
      reply.code(502);
      return { type: "error", error: { type: "api_error", message: "upstream returned non-JSON" } };
    }
    reply.code(200);
    return openAIResponseToAnthropic(parsed as Parameters<typeof openAIResponseToAnthropic>[0], body.model);
  });
}
