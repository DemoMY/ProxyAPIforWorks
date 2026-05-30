import { makeOpenAIProvider } from "./openai-compat.js";
import { buildAliasMap } from "./model-aliases.js";

const GENERAL = "meta-llama/llama-3.3-70b-instruct:free";
const CODE = "qwen/qwen-2.5-coder-32b-instruct:free";
const REASONING = "deepseek/deepseek-r1:free";

export const OpenRouterProvider = makeOpenAIProvider({
  kind: "openrouter",
  displayName: "OpenRouter",
  baseUrl: "https://openrouter.ai/api/v1",
  defaultModels: [GENERAL, REASONING, CODE],
  defaultModelMap: buildAliasMap({ general: GENERAL, code: CODE, reasoning: REASONING }),
  defaultFallbackModel: GENERAL,
  extraHeaders: () => ({
    "HTTP-Referer": "https://github.com/DemoMY/ProxyAPIforWorks",
    "X-Title": "llm-gate",
  }),
});
