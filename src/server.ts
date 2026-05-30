import Fastify, { type FastifyInstance } from "fastify";
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

export async function startServer(cfg: AppConfig, db: DB): Promise<ServerHandles> {
  const box = SecretBox.loadOrCreate(cfg.masterKeyPath);
  const pool = new KeyPool(db, box);
  const router = new Router(db, box, pool);
  const health = new HealthChecker(db, box, cfg.healthCheckIntervalMs);

  const proxyApp = Fastify({ logger: { level: "info" }, bodyLimit: 8 * 1024 * 1024 });
  await proxyApp.register(fastifyCors, { origin: true });
  registerProxyApi(proxyApp, router);

  const uiApp = Fastify({ logger: { level: "info" }, bodyLimit: 1 * 1024 * 1024 });
  await uiApp.register(fastifyCors, { origin: true });
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
