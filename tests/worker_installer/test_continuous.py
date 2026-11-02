"""Exercise the real mining loop with transport/GPU doubles, never fake mining credit."""
import contextlib
import importlib.util
import io
import math
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_loop():
    # CI need not install native bindings or emulate an NVIDIA device.
    protocol = types.ModuleType('protocol')
    for name in ['native', 'prepare', 'transcript_hash', 'target_bound', 'validate_job', 'verify']:
        setattr(protocol, name, lambda *args, **kwargs: None)
    protocol.UPSTREAM_COMMIT, protocol.PROTOCOL, protocol.TILES = 'pinned', 'test-only', []
    stubs = {'numpy': types.SimpleNamespace(isfinite=math.isfinite), 'protocol': protocol,
             'cuda_backend': types.SimpleNamespace(CudaBackend=object),
             'reference': types.SimpleNamespace(compute=object, selected_transcript=object),
             'perla_bridge': types.SimpleNamespace(PerlaClient=object)}
    with patch.dict(sys.modules, stubs):
        return load('perla_continuous_loop', ROOT / 'services/rtx-worker/miner.py')


class Backend:
    info = {'name': 'CONTROL FLOW TEST DOUBLE', 'computeCapability': 89}
    def __init__(self, *args): pass
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def compute(self, *args): return None, None, 0.1


class ContinuousTests(unittest.TestCase):
    def setUp(self):
        self.m = load_loop()
        self.calls, self.events, self.clock = [], [], 0.0

    def run_loop(self, shares=0, stop_after=3, lost=False, stop_during_wait=False):
        module = self.m
        outer = self
        class Client:
            endpoint = 'https://perla.invalid'
            def call(self, path, payload=None):
                outer.calls.append(path)
                if path == 'work':
                    return {'id': 'job-' + str(len(outer.calls)), 'expires': 1300,
                            'epoch': 1, 'workPolicy': {'points': 1}}
                count = outer.calls.count('shares')
                if lost: raise OSError('Submission response lost')
                if stop_after is not None and count >= stop_after:
                    module.STOP = True
                return {'accepted': True, 'id': 'receipt-' + str(count), 'points': 1, 'epoch': 1}
        def sleep(seconds):
            self.clock += seconds
            if stop_during_wait: module.STOP = True
        args = types.SimpleNamespace(device=0, k=2048, shares=shares, interval=5)
        patches = [patch.object(module, 'selftest', return_value={'passed': True}),
                   patch.object(module, 'validate_job', return_value=b'header'),
                   patch.object(module, 'prepare', return_value=types.SimpleNamespace(an=None, btn=None)),
                   patch.object(module, 'choose_proof', return_value=types.SimpleNamespace(to_base64=lambda: 'fixture')),
                   patch.object(module, 'emit', side_effect=lambda event, **kw: self.events.append((event, kw))),
                   patch.object(module.time, 'time', return_value=1000),
                   patch.object(module.time, 'monotonic', side_effect=lambda: self.clock),
                   patch.object(module.time, 'sleep', side_effect=sleep)]
        with contextlib.ExitStack() as stack:
            for item in patches: stack.enter_context(item)
            return module.run_worker(args, client_factory=lambda *args: Client(), backend_factory=Backend)

    def test_continuous_mode_requests_another_job_after_the_first_and_second_share(self):
        self.assertEqual(self.run_loop(), 3)
        self.assertEqual(self.calls, ['work', 'shares'] * 3)
        self.assertEqual(self.events[0][0], 'workload')
        self.assertEqual(self.events[1][1]['mode'], 'continuous')
        self.assertIsNone(self.events[1][1]['shareLimit'])
        self.assertEqual(self.events[-1][1]['reason'], 'interrupted')

    def test_explicit_single_share_test_finishes_with_a_clear_reason(self):
        self.assertEqual(self.run_loop(shares=1, stop_after=None), 1)
        self.assertEqual(self.calls, ['work', 'shares'])
        self.assertEqual(self.events[-1][1]['reason'], 'share_limit_reached')

    def test_positive_limit_is_not_treated_as_continuous(self):
        self.assertEqual(self.run_loop(shares=2, stop_after=None), 2)
        self.assertEqual(self.calls, ['work', 'shares'] * 2)
        self.assertEqual(self.events[-1][1]['shareLimit'], 2)

    def test_stop_during_interval_does_not_request_or_submit_more_work(self):
        self.assertEqual(self.run_loop(stop_after=None, stop_during_wait=True), 1)
        self.assertEqual(self.calls, ['work', 'shares'])

    def test_ambiguous_post_is_not_retried_even_in_continuous_mode(self):
        with self.assertRaisesRegex(OSError, 'response lost'): self.run_loop(lost=True)
        self.assertEqual(self.calls, ['work', 'shares'])

    def test_job_assignment_does_not_claim_token_rewards(self):
        self.run_loop(shares=1, stop_after=None)
        assigned = [value for event, value in self.events if event == 'job_assigned']
        self.assertEqual(len(assigned), 1)
        self.assertIs(assigned[0]['rewardCreated'], False)

    def test_installer_default_is_continuous_with_explicit_bounded_test(self):
        cli = load('perla_continuous_cli', ROOT / 'scripts/perla-worker.py')
        self.assertEqual(cli.parser().parse_args(['start']).shares, 0)
        self.assertEqual(cli.parser().parse_args(['start', '--shares', '1']).shares, 1)

    def test_native_and_gpu_entrypoints_forward_the_default_and_reject_invalid_limits(self):
        native = load('perla_continuous_native', ROOT / 'services/rtx-worker/native_worker.py')
        with patch.object(native, 'locked', return_value=contextlib.nullcontext()), patch.object(native, 'run_worker') as run:
            with patch.object(sys, 'argv', ['native_worker.py', 'run']): native.main()
            self.assertEqual(run.call_args.args[0].shares, 0)
            for value in ['-1', '100001']:
                with patch.object(sys, 'argv', ['native_worker.py', 'run', '--shares', value]), contextlib.redirect_stderr(io.StringIO()):
                    with self.assertRaises(SystemExit): native.main()
        with patch.object(self.m, 'run_worker') as run, patch.object(self.m.signal, 'signal'):
            self.assertEqual(self.m.main(['run']), 0)
            self.assertEqual(run.call_args.args[0].shares, 0)
            for value in ['-1', '100001']:
                with contextlib.redirect_stderr(io.StringIO()):
                    with self.assertRaises(SystemExit): self.m.main(['run', '--shares', value])


if __name__ == '__main__': unittest.main()
