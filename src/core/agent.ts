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
}

export interface AskResult {
  text: string;
  usage: Usage;
  steps: number;
  toolCalls: number;
  messages: ChatMessage[];
}

export async function runAgent(
  hosts: Hosts,
  cfg: AgentConfig,
  prompt: string,
  onText: (chunk: string) => void,
): Promise<AskResult> {
  const messages: ChatMessage[] = [];
  messages.push(mkMessage("system", cfg.system));
  messages.push(mkMessage("user", prompt));

  let totalUsage: Usage = { promptTokens: 0, completionTokens: 0 };
  let toolCallCount = 0;
  let lastText = "";
  let steps = 0;

  for (steps = 0; steps < cfg.maxSteps; steps++) {
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
