import { randomUUID } from "node:crypto";
import {
  PLAN,
  PLAN_HASH,
  PROTOCOL,
  UPSTREAM_COMMIT,
  sha,
  demand,
  feature,
  nowSeconds,
  epochAt,
  targetBits,
  compactTarget,
  miningBudget,
  roundLimit,
  roundReward,
} from "./config.mjs";
import { wallet, throttle } from "./auth.mjs";
import { reserveReady, miningCapacity } from "./chain.mjs";
import { manifest, splitReward } from "./merkle.mjs";
export function connectWorker(
  s,
  { address, name, kind = "mining" },
  token,
  now = nowSeconds(),
) {
  address = wallet(address);
  demand(
    typeof name === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9_.-]{0,47}$/.test(name) &&
      ["mining", "inference"].includes(kind) &&
      /^[a-f0-9]{64}$/.test(token),
    400,
    "worker",
    "Use a valid worker name and a fresh private credential",
  );
  return s.tx(() => {
    const old = s.get(
      "SELECT * FROM compute_workers WHERE token_hash=?",
      sha(token),
    );
    if (old) {
      demand(
        !old.revoked &&
          old.address === address &&
          old.name === name &&
          old.kind === kind,
        409,
        "worker_identity",
        "Saved credential belongs to another worker",
      );
      return { id: old.id, address, name, kind };
    }
    throttle(s, "registration", 120, now);
    demand(
      s.get(
        "SELECT COUNT(*) n FROM compute_workers WHERE address=? AND revoked IS NULL",
        address,
      ).n < 100,
      429,
      "worker_limit",
      "Active worker limit reached",
    );
    s.account(address, now);
    const id = randomUUID();
    s.run(
      "INSERT INTO compute_workers(id,address,name,token_hash,kind,created) VALUES(?,?,?,?,?,?)",
      id,
      address,
      name,
      sha(token),
      kind,
      now,
    );
    return { id, address, name, kind };
  });
}
export function worker(s, token) {
  demand(
    /^[a-f0-9]{64}$/.test(token || ""),
    401,
    "worker",
    "Worker credential required",
  );
  const w = s.get(
    "SELECT * FROM compute_workers WHERE token_hash=? AND revoked IS NULL",
    sha(token),
  );
  demand(w, 401, "worker", "Worker credential is invalid or was replaced");
  return w;
}
export const currentWorker = (s, w) =>
  demand(
    s.get(
      "SELECT id FROM compute_workers WHERE id=? AND token_hash=? AND revoked IS NULL",
      w.id,
      w.token_hash,
    ),
    401,
    "worker_changed",
    "Worker credential was replaced",
  );
