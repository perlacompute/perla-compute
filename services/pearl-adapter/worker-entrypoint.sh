#!/usr/bin/env bash
set -euo pipefail
: "${PERLA_ENDPOINT:?Set PERLA_ENDPOINT from your worker configuration}"
: "${PERLA_WORKER_TOKEN:?Set your worker-scoped token}"
export MINER_RPC_TRANSPORT=tcp MINER_RPC_HOST=127.0.0.1 MINER_RPC_PORT=8337
python /perla/perla_bridge.py &
bridge_pid=$!
cleanup() { kill "$bridge_pid" "${miner_pid:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
vllm serve "$@" &
miner_pid=$!
wait -n "$bridge_pid" "$miner_pid"
