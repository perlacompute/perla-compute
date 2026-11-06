import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { readFileSync } from "node:fs";
export const CHAIN_ID = 4663,
  PROTOCOL = "perla-mainnet-plain-v1",
  UPSTREAM_COMMIT = "82e6eee7076aafe10123e08db78f100d270c0582",
  TOKEN_UNIT = 10n ** 18n;
export const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
export const PLAN = Object.freeze({
  version: 2,
  chainId: 4663,
  supply: "1000000000",
  miningAllocation: "130000000",
  migrationAllocation: "70000000",
  migrationNumerator: 7,
  migrationDenominator: 100,
  migrationDailyLimit: "1000000",
  emissionDays: 1460,
  roundsPerDay: 5,
  roundsPerCycle: 24,
  cycleDays: 5,
  totalRounds: 7008,
  targetSeconds: 18000,
  windowMultiplier: 2,
  initialWorkUnits: 2048,
  minimumWorkUnits: 256,
  maximumWorkUnits: 65536,
  retargetRounds: 16,
  shareBits: 0x1d00ffff,
  jobTtl: 300,
});
export const canonical = (v) =>
  Array.isArray(v)
    ? "[" + v.map(canonical).join(",") + "]"
    : v && typeof v === "object"
      ? "{" +
        Object.keys(v)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
          .join(",") +
        "}"
      : JSON.stringify(v);
export const sha = (v) =>
  createHash("sha256")
    .update(typeof v === "string" || v instanceof Uint8Array ? v : canonical(v))
    .digest("hex");
export const PLAN_HASH = sha(PLAN),
  nowSeconds = () => Math.floor(Date.now() / 1000),
  epochAt = (n) => Math.floor(n / 86400),
  secret = () => randomBytes(32).toString("hex");
export class ComputeError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const demand = (ok, status, code, message) => {
  if (!ok) throw new ComputeError(status, code, message);
};
export const activationHash = (c) =>
  sha({
    chainId: 4663,
    usdg: USDG.toLowerCase(),
    token: c.token?.toLowerCase(),
    rewardVault: c.rewardVault?.toLowerCase(),
    creditVault: c.creditVault?.toLowerCase(),
    startEpoch: c.startEpoch,
    origin: c.origin,
    policyHash: PLAN_HASH,
  });
