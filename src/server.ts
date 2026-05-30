import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import type { AppConfig } from "./config.js";
import type { DB } from "./db.js";
import { SecretBox } from "./crypto.js";
import { Router } from "./core/router.js";
import { KeyPool } from "./core/keypool.js";
import { HealthChecker } from "./core/health.js";
import { registerProxyApi } from "./api/proxy-api.js";
import { registerAdminApi } from "./api/admin-api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type ServerHandles = {
  uiApp: FastifyInstance;
  proxyApp: FastifyInstance;
  health: HealthChecker;
};

const HEALTH_PATHS = new Set(["/health", "/api/health"]);

function makeAuthHook(token: string | null) {
  if (!token) return null;
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (HEALTH_PATHS.has(req.url.split("?")[0]!)) return;
    if (req.method === "OPTIONS") return;
    const auth = req.headers["authorization"];
    const provided =
      typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")
        ? auth.slice(7).trim()
        : (req.headers["x-api-key"] as string | undefined)?.trim();
    if (provided !== token) {
      reply.code(401);
      await reply.send({ error: { type: "unauthorized", message: "invalid or missing auth token" } });
    }
  };
}

export async function startServer(cfg: AppConfig, db: DB): Promise<ServerHandles> {
  const box = SecretBox.loadOrCreate(cfg.masterKeyPath);
  const pool = new KeyPool(db, box);
  const router = new Router(db, box, pool);
  const health = new HealthChecker(db, box, cfg.healthCheckIntervalMs);

  const authHook = makeAuthHook(cfg.authToken);

  const proxyApp = Fastify({
    logger: { level: process.env.LLM_GATE_LOG_LEVEL ?? "info" },
    bodyLimit: 16 * 1024 * 1024,
  });
  await proxyApp.register(fastifyCors, { origin: true });
  if (authHook) proxyApp.addHook("onRequest", authHook);
  registerProxyApi(proxyApp, router);

  const uiApp = Fastify({
    logger: { level: process.env.LLM_GATE_LOG_LEVEL ?? "info" },
    bodyLimit: 1 * 1024 * 1024,
  });
  await uiApp.register(fastifyCors, { origin: true });
  if (authHook) uiApp.addHook("onRequest", authHook);
  registerAdminApi(uiApp, db, box, router, health);

  const uiRoot = resolveUiRoot();
  if (uiRoot) {
    await uiApp.register(fastifyStatic, { root: uiRoot, prefix: "/" });
  } else {
    uiApp.get("/", async (_req, reply) => {
      reply.type("text/plain");
      return "llm-gate admin UI not bundled. Use /api/* endpoints.";
    });
  }

  await proxyApp.listen({ port: cfg.proxyPort, host: cfg.host });
  await uiApp.listen({ port: cfg.uiPort, host: cfg.host });

  health.start();

  return { uiApp, proxyApp, health };
}

function resolveUiRoot(): string | null {
  const candidates = [
    join(__dirname, "ui"),
    join(__dirname, "..", "src", "ui"),
    join(__dirname, "..", "ui"),
  ];
  return candidates.find((c) => existsSync(join(c, "index.html"))) ?? null;
}
