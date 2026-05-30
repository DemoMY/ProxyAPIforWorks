import type { DB } from "../db.js";
import { SecretBox } from "../crypto.js";

export type KeyStatus = "alive" | "cooling" | "dead" | "unknown";

export type KeyRow = {
  id: string;
  provider_id: string;
  label: string;
  key_encrypted: string;
  status: KeyStatus;
  cooling_until: number | null;
  last_check_at: number | null;
  last_error: string | null;
  uses_total: number;
};

export class KeyPool {
  constructor(private db: DB, private box: SecretBox) {}

  decrypt(row: KeyRow): string {
    return this.box.decrypt(row.key_encrypted);
  }

  listAliveByProvider(providerId: string, now: number): KeyRow[] {
    this.expireCooling(now);
    return this.db
      .prepare(
        `SELECT * FROM api_keys
         WHERE provider_id = ? AND status IN ('alive','unknown')
         ORDER BY uses_total ASC, created_at ASC`
      )
      .all(providerId) as KeyRow[];
  }

  markUsed(keyId: string): void {
    this.db.prepare(`UPDATE api_keys SET uses_total = uses_total + 1 WHERE id = ?`).run(keyId);
  }

  markCooling(keyId: string, retryAfterMs: number, reason: string): void {
    const until = Date.now() + retryAfterMs;
    this.db
      .prepare(`UPDATE api_keys SET status='cooling', cooling_until=?, last_error=? WHERE id=?`)
      .run(until, reason, keyId);
  }

  markDead(keyId: string, reason: string): void {
    this.db
      .prepare(`UPDATE api_keys SET status='dead', last_error=?, last_check_at=? WHERE id=?`)
      .run(reason, Date.now(), keyId);
  }

  markAlive(keyId: string): void {
    this.db
      .prepare(`UPDATE api_keys SET status='alive', last_error=NULL, last_check_at=?, cooling_until=NULL WHERE id=?`)
      .run(Date.now(), keyId);
  }

  private expireCooling(now: number): void {
    this.db
      .prepare(`UPDATE api_keys SET status='alive', cooling_until=NULL
                WHERE status='cooling' AND cooling_until IS NOT NULL AND cooling_until <= ?`)
      .run(now);
  }
}

export function parseRetryAfter(headers: Headers): number {
  const ra = headers.get("retry-after");
  if (!ra) return 30_000;
  const asNum = Number(ra);
  if (Number.isFinite(asNum)) return asNum * 1000;
  const asDate = Date.parse(ra);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return 30_000;
}