export function feature(store, c, name) {
  demand(
    c.features[name],
    503,
    "feature_closed",
    "This service is not open yet",
  );
  demand(
    store.get("SELECT value FROM compute_meta WHERE key='activation'")
      ?.value === activationHash(c),
    503,
    "activation_required",
    "Mainnet deployment checks must pass before this service opens",
  );
}
export function readConfig(env = process.env) {
  const file = env.PERLA_COMPUTE_CONFIG
    ? JSON.parse(readFileSync(env.PERLA_COMPUTE_CONFIG, "utf8"))
    : {};
  const c = {
    origin: env.PERLA_PUBLIC_ORIGIN || "https://perlacompute.xyz",
    rpcUrl:
      env.PERLA_MAINNET_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
    usdg: USDG,
    trial: {
      enabled: true,
      limit: 3,
      maxOutput: 256,
      maxInputBytes: 4000,
      maxRequestMicros: 10000,
      dailyBudgetMicros: 5000000,
      model: null,
    },
    token: null,
    rewardVault: null,
    creditVault: null,
    startEpoch: null,
    markupBps: 2000,
    ...file,
    features: {
      api: false,
      mining: false,
      migration: false,
      convert: false,
      gpu: false,
      usdg: false,
      ...file.features,
    },
  };
  c.trial = {
    enabled: true,
    limit: 3,
    maxOutput: 256,
    maxInputBytes: 4000,
    maxRequestMicros: 10000,
    dailyBudgetMicros: 5000000,
    model: null,
    ...file.trial,
  };
  demand(
    c.usdg.toLowerCase() === USDG.toLowerCase(),
    503,
    "usdg_pin",
    "Only canonical Robinhood USDG is supported",
  );
  Object.assign(c, {
    providerKey: env.PERLA_AI_PROVIDER_KEY || "",
    providerBase: env.PERLA_AI_PROVIDER_BASE || "https://api.inferhub.dev/v1",
    verifierUrl: env.PERLA_MAINNET_VERIFIER_URL || "",
    verifierToken: env.PERLA_MAINNET_VERIFIER_TOKEN || "",
    operatorToken: env.PERLA_COMPUTE_OPERATOR_TOKEN || "",
    storageKey: env.PERLA_COMPUTE_STORAGE_KEY || "",
    databasePath: env.PERLA_COMPUTE_SQLITE_PATH || "data/compute.sqlite",
    preview: env.PERLA_MAINNET_PREVIEW === "true",
  });
  demand(
    new URL(c.origin).origin === c.origin &&
      Number.isInteger(c.markupBps) &&
      c.markupBps >= 0 &&
      c.markupBps <= 10000,
    503,
    "configuration",
    "Invalid compute origin or markup",
  );
  for (const name of ["rpcUrl", "providerBase", "verifierUrl"])
    if (c[name]) {
      const u = new URL(c[name]);
      demand(
        !u.username &&
          !u.password &&
          !u.hash &&
          (u.protocol === "https:" ||
            (u.protocol === "http:" &&
              [
                "127.0.0.1",
                "localhost",
                ...(name === "verifierUrl" ? ["mainnet-verifier"] : []),
              ].includes(u.hostname))),
        503,
        "service_url",
        "Service URLs require HTTPS or a permitted private endpoint",
      );
    }
  return c;
}
export function roundLimit(epoch, start) {
  const d = epoch - start;
  if (!Number.isSafeInteger(d) || d < 0 || d >= PLAN.emissionDays) return 0;
  return (
    Math.floor(((d + 1) * PLAN.roundsPerCycle) / PLAN.cycleDays) -
    Math.floor((d * PLAN.roundsPerCycle) / PLAN.cycleDays)
  );
}
export function miningBudget(epoch, start) {
  const slots = roundLimit(epoch, start);
  if (!slots) return 0n;
  const pool = BigInt(PLAN.miningAllocation) * TOKEN_UNIT,
    normal = pool / BigInt(PLAN.totalRounds);
  return epoch - start === PLAN.emissionDays - 1
    ? pool - normal * BigInt(PLAN.totalRounds - slots)
    : normal * BigInt(slots);
}
export function roundReward(epoch, start) {
  const count = roundLimit(epoch, start);
  return count ? miningBudget(epoch, start) / BigInt(count) : 0n;
}
export function compactTarget(bits) {
  const e = bits >>> 24,
    m = BigInt(bits & 0x7fffff);
  return e > 3 ? m << BigInt(8 * (e - 3)) : m >> BigInt(8 * (3 - e));
}
export function targetBits(work) {
  demand(
    Number.isSafeInteger(work) && work >= 1 && (work & (work - 1)) === 0,
    400,
    "target",
    "Work factor must be a power of two",
  );
  const t = compactTarget(PLAN.shareBits) / BigInt(work);
  let n = 0,
    v = t;
  while (v) {
    n++;
    v >>= 8n;
  }
  let m =
    n <= 3
      ? Number(t << BigInt(8 * (3 - n)))
      : Number(t >> BigInt(8 * (n - 3)));
  if (m & 0x800000) {
    m >>= 8;
    n++;
  }
  const bits = (n << 24) | m;
  demand(
    compactTarget(PLAN.shareBits) / compactTarget(bits) === BigInt(work),
    400,
    "target",
    "Inexact target",
  );
  return bits;
}
export function decimalUnits(value, places = 6) {
  const s = typeof value === "number" ? value.toFixed(12) : String(value);
  demand(
    /^\d+(?:\.\d+)?$/.test(s),
    400,
    "amount",
    "Use a positive decimal amount",
  );
  const [w, f = ""] = s.split(".");
  return (
    BigInt(w) * 10n ** BigInt(places) +
    BigInt((f + "0".repeat(places)).slice(0, places)) +
    (f.length > places && /[1-9]/.test(f.slice(places)) ? 1n : 0n)
  );
}
export const safeInt = (value) => {
  const n = Number(value);
  demand(
    Number.isSafeInteger(n) && n >= 0,
    400,
    "amount_range",
    "Amount exceeds the supported range",
  );
  return n;
};
export const ceilDiv = (a, b) => (a + b - 1n) / b,
  markedUp = (n, bps) =>
    safeInt(ceilDiv(BigInt(n) * BigInt(10000 + bps), 10000n)),
  tokenCost = (input, output, m) =>
    safeInt(
      ceilDiv(
        BigInt(input) * BigInt(m.inputMicro) +
          BigInt(output) * BigInt(m.outputMicro),
        1000000n,
      ),
    ),
  displayUsd = (n) => (Number(n) / 1000000).toFixed(6);
export function seal(c, text, domain) {
  demand(
    /^[a-f0-9]{64}$/.test(c.storageKey),
    503,
    "storage_key",
    "Configure encrypted result storage",
  );
  const iv = randomBytes(12),
    cipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(c.storageKey, "hex"),
      iv,
    );
  cipher.setAAD(Buffer.from(domain));
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    data: data.toString("base64"),
  });
}
export function unseal(c, text, domain) {
  const v = JSON.parse(text);
  demand(v.v === 1, 503, "encrypted_record", "Unsupported encrypted record");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(c.storageKey, "hex"),
    Buffer.from(v.iv, "hex"),
  );
  decipher.setAAD(Buffer.from(domain));
  decipher.setAuthTag(Buffer.from(v.tag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(v.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
export const publicConfig = (c) => ({
  chainId: 4663,
  network: "Robinhood Chain",
  explorer: "https://robinhoodchain.blockscout.com",
  token: c.token,
  usdg: USDG,
  trial: {
    limit: 3,
    maxOutput: c.trial?.maxOutput || 256,
    requiresWallet: true,
  },
  rewardVault: c.rewardVault,
  creditVault: c.creditVault,
  startEpoch: c.startEpoch,
  features: c.features,
  preview: c.preview,
  plan: PLAN,
  normalRoundPoolBaseUnits: roundReward(
    c.startEpoch || 0,
    c.startEpoch || 0,
  ).toString(),
  policyHash: PLAN_HASH,
});
