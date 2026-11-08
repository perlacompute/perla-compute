import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ComputeStore } from "../../../lib/compute/store.mjs";
import {
  readConfig,
  activationHash,
  sha,
  nowSeconds,
} from "../../../lib/compute/config.mjs";
import { gateway } from "../../../lib/compute/gateway.mjs";
import { trialStatus, reserveTrial } from "../../../lib/compute/trial.mjs";
import { createKey } from "../../../lib/compute/auth.mjs";
import {
  reconcile,
  fail,
  dispatching,
  complete,
  usage,
} from "../../../lib/compute/billing.mjs";
const owner = "0x" + "11".repeat(20),
  other = "0x" + "22".repeat(20),
  secret = "55".repeat(32);
function setup() {
  const s = new ComputeStore(),
    c = readConfig({
      PERLA_PUBLIC_ORIGIN: "https://perla.example",
      PERLA_AI_PROVIDER_KEY: "fixture-provider",
      PERLA_COMPUTE_STORAGE_KEY: "ab".repeat(32),
    });
  c.features.api = true;
  s.run("INSERT INTO compute_meta VALUES('activation',?)", activationHash(c));
  s.account(owner);
  s.account(other);
  s.run(
    "INSERT INTO compute_sessions VALUES(?,?,?)",
    sha(secret),
    owner,
    nowSeconds() + 3600,
  );
  s.run(
    "INSERT INTO compute_models VALUES(?,?,?)",
    "perla/free",
    JSON.stringify({
      id: "perla/free",
      inputMicro: 1000000,
      outputMicro: 2000000,
      inputLimit: 32768,
      outputLimit: 1024,
      markupBps: 2000,
      routes: [
        { model: "fixture/free", inputMicro: 1000000, outputMicro: 2000000 },
      ],
    }),
    nowSeconds(),
  );
  return { s, c };
}
const body = {
  model: "perla/free",
  messages: [{ role: "user", content: "Hello" }],
  max_tokens: 256,
  billing_mode: "trial",
};
const request = (c, b = body, key = randomUUID()) =>
  new Request(c.origin + "/api/compute/chat", {
    method: "POST",
    headers: {
      origin: c.origin,
      cookie: "perla_mining=" + secret,
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify(b),
  });
const result = () =>
  Response.json({
    id: "fixture",
    model: "fixture/free",
    choices: [{ message: { role: "assistant", content: "Hello" } }],
    usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.00002 },
  });
