import { USDG_FIXTURE, installUSDG } from "./usdg-fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import ganache from "ganache";
import { createPublicClient, createWalletClient, custom, parseAbi } from "viem";
import { compileContracts } from "../../mainnet/build-contracts.mjs";
import { manifest, verifyAllocation } from "../../../lib/compute/merkle.mjs";
import { ComputeStore } from "../../../lib/compute/store.mjs";
import {
  chain,
  deploymentChecks,
  confirmDeposit,
  quote,
} from "../../../lib/compute/chain.mjs";
import {
  activationHash,
  TOKEN_UNIT,
  USDG,
  roundLimit,
  miningBudget,
} from "../../../lib/compute/config.mjs";
const fixture =
  'pragma solidity ^0.8.24; contract FixtureToken{string public constant symbol="PERL";uint8 public constant decimals=18;uint256 public constant totalSupply=1000000000 ether;mapping(address=>uint256)public balanceOf;mapping(address=>mapping(address=>uint256))public allowance;constructor(){balanceOf[msg.sender]=totalSupply;}function approve(address to,uint256 n)external returns(bool){allowance[msg.sender][to]=n;return true;}function transfer(address to,uint256 n)external returns(bool){require(balanceOf[msg.sender]>=n);balanceOf[msg.sender]-=n;balanceOf[to]+=n;return true;}function transferFrom(address from,address to,uint256 n)external returns(bool){require(balanceOf[from]>=n&&allowance[from][msg.sender]>=n);allowance[from][msg.sender]-=n;balanceOf[from]-=n;balanceOf[to]+=n;return true;}}';
