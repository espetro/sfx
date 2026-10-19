// sfx — simple fx. `sfx ask` one-shot agent call; sessions under ~/.sfx.
// Scriptc entry point: `scriptc build src/native/cli.ts`.

/// <reference path="../../shims.d.ts" />

import { Database } from "@cutils/sqlite/elf";
import { homedir } from "node:os";
import { nativeHosts } from "./host.ts";
import { OpenAIProvider } from "../core/provider/openai.ts";
import { defaultTools } from "../core/tools.ts";
import { JsonlSessionStore } from "../core/session.ts";
import type { SessionStore } from "../core/session.ts";
import { SqliteSessionStore } from "./sqlite-session.ts";
import { runAgent } from "../core/agent.ts";
import type { ChatMessage } from "../core/messages.ts";
import type { Hosts } from "../core/ports.ts";

const VERSION = "0.1.0";

const HELP =
  "sfx " +
  VERSION +
  " — simple fx agent harness\n" +
  "\n" +
  "usage:\n" +
  "  sfx ask [--json] [--model M] [--base-url U] [--max-steps N] [--system S]\n" +
  "          [--store jsonl|sqlite] [--resume ID] [--fork] [prompt...]\n" +
  "  sfx sessions list [--store jsonl|sqlite]\n" +
  "  sfx --help\n" +
  "\n" +
  "prompt reads from argv, else stdin. --resume continues session ID; --fork\n" +
  "with --resume branches it into a new id, leaving the original untouched.\n" +
  "env: SFX_BASE_URL (or OPENAI_BASE_URL), SFX_API_KEY (or OPENAI_API_KEY),\n" +
  "SFX_MODEL (or OPENAI_MODEL), SFX_STORE (jsonl default; sqlite keeps\n" +
  "~/.sfx/sessions.db), SFX_COMPACT_TOKENS (default 100000).\n";

interface CliArgs {
  command: string;
  json: boolean;
  model: string | null;
  baseUrl: string | null;
  maxSteps: number;
  system: string | null;
  store: string | null;
  resume: string | null;
  fork: boolean;
  prompt: string[];
}

function parseArgs(args: string[]): CliArgs {
  const out: CliArgs = {
    command: "",
    json: false,
    model: null,
    baseUrl: null,
    maxSteps: 16,
    system: null,
    store: null,
    resume: null,
    fork: false,
    prompt: [],
  };
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === "--json") {
      out.json = true;
    } else if (a === "--model") {
      i++;
      out.model = i < args.length ? args[i] : null;
    } else if (a === "--base-url") {
      i++;
      out.baseUrl = i < args.length ? args[i] : null;
    } else if (a === "--max-steps") {
      i++;
      out.maxSteps = i < args.length ? parseInt(args[i], 10) : 16;
    } else if (a === "--system") {
      i++;
      out.system = i < args.length ? args[i] : null;
    } else if (a === "--store") {
      i++;
      out.store = i < args.length ? args[i] : null;
    } else if (a === "--resume") {
      i++;
      out.resume = i < args.length ? args[i] : null;
    } else if (a === "--fork") {
      out.fork = true;
    } else if (out.command === "" && !a.startsWith("--")) {
      out.command = a;
    } else {
      out.prompt.push(a);
    }
    i++;
  }
  return out;
}

function envOr(hosts: Hosts, a: string, b: string): string | null {
  const va = hosts.env.get(a);
  if (va !== null) {
    return va;
  }
  return hosts.env.get(b);
}

const DEFAULT_SYSTEM =
  "You are sfx, a minimal coding agent. Answer briefly. Use tools when they help.";

const DEFAULT_COMPACT_TOKENS = 100000;
const COMPACT_KEEP = 8;

function envInt(hosts: Hosts, key: string, fallback: number): number {
  const v = hosts.env.get(key);
  if (v === null) {
    return fallback;
  }
  const n = parseInt(v, 10);
  if (isNaN(n)) {
    return fallback;
  }
  return n;
}

async function makeStore(hosts: Hosts, storeKind: string | null): Promise<SessionStore> {
  const homeRaw = envOr(hosts, "SFX_HOME", "HOME");
  const home = homeRaw !== null ? homeRaw : homedir();
  if (storeKind !== null && storeKind === "sqlite") {
    if (!(await hosts.fs.exists(home + "/.sfx"))) {
      await hosts.fs.mkdir(home + "/.sfx");
    }
    return new SqliteSessionStore(Database.open(home + "/.sfx/sessions.db"), home + "/.sfx");
  }
  return new JsonlSessionStore(hosts.fs, home + "/.sfx");
}

