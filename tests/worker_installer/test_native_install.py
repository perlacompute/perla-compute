"""Real packaged installations exercise the native gate before any GPU execution."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


w = module('native_install_controller', ROOT / 'scripts/perla-worker.py')


class NativeInstallationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.assets_tmp = tempfile.TemporaryDirectory()
        folder = Path(cls.assets_tmp.name)
        subprocess.run(['python3', str(ROOT / 'scripts/package-worker-release.py'),
                        '--output', str(folder), '--tag', 'worker-v0.8.1'],
                       capture_output=True, check=True)
        cls.assets = {p.name: p.read_bytes() for p in folder.iterdir()}
        cls.code = (ROOT / 'scripts/perla-worker.py').read_bytes()

    @classmethod
    def tearDownClass(cls):
        cls.assets_tmp.cleanup()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.root = self.home / 'perla'
        self.root.mkdir()
        self.bin = self.home / 'bin'
        self.bin.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def install(self, release='worker-v0.8.1'):
        bodies = dict(self.assets)
        manifest = json.loads(bodies['worker-release.json'])
        manifest.update(tag=release, version=release.removeprefix('worker-v'))
        bodies['worker-release.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
        hash_ = lambda data: hashlib.sha256(data).hexdigest()
        bodies['SHA256SUMS'] = ''.join(hash_(data) + '  ' + name + '\n'
                                      for name, data in bodies.items()
                                      if name != 'SHA256SUMS').encode()
        base = 'https://github.com/' + w.REPO + '/releases/download/' + release + '/'
        metadata = {'tag_name': release, 'draft': False, 'assets': [
            {'name': name, 'browser_download_url': base + name,
             'digest': 'sha256:' + hash_(data)} for name, data in bodies.items()]}

        def fetch(url, limit):
            if url == 'https://api.github.com/repos/' + w.REPO + '/releases/tags/' + release:
                return json.dumps(metadata).encode()
            self.assertTrue(url.startswith(base), url)
            return bodies[url.removeprefix(base)]

        with contextlib.redirect_stdout(io.StringIO()):
            installed = w.install(self.root, self.bin, release, 'rtx', fetch=fetch,
                                  source=self.code)
        native = module('installed_native', Path(installed['directory']) / 'native_worker.py')
        return installed, native

    def test_verified_081_archive_passes_real_native_source_gate(self):
        installed, native = self.install()
        self.assertEqual(w.state(self.root)['release'], 'worker-v0.8.1')
        self.assertEqual(native.installed_source(self.root), Path(installed['directory']))

    def test_080_compatible_core_is_accepted_by_the_fixed_native_launcher(self):
        installed, native = self.install('worker-v0.8.0')
        self.assertEqual(native.installed_source(self.root), Path(installed['directory']))

    def test_upgrade_preserves_completed_reconnect_and_private_credential(self):
        self.install('worker-v0.8.0')
        config = self.root / 'config'
        config.mkdir(mode=0o700)
        token = b'PERLA_ENDPOINT=https://perlacompute.xyz\nPERLA_WORKER_TOKEN=' + b'e' * 64 + b'\n'
        identity = b'{"id":"9eb1fc70-8a86-449d-a671-dfa3ca0aee8d","name":"fixture"}\n'
        w.atomic(config / 'worker.env', token)
        w.atomic(config / 'connection.json', identity)
        installed, native = self.install()
        self.assertEqual((config / 'worker.env').read_bytes(), token)
        self.assertEqual((config / 'connection.json').read_bytes(), identity)
        self.assertEqual((config / 'worker.env').stat().st_mode & 0o077, 0)
        self.assertEqual(native.installed_source(self.root), Path(installed['directory']))

    def test_altered_core_file_is_rejected_even_if_install_inventory_is_rewritten(self):
        installed, native = self.install()
        name = 'protocol.py'
        p = Path(installed['directory']) / name
        p.write_bytes(p.read_bytes() + b'\n# changed core\n')
        with self.assertRaisesRegex(native.NativeError, 'source changed'):
            native.installed_source(self.root)
        installed['inventory'][name] = hashlib.sha256(p.read_bytes()).hexdigest()
        w.atomic(self.root / 'current.json', json.dumps(installed).encode())
        with self.assertRaisesRegex(native.NativeError, 'inventory differs'):
            native.installed_source(self.root)

    def test_wrong_repository_profile_commit_and_future_release_are_rejected(self):
        installed, native = self.install()
        for key, value in [('repository', 'attacker/project'), ('profile', 'hopper'),
                           ('upstreamCommit', '0' * 40), ('release', 'worker-v0.9.0')]:
            with self.subTest(key=key):
                changed = {**installed, key: value}
                w.atomic(self.root / 'current.json', json.dumps(changed).encode())
                with self.assertRaises(native.NativeError):
                    native.installed_source(self.root)

    def test_unchanged_verified_native_cache_is_reused_after_upgrade(self):
        installed, native = self.install()
        runtime = self.home / 'perla-native'
        folder = runtime / 'builds' / 'rtx-fixture'
        worker = folder / 'worker'
        worker.mkdir(parents=True)
        for name in native.inventory():
            shutil.copy2(Path(installed['directory']) / name, worker / name)
        (worker / 'libperla_rtx.so').write_bytes(b'fixture-only-not-a-GPU-binary')
        (folder / 'venv/bin').mkdir(parents=True)
        (folder / 'venv/bin/python').write_bytes(b'fixture-not-executed')
        record = {'directory': str(folder), 'launcherVersion': native.VERSION,
                  'release': native.RELEASE, 'upstreamCommit': native.UPSTREAM,
                  'arch': '89', 'nvccVersion': 'fixture-cuda',
                  'cudaSha256': native.sha((worker / 'libperla_rtx.so').read_bytes())}
        native.atomic_json(runtime / 'current.json', record)
        before = (runtime / 'current.json').read_bytes()
        args = types.SimpleNamespace(root=self.root, native_root=runtime, device=0,
                                     python=None, nvcc=None)
        out = io.StringIO()
        with patch.object(native, 'toolchain', return_value={
            'gpu': {'arch': '89'}, 'nvccVersion': 'fixture-cuda'
        }), patch.object(native, 'build_step') as build, contextlib.redirect_stdout(out):
            native.build(args)
            build.assert_not_called()
        self.assertIn('Reusing the verified native build', out.getvalue())
        self.assertEqual((runtime / 'current.json').read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
