import { randomUUID } from "node:crypto";
import { demand, nowSeconds } from "./config.mjs";
import { throttle } from "./auth.mjs";
export function reserve(
  s,
  p,
  { idem, fingerprint, model, scope = "chat", amount },
  now = nowSeconds(),
) {
  demand(
    typeof idem === "string" &&
      /^[A-Za-z0-9._:-]{8,128}$/.test(idem) &&
      Number.isSafeInteger(amount) &&
      amount >= 10 &&
      amount <= 100000000,
    400,
    "request_budget",
    "Use a valid Idempotency-Key and a request ceiling below $100",
  );
  return s.tx(() => {
    const old = s.get(
      "SELECT * FROM compute_requests WHERE address=? AND idem=?",
      p.address,
      idem,
    );
    if (old) {
      demand(
        old.fingerprint === fingerprint &&
          old.key_id === p.keyId &&
          old.billing_source !== "trial",
        409,
        "idempotency_conflict",
        "This Idempotency-Key belongs to another request",
      );
      return { ...old, reused: true };
    }
    if (p.keyId)
      demand(
        s.get(
          "SELECT id FROM compute_keys WHERE id=? AND revoked IS NULL",
          p.keyId,
        ),
        401,
        "api_key",
        "API key was revoked",
      );
    demand(
      p.scopes.includes(scope) &&
        p.models.some((x) => x === "*" || x === model),
      403,
      "key_scope",
      "This key cannot access the operation or model",
    );
    throttle(s, "requests:" + (p.keyId || p.address), p.rpm, now);
    const where =
        (p.keyId ? "key_id=?" : "address=?") + " AND billing_source='credits'",
      value = p.keyId || p.address;
    demand(
      s.get(
        `SELECT COUNT(*) n FROM compute_requests WHERE ${where} AND state IN('reserved','dispatching')`,
        value,
      ).n < p.concurrency,
      429,
      "concurrency",
      "Concurrent request limit reached",
    );
    demand(
      !s.get(
        `SELECT id FROM compute_requests WHERE ${where} AND fingerprint=? AND state='unknown' AND created>?`,
        value,
        fingerprint,
        now - 600,
      ),
      409,
      "request_uncertain",
      "A matching request needs reconciliation before it can be replayed",
    );
    const date = new Date(now * 1000),
      day = Math.floor(now / 86400) * 86400,
      month = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000;
    for (const [start, limit, label] of [
      [day, p.daily_limit, "daily"],
      [month, p.monthly_limit, "monthly"],
    ]) {
      const used = s.get(
        `SELECT COALESCE(SUM(CASE WHEN state='completed' THEN charged WHEN state IN('reserved','dispatching','unknown') THEN reserved ELSE 0 END),0) n FROM compute_requests WHERE ${where} AND created>=?`,
        value,
        start,
      ).n;
      demand(
        used + amount <= limit,
        402,
        label + "_budget",
        `This request would exceed the ${label} spending limit`,
      );
    }
    s.account(p.address, now);
    demand(
      s.run(
        "UPDATE compute_accounts SET held=held+? WHERE address=? AND balance-held>=?",
        amount,
        p.address,
        amount,
      ).changes === 1,
      402,
      "credits",
      "Available credits do not cover this request ceiling",
    );
    const id = randomUUID();
    s.run(
      "INSERT INTO compute_requests(id,address,key_id,idem,fingerprint,model,state,reserved,created,updated) VALUES(?,?,?,?,?,?,'reserved',?,?,?)",
      id,
      p.address,
      p.keyId,
      idem,
      fingerprint,
      model,
      amount,
      now,
      now,
    );
    return s.get("SELECT * FROM compute_requests WHERE id=?", id);
  });
}
export function dispatching(s, id, now = nowSeconds()) {
  demand(
    s.run(
      "UPDATE compute_requests SET state='dispatching',updated=? WHERE id=? AND state='reserved'",
      now,
      id,
    ).changes === 1,
    409,
    "request_state",
    "Request was already dispatched",
  );
}
export function billInTransaction(
  s,
  r,
  {
    charged,
    input = 0,
    output = 0,
    providerId = null,
    latency = 0,
    cache = null,
  },
  now,
) {
  demand(
    ["reserved", "dispatching", "unknown"].includes(r.state) &&
      Number.isSafeInteger(charged) &&
      charged >= 0 &&
      charged <= r.reserved,
    409,
    "cost_ceiling",
    "Provider cost or request state needs reconciliation",
  );
  demand(
    Number.isSafeInteger(input) &&
      input >= 0 &&
      Number.isSafeInteger(output) &&
      output >= 0,
    502,
    "usage",
    "Invalid token usage",
  );
  const sponsored = r.billing_source === "trial";
  if (sponsored)
    s.run(
      "UPDATE compute_trial_usage SET cost_micros=? WHERE request_id=?",
      charged,
      r.id,
    );
  else {
    s.run(
      "UPDATE compute_accounts SET held=held-?,balance=balance-? WHERE address=?",
      r.reserved,
      charged,
      r.address,
    );
    s.run(
      "INSERT INTO compute_ledger VALUES(?,?,?,?,?,?)",
      randomUUID(),
      r.address,
      -charged,
      "inference",
      "request:" + r.id,
      now,
    );
  }
  s.run(
    "UPDATE compute_requests SET state='completed',charged=?,input_tokens=?,output_tokens=?,provider_request=?,latency_ms=?,updated=? WHERE id=?",
    sponsored ? 0 : charged,
    input,
    output,
    providerId,
    latency,
    now,
    r.id,
  );
  if (cache)
    s.run(
      "INSERT INTO compute_responses VALUES(?,?,?,?)",
      r.id,
      cache.encrypted,
      cache.type,
      now + 86400,
    );
}
export function complete(s, id, details, now = nowSeconds()) {
  return s.tx(() => {
    const r = s.get("SELECT * FROM compute_requests WHERE id=?", id);
    demand(r, 404, "request", "Request not found");
    if (r.state !== "completed") billInTransaction(s, r, details, now);
    return s.get("SELECT * FROM compute_requests WHERE id=?", id);
  });
}
export function fail(s, id, code, uncertain = false, now = nowSeconds()) {
  return s.tx(() => {
    const r = s.get("SELECT * FROM compute_requests WHERE id=?", id);
    if (!r || ["completed", "failed"].includes(r.state)) return r;
    if (!uncertain && r.billing_source !== "trial")
      s.run(
        "UPDATE compute_accounts SET held=held-? WHERE address=?",
        r.reserved,
        r.address,
      );
    s.run(
      "UPDATE compute_requests SET state=?,error_code=?,updated=? WHERE id=?",
      uncertain ? "unknown" : "failed",
      code,
      now,
      id,
    );
    return s.get("SELECT * FROM compute_requests WHERE id=?", id);
  });
}
export function reconcile(
  s,
  id,
  { notBilled, charged, input = 0, output = 0, evidence },
  now = nowSeconds(),
) {
  demand(
    typeof evidence === "string" &&
      evidence.length >= 8 &&
      evidence.length <= 400,
    400,
    "evidence",
    "A provider reference is required",
  );
  demand(
    s.get("SELECT state FROM compute_requests WHERE id=?", id)?.state ===
      "unknown",
    409,
    "request_state",
    "Only uncertain requests need reconciliation",
  );
  const result = notBilled
    ? fail(s, id, "reconciled_not_billed", false, now)
    : complete(s, id, { charged, input, output }, now);
  s.audit(
    "billing_reconciliation",
    id,
    { evidence, charged: result.charged },
    now,
  );
  return result;
}
export function usage(s, address) {
  const a = s.account(address);
  return {
    balanceMicros: a.balance,
    heldMicros: a.held,
    availableMicros: a.balance - a.held,
    totals: s.get(
      "SELECT COUNT(*) requests,COALESCE(SUM(charged),0) charged,COALESCE(SUM(input_tokens),0) inputTokens,COALESCE(SUM(output_tokens),0) outputTokens FROM compute_requests WHERE address=? AND state='completed'",
      address,
    ),
    requests: s.all(
      "SELECT id,model,state,reserved,charged,input_tokens,output_tokens,created,latency_ms,error_code,billing_source FROM compute_requests WHERE address=? ORDER BY rowid DESC LIMIT 100",
      address,
    ),
    ledger: s.all(
      "SELECT delta,kind,reference,created FROM compute_ledger WHERE address=? ORDER BY rowid DESC LIMIT 100",
      address,
    ),
  };
}
