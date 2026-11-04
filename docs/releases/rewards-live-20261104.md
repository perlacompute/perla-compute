# GPU work to an earned PERL claim on Robinhood Testnet

The fresh Perla testnet completed its first earned reward cycle: a real GPU contribution won a qualifying round, epoch 20760 closed and was funded, and **1,532.570312341986489842 PERL** reached the worker's reward wallet. The running service subsequently reported `ready: true` and `phase: live`. This result concerns testnet chain **46630**. Mainnet and migration remain on hold.

## What earns a reward

Receiving a job creates no reward. An accepted share records verified contribution weight. A proof meeting the harder round target closes a winning round; the round reward is divided across the recorded PPLNS contribution window. The closed epoch aggregates those earned amounts. Unused daily capacity stays in the treasury, with no rollover.

The operator scheduler prepares, funds and activates matching earned allocations after the UTC epoch closes and the five-minute safety window passes. **For public miners, funding is automatic; claiming is a separate action in Reward Center.** During the initial validation phase, the operator relayed the approved validation wallet's claim automatically. That validation relay is not a promise of automatic payouts to every public miner.

## Recorded public evidence

| Record | Value |
| --- | --- |
| Network | Robinhood Testnet, chain 46630 |
| Worker release | worker-v0.9.1 |
| Observed GPU | NVIDIA GeForce RTX 4090 |
| Epoch / qualifying rounds | 20760 / 1 |
| Recorded work in the allocation | 99 work units, 1 recipient |
| Earned amount | 1,532.570312341986489842 PERL |
| Reward token | `0xfeAB80c7665973D91F3f3FAB36CBB3183C8dC4F8` |
| Distributor | `0xa35C0Cb08279998c2948Ac340ef056d07bDC5547` |
| Recipient | `0xc1189f7160f306465666e9718167386862c98dff` |
| Funding transaction | [0xc310…3da9](https://explorer.testnet.chain.robinhood.com/tx/0xc310e19b20e3a805cd177f5521580d2c23a31641c09cf836cf455017a6593da9) |
| Earned claim transaction | [0xa6e3…b9cd](https://explorer.testnet.chain.robinhood.com/tx/0xa6e376f0e7562251e19939307e1d3a82a4e0698768333058e3c1b3a58359b9cd) |

The isolated 1 PERL contract smoke test is excluded. The earlier legacy allocation is outside the fresh dataset and is not evidence of mining earnings. A live readiness response is a snapshot; inspect current service status before relying on availability.

## Reproduce the reward proof

After `npm ci` with Node 24:

```bash
node scripts/verify-earned-reward.mjs
```

This read-only check rebuilds the earned allocation and all Merkle proofs, verifies canonical successful funding/claim receipts, matches the distributor events and actual PERL transfer, and checks the onchain claim bit, immutable epoch root/budget, reward token and owner. It signs and submits no transaction.

The evidence, allocation manifest and public receipts are in [docs/evidence](../evidence). For recorded data only, use `node scripts/verify-earned-reward.mjs --recorded`. Recorded verification makes no fresh canonical-chain claim. Run `npm run check:earned-proof` for rejection checks using copies of the recorded public receipts.

## Source synchronized with the deployed fix

- Admit the configured public validation wallet alongside the contract owner during testing while retaining the original owner signer and worker identity.
- Follow the configured wallet's earned allocation through validation relay and readiness checks. The isolated smoke claim cannot satisfy earned-reward readiness.
- Keep the launch-validation panel on Service Status and hide it once the phase is live. Put deliberate connection replacement under Advanced options with readable checkbox/help layout.
- Add this earned-reward proof record, repeatable checker and CI rejection tests.

This closeout retains worker-v0.9.1 and the existing reward policy. It does not publish the prepared background worker, move an installer tag or change deployed contracts, data or credentials. Publication is performed by the operator's GitHub handoff; preparing these source files is not a push or deployment.

## Validation and limits

The configured-wallet automatic lifecycle suite uses a real temporary SQLite database and local EVM, with explicit GPU, verifier and GitHub doubles. Production HTTP/build checks cover the synchronized setup/status/rewards changes. The new proof rejection suite uses copies of the actual recorded public receipts, and the live proof check reads Robinhood Testnet directly.

The observed physical GPU was an RTX 4090. Receipt verification independently checks the token allocation and transfer, not physical hardware attestation, useful AI inference, broader GPU compatibility or production-scale load. This is not an independent audit or a measured yield promise. The precise local check results are recorded in `rewards-20261104-validation.json` beside the other evidence.

## X draft — not posted

Perla's fresh testnet completed its first earned GPU mining payout: 1,532.5703 $PERL to the worker's reward wallet, verified onchain.

Qualifying work, funded allocations and public testnet mining are now connected.

https://explorer.testnet.chain.robinhood.com/tx/0xa6e376f0e7562251e19939307e1d3a82a4e0698768333058e3c1b3a58359b9cd
