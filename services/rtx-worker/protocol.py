"""Perla dense certificate-v3 construction, independent of a particular GPU.

Derivation follows Pearl 82e6eee7 (ISC); see NOTICE.md. No node, token contract,
private key, model download, or paid inference request is involved here.
"""
from __future__ import annotations

import base64
import struct
import json
import hashlib
from pathlib import Path
from dataclasses import dataclass

import numpy as np
from blake3 import blake3

UPSTREAM_COMMIT = "82e6eee7076aafe10123e08db78f100d270c0582"
PROTOCOL = "perla-pearl-plain-v4"
RANK = 128
M = N = 128
ROWS = np.array([0, 8, 64, 72], dtype=np.intp)
COLS = np.array([0, 1, 8, 9, 32, 33, 40, 41], dtype=np.intp)
ROW_OFFSETS = [i for i in range(128) if i & (8 | 64) == 0]
COL_OFFSETS = [i for i in range(128) if i & (1 | 8 | 32) == 0]
TILES = [(r, c) for r in ROW_OFFSETS for c in COL_OFFSETS]
MAX_U256 = (1 << 256) - 1
SHARE_BITS = 0x1d00ffff
POLICY = json.loads(Path(__file__).with_name("work-profiles.json").read_text())
PROFILES = {p["bits"]: p for p in POLICY["profiles"]}
SALT_A = blake3(b"pearl/cert-v3/noise-seed/A").digest()
SALT_B = blake3(b"pearl/cert-v3/noise-seed/B").digest()


def native():
    import pearl_mining as pm
    if pm.__version__ != "0.3.1":
        raise RuntimeError("Expected pinned py-pearl-mining 0.3.1")
    return pm


def config(k=2048):
    if k not in (2048, 4096):
        raise ValueError("The RTX validation profile admits K=2048 or K=4096")
    pm = native()
    return pm.MiningConfiguration(common_dim=k, rank=RANK,
        mma_type=pm.MMAType.Int7xInt7ToInt32,
        rows_pattern=pm.PeriodicPattern.from_list(ROWS.tolist()),
        cols_pattern=pm.PeriodicPattern.from_list(COLS.tolist()))


def validate_job(job, now, origin=None):
    """Fail closed on untrusted coordinator data before allocating GPU work."""
    if not isinstance(job, dict) or job.get("protocol") != PROTOCOL or job.get("chainId") != 46630:
        raise ValueError("Coordinator protocol or chain does not match this worker")
    import uuid
    if str(uuid.UUID(job["id"])) != job["id"]:
        raise ValueError("Invalid job identifier")
    expires = job.get("expires")
    if type(expires) is not int or not now + 5 < expires <= now + 310:
        raise ValueError("Mining job is expired or has an unexpected lifetime")
    mining = job.get("mining_job")
    if not isinstance(mining, dict) or type(mining.get("cert_version")) is not int or mining["cert_version"] != 3:
        raise ValueError("Only certificate version 3 is admitted")
    encoded = mining.get("incomplete_header_bytes")
    if not isinstance(encoded, str) or len(encoded) != 104:
        raise ValueError("Expected a canonical 76-byte mining challenge")
    header = base64.b64decode(encoded, validate=True)
    if len(header) != 76 or base64.b64encode(header).decode() != encoded:
        raise ValueError("Invalid mining challenge")
    version, timestamp, bits = struct.unpack_from("<I", header)[0], struct.unpack_from("<I", header, 68)[0], struct.unpack_from("<I", header, 72)[0]
    target = (bits & 0x7fffff) << (8 * ((bits >> 24) - 3)) if bits >> 24 > 3 else (bits & 0x7fffff) >> (8 * (3 - (bits >> 24)))
    if version != 1 or bits not in PROFILES or not now - 310 < timestamp <= now + 30:
        raise ValueError("Unexpected work domain, timestamp or share difficulty")
    # JSON may carry a decimal string to preserve uint256 precision.
    if type(mining.get("target")) not in (int, str) or str(mining["target"]) != str(target):
        raise ValueError("Mining target does not match the challenge")
    policy = job.get("workPolicy", {})
    profile = PROFILES[bits]
    if policy.get("bits") != bits or policy.get("profile") != profile["id"] or policy.get("points") != profile["points"]:
        raise ValueError("Job scoring does not match its server-assigned target")
    if origin:
        recipient, worker, epoch = job.get("recipient"), job.get("workerId"), job.get("epoch")
        if not isinstance(recipient, str) or not isinstance(worker, str) or type(epoch) is not int or epoch != timestamp // 86400:
            raise ValueError("Missing work recipient or UTC epoch binding")
        previous = hashlib.sha256(f"perla-work-v4|46630|{origin}|{epoch}".encode()).digest()[::-1]
        commitment = hashlib.sha256(f"perla-recipient-v4|46630|{worker}|{recipient}|{epoch}|{job['id']}".encode()).digest()[::-1]
        if header[4:36] != previous or header[36:68] != commitment:
            raise ValueError("Work domain or recipient commitment does not match")
    return header


def _draws(seed, key, count, slot):
    return b"".join(blake3(struct.pack("<8I", *[(i + 1 if j == slot else 0) for j in range(8)]) + seed, key=key).digest() for i in range(count))