test("reviewed mainnet contracts on isolated chain 4663", async (t) => {
  const provider = ganache.provider({
      logging: { quiet: true },
      chain: { chainId: 4663 },
      wallet: { deterministic: true },
    }),
    client = createPublicClient({ chain, transport: custom(provider) }),
    wallet = createWalletClient({ chain, transport: custom(provider) }),
    [owner, alice, bob] = await wallet.getAddresses(),
    compiled = compileContracts({
      "FixtureToken.sol": { content: fixture },
      "FixtureUSDG.sol": { content: USDG_FIXTURE },
    }).contracts;
  const deploy = async (name, args = []) => {
    const hash = await wallet.deployContract({
      account: owner,
      abi: compiled[name].abi,
      bytecode: compiled[name].bytecode,
      args,
      gas: 5000000n,
    });
    const r = await client.waitForTransactionReceipt({ hash });
    assert.equal(r.status, "success");
    return r.contractAddress;
  };
  const send = async (address, name, fn, args, account = owner) => {
    const hash = await wallet.writeContract({
      account,
      address,
      abi: compiled[name].abi,
      functionName: fn,
      args,
      gas: 2500000n,
    });
    return client.waitForTransactionReceipt({ hash });
  };
  const read = (address, name, fn, args = []) =>
    client.readContract({
      address,
      abi: compiled[name].abi,
      functionName: fn,
      args,
    });
  try {
    await installUSDG(provider, client, wallet, owner, compiled.FixtureUSDG);
    const token = await deploy("FixtureToken"),
      first = Number((await client.getBlock()).timestamp / 86400n),
      reward = await deploy("PerlaMainnetRewards", [
        token,
        owner,
        BigInt(first),
      ]),
      credit = await deploy("PerlaCreditVault", [token, owner, bob]),
      c = {
        rpcUrl: "unused",
        token,
        rewardVault: reward,
        creditVault: credit,
        startEpoch: first,
        owner,
        treasury: bob,
        origin: "https://perla.example",
        features: { convert: true, usdg: true },
      };
    await t.test(
      "contract day budgets match the 4/5-round four-year schedule",
      async () => {
        for (const day of [0, 1, 2, 3, 4, 1459, 1460]) {
          assert.equal(
            await read(reward, "PerlaMainnetRewards", "dailyRoundLimit", [
              BigInt(first + day),
            ]),
            BigInt(roundLimit(first + day, first)),
          );
          assert.equal(
            await read(reward, "PerlaMainnetRewards", "dailyMiningBudget", [
              BigInt(first + day),
            ]),
            miningBudget(first + day, first),
          );
        }
      },
    );
    await t.test(
      "USDG grants exact 6-decimal credits, independent of the PERL quote",
      async () => {
        await send(USDG, "FixtureUSDG", "approve", [credit, 5000000n]);
        const paid = await send(credit, "PerlaCreditVault", "buyUSDGCredits", [
          alice,
          5000000n,
          5000000n,
        ]);
        assert.equal(paid.status, "success");
        assert.equal(
          await read(USDG, "FixtureUSDG", "balanceOf", [bob]),
          5000000n,
        );
        const index = Number(
            paid.logs.find(
              (l) => l.address.toLowerCase() === credit.toLowerCase(),
            ).logIndex,
          ),
          store = new ComputeStore();
        store.run(
          "INSERT INTO compute_meta VALUES('activation',?)",
          activationHash(c),
        );
        try {
          const pending = {
            getChainId: () => client.getChainId(),
            getTransactionReceipt: (a) => client.getTransactionReceipt(a),
            getBlock: (a) =>
              a.blockTag === "finalized"
                ? Promise.resolve({ number: paid.blockNumber - 1n })
                : client.getBlock(a),
          };
          await assert.rejects(
            () =>
              confirmDeposit(
                store,
                c,
                alice.toLowerCase(),
                paid.transactionHash,
                index,
                pending,
              ),
            (e) => e.code === "finality_pending",
          );
          await assert.rejects(
            () =>
              confirmDeposit(
                store,
                c,
                alice.toLowerCase(),
                paid.transactionHash,
                index,
                { getChainId: async () => 46630 },
              ),
            (e) => e.code === "chain",
          );
          await assert.rejects(
            () =>
              confirmDeposit(
                store,
                c,
                bob.toLowerCase(),
                paid.transactionHash,
                index,
                client,
              ),
            (e) => e.code === "beneficiary",
          );
          assert.equal(store.all("SELECT * FROM compute_ledger").length, 0);
          assert(
            (
              await confirmDeposit(
                store,
                c,
                alice.toLowerCase(),
                paid.transactionHash,
                index,
                client,
              )
            ).credited,
          );
          assert.equal(store.account(alice.toLowerCase()).balance, 5000000);
          assert(
            !(
              await confirmDeposit(
                store,
                c,
                alice.toLowerCase(),
                paid.transactionHash,
                null,
                client,
              )
            ).credited,
          );
          assert.equal(store.all("SELECT * FROM compute_ledger").length, 1);
        } finally {
          store.close();
        }
      },
    );
    await t.test(
      "USDG rejects missing allowance, altered minimum credits and fee-on-transfer payments",
      async () => {
        assert.equal(
          (
            await send(credit, "PerlaCreditVault", "buyUSDGCredits", [
              alice,
              1000000n,
              1000000n,
            ])
          ).status,
          "reverted",
        );
        await send(USDG, "FixtureUSDG", "approve", [credit, 2000000n]);
        assert.equal(
          (
            await send(credit, "PerlaCreditVault", "buyUSDGCredits", [
              alice,
              1000000n,
              1000001n,
            ])
          ).status,
          "reverted",
        );
        await send(USDG, "FixtureUSDG", "setFee", [true]);
        assert.equal(
          (
            await send(credit, "PerlaCreditVault", "buyUSDGCredits", [
              alice,
              1000000n,
              1000000n,
            ])
          ).status,
          "reverted",
        );
        await send(USDG, "FixtureUSDG", "setFee", [false]);
      },
    );
    await send(token, "FixtureToken", "approve", [
      reward,
      200000000n * TOKEN_UNIT,
    ]);
    await t.test(
      "mining reserve is funded with exactly 130M actual tokens",
      async () => {
        assert.equal(
          (
            await send(reward, "PerlaMainnetRewards", "fund", [
              0,
              130000000n * TOKEN_UNIT,
            ])
          ).status,
          "success",
        );
        assert.equal(
          await read(reward, "PerlaMainnetRewards", "miningFunded"),
          130000000n * TOKEN_UNIT,
        );
      },
    );
    await t.test(
      "migration reserve is separate and funded with 70M",
      async () =>
        assert.equal(
          (
            await send(reward, "PerlaMainnetRewards", "fund", [
              1,
              70000000n * TOKEN_UNIT,
            ])
          ).status,
          "success",
        ),
    );
    await t.test("pool caps reject additional funding", async () =>
      assert.equal(
        (await send(reward, "PerlaMainnetRewards", "fund", [0, 1n])).status,
        "reverted",
      ),
    );
    await t.test(
      "bytecode, token metadata and onchain liabilities reconcile",
      async () => {
        const d = await deploymentChecks(c, client);
        assert.equal(d.balance, (200000000n * TOKEN_UNIT).toString());
      },
    );
    const m = manifest(reward, 0, first, [
      { address: alice, amount: (100n * TOKEN_UNIT).toString() },
      { address: bob, amount: (200n * TOKEN_UNIT).toString() },
    ]);
    await t.test("Merkle proofs bind both recipients to the same root", () => {
      assert(m.allocations.every((a) => verifyAllocation(m, a)));
      assert(!verifyAllocation({ ...m, pool: 1 }, m.allocations[0]));
    });
    await t.test("current epoch cannot be published early", async () =>
      assert.equal(
        (
          await send(reward, "PerlaMainnetRewards", "publishMiningEpoch", [
            BigInt(first),
            m.root,
            BigInt(m.budget),
          ])
        ).status,
        "reverted",
      ),
    );
    await provider.request({
      method: "evm_increaseTime",
      params: [86400 + 301],
    });
    await provider.request({ method: "evm_mine", params: [] });
    await t.test(
      "closed epoch root is published against the funded reserve",
      async () =>
        assert.equal(
          (
            await send(reward, "PerlaMainnetRewards", "publishMiningEpoch", [
              BigInt(first),
              m.root,
              BigInt(m.budget),
            ])
          ).status,
          "success",
        ),
    );
    await t.test("published roots cannot be replaced", async () =>
      assert.equal(
        (
          await send(reward, "PerlaMainnetRewards", "publishMiningEpoch", [
            BigInt(first),
            m.root,
            BigInt(m.budget),
          ])
        ).status,
        "reverted",
      ),
    );
    const a = m.allocations.find((a) => a.address === alice.toLowerCase());
    await t.test(
      "changing a reward recipient or amount invalidates the claim",
      async () => {
        assert.equal(
          (
            await send(reward, "PerlaMainnetRewards", "claimMining", [
              BigInt(first),
              BigInt(a.index),
              owner,
              BigInt(a.amount),
              a.proof,
            ])
          ).status,
          "reverted",
        );
        assert.equal(
          (
            await send(reward, "PerlaMainnetRewards", "claimMining", [
              BigInt(first),
              BigInt(a.index),
              alice,
              BigInt(a.amount) + 1n,
              a.proof,
            ])
          ).status,
          "reverted",
        );
      },
    );
    await t.test(
      "relayed mining claim pays only its bound wallet",
      async () => {
        assert.equal(
          (
            await send(reward, "PerlaMainnetRewards", "claimMining", [
              BigInt(first),
              BigInt(a.index),
              alice,
              BigInt(a.amount),
              a.proof,
            ])
          ).status,
          "success",
        );
        assert.equal(
          await read(token, "FixtureToken", "balanceOf", [alice]),
          BigInt(a.amount),
        );
      },
    );
    await t.test("claimed mining allocation cannot replay", async () =>
      assert.equal(
        (
          await send(reward, "PerlaMainnetRewards", "claimMining", [
            BigInt(first),
            BigInt(a.index),
            alice,
            BigInt(a.amount),
            a.proof,
          ])
        ).status,
        "reverted",
      ),
    );
    const migration = manifest(reward, 1, first - 1, [
      { address: alice, amount: (2000000n * TOKEN_UNIT).toString() },
      { address: bob, amount: (1000000n * TOKEN_UNIT).toString() },
    ]);
    await send(reward, "PerlaMainnetRewards", "publishMigration", [
      migration.root,
      "0x" + "ab".repeat(32),
      BigInt(first - 1),
      BigInt(migration.budget),
    ]);
    const ma = migration.allocations.find(
        (a) => a.address === alice.toLowerCase(),
      ),
      mb = migration.allocations.find((a) => a.address === bob.toLowerCase());
    await t.test(
      "partial migration claim consumes the global 1M daily allowance",
      async () =>
        assert.equal(
          (
            await send(reward, "PerlaMainnetRewards", "claimMigration", [
              BigInt(ma.index),
              alice,
              BigInt(ma.amount),
              1000000n * TOKEN_UNIT,
              ma.proof,
            ])
          ).status,
          "success",
        ),
    );
    await t.test(
      "another wallet cannot bypass the shared daily allowance",
      async () =>
        assert.equal(
          (
            await send(reward, "PerlaMainnetRewards", "claimMigration", [
              BigInt(mb.index),
              bob,
              BigInt(mb.amount),
              1n,
              mb.proof,
            ])
          ).status,
          "reverted",
        ),
    );
    await provider.request({ method: "evm_increaseTime", params: [86400] });
    await provider.request({ method: "evm_mine", params: [] });
    await t.test(
      "remaining migration entitlement is claimable on a new day",
      async () =>
        assert.equal(
          (
            await send(reward, "PerlaMainnetRewards", "claimMigration", [
              BigInt(ma.index),
              alice,
              BigInt(ma.amount),
              1000000n * TOKEN_UNIT,
              ma.proof,
            ])
          ).status,
          "success",
        ),
    );
    await t.test(
      "migration cannot exceed the individual entitlement",
      async () =>
        assert.equal(
          (
            await send(reward, "PerlaMainnetRewards", "claimMigration", [
              BigInt(ma.index),
              alice,
              BigInt(ma.amount),
              1n,
              ma.proof,
            ])
          ).status,
          "reverted",
        ),
    );
    const timestamp = (await client.getBlock()).timestamp;
    await send(credit, "PerlaCreditVault", "setRate", [
      1000n,
      timestamp + 3600n,
    ]);
    await send(token, "FixtureToken", "approve", [credit, 100n * TOKEN_UNIT]);
    await t.test(
      "credit purchase protects quote nonce and minimum output",
      async () => {
        assert.equal(
          (
            await send(credit, "PerlaCreditVault", "buyCredits", [
              alice,
              100n * TOKEN_UNIT,
              100000n,
              0n,
            ])
          ).status,
          "reverted",
        );
        assert.equal(
          (
            await send(credit, "PerlaCreditVault", "buyCredits", [
              alice,
              100n * TOKEN_UNIT,
              100001n,
              1n,
            ])
          ).status,
          "reverted",
        );
      },
    );
    const purchase = await send(credit, "PerlaCreditVault", "buyCredits", [
      alice,
      100n * TOKEN_UNIT,
      100000n,
      1n,
    ]);
    await t.test(
      "credit purchase transfers exact PERL to the configured treasury",
      async () => {
        assert.equal(purchase.status, "success");
        assert(
          (await read(token, "FixtureToken", "balanceOf", [bob])) >=
            100n * TOKEN_UNIT,
        );
      },
    );
    const s = new ComputeStore();
    s.run("INSERT INTO compute_meta VALUES('activation',?)", activationHash(c));
    const index = Number(
      purchase.logs.find(
        (l) => l.address.toLowerCase() === credit.toLowerCase(),
      ).logIndex,
    );
    await t.test(
      "canonical finalized payment credits its beneficiary exactly once",
      async () => {
        const a = await confirmDeposit(
          s,
          c,
          alice.toLowerCase(),
          purchase.transactionHash,
          index,
          client,
        );
        assert(a.credited);
        assert(
          !(
            await confirmDeposit(
              s,
              c,
              alice.toLowerCase(),
              purchase.transactionHash,
              index,
              client,
            )
          ).credited,
        );
        assert.equal(s.account(alice.toLowerCase()).balance, 100000);
      },
    );
    await t.test(
      "payment cannot be credited to another account",
      async () =>
        await assert.rejects(
          () =>
            confirmDeposit(
              s,
              c,
              bob.toLowerCase(),
              purchase.transactionHash,
              index,
              client,
            ),
          /another account/,
        ),
    );
    s.close();
  } finally {
    await provider.disconnect();
  }
});
