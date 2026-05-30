import { makeOpenAIProvider } from "./openai-compat.js";
import { buildAliasMap } from "./model-aliases.js";

const GENERAL = "meta-llama/Llama-3.3-70B-Instruct-Turbo";
const CODE = "Qwen/Qwen2.5-Coder-32B-Instruct";
const REASONING = "deepseek-ai/DeepSeek-R1";

export const TogetherProvider = makeOpenAIProvider({
  kind: "together",
  displayName: "Together AI",
  baseUrl: "https://api.together.xyz/v1",
  defaultModels: [GENERAL, REASONING, CODE],
  defaultModelMap: buildAliasMap({ general: GENERAL, code: CODE, reasoning: REASONING }),
  defaultFallbackModel: GENERAL,
});
