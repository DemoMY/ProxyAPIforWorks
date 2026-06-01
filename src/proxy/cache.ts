import type { Dispatcher } from "undici";
import { createDispatcher } from "./dispatcher.js";
import type { DB } from "../db.js";
import { SecretBox } from "../crypto.js";

type ProxyRow = { url_encrypted: string };

export class DispatcherCache {
  private cache = new Map<string, Dispatcher>();

  constructor(private db: DB, private box: SecretBox) {}

  getProxyUrl(proxyId: string | null): string | null {
    if (!proxyId) return null;
    const row = this.db.prepare(`SELECT url_encrypted FROM proxies WHERE id = ?`).get(proxyId) as
      | ProxyRow
      | undefined;
    return row ? this.box.decrypt(row.url_encrypted) : null;
  }

  get(proxyId: string | null): Dispatcher | undefined {
    if (!proxyId) return undefined;
    const cached = this.cache.get(proxyId);
    if (cached) return cached;
    const url = this.getProxyUrl(proxyId);
    if (!url) return undefined;
    const d = createDispatcher(url);
    if (d) this.cache.set(proxyId, d);
    return d;
  }

  invalidate(proxyId: string): void {
    const d = this.cache.get(proxyId);
    if (d) d.close().catch(() => {});
    this.cache.delete(proxyId);
  }

  closeAll(): void {
    for (const d of this.cache.values()) d.close().catch(() => {});
    this.cache.clear();
  }
}
