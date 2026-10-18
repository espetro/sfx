// Host ports: every OS capability the agent harness touches, as
// Promise-returning interfaces. `core/` never imports node: or a concrete
// adapter; `native/` and the future `browser/` provide the only impls.
// Async-first is the browser-compat reservation (OPFS/IDB are async-only).

export interface HostFS {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  appendFile(path: string, content: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface ExecOptions {
  cwd: string | null;
  timeoutMs: number | null;
}

export interface HostExec {
  // argv-array spawn only. scriptc refuses `exec`/`shell:true`; shell
  // semantics go through exec("/bin/sh", ["-c", cmd]).
  exec(argv: string[], opts: ExecOptions): Promise<ExecResult>;
}

export interface Header {
  name: string;
  value: string;
}

export interface NetRequestOptions {
  method: string;
  url: string;
  headers: Header[];
  body: string | null;
}

export interface NetResponse {
  status: number;
  body: string;
}

export interface HostNet {
  // onChunk is a separate parameter, never a record member: function values
  // inside records are outside the scriptc subset. It fires per response
  // body chunk (SSE streaming); scriptc has no ReadableStream.
  request(opts: NetRequestOptions, onChunk: ((chunk: string) => void) | null): Promise<NetResponse>;
}

export interface HostIO {
  readStdin(): Promise<string>;
  writeOut(text: string): void;
  writeErr(text: string): void;
  isTTY(): boolean;
}

export interface HostEnv {
  get(key: string): string | null;
}

export interface Hosts {
  fs: HostFS;
  exec: HostExec;
  net: HostNet;
  io: HostIO;
  env: HostEnv;
}
