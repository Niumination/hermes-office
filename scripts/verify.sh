#!/usr/bin/env bash
#
# verify.sh — the whole baseline, one command.
#
# This exists so that "is this branch green?" has exactly one answer produced
# exactly one way. Every number quoted in the README, the PRD and the pricing
# page is produced by something below; none of them is maintained by hand.
#
#   bash scripts/verify.sh           # everything (~6 min, includes --regen)
#   bash scripts/verify.sh --fast    # skip the two slow rebuild gates (~1 min)
#
# Exit 0 = every gate passed. Exit 1 = at least one did, and the summary says
# which. Nothing here prints a green line it did not earn: each gate's own
# exit code decides, never a grep of its output.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Run every gate the way the runner will run it.
#
# GitHub Actions sets CI=true, and that one variable changes what the tools
# underneath print: picocolors — which vitest ships — switches ANSI on when
# CI is set, with no terminal attached. A gate that parses a runner's output
# therefore behaved differently here than there. The doc-claims gate was
# green on every developer machine and red on the runner, which is the only
# place the answer counted, and this script reported the wrong answer with
# complete confidence. Exporting CI here makes "green locally" and "green in
# CI" answers to the same question. An outer CI value wins, so the runner
# stays authoritative over this line.
export CI="${CI:-true}"

FAST=0
[[ "${1:-}" == "--fast" ]] && FAST=1

pass=(); fail=()

# Run a gate, record the verdict from its exit status alone.
#
# An earlier version of this summary decided pass/fail by grepping for the
# word PASS. It reported "lint bersih" over two real eslint errors, because
# `tail` exits 0 whatever it prints. Exit codes are the only honest signal a
# program gives you; parsing its prose is how you build a dashboard that
# lies.
gate() {
  local name="$1"; shift
  printf '  %-26s ' "$name"
  local out
  if out=$("$@" 2>&1); then
    echo "PASS"
    pass+=("$name")
  else
    echo "FAIL"
    fail+=("$name")
    echo "$out" | tail -12 | sed 's/^/      /'
  fi
}

echo "=== install ==="
if [[ ! -d node_modules ]]; then npm ci --silent || exit 1; fi
if [[ ! -d frontend/node_modules ]]; then (cd frontend && npm ci --silent) || exit 1; fi
if [[ ! -f .github/workflows/ci.yml ]]; then bash scripts/install-ci.sh >/dev/null; fi
echo "  deps ready"

echo
echo "=== gates ==="
# Integrity first: if the tree is not what it claims to be, every failure
# below is suspect and chasing them wastes the afternoon.
gate "handoff integrity"   bash scripts/check-handoff.sh
gate "eslint"              npx eslint server tests
gate "frontend build"      bash -c 'cd frontend && npm run build'
gate "backend tests"       bash -c 'node --test tests/*.test.js'
gate "frontend tests"      bash -c 'cd frontend && npx vitest run'
gate "clean shutdown"      bash scripts/check-shutdown.sh
gate "upstream assets"     bash scripts/check-assets.sh
gate "ci workflow"         bash scripts/check-ci.sh
gate "dependency pins"     bash scripts/check-pins.sh
gate "deployable"          bash scripts/check-deployable.sh
gate "room plates"         python3 scripts/check-plates.py
gate "doc claims"          python3 scripts/check-docs.py
if [[ $FAST -eq 1 ]]; then
  gate "sprites (hash only)" python3 scripts/check-sprites.py
  echo "  (--fast: skipped the byte-exact sprite rebuild)"
else
  gate "sprites (+rebuild)"  python3 scripts/check-sprites.py --regen
fi

echo
if [[ ${#fail[@]} -eq 0 ]]; then
  echo "PASS: ${#pass[@]}/${#pass[@]} gates green"
  exit 0
fi
echo "FAIL: ${#fail[@]} of $(( ${#pass[@]} + ${#fail[@]} )) gates red — ${fail[*]}"
exit 1
