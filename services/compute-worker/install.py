#!/usr/bin/env python3
"""Install the checksum-verified Perla mainnet companion without wallet keys."""
import argparse, hashlib, io, json, os, secrets, shutil, subprocess, sys, tarfile, urllib.request, urllib.parse
from pathlib import Path

TAG = "mainnet-worker-v1.2.0"
EXPECTED_METADATA_SHA256 = "BUILD_REQUIRES_METADATA_PIN"
BASE = "https://github.com/perlacompute/perla-compute/releases/download/" + TAG + "/"
ROOT = Path.home() / ".local/share/perla-mainnet"


def regular(p):
    if any(x.is_symlink() for x in [p, *p.parents]) or not p.is_file():
        raise ValueError("Use regular installation files without symlinks")
    return p.read_bytes()


def atomic(p, data, mode=0o600):
    if any(x.is_symlink() for x in [p, *p.parents]):
        raise ValueError("Unsafe installation path")
    p.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = p.with_name(p.name + "." + secrets.token_hex(4))
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    os.replace(tmp, p)


def fetch(name, folder, max_size):
    if folder:
        data = regular(folder / name)
    else:
        with urllib.request.urlopen(BASE + name, timeout=45) as r:
            if urllib.parse.urlparse(r.geturl()).scheme != "https":
                raise ValueError("Download requires HTTPS")
            data = r.read(max_size + 1)
    if len(data) > max_size:
        raise ValueError("Release asset exceeds its size limit")
    return data


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--local", type=Path)
    a = p.parse_args()
    sums = fetch("SHA256SUMS", a.local, 100000).decode()
    expected = {
        line.split()[1]: line.split()[0]
        for line in sums.splitlines()
        if len(line.split()) == 2
    }
    raw = fetch("mainnet-worker.json", a.local, 1000000)
    if (
        hashlib.sha256(raw).hexdigest() != expected.get("mainnet-worker.json")
        or hashlib.sha256(raw).hexdigest() != EXPECTED_METADATA_SHA256
    ):
        raise ValueError("Release metadata checksum differs")
    metadata = json.loads(raw)
    if (
        metadata.get("tag") != TAG
        or metadata.get("archive") != "perla-mainnet-worker.tar.gz"
    ):
        raise ValueError("Unexpected mainnet release")
    archive = fetch(metadata["archive"], a.local, 64000000)
    if hashlib.sha256(archive).hexdigest() != expected.get(
        metadata["archive"]
    ) or expected[metadata["archive"]] != metadata.get("sha256"):
        raise ValueError("Mainnet worker archive checksum differs")
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    stage = ROOT / ("install-" + secrets.token_hex(6))
    stage.mkdir(mode=0o700)
    try:
        seen = set()
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
            for item in tar:
                parts = Path(item.name).parts
                if (
                    not item.isfile()
                    or not parts
                    or parts[0] != "perla-mainnet-worker"
                    or ".." in parts
                    or Path(item.name).is_absolute()
                ):
                    raise ValueError("Unsafe worker archive entry")
                relative = Path(*parts[1:])
                name = relative.as_posix()
                if name in seen or name not in metadata["files"] or item.size > 5000000:
                    raise ValueError("Unexpected or duplicate worker file")
                seen.add(name)
                data = tar.extractfile(item).read()
                if hashlib.sha256(data).hexdigest() != metadata["files"][name]:
                    raise ValueError("Worker file checksum differs")
                atomic(stage / relative, data, 0o644)
        if seen != set(metadata["files"]):
            raise ValueError("Worker archive is incomplete")
        destination = ROOT / "versions" / TAG
        destination.parent.mkdir(mode=0o700, exist_ok=True)
        if destination.exists():
            for name, h in metadata["files"].items():
                if hashlib.sha256(regular(destination / name)).hexdigest() != h:
                    raise ValueError("Existing mainnet installation has other edits")
            shutil.rmtree(stage)
        else:
            os.replace(stage, destination)
        core = ROOT / "core/versions/worker-v0.9.1-rtx"
        core.mkdir(parents=True, exist_ok=True, mode=0o700)
        for name, h in json.loads(regular(destination / "core-inventory.json")).items():
            data = regular(destination / "core" / name)
            target = core / name
            if target.exists() and hashlib.sha256(regular(target)).hexdigest() != h:
                raise ValueError("Existing private core installation differs")
            atomic(target, data, 0o644)
        inventory = json.loads(regular(core / "worker-inventory.json"))
        current = {
            "schema": 1,
            "repository": "perlacompute/perla-compute",
            "release": "worker-v0.9.1",
            "profile": "rtx",
            "directory": str(core),
            "upstreamCommit": metadata["upstreamCommit"],
            "inventory": inventory,
        }
        atomic(ROOT / "core/current.json", (json.dumps(current) + "\n").encode())
        launcher = Path.home() / ".local/bin/perla-mainnet"
        code = (
            "#!/usr/bin/env python3\nimport os,sys\nos.execv(sys.executable,[sys.executable,"
            + repr(str(destination / "mainnet.py"))
            + ",*sys.argv[1:]])\n"
        )
        atomic(launcher, code.encode(), 0o700)
        print("Installed and verified " + TAG + ". No mining process was started.")
        print("Command: " + str(launcher))
        print(
            "Next: perla-mainnet start --wallet YOUR_PUBLIC_ADDRESS --worker rig01 --device 0"
        )
    finally:
        if stage.exists():
            shutil.rmtree(stage)


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main()
    except Exception as e:
        print("Mainnet installation stopped: " + str(e), file=sys.stderr)
        raise SystemExit(1)