def _uniform(seed, key, count):
    raw = np.frombuffer(_draws(seed, key, (count * RANK + 31) // 32, 0), np.uint8)[:count * RANK]
    return ((raw & 63).astype(np.int16) - 32).astype(np.int8).reshape(count, RANK)


def _permutation(seed, key, k):
    raw = np.frombuffer(_draws(seed, key, (k * 4 + 31) // 32, 1), dtype="<u4")[:k].astype(np.uint64)
    first = raw & 127
    second = first ^ (1 + ((127 * raw) >> 32))
    if np.any(second >= RANK) or np.any(first == second):
        raise RuntimeError("Invalid noise permutation")
    return first.astype(np.intp), second.astype(np.intp)


def noise(a, bt, key_a, key_b):
    """Sparse rank-128 noise, exactly matching the upstream V3 derivation.

    A_R and B_L have two nonzero entries per column/row. Indexed subtraction
    avoids a large host-side dense matmul; the primary GEMM runs on the GPU.
    B is stored transposed, as required by both the native Merkle tree and WMMA.
    """
    if a.dtype != np.int8 or bt.dtype != np.int8 or a.shape != bt.shape or a.shape[0] != M:
        raise ValueError("Expected two 128-by-K int8 arrays")
    if np.any(a < -64) or np.any(a > 63) or np.any(bt < -64) or np.any(bt > 63):
        raise ValueError("Unnoised inputs must be int7")
    k = a.shape[1]
    seed_a, seed_b = b"A_tensor" + bytes(24), b"B_tensor" + bytes(24)
    al, brt = _uniform(seed_a, key_a, M), _uniform(seed_b, key_b, N)
    af, ass = _permutation(seed_a, key_a, k)
    bf, bs = _permutation(seed_b, key_b, k)
    an = a.astype(np.int16) + al[:, af].astype(np.int16) - al[:, ass].astype(np.int16)
    btn = bt.astype(np.int16) + brt[:, bf].astype(np.int16) - brt[:, bs].astype(np.int16)
    return np.ascontiguousarray(an, dtype=np.int8), np.ascontiguousarray(btn, dtype=np.int8)


@dataclass
class Attempt:
    header: bytes
    a: np.ndarray
    bt: np.ndarray
    an: np.ndarray
    btn: np.ndarray
    tree_a: object
    tree_b: object
    key_a: bytes
    key_b: bytes
    config: object

    def proof(self, tile):
        pm = native()
        if type(tile) is not int or not 0 <= tile < len(TILES):
            raise ValueError("Invalid opened tile")
        ro, co = TILES[tile]
        rows, cols = (ROWS + ro).tolist(), (COLS + co).tolist()
        a_leaves = pm.MerkleTree.compute_leaf_indices_from_rows(rows, self.a.shape)
        b_leaves = pm.MerkleTree.compute_leaf_indices_from_rows(cols, self.bt.shape)
        return pm.PlainProof(m=M, n=N, k=self.a.shape[1], noise_rank=RANK,
            a_merkle_proof=pm.MatrixMerkleProof(proof=self.tree_a.get_multileaf_proof(a_leaves), row_indices=rows),
            bt_merkle_proof=pm.MatrixMerkleProof(proof=self.tree_b.get_multileaf_proof(b_leaves), row_indices=cols), moe=None)


def prepare(header, rng=None, k=2048):
    if len(header) != 76:
        raise ValueError("Expected 76-byte header")
    pm = native()
    cfg = config(k)
    rng = np.random.default_rng() if rng is None else rng
    a = rng.integers(-64, 64, (M, k), dtype=np.int8)
    bt = rng.integers(-64, 64, (N, k), dtype=np.int8)
    key = blake3(header + cfg.to_bytes()).digest()
    ta = pm.MerkleTree(data=pm.pad_to_chunk_boundary(a.tobytes()), key=key)
    tb = pm.MerkleTree(data=pm.pad_to_chunk_boundary(bt.tobytes()), key=key)
    root_a = blake3(ta.root + M.to_bytes(4, "little") + bytes(28), key=SALT_A).digest()
    root_b = blake3(tb.root + N.to_bytes(4, "little") + bytes(28), key=SALT_B).digest()
    key_b = blake3(key + root_b).digest()
    key_a = blake3(key_b + root_a).digest()
    an, btn = noise(a, bt, key_a, key_b)
    return Attempt(header, a, bt, an, btn, ta, tb, key_a, key_b, cfg)


def transcript_hash(words, key):
    a = np.asarray(words, dtype="<u4")
    if a.shape != (16,) or len(key) != 32:
        raise ValueError("Expected 16 transcript words and a 32-byte key")
    return int.from_bytes(blake3(a.tobytes(), key=key).digest(), "little")


def target_bound(header, k):
    bits = struct.unpack_from("<I", header, 72)[0]
    if bits not in PROFILES:
        raise ValueError("Unexpected share difficulty")
    cfg = config(k)
    base = (bits & 0x7fffff) << (8 * ((bits >> 24) - 3))
    bound = native().penalized_target_bound(base, cfg)
    if bound is None or not 0 < bound < MAX_U256:
        raise ValueError("Saturating or invalid work target is not admitted")
    return bound


def verify(attempt, proof):
    pm = native()
    return pm.verify_plain_proof_for_cert_version(3, pm.IncompleteBlockHeader.from_bytes(attempt.header), proof)
