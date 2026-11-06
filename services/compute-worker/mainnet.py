#!/usr/bin/env python3
"""Mainnet companion: private persistent identity, native build reuse and reconnect."""
import argparse, hashlib, importlib.util, json, os, secrets, subprocess, sys, time, urllib.request, urllib.error, urllib.parse
from pathlib import Path

KIT = Path(__file__).resolve().parent
ROOT = Path.home() / ".local/share/perla-mainnet"
CACHE = Path.home() / ".local/share/perla-native"
ORIGIN = "https://perlacompute.xyz"


def regular(p):
    p = Path(p)
    if any(x.is_symlink() for x in [p, *p.parents]) or not p.is_file():
        raise ValueError("Use regular files without symlinks")
    return p.read_bytes()


def save(p, data):
    p.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if any(x.is_symlink() for x in [p, *p.parents]):
        raise ValueError("Unsafe configuration path")
    tmp = p.with_suffix(".pending-" + secrets.token_hex(4))
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f)
    os.replace(tmp, p)


def load(p):
    if p.stat().st_mode & 0o077:
        raise ValueError("Worker connection must be mode 0600")
    return json.loads(regular(p))


class CoordinatorFailure(ValueError):
    def __init__(self, message, status, code=None):
        super().__init__(message)
        self.status = status
        self.code = code


