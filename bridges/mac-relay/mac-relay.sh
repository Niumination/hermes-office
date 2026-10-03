#!/usr/bin/env bash
# =============================================================================
# mac-relay.sh — Hermes Mac → Hermes Office event relay
#
# Tails the Hermes A2A audit log and heartbeats agent status to the office
# server over Tailscale. Run via launchd (see plist) or manually.
#
# Env:
#   OFFICE_URL    default http://100.65.20.34:7333/event  (server's Tailscale IP)
#   OFFICE_MAC_TOKEN   bearer token (required; also read from ~/.hermes/.env)
#   AUDIT_LOG     default ~/.hermes/a2a_audit.jsonl
# =============================================================================
set -uo pipefail

OFFICE_URL="${OFFICE_URL:-http://100.65.20.34:7333/event}"
AUDIT_LOG="${AUDIT_LOG:-$HOME/.hermes/a2a_audit.jsonl}"
LOGFILE="${LOGFILE:-$HOME/Library/Logs/office-relay.log}"
HEARTBEAT_EVERY=30

log() { echo "$(date '+%F %T') $*" >> "$LOGFILE"; }

read_token() {
  if [ -n "${OFFICE_MAC_TOKEN:-}" ]; then return 0; fi
  OFFICE_MAC_TOKEN=$(grep -m1 '^OFFICE_MAC_TOKEN=' "$HOME/.hermes/.env" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"'')
}

post_event() {
  # $1 = JSON payload. Retries up to 3x with backoff, then drops.
  local payload="$1" attempt=1
  while [ $attempt -le 3 ]; do
    if curl -sf --max-time 5 -X POST "$OFFICE_URL" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $OFFICE_MAC_TOKEN" \
        -d "$payload" >/dev/null 2>&1; then
      return 0
    fi
    sleep $((attempt * 2))
    attempt=$((attempt + 1))
  done
  log "DROP event after 3 attempts: $(echo "$payload" | head -c 120)"
}

heartbeat_loop() {
  while true; do
    post_event "{\"type\":\"agent_status\",\"agent\":\"mac\",\"state\":\"idle\",\"ts\":$(date +%s)000}"
    sleep "$HEARTBEAT_EVERY"
  done
}

map_audit_line() {
  # $1 = one JSONL line from a2a_audit.jsonl → office event JSON (or empty to skip)
  python3 - "$1" <<'PYEOF'
import json, sys, time
try:
    line = json.loads(sys.argv[1])
except Exception:
    sys.exit(0)
ts = int(time.time() * 1000)
# Audit log schema is defensive-parsed: emit a generic a2a event.
ev = {"type": "a2a_task_in", "dest": "mac", "summary": "", "ts": ts}
for k in ("peer", "from", "caller", "task_id", "contextId", "context_id"):
    if isinstance(line, dict) and line.get(k):
        if k in ("peer", "from", "caller"):
            ev["peer"] = str(line[k])[:64]
        else:
            ev["taskId"] = str(line[k])[:64]
print(json.dumps(ev))
PYEOF
}

main() {
  read_token
  if [ -z "${OFFICE_MAC_TOKEN:-}" ]; then
    log "FATAL: no OFFICE_MAC_TOKEN (env or ~/.hermes/.env)"
    exit 1
  fi
  log "relay starting → $OFFICE_URL"

  heartbeat_loop &   # background heartbeat
  HB_PID=$!
  trap 'kill $HB_PID 2>/dev/null' EXIT

  touch "$AUDIT_LOG"
  tail -n 0 -F "$AUDIT_LOG" 2>/dev/null | while IFS= read -r line; do
    ev=$(map_audit_line "$line")
    [ -n "$ev" ] && post_event "$ev"
  done
}

main "$@"
