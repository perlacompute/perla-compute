import { randomUUID } from "node:crypto";
import {
  feature,
  demand,
  sha,
  seal,
  unseal,
  secret,
  nowSeconds,
} from "./config.mjs";
import { reserve, dispatching, billInTransaction, fail } from "./billing.mjs";
import { currentWorker } from "./mining.mjs";
export function configureGpuModel(s, b, now = nowSeconds()) {
  demand(
    typeof b.id === "string" &&
      /^gpu\/[a-z0-9-]{1,80}$/.test(b.id) &&
      typeof b.model === "string" &&
      b.model.length <= 150 &&
      /^[a-f0-9]{40,64}$/.test(b.revision || "") &&
      Number.isSafeInteger(b.priceMicros) &&
      b.priceMicros >= 100 &&
      b.priceMicros <= 10000000 &&
      Number.isInteger(b.maxOutput) &&
      b.maxOutput >= 1 &&
      b.maxOutput <= 1024,
    400,
    "gpu_model",
    "Pin a model/revision, bounded per-job price, and output allowance",
  );
  const d = {
    id: b.id,
    name: String(b.name || b.model).slice(0, 100),
    model: b.model,
    revision: b.revision,
    priceMicros: b.priceMicros,
    maxOutput: b.maxOutput,
    workerShareBps: 8000,
    verification:
      "Two matching outputs from separately approved worker wallets; this is replicated agreement, not semantic proof.",
  };
  s.run(
    "INSERT INTO compute_gpu_models VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition,enabled=excluded.enabled",
    d.id,
    JSON.stringify(d),
    b.enabled ? 1 : 0,
  );
  s.audit(
    "gpu_model",
    d.id,
    { revision: d.revision, enabled: !!b.enabled },
    now,
  );
  return d;
}
export function approveGpuWorker(s, workerId, models, now = nowSeconds()) {
  demand(
    s.get(
      "SELECT id FROM compute_workers WHERE id=? AND kind='inference' AND revoked IS NULL AND gpu_report IS NOT NULL",
      workerId,
    ) &&
      Array.isArray(models) &&
      models.length > 0 &&
      models.every((id) =>
        s.get("SELECT id FROM compute_gpu_models WHERE id=?", id),
      ),
    409,
    "gpu_approval",
    "Approve a validated inference worker for configured models",
  );
  s.run(
    "INSERT INTO compute_gpu_approvals VALUES(?,?,?,NULL) ON CONFLICT(worker_id) DO UPDATE SET models=excluded.models,approved=excluded.approved,revoked=NULL",
    workerId,
    JSON.stringify(models),
    now,
  );
  return { approved: true };
}
export function gpuCatalog(s, now = nowSeconds()) {
  return s.all("SELECT * FROM compute_gpu_models").map((r) => {
    const m = JSON.parse(r.definition),
      owners = new Set(
        s
          .all(
            "SELECT w.address,a.models FROM compute_workers w JOIN compute_gpu_approvals a ON a.worker_id=w.id WHERE w.revoked IS NULL AND a.revoked IS NULL AND w.last_seen>?",
            now - 120,
          )
          .filter((a) => JSON.parse(a.models).includes(m.id))
          .map((a) => a.address),
      );
    return {
      ...m,
      kind: "gpu-job",
      available: !!r.enabled && owners.size >= 2,
      independentWallets: owners.size,
    };
  });
}
export function enqueue(s, c, p, b, idem, now = nowSeconds()) {
  feature(s, c, "gpu");
  if (c.gpuAdmission === "operator")
    demand(
      p.address === c.owner?.toLowerCase(),
      503,
      "gpu_calibration",
      "GPU jobs are in the operator validation window",
    );
  const m = gpuCatalog(s, now).find((m) => m.id === b.model);
  demand(
    m?.available,
    503,
    "gpu_capacity",
    "Two approved online worker wallets are required",
  );
  demand(
    Array.isArray(b.messages) &&
      b.messages.length >= 1 &&
      b.messages.length <= 20 &&
      b.messages.every(
        (v) =>
          v &&
          ["system", "user", "assistant"].includes(v.role) &&
          typeof v.content === "string",
      ) &&
      Buffer.byteLength(JSON.stringify(b.messages)) <= 16000,
    400,
    "gpu_input",
    "Provide up to 20 text messages and 16 KB of input",
  );
  const max = Number(b.max_tokens ?? 256);
  demand(
    Number.isInteger(max) && max >= 1 && max <= m.maxOutput,
    400,
    "gpu_output",
    "Output allowance exceeds this GPU model",
  );
  const payload = {
    model: m.model,
    revision: m.revision,
    messages: b.messages,
    max_tokens: max,
    temperature: 0,
    seed: 0,
    stream: false,
  };
  const r = reserve(
    s,
    p,
    {
      idem,
      fingerprint: sha({ payload, price: m.priceMicros }),
      model: m.id,
      scope: "jobs",
      amount: m.priceMicros,
    },
    now,
  );
  if (r.reused) {
    const j = s.get(
      "SELECT id,state FROM compute_gpu_jobs WHERE request_id=?",
      r.id,
    );
    demand(j, 409, "job", "This request exists without a new job");
    return { ...j, reused: true };
  }
  const id = randomUUID();
  try {
    s.run(
      "INSERT INTO compute_gpu_jobs(id,request_id,address,model,payload,state,created,expires) VALUES(?,?,?,?,?,'queued',?,?)",
      id,
      r.id,
      p.address,
      m.id,
      seal(c, JSON.stringify(payload), "gpu:" + id),
      now,
      now + 1800,
    );
    dispatching(s, r.id, now);
  } catch (e) {
    fail(s, r.id, "queue_failed");
    throw e;
  }
  return { id, state: "queued", reservedMicros: m.priceMicros };
}
export function getJob(s, c, address, id) {
  const j = s.get(
    "SELECT * FROM compute_gpu_jobs WHERE id=? AND address=?",
    id,
    address,
  );
  demand(j, 404, "job", "Job not found");
  return {
    id: j.id,
    model: j.model,
    state: j.state,
    created: j.created,
    expires: j.expires,
    result: j.result
      ? JSON.parse(unseal(c, j.result, "gpu-result:" + j.id))
      : null,
    requestId: j.request_id,
  };
}
export function lease(s, c, w, models, now = nowSeconds()) {
  feature(s, c, "gpu");
  demand(
    w.kind === "inference" && w.gpu_report,
    403,
    "gpu_worker",
    "A validated inference worker is required",
  );
  const a = s.get(
    "SELECT models FROM compute_gpu_approvals WHERE worker_id=? AND revoked IS NULL",
    w.id,
  );
  demand(a, 403, "gpu_approval", "Inference worker requires operator approval");
  const allowed = JSON.parse(a.models).filter(
    (id) => Array.isArray(models) && models.includes(id),
  );
  return s.tx(() => {
    currentWorker(s, w);
    s.run("UPDATE compute_workers SET last_seen=? WHERE id=?", now, w.id);
    s.run(
      "UPDATE compute_gpu_leases SET state='expired' WHERE state='running' AND expires<=?",
      now,
    );
    for (const j of s.all(
      "SELECT * FROM compute_gpu_jobs WHERE state IN('queued','running') AND expires>? ORDER BY created LIMIT 100",
      now,
    )) {
      if (!allowed.includes(j.model)) continue;
      const active = s.all(
        "SELECT * FROM compute_gpu_leases WHERE job_id=? AND state IN('running','submitted')",
        j.id,
      );
      if (active.some((l) => l.address === w.address)) continue;
      const disagreements = new Set(
        active.filter((l) => l.state === "submitted").map((l) => l.result_hash),
      ).size;
      if (active.length >= (disagreements > 1 ? 3 : 2)) continue;
      const id = randomUUID(),
        token = secret();
      s.run(
        "DELETE FROM compute_gpu_leases WHERE job_id=? AND address=? AND state='expired'",
        j.id,
        w.address,
      );
      s.run(
        "INSERT INTO compute_gpu_leases VALUES(?,?,?,?,?,?,'running',NULL,NULL,?)",
        id,
        j.id,
        w.id,
        w.address,
        sha(token),
        Math.min(now + 300, j.expires),
        now,
      );
      s.run("UPDATE compute_gpu_jobs SET state='running' WHERE id=?", j.id);
      return {
        leaseId: id,
        jobId: j.id,
        leaseToken: token,
        expires: Math.min(now + 300, j.expires),
        payload: JSON.parse(unseal(c, j.payload, "gpu:" + j.id)),
      };
    }
    return { waiting: true, retrySeconds: 5 };
  });
}
export function submitResult(s, c, w, b, now = nowSeconds()) {
  feature(s, c, "gpu");
  demand(
    b.result &&
      typeof b.result.text === "string" &&
      b.result.text.length <= 65536 &&
      Number.isSafeInteger(b.result.input_tokens) &&
      b.result.input_tokens >= 0 &&
      Number.isSafeInteger(b.result.output_tokens) &&
      b.result.output_tokens > 0,
    400,
    "gpu_result",
    "Provide a bounded deterministic output with token counts",
  );
  return s.tx(() => {
    currentWorker(s, w);
    demand(
      s.get(
        "SELECT worker_id FROM compute_gpu_approvals WHERE worker_id=? AND revoked IS NULL",
        w.id,
      ),
      403,
      "gpu_approval",
      "Inference approval was revoked",
    );
    const l = s.get(
      "SELECT * FROM compute_gpu_leases WHERE id=? AND worker_id=? AND secret_hash=? AND state='running' AND expires>?",
      b.leaseId,
      w.id,
      sha(b.leaseToken || ""),
      now,
    );
    demand(l, 409, "gpu_lease", "Lease expired or was already submitted");
    const j = s.get("SELECT * FROM compute_gpu_jobs WHERE id=?", l.job_id);
    demand(
      j && ["queued", "running"].includes(j.state) && j.expires > now,
      409,
      "job_closed",
      "Job no longer accepts results",
    );
    const payload = JSON.parse(unseal(c, j.payload, "gpu:" + j.id)),
      r = b.result;
    demand(
      r.model === payload.model &&
        r.revision === payload.revision &&
        r.output_tokens <= payload.max_tokens,
      400,
      "gpu_revision",
      "Model, revision or output allowance differs",
    );
    const value = {
        model: r.model,
        revision: r.revision,
        text: r.text,
        input_tokens: r.input_tokens,
        output_tokens: r.output_tokens,
      },
      hash = sha(value);
    s.run(
      "UPDATE compute_gpu_leases SET state='submitted',result=?,result_hash=? WHERE id=?",
      seal(c, JSON.stringify(value), "lease:" + l.id),
      hash,
      l.id,
    );
    const submitted = s.all(
        "SELECT * FROM compute_gpu_leases WHERE job_id=? AND state='submitted'",
        j.id,
      ),
      matching = submitted.filter((x) => x.result_hash === hash);
    if (matching.length >= 2) {
      const request = s.get(
        "SELECT * FROM compute_requests WHERE id=?",
        j.request_id,
      );
      demand(
        request.state === "dispatching",
        409,
        "gpu_billing",
        "Job billing state differs",
      );
      billInTransaction(
        s,
        request,
        {
          charged: request.reserved,
          input: r.input_tokens,
          output: r.output_tokens,
        },
        now,
      );
      s.run(
        "UPDATE compute_gpu_jobs SET state='completed',result=?,completed=? WHERE id=?",
        seal(c, JSON.stringify(value), "gpu-result:" + j.id),
        now,
        j.id,
      );
      const payout = Math.floor((request.reserved * 4000) / 10000);
      for (const winner of matching.slice(0, 2)) {
        const account = s.account(winner.address, now);
        demand(
          Number.isSafeInteger(account.balance + payout),
          409,
          "credit_range",
          "Worker credit balance exceeded its range",
        );
        s.run(
          "UPDATE compute_accounts SET balance=balance+? WHERE address=?",
          payout,
          winner.address,
        );
        s.run(
          "INSERT INTO compute_ledger VALUES(?,?,?,?,?,?)",
          randomUUID(),
          winner.address,
          payout,
          "gpu_contribution",
          "gpu:" + j.id + ":" + winner.worker_id,
          now,
        );
      }
      s.audit(
        "gpu_agreement",
        j.id,
        {
          model: j.model,
          resultHash: hash,
          workers: matching.slice(0, 2).map((w) => w.worker_id),
        },
        now,
      );
      return { accepted: true, jobCompleted: true, resultHash: hash };
    }
    if (submitted.length >= 3) {
      const request = s.get(
        "SELECT * FROM compute_requests WHERE id=?",
        j.request_id,
      );
      s.run(
        "UPDATE compute_accounts SET held=held-? WHERE address=?",
        request.reserved,
        request.address,
      );
      s.run(
        "UPDATE compute_requests SET state='failed',error_code='gpu_disagreement',updated=? WHERE id=?",
        now,
        request.id,
      );
      s.run(
        "UPDATE compute_gpu_jobs SET state='failed',completed=? WHERE id=?",
        now,
        j.id,
      );
    }
    return { accepted: true, jobCompleted: false, resultHash: hash };
  });
}
export function expireJobs(s, now = nowSeconds()) {
  const jobs = s.all(
    "SELECT id,request_id FROM compute_gpu_jobs WHERE state IN('queued','running') AND expires<=?",
    now,
  );
  for (const j of jobs) {
    fail(s, j.request_id, "gpu_expired", false, now);
    s.run(
      "UPDATE compute_gpu_jobs SET state='failed',completed=? WHERE id=?",
      now,
      j.id,
    );
  }
  return jobs.length;
}
