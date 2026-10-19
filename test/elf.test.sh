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

sid="$(printf '%s\n' "$out" | sed -n 's/.*"session":"\([^"]*\)".*/\1/p')"
[ -n "$sid" ] || fail "no session id in $out"

# --resume on the same jsonl session: the stub answers "resumed ok" only
# when the request body carries the prior tool result (hello-from-tool).
out3="$(
  SFX_HOME="$T/home" \
  SFX_BASE_URL="http://127.0.0.1:8391/v1" \
  SFX_API_KEY="test" \
  SFX_MODEL="stub-model" \
  "$T/sfx" ask --json --resume "$sid" "continue"
)" || fail "elf ask --resume"
printf '%s\n' "$out3" | grep -q '"text":"resumed ok"' || fail "resume did not reuse context: $out3"
printf '%s\n' "$out3" | grep -q "\"session\":\"$sid\"" || fail "resume used wrong session: $out3"
# resumed session appended (first run: 4 msgs, second adds user+assistant)
lines="$(wc -l < "$T/home/.sfx/sessions/$sid.jsonl")"
[ "$lines" -ge 6 ] || fail "resumed session too short: $lines"

# --resume --fork: new id, original file untouched.
before="$(wc -l < "$T/home/.sfx/sessions/$sid.jsonl")"
out4="$(
  SFX_HOME="$T/home" \
  SFX_BASE_URL="http://127.0.0.1:8391/v1" \
  SFX_API_KEY="test" \
  SFX_MODEL="stub-model" \
  "$T/sfx" ask --json --resume "$sid" --fork "fork it"
)" || fail "elf ask --resume --fork"
printf '%s\n' "$out4" | grep -q '"text":"resumed ok"' || fail "fork did not reuse context: $out4"
sid2="$(printf '%s\n' "$out4" | sed -n 's/.*"session":"\([^"]*\)".*/\1/p')"
[ -n "$sid2" ] && [ "$sid2" != "$sid" ] || fail "fork did not mint new id: $out4"
after="$(wc -l < "$T/home/.sfx/sessions/$sid.jsonl")"
[ "$before" = "$after" ] || fail "fork mutated original session ($before -> $after)"
[ -f "$T/home/.sfx/sessions/$sid2.jsonl" ] || fail "fork session file missing"
[ "$(wc -l < "$T/home/.sfx/sessions/$sid2.jsonl")" -gt "$before" ] || fail "fork did not copy history"

# sessions list: both ids, newest first, with first-user-message preview.
lst="$(
  SFX_HOME="$T/home" \
  "$T/sfx" sessions list --store jsonl
)" || fail "elf sessions list"
printf '%s\n' "$lst" | grep -q "$sid" || fail "list missing $sid: $lst"
printf '%s\n' "$lst" | grep -q "$sid2" || fail "list missing $sid2: $lst"
printf '%s\n' "$lst" | grep -q "echo something" || fail "list missing preview: $lst"
[ "$(printf '%s\n' "$lst" | head -1 | cut -f1)" = "$sid2" ] || fail "list not newest-first: $lst"

# compaction: tiny token budget forces the summary arm before the resumed
# request; the session file must carry the [conversation summary] message.
out5="$(
  SFX_HOME="$T/home" \
  SFX_BASE_URL="http://127.0.0.1:8391/v1" \
  SFX_API_KEY="test" \
  SFX_MODEL="stub-model" \
  SFX_COMPACT_TOKENS=1 \
  SFX_COMPACT_KEEP=2 \
  "$T/sfx" ask --json --resume "$sid" "compact me"
)" || fail "elf ask compact"
grep -q "conversation summary" "$T/home/.sfx/sessions/$sid.jsonl" || fail "no summary message persisted"

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

# sqlite lane: resume continues the same session id in sessions.db.
sid3="$(printf '%s\n' "$out2" | sed -n 's/.*"session":"\([^"]*\)".*/\1/p')"
out6="$(
  SFX_HOME="$T/home2" \
  SFX_BASE_URL="http://127.0.0.1:8391/v1" \
  SFX_API_KEY="test" \
  SFX_MODEL="stub-model" \
  "$T/sfx" ask --json --store sqlite --resume "$sid3" "continue"
)" || fail "elf ask --resume sqlite"
printf '%s\n' "$out6" | grep -q '"text":"resumed ok"' || fail "sqlite resume: $out6"

lst2="$(
  SFX_HOME="$T/home2" \
  "$T/sfx" sessions list --store sqlite
)" || fail "elf sessions list sqlite"
printf '%s\n' "$lst2" | grep -q "$sid3" || fail "sqlite list missing $sid3: $lst2"
printf '%s\n' "$lst2" | grep -q "echo something" || fail "sqlite list missing preview: $lst2"

echo "elf-sfx-smoke OK"