test("exactly three successful free chats leave a zero-balance wallet uncharged", async () => {
  const { s, c } = setup();
  let calls = 0;
  try {
    for (let i = 0; i < 3; i++) {
      const r = await gateway(request(c), s, c, {
        workspace: true,
        fetcher: async () => {
          calls++;
          return result();
        },
      });
      assert.equal(r.status, 200);
      assert.equal((await r.json()).usage.cost, "0.000000");
    }
    assert.equal(trialStatus(s, c, owner).remaining, 0);
    await assert.rejects(
      () => gateway(request(c), s, c, { workspace: true, fetcher: result }),
      (e) => e.code === "trial_exhausted",
    );
    assert.equal(calls, 3);
    assert.equal(s.account(owner).balance, 0);
    assert.equal(s.account(owner).held, 0);
    assert.equal(usage(s, owner).totals.charged, 0);
    assert.equal(s.all("SELECT * FROM compute_ledger").length, 0);
  } finally {
    s.close();
  }
});
test("replaying a free request does not use another chat or provider call", async () => {
  const { s, c } = setup();
  try {
    const id = randomUUID(),
      r = await gateway(request(c, body, id), s, c, {
        workspace: true,
        fetcher: result,
      }),
      text = await r.text();
    const retry = await gateway(request(c, body, id), s, c, {
      workspace: true,
      fetcher: () => {
        throw Error("duplicate provider call");
      },
    });
    assert.equal(await retry.text(), text);
    assert.equal(trialStatus(s, c, owner).used, 1);
  } finally {
    s.close();
  }
});
test("known no-bill failures restore free quota; uncertain requests hold one slot", async () => {
  const { s, c } = setup();
  try {
    const a = await gateway(request(c), s, c, {
      workspace: true,
      fetcher: async () =>
        Response.json({ error: { code: "bad_request" } }, { status: 400 }),
    });
    assert.equal(a.status, 502);
    assert.equal(trialStatus(s, c, owner).used, 0);
    await gateway(request(c), s, c, {
      workspace: true,
      fetcher: async () => {
        throw Error("transport reset");
      },
    });
    assert.equal(trialStatus(s, c, owner).used, 1);
    const row = s.get("SELECT id FROM compute_requests WHERE state='unknown'");
    reconcile(s, row.id, {
      notBilled: true,
      evidence: "fixture-no-charge-confirmed",
    });
    assert.equal(trialStatus(s, c, owner).used, 0);
    assert.equal(s.account(owner).held, 0);
  } finally {
    s.close();
  }
});
test("API keys cannot request free chats; prompt, output and price ceilings fail before dispatch", async () => {
  const { s, c } = setup();
  try {
    const key = createKey(s, owner, { name: "API only" }),
      r = new Request(c.origin + "/v1/chat/completions", {
        method: "POST",
        headers: { authorization: "Bearer " + key.key },
        body: JSON.stringify(body),
      });
    await assert.rejects(
      () => gateway(r, s, c, { fetcher: result }),
      (e) => e.code === "trial_workspace",
    );
    await assert.rejects(
      () =>
        gateway(request(c, { ...body, max_tokens: 257 }), s, c, {
          workspace: true,
          fetcher: result,
        }),
      (e) => e.code === "trial_size",
    );
    await assert.rejects(
      () =>
        gateway(
          request(c, {
            ...body,
            messages: [{ role: "user", content: "x".repeat(4100) }],
          }),
          s,
          c,
          { workspace: true, fetcher: result },
        ),
      (e) => e.code === "trial_size",
    );
    assert.equal(trialStatus(s, c, owner).used, 0);
  } finally {
    s.close();
  }
});
test("global sponsorship budget includes outstanding reservations across wallets", () => {
  const { s, c } = setup();
  try {
    c.trial.dailyBudgetMicros = 500;
    const reserve = (address) =>
      reserveTrial(
        s,
        c,
        { address, keyId: null },
        {
          idem: randomUUID(),
          fingerprint: address,
          model: "perla/free",
          amount: 300,
        },
        body,
      );
    const a = reserve(owner);
    assert.throws(
      () => reserve(other),
      (e) => e.code === "trial_capacity",
    );
    dispatching(s, a.id);
    fail(s, a.id, "uncertain", true);
    assert.throws(
      () => reserve(other),
      (e) => e.code === "trial_capacity",
    );
    reconcile(s, a.id, {
      notBilled: true,
      evidence: "fixture-no-charge-confirmed",
    });
    assert(reserve(other));
  } finally {
    s.close();
  }
});
test("3-chat limit and existing balances persist through restart and additive schema migration", () => {
  const folder = mkdtempSync(join(tmpdir(), "perla-trial-migration-")),
    filename = join(folder, "compute.sqlite");
  try {
    const old = readFileSync(
        "scripts/checks/mainnet/fixtures/schema-1.0.sql",
        "utf8",
      ),
      db = new DatabaseSync(filename);
    db.exec(old);
    db.prepare("INSERT INTO compute_meta VALUES('schema',?)").run(sha(old));
    db.prepare("INSERT INTO compute_accounts VALUES(?,123456,0,?)").run(
      owner,
      nowSeconds(),
    );
    db.close();
    let s = new ComputeStore(filename);
    assert.equal(s.account(owner).balance, 123456);
    assert(
      s
        .all("PRAGMA table_info(compute_requests)")
        .some((r) => r.name === "billing_source"),
    );
    s.close();
    s = new ComputeStore(filename);
    assert.equal(s.account(owner).balance, 123456);
    const c = readConfig({});
    for (let i = 0; i < 3; i++) {
      const r = reserveTrial(
        s,
        c,
        { address: owner, keyId: null },
        {
          idem: randomUUID(),
          fingerprint: String(i),
          model: "fixture",
          amount: 100,
        },
        body,
      );
      dispatching(s, r.id);
      complete(s, r.id, { input: 1, output: 1, charged: 20 });
    }
    assert.equal(trialStatus(s, c, owner).remaining, 0);
    s.close();
    s = new ComputeStore(filename);
    assert.equal(trialStatus(s, c, owner).remaining, 0);
    assert.equal(s.account(owner).balance, 123456);
    s.close();
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("streamed free replies consume one slot, record sponsorship and replay without charging", async () => {
  const { s, c } = setup();
  try {
    const b = { ...body, stream: true },
      id = randomUUID();
    const frames =
      "data: " +
      JSON.stringify({ choices: [{ delta: { content: "Hello" } }] }) +
      "\n\ndata: " +
      JSON.stringify({
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.00002 },
      }) +
      "\n\ndata: [DONE]\n\n";
    const r = await gateway(request(c, b, id), s, c, {
        workspace: true,
        fetcher: async () => new Response(frames),
      }),
      text = await r.text();
    assert(text.includes("[DONE]"));
    assert(text.includes('"cost":"0.000000"'));
    assert.equal(trialStatus(s, c, owner).used, 1);
    assert(
      s.get("SELECT cost_micros FROM compute_trial_usage").cost_micros > 0,
    );
    assert.equal(s.account(owner).balance, 0);
    const retry = await gateway(request(c, b, id), s, c, {
      workspace: true,
      fetcher: () => {
        throw Error("duplicate call");
      },
    });
    assert.equal(await retry.text(), text);
  } finally {
    s.close();
  }
});
