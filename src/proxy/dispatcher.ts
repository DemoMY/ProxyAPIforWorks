import { Agent, ProxyAgent, type Dispatcher } from "undici";
import { SocksClient } from "socks";
import * as tls from "node:tls";
import type { Socket } from "node:net";

export type ProxyProtocol = "http" | "https" | "socks5" | "socks5h";

export type ParsedProxy = {
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username?: string;
  password?: string;
  raw: string;
};

export function parseProxyUrl(url: string): ParsedProxy {
  const u = new URL(url);
  const protocol = u.protocol.replace(":", "") as ProxyProtocol;
  if (!["http", "https", "socks5", "socks5h"].includes(protocol)) {
    throw new Error(`Unsupported proxy protocol: ${protocol}`);
  }
  const port = Number(u.port);
  if (!port) throw new Error("Proxy port required");
  return {
    protocol,
    host: u.hostname,
    port,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    raw: url,
  };
}

export function createDispatcher(proxyUrl: string | null | undefined): Dispatcher | undefined {
  if (!proxyUrl) return undefined;
  const p = parseProxyUrl(proxyUrl);

  if (p.protocol === "http" || p.protocol === "https") {
    return new ProxyAgent({ uri: proxyUrl });
  }

  return new Agent({
    connect: (opts, callback) => {
      const destPort = Number(opts.port) || (opts.protocol === "https:" ? 443 : 80);
      SocksClient.createConnection({
        proxy: {
          host: p.host,
          port: p.port,
          type: 5,
          userId: p.username,
          password: p.password,
        },
        command: "connect",
        destination: { host: String(opts.hostname), port: destPort },
      }).then(({ socket }) => {
        if (opts.protocol === "https:") {
          const tlsSocket = tls.connect({
            socket: socket as Socket,
            servername: opts.servername ?? String(opts.hostname),
            ALPNProtocols: ["http/1.1"],
          });
          tlsSocket.once("secureConnect", () => callback(null, tlsSocket));
          tlsSocket.once("error", (err) => callback(err, null as never));
        } else {
          callback(null, socket as Socket);
        }
      }).catch((err: Error) => callback(err, null as never));
    },
  });
}

export type ProxyCheckResult = {
  ok: boolean;
  ip?: string;
  country?: string;
  latencyMs?: number;
  error?: string;
};

export async function checkProxy(proxyUrl: string | null): Promise<ProxyCheckResult> {
  const dispatcher = createDispatcher(proxyUrl);
  const start = Date.now();
  try {
    const res = await fetch("https://ipinfo.io/json", {
      dispatcher,
      signal: AbortSignal.timeout(7000),
    } as RequestInit & { dispatcher?: Dispatcher });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = (await res.json()) as { ip?: string; country?: string };
    return {
      ok: true,
      ip: data.ip,
      country: data.country,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
