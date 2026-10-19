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

# Every request below carries this. A browser loading this site sends an Origin
# header on the page's own assets, because Vite stamps `crossorigin` on the
# module script and the stylesheet. curl does not, and that one missing header
# is how this gate reported 8/8 green over a site that rendered a blank page:
# the origin allowlist answered 403 to the browser and 200 to us. A live gate
# that does not send what a browser sends is not checking the product.
OH="Origin: $URL"
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
code=$(curl -s -H "$OH" -o "$BODY" -w '%{http_code}' -m 20 "$URL/health" 2>/dev/null)
if [ "$code" = "200" ] && grep -q '"status"' "$BODY" 2>/dev/null; then
  up=$(grep -o '"uptimeS":[0-9]*' "$BODY" | cut -d: -f2)
  ok "/health answers 200 (uptime ${up:-?}s)"
else
  bad "/health answered '$code'"
  note "$(head -c 160 "$BODY" 2>/dev/null)"
fi

# --- 2. the door is served, and it hands the visitor in ----------------------
# The office is strictly private at the network boundary (UFW tailnet-only +
# Cloudflare tunnel), so GET / hands an unauthenticated browser an owner
# session cookie: the page then reaches WS and every data route without a
# login form or token. A 200 + cookie is the expected, healthy state here;
# a 200 WITHOUT a cookie means the auto-session regressed and the owner's
# browser would sit at "LURING" forever, so that is the failure we guard.
code=$(curl -s -H "$OH" -c "$JAR" -o "$BODY" -w '%{http_code}' -m 20 "$URL/" 2>/dev/null)
if [ "$code" != "200" ]; then
  bad "GET / returned '$code' — the office shell must be reachable"
elif grep -q 'office_session' "$JAR" 2>/dev/null; then
  ok "GET / serves the shell and hands the visitor in (owner session)"
else
  bad "GET / returned no session cookie — the auto-session regressed; the owner's browser would be locked out"
fi

# --- 3. data is reachable through the session the door minted ---------------
# The office is a single trusted network, not a public API: once the browser
# holds the owner session minted in section 2, /policy, /roster and /presence
# answer 200 with real data. What we check here is the flip side:
# (a) WITH that session the three data routes return 200 (the office works
#     end-to-end for the owner), and
# (b) WITHOUT any session at all they still return 401 (a stranger who never
#     got a cookie — e.g. an API client, or the tunnel health-checker — gets
#     nothing). This second check is the real gate: it proves the token
#     boundary is still intact even though the browser door is open.
for ep in policy roster presence; do
  withjar=$(curl -s -H "$OH" -b "$JAR" -o "$BODY" -w '%{http_code}' -m 20 "$URL/$ep" 2>/dev/null)
  case "$withjar" in
    200) ok "/$ep answers the owner session with live data" ;;
    401) bad "/$ep refused the owner session — check OFFICE_OWNER_TOKEN in .env.office" ;;
    000) bad "/$ep unreachable — authorization not verified" ;;
    *) bad "/$ep answered '$withjar' to the owner session (expected 200)" ;;
  esac
  anon=$(curl -s -H "$OH" -o /dev/null -w '%{http_code}' -m 20 "$URL/$ep" 2>/dev/null)
  case "$anon" in
    401) : ;;
    *) bad "/$ep answered '$anon' to a caller with no session (expected 401)" ;;
  esac
done

# --- 4. owner-only data is still owner-only ---------------------------------
# A live assertion, not a repo one: this is the check that notices if a deploy
# ever ships with the guards misconfigured. With one principal these answer
# the same 401 as section 3; they are kept separate because a regression that
# re-opens the ledger is a different incident from one that re-opens /policy.
leaked=""
leaked_owner=""
unreachable=0
for ep in ledger dossier replay standup debug/events; do
  # With the owner session the routes must answer 200.
  code=$(curl -s -H "$OH" -b "$JAR" -o "$BODY" -w '%{http_code}' -m 20 "$URL/$ep" 2>/dev/null)
  case "$code" in
    200) : ;;
    000) unreachable=$((unreachable + 1)) ;;
    *) leaked_owner="$leaked_owner $ep($code)" ;;
  esac
  # Without any session they must still refuse: this is the real gate —
  # a stranger who never received a cookie gets nothing, even though the
  # browser door is open to the trusted network.
  anon=$(curl -s -H "$OH" -o /dev/null -w '%{http_code}' -m 20 "$URL/$ep" 2>/dev/null)
  case "$anon" in
    401 | 403) : ;;
    *) leaked="$leaked $ep($anon)" ;;
  esac
done
[ -n "$leaked_owner" ] && bad "owner-only routes refused the owner session:$leaked_owner"
[ "$unreachable" -gt 0 ] && bad "could not reach $unreachable/5 owner-only routes — unreachable"
if [ -z "$leaked" ]; then
  ok "owner-only routes refuse a caller with no session (5 checked)"
else
  bad "owner-only routes reachable without a session:$leaked"
fi

# --- 5. the deployed bundle is the one in this working tree ------------------
# Catches the single most expensive deploy mistake in this project's history:
# `git pull` without `npm run build`, which leaves the server new and the
# browser old. Skipped — not failed — when the tree has not been built, so the
# gate stays usable on a fresh clone.
served=$(curl -s -H "$OH" -b "$JAR" -m 20 "$URL/" 2>/dev/null |
  grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1 | sed 's|assets/||')
if [ -z "$served" ]; then
  bad "could not find the JS bundle name in the served HTML"
else
  # Reading the name out of the HTML only proves the HTML is right. The bug
  # this gate missed lived one request later: the <script> tag was perfect and
  # the file behind it answered 403, so the page stayed empty. Ask for the
  # asset the way the browser asks for it.
  acode=$(curl -s -H "$OH" -o /dev/null -w '%{http_code}' -m 20 "$URL/assets/$served" 2>/dev/null)
  if [ "$acode" = "200" ]; then
    ok "the browser can actually fetch $served"
  else
    bad "the JS bundle answered '$acode' to a browser-shaped request"
    note "the shell links it, but nothing can load it — the page renders empty"
    note "most likely the origin allowlist is refusing this host's own origin"
  fi

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
# /presence is owner-only (guest sessions cut at 9c894ba), so the anonymous
# jar from section 2 gets a 401 and this section would read "empty" forever.
# Read it with a token when one is supplied; without one, fall back to the
# anonymous answer — the honest "can't check".
LIVE_TOKEN="${OFFICE_LIVE_TOKEN:-}"
if [ -n "$LIVE_TOKEN" ]; then
  seen=$(curl -s -H "$OH" -H "Authorization: Bearer $LIVE_TOKEN" -m 20 "$URL/presence" 2>/dev/null |
    grep -o '"lastSeenTs":[0-9]*' | cut -d: -f2 | sort -rn | head -1)
else
  seen=$(curl -s -H "$OH" -b "$JAR" -m 20 "$URL/presence" 2>/dev/null |
    grep -o '"lastSeenTs":[0-9]*' | cut -d: -f2 | sort -rn | head -1)
fi
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
  if [ -n "$LIVE_TOKEN" ]; then
    ok "reachable, but no agent has ever been seen"
    note "nothing is emitting — install bridges/hermes-emit or bridges/mac-relay"
  else
    ok "reachable; presence not checked (no OFFICE_LIVE_TOKEN)"
    note "set OFFICE_LIVE_TOKEN=<owner|cloud|mac token> to read /presence in this gate"
  fi
fi

echo
echo "check-live: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
