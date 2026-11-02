import base64
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('round_native_verifier', ROOT / 'services/pearl-adapter/verifier.py')
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)

class RoundVerifierTests(unittest.TestCase):
    def fixture(self, share=True, winner=True):
        self.calls = []
        header = types.SimpleNamespace(nbits=0x1d00ffff, version=1)
        proof = types.SimpleNamespace(moe=None, noise_rank=128, k=2048, m=16, n=16,
                                      a=types.SimpleNamespace(row_indices=[0]), bt=types.SimpleNamespace(row_indices=[0]))
        def verify(cert, actual_header, actual_proof, **kwargs):
            self.assertIs(actual_header, header)
            self.assertIs(actual_proof, proof)
            self.assertEqual(actual_header.nbits, 0x1d00ffff)
            self.calls.append(kwargs)
            return (winner if kwargs else share), 'fixture'
        pm = types.SimpleNamespace(IncompleteBlockHeader=types.SimpleNamespace(from_bytes=lambda _: header),
             PlainProof=types.SimpleNamespace(from_base64=lambda _: proof), verify_plain_proof_for_cert_version=verify)
        payload = dict(cert_version=3, header=base64.b64encode(bytes(76)).decode(),
             plain_proof=base64.b64encode(bytes(64)).decode(), protocol=v.CURRENT_PROTOCOL, round_bits=0x1c00ffff)
        return pm, payload

    def test_same_original_header_is_checked_against_the_harder_target(self):
        pm,p=self.fixture()
        with patch.dict(sys.modules, {'pearl_mining':pm}): r=v.verify_native(p)
        self.assertTrue(r['valid']); self.assertTrue(r['round_valid'])
        self.assertEqual(self.calls,[{}, {'nbits_override':0x1c00ffff}])
        self.assertEqual(r['round_target_policy'],'perla-rounds-v1')

    def test_ordinary_valid_share_does_not_win_a_round(self):
        pm,p=self.fixture(winner=False)
        with patch.dict(sys.modules, {'pearl_mining':pm}): r=v.verify_native(p)
        self.assertTrue(r['valid']); self.assertFalse(r['round_valid'])

    def test_invalid_share_never_reaches_the_round_check(self):
        pm,p=self.fixture(share=False)
        with patch.dict(sys.modules, {'pearl_mining':pm}): r=v.verify_native(p)
        self.assertFalse(r['round_valid']); self.assertEqual(self.calls,[{}])

    def test_unreviewed_target_is_rejected(self):
        pm,p=self.fixture();p['round_bits']=0x207fffff
        with patch.dict(sys.modules, {'pearl_mining':pm}), self.assertRaises(ValueError):v.verify_native(p)
