/** Public explanations for the implemented Perla validation profile. */
export const miningFlow = [
  { title: 'Set a reward wallet', detail: 'Enter your public EVM address in the worker command. Use that wallet to authorize dashboard management and funded claims.' },
  { title: 'Name and connect a worker', detail: 'Choose a rig name. The CLI saves its private connection and uploads GPU checks automatically on the GPU host.' },
  { title: 'Receive a challenge', detail: 'The coordinator creates a short-lived job bound to this site, network, epoch, worker and recipient.' },
  { title: 'Compute on your GPU', detail: 'The RTX preview runs standalone matrix mining. The separate Hopper vLLM integration produces proofs during supported AI inference operations.' },
  { title: 'Check the proof', detail: 'An isolated native verifier checks the admitted work. An accepted job creates one persistent contribution record.' },
  { title: 'Publish a funded epoch', detail: 'The operator snapshots points and funds a distribution root. The account shows a claim after onchain activation checks pass.' },
] as const;

export const workloads = [
  { title: 'RTX matrix mining', profile: 'RTX 30 / 40 / 50 · sm86 / sm89 / sm120 · certificate v3', result: 'Standalone GPU matrix work and native proof', status: 'One RTX 4090 trial recorded', note: 'The reported RTX 4090 passed GPU checks and produced an accepted receipt. RTX 30/50 and sustained operation need separate tests. This workload serves no customer inference.' },
  { title: 'Dense matrix computation', profile: 'Dense NoisyGEMM · rank 128 · certificate v3', result: 'Matrix work and a native mining proof', status: 'Integration implemented', note: 'GPU execution remains a deployment-host check.' },
  { title: 'Reference text inference', profile: 'Reference 70B checkpoint · pinned model-serving plugin', result: 'An AI response, with shares possible during supported operations', status: 'GPU validation pending', note: 'The reference command uses two GPUs. Actual VRAM needs depend on configuration.' },
  { title: 'Protocol test fixture', profile: 'CPU-generated native PlainProof', result: 'Reproducible proof-to-ledger validation', status: 'Software tested', note: 'This exercises mathematics and accounting; it is not an AI service or GPU benchmark.' },
] as const;

export const verificationGates = [
  { title: 'Bound to one job', detail: 'The submitted proof must belong to the authenticated worker’s unexpired challenge. The recipient is taken from the account.' },
  { title: 'Checked natively', detail: 'The pinned native verifier checks the supported certificate and matrix proof. Invalid or unavailable verification earns no points.' },
  { title: 'Committed once', detail: 'Before recording a share, the coordinator checks expiry, revocation and epoch closure again. A unique job constraint blocks double credit.' },
  { title: 'Funded before a claim', detail: 'The distribution contract must match the expected chain, token, root and budget before an allocation appears in the account.' },
] as const;

export const securityControls = [
  ['Wallet authorization', 'Expiring, domain-bound challenges are consumed once. Account sessions use HttpOnly cookies.'],
  ['Worker access', 'Each worker has a separate revocable token. The ledger stores a hash of the token, and account reads do not reveal it.'],
  ['Proof processing', 'Request sizes, supported dimensions and verifier resources are bounded. Verification failures do not create contribution records.'],
  ['Reward claims', 'The claim commits to the chain, contract, epoch, allocation index, wallet and amount. Repeating a claim cannot pay it twice.'],
] as const;

