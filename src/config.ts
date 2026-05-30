import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export type AppConfig = {
  dataDir: string;
  dbPath: string;
  masterKeyPath: string;
  uiPort: number;
  proxyPort: number;
  host: string;
  healthCheckIntervalMs: number;
};

export function loadConfig(): AppConfig {
  const dataDir = process.env.LLM_GATE_DATA_DIR ?? join(homedir(), ".llm-gate");
  mkdirSync(dataDir, { recursive: true });

  return {
    dataDir,
    dbPath: join(dataDir, "llm-gate.sqlite"),
    masterKeyPath: join(dataDir, "master.key"),
    uiPort: Number(process.env.LLM_GATE_UI_PORT ?? 7777),
    proxyPort: Number(process.env.LLM_GATE_PROXY_PORT ?? 8082),
    host: process.env.LLM_GATE_HOST ?? "127.0.0.1",
    healthCheckIntervalMs: Number(process.env.LLM_GATE_HEALTH_INTERVAL_MS ?? 5 * 60_000),
  };
}
