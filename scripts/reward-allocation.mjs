// lib/perla/rewards.ts
import { encodeAbiParameters, keccak256, concat } from "viem";

// lib/perla/protocol.ts
var CHAIN_ID = 46630;
var SHARE_BITS = 486604799;
var MAX_PROOF_BYTES = 5 * 1024 * 1024;
function compactTarget(bits) {
  const exponent = bits >>> 24;
  const mantissa = BigInt(bits & 8388607);
  return exponent > 3 ? mantissa << BigInt(8 * (exponent - 3)) : mantissa >> BigInt(8 * (3 - exponent));
}

// lib/perla/rewards.ts
function rewardLeaf(distributor, epoch, index, address, amount) {
  return keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }], [BigInt(CHAIN_ID), distributor, BigInt(epoch), BigInt(index), address, amount]));
}
var pair = (a, b) => keccak256(concat(a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a]));
function createManifest(epoch, budget, distributor, rows) {
  if (budget <= 0n || budget >= 2n ** 256n || !rows.length || !Number.isSafeInteger(epoch) || epoch < 0) throw Error("Invalid reward budget or epoch");
  const ordered = [...rows].sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  if (new Set(ordered.map((r) => r.address.toLowerCase())).size !== ordered.length || ordered.some((r) => !Number.isSafeInteger(r.points) || r.points <= 0)) throw Error("Invalid contribution snapshot");
  const total = ordered.reduce((s, r) => s + BigInt(r.points), 0n);
  const items = ordered.map((r, index) => ({ ...r, index, amount: (budget * BigInt(r.points) / total).toString(), proof: [] }));
  let rest = budget - items.reduce((s, r) => s + BigInt(r.amount), 0n);
  const remainders = items.map((r, i) => ({ i, remainder: budget * BigInt(r.points) % total })).sort((a, b) => a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1);
  for (const { i } of remainders) {
    if (!rest) break;
    items[i].amount = (BigInt(items[i].amount) + 1n).toString();
    rest--;
  }
  const layers = [items.map((r) => rewardLeaf(distributor, epoch, r.index, r.address, BigInt(r.amount)))];
  while (layers.at(-1).length > 1) {
    const row = layers.at(-1);
    const next = [];
    for (let i = 0; i < row.length; i += 2) next.push(pair(row[i], row[i + 1] ?? row[i]));
    layers.push(next);
  }
  items.forEach((r, i) => {
    let p = i;
    for (const layer of layers.slice(0, -1)) {
      r.proof.push(layer[p ^ 1] ?? layer[p]);
      p = Math.floor(p / 2);
    }
  });
  return { version: 1, chainId: CHAIN_ID, epoch, budget: budget.toString(), distributor, root: layers.at(-1)[0], totalPoints: total.toString(), allocations: items };
}
function createAmountManifest(epoch, distributor, rows) {
  if (!Number.isSafeInteger(epoch) || epoch < 0 || !rows.length || rows.length > 5e3) throw Error("Invalid earned allocation");
  const ordered = [...rows].sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  if (new Set(ordered.map((r) => r.address.toLowerCase())).size !== ordered.length || ordered.some((r) => !Number.isSafeInteger(r.workUnits) || r.workUnits <= 0 || !/^\d+$/.test(r.amount))) throw Error("Invalid earned allocation rows");
  const budget = ordered.reduce((sum, r) => sum + BigInt(r.amount), 0n);
  if (budget <= 0n || budget >= 2n ** 256n) throw Error("Invalid earned budget");
  const items = ordered.map((r, index) => ({ ...r, index, proof: [] }));
  const layers = [items.map((r) => rewardLeaf(distributor, epoch, r.index, r.address, BigInt(r.amount)))];
  while (layers.at(-1).length > 1) {
    const row = layers.at(-1), next = [];
    for (let i = 0; i < row.length; i += 2) next.push(pair(row[i], row[i + 1] ?? row[i]));
    layers.push(next);
  }
  items.forEach((r, i) => {
    let p = i;
    for (const layer of layers.slice(0, -1)) {
      r.proof.push(layer[p ^ 1] ?? layer[p]);
      p = Math.floor(p / 2);
    }
  });
  return { version: 2, chainId: CHAIN_ID, epoch, budget: budget.toString(), distributor, root: layers.at(-1)[0], totalWork: ordered.reduce((sum, r) => sum + BigInt(r.workUnits), 0n).toString(), allocations: items };
}

// lib/perla/round-math.ts
import { isAddress } from "viem";

