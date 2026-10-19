#!/usr/bin/env bash
# Fails if `scriptc coverage gate.ts` reports any blockers. Sites "deferred
# to runtime" (fences that throw only if executed) are reported but allowed
# — e.g. @cutils/sqlite's record-bind path uses Object.keys, which we never
# reach because all our binds are positional arrays.
set -euo pipefail

cd "$(dirname "$0")/.."

BIN="scriptc"
if [ -x node_modules/.bin/scriptc ]; then
  BIN="node_modules/.bin/scriptc"
fi

out="$("$BIN" coverage gate.ts \
  --npm-static @cutils/sqlite \
  --ffi node_modules/@cutils/sqlite/ffi.json 2>&1)" || true
line=$(printf '%s\n' "$out" | grep -E 'compile statically' || true)
blockers=$(printf '%s\n' "$out" | grep -A9999 'blockers:' | tail -n +2 | grep -c '×' || true)
if [ -n "$line" ] && [ "$blockers" -eq 0 ]; then
  printf 'ok   gate.ts %s\n' "$(printf '%s' "$line" | tr -s ' ')"
  deferred=$(printf '%s\n' "$out" | grep -c 'deferred to runtime' || true)
  if [ "$deferred" -gt 0 ]; then
    printf '     (%s deferred-to-runtime sites present)\n' "$deferred"
  fi
else
  printf 'FAIL gate.ts %s\n' "${line:-no coverage line}"
  printf '%s\n' "$out" | tail -30
  exit 1
fi
