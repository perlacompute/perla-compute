#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077
release=worker-v0.5.0
for tool in python3 curl; do command -v "$tool" >/dev/null || { echo "Install $tool first." >&2; exit 1; }; done
if [ "${1:-}" = --help ] || [ "${1:-}" = -h ]; then
 echo 'Perla worker installer — Linux x86-64'
 echo 'Usage: bash install.sh [--profile rtx|hopper] [--root /path] [--bin-dir /path]'
 echo 'Installs the pinned worker-v0.5.0 package. Does not build or start mining.'
 echo 'Full guide: https://perlacompute.xyz/platform/setup'
 exit 0
fi
temporary="$(mktemp -d)"
trap 'rm -rf -- "$temporary"' EXIT
base="https://github.com/perlacompute/perla-compute/releases/download/$release"
curl --fail --show-error --silent --location --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 15 --max-time 120 "$base/SHA256SUMS" -o "$temporary/SHA256SUMS"
curl --fail --show-error --silent --location --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 15 --max-time 120 "$base/install.py" -o "$temporary/install.py"
python3 - "$temporary/SHA256SUMS" "$temporary/install.py" <<'PY'
import hashlib,re,sys
from pathlib import Path
lines=Path(sys.argv[1]).read_text().splitlines();matches=[line for line in lines if re.fullmatch(r'[a-f0-9]{64}  install\.py',line)]
if len(matches)!=1 or hashlib.sha256(Path(sys.argv[2]).read_bytes()).hexdigest()!=matches[0].split()[0]:raise SystemExit('Installer checksum failed; no Python installer was executed.')
PY
python3 "$temporary/install.py" --root "${PERLA_INSTALL_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/perla}" install --release "$release" "$@"
