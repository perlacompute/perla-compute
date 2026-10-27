#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
command -v nvcc >/dev/null || { echo 'CUDA 13.1 nvcc is required to build sm86, sm89 and sm120.' >&2; exit 1; }
nvcc -std=c++17 -O3 -shared -Xcompiler=-fPIC --cudart=static \
  -gencode arch=compute_86,code=sm_86 \
  -gencode arch=compute_89,code=sm_89 \
  -gencode arch=compute_120,code=sm_120 \
  rtx.cu -o libperla_rtx.so

# Check that all three native images, including sm120, are present.
if command -v cuobjdump >/dev/null; then
  cuobjdump --list-elf libperla_rtx.so > cuda-targets.txt
  for arch in sm_86 sm_89 sm_120; do
    grep -q "$arch" cuda-targets.txt || { echo "Missing CUDA image: $arch" >&2; exit 1; }
  done
  cat cuda-targets.txt
fi
