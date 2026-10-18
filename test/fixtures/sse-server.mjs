// Canned OpenAI-compatible SSE stub for tests and elf.test.sh (fx 127.0.0.1
// pattern). Request 1 -> a bash tool_call; request 2+ -> final text.
// Never a real network dep. Usage: node test/fixtures/sse-server.mjs [port]

import http from "node:http";

const port = Number(process.argv[2] || 0);
let hits = 0;

function sse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits++;
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      if (hits === 1) {
        sse(res, {
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "call_1",
                    type: "function",
                    function: { name: "ba", arguments: '{"command":"echo hel' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        });
        sse(res, {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: { name: "sh", arguments: 'lo-from-tool"}' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        });
        sse(res, {
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
          usage: { prompt_tokens: 11, completion_tokens: 7 },
        });
      } else {
        sse(res, {
          choices: [
            { index: 0, delta: { role: "assistant", content: "final " }, finish_reason: null },
          ],
        });
        sse(res, {
          choices: [{ index: 0, delta: { content: "answer" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 23, completion_tokens: 5 },
        });
      }
      res.write("data: [DONE]\n\n");
      res.end();
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(port, "127.0.0.1", () => {
  console.log(`sse-stub ${server.address().port}`);
});
