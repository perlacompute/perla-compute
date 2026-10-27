#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
command -v docker >/dev/null || { echo 'Install Docker Engine and Docker Compose plugin first.' >&2; exit 1; }
docker compose version >/dev/null
if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo 'Created .env with work admission paused. Configure it before enabling mining.'
fi
docker compose up -d --build web
docker compose ps
echo 'Web deployment started. Check: docker compose logs --tail 80 web'
