import { Provider, ProviderKind } from "./base.js";
import { NvidiaProvider } from "./nvidia.js";
import { OpenRouterProvider } from "./openrouter.js";
import { GroqProvider } from "./groq.js";
import { TogetherProvider } from "./together.js";
import { OllamaProvider } from "./ollama.js";

const REGISTRY = new Map<ProviderKind, Provider>([
  ["nvidia", NvidiaProvider],
  ["openrouter", OpenRouterProvider],
  ["groq", GroqProvider],
  ["together", TogetherProvider],
  ["ollama", OllamaProvider],
]);

export function getProvider(kind: ProviderKind): Provider {
  const p = REGISTRY.get(kind);
  if (!p) throw new Error(`Provider not implemented yet: ${kind}`);
  return p;
}

export function listSupportedProviders(): ProviderKind[] {
  return Array.from(REGISTRY.keys());
}
