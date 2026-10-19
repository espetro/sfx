# sfx

**Simple fx** — a minimal coding-agent harness shipped as a single native
binary. Authored in the [scriptc](https://github.com/sigilco/scriptc)
TypeScript subset, compiled to an ELF: no runtime, no VM, a couple of MB.
Inspired by [fx](https://github.com/vercel-labs/fx)'s design — minimal system
prompt, a handful of tools, Unix-scrollback output, `ask --json`.

## What it does

- `sfx ask` — one-shot agent call: bash, read, write, and edit tools,
  streamed over any OpenAI-compatible Chat Completions endpoint
- `--json` for scripts and CI; prompt from argv or stdin
- Sessions under `~/.sfx/` — JSONL by default, sqlite behind `--store sqlite`
- Tool args validated with [`@chttp/val`](https://github.com/sigilco/chttp) —
  the same schema feeds `parametersJson` and gates every `run()`
- Session storage on [`@cutils/sqlite`](https://github.com/sigilco/cutils) —
  real sqlite inside the ELF, no external dependency

## Install it

Grab a binary from [Releases](https://github.com/espetro/sfx/releases):

```console
# linux
$ curl -LO https://github.com/espetro/sfx/releases/latest/download/sfx-linux-x86_64
# macOS (arm64)
$ curl -LO https://github.com/espetro/sfx/releases/latest/download/sfx-darwin-arm64
$ chmod +x sfx-* && sudo mv sfx-* /usr/local/bin/sfx
```

Windows: `sfx-windows-x86_64.exe` on the same page.

Build from source instead (Linux native binary):

```console
$ pnpm install && pnpm elf   # writes dist/sfx
$ pnpm test                  # node tests + ELF smoke + coverage gate
```

## Try it

```console
$ export SFX_BASE_URL=https://api.openai.com/v1 SFX_API_KEY=... SFX_MODEL=gpt-4.1-mini
$ sfx ask "what's in this directory"
$ echo "list .ts files" | sfx ask --json | jq -r .text
$ sfx ask --store sqlite "remember this session"
```

`--json` prints one object: `{text, session, steps, toolCalls, usage, durationMs}`.
Point `SFX_BASE_URL` at Ollama, OpenRouter, or any OpenAI-compatible endpoint.

## Stack

| | |
|---|---|
| language | TypeScript (scriptc-compilable subset) |
| linux build | `scriptc build` → native ELF + sqlite FFI |
| macOS/Windows | `bun build --compile` over the same sources |
| tools | bash, read_file, write_file, edit_file |
| validation | `@chttp/val` |
| sessions | JSONL, or `@cutils/sqlite` (linux build only) |

## Status

Experimental — see the plan's PR sequence in `AGENTS.md` conventions: resume,
permissions, skills, MCP, and `sfx serve` are on the roadmap.
[MIT](LICENSE) · bugs & ideas →
[issues](https://github.com/espetro/sfx/issues)
