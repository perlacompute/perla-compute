import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { ComputeStore } from "../../../lib/compute/store.mjs";
import {
  readConfig,
  activationHash,
  miningBudget,
  TOKEN_UNIT,
  PLAN,
  sha,
  targetBits,
  compactTarget,
} from "../../../lib/compute/config.mjs";
import {
  createKey,
  principal,
  challenge,
  verifyLogin,
} from "../../../lib/compute/auth.mjs";
import {
  reserve,
  complete,
  dispatching,
  fail,
  reconcile,
} from "../../../lib/compute/billing.mjs";
import { gateway } from "../../../lib/compute/gateway.mjs";
import { definitions } from "../../../lib/compute/models.mjs";
const address = "0x" + "11".repeat(20);
export function setup() {
  const s = new ComputeStore(),
    c = readConfig({
      PERLA_PUBLIC_ORIGIN: "https://perla.example",
      PERLA_AI_PROVIDER_KEY: "test-provider-value",
      PERLA_COMPUTE_STORAGE_KEY: "ab".repeat(32),
    });
  Object.assign(c, {
    token: "0x" + "44".repeat(20),
    rewardVault: "0x" + "55".repeat(20),
    creditVault: "0x" + "66".repeat(20),
    startEpoch: Math.floor(Date.now() / 86400000),
    features: {
      api: true,
      mining: true,
      convert: true,
      migration: true,
      gpu: true,
    },
  });
  s.run("INSERT INTO compute_meta VALUES('activation',?)", activationHash(c));
  s.credit(address, 1000000, "test_fixture", "initial");
  const key = createKey(s, address, {
      name: "Tests",
      dailyLimitMicros: 1000000,
      monthlyLimitMicros: 10000000,
    }),
    p = principal(
      new Request(c.origin, {
        headers: { authorization: "Bearer " + key.key },
      }),
      s,
      c,
    );
  const m = {
    id: "perla/example",
    name: "Example",
    family: "Tests",
    inputMicro: 1000000,
    outputMicro: 2000000,
    inputLimit: 32768,
    outputLimit: 1024,
    markupBps: 2000,
    routes: [
      {
        model: "private/example",
        inputMicro: 1000000,
        outputMicro: 2000000,
        reasoningLevels: [],
      },
    ],
  };
  s.run(
    "INSERT INTO compute_models VALUES(?,?,?)",
    m.id,
    JSON.stringify(m),
    Math.floor(Date.now() / 1000),
  );
  return { s, c, key, p };
}
const body = {
  model: "perla/example",
  messages: [{ role: "user", content: "private prompt" }],
  max_tokens: 10,
};
const result = () => ({
  id: "provider-id",
  model: "private/example",
  choices: [{ message: { role: "assistant", content: "Hello" } }],
  usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.00002 },
});
const request = (c, key, b = body, idem = "request-id-0001") =>
  new Request(c.origin + "/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + key.key,
      "idempotency-key": idem,
    },
    body: JSON.stringify(b),
  });
