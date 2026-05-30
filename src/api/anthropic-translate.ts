import { randomUUID } from "node:crypto";
import type { ChatRequest } from "../providers/base.js";

type AnthropicTextBlock = { type: "text"; text: string };
type AnthropicToolUseBlock = { type: "tool_use"; id: string; name: string; input: unknown };
type AnthropicToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string | Array<{ type: "text"; text: string }>;
  is_error?: boolean;
};
type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};

export type AnthropicRequest = {
  model: string;
  messages: AnthropicMessage[];
  system?: string | AnthropicTextBlock[];
  max_tokens?: number;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  tools?: Array<{ name: string; description?: string; input_schema: unknown }>;
  tool_choice?: { type: "auto" | "any" | "tool"; name?: string };
};

type OpenAIMessage = {
  role: string;
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
};

export function anthropicToOpenAI(req: AnthropicRequest): ChatRequest {
  const messages: OpenAIMessage[] = [];

  if (req.system) {
    const sysText = typeof req.system === "string"
      ? req.system
      : req.system.map((b) => b.text).join("\n");
    if (sysText.trim()) messages.push({ role: "system", content: sysText });
  }

  for (const msg of req.messages) {
    if (typeof msg.content === "string") {
      messages.push({ role: msg.role, content: msg.content });
      continue;
    }

    const textParts: string[] = [];
    const toolCalls: NonNullable<OpenAIMessage["tool_calls"]> = [];
    const toolResults: Array<{ id: string; content: string; isError: boolean }> = [];

    for (const block of msg.content) {
      if (block.type === "text") {
        textParts.push(block.text);
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
        });
      } else if (block.type === "tool_result") {
        const content = typeof block.content === "string"
          ? block.content
          : block.content.map((b) => b.text).join("\n");
        toolResults.push({ id: block.tool_use_id, content, isError: !!block.is_error });
      }
    }

    for (const tr of toolResults) {
      messages.push({ role: "tool", tool_call_id: tr.id, content: tr.content });
    }

    if (textParts.length > 0 || toolCalls.length > 0) {
      const text = textParts.join("\n");
      const out: OpenAIMessage = {
        role: msg.role,
        content: text.length > 0 ? text : null,
      };
      if (toolCalls.length > 0) out.tool_calls = toolCalls;
      messages.push(out);
    }
  }

  const out: ChatRequest = {
    model: req.model,
    messages,
    stream: req.stream ?? false,
  };
  if (req.max_tokens !== undefined) (out as Record<string, unknown>).max_tokens = req.max_tokens;
  if (req.temperature !== undefined) (out as Record<string, unknown>).temperature = req.temperature;
  if (req.top_p !== undefined) (out as Record<string, unknown>).top_p = req.top_p;
  if (req.stop_sequences) (out as Record<string, unknown>).stop = req.stop_sequences;
  if (req.tools) {
    (out as Record<string, unknown>).tools = req.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description ?? "",
        parameters: t.input_schema,
      },
    }));
  }
  if (req.tool_choice) {
    if (req.tool_choice.type === "auto") (out as Record<string, unknown>).tool_choice = "auto";
    else if (req.tool_choice.type === "any") (out as Record<string, unknown>).tool_choice = "required";
    else if (req.tool_choice.type === "tool" && req.tool_choice.name) {
      (out as Record<string, unknown>).tool_choice = {
        type: "function",
        function: { name: req.tool_choice.name },
      };
    }
  }
  return out;
}

export function mapStopReason(finish: string | null | undefined): string {
  switch (finish) {
    case "length": return "max_tokens";
    case "tool_calls": return "tool_use";
    case "stop":
    case "content_filter":
    default: return "end_turn";
  }
}

