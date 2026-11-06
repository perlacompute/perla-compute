#!/usr/bin/env python3
"""VPS operator: isolated preparation, encrypted signer and explicit activation."""
from types import SimpleNamespace
import argparse, getpass, hashlib, json, os, secrets, shutil, subprocess, sys, time
from pathlib import Path
from compose_runtime import command as compose_command, validate as validate_compose, activate as activate_compose

ROOT = Path("/etc/perla-mainnet")


def run(args, **kw):
    return subprocess.run([str(x) for x in args], check=True, **kw)


def load():
    return json.loads((ROOT / "deployment.json").read_text())


def atomic(p, text, mode=0o600, owner=None):
    if p.is_symlink():
        raise ValueError("Refusing a symlink path")
    temp = p.with_name(p.name + ".pending")
    temp.write_text(text)
    temp.chmod(mode)
    if owner is not None:
        os.chown(temp, *owner)
    os.replace(temp, p)


def verifier(state):
    from launch_runtime import ensure_verifier
    return ensure_verifier(SimpleNamespace(**globals()), state)


def remember_smoke_model(model):
    import re
    if not isinstance(model, str) or not re.fullmatch(r"perla/[a-z0-9][a-z0-9-]{0,99}", model):
        raise ValueError("Choose a valid Perla catalog model for the provider check")
    path = ROOT / "config/config.json"
    attributes = path.stat()
    config = json.loads(path.read_text())
    config["providerSmokeModel"] = model
    atomic(path, json.dumps(config, indent=2) + "\n", attributes.st_mode & 0o777, (attributes.st_uid, attributes.st_gid))


def operator(state, args, key=None):
    if args and args[0] in ("smoke", "activate") and "--model" not in args:
        model = json.loads((ROOT / "config/config.json").read_text()).get("providerSmokeModel")
        if model:
            import re
            if not isinstance(model, str) or not re.fullmatch(r"perla/[a-z0-9][a-z0-9-]{0,99}", model):
                raise ValueError("Choose a valid Perla catalog model for the provider check")
            args = [*args, "--model", model]
    cmd = [
        "docker",
        "run",
        "--rm",
        "--init",
        "-i",
        "--network",
        state["network"],
        "--env-file",
        ROOT / "runtime.env",
        "--mount",
        "type=volume,source=" + state["volume"] + ",target=/app/data",
        "--mount",
        "type=bind,source=" + str(ROOT / "config") + ",target=/app/mainnet",
        "--entrypoint",
        "node",
        state["image"],
        "scripts/mainnet/operator.bundle.mjs",
        *args,
    ]
    return run(cmd, input=key)


def signer():
    credential = os.environ.get("CREDENTIALS_DIRECTORY")
    if credential:
        return (Path(credential) / "perla-mainnet-signer").read_bytes()
    return run(
        [
            "systemd-creds",
            "decrypt",
            "--name=perla-mainnet-signer",
            ROOT / "signer.cred",
            "-",
        ],
        capture_output=True,
    ).stdout


def configure(state):
    if state.get("activated"):
        raise ValueError(
            "This generation is active; use quote or operator commands for reviewed changes"
        )
    file = ROOT / "runtime.env"
    lines = file.read_text().splitlines()
    existing = next((x.split("=", 1)[1] for x in lines if x.startswith("PERLA_AI_PROVIDER_KEY=")), "")
    if not existing:
        key = getpass.getpass("AI supplier API key (hidden; stored only in private VPS config): ").strip()
        if not key or any(c in key for c in "\n\r\0"):
            raise ValueError("Provide a non-empty single-line API key")
        atomic(file, "\n".join("PERLA_AI_PROVIDER_KEY=" + key if x.startswith("PERLA_AI_PROVIDER_KEY=") else x for x in lines) + "\n")
        key = ""
    if not (ROOT / "signer.cred").exists():
        private = getpass.getpass("Dedicated MAINNET owner private key (hidden; encrypted by systemd): ").strip()
        import re
        if not re.fullmatch(r"0x[0-9a-fA-F]{64}", private):
            raise ValueError("Expected a dedicated 0x mainnet private key")
        p = ROOT / "signer.cred.pending"
        run(["systemd-creds", "encrypt", "--name=perla-mainnet-signer", "-", p], input=(private + "\n").encode())
        private = ""
        p.chmod(0o600)
        os.replace(p, ROOT / "signer.cred")
    verifier(state)
    operator(state, ["models"])
    operator(state, ["smoke"])
    print(
        "Supplier completion checked. Signer encrypted. No mainnet chain transaction was sent."
    )


def install_units():
    atomic(
        Path("/etc/systemd/system/perla-mainnet-settle.service"),
        "[Unit]\nDescription=Perla mainnet earned epoch settlement\nAfter=docker.service network-online.target\nRequires=docker.service\n[Service]\nType=oneshot\nLoadCredentialEncrypted=perla-mainnet-signer:/etc/perla-mainnet/signer.cred\nExecStart=/usr/local/bin/perla-mainnet-admin automatic\nTimeoutStartSec=900\nUMask=0077\n",
        0o644,
    )
    atomic(
        Path("/etc/systemd/system/perla-mainnet-settle.timer"),
        "[Unit]\nDescription=Perla mainnet settlement and catalog refresh\n[Timer]\nOnBootSec=90\nOnUnitInactiveSec=60\nPersistent=true\n[Install]\nWantedBy=timers.target\n",
        0o644,
    )
    run(["systemctl", "daemon-reload"])
    run(["systemctl", "enable", "--now", "perla-mainnet-settle.timer"])


