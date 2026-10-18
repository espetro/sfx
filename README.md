# sfx

**Simple fx** — a minimal agent harness compiled to a single native ELF via
[scriptc](https://github.com/sigilco/scriptc). No runtime, no VM: one binary,
a few MB, millisecond cold start.

## What it does

- `sfx ask` — one-shot agent call with bash/read/write/edit tools, streamed
  over an OpenAI-compatible SSE endpoint
- `--json` output for scripts and CI; prompt from argv or stdin
- JSONL sessions under `~/.sfx/sessions/`
- Same source compiles for Node (`pnpm build`) and ELF (`pnpm elf`)

## Try it

```console
$ export SFX_BASE_URL=https://api.openai.com/v1 SFX_API_KEY=... SFX_MODEL=gpt-4.1-mini
$ sfx ask "what's in this directory"
$ echo "list .ts files" | sfx ask --json
```

## Build it

```console
$ pnpm install && pnpm elf   # writes dist/sfx
$ pnpm test                  # node tests + ELF smoke + coverage gate
```

## Stack

| | |
|---|---|
| language | TypeScript (scriptc-compilable subset) |
| compiler | scriptc >= 0.3.4 |
| transport | `node:http`/`https` chunked SSE |
| tools | bash, read_file, write_file, edit_file |

## Status

v0: `ask` + JSONL sessions + OpenAI-compatible provider. On the plan, not yet
landed: resume/fork, Anthropic provider, permissions, skills, MCP, serve mode
(`@chttp/router`), interactive REPL, and the experimental browser build behind
the same ports.
