#!/usr/bin/env python3
"""Perla RTX matrix miner. Experimental host validation for RTX 30/40/50.

An actual CUDA device is mandatory. Offline CPU oracles never submit work.
The standalone workload is synthetic dense matrix mining, not AI inference.
"""
from __future__ import annotations
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import signal
import struct
import sys
import time

import numpy as np
from cuda_backend import CudaBackend
from protocol import UPSTREAM_COMMIT, PROTOCOL, TILES, native, prepare, transcript_hash, target_bound, validate_job, verify
from reference import compute as reference_compute, selected_transcript

# Source tree and the downloadable archive share the same bridge implementation.
if not Path(__file__).with_name("perla_bridge.py").is_file():
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pearl-adapter"))
from perla_bridge import PerlaClient

VERSION = "0.5.0"
STOP = False


def emit(event, **values):
    print(json.dumps({"event": event, **values}, sort_keys=True), flush=True)


def test_header():
    return struct.pack("<I", 1) + hashlib.sha256(b"perla-rtx-offline-previous").digest() + hashlib.sha256(b"perla-rtx-offline-commitment").digest() + struct.pack("<II", 1792972800, 0x207fffff)


def selftest(backend):
    """Every output cell, all transcript words, native V3 proof, wrong header.

    This has no endpoint/token arguments and cannot create contribution credit.
    K=4096 additionally exercises cyclic transcript rotation after chunk 16.
    """
    started = time.monotonic()
    # Use a non-saturating offline target to bind device transcripts to native PoW.
    header = test_header()[:-4] + struct.pack("<I", 0x1e07ffff)
    attempt = prepare(header, np.random.default_rng(4300 + backend.k), backend.k)
    c, transcripts, ms = backend.compute(attempt.an, attempt.btn)
    expected_c, expected_tr = reference_compute(attempt.an, attempt.btn)
    np.testing.assert_array_equal(c, expected_c, err_msg="GPU full GEMM differs from CPU oracle")
    np.testing.assert_array_equal(transcripts, expected_tr, err_msg="GPU partial-sum transcripts differ from CPU oracle")
    bound = (0x07ffff << 216) * 32 * backend.k
    hits = [i for i, words in enumerate(transcripts) if transcript_hash(words, attempt.key_a) <= bound]
    misses = [i for i, words in enumerate(transcripts) if transcript_hash(words, attempt.key_a) > bound]
    if not hits or not misses:
        raise RuntimeError("Offline PoW vector did not include both a winner and a non-winner")
    proof = attempt.proof(hits[0])
    valid, reason = verify(attempt, proof)
    if not valid:
        raise RuntimeError("GPU self-test native V3 proof rejected: " + str(reason)[:180])
    negative_valid, _ = verify(attempt, attempt.proof(misses[0]))
    if negative_valid:
        raise RuntimeError("Native verifier accepted a PoW that misses the offline target")
    pm = native()
    changed = bytearray(attempt.header); changed[40] ^= 1
    changed_valid, _ = pm.verify_plain_proof_for_cert_version(3, pm.IncompleteBlockHeader.from_bytes(bytes(changed)), proof)
    if changed_valid:
        raise RuntimeError("Native verifier incorrectly accepted changed challenge")
    # Extremes also cover signed-input and negative-accumulator interpretation.
    high = np.full((128, backend.k), 126, np.int8)
    low = np.full((128, backend.k), -127, np.int8)
    ec, etr, _ = backend.compute(high, low)
    rc, rtr = reference_compute(high, low)
    np.testing.assert_array_equal(ec, rc, err_msg="GPU signed GEMM differs at input extremes")
    np.testing.assert_array_equal(etr, rtr, err_msg="GPU transcript differs at input extremes")
    return {"k": backend.k, "fullGemmMatchesReference": True, "allTranscriptsMatchReference": True,
        "signedExtremesMatchReference": True, "nativeV3ProofAccepted": True, "nonWinningPowRejected": True, "changedChallengeRejected": True,
        "proofHash": hashlib.sha256(base64.b64decode(proof.to_base64())).hexdigest(),
        "gpuComputeMs": round(ms, 3), "elapsedSeconds": round(time.monotonic() - started, 3)}


def validation_report(device):
    cases, info = [], None
    for k in (2048, 4096):
        with CudaBackend(device, k) as backend:
            info = backend.info
            cases.append(selftest(backend))
    return {"version": VERSION, "protocol": PROTOCOL, "upstreamCommit": UPSTREAM_COMMIT,
        "device": info, "cases": cases, "gpuSelfTestPassed": True,
        "coordinatorContacted": False, "ledgerCredit": 0, "aiInferenceValidated": False,
        "checkedAt": datetime.now(timezone.utc).isoformat()}


