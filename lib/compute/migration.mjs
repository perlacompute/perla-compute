import { manifest } from "./merkle.mjs";
import { PLAN, TOKEN_UNIT, demand, sha, nowSeconds } from "./config.mjs";
export async function buildMigration(
  s,
  c,
  { rows, cutoff, legacyClient, rebuild, distributor, token },
  now = nowSeconds(),
) {
  demand(
    Number.isSafeInteger(cutoff) && cutoff < c.startEpoch,
    400,
    "cutoff",
    "Migration cutoff must precede mainnet mining",
  );
  demand(
    (await legacyClient.getChainId()) === 46630,
    503,
    "testnet_chain",
    "Eligibility must be read from Robinhood Testnet",
  );
  const finalized = await legacyClient.getBlock({ blockTag: "finalized" }),
    totals = new Map(),
    evidence = [], seen = new Set();
  for (const row of rows) {
    if (row.state !== "active" || row.epoch > cutoff) continue;
    demand(!seen.has(row.epoch),409,"duplicate_epoch","Duplicate testnet epoch");
    seen.add(row.epoch);
    const m = JSON.parse(row.manifest);
    demand(
      m.policy === "perla-rounds-v1" &&
        m.chainId === 46630 &&
        m.distributor.toLowerCase() === distributor.toLowerCase() &&
        row.token.toLowerCase() === token.toLowerCase(),
      409,
      "eligibility",
      "Only the pinned earned round allocations are eligible",
    );
    const rebuilt = rebuild(m);
    demand(
      rebuilt.root === row.root &&
        rebuilt.root === m.root &&
        rebuilt.budget === row.budget,
      409,
      "legacy_manifest",
      "Testnet allocation evidence differs",
    );
    const funded = await legacyClient.readContract({
      address: distributor,
      abi: [
        {
          type: "function",
          name: "epochs",
          stateMutability: "view",
          inputs: [{ type: "uint256" }],
          outputs: [
            { type: "bytes32" },
            { type: "uint256" },
            { type: "uint256" },
          ],
        },
      ],
      functionName: "epochs",
      args: [BigInt(row.epoch)],
    });
    demand(
      funded[0] === rebuilt.root &&
        funded[1] === BigInt(rebuilt.budget) &&
        row.funding_tx,
      409,
      "legacy_funding",
      "Testnet epoch does not match its funded root",
    );
    const receipt = await legacyClient.getTransactionReceipt({
        hash: row.funding_tx,
      }),
      block = await legacyClient.getBlock({ blockNumber: receipt.blockNumber });
    demand(
      receipt.status === "success" &&
        receipt.blockHash === block.hash &&
        receipt.blockNumber <= finalized.number,
      409,
      "legacy_finality",
      "Testnet funding is not finalized and canonical",
    );
    for (const a of rebuilt.allocations)
      totals.set(
        a.address.toLowerCase(),
        (totals.get(a.address.toLowerCase()) || 0n) + BigInt(a.amount),
      );
    evidence.push({
      epoch: row.epoch,
      root: rebuilt.root,
      budget: rebuilt.budget,
      fundingTransaction: row.funding_tx,
    });
  }
  demand(
    totals.size > 0,
    409,
    "no_eligibility",
    "No funded earned testnet allocations exist for this cutoff",
  );
  const rowsOut = [...totals]
      .map(([address, n]) => ({
        address,
        amount: ((n * 7n) / 100n).toString(),
      }))
      .filter((r) => BigInt(r.amount) > 0n),
    m = manifest(c.rewardVault, 1, cutoff, rowsOut);
  demand(
    BigInt(m.budget) <= 70000000n * TOKEN_UNIT,
    409,
    "migration_cap",
    "Eligible migration exceeds the 70M reserve",
  );
  const snapshotHash =
      "0x" +
      sha({
        cutoff,
        ratio: [100, 7],
        evidence,
        allocations: m.allocations.map((a) => ({
          address: a.address,
          amount: a.amount,
        })),
      }),
    out = {
      ...m,
      snapshotHash,
      cutoff,
      sourceChainId: 46630,
      eligibility:
        "Funded earned reward allocations; arbitrary token balances and transfers do not qualify.",
      evidence,
    };
  s.tx(() => {
    const old = s.get("SELECT * FROM compute_migration WHERE id=1");
    demand(
      !old || old.snapshot_hash === snapshotHash,
      409,
      "snapshot_locked",
      "Migration snapshot is already pinned",
    );
    if (!old)
      s.run(
        "INSERT INTO compute_migration VALUES(1,?,?,?,?,?,?,NULL)",
        JSON.stringify(out),
        out.root,
        snapshotHash,
        out.budget,
        cutoff,
        now,
      );
  });
  return out;
}
