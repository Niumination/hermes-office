#!/usr/bin/env bash
# Build frontend + restart service. Run from repo root (external terminal, not from inside Hermes).
set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

echo "==> pulling"
git pull --ff-only || echo "(not a fast-forward pull; continuing with working tree)"

echo "==> deps"
(cd frontend && npm ci)
npm ci --omit=dev

echo "==> build frontend"
(cd frontend && npm run build)

echo "==> restart service"
systemctl --user restart hermes-office
sleep 2
curl -s "http://127.0.0.1:${OFFICE_PORT:-7333}/health" || true
echo
echo "deployed."
