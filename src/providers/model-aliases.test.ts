import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAliasMap, resolveModelName } from "./model-aliases.js";

test("buildAliasMap: claude-3-5-sonnet → general bucket", () => {
  const m = buildAliasMap({ general: "G", code: "C", reasoning: "R" });
  assert.equal(m["claude-3-5-sonnet"], "G");
  assert.equal(m["claude-3-5-sonnet-latest"], "G");
  assert.equal(m["claude-3-5-sonnet-20241022"], "G");
  assert.equal(m["claude-sonnet-4-5"], "G");
});

test("buildAliasMap: haiku → code bucket", () => {
  const m = buildAliasMap({ general: "G", code: "C", reasoning: "R" });
  assert.equal(m["claude-3-5-haiku"], "C");
  assert.equal(m["claude-3-haiku"], "C");
  assert.equal(m["gpt-4o-mini"], "C");
  assert.equal(m["o1-mini"], "C");
});

test("buildAliasMap: opus + o1 → reasoning bucket", () => {
  const m = buildAliasMap({ general: "G", code: "C", reasoning: "R" });
  assert.equal(m["claude-3-opus"], "R");
  assert.equal(m["claude-opus-4-5"], "R");
  assert.equal(m["o1"], "R");
});

test("resolveModelName: maps known model", () => {
  const m = { "claude-3-5-sonnet": "meta/llama-3.3-70b-instruct" };
  assert.equal(resolveModelName("claude-3-5-sonnet", m, "fallback"), "meta/llama-3.3-70b-instruct");
});

test("resolveModelName: unknown model uses fallback", () => {
  const m = { "claude-3-5-sonnet": "X" };
  assert.equal(resolveModelName("some-random", m, "F"), "F");
});

test("resolveModelName: no fallback returns requested as-is", () => {
  assert.equal(resolveModelName("custom-model", {}, null), "custom-model");
  assert.equal(resolveModelName("custom-model", null, null), "custom-model");
});

test("resolveModelName: empty string in map is ignored, fallback used", () => {
  const m = { "claude-3-5-sonnet": "" };
  assert.equal(resolveModelName("claude-3-5-sonnet", m, "F"), "F");
});
