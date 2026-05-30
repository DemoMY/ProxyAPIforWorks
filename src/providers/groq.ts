import { makeOpenAIProvider } from "./openai-compat.js";

export const GroqProvider = makeOpenAIProvider({
  kind: "groq",
  displayName: "Groq",
  baseUrl: "https://api.groq.com/openai/v1",
  defaultModels: [
    "llama-3.3-70b-versatile",
    "deepseek-r1-distill-llama-70b",
    "qwen-2.5-coder-32b",
  ],
});
