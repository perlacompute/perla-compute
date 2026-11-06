import test from "node:test";
import assert from "node:assert/strict";
import { ComputeStore } from "../../../lib/compute/store.mjs";
import {
  readConfig,
  activationHash,
  PLAN,
  PLAN_HASH,
  PROTOCOL,
  sha,
  nowSeconds,
} from "../../../lib/compute/config.mjs";
import { createKey, principal } from "../../../lib/compute/auth.mjs";
import {
  connectWorker,
  worker,
  reconnectStart,
  reconnectApprove,
  reconnectExchange,
  report,
  work,
  share,
  prepareEpoch,
} from "../../../lib/compute/mining.mjs";
import {
  configureGpuModel,
  approveGpuWorker,
  enqueue,
  lease,
  submitResult,
  getJob,
  expireJobs,
} from "../../../lib/compute/gpu-jobs.mjs";
import { handle } from "../../../lib/compute/handler.mjs";
const addresses = [
  "0x" + "11".repeat(20),
  "0x" + "22".repeat(20),
  "0x" + "33".repeat(20),
];
const gpuReport = {
  version: "0.5.0",
  upstreamCommit: "82e6eee7076aafe10123e08db78f100d270c0582",
  gpuSelfTestPassed: true,
  device: { computeCapability: 89, name: "SOFTWARE FIXTURE ONLY" },
  cases: [2048, 4096].map((k) => ({
    k,
    fullGemmMatchesReference: true,
    allTranscriptsMatchReference: true,
    signedExtremesMatchReference: true,
    nativeV3ProofAccepted: true,
    nonWinningPowRejected: true,
    changedChallengeRejected: true,
  })),
};
function setup() {
  const s = new ComputeStore(),
    c = readConfig({
      PERLA_PUBLIC_ORIGIN: "https://perla.example",
      PERLA_COMPUTE_STORAGE_KEY: "cd".repeat(32),
      PERLA_MAINNET_VERIFIER_URL: "http://127.0.0.1:8767",
      PERLA_MAINNET_VERIFIER_TOKEN: "test-only-mainnet-verifier-token-".repeat(
        2,
      ),
    });
  Object.assign(c, {
    token: "0x" + "44".repeat(20),
    rewardVault: "0x" + "55".repeat(20),
    creditVault: "0x" + "66".repeat(20),
    startEpoch: Math.floor(Date.now() / 86400000),
    features: {
      api: true,
      mining: true,
      gpu: true,
      migration: true,
      convert: true,
    },
  });
  s.run("INSERT INTO compute_meta VALUES('activation',?)", activationHash(c));
  s.run(
    "INSERT INTO compute_meta VALUES('chain_health',?)",
    JSON.stringify({
      miningFunded: (130000000n * 10n ** 18n).toString(),
      miningAllocated: "0",
      checkedAt: nowSeconds(),
    }),
  );
  s.credit(addresses[0], 100000, "software_fixture", "initial");
  return { s, c };
}
test("reconnect recovers a committed exchange after the final response is lost", () => {
  const { s } = setup();
  try {
    const oldToken = "17".repeat(32),
      newToken = "18".repeat(32),
      id = connectWorker(
        s,
        { address: addresses[0], name: "recovery-fixture" },
        oldToken,
      ).id;
    const request = reconnectStart(
      s,
      { workerId: id, code: "AABBCCDDEEFF" },
      newToken,
      1000,
    );
    reconnectApprove(
      s,
      addresses[0],
      { id: request.id, code: "AABBCCDDEEFF" },
      1001,
    );
    const first = reconnectExchange(s, request.id, newToken, 1002);
    const recovered = reconnectExchange(s, request.id, newToken, 2000);
    assert.equal(recovered.id, first.id);
    assert.equal(recovered.recovered, true);
    assert.throws(() => worker(s, oldToken));
    assert.equal(worker(s, newToken).id, id);
  } finally {
    s.close();
  }
});
test("validated inference worker can keep its heartbeat while approval is pending", async () => {
  const { s, c } = setup();
  try {
    const token = "19".repeat(32),
      id = connectWorker(
        s,
        { address: addresses[0], name: "pending-inference", kind: "inference" },
        token,
      ).id;
    report(s, worker(s, token), gpuReport, 1000);
    c.features.gpu = false;
    const r = await handle(
      new Request(c.origin + "/api/compute/mining/status", {
        headers: { authorization: "Bearer " + token },
      }),
      s,
      c,
    );
    assert.equal(r.status, 200);
    assert.equal((await r.json()).id, id);
    assert(
      s.get("SELECT last_seen FROM compute_workers WHERE id=?", id).last_seen >
        1000,
    );
  } finally {
    s.close();
  }
});
test("worker identities and credentials are isolated; reconnect only replaces after owner approval", () => {
  const { s } = setup();
  try {
    const w = connectWorker(
        s,
        { address: addresses[0], name: "rig01" },
        "a1".repeat(32),
      ),
      other = connectWorker(
        s,
        { address: addresses[0], name: "rig01" },
        "a2".repeat(32),
      );
    assert.notEqual(w.id, other.id);
    const r = reconnectStart(
      s,
      { workerId: w.id, code: "AABBCCDDEEFF" },
      "b1".repeat(32),
    );
    assert(reconnectExchange(s, r.id, "b1".repeat(32)).pending);
    assert.throws(() =>
      reconnectApprove(s, addresses[1], { id: r.id, code: "AABBCCDDEEFF" }),
    );
    reconnectApprove(s, addresses[0], { id: r.id, code: "AABBCCDDEEFF" });
    assert.equal(reconnectExchange(s, r.id, "b1".repeat(32)).id, w.id);
    assert.throws(() => worker(s, "a1".repeat(32)));
    assert.equal(worker(s, "b1".repeat(32)).id, w.id);
    assert.throws(() => reconnectExchange(s, r.id, "b2".repeat(32)));
  } finally {
    s.close();
  }
});
test("mainnet accounting uses deterministic verifier verdict fixtures, not a GPU performance claim", async (t) => {
  const { s, c } = setup();
  try {
    const token = "ab".repeat(32),
      created = connectWorker(
        s,
        { address: addresses[0], name: "fixture" },
        token,
      ),
      w = worker(s, token);
    report(s, w, gpuReport);
    const cfg = { ...w, gpu_report: JSON.stringify(gpuReport) },
      health = {
        upstream_commit: gpuReport.upstreamCommit,
        supported_protocols: [PROTOCOL],
        round_target_policy: "perla-mainnet-rounds-v1",
      },
      fetcher = async (url, options) => {
        if (url.endsWith("/health")) return Response.json(health);
        const p = JSON.parse(options.body);
        return Response.json({
          ...health,
          protocol: PROTOCOL,
          valid: true,
          round_valid: true,
          header_hash: sha(Buffer.from(p.header, "base64")),
          proof_hash: sha(Buffer.from(p.plain_proof, "base64")),
          round_bits: p.round_bits,
        });
      };
    await t.test(
      "old testnet headers cannot request a mainnet challenge",
      async () =>
        await assert.rejects(
          () => work(s, c, cfg, { request: new Request(c.origin), fetcher }),
          (e) => e.status === 426,
        ),
    );
    const j = await work(s, c, cfg, { fetcher });
    const proof = Buffer.alloc(128, 42).toString("base64");
    await t.test(
      "challenge commits the mainnet vault, recipient and policy",
      () => {
        assert.equal(j.chainId, 4663);
        assert.equal(j.policyHash, PLAN_HASH);
        assert.equal(
          Buffer.from(j.mining_job.incomplete_header_bytes, "base64").length,
          76,
        );
      },
    );
    await t.test(
      "a verified winner creates one round allocation, not a per-task token mint",
      async () => {
        const r = await share(
          s,
          c,
          w,
          { jobId: j.id, plainProof: proof },
          { fetcher },
        );
        assert(r.roundWon);
        assert.equal(r.tokenReward, null);
        assert(BigInt(r.roundReward) > 0n);
        assert.equal(s.get("SELECT COUNT(*) n FROM compute_shares").n, 1);
      },
    );
    await t.test(
      "the same challenge cannot create a second accepted share",
      async () =>
        await assert.rejects(
          () => share(s, c, w, { jobId: j.id, plainProof: proof }, { fetcher }),
          (e) => e.status === 409,
        ),
    );
    await t.test("epoch cannot be prepared before UTC closure", () =>
      assert.throws(() => prepareEpoch(s, c, j.epoch), /Settlement opens/),
    );
    await t.test(
      "closed earned allocation remains within its daily emission budget",
      () => {
        const m = prepareEpoch(s, c, j.epoch, (j.epoch + 1) * 86400 + 301);
        assert.equal(m.allocations[0].address, addresses[0]);
        assert.equal(
          m.budget,
          s.get("SELECT reward FROM compute_rounds WHERE id=?", j.round.id)
            .reward,
        );
        assert.equal(
          prepareEpoch(s, c, j.epoch, (j.epoch + 1) * 86400 + 302).root,
          m.root,
        );
      },
    );
  } finally {
    s.close();
  }
});
test("real GPU adapters are tested separately; queue fixtures verify quorum and ledger conservation", async (t) => {
  const { s, c } = setup();
  try {
    configureGpuModel(s, {
      id: "gpu/tiny",
      model: "tests/tiny",
      revision: "ab".repeat(20),
      priceMicros: 1000,
      maxOutput: 128,
      enabled: true,
    });
    const ws = addresses.slice(1).map((address, i) => {
      const token = (i ? "d4" : "c3").repeat(32),
        w = connectWorker(
          s,
          { address, name: "gpu" + i, kind: "inference" },
          token,
        );
      report(s, worker(s, token), gpuReport);
      approveGpuWorker(s, w.id, ["gpu/tiny"]);
      return worker(s, token);
    });
    const key = createKey(s, addresses[0], { name: "GPU fixture" }),
      p = principal(
        new Request(c.origin, {
          headers: { authorization: "Bearer " + key.key },
        }),
        s,
        c,
      );
    const j = enqueue(
      s,
      c,
      p,
      {
        model: "gpu/tiny",
        messages: [{ role: "user", content: "hello" }],
        max_tokens: 16,
      },
      "gpu-request-001",
    );
    const leases = ws.map((w) => lease(s, c, w, ["gpu/tiny"]));
    const result = {
      model: "tests/tiny",
      revision: "ab".repeat(20),
      text: "fixture response",
      input_tokens: 3,
      output_tokens: 2,
    };
    await t.test("a single result never completes or bills the job", () => {
      assert(!submitResult(s, c, ws[0], { ...leases[0], result }).jobCompleted);
      assert.equal(s.account(addresses[0]).balance, 100000);
    });
    await t.test(
      "two separate approved wallets must agree before worker credits are paid",
      () => {
        assert(
          submitResult(s, c, ws[1], { ...leases[1], result }).jobCompleted,
        );
        assert.equal(
          getJob(s, c, addresses[0], j.id).result.text,
          "fixture response",
        );
        assert.equal(s.account(addresses[0]).balance, 99000);
        assert.equal(s.account(addresses[1]).balance, 400);
        assert.equal(s.account(addresses[2]).balance, 400);
        assert.throws(() =>
          submitResult(s, c, ws[1], { ...leases[1], result }),
        );
      },
    );
    await t.test("another wallet cannot read the encrypted job result", () =>
      assert.throws(() => getJob(s, c, addresses[1], j.id)),
    );
    await t.test(
      "expired queued work releases the customer ceiling without worker rewards",
      () => {
        const second = enqueue(
          s,
          c,
          p,
          {
            model: "gpu/tiny",
            messages: [{ role: "user", content: "again" }],
            max_tokens: 16,
          },
          "gpu-request-002",
        );
        expireJobs(s, nowSeconds() + 1801);
        assert.equal(getJob(s, c, addresses[0], second.id).state, "failed");
        assert.equal(s.account(addresses[0]).held, 0);
        assert.equal(s.account(addresses[0]).balance, 99000);
      },
    );
  } finally {
    s.close();
  }
});
test("HTTP API denies unauthenticated key management and rejects cross-origin wallet authorization", async () => {
  const { s, c } = setup();
  try {
    const req = (path) =>
      new Request(c.origin + "/api/compute/" + path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        body: JSON.stringify({ address: addresses[0] }),
      });
    assert.equal((await handle(req("auth/challenge"), s, c)).status, 403);
    assert.equal((await handle(req("keys"), s, c)).status, 401);
    const status = await (
      await handle(new Request(c.origin + "/api/compute/status"), s, c)
    ).json();
    assert.equal(status.chainId, 4663);
    assert(!JSON.stringify(status).includes(c.storageKey));
    assert(!JSON.stringify(status).includes(c.verifierToken));
  } finally {
    s.close();
  }
});
test("epoch recipient backpressure rejects a new wallet before any winning credit", async () => {
  const { s, c } = setup();
  try {
    const token = "21".repeat(32);
    connectWorker(
      s,
      { address: addresses[0], name: "capacity-fixture" },
      token,
    );
    report(s, worker(s, token), gpuReport);
    const w = worker(s, token);
    const fetcher = async (url, options) => {
      const v = {
        upstream_commit: gpuReport.upstreamCommit,
        supported_protocols: [PROTOCOL],
        round_target_policy: "perla-mainnet-rounds-v1",
      };
      if (url.endsWith("/health")) return Response.json(v);
      const p = JSON.parse(options.body);
      return Response.json({
        ...v,
        protocol: PROTOCOL,
        valid: true,
        round_valid: true,
        round_bits: p.round_bits,
        header_hash: sha(Buffer.from(p.header, "base64")),
        proof_hash: sha(Buffer.from(p.plain_proof, "base64")),
      });
    };
    const j = await work(s, c, w, { fetcher });
    s.tx(() => {
      for (let n = 1; n <= 10000; n++) {
        const id = "capacity-" + n,
          address = "0x" + n.toString(16).padStart(40, "0");
        s.run(
          "INSERT INTO compute_jobs VALUES(?,?,?,?,?,?,?,?)",
          id,
          w.id,
          j.round.id,
          j.mining_job.incomplete_header_bytes,
          j.created,
          j.expires,
          j.epoch,
          PLAN_HASH,
        );
        s.run(
          "INSERT INTO compute_shares VALUES(?,?,?,?,?,?,?,?,?,?)",
          id,
          id,
          w.id,
          address,
          j.round.id,
          j.epoch,
          n.toString(16).padStart(64, "0"),
          "software fixture",
          j.created,
          0,
        );
      }
    });
    await assert.rejects(
      () =>
        share(
          s,
          c,
          w,
          { jobId: j.id, plainProof: Buffer.alloc(128, 91).toString("base64") },
          { fetcher },
        ),
      (e) => e.code === "epoch_capacity",
    );
    assert.equal(s.get("SELECT COUNT(*) n FROM compute_shares").n, 10000);
    assert.equal(
      s.get("SELECT state FROM compute_rounds WHERE id=?", j.round.id).state,
      "open",
    );
  } finally {
    s.close();
  }
});
