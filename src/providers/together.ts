import { makeOpenAIProvider } from "./openai-compat.js";

export const TogetherProvider = makeOpenAIProvider({
  kind: "together",
  displayName: "Together AI",
  baseUrl: "https://api.together.xyz/v1",
  defaultModels: [
    "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    "deepseek-ai/DeepSeek-R1",
    "Qwen/Qwen2.5-Coder-32B-Instruct",
  ],
});