export function validateReport(r) {
  return (
    r &&
    r.version === "0.5.0" &&
    r.upstreamCommit === UPSTREAM_COMMIT &&
    r.gpuSelfTestPassed === true &&
    [86, 89, 90, 120].includes(Number(r.device?.computeCapability)) &&
    Array.isArray(r.cases) &&
    [2048, 4096].every((k) =>
      r.cases.some(
        (c) =>
          c.k === k &&
          [
            "fullGemmMatchesReference",
            "allTranscriptsMatchReference",
            "signedExtremesMatchReference",
            "nativeV3ProofAccepted",
            "nonWinningPowRejected",
            "changedChallengeRejected",
          ].every((key) => c[key] === true),
      ),
    )
  );
}
export function report(s, w, r, now = nowSeconds()) {
  demand(
    validateReport(r),
    400,
    "gpu_report",
    "Run the full GPU self-test and upload both passing cases",
  );
  currentWorker(s, w);
  s.run(
    "UPDATE compute_workers SET gpu_report=?,last_seen=? WHERE id=?",
    JSON.stringify(r),
    now,
    w.id,
  );
  return { uploaded: true, creditCreated: false };
}
export function reconnectStart(
  s,
  { workerId, code },
  token,
  now = nowSeconds(),
) {
  demand(
    /^[a-f0-9]{64}$/.test(token || "") && /^[A-F0-9]{12}$/.test(code || ""),
    400,
    "reconnect",
    "Private reconnect credential and confirmation code required",
  );
  const w = s.get(
    "SELECT id,address,name FROM compute_workers WHERE id=? AND revoked IS NULL",
    workerId,
  );
  demand(w, 404, "worker", "Worker not found");
  throttle(s, "reconnect:" + workerId, 5, now, 600);
  const id = randomUUID();
  s.run(
    "INSERT INTO compute_reconnects VALUES(?,?,?,?,?,NULL,NULL)",
    id,
    workerId,
    sha(token),
    sha(code),
    now + 600,
  );
  return { id, workerId, address: w.address, name: w.name, expires: now + 600 };
}
export function reconnectApprove(s, address, { id, code }, now = nowSeconds()) {
  demand(
    typeof id === "string" && typeof code === "string",
    400,
    "reconnect",
    "Request and confirmation code required",
  );
  demand(
    s.run(
      "UPDATE compute_reconnects SET approved=? WHERE id=? AND code_hash=? AND expires>? AND consumed IS NULL AND worker_id IN(SELECT id FROM compute_workers WHERE address=? AND revoked IS NULL)",
      now,
      id,
      sha(code),
      now,
      address,
    ).changes === 1,
    409,
    "reconnect",
    "Code is incorrect, expired or belongs to another wallet",
  );
  return { approved: true };
}
export function reconnectExchange(s, id, token, now = nowSeconds()) {
  return s.tx(() => {
    const r = s.get(
      "SELECT * FROM compute_reconnects WHERE id=? AND candidate_hash=?",
      id,
      sha(token),
    );
    demand(r, 409, "reconnect", "Reconnect request not found");
    if (r.consumed !== null) {
      const recovered = s.get(
        "SELECT id,address,name,kind FROM compute_workers WHERE id=? AND token_hash=? AND revoked IS NULL",
        r.worker_id,
        r.candidate_hash,
      );
      demand(
        recovered,
        409,
        "reconnect",
        "This request was superseded by another exchange",
      );
      return {
        ...recovered,
        pending: false,
        oldCredentialDisabled: true,
        recovered: true,
      };
    }
    demand(
      r.expires > now,
      409,
      "reconnect_expired",
      "Reconnect request expired; start another request on the same new machine",
    );
    if (r.approved === null) return { pending: true };
    demand(
      s.run(
        "UPDATE compute_workers SET token_hash=?,gpu_report=NULL,last_seen=NULL WHERE id=? AND revoked IS NULL",
        r.candidate_hash,
        r.worker_id,
      ).changes === 1,
      409,
      "worker",
      "Worker was revoked",
    );
    s.run(
      "UPDATE compute_reconnects SET consumed=? WHERE worker_id=? AND consumed IS NULL",
      now,
      r.worker_id,
    );
    return {
      ...s.get(
        "SELECT id,address,name,kind FROM compute_workers WHERE id=?",
        r.worker_id,
      ),
      pending: false,
      oldCredentialDisabled: true,
    };
  });
}
export async function nativeCall(c, path, payload, fetcher = fetch) {
  demand(
    c.verifierUrl && c.verifierToken.length >= 32,
    503,
    "verifier",
    "Authenticated mainnet verifier is required",
  );
  const r = await fetcher(c.verifierUrl.replace(/\/$/, "") + path, {
    method: payload ? "POST" : "GET",
    headers: {
      authorization: "Bearer " + c.verifierToken,
      "content-type": "application/json",
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(25000),
  });
  demand(
    r.ok,
    503,
    "verifier",
    "Native verifier is busy or unavailable; no credit was created",
  );
  const data = await r.json();
  demand(
    data.upstream_commit === UPSTREAM_COMMIT &&
      (path === "/health"
        ? data.supported_protocols?.includes(PROTOCOL)
        : data.protocol === PROTOCOL) &&
      data.round_target_policy === "perla-mainnet-rounds-v1",
    503,
    "verifier_policy",
    "Verifier does not match the pinned mainnet protocol",
  );
  return data;
}
const roundInfo = (r, c) => ({
  id: r.id,
  epoch: r.epoch,
  policy: "perla-mainnet-rounds-v1",
  policyHash: PLAN_HASH,
  bits: r.bits,
  workUnits: r.work_units,
  windowWorkUnits: r.work_units * 2,
  rewardBaseUnits: roundReward(r.epoch, c.startEpoch).toString(),
  opened: r.opened,
  state: r.state,
});
function openRound(s, c, now) {
  const epoch = epochAt(now);
  demand(
    miningBudget(epoch, c.startEpoch) > 0n && now < (epoch + 1) * 86400 - 10,
    503,
    "epoch_closed",
    "Mining resumes in the next funded UTC window",
  );
  s.run(
    "UPDATE compute_rounds SET state='expired',closed=? WHERE state='open' AND epoch<?",
    now,
    epoch,
  );
  let r = s.get(
    "SELECT * FROM compute_rounds WHERE epoch=? AND state='open'",
    epoch,
  );
  if (r) return r;
  demand(
    s.get(
      "SELECT COUNT(*) n FROM compute_rounds WHERE epoch=? AND state='won'",
      epoch,
    ).n < roundLimit(epoch, c.startEpoch),
    503,
    "round_cap",
    "Daily winning-round cap reached",
  );
  const recent = s.all(
      "SELECT * FROM compute_rounds WHERE state='won' ORDER BY rowid DESC LIMIT 16",
    ),
    total = s.get("SELECT COUNT(*) n FROM compute_rounds WHERE state='won'").n;
  let units = recent[0]?.work_units || PLAN.initialWorkUnits;
  if (total && total % 16 === 0 && recent.length === 16) {
    const duration = recent.reduce(
      (n, x) => n + Math.max(1, x.closed - x.opened),
      0,
    );
    if (duration < (PLAN.targetSeconds * PLAN.retargetRounds) / 2)
      units = Math.min(65536, units * 2);
    if (duration > PLAN.targetSeconds * PLAN.retargetRounds * 2)
      units = Math.max(256, units / 2);
  }
  const id = randomUUID();
  s.run(
    "INSERT INTO compute_rounds(id,epoch,state,bits,work_units,opened,policy_hash) VALUES(?,?,'open',?,?,?,?)",
    id,
    epoch,
    targetBits(units),
    units,
    now,
    PLAN_HASH,
  );
  return s.get("SELECT * FROM compute_rounds WHERE id=?", id);
}
export function header(c, w, r, id, now) {
  const epoch = epochAt(now),
    a = Buffer.from(
      sha(
        `perla-mainnet-work-v1|4663|${c.origin}|${c.rewardVault.toLowerCase()}|${epoch}|round=${r.id}|policy=${PLAN_HASH}`,
      ),
      "hex",
    ).reverse(),
    b = Buffer.from(
      sha(
        `perla-mainnet-recipient-v1|4663|${w.id}|${w.address}|${epoch}|${id}`,
      ),
      "hex",
    ).reverse(),
    out = Buffer.alloc(76);
  out.writeUInt32LE(1);
  a.copy(out, 4);
  b.copy(out, 36);
  out.writeUInt32LE(now, 68);
  out.writeUInt32LE(PLAN.shareBits, 72);
  return out.toString("base64");
}
export async function work(
  s,
  c,
  w,
  { request, client, fetcher = fetch, now = nowSeconds() } = {},
) {
  demand(
    w.kind === "mining" && w.gpu_report,
    409,
    "gpu_validation",
    "Run this machine’s GPU self-test first",
  );
  if (request)
    demand(
      request.headers.get("x-perla-protocol") === PROTOCOL &&
        request.headers.get("x-perla-mainnet-policy") === PLAN_HASH,
      426,
      "worker_upgrade",
      "Use the prepared mainnet worker",
    );
  const funding = await reserveReady(s, c, client, now);
  await nativeCall(c, "/health", null, fetcher);
  return s.tx(() => {
    currentWorker(s, w);
    throttle(s, "work:" + w.id, 60, now);
    miningCapacity(s,c,funding,epochAt(now));
    const r = openRound(s, c, now);
    let j = s.get(
      "SELECT j.* FROM compute_jobs j LEFT JOIN compute_shares sh ON sh.job_id=j.id WHERE j.worker_id=? AND j.round_id=? AND j.expires>? AND sh.id IS NULL ORDER BY j.rowid DESC LIMIT 1",
      w.id,
      r.id,
      now,
    );
    if (!j) {
      const id = randomUUID();
      s.run(
        "INSERT INTO compute_jobs VALUES(?,?,?,?,?,?,?,?)",
        id,
        w.id,
        r.id,
        header(c, w, r, id, now),
        now,
        Math.min(now + 300, (r.epoch + 1) * 86400),
        r.epoch,
        PLAN_HASH,
      );
      j = s.get("SELECT * FROM compute_jobs WHERE id=?", id);
    }
    s.run("UPDATE compute_workers SET last_seen=? WHERE id=?", now, w.id);
    return {
      id: j.id,
      created: j.created,
      expires: j.expires,
      epoch: j.epoch,
      protocol: PROTOCOL,
      chainId: 4663,
      recipient: w.address,
      workerId: w.id,
      vault: c.rewardVault.toLowerCase(),
      policyHash: PLAN_HASH,
      round: roundInfo(r, c),
      workPolicy: {
        hash: PLAN_HASH,
        profile: "p1",
        points: 1,
        bits: PLAN.shareBits,
      },
      mining_job: {
        incomplete_header_bytes: j.header,
        target: compactTarget(PLAN.shareBits).toString(),
        cert_version: 3,
      },
    };
  });
}
export async function share(
  s,
  c,
  w,
  body,
  { fetcher = fetch, now = nowSeconds() } = {},
) {
  feature(s, c, "mining");
  throttle(s, "share:" + w.id, 30, now);
  const j = s.get(
    "SELECT * FROM compute_jobs WHERE id=? AND worker_id=?",
    body.jobId,
    w.id,
  );
  demand(j, 409, "job", "Challenge belongs to another worker");
  demand(
    j.expires > now && j.epoch === epochAt(now),
    409,
    "job_expired",
    "Challenge expired; request another job",
  );
  demand(
    !s.get("SELECT id FROM compute_shares WHERE job_id=?", j.id),
    409,
    "already_credited",
    "Challenge was already credited",
  );
  const r = s.get("SELECT * FROM compute_rounds WHERE id=?", j.round_id);
  demand(
    r?.state === "open" && j.policy_hash === PLAN_HASH,
    409,
    "round_closed",
    "Round changed; request another job",
  );
  demand(
    typeof body.plainProof === "string" &&
      body.plainProof.length <= 7 * 1024 * 1024 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(body.plainProof),
    400,
    "proof",
    "Invalid native proof",
  );
  const bytes = Buffer.from(body.plainProof, "base64");
  demand(
    bytes.length >= 64 && bytes.toString("base64") === body.plainProof,
    400,
    "proof",
    "Proof must use canonical base64",
  );
  const v = await nativeCall(
    c,
    "/verify",
    {
      header: j.header,
      plain_proof: body.plainProof,
      cert_version: 3,
      protocol: PROTOCOL,
      round_bits: r.bits,
    },
    fetcher,
  );
  demand(
    v.valid === true &&
      v.header_hash === sha(Buffer.from(j.header, "base64")) &&
      v.proof_hash === sha(bytes) &&
      v.round_bits === r.bits,
    422,
    "invalid_proof",
    "Proof did not verify against this challenge",
  );
  return s.tx(() => {
    const accepted = nowSeconds();
    feature(s, c, "mining");
    currentWorker(s, w);
    demand(
      j.expires > accepted && j.epoch === epochAt(accepted),
      409,
      "job_expired",
      "Challenge expired during verification",
    );
    demand(
      s.get(
        "SELECT id FROM compute_rounds WHERE id=? AND state='open'",
        r.id,
      ) && !s.get("SELECT epoch FROM compute_epochs WHERE epoch=?", j.epoch),
      409,
      "round_closed",
      "Round was closed",
    );
    demand(
      !s.get(
        "SELECT id FROM compute_shares WHERE job_id=? OR proof_hash=?",
        j.id,
        v.proof_hash,
      ),
      409,
      "already_credited",
      "Proof or challenge was already credited",
    );
    // Keep every potential epoch root within the manifest's bounded recipient set.
    // Prior-window recipients are at most 131,072; new epoch wallets are capped at 10,000.
    demand(
      s.get(
        "SELECT id FROM compute_shares WHERE epoch=? AND address=? LIMIT 1",
        j.epoch,
        w.address,
      ) ||
        s.get(
          "SELECT COUNT(DISTINCT address) n FROM compute_shares WHERE epoch=?",
          j.epoch,
        ).n < 10000,
      503,
      "epoch_capacity",
      "This epoch has reached its new-recipient capacity; no work was credited",
    );
    const reserve=s.get("SELECT value FROM compute_meta WHERE key='chain_health'");
    miningCapacity(s,c,reserve?JSON.parse(reserve.value):null,j.epoch);
    const id = randomUUID();
    s.run(
      "INSERT INTO compute_shares VALUES(?,?,?,?,?,?,?,?,?,?)",
      id,
      j.id,
      w.id,
      w.address,
      r.id,
      j.epoch,
      v.proof_hash,
      body.plainProof,
      accepted,
      v.round_valid ? 1 : 0,
    );
    let reward = "0";
    if (v.round_valid) {
      const weights = new Map();
      for (const row of s.all(
        "SELECT address FROM compute_shares ORDER BY rowid DESC LIMIT ?",
        r.work_units * 2,
      ))
        weights.set(row.address, (weights.get(row.address) || 0) + 1);
      reward = roundReward(r.epoch, c.startEpoch).toString();
      s.run(
        "UPDATE compute_rounds SET state='won',closed=?,winner_share=?,reward=?,snapshot=? WHERE id=?",
        accepted,
        id,
        reward,
        JSON.stringify(splitReward(BigInt(reward), weights)),
        r.id,
      );
    }
    s.run("UPDATE compute_workers SET last_seen=? WHERE id=?", accepted, w.id);
    return {
      id,
      accepted: true,
      workWeight: 1,
      epoch: j.epoch,
      roundId: r.id,
      roundWon: !!v.round_valid,
      roundReward: reward,
      tokenReward: null,
    };
  });
}
export function prepareEpoch(s, c, epoch, now = nowSeconds()) {
  demand(
    Number.isSafeInteger(epoch) && (epoch + 1) * 86400 + 300 <= now,
    409,
    "epoch_open",
    "Settlement opens five minutes after UTC close",
  );
  s.pin(c);
  return s.tx(() => {
    const old = s.get(
      "SELECT manifest FROM compute_epochs WHERE epoch=?",
      epoch,
    );
    if (old) return JSON.parse(old.manifest);
    const rounds = s.all(
      "SELECT * FROM compute_rounds WHERE epoch=? AND state='won' ORDER BY rowid",
      epoch,
    );
    demand(
      rounds.length > 0 && rounds.length <= roundLimit(epoch, c.startEpoch),
      409,
      "no_rewards",
      "No qualifying reward rounds exist",
    );
    const rows = [];
    for (const r of rounds) {
      demand(
        r.policy_hash === PLAN_HASH &&
          r.reward === roundReward(epoch, c.startEpoch).toString() &&
          s.get(
            "SELECT id FROM compute_shares WHERE id=? AND round_id=? AND round_won=1",
            r.winner_share,
            r.id,
          ),
        409,
        "round_integrity",
        "Round evidence differs from the policy",
      );
      rows.push(...JSON.parse(r.snapshot));
    }
    const m = manifest(c.rewardVault, 0, epoch, rows);
    demand(
      BigInt(m.budget) <= miningBudget(epoch, c.startEpoch),
      409,
      "emission_cap",
      "Epoch exceeds its budget",
    );
    s.run(
      "INSERT INTO compute_epochs VALUES(?,?,?,?,'prepared',NULL,?)",
      epoch,
      JSON.stringify(m),
      m.root,
      m.budget,
      now,
    );
    return m;
  });
}
export function analytics(s, c, address, now = nowSeconds()) {
  let earned = 0n;
  for (const r of s.all(
    "SELECT snapshot FROM compute_rounds WHERE state='won'",
  ))
    for (const a of JSON.parse(r.snapshot))
      if (!address || a.address === address) earned += BigInt(a.amount);
  const where = address ? " WHERE address=?" : "",
    args = address ? [address] : [];
  return {
    chainId: 4663,
    policyHash: PLAN_HASH,
    earnedBaseUnits: earned.toString(),
    dailyCap: miningBudget(epochAt(now), c.startEpoch).toString(),
    totalShares: s.get("SELECT COUNT(*) n FROM compute_shares" + where, ...args)
      .n,
    workers: address
      ? s
          .all(
            "SELECT id,name,kind,last_seen,gpu_report,revoked FROM compute_workers WHERE address=? ORDER BY rowid DESC LIMIT 100",
            address,
          )
          .map((w) => ({
            ...w,
            gpu_report: undefined,
            gpu: w.gpu_report ? JSON.parse(w.gpu_report).device?.name : null,
            online: !!w.last_seen && now - w.last_seen < 90,
          }))
      : [],
    rounds: s.all(
      "SELECT id,epoch,state,work_units,opened,closed,reward,winner_share FROM compute_rounds ORDER BY rowid DESC LIMIT 50",
    ),
    receipts: s.all(
      "SELECT id,job_id,worker_id,address,round_id,epoch,proof_hash,accepted,round_won FROM compute_shares" +
        where +
        " ORDER BY rowid DESC LIMIT 50",
      ...args,
    ),
    epochs: s.all(
      "SELECT epoch,root,budget,state,tx_hash FROM compute_epochs ORDER BY epoch DESC LIMIT 50",
    ),
  };
}
