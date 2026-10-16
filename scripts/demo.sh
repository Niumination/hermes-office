#!/usr/bin/env bash
#
# demo.sh — boot a throwaway office, seed 90 seconds of story, print the tour.
#
# WHY THIS EXISTS
# ---------------
# The four artifacts this product is actually sold on — the kiosk, the
# standup, the replay and the dossier — are all derived from a ledger. On a
# fresh install that ledger is empty, so every one of them correctly renders
# as "nothing happened yet". A demo of an empty office demos nothing, and
# whoever is showing it ends up narrating what the screen WOULD look like,
# which is the worst sales motion there is.
#
# So this seeds a specific, legible incident: an agent walks into a room it
# needs permission for, another one gets stuck in a retry loop against a tool
# it is not allowed to use, and spend climbs until the budget trips. That is
# the story every buyer already recognises from their own logs.
#
# SAFETY
# ------
# Runs against a scratch data dir and a non-default port, with demo tokens.
# It never touches a real deployment's ledger — a demo that could corrupt
# production evidence is not a demo anyone should run.
#
# USAGE
#     bash scripts/demo.sh [--port 7400] [--keep]
#
# --keep leaves the data dir behind so you can re-run the tour without
# re-seeding, which matters when you are presenting twice in a row.

set -uo pipefail

PORT=7400
DATA_DIR=/tmp/hermes-demo
KEEP=0

while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

# Both of these are things a first-time runner hits, and both produce a wall
# of module-resolution stack trace if left to fail on their own. A demo that
# greets someone with ERR_MODULE_NOT_FOUND has already lost the room.
if [ ! -d node_modules ]; then
  echo "dependencies are missing — run: npm ci" >&2
  exit 1
fi
if [ ! -d frontend/dist ]; then
  echo "frontend/dist is missing — run: (cd frontend && npm ci && npm run build)" >&2
  exit 1
fi

[ "$KEEP" = "1" ] || rm -rf "$DATA_DIR"
mkdir -p "$DATA_DIR"

export OFFICE_PORT="$PORT"
export OFFICE_HOST=0.0.0.0
export OFFICE_DATA_DIR="$DATA_DIR"
export OFFICE_OWNER_TOKEN=demo-owner
export OFFICE_GUEST_TOKEN=demo-guest
export OFFICE_OTLP_TOKEN=demo-otlp
export OFFICE_CLOUD_TOKEN=demo-cloud
export OFFICE_MAC_TOKEN=demo-mac
export OFFICE_BUDGET_HOURLY_USD=2
export OFFICE_LEDGER_RECORD_ALLOWS=1
export OFFICE_ANCHOR_INTERVAL_MS=0

node server/index.js >"$DATA_DIR/server.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null; wait $SRV 2>/dev/null' EXIT INT TERM

B="http://127.0.0.1:$PORT"
OWNER=(-H "Authorization: Bearer demo-owner" -H "content-type: application/json")
CLOUD=(-H "Authorization: Bearer demo-cloud" -H "content-type: application/json")

for _ in $(seq 1 40); do
  sleep 0.25
  curl -sf -o /dev/null "${OWNER[@]}" "$B/policy" && break
done
if ! curl -sf -o /dev/null "${OWNER[@]}" "$B/policy"; then
  echo "server did not come up — see $DATA_DIR/server.log" >&2
  exit 1
fi

say() { printf '  %s\n' "$1"; }

if [ "$KEEP" = "0" ]; then
  echo
  echo "Seeding a story..."

  # A normal morning: five agents at their desks.
  for a in ana budi citra dewi eka; do
    curl -s -o /dev/null -X POST "${OWNER[@]}" -d '{"room":"main-office"}' "$B/agents/$a/room"
  done
  say "five agents at their desks"

  # One agent needs the server room. That room requires approval, so this
  # parks a decision in front of a human instead of just happening.
  curl -s -o /dev/null -X POST "${OWNER[@]}" -d '{"room":"server-room"}' "$B/agents/citra/room"
  say "citra asked to enter the server room — approval pending"

  # An agent stuck in a loop against a tool the meeting room forbids. This is
  # the finding buyers recognise instantly: it is not an attack, it is a bot
  # retrying, and every retry costs money upstream even though nothing runs.
  curl -s -o /dev/null -X POST "${OWNER[@]}" -d '{"room":"meeting-room"}' "$B/agents/budi/room"
  for _ in $(seq 1 9); do
    curl -s -o /dev/null -X POST "${OWNER[@]}" \
      -d '{"agent":"budi","tool":"kubectl","room":"meeting-room","estimatedUsd":0.02}' \
      "$B/policy/check"
  done
  say "budi denied 9x for kubectl — a retry loop, not an intruder"

  # Spend climbs through the states until the hourly budget trips.
  for c in 0.45 0.55 0.5 0.4 0.35; do
    curl -s -o /dev/null -X POST "${CLOUD[@]}" \
      -d "{\"type\":\"tool_done\",\"agentId\":\"ana\",\"tool\":\"llm\",\"costUsd\":$c}" "$B/event"
    sleep 0.15
  done
  say "ana burned through the hourly budget — normal -> warm -> hot -> tripped"

  # A second day of history so the standup has something to compare against.
  curl -s -o /dev/null -X POST "${OWNER[@]}" -d '{"room":"kitchen"}' "$B/agents/eka/room"
  curl -s -o /dev/null -X POST "${OWNER[@]}" -d '{"room":"lobby"}' "$B/agents/dewi/room"
fi

HEAD=$(curl -s "${OWNER[@]}" "$B/ledger/verify" | head -c 400)

cat <<BANNER

======================================================================
  HERMES OFFICE — demo running on port $PORT
======================================================================

  owner token : demo-owner     (sees dollars)
  guest token : demo-guest     (sees temperature, never amounts)
  data dir    : $DATA_DIR   (throwaway)

  THE 90-SECOND TOUR
  ------------------

  0:00  The office                  $B/
        Five agents in rooms. The floor plan IS the policy: each room
        carries its own trust level, tool list, model ceiling and
        budget. Walk an agent across the room and you change what it
        is allowed to do.

  0:20  The decision waiting        (look for the approval gate, lower left)
        citra asked for the server room. Nothing happened while a
        human was not looking — that is the product.

  0:35  The wall display            $B/kiosk
        Open it in another tab. Note there are no dollar amounts, even
        though you are logged in as owner. It downgrades itself,
        because a screen on a wall is seen by couriers and phone
        cameras. Add ?reveal=1 to show the hourly number.

  1:00  This morning's read         $B/standup
        Ranked, and short. It will tell you budi is stuck in a loop
        and the budget tripped. On a quiet night it is one line —
        that is the feature, not a gap.

  1:15  The time machine            $B/replay?from=0
        Every governance decision, replayable. Rooms, not
        coordinates: if the chain did not record it, the replay will
        not invent it.

  1:30  The evidence                $B/dossier
        The artifact an assessor reads. Hash-chained, and it reports
        its own verification verdict rather than asserting it is fine.

        chain: $HEAD

  Curl it instead:
      curl -H 'Authorization: Bearer demo-owner' $B/standup

  Ctrl-C to stop. Data dir is deleted on the next run unless --keep.

BANNER

wait $SRV
