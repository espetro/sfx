#!/usr/bin/env bash
# Build the sfx ELF and run `ask --json` against the canned SSE stub; the
# tool_call round-trip (bash `echo hello-from-tool`) must land in the JSON.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

fail() {
  echo "elf-sfx-smoke FAIL: $*" >&2
  exit 1
}

BIN="scriptc"
if [ -x node_modules/.bin/scriptc ]; then
  BIN="node_modules/.bin/scriptc"
fi

node test/fixtures/sse-server.mjs 8391 >"$T/stub.log" 2>&1 &
STUB_PID=$!
trap 'kill "$STUB_PID" 2>/dev/null; rm -rf "$T"' EXIT
sleep 0.5
grep -q "sse-stub 8391" "$T/stub.log" || fail "stub did not start"

"$BIN" build src/native/cli.ts \
  --npm-static @cutils/sqlite \
  --ffi node_modules/@cutils/sqlite/ffi.json \
  -o "$T/sfx" >"$T/build.log" 2>&1 || {
  tail -30 "$T/build.log"
  fail "scriptc build"
}
echo "build OK"

out="$(
  SFX_HOME="$T/home" \
  SFX_BASE_URL="http://127.0.0.1:8391/v1" \
  SFX_API_KEY="test" \
  SFX_MODEL="stub-model" \
  "$T/sfx" ask --json "echo something"
)" || fail "elf ask"

printf '%s\n' "$out" | grep -q '"text":"final answer"' || fail "missing final answer: $out"
printf '%s\n' "$out" | grep -q '"toolCalls":1' || fail "missing toolCalls=1: $out"
printf '%s\n' "$out" | grep -q '"session":"s' || fail "missing session id: $out"

[ -f "$T/home/.sfx/sessions/"*.jsonl ] || fail "session file not written"
grep -q "hello-from-tool" "$T/home/.sfx/sessions/"*.jsonl || fail "tool result not in session log"

# --store sqlite: same loop, sessions.db backend.
out2="$(
  SFX_HOME="$T/home2" \
  SFX_BASE_URL="http://127.0.0.1:8391/v1" \
  SFX_API_KEY="test" \
  SFX_MODEL="stub-model" \
  "$T/sfx" ask --json --store sqlite "echo something"
)" || fail "elf ask --store sqlite"
printf '%s\n' "$out2" | grep -q '"text":"final answer"' || fail "sqlite store run: $out2"
[ -f "$T/home2/.sfx/sessions.db" ] || fail "sessions.db not written"

echo "elf-sfx-smoke OK"
