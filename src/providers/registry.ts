import { Provider, ProviderKind } from "./base.js";
import { NvidiaProvider } from "./nvidia.js";

const REGISTRY = new Map<ProviderKind, Provider>([
  ["nvidia", NvidiaProvider],
]);

export function getProvider(kind: ProviderKind): Provider {
  const p = REGISTRY.get(kind);
  if (!p) throw new Error(`Provider not implemented yet: ${kind}`);
  return p;
}

export function listSupportedProviders(): ProviderKind[] {
  return Array.from(REGISTRY.keys());
}
