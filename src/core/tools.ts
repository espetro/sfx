// Built-in tools: bash, read_file, write_file, edit_file. grep/glob come
// free through bash on native; a browser-mode bash is a JS worker sandbox.

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

function strField(args: unknown, key: string): string {
  const rec = args as Record<string, unknown>;
  const v = rec[key];
  if (typeof v === "string") {
    return v;
  }
  return "";
}

export class BashTool implements Tool {
  spec(): ToolSpec {
    return {
      name: "bash",
      description: "Run a shell command and return combined output",
      parametersJson:
        '{"type":"object","properties":{"command":{"type":"string"}},"required":["command"],"additionalProperties":false}',
    };
  }

  async run(args: unknown, hosts: Hosts): Promise<string> {
    const command = strField(args, "command");
    if (command === "") {
      return "error: missing command";
    }
    const opts: ExecOptions = { cwd: null, timeoutMs: 120000 };
    // scriptc refuses `exec`/`shell:true`; the shell binary is the escape hatch.
    const r = await hosts.exec.exec(["/bin/sh", "-c", command], opts);
    let out = r.stdout;
    if (r.stderr !== "") {
      out = out + (out === "" ? "" : "\n") + r.stderr;
    }
    if (r.code !== 0) {
      out = out + "\n[exit " + r.code + "]";
    }
    return cap(out);
  }
}

export class ReadFileTool implements Tool {
  spec(): ToolSpec {
    return {
      name: "read_file",
      description: "Read a text file and return its contents",
      parametersJson:
        '{"type":"object","properties":{"path":{"type":"string"}},"required":["path"],"additionalProperties":false}',
    };
  }

  async run(args: unknown, hosts: Hosts): Promise<string> {
    const path = strField(args, "path");
    if (path === "") {
      return "error: missing path";
    }
    try {
      const content = await hosts.fs.readFile(path);
      return cap(content);
    } catch {
      return "error: cannot read " + path;
    }
  }
}

export class WriteFileTool implements Tool {
  spec(): ToolSpec {
    return {
      name: "write_file",
      description: "Write a text file, replacing any existing content",
      parametersJson:
        '{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"],"additionalProperties":false}',
    };
  }

  async run(args: unknown, hosts: Hosts): Promise<string> {
    const path = strField(args, "path");
    if (path === "") {
      return "error: missing path";
    }
    try {
      await hosts.fs.writeFile(path, strField(args, "content"));
      return "wrote " + path;
    } catch {
      return "error: cannot write " + path;
    }
  }
}

export class EditFileTool implements Tool {
  spec(): ToolSpec {
    return {
      name: "edit_file",
      description: "Replace an exact string in a file; fails unless it appears exactly once",
      parametersJson:
        '{"type":"object","properties":{"path":{"type":"string"},"old":{"type":"string"},"new":{"type":"string"}},"required":["path","old","new"],"additionalProperties":false}',
    };
  }

  async run(args: unknown, hosts: Hosts): Promise<string> {
    const path = strField(args, "path");
    const oldStr = strField(args, "old");
    const newStr = strField(args, "new");
    if (path === "" || oldStr === "") {
      return "error: missing path or old";
    }
    let content = "";
    try {
      content = await hosts.fs.readFile(path);
    } catch {
      return "error: cannot read " + path;
    }
    const first = content.indexOf(oldStr);
    if (first < 0) {
      return "error: old string not found in " + path;
    }
    const second = content.indexOf(oldStr, first + oldStr.length);
    if (second >= 0) {
      return "error: old string is not unique in " + path;
    }
    const next = content.slice(0, first) + newStr + content.slice(first + oldStr.length);
    try {
      await hosts.fs.writeFile(path, next);
      return "edited " + path;
    } catch {
      return "error: cannot write " + path;
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
