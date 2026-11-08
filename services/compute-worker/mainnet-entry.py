#!/usr/bin/env python3
"""Mainnet domain adapter around the unchanged, verified CUDA proof core."""
import argparse, base64, hashlib, json, os, signal, struct, sys, time, urllib.request, urllib.error, uuid
from pathlib import Path

KIT = Path(__file__).resolve().parent
PLAN_RECORD = json.loads((KIT / "launch-plan.json").read_text())
PLAN = PLAN_RECORD["plan"]
POLICY = PLAN_RECORD["hash"]
PROTOCOL = "perla-mainnet-plain-v1"
if (
    hashlib.sha256(
        json.dumps(PLAN, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    != POLICY
):
    raise RuntimeError("Mainnet plan checksum differs")


def target(bits):
    e, m = bits >> 24, bits & 0x7FFFFF
    return m << (8 * (e - 3)) if e > 3 else m >> (8 * (3 - e))


def validate_job(job, now, origin=None):
    if (
        job.get("chainId") != 4663
        or job.get("protocol") != PROTOCOL
        or job.get("policyHash") != POLICY
    ):
        raise ValueError("Wrong mainnet protocol or policy")
    for field in ["id", "workerId"]:
        if str(uuid.UUID(job[field])) != job[field]:
            raise ValueError("Invalid job/worker ID")
    if (
        job["workerId"] != os.environ["PERLA_MAINNET_WORKER_ID"]
        or job["recipient"] != os.environ["PERLA_MAINNET_REWARD_WALLET"]
        or job["vault"] != os.environ["PERLA_MAINNET_REWARD_VAULT"]
    ):
        raise ValueError("Worker, recipient or vault changed")
    if type(job["expires"]) is not int or not now + 5 < job["expires"] <= now + 310:
        raise ValueError("Expired or unexpected challenge lifetime")
    m, r = job["mining_job"], job["round"]
    raw = base64.b64decode(m["incomplete_header_bytes"], validate=True)
    if (
        len(raw) != 76
        or base64.b64encode(raw).decode() != m["incomplete_header_bytes"]
        or m["cert_version"] != 3
    ):
        raise ValueError("Invalid challenge encoding")
    version, timestamp, bits = (
        struct.unpack_from("<I", raw)[0],
        struct.unpack_from("<I", raw, 68)[0],
        struct.unpack_from("<I", raw, 72)[0],
    )
    if (
        version != 1
        or bits != PLAN["shareBits"]
        or not now - 310 < timestamp <= now + 30
        or str(m["target"]) != str(target(bits))
    ):
        raise ValueError("Unexpected challenge target or timestamp")
    p = job["workPolicy"]
    if (
        p.get("bits") != bits
        or p.get("points") != 1
        or p.get("profile") != "p1"
        or p.get("hash") != POLICY
    ):
        raise ValueError("Unexpected share scoring")
    units = r.get("workUnits")
    if (
        type(units) is not int
        or units < 256
        or units > 65536
        or units & (units - 1)
        or target(PLAN["shareBits"]) // target(r["bits"]) != units
        or r.get("policyHash") != POLICY
        or r.get("policy") != "perla-mainnet-rounds-v1"
        or r.get("windowWorkUnits") != units * 2
        or r.get("epoch") != job["epoch"]
    ):
        raise ValueError("Invalid reward round")
    if str(uuid.UUID(r["id"])) != r["id"] or job["epoch"] != timestamp // 86400:
        raise ValueError("Invalid round or epoch")
    previous = hashlib.sha256(
        f"perla-mainnet-work-v1|4663|{origin}|{job['vault']}|{job['epoch']}|round={r['id']}|policy={POLICY}".encode()
    ).digest()[::-1]
    commitment = hashlib.sha256(
        f"perla-mainnet-recipient-v1|4663|{job['workerId']}|{job['recipient']}|{job['epoch']}|{job['id']}".encode()
    ).digest()[::-1]
    if raw[4:36] != previous or raw[36:68] != commitment:
        raise ValueError("Challenge domain or reward-wallet commitment differs")
    return raw


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--core", required=True)
    parser.add_argument("--device", type=int, default=0)
    parser.add_argument("--shares", type=int, default=0)
    a = parser.parse_args()
    sys.path.insert(0, a.core)
    import miner
    from perla_bridge import CoordinatorError

    class Client:
        def __init__(self, endpoint, token):
            self.endpoint = endpoint
            self.token = token
            self.architecture = None

        def call(self, path, payload=None):
            headers = {
                "authorization": "Bearer " + self.token,
                "content-type": "application/json",
                "x-perla-protocol": PROTOCOL,
                "x-perla-mainnet-policy": POLICY,
            }
            request = urllib.request.Request(
                self.endpoint + "/api/compute/mining/" + path,
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
                        error.get("message", "Coordinator rejected work")
                        if isinstance(error, dict)
                        else str(error)
                    )
                    code = error.get("code") if isinstance(error, dict) else None
                except Exception:
                    message, code = "Coordinator unavailable", None
                raise CoordinatorError(message, e.code, code, False) from None

    miner.validate_job = validate_job
    emit = miner.emit

    def mainnet_emit(event, **values):
        if event == "accepted_share":
            values["explorer"] = (
                os.environ["PERLA_ENDPOINT"]
                + "/platform/network?tab=explorer&receipt="
                + values["id"]
            )
        emit(event, **values)

    miner.emit = mainnet_emit

    def stop(*_):
        miner.STOP = True

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    report = miner.validation_report(a.device)
    client = Client(os.environ["PERLA_ENDPOINT"], os.environ["PERLA_WORKER_TOKEN"])
    client.call("validation", {"report": report})
    emit(
        "gpu_report_uploaded",
        workerId=os.environ["PERLA_MAINNET_WORKER_ID"],
        creditCreated=False,
    )
    args = argparse.Namespace(device=a.device, k=2048, shares=a.shares, interval=10)
    miner.run_worker(args, client_factory=Client)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as e:
        message = str(e).replace(
            os.environ.get("PERLA_WORKER_TOKEN", "not-a-token"), "[redacted]"
        )
        print("Perla mainnet stopped: " + message[:400], file=sys.stderr)
        raise SystemExit(1)
