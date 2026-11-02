"""Compiled artifacts survive only the reviewed mining-loop change."""
import contextlib
import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


class CacheRefreshTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('refresh_native', ROOT / 'services/rtx-worker/native_worker.py')
        self.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.m)
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / 'native'
        self.folder = self.root / 'builds/verified'
        self.worker = self.folder / 'worker'
        self.worker.mkdir(parents=True)
        self.source = Path(self.tmp.name) / 'source'
        self.source.mkdir()
        for name in self.m.inventory():
            path = (ROOT / 'services/pearl-adapter/perla_bridge.py' if name == 'perla_bridge.py'
                    else ROOT / 'LICENSE' if name == 'PERLA-MIT-LICENSE.txt'
                    else ROOT / 'services/rtx-worker' / name)
            (self.worker / name).write_bytes(path.read_bytes())
        (self.source / 'miner.py').write_bytes((self.worker / 'miner.py').read_bytes())
        self.previous = b'reviewed legacy loop fixture; never executed'
        (self.worker / 'miner.py').write_bytes(self.previous)
        (self.worker / 'libperla_rtx.so').write_bytes(b'compiled binary fixture; never executed')
        (self.folder / 'venv/bin').mkdir(parents=True)
        (self.folder / 'venv/bin/python').write_bytes(b'python fixture; never executed')
        record = {'directory': str(self.folder), 'release': self.m.RELEASE,
                  'upstreamCommit': self.m.UPSTREAM, 'launcherVersion': self.m.VERSION,
                  'arch': '89', 'nvccVersion': 'fixture',
                  'cudaSha256': self.m.sha((self.worker / 'libperla_rtx.so').read_bytes())}
        self.m.atomic_json(self.root / 'current.json', record)
        self.tools = {'gpu': {'arch': '89'}, 'nvccVersion': 'fixture'}
        self.hash_patch = patch.object(self.m, 'COMPATIBLE_MINER_HASH', hashlib.sha256(self.previous).hexdigest())
        self.hash_patch.start()

    def tearDown(self):
        self.hash_patch.stop()
        self.tmp.cleanup()

    def refresh(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return self.m.refresh_compatible_build(self.root, self.source, self.tools)

    def test_reviewed_loop_refresh_retains_compiled_artifacts_and_state(self):
        before = (self.root / 'current.json').read_bytes()
        binary = (self.worker / 'libperla_rtx.so').read_bytes()
        self.assertTrue(self.refresh())
        self.assertEqual((self.worker / 'miner.py').read_bytes(), (self.source / 'miner.py').read_bytes())
        self.assertEqual((self.worker / 'libperla_rtx.so').read_bytes(), binary)
        self.assertEqual((self.root / 'current.json').read_bytes(), before)
        self.m.read_build(self.root)
        self.assertFalse(self.refresh())

    def test_unknown_previous_loop_is_preserved(self):
        changed = b'unknown local edits'
        (self.worker / 'miner.py').write_bytes(changed)
        self.assertFalse(self.refresh())
        self.assertEqual((self.worker / 'miner.py').read_bytes(), changed)

    def test_other_changed_core_or_cuda_binary_cannot_be_reused(self):
        for name in ['protocol.py', 'libperla_rtx.so']:
            with self.subTest(name=name):
                path = self.worker / name
                before = path.read_bytes()
                path.write_bytes(before + b'changed')
                self.assertFalse(self.refresh())
                self.assertEqual((self.worker / 'miner.py').read_bytes(), self.previous)
                path.write_bytes(before)

    def test_other_gpu_architecture_or_unreviewed_new_loop_is_rejected(self):
        self.tools['gpu']['arch'] = '120'
        self.assertFalse(self.refresh())
        self.tools['gpu']['arch'] = '89'
        (self.source / 'miner.py').write_bytes(b'unreviewed replacement')
        self.assertFalse(self.refresh())
        self.assertEqual((self.worker / 'miner.py').read_bytes(), self.previous)


if __name__ == '__main__': unittest.main()
