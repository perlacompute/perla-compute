import { randomUUID } from "node:crypto";
import { demand, nowSeconds } from "./config.mjs";
import { throttle } from "./auth.mjs";
export const FREE_CHAT_LIMIT = 3;
export function trialStatus(s, c, address) {
  const used = s.get(
    "SELECT COUNT(*) n FROM compute_requests WHERE address=? AND billing_source='trial' AND state!='failed'",
    address,
  ).n;
  return {
    enabled: c.trial?.enabled !== false,
    limit: FREE_CHAT_LIMIT,
    used,
    remaining: Math.max(0, FREE_CHAT_LIMIT - used),
    maxOutput: c.trial?.maxOutput || 256,
    maxInputBytes: c.trial?.maxInputBytes || 4000,
    maxRequestMicros: c.trial?.maxRequestMicros || 10000,
    model: c.trial?.model || null,
  };
}
export function reserveTrial(
  s,
  c,
  p,
  { idem, fingerprint, model, amount },
  body,
  now = nowSeconds(),
) {
  demand(
    p.keyId === null,
    403,
    "trial_workspace",
    "Free chats are available only in the signed-in Playground",
  );
  demand(
    c.trial?.enabled !== false,
    503,
    "trial_closed",
    "Free Playground chats are currently unavailable",
  );
  const maxCost = c.trial?.maxRequestMicros || 10000,
    dailyBudget = c.trial?.dailyBudgetMicros || 5000000;
  demand(
    Number.isSafeInteger(amount) && amount >= 10 && amount <= maxCost,
    400,
    "trial_price",
    "This request exceeds the free allowance. Choose a lower-cost model or use credits",
  );
  demand(
    !c.trial?.model || model === c.trial.model,
    400,
    "trial_model",
    "Choose the supported free-chat model",
  );
  demand(
    !body.tools &&
      Buffer.byteLength(JSON.stringify(body.messages)) <=
        (c.trial?.maxInputBytes || 4000) &&
      Number(body.max_tokens ?? 1024) <= (c.trial?.maxOutput || 256),
    400,
    "trial_size",
    "Free chats support short text prompts and up to 256 output tokens",
  );
  demand(
    typeof idem === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(idem),
    400,
    "idempotency",
    "Use a valid Idempotency-Key",
  );
  return s.tx(() => {
    const old = s.get(
      "SELECT * FROM compute_requests WHERE address=? AND idem=?",
      p.address,
      idem,
    );
    if (old) {
      demand(
        old.billing_source === "trial" &&
          old.fingerprint === fingerprint &&
          old.key_id === null,
        409,
        "idempotency_conflict",
        "This key belongs to a different request",
      );
      return { ...old, reused: true };
    }
    throttle(s, "trial:" + p.address, 5, now);
    demand(
      trialStatus(s, c, p.address).remaining > 0,
      402,
      "trial_exhausted",
      "Your 3 free chats are used. Add credits to continue",
    );
    demand(
      !s.get(
        "SELECT id FROM compute_requests WHERE address=? AND billing_source='trial' AND state IN('reserved','dispatching')",
        p.address,
      ),
      429,
      "trial_in_progress",
      "Wait for the current free reply to finish",
    );
    demand(
      !s.get(
        "SELECT id FROM compute_requests WHERE address=? AND fingerprint=? AND state='unknown'",
        p.address,
        fingerprint,
      ),
      409,
      "request_uncertain",
      "This free request needs billing review before retrying",
    );
    const day = Math.floor(now / 86400) * 86400,
      spent = s.get(
        "SELECT COALESCE(SUM(CASE WHEN r.state='completed' AND r.updated>=? THEN t.cost_micros WHEN r.state IN('reserved','dispatching','unknown') THEN r.reserved ELSE 0 END),0) n FROM compute_trial_usage t JOIN compute_requests r ON r.id=t.request_id",
        day,
      ).n;
    demand(
      spent + amount <= dailyBudget,
      503,
      "trial_capacity",
      "The free-chat budget is currently full. Use credits or try later",
    );
    s.account(p.address, now);
    const id = randomUUID();
    s.run(
      "INSERT INTO compute_requests(id,address,key_id,idem,fingerprint,model,state,reserved,created,updated,billing_source) VALUES(?,?,NULL,?,?,?,'reserved',?,?,?,'trial')",
      id,
      p.address,
      idem,
      fingerprint,
      model,
      amount,
      now,
      now,
    );
    s.run(
      "INSERT INTO compute_trial_usage VALUES(?,?,0,?)",
      id,
      p.address,
      now,
    );
    return s.get("SELECT * FROM compute_requests WHERE id=?", id);
  });
}
