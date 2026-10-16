#!/usr/bin/env bash
# check-dev-server.sh — prove `npm run dev` actually serves the app.
#
# WHY THIS EXISTS
# ---------------
# Every other gate inspects files at rest. Not one of them starts the dev
# server, and that blind spot has now cost us twice:
#
#   1. /kiosk stopped being proxied, so no guest session was ever minted in
#      development. 16/16 green for weeks (entri LOG 018).
#   2. /desks was nearly shipped without a proxy entry. A route missing from
#      HTTP_ROUTES does not error — Vite quietly answers with index.html, the
#      SPA shell, status 200. The frontend then parses HTML as JSON and shows
#      an empty panel. Nothing anywhere turns red.
#
# That second failure mode is the dangerous one, because "200 OK" looks like
# success to anything that only checks status codes. This gate checks what the
# body actually is.
#
# WHAT IT DOES NOT DO
# -------------------
# It does not render. Catching "the layout collapsed" or "a component threw"
# needs a real browser, which means a ~300 MB download in CI. This gate
# deliberately stops short of that and buys the cheap 80%: the server boots,
# the proxy table is complete, and the two cookie-minting routes still mint.
# If a rendering gate is ever added it should sit next to this one, not
# replace it.
set -uo pipefail
cd "$(dirname "$0")/.."

# Ports are asked for, not assumed. Fixed ports make this gate fail for a
# reason that has nothing to do with the app — a leftover process, another
# checkout, a developer's own `npm run dev` — and a gate that cries wolf is
# a gate people start skipping.
free_port() { python3 -c "
import socket
s = socket.socket(); s.bind(('127.0.0.1', 0))
print(s.getsockname()[1]); s.close()"; }
API_PORT=${CHECK_DEV_API_PORT:-$(free_port)}
WEB_PORT=${CHECK_DEV_WEB_PORT:-$(free_port)}
TMP=$(mktemp -d)
API_PID=""
WEB_PID=""

cleanup() {
  [ -n "$WEB_PID" ] && kill "$WEB_PID" 2>/dev/null
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null
  wait 2>/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT

fail() { echo "FAIL: $*"; exit 1; }

# Tokens come from the environment with throwaway fallbacks, the same shape
# check-shutdown.sh uses. Requiring a real .env.office would make this gate
# unrunnable in CI, and a gate that only runs on one laptop is not a gate.
export OFFICE_CLOUD_TOKEN="${OFFICE_CLOUD_TOKEN:-ci-cloud-token-000000000000}"
export OFFICE_MAC_TOKEN="${OFFICE_MAC_TOKEN:-ci-mac-token-0000000000000}"
export OFFICE_OWNER_TOKEN="${OFFICE_OWNER_TOKEN:-ci-owner-token-00000000000}"
export OFFICE_GUEST_TOKEN="${OFFICE_GUEST_TOKEN:-ci-guest-token-00000000000}"
export OFFICE_DB="${OFFICE_DB:-$TMP/office.db}"

# Reading the route list out of vite.config.ts is necessary but NOT sufficient,
# and the difference is the whole point of this gate.
#
# A first version of this script checked only the routes vite.config.ts
# declares. Deleting `/desks` from that list made the gate pass — it simply
# stopped checking the route it no longer knew about. That is the original bug
# wearing a gate as a disguise: the config is the thing under suspicion, so it
# cannot also be the source of truth.
#
# So the expectation comes from the server, and the config is what gets
# audited against it.
mapfile -t ROUTES < <(python3 - <<'PY'
import re
src = open("frontend/vite.config.ts", encoding="utf-8").read()
block = re.search(r"const HTTP_ROUTES\s*=\s*\[(.*?)\]", src, re.S)
if not block:
    raise SystemExit("could not find HTTP_ROUTES in frontend/vite.config.ts")
body = re.sub(r"//[^\n]*", "", block.group(1))
for path in re.findall(r"'([^']+)'", body):
    print(path)
PY
)
[ "${#ROUTES[@]}" -gt 0 ] || fail "HTTP_ROUTES came back empty — the parser or the config changed shape"

# Every top-level prefix the backend actually registers must be covered by
# some entry in HTTP_ROUTES. This is the check that catches a new route
# shipped without a proxy entry — the /desks near-miss and the /kiosk
# regression are both exactly this shape.
mapfile -t UNPROXIED < <(python3 - <<'PY'
import re
src = open("server/index.js", encoding="utf-8").read()
cfg = open("frontend/vite.config.ts", encoding="utf-8").read()
block = re.search(r"const HTTP_ROUTES\s*=\s*\[(.*?)\]", cfg, re.S).group(1)
declared = set(re.findall(r"'([^']+)'", re.sub(r"//[^\n]*", "", block)))

# "/" is served by Vite itself in development and must not be proxied; that is
# why /kiosk exists at all. Everything else the server answers should reach it.
registered = {"/" + m.split("/")[1]
              for m in re.findall(r'app\.(?:get|post|put|delete|use)\("(/[^"]*)"', src)
              if m != "/"}
for prefix in sorted(registered):
    if not any(prefix == d or prefix.startswith(d.rstrip("/") + "/") for d in declared):
        print(prefix)
PY
)
if [ "${#UNPROXIED[@]}" -gt 0 ] && [ -n "${UNPROXIED[0]:-}" ]; then
  echo "FAIL: ${#UNPROXIED[@]} backend route prefix(es) are not in HTTP_ROUTES"
  printf '  - %s is registered in server/index.js but never proxied, so it 404s under `npm run dev`\n' "${UNPROXIED[@]}"
  echo "Add them to HTTP_ROUTES in frontend/vite.config.ts."
  exit 1
fi

OFFICE_PORT=$API_PORT node server/index.js >"$TMP/api.log" 2>&1 &
API_PID=$!
# Must run inside frontend/: from the repo root `npx` finds no local vite and
# downloads a different major version from the network, which is both
# non-deterministic and not the version this app is built with.
[ -x frontend/node_modules/.bin/vite ] || \
  fail "frontend/node_modules/.bin/vite is missing — run: cd frontend && npm ci"
# --host 127.0.0.1 is not cosmetic: left to itself Vite binds ::1 only, and
# every probe below would get connection-refused on IPv4 while the log
# cheerfully says "ready".
( cd frontend && OFFICE_PORT=$API_PORT exec ./node_modules/.bin/vite \
    --port "$WEB_PORT" --strictPort --host 127.0.0.1 ) >"$TMP/web.log" 2>&1 &
WEB_PID=$!

wait_for() { # url, label
  for _ in $(seq 1 60); do
    curl -fsS -o /dev/null "$1" 2>/dev/null && return 0
    kill -0 "$3" 2>/dev/null || { echo "--- $2 log ---"; cat "$4"; fail "$2 exited during startup"; }
    sleep 0.5
  done
  echo "--- $2 log ---"; cat "$4"
  fail "$2 never became ready at $1"
}
wait_for "http://127.0.0.1:$API_PORT/health" "backend" "$API_PID" "$TMP/api.log"
wait_for "http://127.0.0.1:$WEB_PORT/"       "vite"    "$WEB_PID" "$TMP/web.log"

problems=()

# 1. The proxy actually reaches the backend. If this fails every other check
#    below would fail too, for a reason that is not about routing.
got=$(curl -fsS "http://127.0.0.1:$WEB_PORT/health" || true)
case "$got" in
  *'"status"'*) ;;
  *) problems+=("GET /health through Vite did not return the backend's JSON (got: ${got:0:80})") ;;
