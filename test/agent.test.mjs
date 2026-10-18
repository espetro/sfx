// Node-side tests over the tsc build (subset code is valid TS; dist/ runs on
// plain Node). Covers SSE parsing, tool-call assembly, and the agent loop
// against the canned stub — the same fixture the ELF test drives.

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const dist = path.join(root, "dist");

const { newSseParser, sseFeed } = await import(path.join(dist, "core/sse.js"));
const { OpenAIProvider } = await import(path.join(dist, "core/provider/openai.js"));
const { nativeHosts } = await import(path.join(dist, "native/host.js"));
const { defaultTools } = await import(path.join(dist, "core/tools.js"));
const { runAgent } = await import(path.join(dist, "core/agent.js"));

test("sse parser handles split events and multi-line data", () => {
  const p = newSseParser();
  let out = sseFeed(p, 'data: {"a"');
  assert.deepEqual(out, []);
  out = sseFeed(p, ":1}\n\ndata: hello\n\n");
  assert.deepEqual(out, ['{"a":1}', "hello"]);
  out = sseFeed(p, "data: line1\ndata: line2\n\n");
  assert.deepEqual(out, ["line1\nline2"]);
});

test("agent loop: tool call then final text over stub SSE", async () => {
  const srv = spawn("node", [path.join(here, "fixtures/sse-server.mjs")], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const port = await new Promise((resolve, reject) => {
    srv.stdout.once("data", (d) => {
      const m = String(d).match(/sse-stub (\d+)/);
      if (m) resolve(Number(m[1]));
      else reject(new Error("no port: " + d));
    });
    setTimeout(() => reject(new Error("stub timeout")), 5000);
  });
  try {
    const hosts = nativeHosts();
    const provider = new OpenAIProvider(
      { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "test" },
      hosts.net,
    );
    const tools = defaultTools();
    const chunks = [];
    const result = await runAgent(
      hosts,
      {
        provider,
        model: "stub-model",
        system: "test",
        tools,
        maxSteps: 4,
        streamText: true,
      },
      "run a command",
      (c) => chunks.push(c),
    );
    assert.equal(result.toolCalls, 1);
    assert.equal(result.text, "final answer");
    assert.equal(result.usage.promptTokens, 34);
    assert.equal(result.usage.completionTokens, 12);
    assert.deepEqual(chunks, ["final ", "answer"]);
    // the tool result message must contain the bash output
    const toolMsg = result.messages.find((m) => m.role === "tool");
    assert.ok(toolMsg);
    assert.ok(toolMsg.content.includes("hello-from-tool"));
  } finally {
    srv.kill();
  }
});
