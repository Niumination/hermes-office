#!/usr/bin/env bash
# =============================================================================
# check-live.sh — the only gate that looks at the running site.
#
# Why this exists
# ---------------
# Sixteen gates measure properties of the repository: do the numbers in the
# docs match the code, do the hashes line up, does it build. Zero of them ever
# made an HTTP request to the thing users open. On 12 October that gap cost
# three days: 132 character sprites were retired because "no code loads them",
# which was true of the repo and false of the product — the loader had just
# been deleted. The office was empty the whole time and all gates stayed green.
#
# This gate asks the live site six questions that the repo cannot answer.
# It is deliberately the *only* live gate. The failure mode being corrected is
# an apparatus that grew faster than the product, so this file should stay
# small, and a seventh question should replace one of these rather than be
# added to them.
#
# Usage:
#   bash scripts/check-live.sh                 # checks dash.abstract.biz.id
#   OFFICE_LIVE_URL=https://host bash scripts/check-live.sh
#   SKIP_LIVE=1 bash scripts/check-live.sh     # explicit offline opt-out
#
# Exit: 0 all pass (or skipped) · 1 a check failed
# =============================================================================
set -uo pipefail

URL="${OFFICE_LIVE_URL:-https://dash.abstract.biz.id}"
URL="${URL%/}"
JAR="$(mktemp -t hermes-live-jar.XXXXXX)"
BODY="$(mktemp -t hermes-live-body.XXXXXX)"
trap 'rm -f "$JAR" "$BODY"' EXIT

PASS=0
FAIL=0

ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL + 1)); }
note() { printf '        %s\n' "$1"; }

if [ "${SKIP_LIVE:-0}" = "1" ]; then
  echo "check-live: SKIP_LIVE=1 — skipped"
  exit 0
fi

echo "check-live: $URL"

# --- 1. the site is up ------------------------------------------------------
# -f is deliberately NOT used: it hides the response body on 4xx, and the body
# is where the office explains itself.
code=$(curl -s -o "$BODY" -w '%{http_code}' -m 20 "$URL/health" 2>/dev/null)
if [ "$code" = "200" ] && grep -q '"status"' "$BODY" 2>/dev/null; then
  up=$(grep -o '"uptimeS":[0-9]*' "$BODY" | cut -d: -f2)
  ok "/health answers 200 (uptime ${up:-?}s)"
else
  bad "/health answered '$code'"
  note "$(head -c 160 "$BODY" 2>/dev/null)"
fi

# --- 2. the door is served, and it is only a door ---------------------------
# GET / used to mint a guest session, so every visitor was logged in as a
# second principal. It must now serve the shell and nothing else: a 200 with
# the app HTML, and NO session cookie. Both halves matter — a 401 here would
# lock the owner out of the login form itself, and a cookie here would mean
# the auto-session came back.
code=$(curl -s -c "$JAR" -o "$BODY" -w '%{http_code}' -m 20 "$URL/" 2>/dev/null)
if [ "$code" != "200" ]; then
  bad "GET / returned '$code' — the login shell must be reachable without a session"
elif grep -q 'office_session' "$JAR" 2>/dev/null; then
  bad "GET / minted a session cookie — the auto-session is back"
else
  ok "GET / serves the shell and mints nothing"
fi

# --- 3. no data before a session --------------------------------------------
# These three are what the office draws itself from. Served to an anonymous
# caller they are a floor plan, a staff list and a live location feed, which
# is why there is no longer a role that may read them without a token.
for ep in policy roster presence; do
  code=$(curl -s -b "$JAR" -o "$BODY" -w '%{http_code}' -m 20 "$URL/$ep" 2>/dev/null)
  case "$code" in
    401) ok "/$ep refuses an anonymous caller" ;;
    000) bad "/$ep unreachable — authorization not verified" ;;
    *) bad "/$ep answered '$code' without a session (expected 401)" ;;
  esac
done