export const miningFaqs = [
  ['What is Perla?', 'Perla is building GPU compute infrastructure with verifiable work records and funded settlement on Robinhood. Its current RTX testnet validates matrix computation, proof submission and wallet-bound contribution accounting.'],
  ['Why run testnet mining?', 'It exercises worker connections, mathematical verification and contribution accounting before useful customer jobs are introduced. The current standalone RTX challenges are infrastructure tests; they do not fulfill paid AI requests.'],
  ['Does this mining secure Robinhood?', 'Perla records application-level work and reward allocations on Robinhood. Its workers do not produce Robinhood blocks or participate in Robinhood consensus.'],
  ['How would Perla earn revenue?', 'The intended product direction is a compute service: customers pay for useful GPU jobs and Perla charges a service fee. Customer dispatch, billing and platform-fee revenue are future product work. The current RTX trial has not demonstrated customer revenue; testnet reward budgets require explicit funding.'],
  ['What is the GPU actually doing?', 'The RTX preview computes standalone dense INT8 matrix mining without a model checkpoint. The separate H100/H200 path serves an AI model through the pinned model-serving plugin. Both construct native mining proofs; matrix mining alone does not demonstrate customer AI inference.'],
  ['Does an accepted share prove an AI answer is true?', 'It verifies the admitted mathematical mining work. It does not establish the truth, safety or quality of a complete AI answer, identify the physical GPU, or prove that a paying customer requested it.'],
  ['Is mining open now?', 'The Network Status page reads the deployment’s current admission setting. When admission is enabled, connected workers can request jobs; accepted proofs create contribution records. Token claims require a separately funded epoch.'],
  ['Which hardware can I use?', 'The experimental RTX package includes sm86 for RTX 30, sm89 for RTX 40 and sm120 for RTX 50 series on Linux. Each needs a real GPU self-test and accepted receipt before being described as validated. The separate H100/H200 vLLM path targets sm90. Windows-native mining is outside this release.'],
  ['Can I mine in a browser or on my CPU?', 'The browser manages your account and displays server records. It does not run the CUDA miner. CPU proof fixtures are used for software tests and are not an advertised participant mining path.'],
  ['Do I need to run a blockchain node?', 'No. RTX workers talk directly to the Perla coordinator over scoped HTTPS; the vLLM path uses a local bridge. Reward contracts use Robinhood Chain Testnet, while proof checking and contribution accounting run offchain.'],
  ['Can I use several workers?', 'Yes. Register each installation separately under your wallet. Each gets its own token and job history. Accepted shares from those workers contribute to the same account total.'],
  ['What earns a point?', 'A verified job adds the points stored in its server-assigned difficulty profile. The p1 profile awards one point; harder profiles use the exact target ratio. Uptime, an open browser, a model response or a worker-reported speed does not add points by itself. A job is credited at most once.'],
  ['How do points become a claim?', 'After a UTC epoch closes and its final jobs expire, the operator prepares an allocation from accepted points. A claim is exposed only after the corresponding test-token root is funded and checked onchain.'],
  ['What is the token supply?', 'The testnet contract source creates a fixed 1,000,000,000 PERL. The planned Pons mainnet supply is 1,000,000,000 PERL. They are separate contracts; testnet balances do not automatically convert into mainnet tokens.'],
  ['How is the mining budget released?', 'The testnet reference policy uses a declining daily budget, using a 1B PERL pool and a 1,460-day constant. The reward setup pins the mining-policy start epoch, and the coordinator enforces the daily budget. Closed-epoch preparation is idempotent; each epoch still needs an owner funding transaction before claims open. Empty days have no automatic rollover. The mainnet plan allocates 70M to testnet reward migration and 130M to future mainnet mining; actual reserve funding remains pending.'],
  ['Is there a mainnet allocation or guaranteed return?', 'The mainnet plan sets a 200M mining allocation within a fixed 1B supply: 70M for verified testnet reward migration and 130M for mining after mainnet. The planned conversion is 100 eligible testnet PERL to 7 mainnet PERL, with a global 1M mainnet PERL output cap per UTC day. Bridge is coming soon; reserves and migration contracts are not funded by this release. No yield or monetary return is guaranteed.'],
  ['Who pays for the hardware and gas?', 'Participants operate their own GPU or pay their chosen hosting provider for capacity, electricity and bandwidth. Signing the account message does not spend gas. Testnet contract deployment, funding and claims require test ETH; claims can also be relayed to the committed recipient.'],
  ['Who do I trust?', 'The operator runs the native verifier, stores the contribution ledger and publishes the reward root. The contract enforces its funded allocation, but cannot determine whether the offchain ledger is complete. There is no EVM-native ZK verifier in this release.'],
  ['What happens if a token is lost or exposed?', 'A worker token cannot be displayed again. Revoke it and register a replacement. Keep wallet recovery phrases and private keys out of the worker configuration; only the scoped worker token belongs there.'],
  ['Has Perla been externally audited?', 'No independent external audit has been completed. The software validation record describes tests and their scope. Those checks do not replace a deployed GPU run, a security review or live contract verification.'],
] as const;

export const glossary = [
  ['Worker', 'One registered miner installation with its own access token.'],
  ['Coordinator', 'The service that authorizes workers, issues challenges and records accepted contributions.'],
  ['Job', 'A five-minute mining challenge for a specific worker and recipient; it is separate from an AI request.'],
  ['Share', 'A native proof accepted for that job under the current admission rules.'],
  ['PlainProof', 'The native proof format checked by the pinned mathematical verifier.'],
  ['NoisyGEMM', 'The upstream matrix-computation integration used by the supported mining profile.'],
  ['Epoch', 'One UTC day of contribution accounting. Jobs retain the epoch in which they were issued.'],
  ['Contribution point', 'One unit of validation accounting awarded per accepted job in this profile.'],
  ['Reward root', 'A Merkle commitment to the wallets and amounts in a funded epoch allocation.'],
  ['Claim', 'A contract call that proves inclusion in the funded allocation and pays its committed recipient.'],
] as const;

export const baselineEvidence = [
  ['Native mining integration', '25 checks', 'Real native Rust/PyO3 verification and TCP bridge, with CPU-generated test proofs.'],
  ['Persistent VPS ledger', '6 checks', 'Migrations, uniqueness, rollback, reopen persistence and consistent backups.'],
  ['Production web flow', '7 checks', 'HTTP routes, wallet registration, process restart, canonical HTTPS origin and Secure cookies.'],
  ['Protected inference boundary', '12 checks', 'Authorization, request limits and server-side provider credentials.'],
  ['Funded reward contracts', '10 checks', 'Local EVM funding, immutable roots, recipient binding and claim replay rejection.'],
] as const;
