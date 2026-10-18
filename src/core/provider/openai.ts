// OpenAI-compatible chat-completions provider, streamed over HostNet chunk
// callbacks (no ReadableStream — it does not exist under scriptc).
// Proven shape: pi-elf's MiniOpenAI.

import type { HostNet } from "../ports.ts";
import type { ChatMessage, ToolCall, ToolSpec, Usage } from "../messages.ts";
import { newSseParser, sseFeed } from "../sse.ts";

export interface ProviderRequest {
  model: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
}

export interface StreamResult {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  finishReason: string;
}

export interface Provider {
  stream(req: ProviderRequest, onText: (chunk: string) => void): Promise<StreamResult>;
}

export interface OpenAIConfig {
  baseUrl: string; // e.g. https://api.openai.com/v1
  apiKey: string;
}

// Wire shapes of the streamed deltas. Fields that may be absent between
// chunks use `?:` — under scriptc a `T | null` field rejects a missing key
// in the `as` cast's runtime shape check, while `?:` tolerates both absent
// and explicit null.
interface OpenAIFunction {
  name?: string | null;
  arguments?: string | null;
}

interface OpenAIToolCallDelta {
  index: number;
  id?: string | null;
  type?: string | null;
  function?: OpenAIFunction | null;
}

interface OpenAIDelta {
  role?: string | null;
  content?: string | null;
  tool_calls?: OpenAIToolCallDelta[] | null;
}

interface OpenAIChoice {
  index: number;
  delta?: OpenAIDelta | null;
  finish_reason?: string | null;
}

interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

interface OpenAIChunk {
  choices?: OpenAIChoice[] | null;
  usage?: OpenAIUsage | null;
}

interface ToolAcc {
  index: number;
  id: string;
  name: string;
  args: string;
}

function findAcc(accs: ToolAcc[], index: number): ToolAcc | null {
  for (let i = 0; i < accs.length; i++) {
    if (accs[i].index === index) {
      return accs[i];
    }
  }
  return null;
}

interface OutboundToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

// Serialize the wire request. Messages with toolCalls carry the OpenAI
// `tool_calls` array; tool results carry `tool_call_id`.
function buildBody(req: ProviderRequest): string {
  const msgs: unknown[] = [];
  for (let i = 0; i < req.messages.length; i++) {
    const m = req.messages[i];
    if (m.role === "tool") {
      msgs.push({
        role: "tool",
        tool_call_id: m.toolCallId,
        content: m.content,
      });
    } else if (m.toolCalls !== null && m.toolCalls.length > 0) {
      const calls: OutboundToolCall[] = [];
      for (let j = 0; j < m.toolCalls.length; j++) {
        const tc = m.toolCalls[j];
        calls.push({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.argsJson },
        });
      }
      msgs.push({ role: "assistant", content: m.content, tool_calls: calls });
    } else {
      msgs.push({ role: m.role, content: m.content });
    }
  }
  const tools: unknown[] = [];
  for (let i = 0; i < req.tools.length; i++) {
    const t = req.tools[i];
    tools.push({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: JSON.parse(t.parametersJson),
      },
    });
  }
  const body: Record<string, unknown> = {
    model: req.model,
    messages: msgs,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (tools.length > 0) {
    body.tools = tools;
  }
  return JSON.stringify(body);
}

export class OpenAIProvider implements Provider {
  cfg: OpenAIConfig;
  net: HostNet;

  constructor(cfg: OpenAIConfig, net: HostNet) {
    this.cfg = cfg;
    this.net = net;
  }

  async stream(req: ProviderRequest, onText: (chunk: string) => void): Promise<StreamResult> {
    const parser = newSseParser();
    const accs: ToolAcc[] = [];
    let text = "";
    let finishReason = "";
    const usage: Usage = { promptTokens: 0, completionTokens: 0 };
    let streamError = "";

    const res = await this.net.request(
      {
        method: "POST",
        url: this.cfg.baseUrl + "/chat/completions",
        headers: [
          { name: "authorization", value: "Bearer " + this.cfg.apiKey },
          { name: "content-type", value: "application/json" },
          { name: "accept", value: "text/event-stream" },
        ],
        body: buildBody(req),
      },
      (chunk: string) => {
        const events = sseFeed(parser, chunk);
        for (let i = 0; i < events.length; i++) {
          const data = events[i];
          if (data === "[DONE]") {
            continue;
          }
          let parsed: OpenAIChunk;
          try {
            parsed = JSON.parse(data) as OpenAIChunk;
          } catch (e) {
            streamError = "sse parse error: " + String(e) + " <" + data.slice(0, 60) + ">";
            continue;
          }
          const u = parsed.usage;
          if (u !== null && u !== undefined) {
            usage.promptTokens = u.prompt_tokens;
            usage.completionTokens = u.completion_tokens;
          }
          if (parsed.choices === null || parsed.choices === undefined) {
            continue;
          }
          for (let c = 0; c < parsed.choices.length; c++) {
            const choice = parsed.choices[c];
            const fr = choice.finish_reason;
            if (fr !== null && fr !== undefined) {
              finishReason = fr;
            }
            const d = choice.delta;
            if (d === null || d === undefined) {
              continue;
            }
            if (d.content !== null && d.content !== undefined && d.content !== "") {
              text = text + d.content;
              onText(d.content);
            }
            const tcs = d.tool_calls;
            if (tcs === null || tcs === undefined) {
              continue;
            }
            for (let k = 0; k < tcs.length; k++) {
              const td = tcs[k];
              let acc = findAcc(accs, td.index);
              if (acc === null) {
                acc = { index: td.index, id: "", name: "", args: "" };
                accs.push(acc);
              }
              if (td.id !== null && td.id !== undefined) {
                acc.id = td.id;
              }
              const f = td.function;
              if (f !== null && f !== undefined) {
                if (f.name !== null && f.name !== undefined) {
                  acc.name = acc.name + f.name;
                }
                if (f.arguments !== null && f.arguments !== undefined) {
                  acc.args = acc.args + f.arguments;
                }
              }
            }
          }
        }
      },
    );

    if (res.status < 200 || res.status >= 300) {
      throw new Error("provider http " + res.status + ": " + res.body.slice(0, 400));
    }
    if (streamError !== "") {
      throw new Error(streamError);
    }
    const toolCalls: ToolCall[] = [];
    for (let i = 0; i < accs.length; i++) {
      toolCalls.push({ id: accs[i].id, name: accs[i].name, argsJson: accs[i].args });
    }
    return {
      text: text,
      toolCalls: toolCalls,
      usage: usage,
      finishReason: finishReason,
    };
  }
}
