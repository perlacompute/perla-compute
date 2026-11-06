import {
  createPublicClient,
  defineChain,
  http,
  parseAbi,
  decodeEventLog,
  isAddress,
  keccak256,
} from "viem";
import { randomUUID } from "node:crypto";
import artifacts from "./contract-artifacts.json" with { type: "json" };
import {
  demand,
  PLAN,
  USDG,
  TOKEN_UNIT,
  nowSeconds,
  feature,
  safeInt,
  activationHash,
  roundReward,
} from "./config.mjs";
export const rewardAbi = artifacts.contracts.PerlaMainnetRewards.abi,
  creditAbi = artifacts.contracts.PerlaCreditVault.abi;
export const tokenAbi = parseAbi([
  "function symbol() view returns(string)",
  "function decimals() view returns(uint8)",
  "function totalSupply() view returns(uint256)",
  "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
]);
export const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: "https://robinhoodchain.blockscout.com",
    },
  },
});
export const rpc = (c) =>
  createPublicClient({
    chain,
    transport: http(c.rpcUrl, { timeout: 15000, retryCount: 1 }),
  });
function matches(code, name) {
  if (!code) return false;
  const a = artifacts.contracts[name],
    got = Buffer.from(code.slice(2), "hex"),
    expected = Buffer.from(a.runtime.slice(2), "hex");
  if (got.length !== expected.length) return false;
  for (const list of Object.values(a.immutableReferences))
    for (const { start, length } of list) {
      got.fill(0, start, start + length);
      expected.fill(0, start, start + length);
    }
  return got.equals(expected);
}
export async function deploymentChecks(c, client = rpc(c)) {
  demand(
    (await client.getChainId()) === 4663,
    503,
    "chain",
    "Expected Robinhood Chain 4663",
  );
  for (const k of ["token", "rewardVault", "creditVault"])
    demand(
      isAddress(c[k]),
      503,
      "contracts",
      "Configure the token and both vault addresses",
    );
  demand(
    (await client.readContract({
      address: USDG,
      abi: tokenAbi,
      functionName: "decimals",
    })) === 6 &&
      (await client.readContract({
        address: USDG,
        abi: tokenAbi,
        functionName: "symbol",
      })) === "USDG",
    503,
    "usdg_identity",
    "Canonical USDG metadata does not match",
  );
  demand(
    (
      await client.readContract({
        address: c.creditVault,
        abi: creditAbi,
        functionName: "usdg",
      })
    ).toLowerCase() === USDG.toLowerCase(),
    503,
    "usdg_pin",
    "The credit vault must bind canonical USDG",
  );
  const codes = await Promise.all(
    [c.token, c.rewardVault, c.creditVault].map((address) =>
      client.getCode({ address }),
    ),
  );
  demand(
    codes[0] &&
      codes[0] !== "0x" &&
      matches(codes[1], "PerlaMainnetRewards") &&
      matches(codes[2], "PerlaCreditVault"),
    503,
    "bytecode",
    "Vault bytecode does not match the compiled release",
  );
  const read = (address, abi, functionName, args = []) =>
    client.readContract({ address, abi, functionName, args });
  const [
    supply,
    decimals,
    symbol,
    rewardToken,
    creditToken,
    startEpoch,
    miningFunded,
    migrationFunded,
    miningAllocated,
    miningPaid,
    migrationPaid,
    balance,
    owner,
    creditOwner,
    treasury,
  ] = await Promise.all([
    read(c.token, tokenAbi, "totalSupply"),
    read(c.token, tokenAbi, "decimals"),
    read(c.token, tokenAbi, "symbol"),
    read(c.rewardVault, rewardAbi, "rewardToken"),
    read(c.creditVault, creditAbi, "token"),
    read(c.rewardVault, rewardAbi, "startEpoch"),
    read(c.rewardVault, rewardAbi, "miningFunded"),
    read(c.rewardVault, rewardAbi, "migrationFunded"),
    read(c.rewardVault, rewardAbi, "miningAllocated"),
    read(c.rewardVault, rewardAbi, "miningPaid"),
    read(c.rewardVault, rewardAbi, "migrationPaid"),
    read(c.token, tokenAbi, "balanceOf", [c.rewardVault]),
    read(c.rewardVault, rewardAbi, "owner"),
    read(c.creditVault, creditAbi, "owner"),
    read(c.creditVault, creditAbi, "treasury"),
  ]);
  demand(
    supply === 1000000000n * TOKEN_UNIT && decimals === 18 && symbol === "PERL",
    503,
    "token_metadata",
    "Expected PERL, 18 decimals and a current total supply of 1B",
  );
  demand(
    rewardToken.toLowerCase() === c.token.toLowerCase() &&
      creditToken.toLowerCase() === c.token.toLowerCase() &&
      Number(startEpoch) === c.startEpoch,
    503,
    "contract_pin",
    "Vault token or emission start differs",
  );
  demand(
    miningAllocated <= miningFunded &&
      balance >= miningFunded + migrationFunded - miningPaid - migrationPaid,
    503,
    "reserves",
    "Onchain reserves and liabilities do not reconcile",
  );
  if (c.owner)
    demand(
      owner.toLowerCase() === c.owner.toLowerCase() &&
        creditOwner.toLowerCase() === c.owner.toLowerCase(),
      503,
      "owner",
      "Vault owner differs",
    );
  if (c.treasury)
    demand(
      treasury.toLowerCase() === c.treasury.toLowerCase(),
      503,
      "treasury",
      "Payment treasury differs",
    );
  return {
    chainId: 4663,
    miningFunded: miningFunded.toString(),
    migrationFunded: migrationFunded.toString(),
    miningAllocated: miningAllocated.toString(),
    balance: balance.toString(),
    owner,
    treasury,
    tokenCodeHash: keccak256(codes[0]),
    rewardCodeHash: keccak256(codes[1]),
    creditCodeHash: keccak256(codes[2]),
    checkedAt: nowSeconds(),
  };
}
export function miningCapacity(s,c,report,epoch) {
  demand(report,503,"funding","Refresh the mining reserve before accepting work");
  const earned=s.all("SELECT reward FROM compute_rounds WHERE state='won'").reduce((n,r)=>n+BigInt(r.reward),0n);
  const allocated=BigInt(report.miningAllocated), used=earned>allocated?earned:allocated;
  const available=BigInt(report.miningFunded)-used, required=roundReward(epoch,c.startEpoch);
  demand(available>=required && available>=0n,503,"funding","Mining reserve needs a top-up before another reward round");
  return {availableBaseUnits:available.toString(),earnedBaseUnits:earned.toString()};
}
export async function reserveReady(s, c, client = rpc(c), now = nowSeconds()) {
  feature(s, c, "mining");
  const previous = s.get(
    "SELECT value FROM compute_meta WHERE key='chain_health'",
  );
  let report = previous ? JSON.parse(previous.value) : null;
  if (!report || now - report.checkedAt > 60) {
    report = await deploymentChecks(c, client);
    s.run(
      "INSERT INTO compute_meta VALUES('chain_health',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      JSON.stringify(report),
    );
  }
  demand(
    BigInt(report.miningFunded) > BigInt(report.miningAllocated),
    503,
    "funding",
    "Mining reserve requires funding",
  );
  return report;
}
export async function quote(c, client = rpc(c)) {
  demand(
    (await client.getChainId()) === 4663,
    503,
    "chain",
    "Wrong payment chain",
  );
  const read = (name) =>
    client.readContract({
      address: c.creditVault,
      abi: creditAbi,
      functionName: name,
    });
  const [rate, expiry, nonce, token] = await Promise.all([
    read("microUsdPerToken"),
    read("validUntil"),
    read("rateNonce"),
    read("token"),
  ]);
  demand(
    token.toLowerCase() === c.token.toLowerCase(),
    503,
    "token",
    "Payment token mismatch",
  );
  return {
    rateMicros: rate.toString(),
    validUntil: Number(expiry),
    nonce: nonce.toString(),
    active: rate > 0n && expiry > (await client.getBlock()).timestamp,
    chainId: 4663,
    token: c.token,
    vault: c.creditVault,
    usdg: {
      token: USDG,
      decimals: 6,
      rateMicros: "1000000",
      active: !!c.features.usdg,
      vault: c.creditVault,
    },
  };
}
export async function confirmDeposit(
  s,
  c,
  address,
  hash,
  logIndex,
  client = rpc(c),
  now = nowSeconds(),
) {
  demand(
    /^0x[0-9a-fA-F]{64}$/.test(hash) &&
      (logIndex === null || (Number.isSafeInteger(logIndex) && logIndex >= 0)),
    400,
    "deposit",
    "Provide the payment transaction and log index",
  );
  demand(
    (await client.getChainId()) === 4663,
    503,
    "chain",
    "Wrong payment network",
  );
  const r = await client.getTransactionReceipt({ hash });
  demand(
    r.status === "success",
    409,
    "payment_failed",
    "Payment transaction did not succeed",
  );
  const [block, finalized] = await Promise.all([
    client.getBlock({ blockNumber: r.blockNumber }),
    client.getBlock({ blockTag: "finalized" }),
  ]);
  demand(
    block.hash === r.blockHash,
    409,
    "reorg",
    "Payment is no longer canonical",
  );
  demand(
    finalized.number >= r.blockNumber,
    409,
    "finality_pending",
    "Payment is waiting for chain finality",
  );
  const candidates = r.logs
    .filter(
      (l) =>
        l.address.toLowerCase() === c.creditVault.toLowerCase() &&
        (logIndex === null || Number(l.logIndex) === logIndex),
    )
    .filter((l) => {
      if (logIndex !== null) return true;
      try {
        return (
          decodeEventLog({
            abi: creditAbi,
            data: l.data,
            topics: l.topics,
          }).args.beneficiary.toLowerCase() === address
        );
      } catch {
        return false;
      }
    });
  demand(
    candidates.length === 1,
    400,
    "payment_event",
    "Select one matching credit purchase event",
  );
  const log = candidates[0];
  logIndex = Number(log.logIndex);
  demand(
    log,
    400,
    "payment_event",
    "No credit purchase from the configured vault",
  );
  let event;
  try {
    event = decodeEventLog({
      abi: creditAbi,
      data: log.data,
      topics: log.topics,
    });
  } catch {
    demand(false, 400, "payment_event", "Invalid credit purchase event");
  }
  demand(
    ["CreditPurchased", "USDGCreditPurchased"].includes(event.eventName),
    400,
    "payment_event",
    "This is not a credit purchase",
  );
  demand(
    event.args.beneficiary.toLowerCase() === address,
    403,
    "beneficiary",
    "Payment belongs to another account",
  );
  const stable = event.eventName === "USDGCreditPurchased";
  feature(s, c, stable ? "usdg" : "convert");
  demand(
    !stable || event.args.tokenAmount === event.args.creditMicros,
    400,
    "usdg_amount",
    "USDG credit amount differs from the exact payment",
  );
  const amount = safeInt(event.args.creditMicros);
  return s.tx(() => {
    const previous = s.get(
      "SELECT * FROM compute_deposits WHERE hash=? AND log_index=?",
      hash.toLowerCase(),
      logIndex,
    );
    if (previous) {
      demand(
        previous.address === address,
        409,
        "deposit_owner",
        "Deposit belongs to another account",
      );
      return { credited: false, creditMicros: previous.credits };
    }
    const a = s.account(address, now);
    demand(
      amount > 0 && Number.isSafeInteger(a.balance + amount),
      400,
      "credit_range",
      "Invalid credit balance",
    );
    s.run(
      "INSERT INTO compute_deposits(hash,log_index,address,amount,credits,block_number,block_hash,created,payment_token) VALUES(?,?,?,?,?,?,?,?,?)",
      hash.toLowerCase(),
      logIndex,
      address,
      event.args.tokenAmount.toString(),
      amount,
      r.blockNumber.toString(),
      r.blockHash,
      now,
      stable ? USDG : c.token,
    );
    s.run(
      "UPDATE compute_accounts SET balance=balance+? WHERE address=?",
      amount,
      address,
    );
    s.run(
      "INSERT INTO compute_ledger VALUES(?,?,?,?,?,?)",
      randomUUID(),
      address,
      amount,
      stable ? "usdg_payment" : "perl_payment",
      `deposit:4663:${hash.toLowerCase()}:${logIndex}`,
      now,
    );
    return { credited: true, creditMicros: amount };
  });
}
export async function claimState(c, m, a, client = rpc(c)) {
  demand(
    (await client.getChainId()) === 4663,
    503,
    "chain",
    "Wrong reward chain",
  );
  const read = (name, args = []) =>
    client.readContract({
      address: c.rewardVault,
      abi: rewardAbi,
      functionName: name,
      args,
    });
  if (m.pool === 0) {
    const [e, claimed] = await Promise.all([
      read("epochs", [BigInt(m.epoch)]),
      read("isClaimed", [BigInt(m.epoch), BigInt(a.index)]),
    ]);
    return {
      funded: e[0] === m.root && e[1] === BigInt(m.budget),
      claimed,
      remaining: e[2].toString(),
    };
  }
  const block = await client.getBlock(),
    day = block.timestamp / 86400n;
  const [root, cutoff, paid, today] = await Promise.all([
    read("migrationRoot"),
    read("migrationCutoffEpoch"),
    read("migrated", [BigInt(a.index)]),
    read("migrationByDay", [day]),
  ]);
  return {
    funded:
      root === m.root &&
      Number(cutoff) === m.epoch &&
      Number(day) >= c.startEpoch,
    claimedBaseUnits: paid.toString(),
    remainingBaseUnits: (BigInt(a.amount) - paid).toString(),
    dailyRemainingBaseUnits: (
      BigInt(PLAN.migrationDailyLimit) * TOKEN_UNIT -
      today
    ).toString(),
  };
}
