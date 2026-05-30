import { makeOpenAIProvider } from "./openai-compat.js";

export const NvidiaProvider = makeOpenAIProvider({
  kind: "nvidia",
  displayName: "NVIDIA NIM",
  baseUrl: "https://integrate.api.nvidia.com/v1",
  defaultModels: [
    "meta/llama-3.3-70b-instruct",
    "deepseek-ai/deepseek-r1",
    "qwen/qwen2.5-coder-32b-instruct",
  ],
});
