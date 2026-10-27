"""Software/native tests. CPU oracle injection is confined to this test module.

These tests do not demonstrate CUDA execution or GPU support on physical cards.
Run with pinned pearl_mining, numpy and blake3 installed.
"""
import argparse
import base64
import contextlib
import io
import json
import struct
import hashlib
import sys
import time
import unittest
import uuid
from unittest.mock import patch
import numpy as np
import miner
import protocol as p
from reference import compute, selected_transcript
from perla_bridge import PerlaClient

TOKEN = "a" * 64
NOW = 1792972800


def job():
    ident,worker=str(uuid.uuid4()),str(uuid.uuid4())
    epoch=NOW//86400;recipient='0x'+'11'*20;origin='https://perla.invalid'
    previous=hashlib.sha256(f'perla-work-v4|46630|{origin}|{epoch}'.encode()).digest()[::-1]
    commitment=hashlib.sha256(f'perla-recipient-v4|46630|{worker}|{recipient}|{epoch}|{ident}'.encode()).digest()[::-1]
    h=struct.pack('<I',1)+previous+commitment+struct.pack('<II',NOW,p.SHARE_BITS)
    return {"id":ident,"workerId":worker,"recipient":recipient,"epoch":epoch,"chainId":46630,"protocol":p.PROTOCOL,
        "expires":NOW+300,"workPolicy":{"profile":"p1","points":1,"bits":p.SHARE_BITS},
        "mining_job":{"incomplete_header_bytes":base64.b64encode(h).decode(),"target":str(0xffff<<208),"cert_version":3}}


class OracleBackend:
    """Test double, never installed as the worker's runtime backend."""
    def __init__(self, device=0, k=2048):
        self.k, self.info = k, {"name": "CPU TEST DOUBLE", "computeCapability": 0}
    def compute(self, a, b):
        c, tr = compute(a, b)
        return c, tr, 0
    def __enter__(self): return self
    def __exit__(self, *_): pass