function preview(text: string | null): string {
  if (text === null) {
    return "";
  }
  const one = text.split("\n").join(" ");
  if (one.length <= 60) {
    return one;
  }
  return one.slice(0, 60) + "…";
}

async function listSessions(hosts: Hosts, store: SessionStore): Promise<number> {
  const ids = await store.list();
  for (let i = 0; i < ids.length; i++) {
    let count = 0;
    let first = "";
    try {
      const messages = await store.load(ids[i]);
      count = messages.length;
      for (let j = 0; j < messages.length; j++) {
        if (messages[j].role === "user") {
          first = preview(messages[j].content);
          break;
        }
      }
    } catch {
      first = "(unreadable)";
    }
    hosts.io.writeOut(ids[i] + "\t" + count + "\t" + first + "\n");
  }
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "--help" || args.command === "-h" || args.command === "help") {
    console.log(HELP);
    return 0;
  }
  if (args.command === "--version" || args.command === "-v" || args.command === "version") {
    console.log(VERSION);
    return 0;
  }

  const hosts = nativeHosts();

  if (args.command === "sessions" || args.command === "list") {
    const sub = args.prompt.length > 0 ? args.prompt[0] : "list";
    if (sub !== "list") {
      console.error("unknown sessions command: " + sub + "\n\n" + HELP);
      return 2;
    }
    const storeKind = args.store !== null ? args.store : envOr(hosts, "SFX_STORE", "SFX_STORE");
    return await listSessions(hosts, await makeStore(hosts, storeKind));
  }

  if (args.command !== "ask") {
    console.error(args.command === "" ? HELP : "unknown command: " + args.command + "\n\n" + HELP);
    return 2;
  }

  let baseUrl = args.baseUrl;
  if (baseUrl === null) {
    const e = envOr(hosts, "SFX_BASE_URL", "OPENAI_BASE_URL");
    baseUrl = e !== null ? e : "https://api.openai.com/v1";
  }
  const apiKey = envOr(hosts, "SFX_API_KEY", "OPENAI_API_KEY");
  const model = args.model !== null ? args.model : envOr(hosts, "SFX_MODEL", "OPENAI_MODEL");
  if (apiKey === null) {
    console.error("error: SFX_API_KEY (or OPENAI_API_KEY) not set");
    return 2;
  }
  if (model === null) {
    console.error("error: pass --model or set SFX_MODEL");
    return 2;
  }

  let prompt = args.prompt.join(" ");
  if (prompt === "") {
    prompt = await hosts.io.readStdin();
  }
  if (prompt.trim() === "") {
    console.error("error: empty prompt (argv or stdin)");
    return 2;
  }

  const provider = new OpenAIProvider({ baseUrl: baseUrl, apiKey: apiKey }, hosts.net);
  const tools = defaultTools();
  const storeKind = args.store !== null ? args.store : envOr(hosts, "SFX_STORE", "SFX_STORE");
  const store = await makeStore(hosts, storeKind);

  // --resume loads prior messages; --fork branches them onto a fresh id so
  // the original session file is never appended to.
  let prior: ChatMessage[] = [];
  let sessionId = store.newId();
  if (args.resume !== null) {
    prior = await store.load(args.resume);
    if (!args.fork) {
      sessionId = args.resume;
    }
  }
  const system = args.system !== null ? args.system : DEFAULT_SYSTEM;
  const t0 = Date.now();
  const result = await runAgent(
    hosts,
    {
      provider: provider,
      model: model,
      system: system,
      tools: tools,
      maxSteps: args.maxSteps,
      streamText: !args.json,
      compactTokens: envInt(hosts, "SFX_COMPACT_TOKENS", DEFAULT_COMPACT_TOKENS),
      compactKeep: envInt(hosts, "SFX_COMPACT_KEEP", COMPACT_KEEP),
    },
    prompt,
    prior,
    (chunk: string) => {
      hosts.io.writeOut(chunk);
    },
  );

  // Whole-session save covers every case: fresh asks, forks copying their
  // inherited history, and resumed runs where compaction rewrote messages
  // that were already persisted.
  await store.save(sessionId, result.messages);

  if (args.json) {
    const out = {
      text: result.text,
      session: sessionId,
      steps: result.steps,
      toolCalls: result.toolCalls,
      usage: result.usage,
      durationMs: Date.now() - t0,
    };
    console.log(JSON.stringify(out));
  } else {
    hosts.io.writeOut("\n");
  }
  return 0;
}

try {
  const code = await main();
  process.exit(code);
} catch (e) {
  console.error("fatal: " + String(e));
  process.exit(1);
}
