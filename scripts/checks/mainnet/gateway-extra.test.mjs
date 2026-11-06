import test from "node:test";
import assert from "node:assert/strict";
import { ComputeStore } from "../../../lib/compute/store.mjs";
import { readConfig, activationHash } from "../../../lib/compute/config.mjs";
import { createKey } from "../../../lib/compute/auth.mjs";
import { gateway } from "../../../lib/compute/gateway.mjs";
const address = "0x" + "11".repeat(20);
function fixture() {
  const s = new ComputeStore(),
    c = readConfig({
      PERLA_PUBLIC_ORIGIN: "https://perla.example",
      PERLA_AI_PROVIDER_KEY: "fixture-provider",
      PERLA_COMPUTE_STORAGE_KEY: "ab".repeat(32),
    });
  c.features.api = true;
  s.run("INSERT INTO compute_meta VALUES('activation',?)", activationHash(c));
  s.credit(address, 1000000, "fixture", "initial");
  const k = createKey(s, address, { name: "Anthropic test" });
  s.run(
    "INSERT INTO compute_models VALUES(?,?,?)",
    "perla/claude",
    JSON.stringify({
      id: "perla/claude",
      inputMicro: 1000000,
      outputMicro: 2000000,
      inputLimit: 32768,
      outputLimit: 1024,
      markupBps: 2000,
      routes: [
        { model: "private/claude", inputMicro: 1000000, outputMicro: 2000000 },
      ],
    }),
    Math.floor(Date.now() / 1000),
  );
  return { s, c, k };
}
test("Anthropic JSON preserves tool use while pricing only final usage", async () => {
  const { s, c, k } = fixture();
  try {
    const r = new Request(c.origin + "/v1/messages", {
      method: "POST",
      headers: { "x-api-key": k.key, "idempotency-key": "anthropic-json-001" },
      body: JSON.stringify({
        model: "perla/claude",
        max_tokens: 10,
        messages: [{ role: "user", content: "Use a tool" }],
        tools: [{ name: "lookup", input_schema: { type: "object" } }],
      }),
    });
    const out = await gateway(r, s, c, {
      kind: "anthropic",
      fetcher: async (url, init) => {
        assert(url.endsWith("/messages"));
        assert.equal(init.headers["anthropic-version"], "2023-06-01");
        assert.equal(JSON.parse(init.body).tools[0].name, "lookup");
        return Response.json({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "private/claude",
          content: [
            { type: "tool_use", id: "tool_1", name: "lookup", input: {} },
          ],
          usage: { input_tokens: 10, output_tokens: 2, cost: 0.00002 },
        });
      },
    });
    const b = await out.json();
    assert.equal(out.status, 200);
    assert.equal(b.model, "perla/claude");
    assert.equal(b.content[0].type, "tool_use");
    assert.equal(b.usage.cost, "0.000024");
    assert.equal(s.account(address).held, 0);
  } finally {
    s.close();
  }
});
test("Anthropic SSE joins start and delta usage and bills exactly once", async () => {
  const { s, c, k } = fixture();
  try {
    const frames = [
      [
        "message_start",
        {
          type: "message_start",
          message: {
            id: "msg_1",
            model: "private/claude",
            content: [],
            usage: { input_tokens: 10, output_tokens: 0 },
          },
        },
      ],
      [
        "content_block_delta",
        {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Hello" },
        },
      ],
      [
        "message_delta",
        { type: "message_delta", usage: { output_tokens: 2, cost: 0.00002 } },
      ],
      ["message_stop", { type: "message_stop" }],
    ]
      .map(
        ([type, v]) =>
          "event: " + type + "\ndata: " + JSON.stringify(v) + "\n\n",
      )
      .join("");
    const request = () =>
      new Request(c.origin + "/v1/messages", {
        method: "POST",
        headers: { "x-api-key": k.key, "idempotency-key": "anthropic-sse-001" },
        body: JSON.stringify({
          model: "perla/claude",
          max_tokens: 10,
          stream: true,
          messages: [{ role: "user", content: "Hello" }],
        }),
      });
    const r = await gateway(request(), s, c, {
        kind: "anthropic",
        fetcher: async () => new Response(frames),
      }),
      out = await r.text();
    assert(out.includes("message_stop"));
    assert(out.includes("Hello"));
    assert(!out.includes("private/claude"));
    assert.equal(s.account(address).balance, 999976);
    assert.equal(s.account(address).held, 0);
    const replay = await gateway(request(), s, c, {
      kind: "anthropic",
      fetcher: () => {
        throw Error("duplicate dispatch");
      },
    });
    assert.equal(await replay.text(), out);
    assert.equal(s.account(address).balance, 999976);
  } finally {
    s.close();
  }
});
