#!/usr/bin/env bash
set +x
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
docker compose exec -T web node --input-type=module - "${1:-review}" "${2:-}" < scripts/perla-trial.mjs
