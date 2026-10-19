// JSONL session store over HostFS. One file per session under
// <root>/sessions/<id>.jsonl; each line is one ChatMessage JSON.

import type { HostFS } from "./ports.ts";
import type { ChatMessage } from "./messages.ts";

export interface SessionStore {
  dir(): string;
  newId(): string;
  append(id: string, message: ChatMessage): Promise<void>;
  // Whole-session rewrite: compaction mutates already-persisted messages, so
  // resume/fork runs save the full list rather than appending a tail.
  save(id: string, messages: ChatMessage[]): Promise<void>;
  load(id: string): Promise<ChatMessage[]>;
  // Session ids, newest first (ids embed a base-36 ms timestamp prefix, so a
  // descending name sort is the order).
  list(): Promise<string[]>;
}

function nowId(): string {
  // collision-resistant enough for local sessions: ms + counter suffix
  return "s" + Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36);
}

export class JsonlSessionStore implements SessionStore {
  fs: HostFS;
  root: string;

  constructor(fs: HostFS, root: string) {
    this.fs = fs;
    this.root = root;
  }

  dir(): string {
    return this.root + "/sessions";
  }

  newId(): string {
    return nowId();
  }

  async append(id: string, message: ChatMessage): Promise<void> {
    const dir = this.dir();
    const has = await this.fs.exists(dir);
    if (!has) {
      await this.fs.mkdir(dir);
    }
    const line = JSON.stringify(message) + "\n";
    await this.fs.appendFile(dir + "/" + id + ".jsonl", line);
  }

  async save(id: string, messages: ChatMessage[]): Promise<void> {
    const dir = this.dir();
    const has = await this.fs.exists(dir);
    if (!has) {
      await this.fs.mkdir(dir);
    }
    let text = "";
    for (let i = 0; i < messages.length; i++) {
      text += JSON.stringify(messages[i]) + "\n";
    }
    await this.fs.writeFile(dir + "/" + id + ".jsonl", text);
  }

  async load(id: string): Promise<ChatMessage[]> {
    const path = this.dir() + "/" + id + ".jsonl";
    const text = await this.fs.readFile(path);
    const out: ChatMessage[] = [];
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === "") {
        continue;
      }
      out.push(JSON.parse(line) as ChatMessage);
    }
    return out;
  }

  async list(): Promise<string[]> {
    const dir = this.dir();
    const has = await this.fs.exists(dir);
    if (!has) {
      const empty: string[] = [];
      return empty;
    }
    const names: string[] = (await this.fs.readdir(dir)) as string[];
    const out: string[] = [];
    for (let i = 0; i < names.length; i++) {
      const n = names[i];
      if (n.endsWith(".jsonl")) {
        out.push(n.substring(0, n.length - 6));
      }
    }
    out.sort();
    out.reverse();
    return out;
  }
}
