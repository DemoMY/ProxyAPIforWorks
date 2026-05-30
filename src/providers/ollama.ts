import { makeOpenAIProvider } from "./openai-compat.js";
import { buildAliasMap } from "./model-aliases.js";

const OLLAMA_URL = process.env.LLM_GATE_OLLAMA_URL ?? "http://127.0.0.1:11434/v1";

const GENERAL = "llama3.3";
const CODE = "qwen2.5-coder";
const REASONING = "deepseek-r1";

export const OllamaProvider = makeOpenAIProvider({
  kind: "ollama",
  displayName: "Ollama (local)",
  baseUrl: OLLAMA_URL,
  defaultModels: [GENERAL, REASONING, CODE],
  defaultModelMap: buildAliasMap({ general: GENERAL, code: CODE, reasoning: REASONING }),
  defaultFallbackModel: GENERAL,
  requiresAuth: false,
});