def call(origin, path, payload=None, token=None):
    u = urllib.parse.urlsplit(origin)
    if (
        u.scheme != "https"
        or u.username
        or u.password
        or u.path.rstrip("/")
        or u.query
        or u.fragment
    ):
        raise ValueError("Use an HTTPS coordinator origin")
    headers = {"content-type": "application/json"}
    if token:
        headers["authorization"] = "Bearer " + token
    request = urllib.request.Request(
        origin + "/api/compute/" + path,
        data=None if payload is None else json.dumps(payload).encode(),
        headers=headers,
    )

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *_):
            return None

    try:
        with urllib.request.build_opener(NoRedirect()).open(
            request, timeout=40
        ) as response:
            return json.loads(response.read(8 * 1024 * 1024))
    except urllib.error.HTTPError as e:
        try:
            d = json.loads(e.read(8192))
            error = d.get("error", {})
            message = (
                error.get("message", "Coordinator rejected request")
                if isinstance(error, dict)
                else str(error)
            )
        except Exception:
            message = "Coordinator unavailable"
            error = {}
        raise CoordinatorFailure(
            message, e.code, error.get("code") if isinstance(error, dict) else None
        ) from None


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("command", choices=["start", "doctor", "reconnect", "inference"])
    p.add_argument("--wallet")
    p.add_argument("--worker")
    p.add_argument("--worker-id")
    p.add_argument("--device", type=int, default=0)
    p.add_argument("--shares", type=int, default=0)
    p.add_argument("--endpoint", default=ORIGIN)
    p.add_argument("--new-worker", action="store_true")
    p.add_argument("--models")
    p.add_argument("--revision")
    p.add_argument("--backend", default="http://127.0.0.1:8000/v1")
    a = p.parse_args()
    if not 0 <= a.device < 64 or not 0 <= a.shares <= 100000:
        raise ValueError("Use device 0..63; 0 means the first visible GPU")
    inventory = json.loads(regular(KIT / "core-inventory.json"))
    core = ROOT / "core/versions/worker-v0.9.1-rtx"
    for name, h in inventory.items():
        if (
            Path(name).name != name
            or hashlib.sha256(regular(core / name)).hexdigest() != h
        ):
            raise ValueError("Pinned core source differs: " + name)
    spec = importlib.util.spec_from_file_location(
        "perla_native_core", core / "native_worker.py"
    )
    native = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(native)
    path = ROOT / "connection.json"
    pending = ROOT / "connection-pending.json"
    if a.command == "reconnect":
        if not a.worker_id:
            raise ValueError("Provide the saved permanent --worker-id")
        state = (
            load(pending)
            if pending.exists()
            else {
                "workerId": a.worker_id,
                "token": secrets.token_hex(32),
                "code": secrets.token_hex(6).upper(),
                "origin": a.endpoint,
            }
        )
        if state.get("workerId") != a.worker_id or state.get("origin") != a.endpoint:
            raise ValueError(
                "Another reconnect is pending; its private credential was retained"
            )
        if not state.get("id"):
            save(pending, state)
            result = call(
                a.endpoint,
                "mining/reconnect/start",
                {"workerId": a.worker_id, "code": state["code"]},
                state["token"],
            )
            state.update(result)
            save(pending, state)
        print(
            "Authorize: "
            + a.endpoint
            + "/platform/network?tab=mining&reconnect="
            + state["id"]
        )
        print("Confirmation code: " + state["code"], flush=True)
        while True:
            result = call(
                a.endpoint,
                "mining/reconnect/exchange",
                {"id": state["id"]},
                state["token"],
            )
            if not result.get("pending"):
                break
            time.sleep(3)
        if result.get("id") != a.worker_id:
            raise ValueError("Reconnect identity differs")
        save(
            path,
            {
                "origin": a.endpoint,
                "token": state["token"],
                **{k: result[k] for k in ["id", "address", "name", "kind"]},
            },
        )
        pending.unlink()
        print(
            "Worker ID retained. Old machine credential disabled. Start this worker to run its GPU checks."
        )
        return
    gpu = native.selected_gpu(a.device)
    if a.command == "doctor":
        print(
            json.dumps(
                {
                    **native.toolchain(a.device, None, None),
                    "mainnetProtocol": "perla-mainnet-plain-v1",
                    "coordinatorContacted": False,
                    "physicalGpuSelfTest": False,
                },
                indent=2,
            )
        )
        return
    try:
        state, folder, python = native.read_build(CACHE)
    except Exception:
        subprocess.run(
            [
                sys.executable,
                str(core / "native_worker.py"),
                "--root",
                str(ROOT / "core"),
                "--native-root",
                str(CACHE),
                "build",
                "--device",
                str(a.device),
            ],
            check=True,
        )
        state, folder, python = native.read_build(CACHE)
    if state["arch"] != gpu["arch"]:
        raise ValueError("Rebuild the native runtime for this GPU architecture")
    if path.exists() and not a.new_worker:
        connection = load(path)
        if (
            (a.wallet and a.wallet.lower() != connection["address"])
            or (a.worker and a.worker != connection["name"])
            or connection["origin"] != a.endpoint
        ):
            raise ValueError(
                "Saved Worker ID retained. Use reconnect to move it or --new-worker for a deliberate new identity"
            )
    else:
        if not a.wallet or not a.worker:
            raise ValueError(
                "First connection needs --wallet PUBLIC_ADDRESS --worker rig01"
            )
        state = (
            load(pending)
            if pending.exists()
            else {
                "address": a.wallet.lower(),
                "name": a.worker,
                "token": secrets.token_hex(32),
                "origin": a.endpoint,
            }
        )
        if state.get("address") != a.wallet.lower() or state.get("name") != a.worker:
            raise ValueError("A different connection is pending; it was retained")
        save(pending, state)
        result = call(
            a.endpoint,
            "mining/connect",
            {
                "address": state["address"],
                "name": state["name"],
                "kind": "inference" if a.command == "inference" else "mining",
            },
            state["token"],
        )
        connection = {**state, **result}
        save(path, connection)
        pending.unlink()
    current = call(a.endpoint, "mining/status", token=connection["token"])
    if (
        current.get("id") != connection["id"]
        or current.get("address") != connection["address"]
    ):
        raise ValueError("Saved worker identity differs from coordinator")
    status = call(a.endpoint, "status")
    if status.get("chainId") != 4663 or not status.get("rewardVault"):
        raise ValueError(
            "Mainnet contracts are not configured yet; your Worker ID is retained"
        )
    print("Permanent Worker ID: " + connection["id"], flush=True)
    env = native.runtime_env()
    env.update(
        PERLA_ENDPOINT=a.endpoint,
        PERLA_WORKER_TOKEN=connection["token"],
        PERLA_MAINNET_WORKER_ID=connection["id"],
        PERLA_MAINNET_REWARD_WALLET=connection["address"],
        PERLA_MAINNET_REWARD_VAULT=status["rewardVault"].lower(),
    )
    if a.command == "inference":
        if not a.models or not a.revision:
            raise ValueError(
                "Inference needs --models gpu/model and --revision MODEL_COMMIT"
            )
        if connection.get("kind") != "inference":
            raise ValueError("Use a separate inference identity with --new-worker")
        subprocess.run(
            [
                str(python),
                "-E",
                "-s",
                str(KIT / "inference-entry.py"),
                "--core",
                str(folder / "worker"),
                "--device",
                str(a.device),
                "--models",
                a.models,
                "--revision",
                a.revision,
                "--backend",
                a.backend,
            ],
            env=env,
            check=True,
        )
        return
    subprocess.run(
        [
            str(python),
            "-E",
            "-s",
            str(KIT / "mainnet-entry.py"),
            "--core",
            str(folder / "worker"),
            "--device",
            str(a.device),
            "--shares",
            str(a.shares),
        ],
        env=env,
        check=True,
    )


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main()
    except KeyboardInterrupt:
        print("Perla mainnet operation stopped. Saved identity retained.")
        raise SystemExit(130)
    except Exception as e:
        print("Perla mainnet: " + str(e)[:400], file=sys.stderr)
        raise SystemExit(1)
