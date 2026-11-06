import { randomUUID, timingSafeEqual } from "node:crypto";
import { recoverMessageAddress, isAddress } from "viem";
import { demand, sha, secret, nowSeconds } from "./config.mjs";
export const wallet = (value) => {
  demand(
    typeof value === "string" && isAddress(value) && !/^0x0{40}$/i.test(value),
    400,
    "wallet",
    "Provide a public EVM wallet address",
  );
  return value.toLowerCase();
};
export const sameOrigin = (r, c) =>
  demand(
    r.headers.get("origin") === c.origin,
    403,
    "origin",
    "Authorize this action from the Perla console",
  );
export function throttle(s, key, max, now = nowSeconds(), window = 60) {
  const row = s.get(
    "INSERT INTO compute_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",
    key + ":" + Math.floor(now / window),
    now + 2 * window,
  );
  demand(
    row.count <= max,
    429,
    "rate_limit",
    "Request limit reached; retry shortly",
  );
}
export function session(r, s, now = nowSeconds()) {
  const token = r.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)perla_mining=([a-f0-9]{64})(?:;|$)/)?.[1];
  demand(token, 401, "wallet_required", "Sign in with your wallet");
  const a = s.get(
    "SELECT address FROM compute_sessions WHERE hash=? AND expires>?",
    sha(token),
    now,
  );
  demand(a, 401, "session_expired", "Sign in with your wallet");
  return a.address;
}
export const cookie = (token, c, age = 86400) =>
  `perla_mining=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${new URL(c.origin).protocol === "https:" ? "; Secure" : ""}`;
export function challenge(s, c, address, now = nowSeconds()) {
  address = wallet(address);
  throttle(s, "login:" + address, 10, now);
  throttle(s, "login:global", 300, now);
  const id = randomUUID(),
    expires = now + 300,
    message = `${new URL(c.origin).host} wants you to sign in to Perla Compute:\n${address}\n\nManage Perla API access, credits and mainnet workers. This signature does not authorize a transaction.\n\nURI: ${c.origin}\nVersion: 1\nChain ID: 4663\nNonce: ${secret()}\nIssued At: ${new Date(now * 1000).toISOString()}\nExpiration Time: ${new Date(expires * 1000).toISOString()}`;
  s.run(
    "INSERT INTO compute_challenges VALUES(?,?,?,?,0)",
    id,
    address,
    message,
    expires,
  );
  return { id, message, expires };
}
export async function verifyLogin(s, id, signature, now = nowSeconds()) {
  demand(
    typeof id === "string" &&
      typeof signature === "string" &&
      /^0x[0-9a-fA-F]{130}$/.test(signature),
    400,
    "signature",
    "A valid sign-in signature is required",
  );
  const row = s.get(
    "SELECT * FROM compute_challenges WHERE id=? AND used=0 AND expires>?",
    id,
    now,
  );
  demand(row, 401, "nonce", "Sign-in request expired or was used");
  let address;
  try {
    address = await recoverMessageAddress({ message: row.message, signature });
  } catch {
    demand(false, 401, "signature", "Signature did not verify");
  }
  demand(
    address.toLowerCase() === row.address,
    401,
    "signature",
    "Signature belongs to another wallet",
  );
  const token = secret();
  s.tx(() => {
    demand(
      s.run(
        "UPDATE compute_challenges SET used=1 WHERE id=? AND used=0 AND expires>?",
        id,
        now,
      ).changes === 1,
      401,
      "nonce_used",
      "Sign-in nonce was already consumed",
    );
    s.account(row.address, now);
    s.run(
      "INSERT INTO compute_sessions VALUES(?,?,?)",
      sha(token),
      row.address,
      now + 86400,
    );
  });
  return { address: row.address, token };
}
export function keyOptions(b) {
  const o = {
    name: String(b.name || "").trim(),
    models: b.models || ["*"],
    scopes: b.scopes || ["chat", "jobs"],
    daily_limit: Number(b.dailyLimitMicros ?? 10000000),
    monthly_limit: Number(b.monthlyLimitMicros ?? 100000000),
    rpm: Number(b.rpm ?? 30),
    concurrency: Number(b.concurrency ?? 2),
  };
  demand(
    o.name.length > 0 &&
      o.name.length <= 64 &&
      Array.isArray(o.models) &&
      o.models.length > 0 &&
      o.models.length <= 100 &&
      o.models.every((x) => typeof x === "string" && x.length <= 150) &&
      Array.isArray(o.scopes) &&
      o.scopes.length > 0 &&
      o.scopes.every((x) => ["chat", "jobs"].includes(x)),
    400,
    "key_scope",
    "Choose a name and allowed models/permissions",
  );
  demand(
    Number.isSafeInteger(o.daily_limit) &&
      o.daily_limit >= 1000 &&
      o.daily_limit <= 10000000000 &&
      Number.isSafeInteger(o.monthly_limit) &&
      o.monthly_limit >= o.daily_limit &&
      o.monthly_limit <= 100000000000 &&
      Number.isInteger(o.rpm) &&
      o.rpm >= 1 &&
      o.rpm <= 120 &&
      Number.isInteger(o.concurrency) &&
      o.concurrency >= 1 &&
      o.concurrency <= 8,
    400,
    "key_limits",
    "Choose valid key spending and rate limits",
  );
  return o;
}
export function createKey(s, address, body, now = nowSeconds()) {
  const o = keyOptions(body),
    id = randomUUID(),
    key = "pk_perla_" + secret();
  s.run(
    "INSERT INTO compute_keys VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL)",
    id,
    address,
    sha(key),
    key.slice(0, 17),
    o.name,
    JSON.stringify(o.models),
    JSON.stringify(o.scopes),
    o.daily_limit,
    o.monthly_limit,
    o.rpm,
    o.concurrency,
    now,
  );
  return { id, key, ...o };
}
export const listKeys = (s, a) =>
  s
    .all(
      "SELECT id,prefix,name,models,scopes,daily_limit,monthly_limit,rpm,concurrency,created,revoked FROM compute_keys WHERE address=? ORDER BY created DESC LIMIT 100",
      a,
    )
    .map((k) => ({
      ...k,
      models: JSON.parse(k.models),
      scopes: JSON.parse(k.scopes),
    }));
export function principal(r, s, c, workspace = false) {
  if (workspace) {
    sameOrigin(r, c);
    return {
      address: session(r, s),
      keyId: null,
      models: ["*"],
      scopes: ["chat", "jobs"],
      daily_limit: 100000000,
      monthly_limit: 1000000000,
      rpm: 30,
      concurrency: 2,
    };
  }
  const token =
    r.headers.get("authorization")?.replace(/^Bearer /, "") ||
    r.headers.get("x-api-key") ||
    "";
  demand(
    /^pk_perla_[a-f0-9]{64}$/.test(token),
    401,
    "api_key",
    "Use an active Perla API key",
  );
  const k = s.get(
    "SELECT * FROM compute_keys WHERE hash=? AND revoked IS NULL",
    sha(token),
  );
  demand(k, 401, "api_key", "API key is invalid or revoked");
  return {
    ...k,
    keyId: k.id,
    models: JSON.parse(k.models),
    scopes: JSON.parse(k.scopes),
  };
}
export function operator(r, c) {
  const token = r.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  demand(
    c.operatorToken.length >= 32 &&
      timingSafeEqual(
        Buffer.from(sha(token)),
        Buffer.from(sha(c.operatorToken)),
      ),
    401,
    "operator",
    "Operator authorization required",
  );
}
