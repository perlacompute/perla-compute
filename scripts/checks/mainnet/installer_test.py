"""Offline release installation tests; no GPU or mining is simulated."""

import hashlib, io, json, os, subprocess, sys, tarfile, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.assets = self.base / "assets"
        subprocess.run(
            [
                sys.executable,
                str(ROOT / "scripts/mainnet/package-worker.py"),
                "--output",
                str(self.assets),
            ],
            check=True,
            capture_output=True,
        )
        self.home = self.base / "home"
        self.home.mkdir()

    def install(self):
        return subprocess.run(
            [
                sys.executable,
                str(self.assets / "install.py"),
                "--local",
                str(self.assets),
            ],
            env={**os.environ, "HOME": str(self.home)},
            capture_output=True,
            text=True,
        )

    def test_install_rerun_retains_private_identity_and_testnet(self):
        old = self.home / ".local/share/perla/current.json"
        old.parent.mkdir(parents=True)
        old.write_text("testnet preserved")
        self.assertEqual(self.install().returncode, 0)
        root = self.home / ".local/share/perla-mainnet"
        connection = root / "connection.json"
        connection.write_text('{"id":"existing-private-identity"}')
        connection.chmod(0o600)
        self.assertEqual(self.install().returncode, 0)
        self.assertEqual(connection.read_text(), '{"id":"existing-private-identity"}')
        self.assertEqual(old.read_text(), "testnet preserved")
        self.assertTrue((self.home / ".local/bin/perla-mainnet").stat().st_mode & 0o100)
        inventory = json.loads(
            (root / "core/versions/worker-v0.9.1-rtx/worker-inventory.json").read_text()
        )
        for name, digest in inventory.items():
            self.assertEqual(
                hashlib.sha256(
                    (root / "core/versions/worker-v0.9.1-rtx" / name).read_bytes()
                ).hexdigest(),
                digest,
            )

    def test_modified_installed_source_is_not_overwritten(self):
        self.assertEqual(self.install().returncode, 0)
        p = (
            self.home
            / ".local/share/perla-mainnet/versions/mainnet-worker-v1.2.0/mainnet.py"
        )
        p.write_text("local change")
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("other edits", result.stderr)
        self.assertEqual(p.read_text(), "local change")

    def test_corrupt_archive_is_rejected(self):
        p = self.assets / "perla-mainnet-worker.tar.gz"
        p.write_bytes(p.read_bytes() + b"changed")
        self.assertNotEqual(self.install().returncode, 0)
        self.assertFalse((self.home / ".local/bin/perla-mainnet").exists())

    def test_rewritten_release_is_rejected_even_with_consistent_checksums(self):
        p = self.assets / "perla-mainnet-worker.tar.gz"
        raw = io.BytesIO()
        with tarfile.open(fileobj=raw, mode="w:gz") as tar:
            member = tarfile.TarInfo("perla-mainnet-worker/../../escape")
            member.size = 1
            tar.addfile(member, io.BytesIO(b"x"))
        p.write_bytes(raw.getvalue())
        m = json.loads((self.assets / "mainnet-worker.json").read_text())
        m["sha256"] = hashlib.sha256(p.read_bytes()).hexdigest()
        (self.assets / "mainnet-worker.json").write_text(json.dumps(m))
        (self.assets / "SHA256SUMS").write_text(
            "".join(
                hashlib.sha256((self.assets / n).read_bytes()).hexdigest()
                + "  "
                + n
                + "\n"
                for n in [
                    "mainnet-worker.json",
                    "perla-mainnet-worker.tar.gz",
                    "install.py",
                    "install.sh",
                ]
            )
        )
        r = self.install()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("metadata checksum", r.stderr)
        self.assertFalse((self.base / "escape").exists())


if __name__ == "__main__":
    unittest.main()
