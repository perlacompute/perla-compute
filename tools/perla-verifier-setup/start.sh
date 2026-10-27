#!/usr/bin/env bash
set +x
set -euo pipefail
kit="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
project="${1:-/var/www/perla-vps}"
nginx_file="${2:-/etc/nginx/sites-available/perlacompute.xyz}"
for dependency in python3 docker nginx flock sha256sum; do command -v "$dependency" >/dev/null || { echo "$dependency is required." >&2; exit 1; }; done
test "$(id -u)" = 0 || { echo 'Run this installer as root on the VPS.' >&2; exit 1; }
project="$(CDPATH='' cd -- "$project" && pwd)"
(cd -- "$kit" && sha256sum --status -c SHA256SUMS) || { echo 'Installer checksum verification failed.' >&2; exit 1; }
mkdir -p "$project/data/verifier-setup"
chmod 700 "$project/data/verifier-setup"
exec 9>"$project/data/verifier-setup/setup.lock"
flock -n 9 || { echo 'Another verifier setup is already running.' >&2; exit 1; }
python3 "$kit/install.py" "$project" "$nginx_file"
