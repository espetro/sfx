// Built-in tools: bash, read_file, write_file, edit_file. grep/glob come
// free through bash on native; a browser-mode bash is a JS worker sandbox.
// Arg validation: @chttp/val — each tool's `parametersJson` is derived from
// its schema (toJsonSchema), and run() rejects bad args through safeParse.

import { object, safeParse, string, summarize, toJsonSchema } from "@chttp/val";
import type { VSchema } from "@chttp/val";
import type { ExecOptions, Hosts } from "./ports.ts";
import type { Tool, ToolSpec } from "./messages.ts";

const MAX_TOOL_RESULT_BYTES = 64 * 1024;

function cap(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_BYTES) {
    return text;
  }
  return (
    text.slice(0, MAX_TOOL_RESULT_BYTES) + "\n[truncated at " + MAX_TOOL_RESULT_BYTES + " bytes]"
  );
}

interface BashArgs {
  command: string;
}

interface PathArgs {
  path: string;
}

interface WriteArgs {
  path: string;
  content: string;
}

interface EditArgs {
  path: string;
  old: string;
  new: string;
}

export class BashTool implements Tool {
  schema: VSchema = object({ command: string() });

  spec(): ToolSpec {
    return {
      name: "bash",
      description: "Run a shell command and return combined output",
      parametersJson: JSON.stringify(toJsonSchema(this.schema)),
    };
  }

  async run(args: unknown, hosts: Hosts): Promise<string> {
    const r = safeParse(this.schema, args);
    if (!r.success) {
      return "error: invalid args: " + summarize(r.issues === null ? [] : r.issues);
    }
    const a = r.output as BashArgs;
    if (a.command === "") {
      return "error: missing command";
    }
    const opts: ExecOptions = { cwd: null, timeoutMs: 120000 };
    // scriptc refuses `exec`/`shell:true`; the shell binary is the escape hatch.
    const res = await hosts.exec.exec(["/bin/sh", "-c", a.command], opts);
    let out = res.stdout;
    if (res.stderr !== "") {
      out = out + (out === "" ? "" : "\n") + res.stderr;
    }
    if (res.code !== 0) {
      out = out + "\n[exit " + res.code + "]";
    }
    return cap(out);
  }
}

export class ReadFileTool implements Tool {
  schema: VSchema = object({ path: string() });

  spec(): ToolSpec {
    return {
      name: "read_file",
      description: "Read a text file and return its contents",
      parametersJson: JSON.stringify(toJsonSchema(this.schema)),
    };
  }

  async run(args: unknown, hosts: Hosts): Promise<string> {
    const r = safeParse(this.schema, args);
    if (!r.success) {
      return "error: invalid args: " + summarize(r.issues === null ? [] : r.issues);
    }
    const a = r.output as PathArgs;
    if (a.path === "") {
      return "error: missing path";
    }
    try {
      const content = await hosts.fs.readFile(a.path);
      return cap(content);
    } catch {
      return "error: cannot read " + a.path;
    }
  }
}

export class WriteFileTool implements Tool {
  schema: VSchema = object({ path: string(), content: string() });

  spec(): ToolSpec {
    return {
      name: "write_file",
      description: "Write a text file, replacing any existing content",
      parametersJson: JSON.stringify(toJsonSchema(this.schema)),
    };
  }

  async run(args: unknown, hosts: Hosts): Promise<string> {
    const r = safeParse(this.schema, args);
    if (!r.success) {
      return "error: invalid args: " + summarize(r.issues === null ? [] : r.issues);
    }
    const a = r.output as WriteArgs;
    if (a.path === "") {
      return "error: missing path";
    }
    try {
      await hosts.fs.writeFile(a.path, a.content);
      return "wrote " + a.path;
    } catch {
      return "error: cannot write " + a.path;
    }
  }
}

export class EditFileTool implements Tool {
  schema: VSchema = object({ path: string(), old: string(), new: string() });

  spec(): ToolSpec {
    return {
      name: "edit_file",
      description: "Replace an exact string in a file; fails unless it appears exactly once",
      parametersJson: JSON.stringify(toJsonSchema(this.schema)),
    };
  }

  async run(args: unknown, hosts: Hosts): Promise<string> {
    const r = safeParse(this.schema, args);
    if (!r.success) {
      return "error: invalid args: " + summarize(r.issues === null ? [] : r.issues);
    }
    const a = r.output as EditArgs;
    if (a.path === "" || a.old === "") {
      return "error: missing path or old";
    }
    let content = "";
    try {
      content = await hosts.fs.readFile(a.path);
    } catch {
      return "error: cannot read " + a.path;
    }
    const first = content.indexOf(a.old);
    if (first < 0) {
      return "error: old string not found in " + a.path;
    }
    const second = content.indexOf(a.old, first + a.old.length);
    if (second >= 0) {
      return "error: old string is not unique in " + a.path;
    }
    const next = content.slice(0, first) + a.new + content.slice(first + a.old.length);
    try {
      await hosts.fs.writeFile(a.path, next);
      return "edited " + a.path;
    } catch {
      return "error: cannot write " + a.path;
    }
  }
}

// Registry: plain array of concrete tool instances (no generic classes,
// no function-valued record members — subset).
export function defaultTools(): Tool[] {
  const tools: Tool[] = [];
  tools.push(new BashTool());
  tools.push(new ReadFileTool());
  tools.push(new WriteFileTool());
  tools.push(new EditFileTool());
  return tools;
}

export function findTool(tools: Tool[], name: string): Tool | null {
  for (let i = 0; i < tools.length; i++) {
    if (tools[i].spec().name === name) {
      return tools[i];
    }
  }
  return null;
}
