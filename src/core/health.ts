import type { DB } from "../db.js";
import { SecretBox } from "../crypto.js";
import { getProvider } from "../providers/registry.js";
import type { ProviderKind } from "../providers/base.js";
import { checkProxy } from "../proxy/dispatcher.js";
import { DispatcherCache } from "../proxy/cache.js";

type ProviderRow = { id: string; kind: ProviderKind; proxy_id: string | null };
type KeyRow = { id: string; provider_id: string; key_encrypted: string };
type ProxyRow = { id: string; url_encrypted: string };

export class HealthChecker {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private db: DB,
    private box: SecretBox,
    private dispatchers: DispatcherCache,
    private intervalMs: number,
  ) {}

  start(): void {
    if (this.timer) return;
    this.runCycle().catch(() => {});
    this.timer = setInterval(() => this.runCycle().catch(() => {}), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runCycle(): Promise<void> {
    await this.checkAllProxies();
    await this.checkAllKeys();
  }

  async checkAllProxies(): Promise<void> {
    const proxies = this.db.prepare(`SELECT id, url_encrypted FROM proxies`).all() as ProxyRow[];
    await Promise.all(proxies.map((p) => this.checkOneProxy(p.id, this.box.decrypt(p.url_encrypted))));
  }

  async checkOneProxy(proxyId: string, url: string): Promise<void> {
    const r = await checkProxy(url);
    this.db
      .prepare(
        `UPDATE proxies SET status=?, last_check_at=?, last_exit_ip=?, last_country=?, last_latency_ms=?, last_error=?
         WHERE id=?`
      )
      .run(
        r.ok ? "alive" : "dead",
        Date.now(),
        r.ip ?? null,
        r.country ?? null,
        r.latencyMs ?? null,
        r.error ?? null,
        proxyId,
      );
    this.dispatchers.invalidate(proxyId);
  }

  async checkAllKeys(): Promise<void> {
    const providers = this.db
      .prepare(`SELECT id, kind, proxy_id FROM providers WHERE enabled = 1`)
      .all() as ProviderRow[];

    await Promise.all(providers.map((prov) => this.checkKeysFor(prov)));
  }

  private async checkKeysFor(prov: ProviderRow): Promise<void> {
    const provider = getProvider(prov.kind);
    const dispatcher = this.dispatchers.get(prov.proxy_id);
    const keys = this.db
      .prepare(`SELECT id, provider_id, key_encrypted FROM api_keys WHERE provider_id = ?`)
      .all(prov.id) as KeyRow[];

    await Promise.all(
      keys.map(async (k) => {
        const apiKey = this.box.decrypt(k.key_encrypted);
        const r = await provider.checkKey(apiKey, dispatcher);
        if (r.ok) {
          this.db
            .prepare(`UPDATE api_keys SET status='alive', last_check_at=?, last_error=NULL WHERE id=?`)
            .run(Date.now(), k.id);
        } else if (r.reason === "invalid") {
          this.db
            .prepare(`UPDATE api_keys SET status='dead', last_check_at=?, last_error=? WHERE id=?`)
            .run(Date.now(), r.message, k.id);
        } else {
          this.db
            .prepare(`UPDATE api_keys SET last_check_at=?, last_error=? WHERE id=?`)
            .run(Date.now(), r.message, k.id);
        }
      })
    );
  }
}
