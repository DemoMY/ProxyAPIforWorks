import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anthropicToOpenAI,
  openAIResponseToAnthropic,
  translateStream,
  mapStopReason,
} from "./anthropic-translate.js";

test("anthropicToOpenAI: plain text user message", () => {
  const r = anthropicToOpenAI({
    model: "claude-3-5-sonnet",
    messages: [{ role: "user", content: "Hi" }],
    max_tokens: 100,
  });
  assert.equal(r.model, "claude-3-5-sonnet");
  assert.equal(r.messages.length, 1);
  assert.deepEqual(r.messages[0], { role: "user", content: "Hi" });
  assert.equal((r as Record<string, unknown>).max_tokens, 100);
  assert.equal(r.stream, false);
});

test("anthropicToOpenAI: system as string prepends system message", () => {
  const r = anthropicToOpenAI({
    model: "m",
    system: "You are concise.",
    messages: [{ role: "user", content: "Hi" }],
  });
  assert.equal(r.messages.length, 2);
  assert.deepEqual(r.messages[0], { role: "system", content: "You are concise." });
});

test("anthropicToOpenAI: system as array joins text blocks", () => {
  const r = anthropicToOpenAI({
    model: "m",
    system: [
      { type: "text", text: "A" },
      { type: "text", text: "B" },
    ],
    messages: [{ role: "user", content: "Hi" }],
  });
  assert.equal(r.messages[0]?.content, "A\nB");
});

test("anthropicToOpenAI: assistant tool_use becomes tool_calls", () => {
  const r = anthropicToOpenAI({
    model: "m",
    messages: [
      { role: "user", content: "weather?" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me check." },
          { type: "tool_use", id: "tool_1", name: "get_weather", input: { city: "Moscow" } },
        ],
      },
    ],
  });
  const asst = r.messages[1] as { role: string; content: string | null; tool_calls?: unknown[] };
  assert.equal(asst.role, "assistant");
  assert.equal(asst.content, "Let me check.");
  assert.ok(asst.tool_calls);
  assert.equal(asst.tool_calls!.length, 1);
  assert.deepEqual(asst.tool_calls![0], {
    id: "tool_1",
    type: "function",
    function: { name: "get_weather", arguments: '{"city":"Moscow"}' },
  });
});

test("anthropicToOpenAI: tool_result block becomes tool role message", () => {
  const r = anthropicToOpenAI({
    model: "m",
    messages: [
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tool_1", content: "sunny" },
          { type: "text", text: "thanks" },
        ],
      },
    ],
  });
  assert.equal(r.messages.length, 2);
  assert.deepEqual(r.messages[0], { role: "tool", tool_call_id: "tool_1", content: "sunny" });
  assert.deepEqual(r.messages[1], { role: "user", content: "thanks" });
});

test("anthropicToOpenAI: tools schema is translated", () => {
  const r = anthropicToOpenAI({
    model: "m",
    messages: [{ role: "user", content: "x" }],
    tools: [{
      name: "search",
      description: "search the web",
      input_schema: { type: "object", properties: { q: { type: "string" } } },
    }],
    tool_choice: { type: "auto" },
  });
  const tools = (r as Record<string, unknown>).tools as Array<{ type: string; function: { name: string } }>;
  assert.equal(tools.length, 1);
  assert.equal(tools[0]?.type, "function");
  assert.equal(tools[0]?.function.name, "search");
  assert.equal((r as Record<string, unknown>).tool_choice, "auto");
});

test("anthropicToOpenAI: tool_choice 'any' maps to 'required'", () => {
  const r = anthropicToOpenAI({
    model: "m",
    messages: [{ role: "user", content: "x" }],
    tool_choice: { type: "any" },
  });
  assert.equal((r as Record<string, unknown>).tool_choice, "required");
});

