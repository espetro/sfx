// Shared records. Full shapes only: every field is present, `| null` is the
// only allowed union arm (scriptc subset).

import type { Hosts } from "./ports.ts";

export interface ToolCall {
  id: string;
  name: string;
  // Raw JSON arguments as streamed by the provider; tools parse it.
  argsJson: string;
}

export interface ChatMessage {
  role: string; // "system" | "user" | "assistant" | "tool"
  content: string | null;
  toolCalls: ToolCall[] | null;
  toolCallId: string | null;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

export interface ToolSpec {
  name: string;
  description: string;
  // JSON Schema as a pre-serialized string; embedded verbatim in requests.
  parametersJson: string;
}

// Function values inside records are banned in the subset, so Tool is a
// class-side interface implemented by concrete (non-generic) tool classes.
export interface Tool {
  spec(): ToolSpec;
  run(args: unknown, hosts: Hosts): Promise<string>;
}

export function mkMessage(role: string, content: string | null): ChatMessage {
  return {
    role: role,
    content: content,
    toolCalls: null,
    toolCallId: null,
  };
}

export function mkToolResult(callId: string, content: string): ChatMessage {
  return {
    role: "tool",
    content: content,
    toolCalls: null,
    toolCallId: callId,
  };
}

export function mkAssistantCall(content: string | null, calls: ToolCall[]): ChatMessage {
  return {
    role: "assistant",
    content: content,
    toolCalls: calls,
    toolCallId: null,
  };
}
