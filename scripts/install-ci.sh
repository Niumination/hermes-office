#!/usr/bin/env bash
# install-ci.sh — put the canonical workflow where GitHub Actions looks for it.
#
# The canonical copy lives at ci/workflow.yml because this workspace does not
# persist dot-directories; see the header of that file. Run this after a fresh
# clone or whenever check-ci.sh reports drift.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .github/workflows
cp ci/workflow.yml .github/workflows/ci.yml
echo "installed ci/workflow.yml -> .github/workflows/ci.yml"