# --- 4. owner-only data is still owner-only ---------------------------------
# A live assertion, not a repo one: this is the check that notices if a deploy
# ever ships with the guards misconfigured. With one principal these answer
# the same 401 as section 3; they are kept separate because a regression that
# re-opens the ledger is a different incident from one that re-opens /policy.
leaked=""
unreachable=0
for ep in ledger dossier replay standup debug/events; do
  code=$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' -m 20 "$URL/$ep" 2>/dev/null)
  case "$code" in
    401 | 403) : ;;
    # curl reports 000 when the connection never completed. Counting that as a
    # leaked route would raise a security alarm about a host that is merely
    # down — and a gate that cries wolf stops being read.
    000) unreachable=$((unreachable + 1)) ;;
    *) leaked="$leaked $ep($code)" ;;
  esac
done
if [ "$unreachable" -gt 0 ]; then
  bad "could not reach $unreachable/5 owner-only routes — authorization not verified"
elif [ -z "$leaked" ]; then
  ok "owner-only routes refuse an anonymous caller (5 checked)"
else
  bad "owner-only routes reachable without a session:$leaked"
fi

# --- 5. the deployed bundle is the one in this working tree ------------------
# Catches the single most expensive deploy mistake in this project's history:
# `git pull` without `npm run build`, which leaves the server new and the
# browser old. Skipped — not failed — when the tree has not been built, so the
# gate stays usable on a fresh clone.
served=$(curl -s -b "$JAR" -m 20 "$URL/" 2>/dev/null |
  grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1 | sed 's|assets/||')
if [ -z "$served" ]; then
  bad "could not find the JS bundle name in the served HTML"
else
  local_bundle=$(ls frontend/dist/assets/index-*.js 2>/dev/null | head -1 | xargs -r basename)

  # A mismatch means two very different things, and calling both a failure
  # would make this gate red for the whole of normal development — which is
  # how a gate stops being read.
  #
  #   - tree clean AND at the published commit  -> live should match us, so a
  #     mismatch is the "pulled without rebuilding" bug this check exists for.
  #   - anything else (dirty tree, local commits ahead) -> we are simply not
  #     deployed yet. Worth saying, not worth failing.
  shipped=0
  if [ -z "$(git status --porcelain 2>/dev/null)" ] &&
     git rev-parse --verify -q origin/dev >/dev/null 2>&1 &&
     [ "$(git rev-parse HEAD 2>/dev/null)" = "$(git rev-parse origin/dev 2>/dev/null)" ]; then
    shipped=1
  fi

  if [ -z "$local_bundle" ]; then
    ok "live serves $served"
    note "no local build to compare — run 'cd frontend && npm run build' for the binding check"
  elif [ "$served" = "$local_bundle" ]; then
    ok "live bundle matches this tree ($served)"
  elif [ "$shipped" -eq 1 ]; then
    bad "live serves $served but this tree builds $local_bundle"
    note "this tree IS the published commit, so the server was restarted without rebuilding the frontend"
  else
    ok "live serves $served; this tree builds $local_bundle"
    note "not a deploy failure — this tree is ahead of what is published"
  fi
fi

# --- 6. is anything actually being mirrored? --------------------------------
# The product's whole purpose is to reflect real activity. An office that is
# up, authenticated and empty is a failure the other five checks cannot see.
# This reports rather than fails: a quiet night is not a defect.
seen=$(curl -s -b "$JAR" -m 20 "$URL/presence" 2>/dev/null |
  grep -o '"lastSeenTs":[0-9]*' | cut -d: -f2 | sort -rn | head -1)
if [ "$FAIL" -gt 0 ] && [ -z "$seen" ]; then
  # Saying "reachable, but quiet" about a host that never answered would be the
  # gate inventing a reassurance, which is the exact failure this file exists
  # to prevent. Stay silent instead; the checks above already said what broke.
  :
elif [ -n "$seen" ]; then
  now=$(date +%s000)
  age=$(((now - seen) / 60000))
  if [ "$age" -lt 60 ]; then
    ok "activity is flowing (last agent seen ${age}m ago)"
  else
    ok "reachable, but quiet (last agent seen ${age}m ago)"
    note "no agent has reported in over an hour — check the bridges are running"
  fi
else
  ok "reachable, but no agent has ever been seen"
  note "nothing is emitting — install bridges/hermes-emit or bridges/mac-relay"
fi

echo
echo "check-live: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
