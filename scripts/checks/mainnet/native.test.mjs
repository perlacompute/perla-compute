import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { mock } from "node:test";
import { ComputeStore } from "../../../lib/compute/store.mjs";
import {
  readConfig,
  activationHash,
  nowSeconds,
  PLAN_HASH,
  PROTOCOL,
} from "../../../lib/compute/config.mjs";
import {
  connectWorker,
  worker,
  report,
  work,
  share,
  nativeCall,
} from "../../../lib/compute/mining.mjs";
const python = process.env.PERLA_NATIVE_PYTHON,
  source = process.env.PERLA_PEARL_SOURCE;
if (!python || !source)
  throw Error(
    "Set PERLA_NATIVE_PYTHON and PERLA_PEARL_SOURCE; this test never substitutes a verifier stub.",
  );
mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 5, 12) });
const secret = "test-only-authenticated-mainnet-verifier-".repeat(2),
  server = spawn(
    python,
    [resolve("services/compute-worker/native-verifier.py"), "--port", "0"],
    {
      env: {
        ...process.env,
        PERLA_PEARL_SOURCE: source,
        PERLA_VERIFIER_TOKEN: secret,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
let errors = "";
server.stderr.on("data", (x) => (errors += x));
const port = await new Promise((yes, no) => {
  const timer = setTimeout(
    () => no(Error("Verifier startup failed: " + errors)),
    20000,
  );
  server.on("exit", () => {
    clearTimeout(timer);
    no(Error("Verifier exited: " + errors));
  });
  server.stdout.on("data", (x) => {
    const match = String(x).match(/127\.0\.0\.1:(\d+)/);
    if (match) {
      clearTimeout(timer);
      yes(Number(match[1]));
    }
  });
});
const s = new ComputeStore(),
  c = readConfig({
    PERLA_PUBLIC_ORIGIN: "https://perla.example",
    PERLA_MAINNET_VERIFIER_URL: "http://127.0.0.1:" + port,
    PERLA_MAINNET_VERIFIER_TOKEN: secret,
  });
Object.assign(c, {
  token: "0x" + "44".repeat(20),
  rewardVault: "0x" + "55".repeat(20),
  creditVault: "0x" + "66".repeat(20),
  startEpoch: Math.floor(Date.now() / 86400000),
  features: { mining: true },
});
s.run("INSERT INTO compute_meta VALUES('activation',?)", activationHash(c));
s.run(
  "INSERT INTO compute_meta VALUES('chain_health',?)",
  JSON.stringify({
    miningFunded: "130000000000000000000000000",
    miningAllocated: "0",
    checkedAt: nowSeconds(),
  }),
);
let count = 0;
const check = async (name, fn) => {
  await fn();
  count++;
  console.log("PASS " + name);
};
try {
  const token = "ab".repeat(32),
    identity = connectWorker(
      s,
      { address: "0x" + "11".repeat(20), name: "cpu-native-fixture" },
      token,
    ),
    w = worker(s, token);
  report(s, w, {
    version: "0.5.0",
    upstreamCommit: "82e6eee7076aafe10123e08db78f100d270c0582",
    gpuSelfTestPassed: true,
    device: {
      computeCapability: 89,
      name: "CPU FIXTURE, NOT A GPU ATTESTATION",
    },
    cases: [2048, 4096].map((k) => ({
      k,
      fullGemmMatchesReference: true,
      allTranscriptsMatchReference: true,
      signedExtremesMatchReference: true,
      nativeV3ProofAccepted: true,
      nonWinningPowRejected: true,
      changedChallengeRejected: true,
    })),
  });
  const current = worker(s, token),
    j = await work(s, c, current);
  await check("mainnet challenge commits the expected domain", () => {
    assert.equal(j.chainId, 4663);
    assert.equal(j.protocol, PROTOCOL);
    assert.equal(j.policyHash, PLAN_HASH);
    assert.equal(j.workerId, identity.id);
  });
  const generated = spawnSync(
    python,
    [resolve("services/pearl-adapter/native-fixture.py")],
    {
      input: JSON.stringify({ header: j.mining_job.incomplete_header_bytes }),
      encoding: "utf8",
      timeout: 300000,
      env: { ...process.env, RAYON_NUM_THREADS: "2" },
    },
  );
  assert.ifError(generated.error);
  assert.equal(generated.status, 0, generated.stderr);
  const proof = JSON.parse(generated.stdout);
  await check("native verifier rejects missing authentication", async () => {
    const r = await fetch(c.verifierUrl + "/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(r.status, 401);
  });
  const payload = {
      protocol: PROTOCOL,
      cert_version: 3,
      header: j.mining_job.incomplete_header_bytes,
      plain_proof: proof.plain_proof,
      round_bits: j.round.bits,
    },
    v = await nativeCall(c, "/verify", payload);
  await check(
    "pinned Rust validates a genuine mainnet-domain CPU-generated proof",
    () => assert.equal(v.valid, true),
  );
  await check(
    "harder round verdict agrees with an independent native target check",
    () => {
      const code =
        "import sys,json,base64,pearl_mining as p\nv=json.load(sys.stdin)\nh=p.IncompleteBlockHeader.from_bytes(base64.b64decode(v['header']))\na=p.PlainProof.from_base64(v['plain_proof'])\nok,_=p.verify_plain_proof_for_cert_version(3,h,a,nbits_override=v['round_bits'])\nprint(json.dumps(bool(ok)))";
      const r = spawnSync(python, ["-c", code], {
        input: JSON.stringify(payload),
        encoding: "utf8",
        timeout: 30000,
      });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(v.round_valid, JSON.parse(r.stdout));
    },
  );
  await check(
    "Python mainnet worker independently validates the same job commitment",
    () => {
      const code =
        "import json,importlib.util,sys\ns=importlib.util.spec_from_file_location('mainnet_entry',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nj=json.load(sys.stdin)\nassert len(m.validate_job(j,j['created'],'https://perla.example'))==76\nj['chainId']=46630\ntry:m.validate_job(j,j['created'],'https://perla.example');raise AssertionError('wrong chain accepted')\nexcept ValueError:pass\n";
      const r = spawnSync(
        python,
        ["-c", code, resolve("services/compute-worker/mainnet-entry.py")],
        {
          input: JSON.stringify(j),
          encoding: "utf8",
          env: {
            ...process.env,
            PERLA_MAINNET_WORKER_ID: identity.id,
            PERLA_MAINNET_REWARD_WALLET: w.address,
            PERLA_MAINNET_REWARD_VAULT: c.rewardVault,
          },
        },
      );
      assert.equal(r.status, 0, r.stderr);
    },
  );
  await check("a changed challenge fails native verification", async () => {
    const raw = Buffer.from(payload.header, "base64");
    raw[40] ^= 1;
    const changed = await nativeCall(c, "/verify", {
      ...payload,
      header: raw.toString("base64"),
    });
    assert.equal(changed.valid, false);
  });
  await check(
    "genuine bound proof receives exactly one durable mainnet receipt",
    async () => {
      const r = await share(s, c, w, {
        jobId: j.id,
        plainProof: proof.plain_proof,
      });
      assert(r.accepted);
      assert.equal(s.get("SELECT COUNT(*) n FROM compute_shares").n, 1);
    },
  );
  await check(
    "replayed native proof never credits the same challenge twice",
    async () =>
      await assert.rejects(
        () => share(s, c, w, { jobId: j.id, plainProof: proof.plain_proof }),
        (e) => e.status === 409,
      ),
  );
  console.log(
    `${count} mainnet-native checks passed. CPU fixtures and real native verification; no physical GPU or public-chain payout was tested.`,
  );
} finally {
  server.kill();
  s.close();
  mock.timers.reset();
}