// lib/perla/round-rules.json
var round_rules_default = {
  policy: "perla-rounds-v1",
  chainId: 46630,
  certificateVersion: 3,
  targetSeconds: 194,
  dailyRoundLimit: 446,
  windowMultiplier: 2,
  minimumWorkUnits: 256,
  maximumWorkUnits: 2048,
  retargetRounds: 16,
  maximumRecipients: 5e3,
  targets: [
    {
      workUnits: 256,
      bits: 469827583
    },
    {
      workUnits: 512,
      bits: 461373312
    },
    {
      workUnits: 1024,
      bits: 457179072
    },
    {
      workUnits: 2048,
      bits: 455081952
    }
  ]
};

// lib/perla/emission.mjs
var TESTNET_SUPPLY = 1000000000n * 10n ** 18n;
var EMISSION_DAYS = 1460;
function cumulativeBudget(day) {
  if (!Number.isSafeInteger(day) || day < 0) throw Error("Day must be a non-negative safe integer.");
  const d = BigInt(day);
  return TESTNET_SUPPLY * d / (d + BigInt(EMISSION_DAYS));
}
function dailyBudget(day) {
  if (!Number.isSafeInteger(day) || day < 1) throw Error("Day must be a positive safe integer.");
  return cumulativeBudget(day) - cumulativeBudget(day - 1);
}

// lib/perla/round-math.ts
var ROUND_POLICY = round_rules_default.policy;
var ROUND_POLICY_HASH = "815efedf86e62a15e709bddfb4bad13569ddc24e714614e56fdcccaba8bc15d5";
function roundTarget(weight) {
  const target = round_rules_default.targets.find((t) => t.workUnits === weight);
  if (!target || compactTarget(SHARE_BITS) / compactTarget(target.bits) !== BigInt(weight) || compactTarget(SHARE_BITS) % compactTarget(target.bits) !== 0n) throw Error("Invalid round target");
  return target;
}
var rewardPerRound = (cap) => cap / BigInt(round_rules_default.dailyRoundLimit);
function splitRound(reward, rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 4096 || rows.some((r) => !isAddress(r.address) || r.address !== r.address.toLowerCase() || !Number.isSafeInteger(r.workUnits) || r.workUnits < 1)) throw Error("Invalid PPLNS snapshot");
  return createManifest(0, reward, "0x0000000000000000000000000000000000000001", rows.map((r) => ({ address: r.address, points: r.workUnits }))).allocations.map((r) => ({ address: r.address, workUnits: r.points, amount: r.amount }));
}
function earnedManifest(epoch, distributor, rounds, startEpoch, policyHash) {
  if (!Number.isSafeInteger(startEpoch) || startEpoch < 0 || epoch < startEpoch || !Array.isArray(rounds) || !rounds.length || rounds.length > round_rules_default.dailyRoundLimit || new Set(rounds.map((r) => r.id)).size !== rounds.length || policyHash !== ROUND_POLICY_HASH) throw Error("Invalid earned round set");
  const cap = dailyBudget(epoch - startEpoch + 1), perRound = rewardPerRound(cap), totals = /* @__PURE__ */ new Map();
  for (const r of rounds) {
    if (!/^[a-f0-9-]{36}$/.test(r.id) || !/^[a-f0-9-]{36}$/.test(r.winner_share) || r.target_bits !== roundTarget(r.difficulty_weight).bits || r.reward !== perRound.toString()) throw Error("Invalid round reward");
    const rows = JSON.parse(r.snapshot);
    const units = Array.isArray(rows) ? rows.reduce((sum, row) => sum + row.workUnits, 0) : 0;
    if (!Number.isSafeInteger(units) || units < 1 || units > r.difficulty_weight * round_rules_default.windowMultiplier) throw Error("PPLNS window exceeds policy");
    for (const row of splitRound(perRound, rows)) {
      const prior = totals.get(row.address);
      totals.set(row.address, { address: row.address, workUnits: row.workUnits + (prior?.workUnits ?? 0), amount: (BigInt(row.amount) + BigInt(prior?.amount ?? "0")).toString() });
    }
  }
  const manifest = createAmountManifest(epoch, distributor, [...totals.values()]);
  if (BigInt(manifest.budget) > cap) throw Error("Daily cap exceeded");
  return { ...manifest, policy: ROUND_POLICY, policyHash, emissionStartEpoch: startEpoch, dailyCap: cap.toString(), rounds };
}
function rebuildRoundManifest(m) {
  return earnedManifest(m.epoch, m.distributor, m.rounds, m.emissionStartEpoch, m.policyHash);
}
export {
  ROUND_POLICY,
  ROUND_POLICY_HASH,
  createAmountManifest,
  createManifest,
  rebuildRoundManifest,
  rewardLeaf
};
