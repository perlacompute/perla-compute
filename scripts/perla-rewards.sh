#!/usr/bin/env bash
set +x
set -euo pipefail
exec python3 "$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)/reward-runner.py" "${1:-settle}"
