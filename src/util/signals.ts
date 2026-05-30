export function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  if (typeof (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any === "function") {
    return AbortSignal.any([signal, timeout]);
  }
  const controller = new AbortController();
  signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  timeout.addEventListener("abort", () => controller.abort(timeout.reason), { once: true });
  return controller.signal;
}
