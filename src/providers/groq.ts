import { makeOpenAIProvider } from "./openai-compat.js";
import { buildAliasMap } from "./model-aliases.js";

const GENERAL = "llama-3.3-70b-versatile";
const CODE = "qwen-2.5-coder-32b";
const REASONING = "deepseek-r1-distill-llama-70b";

export const GroqProvider = makeOpenAIProvider({
  kind: "groq",
  displayName: "Groq",
  baseUrl: "https://api.groq.com/openai/v1",
  defaultModels: [GENERAL, REASONING, CODE],
  defaultModelMap: buildAliasMap({ general: GENERAL, code: CODE, reasoning: REASONING }),
  defaultFallbackModel: GENERAL,
});
