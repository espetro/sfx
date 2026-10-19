// Session store tests over the tsc build: append/load/list round-trip and
// newest-first ordering on the JSONL store (sqlite's lane is ELF-only —
// covered by test/elf.test.sh).

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "..", "dist");

const { JsonlSessionStore } = await import(path.join(dist, "core/session.js"));
const { nativeHosts } = await import(path.join(dist, "native/host.js"));

test("jsonl store: append, load, list newest-first", async () => {
  const hosts = nativeHosts();
  const root = mkdtempSync(path.join(tmpdir(), "sfx-test-"));
  const store = new JsonlSessionStore(hosts.fs, root);

  assert.deepEqual(await store.list(), []);

  const a = store.newId();
  await store.append(a, { role: "system", content: "sys", toolCalls: null, toolCallId: null });
  await store.append(a, { role: "user", content: "first", toolCalls: null, toolCallId: null });

  // Force an id that sorts after `a` (ids embed a base-36 ms prefix).
  const b = "zz" + a;
  await store.append(b, { role: "user", content: "second", toolCalls: null, toolCallId: null });

  const ids = await store.list();
  assert.deepEqual(ids, [b, a]);

  const loaded = await store.load(a);
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].role, "system");
  assert.equal(loaded[1].content, "first");
});
