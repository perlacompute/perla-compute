# Perla Compute — current testnet release

Perla's workspace supports GPU worker setup and reuse, verified contribution receipts, qualifying reward rounds and funded PERL claims on Robinhood Testnet.

- Worker-v0.9.1 retains permanent identity, owner-approved reconnect and continuous mining by default.
- Reward rounds use a difficulty-weighted PPLNS window. Ordinary shares alone do not unlock tokens. Earned closed epochs are funded automatically; public miners claim in Reward Center.
- The public website connects miner setup, Proof Explorer, Reward Center, current service status and the recorded RTX 4090-to-earned-claim result.
- RTX Docker builds include the round-policy file, and production HTTP checks send the current reward-policy header while retaining rejection checks for legacy clients.
- Repository maintenance removes completed account-setup drafts and obsolete patch handoff documents, consolidates release history, updates architecture and repairs links and source checksums.

The maintenance update preserves the current worker release assets, protocol, contracts, reward policy, contribution history and VPS runtime. The public Software checks run provides the published commit's CI result; local application and contract checks retain their documented scope.

[Changelog](CHANGELOG.md) · [Mining and rewards](docs/REWARD-ROUNDS.md) · [Recorded earned claim](docs/releases/rewards-live-20261104.md) · [Operations](docs/TESTNET-OPERATIONS.md)

Mainnet and migration remain closed. No physical GPU test, public-chain transaction or independent security audit is performed by this repository cleanup.