class Client:
    def __init__(self, *_):
        self.endpoint, self.calls = "https://perla.invalid", []
    def call(self, path, payload=None):
        self.calls.append((path, payload))
        if path == "work": return job()
        if path == "shares":
            return {"id": str(uuid.uuid4()), "accepted": True, "points": 1, "epoch": NOW // 86400}
        raise AssertionError("Unexpected endpoint")


class ProtocolTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pm = p.native()
        cls.attempt = p.prepare(miner.test_header(), np.random.default_rng(22), 2048)
        cls.c, cls.tr = compute(cls.attempt.an, cls.attempt.btn)

    def test_patterns_partition_every_output_cell_once(self):
        seen = [(int(r + ro), int(c + co)) for ro, co in p.TILES for r in p.ROWS for c in p.COLS]
        self.assertEqual(len(seen), 16384)
        self.assertEqual(len(set(seen)), 16384)
        self.assertEqual(set(seen), {(r, c) for r in range(128) for c in range(128)})

    def test_noise_matches_independent_dense_integer_construction(self):
        a = self.attempt
        for seed, key, original, actual in [(b"A_tensor"+bytes(24), a.key_a, a.a, a.an), (b"B_tensor"+bytes(24), a.key_b, a.bt, a.btn)]:
            # Explicit sparse matrix multiplication rather than indexed subtraction.
            uniform = p._uniform(seed, key, 128).astype(np.int64)
            f, s = p._permutation(seed, key, 2048)
            permutation = np.zeros((128, 2048), np.int64)
            permutation[f, np.arange(2048)] = 1
            permutation[s, np.arange(2048)] = -1
            expected = (original.astype(np.int64) + uniform @ permutation).astype(np.int8)
            np.testing.assert_array_equal(actual, expected)

    def test_opened_tiles_reconstruct_native_v3_proofs(self):
        for tile in [0, 255, 511]:
            with self.subTest(tile=tile):
                self.assertTrue(p.verify(self.attempt, self.attempt.proof(tile))[0])
                np.testing.assert_array_equal(self.tr[tile], selected_transcript(self.attempt.an, self.attempt.btn, tile))

    def test_non_saturating_pow_matches_native_accept_and_reject(self):
        for k in (2048, 4096):
            h = miner.test_header()[:-4] + struct.pack("<I", 0x1e07ffff)
            a = p.prepare(h, np.random.default_rng(4300+k), k)
            _c, tr = compute(a.an, a.btn)
            bound = (0x07ffff << 216) * 32 * k
            good = [i for i, w in enumerate(tr) if p.transcript_hash(w, a.key_a) <= bound]
            bad = [i for i, w in enumerate(tr) if p.transcript_hash(w, a.key_a) > bound]
            self.assertTrue(good and bad)
            self.assertTrue(p.verify(a, a.proof(good[0]))[0])
            self.assertFalse(p.verify(a, a.proof(bad[0]))[0])

    def test_changed_challenge_rejects_an_existing_native_proof(self):
        changed = bytearray(self.attempt.header); changed[40] ^= 1
        valid, _ = self.pm.verify_plain_proof_for_cert_version(3, self.pm.IncompleteBlockHeader.from_bytes(bytes(changed)), self.attempt.proof(0))
        self.assertFalse(valid)

    def test_k4096_exercises_transcript_rotation_and_native_proof(self):
        with OracleBackend(k=4096) as backend:
            report = miner.selftest(backend)
        self.assertTrue(report["nonWinningPowRejected"])
        self.assertTrue(report["allTranscriptsMatchReference"])

    def test_unsupported_shapes_and_out_of_range_inputs_fail(self):
        for k in (128, 256, 1024, 8192):
            with self.assertRaises(ValueError): p.config(k)
        with self.assertRaises(ValueError): self.attempt.proof(512)
        with self.assertRaises(ValueError): p.noise(np.full((128,2048), 127,np.int8), self.attempt.bt, self.attempt.key_a, self.attempt.key_b)

    def test_legacy_saturation_is_not_admitted_by_v4(self):
        with self.assertRaises(ValueError): p.target_bound(miner.test_header(), 2048)
        for bits in p.PROFILES:
            h=miner.test_header()[:-4]+struct.pack('<I',bits)
            self.assertLess(p.target_bound(h,2048),(1<<256)-1)
        self.assertIsNone(self.pm.penalized_target_bound((0x7fffff)<<232, p.config(2048)))
        self.assertTrue(p.verify(self.attempt, self.attempt.proof(0))[0])

    def test_job_checks_chain_protocol_cert_target_header_and_expiry(self):
        j=job();self.assertEqual(p.validate_job(j,NOW,"https://perla.invalid"),base64.b64decode(j["mining_job"]["incomplete_header_bytes"]))
        with self.assertRaises(ValueError): p.validate_job(j,NOW,"https://wrong-origin.invalid")
        legacy=job();legacy["mining_job"]["incomplete_header_bytes"]=base64.b64encode(miner.test_header()).decode()
        with self.assertRaises(ValueError):p.validate_job(legacy,NOW)
        modifications = [("chainId", 4663), ("protocol", "different"), ("expires", NOW-1), ("expires", NOW+10000)]
        for key, value in modifications:
            j = job(); j[key] = value
            with self.assertRaises(ValueError): p.validate_job(j, NOW)
        for key, value in [("cert_version", 2), ("cert_version", True), ("target", "1"), ("target", True), ("incomplete_header_bytes", "YQ==")]:
            j = job(); j["mining_job"][key] = value
            with self.assertRaises(ValueError): p.validate_job(j, NOW)

    def test_cuda_loader_has_no_cpu_fallback(self):
        with self.assertRaisesRegex(RuntimeError, "CUDA backend unavailable"):
            miner.CudaBackend(library="/nonexistent/perla-rtx.so")

    def test_corrupt_selected_gpu_transcript_cannot_be_submitted(self):
        tr = self.tr.copy(); tr[0,0] ^= 1
        with patch.object(miner,"target_bound",return_value=(1<<256)-1):
            with self.assertRaises(AssertionError): miner.choose_proof(self.attempt, tr)

    def test_client_requires_scoped_token_and_https_remote_origin(self):
        for url in ["http://public.example", "https://good.example@bad.example", "https://example.test/path", "https://example.test?token=secret"]:
            with self.assertRaises(ValueError): PerlaClient(url, TOKEN)
        for token in ["", "x"*64, "a"*63]:
            with self.assertRaises(ValueError): PerlaClient("https://perla.invalid", token)

    def execute(self, client, backend=OracleBackend):
        args = argparse.Namespace(device=0, k=2048, shares=1, interval=10)
        with patch.dict(miner.os.environ, {"PERLA_ENDPOINT":"https://perla.invalid", "PERLA_WORKER_TOKEN":TOKEN}), patch.object(miner.time, "time", return_value=NOW), patch.object(miner,"choose_proof",return_value=self.attempt.proof(0)), contextlib.redirect_stdout(io.StringIO()):
            return miner.run_worker(args, client_factory=lambda *_: client, backend_factory=backend)

    def test_worker_state_machine_submits_once_and_uses_receipt(self):
        client = Client()
        self.assertEqual(self.execute(client), 1)
        self.assertEqual([p for p,_ in client.calls], ["work", "shares"])
        self.assertNotIn(TOKEN, json.dumps(client.calls))

    def test_failed_gpu_selftest_never_contacts_coordinator(self):
        class Bad(OracleBackend):
            def compute(self, a,b):
                c,tr,ms = super().compute(a,b); c[0,0] ^= 1; return c,tr,ms
        client = Client()
        with self.assertRaises(AssertionError): self.execute(client, Bad)
        self.assertEqual(client.calls, [])

    def test_missing_gpu_never_contacts_coordinator(self):
        class Missing:
            def __init__(self,*_): raise RuntimeError("No GPU")
        client = Client()
        with self.assertRaisesRegex(RuntimeError,"No GPU"): self.execute(client, Missing)
        self.assertEqual(client.calls, [])

    def test_paused_admission_never_submits(self):
        class Paused(Client):
            def call(self, path, payload=None):
                self.calls.append((path,payload)); raise ValueError("Mining admission is paused")
        client = Paused()
        with self.assertRaisesRegex(ValueError,"paused"): self.execute(client)
        self.assertEqual([p for p,_ in client.calls], ["work"])

    def test_ambiguous_submission_is_not_retried(self):
        class Unknown(Client):
            def call(self,path,payload=None):
                if path == "shares":
                    self.calls.append((path,payload)); raise OSError("Response lost")
                return super().call(path,payload)
        client = Unknown()
        with self.assertRaisesRegex(OSError,"Response lost"): self.execute(client)
        self.assertEqual([p for p,_ in client.calls], ["work","shares"])

    def test_no_winning_attempt_continues_without_submission(self):
        client=Client();proof=self.attempt.proof(0)
        args=argparse.Namespace(device=0,k=2048,shares=1,interval=10)
        with patch.object(miner.time,"time",return_value=NOW), patch.object(miner,"choose_proof",side_effect=[None,proof]), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(miner.run_worker(args,client_factory=lambda *_:client,backend_factory=OracleBackend),1)
        self.assertEqual([path for path,_ in client.calls],["work","shares"])

    def test_offline_selftest_uses_no_coordinator_or_credit(self):
        with patch.object(miner,"CudaBackend",OracleBackend), patch.object(PerlaClient,"call",side_effect=AssertionError("Network forbidden")):
            report = miner.validation_report(0)
        self.assertFalse(report["coordinatorContacted"])
        self.assertEqual(report["ledgerCredit"],0)
        self.assertFalse(report["aiInferenceValidated"])
        self.assertEqual([x["k"] for x in report["cases"]],[2048,4096])


if __name__ == "__main__":
    unittest.main(verbosity=2)
