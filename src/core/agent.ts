// The agent loop: messages -> provider stream -> tool calls -> repeat until
// the model stops calling tools or the step cap hits.

import type { Hosts } from "./ports.ts";
import type { ChatMessage, Tool, ToolCall, ToolSpec, Usage } from "./messages.ts";
import { mkAssistantCall, mkMessage, mkToolResult } from "./messages.ts";
import type { Provider, StreamResult } from "./provider/openai.ts";
import { findTool } from "./tools.ts";

export interface AgentConfig {
  provider: Provider;
  model: string;
  system: string;
  tools: Tool[];
  maxSteps: number;
  streamText: boolean;
  // Context compaction: when the running message list's estimated tokens
  // (chars/4) exceeds this, the oldest messages collapse into one summary
  // user-message via an extra provider call. 0 disables.
  compactTokens: number;
  // How many recent messages survive compaction. The boundary walks forward
  // so an assistant tool_call and its tool results are never split.
  compactKeep: number;
}

export interface AskResult {
  text: string;
  usage: Usage;
  steps: number;
  toolCalls: number;
  messages: ChatMessage[];
}

function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.content !== null) {
      chars += m.content.length;
    }
    if (m.toolCalls !== null) {
      for (let j = 0; j < m.toolCalls.length; j++) {
        chars += m.toolCalls[j].argsJson.length;
      }
    }
  }
  return Math.floor(chars / 4);
}

function transcript(messages: ChatMessage[], lo: number, hi: number): string {
  let text = "";
  for (let i = lo; i < hi; i++) {
    const m = messages[i];
    text += m.role + ": ";
    if (m.content !== null) {
      text += m.content;
    }
    if (m.toolCalls !== null) {
      for (let j = 0; j < m.toolCalls.length; j++) {
        const tc = m.toolCalls[j];
        text += "[call " + tc.name + " " + tc.argsJson + "]";
      }
    }
    text += "\n";
  }
  return text;
}

async function compactIfNeeded(cfg: AgentConfig, messages: ChatMessage[]): Promise<void> {
  if (cfg.compactTokens <= 0) {
    return;
  }
  if (estimateTokens(messages) < cfg.compactTokens) {
    return;
  }
  // Index 0 is the system prompt — always kept. The preserved tail must not
  // start on a tool result: that would orphan it from its assistant call.
  let cut = messages.length - cfg.compactKeep;
  if (cut <= 1) {
    return;
  }
  while (cut < messages.length && messages[cut].role === "tool") {
    cut++;
  }
  if (cut <= 1 || messages.length - cut < 2) {
    return;
  }
  const res: StreamResult = await cfg.provider.stream(
    {
      model: cfg.model,
      messages: [
        mkMessage(
          "user",
          "Summarize this conversation so far in a few sentences, keeping every fact " +
            "needed to continue it:\n\n" +
            transcript(messages, 1, cut),
        ),
      ],
      tools: [],
    },
    (_s: string) => {},
  );
  if (res.text === "") {
    return;
  }
  messages.splice(1, cut - 1, mkMessage("user", "[conversation summary] " + res.text));
}

export async function runAgent(
  hosts: Hosts,
  cfg: AgentConfig,
  prompt: string,
  prior: ChatMessage[],
  onText: (chunk: string) => void,
): Promise<AskResult> {
  const messages: ChatMessage[] = prior;
  if (messages.length === 0) {
    messages.push(mkMessage("system", cfg.system));
  }
  messages.push(mkMessage("user", prompt));

  let totalUsage: Usage = { promptTokens: 0, completionTokens: 0 };
  let toolCallCount = 0;
  let lastText = "";
  let steps = 0;

  for (steps = 0; steps < cfg.maxSteps; steps++) {
    await compactIfNeeded(cfg, messages);
    const specs: ToolSpec[] = [];
    for (let i = 0; i < cfg.tools.length; i++) {
      specs.push(cfg.tools[i].spec());
    }
    const sink = cfg.streamText ? onText : (_s: string) => {};
    const res: StreamResult = await cfg.provider.stream(
      { model: cfg.model, messages: messages, tools: specs },
      sink,
    );
    totalUsage = {
      promptTokens: totalUsage.promptTokens + res.usage.promptTokens,
      completionTokens: totalUsage.completionTokens + res.usage.completionTokens,
    };
    if (res.text !== "") {
      lastText = res.text;
    }

    if (res.toolCalls.length === 0) {
      if (res.text !== "") {
        messages.push(mkMessage("assistant", res.text));
      }
      break;
    }

    messages.push(mkAssistantCall(res.text === "" ? null : res.text, res.toolCalls));
    for (let i = 0; i < res.toolCalls.length; i++) {
      const tc: ToolCall = res.toolCalls[i];
      toolCallCount++;
      const tool = findTool(cfg.tools, tc.name);
      let result = "";
      if (tool === null) {
        result = "error: unknown tool " + tc.name;
      } else {
        let args: unknown = null;
        try {
          args = JSON.parse(tc.argsJson);
        } catch {
          result = "error: malformed tool arguments";
        }
        if (result === "") {
          try {
            result = await tool.run(args, hosts);
          } catch {
            result = "error: tool " + tc.name + " threw";
          }
        }
      }
      messages.push(mkToolResult(tc.id, result));
    }
  }

  return {
    text: lastText,
    usage: totalUsage,
    steps: steps,
    toolCalls: toolCallCount,
    messages: messages,
  };
}