def compose(state, *args):
    project = Path(state["project"])
    run(compose_command(project, state["composeSnapshot"], ROOT / "compose.override.json") + list(args), cwd=project)


def switch(state):
    validate_compose(state, ROOT)
    # Refuse to overwrite independent changes made since preparation.
    stage = Path(state["source"])
    project = Path(state["project"])
    backup = project / ".perla-backups" / ("mainnet-" + str(int(time.time())))
    for name, before in state["baselineFiles"].items():
        p = project / name
        now = hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None
        new = hashlib.sha256((stage / name).read_bytes()).hexdigest()
        if now not in (before, new):
            raise ValueError("Application source changed since preparation: " + name)
    for name in state["baselineFiles"]:
        p = project / name
        if p.exists():
            q = backup / name
            q.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, q)
        p.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(stage / name, p)
    run(["docker", "tag", state["image"], state["productionImage"]])
    activate_compose(state, ROOT)
    compose(state, "up", "-d", "--no-build", "web")
    for _ in range(30):
        r = subprocess.run(
            [
                "docker",
                "exec",
                "perla-compute-web-1",
                "node",
                "-e",
                "fetch('http://127.0.0.1:3000/api/compute/status').then(async r=>{const d=await r.json();if(!r.ok||!d.active||d.chainId!==4663||!d.features.mining)process.exit(1)}).catch(()=>process.exit(1))",
            ],
            capture_output=True,
        )
        if r.returncode == 0:
            break
        time.sleep(2)
    else:
        raise ValueError(
            "New web readiness is pending. Preserve the activation journal and rerun switch; never redeploy the vaults"
        )
    state["activated"] = True
    state["sourceBackup"] = str(backup)
    atomic(ROOT / "deployment.json", json.dumps(state, indent=2) + "\n")
    install_units()
    print(
        "Mainnet web and settlement enabled. Existing testnet records and services retained."
    )


def main():
    if os.geteuid() != 0:
        raise ValueError("Run on the application VPS as root")
    args = sys.argv[1:]
    command = args.pop(0) if args else "help"
    state = load()
    import fcntl

    with open(ROOT / "operator.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if command == "finish":
            from launch_runtime import finish
            finish(SimpleNamespace(**globals()), state, args)
        elif command == "configure":
            configure(state)
        elif command == "plan":
            verifier(state)
            operator(
                state, ["plan", *args, "--out", "/app/mainnet/activation-plan.json"]
            )
        elif command == "activate":
            if "--execute" not in args:
                raise ValueError("Inspect the saved plan, then use activate --execute")
            validate_compose(state, ROOT)
            verifier(state)
            operator(
                state,
                [
                    "activate",
                    "--plan",
                    "/app/mainnet/activation-plan.json",
                    "--execute",
                    "--stdin-key",
                ],
                signer(),
            )
            switch(state)
        elif command == "switch":
            switch(state)
        elif command == "automatic":
            if not state.get("activated"):
                raise ValueError(
                    "Automatic settlement stays off until explicit activation"
                )
            stamp = ROOT / "models.last"
            if not stamp.exists() or time.time() - stamp.stat().st_mtime > 600:
                operator(state, ["models"])
                atomic(stamp, str(int(time.time())))
            operator(state, ["maintenance"])
            operator(state, ["settle", "--execute", "--stdin-key"], signer())
        elif command in ["fund", "migration", "quote", "settle"]:
            if "--execute" not in args:
                raise ValueError(
                    "This command signs mainnet transactions; add --execute after reviewing its values"
                )
            operator(state, [command, *args, "--stdin-key"], signer())
        elif command in [
            "doctor",
            "release",
            "models",
            "smoke",
            "migration-plan",
            "gpu-model",
            "gpu-approve",
            "gpu-calibrate",
            "gpu-open",
            "maintenance",
        ]:
            if command == "gpu-model" and "--file" in args:
                i = args.index("--file") + 1
                src = Path(args[i]).resolve()
                dst = ROOT / "config/gpu-model.json"
                atomic(dst, src.read_text())
                os.chown(dst, 1000, 1000)
                args[i] = "/app/mainnet/gpu-model.json"
            operator(state, [command, *args])
            if command == "smoke" and "--model" in args:
                remember_smoke_model(args[args.index("--model") + 1])
        else:
            print(
                "Commands: fund --pool mining|migration --amount N --request-id ID --execute, finish --execute, configure, plan --owner 0x... --token 0x..., activate --execute, doctor, quote --rate-micros N --execute, migration --execute, release, gpu-model, gpu-approve, gpu-calibrate, gpu-open. Preparation sends no chain transactions."
            )


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main()
    except (ValueError, subprocess.CalledProcessError, BlockingIOError) as e:
        print(
            "Perla mainnet stopped: "
            + str(e)
            + ". Existing state and transaction journals are retained.",
            file=sys.stderr,
        )
        sys.exit(1)
