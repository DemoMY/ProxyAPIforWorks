import { makeOpenAIProvider } from "./openai-compat.js";

export const OpenRouterProvider = makeOpenAIProvider({
  kind: "openrouter",
  displayName: "OpenRouter",
  baseUrl: "https://openrouter.ai/api/v1",
  defaultModels: [
    "deepseek/deepseek-r1:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "qwen/qwen-2.5-coder-32b-instruct:free",
  ],
  extraHeaders: () => ({
    "HTTP-Referer": "https://github.com/DemoMY/ProxyAPIforWorks",
    "X-Title": "llm-gate",
  }),
});