test("openAIResponseToAnthropic: plain text", () => {
  const r = openAIResponseToAnthropic(
    {
      id: "chatcmpl-1",
      choices: [{ message: { content: "Hello" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    },
    "claude-x",
  ) as {
    type: string; role: string; model: string;
    content: Array<{ type: string; text?: string }>;
    stop_reason: string; usage: { input_tokens: number; output_tokens: number };
  };
  assert.equal(r.type, "message");
  assert.equal(r.role, "assistant");
  assert.equal(r.model, "claude-x");
  assert.equal(r.content[0]?.type, "text");
  assert.equal(r.content[0]?.text, "Hello");
  assert.equal(r.stop_reason, "end_turn");
  assert.equal(r.usage.input_tokens, 5);
  assert.equal(r.usage.output_tokens, 2);
});

test("openAIResponseToAnthropic: tool_calls produce tool_use blocks", () => {
  const r = openAIResponseToAnthropic(
    {
      choices: [{
        message: {
          content: null,
          tool_calls: [{ id: "t1", function: { name: "f", arguments: '{"a":1}' } }],
        },
        finish_reason: "tool_calls",
      }],
    },
    "m",
  ) as {
    content: Array<{ type: string; id?: string; name?: string; input?: unknown }>;
    stop_reason: string;
  };
  assert.equal(r.content.length, 1);
  assert.equal(r.content[0]?.type, "tool_use");
  assert.equal(r.content[0]?.id, "t1");
  assert.equal(r.content[0]?.name, "f");
  assert.deepEqual(r.content[0]?.input, { a: 1 });
  assert.equal(r.stop_reason, "tool_use");
});

test("mapStopReason coverage", () => {
  assert.equal(mapStopReason("stop"), "end_turn");
  assert.equal(mapStopReason("length"), "max_tokens");
  assert.equal(mapStopReason("tool_calls"), "tool_use");
  assert.equal(mapStopReason(null), "end_turn");
  assert.equal(mapStopReason(undefined), "end_turn");
});

async function consumeSse(stream: ReadableStream<Uint8Array>): Promise<Array<{ event: string; data: unknown }>> {
  const events: Array<{ event: string; data: unknown }> = [];
  const decoder = new TextDecoder();
  let buf = "";
  const reader = stream.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  for (const block of buf.split("\n\n")) {
    const lines = block.split("\n");
    let event = "", data = "";
    for (const ln of lines) {
      if (ln.startsWith("event: ")) event = ln.slice(7);
      else if (ln.startsWith("data: ")) data += ln.slice(6);
    }
    if (event) events.push({ event, data: JSON.parse(data) });
  }
  return events;
}

function sseSource(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(`data: ${c}\n\n`));
      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      controller.close();
    },
  });
}

test("translateStream: text deltas produce content_block lifecycle", async () => {
  const source = sseSource([
    JSON.stringify({ choices: [{ delta: { content: "Hel" } }] }),
    JSON.stringify({ choices: [{ delta: { content: "lo" } }] }),
    JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2 } }),
  ]);
  const events = await consumeSse(translateStream(source, "claude-x"));
  const types = events.map((e) => e.event);
  assert.deepEqual(types, [
    "message_start",
    "content_block_start",
    "content_block_delta",
    "content_block_delta",
    "content_block_stop",
    "message_delta",
    "message_stop",
  ]);
  const finalDelta = events[5]!.data as { delta: { stop_reason: string }; usage: { output_tokens: number } };
  assert.equal(finalDelta.delta.stop_reason, "end_turn");
  assert.equal(finalDelta.usage.output_tokens, 2);
});

test("translateStream: tool_calls produce tool_use block with input_json_delta", async () => {
  const source = sseSource([
    JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "t1", function: { name: "f", arguments: "{\"a\":" } }] } }] }),
    JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "1}" } }] } }] }),
    JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
  ]);
  const events = await consumeSse(translateStream(source, "m"));
  const blockStart = events.find((e) => e.event === "content_block_start");
  assert.ok(blockStart);
  const startData = blockStart!.data as { content_block: { type: string; name: string; id: string } };
  assert.equal(startData.content_block.type, "tool_use");
  assert.equal(startData.content_block.name, "f");
  assert.equal(startData.content_block.id, "t1");
  const deltas = events.filter((e) => e.event === "content_block_delta");
  const joined = deltas
    .map((d) => (d.data as { delta: { partial_json: string } }).delta.partial_json)
    .join("");
  assert.equal(joined, '{"a":1}');
  const finalDelta = events.find((e) => e.event === "message_delta");
  assert.equal(
    (finalDelta!.data as { delta: { stop_reason: string } }).delta.stop_reason,
    "tool_use",
  );
});