esac

# 2. Every declared route is proxied. The tell for a missing entry is not a
#    status code — it is Vite answering with the SPA shell.
#    The discriminator is `@vite/client`, and only that. `<div id="root">` is
#    useless here: the backend serves the *built* index.html as its own SPA
#    fallback, so a correctly proxied route answers with that div too. Only
#    the dev server injects the client script, so its presence means the
#    request never left Vite.
for route in "${ROUTES[@]}"; do
  body=$(curl -s -m 10 "http://127.0.0.1:$WEB_PORT$route" 2>/dev/null || true)
  case "$body" in
    *'@vite/client'*)
      problems+=("$route was answered by Vite's own dev shell — it is missing from HTTP_ROUTES in frontend/vite.config.ts, so it never reaches the API in development") ;;
  esac
done

# 3. /kiosk still mints an auto-guest cookie. This is the exact regression of
#    entri LOG 018: it resolved, looked fine, and handed back no session.
#
#    Only /kiosk is checked, not /. In development `/` is Vite's own shell and
#    never touches the backend, which is precisely why /kiosk had to exist. A
#    gate asserting that `/` mints a cookie in dev would be asserting a bug.
hdrs=$(curl -s -m 10 -D - -o /dev/null "http://127.0.0.1:$WEB_PORT/kiosk" 2>/dev/null || true)
case "$hdrs" in
  *office_session*) ;;
  *) problems+=("GET /kiosk minted no office_session cookie — guests cannot enter in development") ;;
esac

if [ "${#problems[@]}" -gt 0 ]; then
  echo "FAIL: ${#problems[@]} dev-server problem(s)"
  printf '  - %s\n' "${problems[@]}"
  exit 1
fi

echo "PASS: dev server boots, all ${#ROUTES[@]} declared routes reach the API, and /kiosk mints a guest session"
