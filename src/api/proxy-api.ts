import type { FastifyInstance } from "fastify";
import type { Router } from "../core/router.js";
import type { ChatRequest } from "../providers/base.js";

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
        error: {
          message: result.error,
          type: "upstream_error",
          attempts: result.attempts,
        },
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

  app.post("/v1/messages", async (_req, reply) => {
    reply.code(501);
    return {
      error: {
        message: "Anthropic /v1/messages translation not implemented yet — use /v1/chat/completions",
        type: "not_implemented",
      },
    };
  });
}
