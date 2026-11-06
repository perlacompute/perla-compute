import { readFileSync, writeFileSync, mkdirSync, lstatSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  createWalletClient,
  createPublicClient,
  http,
  getContractAddress,
  encodeDeployData,
  encodeFunctionData,
  isAddress,
  keccak256,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import artifact from "../../lib/compute/contract-artifacts.json" with { type: "json" };
import legacyDeployment from "../../deployments/robinhood-testnet.json" with { type: "json" };
import { rebuildRoundManifest } from "../../lib/perla/round-math.ts";
import { ComputeStore } from "../../lib/compute/store.mjs";
import {
  PLAN,
  USDG,
  PLAN_HASH,
  sha,
  canonical,
  demand,
  readConfig,
  activationHash,
  nowSeconds,
  epochAt,
  TOKEN_UNIT,
  publicConfig,
  secret,
  miningBudget,
  roundLimit,
  roundReward,
  targetBits,
} from "../../lib/compute/config.mjs";
import {
  rpc,
  chain,
  tokenAbi,
  rewardAbi,
  creditAbi,
  deploymentChecks,
  quote,
} from "../../lib/compute/chain.mjs";
import { nativeCall, prepareEpoch, header } from "../../lib/compute/mining.mjs";
import { manifest, splitReward } from "../../lib/compute/merkle.mjs";
import { syncModels } from "../../lib/compute/models.mjs";
import { gateway } from "../../lib/compute/gateway.mjs";
import { createKey } from "../../lib/compute/auth.mjs";
import {
  expireJobs,
  gpuCatalog,
  configureGpuModel,
  approveGpuWorker,
} from "../../lib/compute/gpu-jobs.mjs";
import { verifyWorkerRelease } from "../../lib/compute/release.mjs";
import { buildMigration } from "../../lib/compute/migration.mjs";
const json = (v) =>
  JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2);
