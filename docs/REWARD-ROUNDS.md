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

## Legacy validation allocation

The authorized cancellation is limited to epoch 20754, the reviewed owner wallet, 11 total work units and exactly 684462696783025325119780 base units. Fresh canonical Robinhood Testnet reads must confirm the matching reward token and zero root, budget and remaining allocation. RPC failure, reorg, different recipient, amount, manifest or funding metadata stops cancellation.

Cancellation retains the original root, manifest and accepted share history, plus a tombstone containing the observed canonical block and reason. It sends no blockchain transaction. A cancelled allocation cannot be prepared again or activated. Other prepared legacy allocations are held from automatic funding. Already funded legacy claims remain verifiable; this release cannot revoke a contract payment.

## Deployment

Use the all-in-one reward-rounds updater on the website VPS. It backs up source, the web image, native verifier and consistent SQLite state; publishes worker-v0.9.0; upgrades the verifier using the existing pinned native bindings; cancels the exact unfunded validation allocation; then activates the round policy. It does not request a wallet private key or fund any epoch. The master mining switch, worker credentials, accepted work and migration plan are preserved.

After the VPS update succeeds, run on each GPU host:

```bash
"$HOME/.local/bin/perla" update --release worker-v0.9.0
"$HOME/.local/bin/perla" start --device 0
```

The existing permanent Worker ID, name and reward wallet are reused. RTX installs can refresh reviewed Python integration files in an existing verified CUDA build; unknown modified caches are rejected. No manual worker.env transfer is needed.

Review and fund earned allocations separately:

```bash
cd /var/www/perla-vps
bash scripts/perla-rewards.sh review
bash scripts/perla-rewards.sh settle
```

The reviewer shows exact earned amounts before the dedicated testnet key is read silently. Mainnet and migration remain closed. Native proof verification does not establish hardware identity, customer AI revenue, independent audit completion or measured economic performance.