test("130M mainnet emission cap is conserved across all 1460 days", () => {
  let n = 0n;
  for (let i = 0; i < 1460; i++) n += miningBudget(100 + i, 100);
  assert.equal(n, 130000000n * TOKEN_UNIT);
  assert.equal(miningBudget(99, 100), 0n);
  for (let i = 0; i <= 16; i++)
    assert.equal(
      compactTarget(PLAN.shareBits) / compactTarget(targetBits(2 ** i)),
      BigInt(2 ** i),
    );
});
test("mainnet sign-in nonce is consumed exactly once under concurrent signatures", async () => {
  const { s, c } = setup();
  try {
    const a = privateKeyToAccount("0x" + "77".repeat(32)),
      v = challenge(s, c, a.address);
    assert(v.message.includes("Chain ID: 4663"));
    const signature = await a.signMessage({ message: v.message });
    const rs = await Promise.allSettled([
      verifyLogin(s, v.id, signature),
      verifyLogin(s, v.id, signature),
    ]);
    assert.equal(rs.filter((r) => r.status === "fulfilled").length, 1);
  } finally {
    s.close();
  }
});
test("reservations enforce balances, scopes and idempotency without double debit", () => {
  const { s, p } = setup();
  try {
    const r = reserve(s, p, {
      idem: "reservation-one",
      fingerprint: "a",
      model: "x",
      amount: 800000,
    });
    assert.equal(
      reserve(s, p, {
        idem: "reservation-one",
        fingerprint: "a",
        model: "x",
        amount: 800000,
      }).id,
      r.id,
    );
    assert.throws(() =>
      reserve(s, p, {
        idem: "reservation-two",
        fingerprint: "b",
        model: "x",
        amount: 800000,
      }),
    );
    assert.throws(() =>
      reserve(s, p, {
        idem: "reservation-one",
        fingerprint: "different",
        model: "x",
        amount: 100,
      }),
    );
    dispatching(s, r.id);
    complete(s, r.id, { charged: 100, input: 1, output: 1 });
    complete(s, r.id, { charged: 100, input: 1, output: 1 });
    assert.equal(s.account(address).balance, 999900);
    assert.equal(s.account(address).held, 0);
  } finally {
    s.close();
  }
});
test("uncertain requests retain one hold and require evidence-backed reconciliation", () => {
  const { s, p } = setup();
  try {
    const r = reserve(s, p, {
      idem: "unknown-request-1",
      fingerprint: "same",
      model: "x",
      amount: 100,
    });
    dispatching(s, r.id);
    fail(s, r.id, "transport", true);
    assert.equal(s.account(address).held, 100);
    assert.throws(
      () =>
        reserve(s, p, {
          idem: "unknown-request-2",
          fingerprint: "same",
          model: "x",
          amount: 100,
        }),
      /reconciliation/,
    );
    reconcile(s, r.id, { notBilled: true, evidence: "provider-reference-1" });
    assert.equal(s.account(address).held, 0);
  } finally {
    s.close();
  }
});
test("gateway JSON response is billed once and idempotent results are encrypted", async () => {
  const { s, c, key } = setup();
  let count = 0;
  try {
    const fetcher = async () => {
      count++;
      return Response.json(result());
    };
    const a = await gateway(request(c, key), s, c, { fetcher }),
      text = await a.text();
    assert.equal(a.status, 200);
    assert.equal(JSON.parse(text).model, "perla/example");
    assert.equal(s.account(address).balance, 999976);
    const replay = await gateway(request(c, key), s, c, { fetcher });
    assert.equal(await replay.text(), text);
    assert.equal(count, 1);
    assert(
      !JSON.stringify(s.all("SELECT * FROM compute_responses")).includes(
        "Hello",
      ),
    );
    assert(
      !JSON.stringify(s.all("SELECT * FROM compute_requests")).includes(
        "private prompt",
      ),
    );
  } finally {
    s.close();
  }
});
test("transport uncertainty never triggers an automatic upstream POST replay", async () => {
  const { s, c, key } = setup();
  let count = 0;
  try {
    const r = await gateway(request(c, key), s, c, {
      fetcher: async () => {
        count++;
        throw Error("network reset");
      },
    });
    assert.equal(r.status, 502);
    assert.equal(count, 1);
    assert(s.account(address).held > 0);
    assert.equal(s.account(address).balance, 1000000);
  } finally {
    s.close();
  }
});
test("streaming includes live chunks, settles at final usage, and replays without another charge", async () => {
  const { s, c, key } = setup();
  try {
    const text =
      "data: " +
      JSON.stringify({
        id: "x",
        model: "private/example",
        choices: [{ delta: { content: "Hello" } }],
      }) +
      "\n\ndata: " +
      JSON.stringify({
        id: "x",
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.00002 },
      }) +
      "\n\ndata: [DONE]\n\n";
    const r = await gateway(request(c, key, { ...body, stream: true }), s, c, {
        fetcher: async () => new Response(text),
      }),
      out = await r.text();
    assert(out.includes("[DONE]"));
    assert(!out.includes("private/example"));
    assert(out.includes('\"cost\":\"0.000024\"'));
    assert(!out.includes('\"cost\":0.00002'));
    assert.equal(s.account(address).held, 0);
    assert.equal(s.account(address).balance, 999976);
    const replay = await gateway(
      request(c, key, { ...body, stream: true }),
      s,
      c,
      {
        fetcher: () => {
          throw Error("must not execute");
        },
      },
    );
    assert.equal(await replay.text(), out);
  } finally {
    s.close();
  }
});
test("truncated streams keep a reviewable hold instead of inventing a successful free result", async () => {
  const { s, c, key } = setup();
  try {
    const r = await gateway(request(c, key, { ...body, stream: true }), s, c, {
      fetcher: async () =>
        new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
    });
    assert((await r.text()).includes("stream_interrupted"));
    assert(s.account(address).held > 0);
    assert.equal(s.account(address).balance, 1000000);
  } finally {
    s.close();
  }
});
test("closed defaults never dispatch a paid provider request", async () => {
  const { s, c, key } = setup();
  c.features.api = false;
  try {
    await assert.rejects(() => gateway(request(c, key), s, c), /not open/);
  } finally {
    s.close();
  }
});
test("public catalog groups priced models and rejects unsupported entries", () => {
  const rows = definitions(
    {
      data: [
        {
          id: "a/test",
          upstream_label: "Model One",
          modality: "text",
          pricing: { min_ask_in: 1, min_ask_out: 2 },
        },
        {
          id: "b/test",
          upstream_label: "Model One",
          modality: "text",
          pricing: { min_ask_in: 2, min_ask_out: 3 },
        },
        {
          id: "c/image",
          upstream_label: "Image Generator",
          pricing: { min_ask_in: 1, min_ask_out: 1 },
        },
      ],
    },
    2000,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].routes.length, 2);
});
