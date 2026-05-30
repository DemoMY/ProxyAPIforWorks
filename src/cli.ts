#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { startServer } from "./server.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const db = openDb(cfg.dbPath);
  const { health } = await startServer(cfg, db);

  process.stdout.write(
    `\n  llm-gate is running\n` +
    `  ───────────────────\n` +
    `  Web UI:    http://${cfg.host}:${cfg.uiPort}\n` +
    `  Proxy API: http://${cfg.host}:${cfg.proxyPort}\n` +
    `  Data dir:  ${cfg.dataDir}\n\n` +
    `  Point your tool at:\n` +
    `    ANTHROPIC_BASE_URL=http://${cfg.host}:${cfg.proxyPort}\n` +
    `    OPENAI_BASE_URL=http://${cfg.host}:${cfg.proxyPort}/v1\n\n`
  );

  const shutdown = async (signal: string): Promise<void> => {
    process.stdout.write(`\nReceived ${signal}, shutting down...\n`);
    health.stop();
    try { db.close(); } catch {}
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  process.stderr.write(`Failed to start: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
