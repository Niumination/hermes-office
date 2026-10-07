#!/usr/bin/env bash
# Regression guard for the SIGTERM hang.
#
# Before the fix: httpServer.close() waited on an attached WebSocket forever,
# so `systemctl restart` stalled until the 90s default TimeoutStopSec fired a
# SIGKILL — losing the SQLite WAL checkpoint every single deploy.
#
# This script starts the server, attaches a real WebSocket client, sends
# SIGTERM, and fails if the process is still alive after 10 seconds.
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${OFFICE_PORT:-7501}"
export OFFICE_PORT="$PORT"
export OFFICE_CLOUD_TOKEN="${OFFICE_CLOUD_TOKEN:-ci-cloud-token-000000000000}"
export OFFICE_MAC_TOKEN="${OFFICE_MAC_TOKEN:-ci-mac-token-0000000000000}"
export OFFICE_OWNER_TOKEN="${OFFICE_OWNER_TOKEN:-ci-owner-token-00000000000}"
export OFFICE_GUEST_TOKEN="${OFFICE_GUEST_TOKEN:-ci-guest-token-00000000000}"
export OFFICE_DB="${OFFICE_DB:-$(mktemp -d)/office.db}"

node server/index.js > /tmp/shutdown-check.log 2>&1 &
SRV=$!
cleanup() { kill -9 "$SRV" 2>/dev/null || true; }
trap cleanup EXIT

for _ in $(seq 1 50); do
  curl -sf "http://127.0.0.1:$PORT/health" >/dev/null && break
  sleep 0.2
done
curl -sf "http://127.0.0.1:$PORT/health" >/dev/null || { echo "server never became healthy"; cat /tmp/shutdown-check.log; exit 1; }

# Attach a live WebSocket — this is the condition that used to hang shutdown.
node -e '
import("ws").then(({default:WS})=>{
  const w=new WS(`ws://127.0.0.1:${process.env.OFFICE_PORT}/ws`,
    {headers:{Authorization:`Bearer ${process.env.OFFICE_OWNER_TOKEN}`}});
  w.on("open",()=>console.log("ws attached"));
  w.on("error",e=>{console.error("ws failed:",e.message);process.exit(1)});
  setInterval(()=>{},1000);
})' &
WSPID=$!
sleep 2

clients=$(curl -s "http://127.0.0.1:$PORT/health" | grep -o '"wsClients":[0-9]*' | cut -d: -f2)
[ "${clients:-0}" -ge 1 ] || { echo "FAIL: no websocket attached, test would be vacuous"; exit 1; }
echo "wsClients=$clients, sending SIGTERM"

start=$(date +%s)
kill -TERM "$SRV"
for _ in $(seq 1 100); do kill -0 "$SRV" 2>/dev/null || break; sleep 0.1; done
kill "$WSPID" 2>/dev/null || true

if kill -0 "$SRV" 2>/dev/null; then
  echo "FAIL: server still alive 10s after SIGTERM"
  cat /tmp/shutdown-check.log
  exit 1
fi

echo "PASS: clean exit in $(( $(date +%s) - start ))s with a live WebSocket attached"
