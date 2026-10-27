# Native verifier bindings come from the exact same source as the VPS verifier.
FROM python:3.12-slim-bookworm AS native
RUN apt-get update && apt-get install -y --no-install-recommends build-essential git curl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/rustup.sh && sh /tmp/rustup.sh -y --profile minimal --default-toolchain 1.99.1
ENV PATH=/root/.cargo/bin:$PATH CARGO_BUILD_JOBS=4
RUN pip install --no-cache-dir maturin==1.13.0
WORKDIR /opt/pearl
RUN git init && git remote add origin https://github.com/pearl-research-labs/pearl.git && git fetch --depth 1 origin 82e6eee7076aafe10123e08db78f100d270c0582 && git checkout --detach FETCH_HEAD
WORKDIR /opt/pearl/py-pearl-mining
RUN maturin build --release --locked --out /wheels

# CUDA 13.1 provides native compilation for consumer Blackwell sm120 as well as
# Ampere sm86 and Ada sm89. Keep the complete NVIDIA license in the image.
FROM nvidia/cuda:13.1.1-devel-ubuntu24.04@sha256:9cf8694a27722418a1f175d90f85d5afb5a728fd4a9907d7f0565efecfa14d32 AS cuda
WORKDIR /build
COPY rtx.cu build-cuda.sh ./
RUN bash build-cuda.sh && cp /NGC-DL-CONTAINER-LICENSE /build/NVIDIA-CONTAINER-LICENSE.txt

FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates libstdc++6 && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH NVIDIA_DRIVER_CAPABILITIES=compute,utility
COPY --from=native /wheels /wheels
RUN pip install --no-cache-dir /wheels/*.whl numpy==2.4.2 blake3==1.0.8 && rm -rf /wheels
WORKDIR /app
COPY --from=cuda /build/libperla_rtx.so ./
COPY --from=native /opt/pearl/LICENSE /licenses/Pearl-ISC.txt
COPY --from=native /opt/pearl/plonky2/LICENSE-MIT /licenses/Plonky2-MIT.txt
COPY --from=native /opt/pearl/plonky2/LICENSE-APACHE /licenses/Plonky2-APACHE.txt
COPY --from=cuda /build/NVIDIA-CONTAINER-LICENSE.txt /licenses/NVIDIA-CONTAINER-LICENSE.txt
COPY protocol.py cuda_backend.py reference.py miner.py test_protocol.py perla_bridge.py work-profiles.json NOTICE.md ./
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 RAYON_NUM_THREADS=2
USER 65534:65534
ENTRYPOINT ["python", "/app/miner.py"]
CMD ["selftest"]
