#!/usr/bin/env python3
"""Deterministic open-model execution on an approved local GPU inference host."""
import argparse, json, os, signal, sys, time, urllib.request, urllib.parse
from pathlib import Path
from mainnet import call, CoordinatorFailure

STOP = False


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--core", required=True)
    p.add_argument("--device", type=int, default=0)
    p.add_argument("--models", required=True)
    p.add_argument("--revision", required=True)
    p.add_argument("--backend", default="http://127.0.0.1:8000/v1")
    a = p.parse_args()
    u = urllib.parse.urlsplit(a.backend)
    if (
        u.scheme != "http"
        or u.hostname not in ("127.0.0.1", "localhost")
        or u.username
        or u.password
        or u.query
        or u.fragment
    ):
        raise ValueError("Use a loopback OpenAI-compatible inference backend")
    if len(a.revision) not in (40, 64) or any(
        c not in "0123456789abcdef" for c in a.revision
    ):
        raise ValueError("Pin the immutable model-weight revision")
    sys.path.insert(0, a.core)
    import miner

    report = miner.validation_report(a.device)
    origin = os.environ["PERLA_ENDPOINT"]
    token = os.environ["PERLA_WORKER_TOKEN"]
    call(origin, "mining/validation", {"report": report}, token)
    models = [m.strip() for m in a.models.split(",") if m.strip()]
    print(
        json.dumps(
            {
                "event": "inference_worker_ready",
                "workerId": os.environ["PERLA_MAINNET_WORKER_ID"],
                "models": models,
                "revision": a.revision,
                "operatorApprovalRequired": True,
                "creditCreated": 0,
            }
        ),
        flush=True,
    )
    while not STOP:
        call(origin, "mining/status", token=token)
        try:
            lease = call(origin, "mining/gpu/lease", {"models": models}, token)
        except CoordinatorFailure as e:
            if e.code in ("feature_closed", "activation_required", "gpu_approval"):
                print(
                    json.dumps(
                        {
                            "event": "waiting_for_inference_admission",
                            "code": e.code,
                            "retrySeconds": 5,
                        }
                    ),
                    flush=True,
                )
                time.sleep(5)
                continue
            raise
        if lease.get("waiting"):
            time.sleep(5)
            continue
        payload = lease["payload"]
        if payload["revision"] != a.revision:
            raise ValueError(
                "Job weight revision differs from this backend configuration"
            )
        headers = {"content-type": "application/json"}
        if os.environ.get("PERLA_LOCAL_LLM_KEY"):
            headers["authorization"] = "Bearer " + os.environ["PERLA_LOCAL_LLM_KEY"]
        request = urllib.request.Request(
            a.backend.rstrip("/") + "/chat/completions",
            data=json.dumps(
                {k: v for k, v in payload.items() if k != "revision"}
            ).encode(),
            headers=headers,
        )

        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *_):
                return None

        with urllib.request.build_opener(NoRedirect()).open(
            request, timeout=120
        ) as response:
            raw = response.read(2000001)
            if len(raw) > 2000000:
                raise ValueError("Local inference output exceeds its size allowance")
            result = json.loads(raw)
        text = result["choices"][0]["message"]["content"]
        usage = result["usage"]
        if not isinstance(text, str):
            raise ValueError("GPU job expected a plain text completion")
        value = {
            "model": payload["model"],
            "revision": a.revision,
            "text": text,
            "input_tokens": usage["prompt_tokens"],
            "output_tokens": usage["completion_tokens"],
        }
        receipt = call(
            origin,
            "mining/gpu/result",
            {
                "leaseId": lease["leaseId"],
                "leaseToken": lease["leaseToken"],
                "result": value,
            },
            token,
        )
        print(
            json.dumps(
                {
                    "event": "gpu_result_submitted",
                    "jobId": lease["jobId"],
                    "leaseId": lease["leaseId"],
                    **receipt,
                }
            ),
            flush=True,
        )


def stop(*_):
    global STOP
    STOP = True


if __name__ == "__main__":
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    try:
        main()
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as e:
        print(
            "Inference worker stopped: "
            + str(e).replace(
                os.environ.get("PERLA_WORKER_TOKEN", "not-a-token"), "[redacted]"
            )[:300],
            file=sys.stderr,
        )
        raise SystemExit(1)
