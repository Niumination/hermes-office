#!/usr/bin/env bash
# check-deployable.sh — prove nothing in shipped code points at a specific
# machine or account.
#
# The repo previously defaulted HERMES_A2A_MAC_URL to one developer's Tailscale
# IP and GITHUB_ORG to one developer's account. A fresh install would then send
# chat traffic to a host the operator did not control, and spend the operator's
# GitHub rate limit polling someone else's repositories. Neither failed loudly,
# because both looked configured.
#
# Test fixtures are allowed to contain internal-looking addresses: the guest
# sanitizer is specifically tested for stripping them, so forbidding them there
# would delete the test's reason to exist.
set -euo pipefail
cd "$(dirname "$0")/.."

status=0

# RFC 1918, loopback and the 100.64/10 CGNAT range Tailscale uses.
PRIVATE='(100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.|10\.[0-9]+\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)'

echo "— private/tailnet addresses in server, frontend and bridge code"
hits=$(grep -rnE "$PRIVATE" \
        --include='*.js' --include='*.ts' --include='*.tsx' --include='*.sh' \
        server frontend/src bridges scripts 2>/dev/null \
        | grep -v '127\.0\.0\.1' || true)
if [ -n "$hits" ]; then
  echo "$hits" | sed 's/^/  /'
  echo "FAIL: hard-coded private address in shipped code"
  status=1
else
  echo "  none"
fi

echo "— config defaults that name a specific third party"
# Any optional integration must default to empty so it is OFF until the
# operator configures it, never aimed at whoever the author happened to use.
bad=$(grep -nE '(HERMES_A2A_MAC_URL|GITHUB_ORG)[^|]*\|\|\s*"[^"]+"' server/config.js || true)
if [ -n "$bad" ]; then
  echo "$bad" | sed 's/^/  /'
  echo "FAIL: optional integration has a non-empty default"
  status=1
else
  echo "  none"
fi

[ "$status" = 0 ] && echo "PASS: nothing is bound to a specific host or account"
exit $status
