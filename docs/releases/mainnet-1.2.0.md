# Start Perla mainnet with 1M PERL and top up reserves as needed

Activation now deposits exactly **1M PERL total**, split into **650k mining and 350k earned testnet migration**. The 130M/70M lifetime allocation caps and the published mining/migration economics stay unchanged. The previous installer incorrectly required full lifetime funding at launch.

- Validate the owner against 1M, approve exactly 1M and fund the two initial amounts. Reject legacy 200M plans before signing; replace an unsigned saved plan safely.
- Add explicit, journaled reserve top-ups. Reusing a request ID cannot transfer twice or change its amount/pool. Refresh cached funding after confirmation.
- Include already-earned unpublished round liabilities in mining admission. Pause new work when a full next reward round lacks backing and resume after a top-up.
- Retain an eligible migration snapshot when its reserve is insufficient. Claims remain closed until the snapshot is fully backed; mining and the independent API continue.
- Preserve API keys, Playground, USDG payments, worker release assets and both lifetime reserve caps. No automatic refill or recurring token debit is introduced.

Validation: 79 Node mainnet checks (including a local EVM activation from an owner holding exactly 1M, exact reserve balances, top-up retries/caps and pending-round backpressure), 4 offline installer checks, 19 Compose checks, 6 public CLI boundary checks and the retained handoff suite. Local EVM tests are not public-chain transfers or physical GPU evidence. Publication/deployment remain pending until the operator runs the package.
