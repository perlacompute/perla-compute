import { encodeAbiParameters, keccak256, concat, isAddress } from "viem";
import { demand } from "./config.mjs";
export const leaf = (vault, pool, epoch, index, address, amount) =>
  keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "uint8" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
      ],
      [
        4663n,
        vault,
        pool,
        BigInt(epoch),
        BigInt(index),
        address,
        BigInt(amount),
      ],
    ),
  );
const pair = (a, b) =>
  keccak256(concat(a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a]));
export function manifest(vault, pool, epoch, rows) {
  demand(
    isAddress(vault) &&
      [0, 1].includes(pool) &&
      Number.isSafeInteger(epoch) &&
      epoch >= 0,
    400,
    "manifest",
    "Invalid allocation domain",
  );
  const totals = new Map();
  for (const r of rows) {
    demand(
      isAddress(r.address) && BigInt(r.amount) > 0n,
      400,
      "allocation",
      "Invalid allocation",
    );
    const a = r.address.toLowerCase();
    totals.set(a, (totals.get(a) || 0n) + BigInt(r.amount));
  }
  demand(
    totals.size > 0 && totals.size <= 200000,
    400,
    "recipients",
    "Unsupported recipient count",
  );
  const allocations = [...totals]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([address, amount], index) => ({
        address,
        amount: amount.toString(),
        index,
        proof: [],
      })),
    layers = [
      allocations.map((a) =>
        leaf(vault, pool, epoch, a.index, a.address, a.amount),
      ),
    ];
  while (layers.at(-1).length > 1) {
    const p = layers.at(-1),
      n = [];
    for (let i = 0; i < p.length; i += 2)
      n.push(p[i + 1] ? pair(p[i], p[i + 1]) : p[i]);
    layers.push(n);
  }
  for (const a of allocations) {
    let index = a.index;
    for (const layer of layers.slice(0, -1)) {
      if (layer[index ^ 1]) a.proof.push(layer[index ^ 1]);
      index = Math.floor(index / 2);
    }
  }
  return {
    version: 1,
    chainId: 4663,
    vault: vault.toLowerCase(),
    pool,
    epoch,
    root: layers.at(-1)[0],
    budget: allocations
      .reduce((sum, a) => sum + BigInt(a.amount), 0n)
      .toString(),
    allocations,
  };
}
export function verifyAllocation(m, a) {
  let h = leaf(m.vault, m.pool, m.epoch, a.index, a.address, a.amount);
  for (const p of a.proof) h = pair(h, p);
  return h === m.root;
}
export function splitReward(reward, weights) {
  const rows = [...weights].sort(([a], [b]) => a.localeCompare(b)),
    total = rows.reduce((sum, [, n]) => sum + BigInt(n), 0n);
  demand(total > 0n, 409, "window", "Reward window has no accepted work");
  let used = 0n;
  return rows
    .map(([address, n], index) => {
      const amount =
        index === rows.length - 1
          ? reward - used
          : (reward * BigInt(n)) / total;
      used += amount;
      return { address, amount: amount.toString(), workUnits: n };
    })
    .filter((a) => BigInt(a.amount) > 0n);
}
