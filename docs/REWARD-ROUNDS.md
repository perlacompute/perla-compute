# Round rewards v1 — testnet cutover

Shares measure valid weighted work; they are not a points balance or a promise of PERL. The same native proof is checked against the share target and a harder round target without changing its original header.

- Initial round difficulty: 256 times reference p1; bounds 256–2,048.
- PPLNS window: twice the round difficulty, counted in exact share work units. The winning share is included and the oldest share may be partially included.
- Controller: after 16 won rounds, move at most one difficulty step. Target interval 194 seconds, with a half-to-double deadband. These are initial settings, not a measured GPU benchmark.
- Daily cap: consecutive differences of floor(1B × 10^18 × d / (d + 1460)), retaining the original emission start.
- Round reward: floor(daily cap / 446); maximum 446 completed rounds per UTC epoch. No qualifying winner means no reward.
- No rollover. Unused tokens stay in treasury.
- Maximum 5,000 reward recipients per epoch, including addresses carried into the maximum PPLNS window. This is an operational bound, not one-person-one-worker enforcement.
- Jobs commit to the round ID and policy hash and expire at UTC close. Round closure rejects stale proofs without credit; an explicit safe rejection can fetch fresh work. An ambiguous submission is never blindly retried.
- Each won round atomically stores its winner and recipient-weight snapshot. Integer amounts use largest remainder, with deterministic address tie-breaking.
- After UTC close plus five minutes, only earned round amounts enter a version-2 manifest. Funding and activation are separate owner actions using the existing distributor.

## Fresh testnet generation

The owner-authorized fresh-testnet installer removes all old local work and reward history after a consistent private backup and canonical chain inspection. Unfunded allocations are cancelled and removed, and the daily emission starts again from the reset epoch. All old worker credentials and wallet sessions are invalidated. The reset runs once; subsequent installer runs preserve fresh contributions. Blockchain history is immutable.

## Automatic funding and opening

The configured encrypted systemd signer prepares, funds and activates earned closed epochs every two minutes, after UTC close plus five minutes. An isolated 1 PERL contract round trip is excluded from mining earnings. In the owner-only test phase, real earned allocations are relayed to the owner. Public mining opens automatically after fresh GPU, sustained-work, qualifying-round, treasury and real earned-claim evidence passes. See TESTNET-OPERATIONS.md for the complete workflow.
