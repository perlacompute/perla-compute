#!/usr/bin/env bash
set -euo pipefail
commit=82e6eee7076aafe10123e08db78f100d270c0582
script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
for command in git docker nvidia-smi; do
  command -v "$command" >/dev/null || { echo "Missing prerequisite: $command" >&2; exit 1; }
done
capabilities="$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader)"
if ! [[ "$capabilities" =~ 9\.0 ]]; then
  echo 'This pinned Pearl kernel profile supports NVIDIA sm90 (H100/H200). Other GPUs have not been validated.' >&2
  exit 1
fi
upstream="${PERLA_UPSTREAM_DIR:-$script_dir/pearl-upstream}"
if [ ! -d "$upstream" ]; then
  git init "$upstream"
  git -C "$upstream" remote add origin https://github.com/pearl-research-labs/pearl.git
  git -C "$upstream" fetch --depth 1 origin "$commit"
  git -C "$upstream" checkout --detach FETCH_HEAD
fi
[ "$(git -C "$upstream" rev-parse HEAD)" = "$commit" ] || { echo 'Wrong upstream revision. Use a clean checkout.' >&2; exit 1; }
[ -z "$(git -C "$upstream" status --porcelain)" ] || { echo 'Upstream checkout has local changes. Build from a clean checkout.' >&2; exit 1; }
git -C "$upstream" submodule update --init --recursive
docker buildx build --load -t perla-pearl:82e6eee7076a -f "$upstream/miner/vllm-miner/Dockerfile" "$upstream"
docker build --build-arg PEARL_IMAGE=perla-pearl:82e6eee7076a -t perla-worker:0.1 "$script_dir" -f "$script_dir/Dockerfile.worker"
echo 'Build complete. Download worker.env from the Perla dashboard and follow the installation guide.'