def choose_proof(attempt, transcripts):
    bound = target_bound(attempt.header, attempt.a.shape[1])
    if transcripts.shape != (len(TILES), 16) or transcripts.dtype != np.uint32:
        raise ValueError("Invalid GPU transcript output")
    for i, words in enumerate(transcripts):
        if transcript_hash(words, attempt.key_a) <= bound:
            # Recheck the selected device output with an independent host oracle.
            np.testing.assert_array_equal(words, selected_transcript(attempt.an, attempt.btn, i), err_msg="Selected GPU transcript does not match input")
            proof = attempt.proof(i)
            valid, reason = verify(attempt, proof)
            if not valid:
                raise RuntimeError("Local native proof verification failed: " + str(reason)[:180])
            return proof
    return None


def run_worker(args, client_factory=PerlaClient, backend_factory=CudaBackend):
    client = client_factory(os.environ.get("PERLA_ENDPOINT", ""), os.environ.get("PERLA_WORKER_TOKEN", ""))
    emit("workload", mode="standalone-matrix-mining", aiInference=False, version=VERSION)
    # A new container must demonstrate actual GPU correctness, never trust an
    # editable cached report or a reported architecture alone.
    with backend_factory(args.device, args.k) as backend:
        checks = selftest(backend)
        emit("gpu_selftest_passed", device=backend.info, checks=checks, ledgerCredit=0)
        client.architecture = backend.info.get("computeCapability")
        accepted, attempts, no_hits = 0, 0, 0
        job, last_poll = None, 0.0
        while accepted < args.shares and not STOP:
            if job is None or time.time() >= job["expires"] - 5 or time.monotonic() - last_poll >= 15:
                refreshed = client.call("work")
                header = validate_job(refreshed, time.time(), client.endpoint)
                job, last_poll = refreshed, time.monotonic()
            if STOP:
                break
            started = time.monotonic()
            attempt = prepare(header, k=args.k)
            _c, transcripts, ms = backend.compute(attempt.an, attempt.btn)
            proof = choose_proof(attempt, transcripts)
            attempts += 1
            if STOP:
                break
            if time.time() >= job["expires"] - 3:
                emit("stale_attempt", job=job["id"], submitted=False)
                job = None
                continue
            if proof is None:
                no_hits += 1
                if attempts % 25 == 0:
                    emit("mining_progress", attempts=attempts, noWinningProof=no_hits, accepted=accepted)
                continue
            # An ambiguous POST is never retried automatically. It may already
            # have committed; inspect the ledger using its job ID before retrying.
            receipt = client.call("shares", {"jobId": job["id"], "plainProof": proof.to_base64()})
            if not isinstance(receipt, dict) or receipt.get("accepted") is not True or receipt.get("points") != job["workPolicy"]["points"] or not isinstance(receipt.get("id"), str):
                raise RuntimeError("Coordinator did not return a matching receipt; inspect the account before retrying")
            accepted += 1
            emit("accepted_share", id=receipt["id"], job=job["id"], epoch=receipt.get("epoch"), points=receipt["points"],
                gpuComputeMs=round(ms, 3), attempts=attempts,
                explorer=client.endpoint + "/explorer/" + receipt["id"])
            job = None
            if accepted < args.shares:
                deadline = time.monotonic() + args.interval
                while not STOP and time.monotonic() < deadline:
                    time.sleep(min(0.25, max(0, deadline - time.monotonic())))
    return accepted


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("selftest", "run"))
    parser.add_argument("--device", type=int, default=0)
    parser.add_argument("--k", type=int, choices=(2048, 4096), default=2048)
    parser.add_argument("--shares", type=int, default=1, help="Accepted shares before stopping; default 1 for controlled validation")
    parser.add_argument("--interval", type=float, default=10, help="Seconds between successful jobs; minimum 5")
    args = parser.parse_args(argv)
    if not 0 <= args.device < 64 or not 1 <= args.shares <= 100000 or not np.isfinite(args.interval) or not 5 <= args.interval <= 3600:
        parser.error("Use GPU index 0..63, shares 1..100000 and interval 5..3600 seconds")
    def stop(*_):
        global STOP
        STOP = True
    signal.signal(signal.SIGTERM, stop); signal.signal(signal.SIGINT, stop)
    try:
        if args.command == "selftest":
            print(json.dumps(validation_report(args.device), indent=2), flush=True)
        else:
            run_worker(args)
        return 0
    except (RuntimeError, ValueError, KeyError, TypeError, OSError, AssertionError) as exc:
        # Never print a traceback with request objects or worker credentials.
        message = str(exc)
        token = os.environ.get("PERLA_WORKER_TOKEN", "")
        if token:
            message = message.replace(token, "[redacted]")
        print("Perla RTX stopped: " + message[:400], file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
