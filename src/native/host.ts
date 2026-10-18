// Native (scriptc/Node) host adapters — the only tree allowed to import node:.

import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { execFile } from "node:child_process";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import type {
  ExecOptions,
  ExecResult,
  HostEnv,
  HostExec,
  HostFS,
  HostIO,
  HostNet,
  Hosts,
  NetRequestOptions,
  NetResponse,
} from "../core/ports.ts";

export class NodeFS implements HostFS {
  async readFile(path: string): Promise<string> {
    return readFileSync(path, "utf8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    writeFileSync(path, content);
  }

  async appendFile(path: string, content: string): Promise<void> {
    appendFileSync(path, content);
  }

  async readdir(path: string): Promise<string[]> {
    return readdirSync(path);
  }

  async mkdir(path: string): Promise<void> {
    mkdirSync(path, { recursive: true });
  }

  async exists(path: string): Promise<boolean> {
    return existsSync(path);
  }
}

export class NodeExec implements HostExec {
  exec(argv: string[], _opts: ExecOptions): Promise<ExecResult> {
    const file = argv[0];
    const args = argv.slice(1);
    return new Promise((resolve) => {
      execFile(
        file,
        args,
        // Only encoding + numeric maxBuffer lower in the callback form.
        { maxBuffer: 16 * 1024 * 1024, encoding: "utf8" },
        (error, out, err) => {
          let code = 0;
          if (error !== null && error !== undefined) {
            const c = error.code;
            code = typeof c === "number" ? c : 1;
          }
          resolve({
            stdout: typeof out === "string" ? out : "",
            stderr: typeof err === "string" ? err : "",
            code: code,
          });
        },
      );
    });
  }
}

interface ParsedUrl {
  isHttps: boolean;
  host: string;
  port: number;
  path: string;
}

// Manual split — URL exists in the subset only as partial; string ops are safe.
function parseHttpUrl(url: string): ParsedUrl {
  let rest = url;
  let isHttps = false;
  if (rest.startsWith("https://")) {
    isHttps = true;
    rest = rest.slice(8);
  } else if (rest.startsWith("http://")) {
    rest = rest.slice(7);
  }
  const slash = rest.indexOf("/");
  let hostPort = rest;
  let path = "/";
  if (slash >= 0) {
    hostPort = rest.slice(0, slash);
    path = rest.slice(slash);
  }
  const colon = hostPort.indexOf(":");
  let host = hostPort;
  let port = isHttps ? 443 : 80;
  if (colon >= 0) {
    host = hostPort.slice(0, colon);
    port = parseInt(hostPort.slice(colon + 1), 10);
  }
  return { isHttps: isHttps, host: host, port: port, path: path };
}

export class NodeNet implements HostNet {
  request(
    opts: NetRequestOptions,
    onChunk: ((chunk: string) => void) | null,
  ): Promise<NetResponse> {
    const u = parseHttpUrl(opts.url);
    const headers: Record<string, string> = {};
    for (let i = 0; i < opts.headers.length; i++) {
      headers[opts.headers[i].name] = opts.headers[i].value;
    }
    const dec = new TextDecoder();
    return new Promise((resolve, reject) => {
      const onRes = (res: IncomingMessage) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          const s = dec.decode(chunk);
          body = body + s;
          if (onChunk !== null) {
            onChunk(s);
          }
        });
        res.on("end", () => {
          const status = res.statusCode === undefined ? 0 : res.statusCode;
          resolve({ status: status, body: body });
        });
      };
      // Branch on scheme — a ternary over function bindings doesn't lower.
      // Options must be inline literals at each call site.
      let req: ClientRequest;
      if (u.isHttps) {
        req = httpsRequest(
          { host: u.host, port: u.port, path: u.path, method: opts.method, headers: headers },
          onRes,
        );
      } else {
        req = httpRequest(
          { host: u.host, port: u.port, path: u.path, method: opts.method, headers: headers },
          onRes,
        );
      }
      req.on("error", (e) => {
        reject(e);
      });
      if (opts.body !== null) {
        req.write(opts.body);
      }
      req.end();
    });
  }
}

export class NodeIO implements HostIO {
  async readStdin(): Promise<string> {
    // Proven under scriptc: /dev/stdin compiles and works for pipes/one-shot.
    try {
      return readFileSync("/dev/stdin", "utf8");
    } catch {
      return "";
    }
  }

  writeOut(text: string): void {
    process.stdout.write(text);
  }

  writeErr(text: string): void {
    process.stderr.write(text);
  }

  isTTY(): boolean {
    // process.stdin.isTTY is outside the scriptc surface; the readline
    // spike (REPL phase) revisits this.
    return false;
  }
}

export class NodeEnv implements HostEnv {
  get(key: string): string | null {
    const v = process.env[key];
    if (v === undefined) {
      return null;
    }
    return v;
  }
}

export function nativeHosts(): Hosts {
  return {
    fs: new NodeFS(),
    exec: new NodeExec(),
    net: new NodeNet(),
    io: new NodeIO(),
    env: new NodeEnv(),
  };
}
