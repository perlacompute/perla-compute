"""Preserve the existing Compose stack; enable its mainnet layer only at activation."""
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

MANAGED = {"COMPOSE_FILE", "COMPOSE_PROJECT_NAME", "COMPOSE_PATH_SEPARATOR"}
MAINNET_KEYS = {"PERLA_COMPUTE_CONFIG", "PERLA_COMPUTE_SQLITE_PATH", "PERLA_MAINNET_VERIFIER_URL", "PERLA_MAINNET_VERIFIER_TOKEN", "PERLA_COMPUTE_STORAGE_KEY", "PERLA_COMPUTE_OPERATOR_TOKEN", "PERLA_AI_PROVIDER_KEY"}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def atomic(path, data):
    if path.is_symlink():
        raise ValueError("Refusing a Compose configuration symlink")
    tmp = path.with_name(path.name + ".pending")
    with open(tmp, "wb") as out:
        os.fchmod(out.fileno(), 0o600)
        out.write(data)
    os.replace(tmp, path)


def command(project, snapshot, overlay=None):
    args = ["docker", "compose", "--project-directory", str(project)]
    if snapshot.get("projectName"):
        args += ["--project-name", snapshot["projectName"]]
    for path in snapshot["files"]:
        args += ["-f", path]
    if overlay:
        args += ["-f", str(overlay)]
    return args


def rendered(project, snapshot, runner, overlay=None):
    result = runner(command(project, snapshot, overlay) + ["config", "--format", "json"], cwd=project, capture_output=True, text=True)
    if result.returncode:
        # Compose errors can contain interpolated credentials. Do not print them.
        raise ValueError("Compose configuration validation failed; the live stack was retained")
    try:
        config = json.loads(result.stdout)
    except (ValueError, TypeError):
        raise ValueError("Compose did not return a valid configuration") from None
    if not isinstance(config.get("services", {}).get("web"), dict):
        raise ValueError("The existing Compose stack has no web service")
    return config


def capture(project, current, runner=subprocess.run):
    project = Path(project)
    labels = current.get("Config", {}).get("Labels", {}) or {}
    working = labels.get("com.docker.compose.project.working_dir")
    if working and Path(working).resolve() != project.resolve():
        raise ValueError("The running web container belongs to a different Compose directory")
    paths = [Path(p.strip()) for p in labels.get("com.docker.compose.project.config_files", "").split(",") if p.strip()]
    if not paths or any(not (p if p.is_absolute() else project / p).is_file() for p in paths):
        paths = [next((project / name for name in ("compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml") if (project / name).is_file()), None)]
    if not paths[0]:
        raise ValueError("Existing Compose base file is missing")
    # Retain both running explicit files and the default override used by normal CLI commands.
    override = next((project / name for name in ("compose.override.yaml", "compose.override.yml", "docker-compose.override.yaml", "docker-compose.override.yml") if (project / name).is_file()), None)
    if override and override not in paths:
        paths.append(override)
    checked = []
    for path in paths:
        path = path if path.is_absolute() else project / path
        if path.is_symlink() or not path.is_file() or any(c in str(path) for c in "\n\r\0:$\"'"):
            raise ValueError("Unsupported existing Compose path; configuration was retained")
        if str(path) not in checked:
            checked.append(str(path))
    snapshot = {"files": checked, "hashes": {p: digest(Path(p)) for p in checked}, "projectName": labels.get("com.docker.compose.project"), "envBeforeHash": digest(project / ".env")}
    config = rendered(project, snapshot, runner)
    snapshot["projectName"] = snapshot["projectName"] or config.get("name")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", snapshot["projectName"] or ""):
        raise ValueError("Cannot identify the existing Compose project name")
    web = config["services"]["web"]
    if MAINNET_KEYS.intersection(web.get("environment") or {}):
        raise ValueError("Existing Compose environment already defines mainnet keys; preserve it for review")
    if any(v.get("target") == "/app/mainnet" for v in web.get("volumes", []) if isinstance(v, dict)):
        raise ValueError("The mainnet config mount is already in use")
    # A normal compose command must address the same data volume as the live container.
    mounted = [v["Name"] for v in current.get("Mounts", []) if v.get("Type") == "volume" and v.get("Destination") == "/app/data"]
    declared = [v for v in web.get("volumes", []) if isinstance(v, dict) and v.get("target") == "/app/data"]
    if len(mounted) != 1 or len(declared) != 1 or declared[0].get("type") != "volume":
        raise ValueError("Cannot preserve the running web data volume")
    volume = config.get("volumes", {}).get(declared[0]["source"], {})
    if volume.get("name") != mounted[0]:
        raise ValueError("Compose data volume differs from the running container")
    return snapshot


