// SessionStore over @cutils/sqlite — one sessions.db holding every session's
// messages; indexed resume/search vs the JSONL default. Native adapter: the
// ffi shim links statically into the ELF; under plain Node the same dist JS
// resolves its shim_* calls through globalThis (installed by
// @cutils/sqlite/node-binding via koffi — imported only by Node-side tests).

import { Database } from "@cutils/sqlite/elf";
import type { ChatMessage } from "../core/messages.ts";
import type { SessionStore } from "../core/session.ts";

interface PayloadRow {
  payload: string;
}

interface SessionRow {
  session: string;
}

export class SqliteSessionStore implements SessionStore {
  db: Database;
  root: string;

  constructor(db: Database, root: string) {
    this.db = db;
    this.root = root;
    this.db.execRaw(
      "CREATE TABLE IF NOT EXISTS messages (session TEXT NOT NULL, payload TEXT NOT NULL)",
    );
    this.db.execRaw("CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session)");
  }

  dir(): string {
    return this.root;
  }

  newId(): string {
    return "s" + Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36);
  }

  async append(id: string, message: ChatMessage): Promise<void> {
    const ins = this.db.prepareRaw("INSERT INTO messages (session, payload) VALUES (?, ?)");
    ins.runRaw([id, JSON.stringify(message)]);
    ins.finalize();
  }

  async save(id: string, messages: ChatMessage[]): Promise<void> {
    const del = this.db.prepareRaw("DELETE FROM messages WHERE session=?");
    del.runRaw([id]);
    del.finalize();
    for (let i = 0; i < messages.length; i++) {
      const ins = this.db.prepareRaw("INSERT INTO messages (session, payload) VALUES (?, ?)");
      ins.runRaw([id, JSON.stringify(messages[i])]);
      ins.finalize();
    }
  }

  async load(id: string): Promise<ChatMessage[]> {
    const sel = this.db.prepareRaw("SELECT payload FROM messages WHERE session=? ORDER BY rowid");
    const rows = sel.all([id]);
    sel.finalize();
    const out: ChatMessage[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as PayloadRow;
      out.push(JSON.parse(row.payload) as ChatMessage);
    }
    return out;
  }

  async list(): Promise<string[]> {
    const sel = this.db.prepareRaw(
      "SELECT session FROM messages GROUP BY session ORDER BY MAX(rowid) DESC",
    );
    const rows = sel.all([]);
    sel.finalize();
    const out: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as SessionRow;
      out.push(row.session);
    }
    return out;
  }
}
