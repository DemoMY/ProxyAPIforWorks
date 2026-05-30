import { makeOpenAIProvider } from "./openai-compat.js";
import { buildAliasMap } from "./model-aliases.js";

const GENERAL = "meta/llama-3.3-70b-instruct";
const CODE = "qwen/qwen2.5-coder-32b-instruct";
const REASONING = "deepseek-ai/deepseek-r1";

export const NvidiaProvider = makeOpenAIProvider({
  kind: "nvidia",
  displayName: "NVIDIA NIM",
  baseUrl: "https://integrate.api.nvidia.com/v1",
  defaultModels: [GENERAL, REASONING, CODE],
  defaultModelMap: buildAliasMap({ general: GENERAL, code: CODE, reasoning: REASONING }),
  defaultFallbackModel: GENERAL,
});
