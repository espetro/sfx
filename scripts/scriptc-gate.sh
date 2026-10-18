#!/usr/bin/env bash
# Fails unless `scriptc coverage gate.ts` reports 100% static.
set -euo pipefail

cd "$(dirname "$0")/.."

BIN="scriptc"
if [ -x node_modules/.bin/scriptc ]; then
  BIN="node_modules/.bin/scriptc"
fi

out="$("$BIN" coverage gate.ts 2>&1)" || true
line=$(printf '%s\n' "$out" | grep -E 'compile statically' || true)
if [[ "$line" == *"(100%)"* ]]; then
  printf 'ok   gate.ts %s\n' "$(printf '%s' "$line" | tr -s ' ')"
else
  printf 'FAIL gate.ts %s\n' "${line:-no coverage line}"
  printf '%s\n' "$out" | tail -20
  exit 1
fi
