// lib/perla/rewards.ts
import { encodeAbiParameters, keccak256, concat } from "viem";

// lib/perla/protocol.ts
var CHAIN_ID = 46630;
var MAX_PROOF_BYTES = 5 * 1024 * 1024;

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
var rewardsAbi = [
  { type: "function", name: "rewardToken", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "epochs", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bytes32" }, { type: "uint256" }, { type: "uint256" }] },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [{ name: "epoch", type: "uint256" }, { name: "index", type: "uint256" }, { name: "recipient", type: "address" }, { name: "amount", type: "uint256" }, { name: "proof", type: "bytes32[]" }], outputs: [] }
];
export {
  createManifest,
  rewardLeaf,
  rewardsAbi
};
