#!/usr/bin/env python3
"""Deterministic companion assets; existing worker-v0.9.1 assets are untouched."""
from pathlib import Path
import argparse, hashlib, json, tarfile, gzip, io

ROOT = Path(__file__).resolve().parents[2]
TAG = "mainnet-worker-v1.2.0"


def package(output, refresh=False):
    output.mkdir(parents=True, exist_ok=True)
    inventory = json.loads(
        (ROOT / "services/rtx-worker/worker-inventory.json").read_text()
    )
    files = {}
    for name, h in inventory.items():
        source = (
            ROOT / "LICENSE"
            if name == "PERLA-MIT-LICENSE.txt"
            else (
                ROOT / "services/pearl-adapter" / name
                if name == "perla_bridge.py"
                else ROOT / "services/rtx-worker" / name
            )
        )
        data = source.read_bytes()
        if hashlib.sha256(data).hexdigest() != h:
            raise ValueError("Pinned CUDA core source differs: " + name)
        files["core/" + name] = data
    for name in ["native_worker.py", "worker-inventory.json", "NOTICE.md"]:
        files["core/" + name] = (ROOT / "services/rtx-worker" / name).read_bytes()
    files["PERLA-MIT-LICENSE.txt"] = (ROOT / "LICENSE").read_bytes()
    files["core-inventory.json"] = (
        json.dumps(
            {
                Path(n).name: hashlib.sha256(d).hexdigest()
                for n, d in files.items()
                if n.startswith("core/")
            },
            sort_keys=True,
            indent=2,
        )
        + "\n"
    ).encode()
    for name in [
        "mainnet.py",
        "mainnet-entry.py",
        "inference-entry.py",
        "launch-plan.json",
    ]:
        files[name] = (ROOT / "services/compute-worker" / name).read_bytes()
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode="w") as tar:
        for name, raw in sorted(files.items()):
            item = tarfile.TarInfo("perla-mainnet-worker/" + name)
            item.size = len(raw)
            item.mode = 0o644
            item.mtime = 0
            tar.addfile(item, io.BytesIO(raw))
    compressed = io.BytesIO()
    with gzip.GzipFile(fileobj=compressed, mode="wb", filename="", mtime=0) as stream:
        stream.write(data.getvalue())
    archive = compressed.getvalue()
    name = "perla-mainnet-worker.tar.gz"
    (output / name).write_bytes(archive)
    plan = json.loads((ROOT / "services/compute-worker/launch-plan.json").read_text())
    metadata = {
        "tag": TAG,
        "archive": name,
        "sha256": hashlib.sha256(archive).hexdigest(),
        "upstreamCommit": "82e6eee7076aafe10123e08db78f100d270c0582",
        "policyHash": plan["hash"],
        "files": {n: hashlib.sha256(d).hexdigest() for n, d in files.items()},
    }
    (output / "mainnet-worker.json").write_text(json.dumps(metadata, indent=2) + "\n")
    installer = (
        (ROOT / "services/compute-worker/install.py")
        .read_text()
        .replace(
            "BUILD_REQUIRES_METADATA_PIN",
            hashlib.sha256((output / "mainnet-worker.json").read_bytes()).hexdigest(),
        )
    )
    (output / "install.py").write_text(installer)
    (output / "install.sh").write_text(
        "#!/usr/bin/env bash\nset -euo pipefail\npython3 - \"$@\" <<'PERLA_MAINNET_INSTALLER'\n"
        + installer
        + "\nPERLA_MAINNET_INSTALLER\n"
    )
    (output / "SHA256SUMS").write_text(
        "".join(
            hashlib.sha256((output / n).read_bytes()).hexdigest() + "  " + n + "\n"
            for n in ["mainnet-worker.json", name, "install.py", "install.sh"]
        )
    )
    record = (
        json.dumps(
            {
                "tag": TAG,
                "policyHash": plan["hash"],
                "assets": {
                    n: hashlib.sha256((output / n).read_bytes()).hexdigest()
                    for n in [
                        "mainnet-worker.json",
                        name,
                        "install.py",
                        "install.sh",
                        "SHA256SUMS",
                    ]
                },
            },
            indent=2,
        )
        + "\n"
    )
    pin = ROOT / "services/compute-worker/release-manifest.json"
    if refresh:
        pin.write_text(record)
    elif not pin.is_file() or pin.read_text() != record:
        raise ValueError(
            "Rebuilt worker assets differ from the reviewed manifest. No source pin was overwritten"
        )
    print(
        json.dumps(
            {
                "tag": TAG,
                "policyHash": metadata["policyHash"],
                "files": 5,
                "miningStarted": False,
            }
        )
    )


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--output", required=True, type=Path)
    p.add_argument("--refresh-manifest", action="store_true")
    args = p.parse_args()
    package(args.output, args.refresh_manifest)
