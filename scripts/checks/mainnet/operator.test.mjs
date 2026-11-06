import { USDG_FIXTURE, installUSDG } from "./usdg-fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { build } from "esbuild";
import ganache from "ganache";
import {
  createPublicClient,
  createWalletClient,
  custom,
  parseEther,
  encodeFunctionData,
  decodeFunctionData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { compileContracts } from "../../mainnet/build-contracts.mjs";
import { ComputeStore } from "../../../lib/compute/store.mjs";
import { chain } from "../../../lib/compute/chain.mjs";
import { sha } from "../../../lib/compute/config.mjs";
mkdirSync(".sites-runtime/mainnet", { recursive: true });
await build({
  entryPoints: ["scripts/mainnet/operator.mjs"],
  outfile: ".sites-runtime/mainnet/operator-test.mjs",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
});
const { makePlan, validatePlanActions, executePlan, sendJournaled, fundReserves, INITIAL_FUNDING } =
  await import("../../../.sites-runtime/mainnet/operator-test.mjs");
const fixture =
  'pragma solidity ^0.8.24; contract FixtureToken{string public constant symbol="PERL";uint8 public constant decimals=18;uint256 public constant totalSupply=1000000000 ether;mapping(address=>uint256)public balanceOf;mapping(address=>mapping(address=>uint256))public allowance;constructor(){balanceOf[msg.sender]=1000000 ether;}function grant(address to,uint256 n)external{balanceOf[to]+=n;}function approve(address to,uint256 n)external returns(bool){allowance[msg.sender][to]=n;return true;}function transferFrom(address from,address to,uint256 n)external returns(bool){require(balanceOf[from]>=n&&allowance[from][msg.sender]>=n);allowance[from][msg.sender]-=n;balanceOf[from]-=n;balanceOf[to]+=n;return true;}}';
test("activation and signed transaction recovery on isolated chain 4663", async (t) => {
  const provider = ganache.provider({
      logging: { quiet: true },
      chain: { chainId: 4663 },
      wallet: { deterministic: true },
    }),
    initial = provider.getInitialAccounts(),
    account = privateKeyToAccount(Object.values(initial)[0].secretKey),
    client = createPublicClient({ chain, transport: custom(provider) }),
    wallet = createWalletClient({
      account,
      chain,
      transport: custom(provider),
    }),
    s = new ComputeStore();
  try {
    const compiled = compileContracts({
      "FixtureToken.sol": { content: fixture },
      "FixtureUSDG.sol": { content: USDG_FIXTURE },
    }).contracts;
    await installUSDG(
      provider,
      client,
      wallet,
      account.address,
      compiled.FixtureUSDG,
    );
    const a = compiled.FixtureToken;
    const r = await client.waitForTransactionReceipt({
        hash: await wallet.deployContract({
          abi: a.abi,
          bytecode: a.bytecode,
          gas: 5000000n,
        }),
      }),
      c = {
        origin: "https://perla.example",
        token: r.contractAddress,
        markupBps: 2000,
        features: {},
      };
    const plan = await makePlan(c, account.address, {}, client);
    await t.test(
      "plan predicts both vaults and bounds all five transactions",
      () => {
        validatePlanActions(plan);
        assert.equal(plan.actions.length, 5);
        assert.equal(plan.nextConfig.features.mining, false);
        assert.equal(plan.initialFunding.total, (1000000n*10n**18n).toString());
        const approval=decodeFunctionData({abi:a.abi,data:plan.actions[2].data});
        assert.equal(approval.args[1],INITIAL_FUNDING.total);
        assert.equal(INITIAL_FUNDING.mining+INITIAL_FUNDING.migration,INITIAL_FUNDING.total);
      },
    );
    await t.test("self-rehashed plan cannot change funding recipient", () => {
      const p = structuredClone(plan);
      p.actions[2].to = account.address;
      delete p.hash;
      p.hash = sha(p);
      assert.throws(() => validatePlanActions(p), /unreviewed/);
    });
    await t.test(
      "plan executes only reviewed vault creation and capped funding",
      async () => {
        const result = await executePlan(s, c, plan, wallet, client);
        assert.equal(result.report.miningFunded, "650000000000000000000000");
        assert.equal(
          result.report.migrationFunded,
          "350000000000000000000000",
        );
      },
    );
    await t.test(
      "rerun reconciles the same confirmed transactions without nonce change",
      async () => {
        const n = await client.getTransactionCount({
          address: account.address,
        });
        await executePlan(s, c, plan, wallet, client);
        assert.equal(
          await client.getTransactionCount({ address: account.address }),
          n,
        );
      },
    );
    await t.test("legacy 200M funding plans are rejected before signing",()=>{
      const old=structuredClone(plan);delete old.initialFunding;assert.throws(()=>validatePlanActions(old),/legacy 200M/);
    });
    await t.test("incremental top-ups are exact, recoverable and cannot replay or change pools",async()=>{
      await client.waitForTransactionReceipt({hash:await wallet.writeContract({address:c.token,abi:a.abi,functionName:"grant",args:[account.address,200000n*10n**18n]})});
      const opts={pool:"mining",amount:"100000",requestId:"mining-test-001"};
      const result=await fundReserves(s,c,wallet,opts,client);assert.equal(result.amountBaseUnits,(100000n*10n**18n).toString());
      assert.equal(await client.readContract({address:c.rewardVault,abi:compiled.PerlaMainnetRewards.abi,functionName:"miningFunded"}),750000n*10n**18n);
      const nonce=await client.getTransactionCount({address:account.address});
      await fundReserves(s,c,wallet,opts,client);assert.equal(await client.getTransactionCount({address:account.address}),nonce);
      await assert.rejects(fundReserves(s,c,wallet,{...opts,amount:"99999"},client),{code:"journal_conflict"});
      await assert.rejects(fundReserves(s,c,wallet,{...opts,pool:"migration"},client),{code:"journal_conflict"});
      await assert.rejects(fundReserves(s,c,wallet,{...opts,amount:"130000000",requestId:"over-cap-001"},client),{code:"reserve_cap"});
      await fundReserves(s,c,wallet,{pool:"migration",amount:"100000",requestId:"migration-test-001"},client);
      assert.equal(await client.readContract({address:c.rewardVault,abi:compiled.PerlaMainnetRewards.abi,functionName:"migrationFunded"}),450000n*10n**18n);
    });
    await t.test(
      "signed bytes survive an ambiguous broadcast and resume exactly once",
      async () => {
        const action = {
          to: c.token,
          data: encodeFunctionData({
            abi: a.abi,
            functionName: "approve",
            args: [account.address, 1n],
          }),
          gas: "100000",
        };
        const unavailable = {
          ...client,
          sendRawTransaction: async () => {
            throw Error("offline");
          },
        };
        await assert.rejects(
          () =>
            sendJournaled(s, unavailable, wallet, action, "recovery-test", {
              remaining: parseEther("0.01"),
            }),
          /uncertain/,
        );
        const j = s.get(
          "SELECT * FROM compute_operator_journal WHERE reference='recovery-test'",
        );
        assert.equal(j.state, "signed");
        const hash = JSON.parse(j.payload).hash;
        const receipt = await sendJournaled(
          s,
          client,
          wallet,
          action,
          "recovery-test",
          { remaining: parseEther("0.01") },
        );
        assert.equal(receipt.transactionHash, hash);
        const n = await client.getTransactionCount({
          address: account.address,
        });
        await sendJournaled(s, client, wallet, action, "recovery-test", {
          remaining: parseEther("0.01"),
        });
        assert.equal(
          await client.getTransactionCount({ address: account.address }),
          n,
        );
      },
    );
  } finally {
    s.close();
    await provider.disconnect();
  }
});
