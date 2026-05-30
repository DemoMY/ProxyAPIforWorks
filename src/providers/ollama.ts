import { makeOpenAIProvider } from "./openai-compat.js";

const OLLAMA_URL = process.env.LLM_GATE_OLLAMA_URL ?? "http://127.0.0.1:11434/v1";

export const OllamaProvider = makeOpenAIProvider({
  kind: "ollama",
  displayName: "Ollama (local)",
  baseUrl: OLLAMA_URL,
  defaultModels: ["llama3.3", "qwen2.5-coder", "deepseek-r1"],
  requiresAuth: false,
});
