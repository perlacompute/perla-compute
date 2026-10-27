# Upstream attribution and scope

Perla's GPU adapter interoperates with Pearl Research Labs' open-source miner.
Pinned source: https://github.com/pearl-research-labs/pearl/tree/82e6eee7076aafe10123e08db78f100d270c0582

The unmodified upstream checkout supplies NoisyGEMM CUDA kernels, the vLLM
plugin, PlainProof construction, and the Rust/PyO3 native verifier. Its root ISC
notice credits Pearl Research Labs (2025–2026) and the Decred developers
(2015–2016). Subprojects and bundled third-party libraries retain their own
licenses, including MIT/Apache-2.0 and NVIDIA CUTLASS BSD-3-Clause notices.
The setup scripts retain the complete checkout and all license notices.

Perla supplies its own work coordinator, wallet authorization, loopback bridge,
durable contribution ledger, reward accounting, and Robinhood settlement code.
The JSON-RPC getMiningInfo/submitPlainProof interface and 76-byte native
challenge format are reused for compatibility. Synthetic work envelopes are
domain-separated by site, chain, epoch, worker, recipient and random job ID.
They are not Pearl blocks. Perla does not operate or fork Pearl consensus.

The initial integration verifies native dense rank-128 certificate-v3
PlainProofs. It does not publish a Pearl ZK certificate on Robinhood and does
not claim EVM-native trustless verification of Pearl's proof circuits. A trusted
operator runs the native verifier and publishes funded reward roots.

The native CPU validation utility uses synthetic matrices to test the protocol.
It is not evidence of useful AI traffic, a running GPU deployment, performance,
profitability, or tokens earned. GPU contribution requires real inference
requests through the upstream vLLM plugin on validated hardware.
