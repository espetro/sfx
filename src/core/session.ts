// JSONL session store over HostFS. One file per session under
// <root>/sessions/<id>.jsonl; each line is one ChatMessage JSON.

import type { HostFS } from "./ports.ts";
import type { ChatMessage } from "./messages.ts";

export interface SessionStore {
  dir(): string;
  newId(): string;
  append(id: string, message: ChatMessage): Promise<void>;
  load(id: string): Promise<ChatMessage[]>;
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
}
