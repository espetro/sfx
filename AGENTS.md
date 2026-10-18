# sfx AGENTS.md

sfx ("simple fx") is a minimal agent harness authored in the scriptc-compilable
subset and shipped as a native ELF. Design: minimal system prompt, four tools,
Unix-scrollback output, `ask --json`, sessions under `~/.sfx`.

## Commands

- `pnpm build` — tsc to `dist/` (subset code is valid TS and runs on plain Node)
- `pnpm test` — `node --test test/*.test.mjs` + `bash test/elf.test.sh`
- `pnpm gate` — `scriptc coverage gate.ts` must report 100% static
- `pnpm elf` — `scriptc build src/native/cli.ts -o dist/sfx`
- `pnpm lint` / `pnpm fmt` — oxlint / oxfmt

## Layout

- `src/core/` — scriptc subset AND zero `node:` imports AND async-ports-only.
  The browser-compat reservation lives here: every OS capability is a
  `Promise`-returning port in `core/ports.ts`.
- `src/native/` — the only tree that may import `node:*`: adapters + `cli.ts`
  (the `scriptc build` entry).
- `src/browser/` — deferred; plain TS adapters (OPFS, worker exec sandbox,
  fetch+ReadableStream) land here later and need no subset discipline.
- `test/fixtures/sse-server.mjs` — canned OpenAI SSE stub (fx 127.0.0.1
  pattern); provider tests never hit a real API.

## Scriptc subset rules (src/core + src/native)

- `| null` unions only. Never `undefined` (SC3004).
- No `Map`/`Set`/`Object.create(null)`/`Object.freeze`.
- Plain `({})` records with full shapes; **no function values inside records**
  (classes or parallel arrays instead).
- Indexed `for` / `for...of` over arrays only. Never `for...in`.
- No `?.` / `??`, no object/method shorthand in literals, no spread,
  no `eval`/`new Function`, no non-program `instanceof`.
- Concrete types on class fields; `unknown` only in params, returns, locals,
  and plain-record members.
- Non-generic classes only (generic classes lower to methodless instances on
  scriptc 0.3.x). No `A | B` unions of classes or records — `T | null` only.
- `await (x as Promise<unknown>)` on erased/unknown slots; no `instanceof
  Promise`, no `.then` value reads, no `Promise.resolve(nonPromise)`.
- Named `node:` imports only (no default).
- `child_process.execFile`/`spawn` argv-array only — `exec`/`shell:true` are
  refused; shell semantics go through `execFile("/bin/sh", ["-c", cmd])`.
- SSE strictly via `http.request`/`https.request` chunk callbacks —
  `fetch` has no ReadableStream under scriptc, and
  `Request`/`Response`/`EventSource`/`AbortController` are not implemented.
- `as unknown as` is SC1090 — single-level casts only.
- Avoid literal `undefined` as a value; read missing object fields into a
  const and check `=== null`/`=== undefined` as comparisons only.

## Conventions

- Any behavior change ships with a `node --test` and an ELF-lane assertion.
- `scriptc coverage gate.ts` at 100% is required to merge.
- Provider tests always use `test/fixtures/sse-server.mjs`, never live APIs.
- Commits: conventional, atomic.
