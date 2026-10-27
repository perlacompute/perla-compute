# PERL testnet deployment

The active testnet asset is **PERL**, with a fixed supply of **1,000,000,000 tokens** and 18 decimals on **Robinhood Testnet 46630**. Mainnet remains on hold.

| Contract | Address |
| --- | --- |
| PERL token | `0xfeAB80c7665973D91F3f3FAB36CBB3183C8dC4F8` |
| Reward distributor | `0xa35C0Cb08279998c2948Ac340ef056d07bDC5547` |
| Deployer / distributor owner | `0x118098eC5C6469055fA1DAF1653e9bb647F0368F` |

Deployment was reported by the VPS operator on 27 October 2026. Token transaction: `0xee1dcd6a7b43754bf672d575ac4ee8eda0a35e699ce0ec080decf31aac189350`. Distributor transaction: `0x9ea6b186bdcc0b97ba959e1c598cf6b6d547da0f86628acc4c6e6329d268b00b`.

The connector checks these deployment receipts against canonical blocks, compares runtime bytecode, reads PERL metadata and fixed supply, and verifies the distributor owner and rewardToken before switching configuration. This is separate from source verification by the explorer. The deployment setup did not publish verified source to the explorer.

## Reward lifecycle

Deploying the token does not activate mining, fund an epoch, or make a wallet eligible for rewards. The initial supply belongs to the deployer. Contributions are recorded offchain; an operator prepares a closed epoch, reviews its allocation, approves the budget, funds its Merkle root onchain, and separately activates the matching epoch in the coordinator. Claims pay the committed recipient.

Use the configured PERLA_REWARD_TOKEN and PERLA_DISTRIBUTOR_ADDRESS together. Do not rerun token deployment merely to configure mining. A real GPU-to-receipt run and a separately funded test claim are still required before public reward activation.

## Earlier tPERLA deployment

The old token at `0xdf5a38ef066b026a88cfab52bbbb5b00c8a8a254` and distributor at `0x6f573855c81d82acfa82cdc9fcf2af8d3dd2327b` remain separate historical contracts. Their symbols, balances and roots are not renamed or rewritten. The original token source is archived under contracts/legacy and its public record under deployments/robinhood-testnet-tperla.json.

First integration requires paused mining, no reward epochs in the coordinator, and zero token balances at both the old and new distributor. The connector refuses to move an existing epoch to a different distributor. On repeat runs, an already connected installation is checked without rewriting valid later reward records.

Testnet PERL and any future mainnet PERL are separate contracts and balances. An equal ticker and supply do not create a bridge, conversion right, mainnet allocation, or funded mainnet mining reserve.

[Token explorer](https://explorer.testnet.chain.robinhood.com/address/0xfeAB80c7665973D91F3f3FAB36CBB3183C8dC4F8) · [Distributor explorer](https://explorer.testnet.chain.robinhood.com/address/0xa35C0Cb08279998c2948Ac340ef056d07bDC5547)
