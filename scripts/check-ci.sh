#!/usr/bin/env bash
# check-ci.sh — fail if the installed workflow is missing or has drifted from
# its canonical source.
#
# Without this, .github/workflows/ci.yml can be edited directly (or vanish)
# and nothing notices. A CI definition nothing verifies is a CI definition
# that drifts — which is exactly how this repo ended up claiming, in writing
# and twice, to have a workflow it did not have.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=ci/workflow.yml
DST=.github/workflows/ci.yml

[ -f "$SRC" ] || { echo "FAIL: canonical $SRC is missing"; exit 1; }

if [ ! -f "$DST" ]; then
  echo "FAIL: $DST is not installed — run: bash scripts/install-ci.sh"
  exit 1
fi

if ! diff -q "$SRC" "$DST" >/dev/null; then
  echo "FAIL: $DST has drifted from $SRC"
  diff -u "$SRC" "$DST" || true
  echo "Edit $SRC, then run: bash scripts/install-ci.sh"
  exit 1
fi

echo "PASS: workflow matches $SRC"
