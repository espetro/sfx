// sfx — simple fx. `sfx ask` one-shot agent call; sessions under ~/.sfx.
// Scriptc entry point: `scriptc build src/native/cli.ts`.

import { homedir } from "node:os";
import { nativeHosts } from "./host.ts";
import { OpenAIProvider } from "../core/provider/openai.ts";
import { defaultTools } from "../core/tools.ts";
import { JsonlSessionStore } from "../core/session.ts";
import { runAgent } from "../core/agent.ts";
import type { Hosts } from "../core/ports.ts";

const VERSION = "0.1.0";

const HELP =
  "sfx " +
  VERSION +
  " — simple fx agent harness\n" +
  "\n" +
  "usage:\n" +
  "  sfx ask [--json] [--model M] [--base-url U] [--max-steps N] [--system S] [prompt...]\n" +
  "  sfx --help\n" +
  "\n" +
  "prompt reads from argv, else stdin. env: SFX_BASE_URL (or OPENAI_BASE_URL),\n" +
  "SFX_API_KEY (or OPENAI_API_KEY), SFX_MODEL (or OPENAI_MODEL).\n";

interface CliArgs {
  command: string;
  json: boolean;
  model: string | null;
  baseUrl: string | null;
  maxSteps: number;
  system: string | null;
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
  if (args.command !== "ask") {
    console.error(args.command === "" ? HELP : "unknown command: " + args.command + "\n\n" + HELP);
    return 2;
  }

  const hosts = nativeHosts();

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
  const homeRaw = envOr(hosts, "SFX_HOME", "HOME");
  const home = homeRaw !== null ? homeRaw : homedir();
  const store = new JsonlSessionStore(hosts.fs, home + "/.sfx");
  const sessionId = store.newId();

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
    },
    prompt,
    (chunk: string) => {
      hosts.io.writeOut(chunk);
    },
  );

  for (let i = 0; i < result.messages.length; i++) {
    await store.append(sessionId, result.messages[i]);
  }

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
