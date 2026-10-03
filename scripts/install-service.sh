#!/usr/bin/env bash
# Install hermes-office as a systemd user service. Run from the repo root.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="$HOME/.config/systemd/user"
UNIT="$SERVICE_DIR/hermes-office.service"

mkdir -p "$SERVICE_DIR"

if [ ! -f "$REPO_DIR/.env.office" ]; then
  echo "ERROR: $REPO_DIR/.env.office missing. Copy .env.office.example and fill tokens first." >&2
  exit 1
fi

cat > "$UNIT" <<EOF
[Unit]
Description=Hermes Office - pixel office for Niumination agents
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$REPO_DIR
EnvironmentFile=$REPO_DIR/.env.office
ExecStart=/usr/bin/env node $REPO_DIR/server/index.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now hermes-office
sleep 2
systemctl --user status hermes-office --no-pager | head -5
echo "Done. Health: curl -s http://127.0.0.1:\${OFFICE_PORT:-7333}/health"
