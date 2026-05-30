import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Router, RouteAttempt, RouteResult } from "../core/router.js";
import type { ChatRequest, UpstreamResponse } from "../providers/base.js";
import {
  anthropicToOpenAI,
  openAIResponseToAnthropic,
  translateStream,
  type AnthropicRequest,
} from "./anthropic-translate.js";

function logRoute(req: FastifyRequest, label: string, model: string, result: RouteResult, startedAt: number): void {
  const elapsed = Date.now() - startedAt;
  if (result.ok) {
    const last = result.attempts[result.attempts.length - 1] as RouteAttempt | undefined;
    req.log.info(
      { route: label, model, provider: last?.providerKind, status: last?.status, attempts: result.attempts.length, ms: elapsed },
      "upstream ok",
    );
  } else {
    req.log.warn(
      { route: label, model, error: result.error, attempts: result.attempts, ms: elapsed },
      "upstream failed",
    );
  }
}

function forwardUpstreamHeaders(upstream: UpstreamResponse, reply: FastifyReply): void {
  upstream.headers.forEach((v, k) => {
    const lk = k.toLowerCase();
    if (lk === "transfer-encoding" || lk === "content-encoding" || lk === "content-length") return;
    reply.header(k, v);
  });
}

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
    const started = Date.now();

    const result = await router.route(body, abort.signal);
    logRoute(req, "/v1/chat/completions", body.model, result, started);

    if (!result.ok) {
      reply.code(502);
      return { error: { message: result.error, type: "upstream_error", attempts: result.attempts } };
    }

    const upstream = result.response;
    reply.code(upstream.status);
    forwardUpstreamHeaders(upstream, reply);
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
    const started = Date.now();

    const result = await router.route(openaiReq, abort.signal);
    logRoute(req, "/v1/messages", body.model, result, started);

    if (!result.ok) {
      reply.code(502);
      return {
        type: "error",
        error: { type: "api_error", message: result.error, attempts: result.attempts },
      };
    }

    const upstream = result.response;
    if (upstream.status < 200 || upstream.status >= 300) {
      reply.code(upstream.status);
      forwardUpstreamHeaders(upstream, reply);
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
