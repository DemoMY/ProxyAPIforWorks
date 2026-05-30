import Database from "better-sqlite3";

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS proxies (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  url_encrypted   TEXT NOT NULL,
  type            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'unknown',
  last_check_at   INTEGER,
  last_exit_ip    TEXT,
  last_country    TEXT,
  last_latency_ms INTEGER,
  last_error      TEXT,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS providers (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  priority        INTEGER NOT NULL DEFAULT 100,
  proxy_id        TEXT REFERENCES proxies(id) ON DELETE SET NULL,
  model_map       TEXT,
  fallback_model  TEXT,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id              TEXT PRIMARY KEY,
  provider_id     TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  key_encrypted   TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'unknown',
  cooling_until   INTEGER,
  last_check_at   INTEGER,
  last_error      TEXT,
  uses_total      INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key             TEXT PRIMARY KEY,
  value           TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_provider ON api_keys(provider_id);
CREATE INDEX IF NOT EXISTS idx_providers_priority ON providers(priority);
`;

export function openDb(path: string): DB {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  const cols = db.prepare(`PRAGMA table_info(providers)`).all() as Array<{ name: string }>;
  const have = new Set(cols.map((c) => c.name));
  if (!have.has("model_map")) db.exec(`ALTER TABLE providers ADD COLUMN model_map TEXT`);
  if (!have.has("fallback_model")) db.exec(`ALTER TABLE providers ADD COLUMN fallback_model TEXT`);
}

export function getSetting(db: DB, key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(db: DB, key: string, value: string | null): void {
  if (value === null) {
    db.prepare("DELETE FROM settings WHERE key = ?").run(key);
    return;
  }
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
  ).run(key, value);
}
