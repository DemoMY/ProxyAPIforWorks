export type ModelMap = Record<string, string>;

export function buildAliasMap(opts: {
  general: string;
  code: string;
  reasoning: string;
}): ModelMap {
  const { general, code, reasoning } = opts;
  return {
    "claude-3-5-sonnet": general,
    "claude-3-5-sonnet-latest": general,
    "claude-3-5-sonnet-20241022": general,
    "claude-3-5-haiku": code,
    "claude-3-5-haiku-latest": code,
    "claude-3-5-haiku-20241022": code,
    "claude-3-opus": reasoning,
    "claude-3-opus-20240229": reasoning,
    "claude-3-haiku": code,
    "claude-sonnet-4-5": general,
    "claude-opus-4-5": reasoning,
    "claude-haiku-4-5": code,
    "gpt-4": general,
    "gpt-4-turbo": general,
    "gpt-4o": general,
    "gpt-4o-mini": code,
    "gpt-3.5-turbo": code,
    "o1": reasoning,
    "o1-mini": code,
  };
}

export function resolveModelName(
  requested: string,
  map: ModelMap | null,
  fallback: string | null,
): string {
  if (map && Object.prototype.hasOwnProperty.call(map, requested)) {
    const mapped = map[requested];
    if (mapped) return mapped;
  }
  return fallback ?? requested;
}