def preserve(snapshot, project, private):
    backup = private / "compose-original"
    backup.mkdir(mode=0o700, exist_ok=True)
    for i, name in enumerate(snapshot["files"]):
        data = Path(name).read_bytes()
        target = backup / (str(i) + "-" + Path(name).name)
        if target.exists() and target.read_bytes() != data:
            raise ValueError("A preserved Compose backup differs; nothing was overwritten")
        if not target.exists():
            atomic(target, data)
    env = project / ".env"
    if env.is_symlink():
        raise ValueError("Refusing an environment file symlink")
    if env.is_file():
        target = backup / "project.env"
        if target.exists() and digest(target) != snapshot["envBeforeHash"]:
            raise ValueError("The preserved environment differs from this preparation")
        if not target.exists():
            atomic(target, env.read_bytes())


def check(snapshot, project):
    for name, expected in snapshot["hashes"].items():
        path = Path(name)
        if path.is_symlink() or digest(path) != expected:
            raise ValueError("Compose source changed since preparation: " + path.name)
    env = project / ".env"
    allowed = {snapshot["envBeforeHash"]}
    if snapshot.get("envActiveHash") is not None:
        allowed.add(snapshot["envActiveHash"])
    if env.is_symlink() or digest(env) not in allowed:
        raise ValueError("Project environment changed since preparation; preserve it for review")


def validate(state, private, runner=subprocess.run):
    project = Path(state["project"])
    snapshot = state.get("composeSnapshot")
    if not snapshot:
        raise ValueError("Rerun the updated preparation kit before activation")
    check(snapshot, project)
    config = rendered(project, snapshot, runner, private / "compose.override.json")
    env = config["services"]["web"].get("environment") or {}
    expected = dict(line.split("=", 1) for line in (private / "runtime.env").read_text().splitlines() if "=" in line)
    if any(env.get(k) != v for k, v in expected.items()):
        raise ValueError("Existing Compose settings override mainnet runtime values; no web switch was performed")
    return config


def activate(state, private, runner=subprocess.run):
    validate(state, private, runner)
    project = Path(state["project"])
    snapshot = state["composeSnapshot"]
    env = project / ".env"
    original = env.read_text() if env.exists() else ""
    lines = [line for line in original.splitlines(keepends=True) if not re.match(r"^\s*(?:export\s+)?(?:" + "|".join(sorted(MANAGED)) + r")\s*=", line)]
    body = "".join(lines)
    if body and not body.endswith("\n"):
        body += "\n"
    values = {"COMPOSE_FILE": ":".join([*snapshot["files"], str(private / "compose.override.json")]), "COMPOSE_PROJECT_NAME": snapshot["projectName"], "COMPOSE_PATH_SEPARATOR": ":"}
    body += "".join(k + "=" + json.dumps(v) + "\n" for k, v in values.items())
    snapshot["envActiveHash"] = hashlib.sha256(body.encode()).hexdigest()
    # Journal the accepted old/new environment hashes before the atomic pointer update.
    atomic(private / "deployment.json", (json.dumps(state, indent=2) + "\n").encode())
    if not env.exists() or env.read_bytes() != body.encode():
        atomic(env, body.encode())


def secure_build(state, stage, project):
    path = stage / ".dockerignore"
    if path.is_symlink():
        raise ValueError("Refusing a Docker ignore symlink")
    original = project / ".dockerignore"
    if original.is_symlink():
        raise ValueError("Refusing a live Docker ignore symlink")
    if ".dockerignore" not in state["baselineFiles"]:
        state["baselineFiles"][".dockerignore"] = digest(original)
        atomic(path, original.read_bytes() if original.exists() else b"")
    # A migrated override can contain inline credentials; do not COPY it into build layers.
    rules = ["compose*.yaml", "compose*.yml", "compose*.json", "docker-compose*.yaml", "docker-compose*.yml", "docker-compose*.json"]
    for name in state.get("composeSnapshot", {}).get("files", []):
        try:
            rules.append(Path(name).relative_to(project).as_posix())
        except ValueError:
            pass
    rules = list(dict.fromkeys(rules))
    text = path.read_text() if path.exists() else ""
    block = "# Perla: runtime Compose files stay outside images\n" + "\n".join(rules) + "\n"
    if not text.endswith(block):
        atomic(path, (text.rstrip("\n") + "\n" + block).encode())