function save(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, json(value) + "\n", { mode: 0o600 });
}
export const INITIAL_FUNDING = Object.freeze({ mining:650000n*TOKEN_UNIT, migration:350000n*TOKEN_UNIT, total:1000000n*TOKEN_UNIT });
export async function makePlan(
  c,
  owner,
  {
    token = c.token,
    treasury = c.treasury || owner,
    startEpoch = c.startEpoch,
    rateMicros = c.rateMicros || 0,
    maxGasWei = parseEther("0.03").toString(),
  } = {},
  client = rpc(c),
) {
  demand(
    (await client.getChainId()) === 4663 &&
      isAddress(owner) &&
      isAddress(token) &&
      isAddress(treasury),
    400,
    "plan_network",
    "Provide a mainnet token, owner and treasury on chain 4663",
  );
  const block = await client.getBlock(),
    today = Number(block.timestamp / 86400n);
  startEpoch ??= today + (Number(block.timestamp % 86400n) >= 84600 ? 1 : 0);
  demand(
    Number.isSafeInteger(startEpoch) &&
      startEpoch >= today &&
      startEpoch <= today + 30,
    400,
    "start",
    "Choose a start epoch between today and 30 days ahead",
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
    409,
    "usdg_identity",
    "Canonical USDG must be deployed with 6 decimals on Robinhood Chain",
  );
  const [supply, decimals, symbol, balance, nonce] = await Promise.all([
    client.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "totalSupply",
    }),
    client.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "decimals",
    }),
    client.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "symbol",
    }),
    client.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [owner],
    }),
    client.getTransactionCount({ address: owner, blockTag: "pending" }),
  ]);
  demand(
    supply === 1000000000n * TOKEN_UNIT && decimals === 18 && symbol === "PERL",
    409,
    "token_metadata",
    "Expected PERL with 18 decimals and a current total supply of 1B",
  );
  demand(
    balance >= INITIAL_FUNDING.total,
    409,
    "reserve_balance",
    "The owner wallet needs 1M actual PERL for initial funding (650k mining + 350k migration)",
  );
  const rewardVault = getContractAddress({ from: owner, nonce: BigInt(nonce) }),
    creditVault = getContractAddress({ from: owner, nonce: BigInt(nonce + 1) }),
    actions = [];
  const add = (name, to, data, gas) =>
    actions.push({
      name,
      to: to || null,
      data,
      nonce: nonce + actions.length,
      gas: String(gas),
    });
  add(
    "Deploy capped reward vault",
    null,
    encodeDeployData({
      abi: rewardAbi,
      bytecode: artifact.contracts.PerlaMainnetRewards.bytecode,
      args: [token, owner, BigInt(startEpoch)],
    }),
    5000000,
  );
  add(
    "Deploy credit payment vault",
    null,
    encodeDeployData({
      abi: creditAbi,
      bytecode: artifact.contracts.PerlaCreditVault.bytecode,
      args: [token, owner, treasury],
    }),
    2500000,
  );
  add(
    "Approve exact 1M PERL initial funding",
    token,
    encodeFunctionData({
      abi: tokenAbi,
      functionName: "approve",
      args: [rewardVault, INITIAL_FUNDING.total],
    }),
    150000,
  );
  add(
    "Fund initial 650k PERL mining reserve",
    rewardVault,
    encodeFunctionData({
      abi: rewardAbi,
      functionName: "fund",
      args: [0, INITIAL_FUNDING.mining],
    }),
    300000,
  );
  add(
    "Fund initial 350k PERL migration reserve",
    rewardVault,
    encodeFunctionData({
      abi: rewardAbi,
      functionName: "fund",
      args: [1, INITIAL_FUNDING.migration],
    }),
    300000,
  );
  if (BigInt(rateMicros) > 0n)
    add(
      "Publish expiring PERL/credit quote",
      creditVault,
      encodeFunctionData({
        abi: creditAbi,
        functionName: "setRate",
        args: [BigInt(rateMicros), block.timestamp + 3600n],
      }),
      150000,
    );
  const plan = {
    version: 1,
    chainId: 4663,
    owner,
    created: nowSeconds(),
    expires: nowSeconds() + 900,
    maxGasWei: String(maxGasWei),
    policyHash: PLAN_HASH,
    sourceHash: artifact.sourceHash,
    quoteValidUntil: Number(block.timestamp + 3600n),
    nextConfig: {
      origin: c.origin,
      token,
      rewardVault,
      creditVault,
      owner,
      treasury,
      startEpoch,
      markupBps: c.markupBps,
      rateMicros: String(rateMicros),
      features: {
        api: false,
        mining: false,
        migration: false,
        convert: false,
        gpu: false,
      },
    },
    initialFunding: Object.fromEntries(Object.entries(INITIAL_FUNDING).map(([k,v])=>[k,v.toString()])),
    economicPlan: PLAN,
    actions,
  };
  return { ...plan, hash: sha(plan) };
}
export async function sendJournaled(
  s,
  client,
  wallet,
  action,
  reference,
  budget,
) {
  let record = s.get(
      "SELECT * FROM compute_operator_journal WHERE reference=?",
      reference,
    ),
    payload;
  if (record) {
    payload = JSON.parse(record.payload);
    demand(
      record.kind === "chain_transaction" &&
        payload.to === (action.to || null) &&
        payload.data === action.data,
      409,
      "journal_conflict",
      "Transaction reference differs from its persisted action",
    );
  } else {
    const nonce =
      action.nonce ??
      (await client.getTransactionCount({
        address: wallet.account.address,
        blockTag: "pending",
      }));
    if (action.nonce !== undefined)
      demand(
        (await client.getTransactionCount({
          address: wallet.account.address,
          blockTag: "pending",
        })) === action.nonce,
        409,
        "nonce_changed",
        "Wallet nonce changed; preserve the existing plan and journal",
      );
    const prepared = await wallet.prepareTransactionRequest({
        account: wallet.account,
        chain,
        ...(action.to ? { to: action.to } : {}),
        data: action.data,
        nonce,
        gas: BigInt(action.gas),
      }),
      ceiling =
        prepared.gas * BigInt(prepared.maxFeePerGas ?? prepared.gasPrice);
    demand(
      ceiling <= budget.remaining,
      409,
      "gas_budget",
      "Reviewed gas budget would be exceeded",
    );
    const raw = await wallet.signTransaction(prepared),
      hash = keccak256(raw);
    payload = {
      to: action.to || null,
      data: action.data,
      nonce,
      raw,
      hash,
      ceiling: ceiling.toString(),
    };
    const now = nowSeconds();
    s.run(
      "INSERT INTO compute_operator_journal VALUES(?,'chain_transaction',?,'signed',?,NULL,?,?)",
      randomUUID(),
      reference,
      JSON.stringify(payload),
      now,
      now,
    );
    record = s.get(
      "SELECT * FROM compute_operator_journal WHERE reference=?",
      reference,
    );
  }
  demand(
    BigInt(payload.ceiling) <= budget.remaining,
    409,
    "gas_budget",
    "Reviewed gas budget would be exceeded",
  );
  budget.remaining -= BigInt(payload.ceiling);
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: payload.hash });
  } catch {}
  if (!receipt) {
    try {
      await client.sendRawTransaction({ serializedTransaction: payload.raw });
    } catch {
      try {
        receipt = await client.getTransactionReceipt({ hash: payload.hash });
      } catch {
        demand(
          false,
          503,
          "transaction_uncertain",
          "Broadcast outcome is uncertain. Rerun this exact command; the same signed transaction is retained",
        );
      }
    }
    if (!receipt)
      receipt = await client.waitForTransactionReceipt({
        hash: payload.hash,
        timeout: 180000,
      });
  }
  s.run(
    "UPDATE compute_operator_journal SET state=?,tx_hash=?,updated=? WHERE reference=?",
    receipt.status === "success" ? "confirmed" : "reverted",
    payload.hash,
    nowSeconds(),
    reference,
  );
  demand(
    receipt.status === "success",
    409,
    "transaction_reverted",
    "Reviewed transaction reverted; its journal was retained",
  );
  return receipt;
}
export function validatePlanActions(plan) {
  demand(plan.initialFunding && Object.entries(INITIAL_FUNDING).every(([k,v])=>plan.initialFunding[k]===v.toString()),409,"initial_funding","Review a 1M initial-funding plan; a legacy 200M plan cannot execute");
  const c = plan.nextConfig,
    nonce = plan.actions[0]?.nonce;
  demand(
    Number.isSafeInteger(nonce) &&
      nonce >= 0 &&
      isAddress(c.token) &&
      isAddress(c.treasury) &&
      c.owner.toLowerCase() === plan.owner.toLowerCase(),
    409,
    "plan_actions",
    "Invalid activation owner or token",
  );
  demand(
    c.rewardVault.toLowerCase() ===
      getContractAddress({
        from: plan.owner,
        nonce: BigInt(nonce),
      }).toLowerCase() &&
      c.creditVault.toLowerCase() ===
        getContractAddress({
          from: plan.owner,
          nonce: BigInt(nonce + 1),
        }).toLowerCase(),
    409,
    "plan_addresses",
    "Planned vault addresses do not match the deployment nonces",
  );
  const expected = [
    {
      to: null,
      data: encodeDeployData({
        abi: rewardAbi,
        bytecode: artifact.contracts.PerlaMainnetRewards.bytecode,
        args: [c.token, plan.owner, BigInt(c.startEpoch)],
      }),
      gas: 5000000n,
    },
    {
      to: null,
      data: encodeDeployData({
        abi: creditAbi,
        bytecode: artifact.contracts.PerlaCreditVault.bytecode,
        args: [c.token, plan.owner, c.treasury],
      }),
      gas: 2500000n,
    },
    {
      to: c.token,
      data: encodeFunctionData({
        abi: tokenAbi,
        functionName: "approve",
        args: [c.rewardVault, INITIAL_FUNDING.total],
      }),
      gas: 150000n,
    },
    {
      to: c.rewardVault,
      data: encodeFunctionData({
        abi: rewardAbi,
        functionName: "fund",
        args: [0, INITIAL_FUNDING.mining],
      }),
      gas: 300000n,
    },
    {
      to: c.rewardVault,
      data: encodeFunctionData({
        abi: rewardAbi,
        functionName: "fund",
        args: [1, INITIAL_FUNDING.migration],
      }),
      gas: 300000n,
    },
  ];
  if (BigInt(c.rateMicros) > 0n)
    expected.push({
      to: c.creditVault,
      data: encodeFunctionData({
        abi: creditAbi,
        functionName: "setRate",
        args: [BigInt(c.rateMicros), BigInt(plan.quoteValidUntil)],
      }),
      gas: 150000n,
    });
  demand(
    plan.actions.length === expected.length &&
      expected.every(
        (e, i) =>
          e.to?.toLowerCase() === plan.actions[i].to?.toLowerCase() &&
          e.data === plan.actions[i].data &&
          plan.actions[i].nonce === nonce + i &&
          BigInt(plan.actions[i].gas) > 0n &&
          BigInt(plan.actions[i].gas) <= e.gas,
      ),
    409,
    "plan_actions",
    "Activation plan contains an unreviewed transaction",
  );
}
export async function executePlan(s, c, plan, wallet, client = rpc(c)) {
  const { hash, ...unsigned } = plan;
  demand(
    sha(unsigned) === hash &&
      plan.policyHash === PLAN_HASH &&
      plan.sourceHash === artifact.sourceHash &&
      plan.chainId === 4663 &&
      (await client.getChainId()) === 4663,
    409,
    "plan_integrity",
    "Activation plan differs from this release",
  );
  demand(
    wallet.account.address.toLowerCase() === plan.owner.toLowerCase(),
    403,
    "signer",
    "Signer does not match the reviewed plan",
  );
  const any = s.get(
    "SELECT id FROM compute_operator_journal WHERE reference LIKE ? LIMIT 1",
    "activation:" + hash + ":%",
  );
  demand(
    any || plan.expires > nowSeconds(),
    409,
    "plan_expired",
    "Activation plan expired; create a fresh plan before signing",
  );
  const today = Number((await client.getBlock()).timestamp / 86400n);
  demand(
    plan.nextConfig.startEpoch >= today || any,
    409,
    "start_expired",
    "Emission start crossed a UTC boundary; regenerate the unexecuted plan",
  );
  const budget = { remaining: BigInt(plan.maxGasWei) };
  validatePlanActions(plan);
  s.run(
    "INSERT INTO compute_meta VALUES('pending_deployment',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    JSON.stringify(plan.nextConfig),
  );
  for (let i = 0; i < plan.actions.length; i++) {
    const action = plan.actions[i],
      reference = "activation:" + hash + ":" + i;
    if (
      i === 5 &&
      plan.quoteValidUntil <= Number((await client.getBlock()).timestamp)
    ) {
      const journal = s.get(
        "SELECT state FROM compute_operator_journal WHERE reference=?",
        reference,
      );
      if (!journal || journal.state === "reverted") {
        console.log(
          "Credit quote expired; renew it with the quote command. Reserve funding is retained.",
        );
        continue;
      }
    }
    console.log(action.name);
    await sendJournaled(s, client, wallet, action, reference, budget);
  }
  Object.assign(c, plan.nextConfig);
  const report = await deploymentChecks(c, client);
  s.pin(c);
  s.run(
    "INSERT INTO compute_meta VALUES('chain_health',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    JSON.stringify(report),
  );
  s.run(
    "INSERT INTO compute_meta VALUES('activation',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    activationHash(c),
  );
  return { report, nextConfig: plan.nextConfig };
}
export async function providerSmoke(c, modelId) {
  const s = new ComputeStore();
  try {
    await syncModels(s, c);
    const models = s
        .all("SELECT * FROM compute_models")
        .map((r) => JSON.parse(r.definition))
        .sort(
          (a, b) => a.inputMicro + a.outputMicro - b.inputMicro - b.outputMicro,
        ),
      m = modelId ? models.find((m) => m.id === modelId) : models[0];
    demand(
      m,
      503,
      "smoke_model",
      "Choose a priced model for the live provider smoke check",
    );
    const cfg = { ...c, features: { ...c.features, api: true } },
      address = "0x0000000000000000000000000000000000000001";
    s.run(
      "INSERT INTO compute_meta VALUES('activation',?)",
      activationHash(cfg),
    );
    s.credit(address, 50000, "isolated_smoke", "live-provider-smoke");
    const key = createKey(s, address, {
      name: "Isolated provider smoke",
      dailyLimitMicros: 50000,
      monthlyLimitMicros: 50000,
    });
    const r = await gateway(
      new Request(c.origin + "/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: "Bearer " + key.key,
          "content-type": "application/json",
          "idempotency-key": "live-smoke-" + randomUUID(),
        },
        body: JSON.stringify({
          model: m.id,
          messages: [{ role: "user", content: "Reply with PERLA_OK." }],
          max_tokens: 16,
        }),
      }),
      s,
      cfg,
    );
    const body = await r.json();
    demand(
      r.ok && body.choices?.length,
      503,
      "provider_smoke",
      "Live provider completion failed; API stays closed",
    );
    return {
      passed: true,
      model: m.id,
      providerRequest: body.id,
      retailCost: body.usage.cost,
      isolatedLedger: true,
      checkedAt: nowSeconds(),
    };
  } finally {
    s.close();
  }
}
export async function auditEpoch(s, c, epoch) {
  for (const r of s.all(
    "SELECT * FROM compute_rounds WHERE epoch=? AND state='won'",
    epoch,
  )) {
    demand(
      r.policy_hash === PLAN_HASH &&
        r.work_units >= PLAN.minimumWorkUnits &&
        r.work_units <= PLAN.maximumWorkUnits &&
        r.bits === targetBits(r.work_units) &&
        r.reward === roundReward(epoch, c.startEpoch).toString(),
      409,
      "round_policy",
      "Winning round policy differs",
    );
    const sh = s.get(
        "SELECT sh.*,j.header,j.created,j.expires FROM compute_shares sh JOIN compute_jobs j ON j.id=sh.job_id WHERE sh.id=?",
        r.winner_share,
      ),
      w = s.get("SELECT * FROM compute_workers WHERE id=?", sh?.worker_id);
    demand(
      sh &&
        w &&
        sh.accepted < sh.expires &&
        header(c, w, r, sh.job_id, sh.created) === sh.header,
      409,
      "winning_domain",
      "Winning proof domain or acceptance time differs",
    );
    const v = await nativeCall(c, "/verify", {
      protocol: "perla-mainnet-plain-v1",
      cert_version: 3,
      header: sh.header,
      plain_proof: sh.proof,
      round_bits: r.bits,
    });
    demand(
      v.valid &&
        v.round_valid &&
        v.proof_hash === sh.proof_hash &&
        v.header_hash === sha(Buffer.from(sh.header, "base64")),
      409,
      "winning_proof",
      "A winning proof failed native revalidation",
    );
    const winnerRow = s.get(
        "SELECT rowid n FROM compute_shares WHERE id=?",
        sh.id,
      ).n,
      weights = new Map();
    for (const a of s.all(
      "SELECT address FROM compute_shares WHERE rowid<=? ORDER BY rowid DESC LIMIT ?",
      winnerRow,
      r.work_units * 2,
    ))
      weights.set(a.address, (weights.get(a.address) || 0) + 1);
    demand(
      canonical(splitReward(BigInt(r.reward), weights)) ===
        canonical(JSON.parse(r.snapshot)),
      409,
      "pplns_snapshot",
      "Round contribution snapshot differs from accepted work",
    );
  }
}
export async function fundReserves(s,c,wallet,{pool,amount,requestId},client=rpc(c)) {
  demand(["mining","migration"].includes(pool)&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{3,63}$/.test(requestId||""),400,"topup","Use --pool mining|migration and a stable --request-id (4-64 characters)");
  demand(/^\d+(?:\.\d{1,18})?$/.test(String(amount)),400,"amount","Use a positive PERL decimal amount");
  const n=parseEther(String(amount));demand(n>0n,400,"amount","Use a positive PERL amount");
  await deploymentChecks(c,client);
  demand(wallet.account.address.toLowerCase()===c.owner.toLowerCase(),403,"signer","Reserve top-up requires the configured owner");
  const ref="reserve-topup:"+requestId, code=pool==="mining"?0:1;
  const approve={to:c.token,data:encodeFunctionData({abi:tokenAbi,functionName:"approve",args:[c.rewardVault,n]}),gas:"150000"},fund={to:c.rewardVault,data:encodeFunctionData({abi:rewardAbi,functionName:"fund",args:[code,n]}),gas:"300000"};
  const old=s.get("SELECT payload FROM compute_operator_journal WHERE reference=?",ref+":fund");
  if(old){const p=JSON.parse(old.payload);demand(p.to===fund.to&&p.data===fund.data,409,"journal_conflict","This top-up request ID already identifies another action");}
  else {
    const funded=await client.readContract({address:c.rewardVault,abi:rewardAbi,functionName:pool==="mining"?"miningFunded":"migrationFunded"});
    const balance=await client.readContract({address:c.token,abi:tokenAbi,functionName:"balanceOf",args:[wallet.account.address]});
    demand(funded+n<=BigInt(pool==="mining"?PLAN.miningAllocation:PLAN.migrationAllocation)*TOKEN_UNIT,409,"reserve_cap","The top-up exceeds this pool's lifetime cap");
    demand(balance>=n,409,"reserve_balance","The owner wallet lacks the requested top-up amount");
  }
  const gas={remaining:parseEther("0.01")};
  await sendJournaled(s,client,wallet,approve,ref+":approve",gas);
  const receipt=await sendJournaled(s,client,wallet,fund,ref+":fund",gas);
  const report=await deploymentChecks(c,client);s.run("INSERT INTO compute_meta VALUES('chain_health',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify(report));
  return {funded:true,pool,amountBaseUnits:n.toString(),requestId,transaction:receipt.transactionHash};
}
export async function settle(
  s,
  c,
  wallet,
  client = rpc(c),
  maxGasWei = parseEther("0.01"),
) {
  await deploymentChecks(c, client);
  const cutoff =
      Number(((await client.getBlock()).timestamp - 300n) / 86400n) - 1,
    budget = { remaining: BigInt(maxGasWei) };
  for (const { epoch } of s.all(
    "SELECT DISTINCT epoch FROM compute_rounds WHERE state='won' AND epoch<=? ORDER BY epoch",
    cutoff,
  )) {
    let row = s.get("SELECT * FROM compute_epochs WHERE epoch=?", epoch);
    if (!row) {
      await auditEpoch(s, c, epoch);
      prepareEpoch(s, c, epoch);
      row = s.get("SELECT * FROM compute_epochs WHERE epoch=?", epoch);
    }
    const m = JSON.parse(row.manifest),
      expected = manifest(
        c.rewardVault,
        0,
        epoch,
        s
          .all(
            "SELECT snapshot FROM compute_rounds WHERE epoch=? AND state='won' ORDER BY rowid",
            epoch,
          )
          .flatMap((r) => JSON.parse(r.snapshot)),
      );
    demand(
      expected.root === m.root &&
        expected.budget === m.budget &&
        canonical(expected.allocations) === canonical(m.allocations),
      409,
      "manifest_integrity",
      "Prepared allocations differ from earned rounds",
    );
    const chainEpoch = await client.readContract({
      address: c.rewardVault,
      abi: rewardAbi,
      functionName: "epochs",
      args: [BigInt(epoch)],
    });
    if (chainEpoch[0] === "0x" + "0".repeat(64)) {
      await auditEpoch(s, c, epoch);
      const data = encodeFunctionData({
          abi: rewardAbi,
          functionName: "publishMiningEpoch",
          args: [BigInt(epoch), m.root, BigInt(m.budget)],
        }),
        r = await sendJournaled(
          s,
          client,
          wallet,
          { to: c.rewardVault, data, gas: "250000" },
          "epoch:" + epoch + ":" + m.root,
          budget,
        );
      s.run(
        "UPDATE compute_epochs SET state='funded',tx_hash=? WHERE epoch=?",
        r.transactionHash,
        epoch,
      );
    } else {
      demand(
        chainEpoch[0] === m.root && chainEpoch[1] === BigInt(m.budget),
        409,
        "epoch_root",
        "Onchain epoch differs from the earned allocation",
      );
      s.run("UPDATE compute_epochs SET state='funded' WHERE epoch=?", epoch);
    }
    let count = 0;
    for (const a of m.allocations) {
      if (
        await client.readContract({
          address: c.rewardVault,
          abi: rewardAbi,
          functionName: "isClaimed",
          args: [BigInt(epoch), BigInt(a.index)],
        })
      )
        continue;
      if (count++ >= 25) break;
      const data = encodeFunctionData({
        abi: rewardAbi,
        functionName: "claimMining",
        args: [
          BigInt(epoch),
          BigInt(a.index),
          a.address,
          BigInt(a.amount),
          a.proof,
        ],
      });
      await sendJournaled(
        s,
        client,
        wallet,
        { to: c.rewardVault, data, gas: "250000" },
        "claim:" + epoch + ":" + a.index,
        budget,
      );
    }
  }
  const report = {
    success: true,
    checkedAt: nowSeconds(),
    remainingGasBudget: budget.remaining.toString(),
  };
  s.run(
    "INSERT INTO compute_meta VALUES('automatic_settlement',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    JSON.stringify(report),
  );
  return report;
}
export async function migrationSnapshot(s, c) {
  const filename = process.env.PERLA_SQLITE_PATH || "/app/data/perla.sqlite",
    db = new DatabaseSync(filename, { readOnly: true });
  try {
    const cutoff = c.migrationCutoff ?? c.startEpoch - 1,
      pending = db
        .prepare(
          "SELECT DISTINCT r.epoch FROM mining_reward_rounds r LEFT JOIN mining_reward_epochs e ON e.epoch=r.epoch WHERE r.state='won' AND r.epoch<=? AND (e.state IS NULL OR e.state!='active')",
        )
        .all(cutoff);
    demand(
      !pending.length,
      409,
      "testnet_pending",
      "Earned testnet epochs must be funded before migration is frozen",
    );
    const rows = db
      .prepare(
        "SELECT * FROM mining_reward_epochs WHERE epoch<=? ORDER BY epoch",
      )
      .all(cutoff);
    const legacy = createPublicClient({
      transport: http(
        process.env.PERLA_TESTNET_RPC_URL ||
          "https://rpc.testnet.chain.robinhood.com",
        { timeout: 15000, retryCount: 1 },
      ),
    });
    return buildMigration(s, c, {
      rows,
      cutoff,
      legacyClient: legacy,
      rebuild: rebuildRoundManifest,
      distributor: legacyDeployment.distributor,
      token: legacyDeployment.token,
    });
  } finally {
    db.close();
  }
}
async function cli() {
  const args = process.argv.slice(2),
    command = args.shift() || "doctor",
    flags = {};
  for (let i = 0; i < args.length; i++) {
    demand(args[i].startsWith("--"), 400, "argument", "Use named CLI options");
    flags[args[i].slice(2)] =
      args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true;
  }
  const c = readConfig(),
    s = new ComputeStore(
      resolve(c.databasePath),
      readFileSync(resolve("lib/compute/schema.sql"), "utf8"),
    );
  try {
    let report;
    if (command === "release") report = await verifyWorkerRelease(s);
    else if (command === "models") report = await syncModels(s, c);
    else if (command === "signer-address") {
      demand(flags["stdin-key"], 400, "signer", "Use hidden stdin");
      report = { address: privateKeyToAccount(readFileSync(0,"utf8").trim()).address };
    } else if (command === "migration-plan") {
      try {
        const m = await migrationSnapshot(s,c), client=rpc(c);
        demand((await client.getChainId())===4663,503,"chain","Expected Robinhood Chain 4663");
        const funded=await client.readContract({address:c.rewardVault,abi:rewardAbi,functionName:"migrationFunded"});
        report={eligible:true,cutoff:m.cutoff,root:m.root,budget:m.budget,recipients:m.allocations.length,fundedBaseUnits:funded.toString(),missingBaseUnits:(BigInt(m.budget)>funded?BigInt(m.budget)-funded:0n).toString()};
      } catch(e){if(e.code!=="no_eligibility")throw e;report={eligible:false,reason:e.code,cutoff:c.migrationCutoff??c.startEpoch-1};}
    }
    else if (command === "doctor") {
      report = {
        contracts: await deploymentChecks(c),
        verifier: await nativeCall(c, "/health"),
        providerConfigured: !!c.providerKey,
        models: s.get("SELECT COUNT(*) n FROM compute_models").n,
        policyHash: PLAN_HASH,
        features: c.features,
      };
    } else if (command === "plan") {
      const owner = flags.owner || c.owner;
      report = await makePlan(c, owner, {
        token: flags.token || c.token,
        treasury: flags.treasury || c.treasury || owner,
        startEpoch: flags.start ? Number(flags.start) : c.startEpoch,
        rateMicros: flags["rate-micros"] || c.rateMicros || 0,
      });
      const planPath = resolve(
        flags.out || "data/mainnet/activation-plan.json",
      );
      save(planPath, report);
      report = {
        planSaved: planPath,
        hash: report.hash,
        owner: report.owner,
        nextConfig: report.nextConfig,
        economicPlan: PLAN,
        maximumGasWei: report.maxGasWei,
        actions: report.actions.map((a) => ({
          name: a.name,
          to: a.to,
          nonce: a.nonce,
          gas: a.gas,
        })),
        providerSmokeMaximumUsd: "0.05",
      };
    } else if (command === "gpu-model") {
      report = configureGpuModel(
        s,
        JSON.parse(readFileSync(flags.file, "utf8")),
      );
    } else if (command === "gpu-approve") {
      report = approveGpuWorker(
        s,
        flags["worker-id"],
        String(flags.models || "").split(","),
      );
    } else if (command === "gpu-calibrate" || command === "gpu-open") {
      const raw = JSON.parse(
        readFileSync(process.env.PERLA_COMPUTE_CONFIG, "utf8"),
      );
      if (command === "gpu-open")
        demand(
          gpuCatalog(s).some((m) => m.available) &&
            s.get(
              "SELECT id FROM compute_audit WHERE kind='gpu_agreement' AND created>? LIMIT 1",
              nowSeconds() - 86400,
            ),
          409,
          "gpu_readiness",
          "Approve two online wallets and complete a real replicated GPU job first",
        );
      raw.features.gpu = true;
      raw.gpuAdmission = command === "gpu-open" ? "public" : "operator";
      save(process.env.PERLA_COMPUTE_CONFIG, raw);
      report = { gpuAdmission: raw.gpuAdmission };
    } else if (command === "smoke") {
      report = await providerSmoke(c, flags.model);
      s.run(
        "INSERT INTO compute_meta VALUES('provider_smoke',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        JSON.stringify(report),
      );
    } else if (command === "maintenance") {
      expireJobs(s);
      const now = nowSeconds();
      s.run("DELETE FROM compute_responses WHERE expires<?", now);
      s.run("DELETE FROM compute_challenges WHERE expires<?", now);
      s.run("DELETE FROM compute_sessions WHERE expires<?", now);
      s.run("DELETE FROM compute_limits WHERE expires<?", now);
      s.run(
        "UPDATE compute_requests SET state='unknown',error_code='interrupted_process' WHERE state IN('reserved','dispatching') AND updated<?",
        now - 600,
      );
      s.run(
        "UPDATE compute_shares SET proof='' WHERE round_won=0 AND accepted<?",
        now - 7 * 86400,
      );
      report = { maintenance: true };
    } else {
      demand(
        flags.execute === true,
        400,
        "execute_required",
        "Review the plan and add --execute before signing any transaction",
      );
      let key;
      if (flags["stdin-key"]) key = readFileSync(0, "utf8").trim();
      else {
        demand(
          typeof flags["key-file"] === "string",
          400,
          "signer",
          "Supply the dedicated mainnet signer through a credential file or hidden stdin",
        );
        const st = lstatSync(flags["key-file"]);
        demand(
          st.isFile() && !st.isSymbolicLink() && (st.mode & 0o077) === 0,
          400,
          "signer_permissions",
          "Signer file must be private and regular",
        );
        key = readFileSync(flags["key-file"], "utf8").trim();
      }
      demand(
        /^0x[0-9a-f]{64}$/i.test(key),
        400,
        "signer",
        "Invalid signer credential",
      );
      if (command !== "activate" && !c.rewardVault) {
        const pending = s.get(
          "SELECT value FROM compute_meta WHERE key='pending_deployment'",
        );
        demand(
          pending,
          409,
          "deployment",
          "Complete the saved activation plan first",
        );
        Object.assign(c, JSON.parse(pending.value));
        await deploymentChecks(c);
      }
      const account = privateKeyToAccount(key),
        wallet = createWalletClient({
          account,
          chain,
          transport: http(c.rpcUrl, { timeout: 20000, retryCount: 0 }),
        }),
        client = rpc(c);
      key = "";
      if (command === "activate") {
        const plan = JSON.parse(
          readFileSync(
            resolve(flags.plan || "data/mainnet/activation-plan.json"),
            "utf8",
          ),
        );
        const previous = JSON.parse(
          readFileSync(process.env.PERLA_COMPUTE_CONFIG, "utf8"),
        );
        await nativeCall(c, "/health");
        await verifyWorkerRelease(s);
        let smoke = null;
        if (previous.externalApi !== true) {
          await syncModels(s, c);
          smoke = await providerSmoke(c, flags.model);
          s.run("INSERT INTO compute_meta VALUES('provider_smoke',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify(smoke));
        }
        report = await executePlan(s, c, plan, wallet, client);
        const config = {
          ...previous,
          ...plan.nextConfig,
          features: {
            api: previous.externalApi !== true,
            usdg: previous.externalApi !== true,
            mining: true,
            convert: previous.externalApi !== true && (await quote(c, client)).active,
            migration: previous.features?.migration === true,
            gpu: previous.features?.gpu === true,
          },
        };
        save(
          process.env.PERLA_COMPUTE_CONFIG || "data/mainnet/config.json",
          config,
        );
        report = {
          ...report,
          nextConfig: config,
          providerSmoke: smoke,
          externalApiPreserved: previous.externalApi === true,
          mainnetMiningConfigured: true,
          migrationRequiresSnapshot: true,
          gpuRequiresApprovedCapacity: true,
        };
      } else if (command === "settle")
        report = await settle(
          s,
          c,
          wallet,
          client,
          flags["gas-wei"] || parseEther("0.01"),
        );
      else if (command === "fund") report=await fundReserves(s,c,wallet,{pool:flags.pool,amount:flags.amount,requestId:flags["request-id"]},client);
      else if (command === "migration") {
        const m = await migrationSnapshot(s, c);
        const existing = await client.readContract({
          address: c.rewardVault,
          abi: rewardAbi,
          functionName: "migrationRoot",
        });
        if (existing === "0x" + "0".repeat(64)) {
          const data = encodeFunctionData({
              abi: rewardAbi,
              functionName: "publishMigration",
              args: [m.root, m.snapshotHash, BigInt(m.epoch), BigInt(m.budget)],
            }),
            r = await sendJournaled(
              s,
              client,
              wallet,
              { to: c.rewardVault, data, gas: "250000" },
              "migration:" + m.snapshotHash,
              { remaining: parseEther("0.01") },
            );
          s.run(
            "UPDATE compute_migration SET published_tx=? WHERE id=1",
            r.transactionHash,
          );
        } else
          demand(
            existing === m.root,
            409,
            "migration_root",
            "A different migration root is already published",
          );
        const raw = JSON.parse(
          readFileSync(process.env.PERLA_COMPUTE_CONFIG, "utf8"),
        );
        raw.features.migration = true;
        save(process.env.PERLA_COMPUTE_CONFIG, raw);
        report = {
          published: true,
          root: m.root,
          budget: m.budget,
          snapshotHash: m.snapshotHash,
        };
      } else if (command === "quote") {
        await deploymentChecks(c, client);
        const rate = BigInt(flags["rate-micros"] || 0);
        demand(
          rate > 0n,
          400,
          "quote",
          "Provide --rate-micros from a reviewed PERL/USD service quote",
        );
        const block = await client.getBlock(),
          data = encodeFunctionData({
            abi: creditAbi,
            functionName: "setRate",
            args: [rate, block.timestamp + 3600n],
          });
        const pending = s.all(
          "SELECT reference,payload FROM compute_operator_journal WHERE state='signed' AND reference LIKE 'quote:%'",
        );
        demand(
          pending.length <= 1 &&
            (!pending.length ||
              pending[0].reference.startsWith("quote:" + rate + ":")),
          409,
          "pending_quote",
          "Resolve the existing signed quote at its original rate before publishing another",
        );
        const action = pending.length
          ? {
              to: c.creditVault,
              data: JSON.parse(pending[0].payload).data,
              gas: "150000",
            }
          : { to: c.creditVault, data, gas: "150000" };
        const r = await sendJournaled(
          s,
          client,
          wallet,
          action,
          pending[0]?.reference || "quote:" + rate + ":" + block.timestamp,
          { remaining: parseEther("0.005") },
        );
        const raw = JSON.parse(
          readFileSync(process.env.PERLA_COMPUTE_CONFIG, "utf8"),
        );
        raw.rateMicros = rate.toString();
        raw.features.convert = true;
        save(process.env.PERLA_COMPUTE_CONFIG, raw);
        report = {
          quoted: true,
          transaction: r.transactionHash,
          expires: Number(block.timestamp + 3600n),
        };
      } else demand(false, 400, "command", "Unknown operator command");
    }
    console.log(
      "PERLA_PUBLIC_REPORT=" +
        JSON.stringify(report, (_, x) =>
          typeof x === "bigint" ? x.toString() : x,
        ),
    );
    return report;
  } finally {
    s.close();
  }
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  process.umask(0o077);
  cli().catch((e) => {
    console.error(
      "Mainnet operation stopped: " +
        (e.status
          ? e.message
          : "The operation did not complete. Preserve its database and transaction journal."),
    );
    process.exitCode = 1;
  });
}
