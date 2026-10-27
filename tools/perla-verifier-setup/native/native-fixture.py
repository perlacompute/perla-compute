#!/usr/bin/env python3
"""CPU-only native proof fixture for integration tests, never a GPU benchmark."""
import base64
import json
import sys
import time
import pearl_mining as pm

payload = json.load(sys.stdin)
header = pm.IncompleteBlockHeader.from_bytes(base64.b64decode(payload['header'], validate=True))
config = pm.MiningConfiguration(
    common_dim=2048, rank=128, mma_type=pm.MMAType.Int7xInt7ToInt32,
    rows_pattern=pm.PeriodicPattern.from_list([0, 8, 64, 72]),
    cols_pattern=pm.PeriodicPattern.from_list([0, 1, 8, 9, 32, 33, 40, 41]),
)
started = time.monotonic()
proof = pm.mine(128, 128, 2048, header, config, cert_version=3)
valid, message = pm.verify_plain_proof_for_cert_version(3, header, proof)
if not valid:
    raise RuntimeError(message)
json.dump({'header': payload['header'], 'plain_proof': proof.to_base64(), 'cert_version': 3, 'cpuReferenceSeconds': time.monotonic() - started}, sys.stdout)
