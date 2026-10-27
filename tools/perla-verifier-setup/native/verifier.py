#!/usr/bin/env python3
"""Native Pearl PlainProof verifier. No Pearl node and no private wallet keys.

The heavy native parser/verifier runs in a bounded subprocess. Do not expose
this HTTP service directly: put it behind TLS and a strong shared token.
"""
import argparse
import base64
import hashlib
import hmac
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM_COMMIT = '82e6eee7076aafe10123e08db78f100d270c0582'
PROTOCOL = 'perla-pearl-plain-v3'
MAX_PROOF_BYTES = 5 * 1024 * 1024
MAX_BODY = (MAX_PROOF_BYTES * 4 // 3) + 4096
SHARE_BITS = 0x207fffff
CURRENT_PROTOCOL = 'perla-pearl-plain-v4'
PROFILE_BITS = {0x1d00ffff, 0x1c7fff80, 0x1c3fffc0, 0x1c1fffe0, 0x1c0ffff0}


def verify_native(payload):
    import pearl_mining as pm
    if payload.get('cert_version') != 3:
        raise ValueError('Only certificate version 3 is admitted')
    header_bytes = base64.b64decode(payload['header'], validate=True)
    proof_bytes = base64.b64decode(payload['plain_proof'], validate=True)
    if len(header_bytes) != 76 or not 64 <= len(proof_bytes) <= MAX_PROOF_BYTES:
        raise ValueError('Proof or header size is outside admission bounds')
    header = pm.IncompleteBlockHeader.from_bytes(header_bytes)
    protocol = payload.get('protocol', PROTOCOL)
    allowed = {SHARE_BITS} if protocol == PROTOCOL else PROFILE_BITS if protocol == CURRENT_PROTOCOL else set()
    if header.nbits not in allowed or header.version != 1:
        raise ValueError('Unexpected work domain or share target')
    proof = pm.PlainProof.from_base64(payload['plain_proof'])
    # First release admits dense GEMM only. No unsupported MoE or low-rank shares.
    if proof.moe is not None or proof.noise_rank != 128 or not 2048 <= proof.k <= 32768:
        raise ValueError('Proof is outside the dense/rank-128 validation profile')
    if not 1 <= proof.m <= 16777216 or not 1 <= proof.n <= 16777216:
        raise ValueError('Invalid matrix dimensions')
    if protocol == CURRENT_PROTOCOL:
        rows, cols = proof.a.row_indices, proof.bt.row_indices
        if not rows or not cols or len(rows) * len(cols) > 256:
            raise ValueError('Proof tile exceeds the non-saturating work profile')
        # Native derives this factor from opened tile area and K. Bounding both
        # prevents a custom certificate from restoring the old saturated target.
    valid, _message = pm.verify_plain_proof_for_cert_version(3, header, proof)
    return {
        'valid': bool(valid), 'protocol': protocol, 'upstream_commit': UPSTREAM_COMMIT,
        'header_hash': hashlib.sha256(header_bytes).hexdigest(),
        'proof_hash': hashlib.sha256(proof_bytes).hexdigest(),
    }


def child():
    # Isolate untrusted bincode parsing, native panics, and oversized allocations.
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (2 * 1024**3, 2 * 1024**3))
        resource.setrlimit(resource.RLIMIT_CPU, (20, 20))
    except ImportError:
        raise SystemExit('Native verifier isolation requires Linux')
    try:
        raw = sys.stdin.buffer.read(MAX_BODY + 1)
        if len(raw) > MAX_BODY:
            raise ValueError('Oversized request')
        payload = json.loads(raw)
        result = verify_native(payload)
    except (ValueError, KeyError, TypeError, OverflowError):
        result = {'valid': False, 'protocol': CURRENT_PROTOCOL if isinstance(locals().get('payload'), dict) and payload.get('protocol') == CURRENT_PROTOCOL else PROTOCOL, 'upstream_commit': UPSTREAM_COMMIT}
    print(json.dumps(result))


def check_installation():
    pm = importlib.import_module('pearl_mining')
    if pm.__version__ != '0.3.1':
        raise RuntimeError('Expected py-pearl-mining 0.3.1 from the pinned checkout')
    source = Path(os.environ['PERLA_PEARL_SOURCE']).resolve()
    stamp = source / 'PERLA_UPSTREAM_COMMIT'
    actual = stamp.read_text().strip() if stamp.exists() else subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    if actual != UPSTREAM_COMMIT:
        raise RuntimeError('Upstream checkout does not match this release')


def serve(host, port):
    check_installation()
    token = os.environ.get('PERLA_VERIFIER_TOKEN', '')
    if len(token) < 32:
        raise SystemExit('Set PERLA_VERIFIER_TOKEN to a random secret of at least 32 characters')
    semaphore = threading.BoundedSemaphore(2)

    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def log_message(self, *_args):
            pass  # Do not log authorization, proof payloads, or request bodies.

        def respond(self, data, status=200):
            raw = json.dumps(data).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(raw)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Connection', 'close')
            self.end_headers()
            self.wfile.write(raw)
            self.close_connection = True

        def authorized(self):
            return hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + token)

        def do_GET(self):
            if not self.authorized():
                return self.respond({'error': 'Unauthorized'}, 401)
            if self.path != '/health':
                return self.respond({'error': 'Not found'}, 404)
            return self.respond({'ready': True, 'protocol': PROTOCOL, 'upstream_commit': UPSTREAM_COMMIT, 'supported_protocols': [PROTOCOL, CURRENT_PROTOCOL], 'version': '0.5.0', 'mode': 'native-plain-proof', 'profile': 'dense-rank128'})

        def do_POST(self):
            if not self.authorized():
                return self.respond({'error': 'Unauthorized'}, 401)
            if self.path != '/verify':
                return self.respond({'error': 'Not found'}, 404)
            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                return self.respond({'error': 'Invalid length'}, 400)
            if not 1 <= length <= MAX_BODY:
                return self.respond({'error': 'Request too large'}, 413)
            if not semaphore.acquire(blocking=False):
                return self.respond({'error': 'Verifier busy'}, 503)
            try:
                self.connection.settimeout(10)
                raw = self.rfile.read(length)
                result = subprocess.run([sys.executable, str(Path(__file__).resolve()), '--verify-child'], input=raw, capture_output=True, timeout=23, env=dict(os.environ, RAYON_NUM_THREADS='2'))
                if result.returncode:
                    return self.respond({'error': 'Native verifier process failed'}, 503)
                return self.respond(json.loads(result.stdout))
            except (subprocess.TimeoutExpired, ValueError, OSError):
                return self.respond({'error': 'Native verifier could not complete'}, 503)
            finally:
                semaphore.release()

    server = ThreadingHTTPServer((host, port), Handler)
    print(f'Perla native verifier listening on {host}:{server.server_port}', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--verify-child', action='store_true')
    args = parser.parse_args()
    child() if args.verify_child else serve(args.host, args.port)
