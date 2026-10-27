#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
for prerequisite in docker nvidia-smi; do
  command -v "$prerequisite" >/dev/null || { echo "Missing prerequisite: $prerequisite" >&2; exit 1; }
done
# This check diagnoses device visibility; the CUDA library selects and validates
# the actual requested device, so a mixed rig is not rejected because GPU 0 is older.
nvidia-smi --query-gpu=index,name,memory.total,compute_cap --format=csv
docker buildx version >/dev/null
if [[ ! -f perla_bridge.py ]]; then
  echo 'Use the complete perla-rtx-worker download, including perla_bridge.py.' >&2
  exit 1
fi
docker buildx build --load -t perla-rtx-worker:0.5.0 .
echo 'Built the RTX validation image for sm86, sm89 and sm120. Hardware validation is still required.'
echo 'Run: docker run --rm --gpus all perla-rtx-worker:0.5.0 selftest --device 0'