type OpenAIChatResponse = {
  id?: string;
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export function openAIResponseToAnthropic(resp: OpenAIChatResponse, model: string): unknown {
  const choice = resp.choices?.[0];
  const message = choice?.message;
  const content: AnthropicContentBlock[] = [];

  if (message?.content) {
    content.push({ type: "text", text: message.content });
  }
  if (message?.tool_calls) {
    for (const tc of message.tool_calls) {
      let input: unknown = {};
      try { input = JSON.parse(tc.function.arguments || "{}"); } catch {}
      content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
    }
  }

  return {
    id: resp.id ?? `msg_${randomUUID()}`,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: mapStopReason(choice?.finish_reason ?? null),
    stop_sequence: null,
    usage: {
      input_tokens: resp.usage?.prompt_tokens ?? 0,
      output_tokens: resp.usage?.completion_tokens ?? 0,
    },
  };
}

type OpenAIStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export function translateStream(
  upstream: ReadableStream<Uint8Array>,
  model: string,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const messageId = `msg_${randomUUID()}`;

  let buffer = "";
  let textOpen = false;
  let textIndex = -1;
  const toolByIndex = new Map<number, { anthIndex: number; emittedStart: boolean }>();
  let nextBlockIndex = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason = "end_turn";

  function emit(
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: string,
    data: unknown,
  ): void {
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  }

  function closeOpenBlocks(controller: ReadableStreamDefaultController<Uint8Array>): void {
    if (textOpen) {
      emit(controller, "content_block_stop", { type: "content_block_stop", index: textIndex });
      textOpen = false;
    }
    for (const tool of toolByIndex.values()) {
      if (tool.emittedStart) {
        emit(controller, "content_block_stop", { type: "content_block_stop", index: tool.anthIndex });
      }
    }
  }

  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();

      emit(controller, "message_start", {
        type: "message_start",
        message: {
          id: messageId,
          type: "message",
          role: "assistant",
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      });

      try {
        let streamDone = false;
        while (!streamDone) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let nl: number;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            const rawLine = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            const line = rawLine.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") { streamDone = true; break; }

            let chunk: OpenAIStreamChunk;
            try { chunk = JSON.parse(payload) as OpenAIStreamChunk; } catch { continue; }

            const choice = chunk.choices?.[0];
            const delta = choice?.delta;

            if (delta?.content) {
              if (!textOpen) {
                textIndex = nextBlockIndex++;
                textOpen = true;
                emit(controller, "content_block_start", {
                  type: "content_block_start",
                  index: textIndex,
                  content_block: { type: "text", text: "" },
                });
              }
              emit(controller, "content_block_delta", {
                type: "content_block_delta",
                index: textIndex,
                delta: { type: "text_delta", text: delta.content },
              });
            }

            if (delta?.tool_calls) {
              if (textOpen) {
                emit(controller, "content_block_stop", { type: "content_block_stop", index: textIndex });
                textOpen = false;
              }
              for (const tc of delta.tool_calls) {
                let tool = toolByIndex.get(tc.index);
                if (!tool) {
                  tool = { anthIndex: nextBlockIndex++, emittedStart: false };
                  toolByIndex.set(tc.index, tool);
                }
                if (!tool.emittedStart && tc.id && tc.function?.name) {
                  emit(controller, "content_block_start", {
                    type: "content_block_start",
                    index: tool.anthIndex,
                    content_block: {
                      type: "tool_use",
                      id: tc.id,
                      name: tc.function.name,
                      input: {},
                    },
                  });
                  tool.emittedStart = true;
                }
                if (tool.emittedStart && tc.function?.arguments) {
                  emit(controller, "content_block_delta", {
                    type: "content_block_delta",
                    index: tool.anthIndex,
                    delta: { type: "input_json_delta", partial_json: tc.function.arguments },
                  });
                }
              }
            }

            if (chunk.usage) {
              inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
              outputTokens = chunk.usage.completion_tokens ?? outputTokens;
            }
            if (choice?.finish_reason) {
              stopReason = mapStopReason(choice.finish_reason);
            }
          }
        }

        closeOpenBlocks(controller);
        emit(controller, "message_delta", {
          type: "message_delta",
          delta: { stop_reason: stopReason, stop_sequence: null },
          usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        });
        emit(controller, "message_stop", { type: "message_stop" });
        controller.close();
      } catch (err) {
        try { closeOpenBlocks(controller); } catch {}
        controller.error(err);
      }
    },
  });
}
