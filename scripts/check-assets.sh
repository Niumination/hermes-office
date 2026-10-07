#!/usr/bin/env bash
# check-assets.sh — prove no upstream asset was silently dropped.
#
# WHY THIS EXISTS
# ---------------
# The Fase 0 PNG->WebP pipeline dropped two room plates without a word. Nothing
# broke, because neither was referenced by code, so it went unnoticed until a
# file-by-file audit against the upstream ZIP caught it. That audit needed the
# 90 MB upstream archive on disk — and the workspace cannot hold 90 MB across
# sessions, so the check quietly stopped being runnable and the loss recurred.
#
# ASSET-MANIFEST.json is the fix: a 30 kB record of every upstream asset path.
# It persists where the archive cannot, so this check runs forever, offline,
# in CI, with no network and no archive.
#
# Extensions are ignored on purpose: the fork legitimately converts PNG to
# WebP, so matching on extension would report every converted file as missing.
# What matters is that the *asset* still exists in some form.
set -euo pipefail
cd "$(dirname "$0")/.."

MANIFEST="frontend/public/ASSET-MANIFEST.json"
PUBLIC="frontend/public"

[ -f "$MANIFEST" ] || { echo "FAIL: $MANIFEST missing"; exit 1; }

missing=0
while IFS= read -r rel; do
  stem="${rel%.*}"
  # Accept the asset under any image extension.
  if ! compgen -G "$PUBLIC/$stem".* > /dev/null; then
    echo "  MISSING: $rel"
    missing=$((missing + 1))
  fi
done < <(python3 -c "
import json,sys
m=json.load(open('$MANIFEST'))
for a in m['assets']: print(a['path'])
")

total=$(python3 -c "import json;print(json.load(open('$MANIFEST'))['count'])")
if [ "$missing" -gt 0 ]; then
  echo "FAIL: $missing of $total upstream assets are not present in $PUBLIC"
  exit 1
fi
echo "PASS: all $total upstream assets accounted for"
