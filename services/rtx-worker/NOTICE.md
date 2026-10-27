# Perla RTX worker: attribution and evidence

Perla-authored CUDA backend, runtime and validation tools: MIT, as in the root
Perla source LICENSE. The downloadable archive includes that license.

Native PlainProof types, Merkle construction, salted certificate-v3 seed
specification, noise generation and verification are derived from Pearl
Research Labs' source pinned at:
https://github.com/pearl-research-labs/pearl/tree/82e6eee7076aafe10123e08db78f100d270c0582

ISC License

Copyright (c) 2025-2026 Pearl Research Labs
Copyright (c) 2015-2016 The Decred developers

Permission to use, copy, modify, and distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

The build obtains unmodified native sources and their licenses. Plonky2 retains
its MIT/Apache-2.0 notices. NVIDIA CUDA/WMMA headers and runtime retain NVIDIA's
license; the GPU image preserves its container license. No third-party miner
binary is bundled or executed, and no developer-fee pool is contacted.

This worker computes standalone synthetic dense matrix workloads. It does not
serve an AI model, demonstrate useful customer demand, guarantee earnings, or
attest physical GPU identity. CPU reference tests cannot establish GPU support.
All three CUDA architecture targets require physical-host validation before
public admission. No Pearl node or new blockchain is created.
