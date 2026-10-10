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

# An asset can leave this repo for exactly two reasons, and they must not look
# alike. Dropped by a pipeline = the defect this script exists to catch.
# Deleted on purpose = a decision, which belongs in the manifest with its
# reasoning, the way `corrections` already records deliberate edits.
#
# So `removals` entries are expected to be absent, and the expectation is
# symmetric: if a removed asset reappears, that is a failure too. The 150
# legacy cast sprites were deleted for IP exposure on 2026-10-10, and a file
# restored from git history would otherwise slip back in silently — it matches
# its own hash, so no other gate would notice.
missing=0
returned=0
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
gone={p for r in m.get('removals',[]) for p in r['paths']}
for a in m['assets']:
    if a['path'] not in gone: print(a['path'])
")

while IFS= read -r rel; do
  stem="${rel%.*}"
  if compgen -G "$PUBLIC/$stem".* > /dev/null; then
    echo "  RETURNED: $rel — recorded as deliberately removed, but present"
    returned=$((returned + 1))
  fi
done < <(python3 -c "
import json,sys
m=json.load(open('$MANIFEST'))
for r in m.get('removals',[]):
    for p in r['paths']: print(p)
")

total=$(python3 -c "import json;print(json.load(open('$MANIFEST'))['count'])")
gone=$(python3 -c "
import json
m=json.load(open('$MANIFEST'))
print(sum(len(r['paths']) for r in m.get('removals',[])))
")
expected=$((total - gone))

if [ "$missing" -gt 0 ] || [ "$returned" -gt 0 ]; then
  [ "$missing" -gt 0 ] && \
    echo "FAIL: $missing of $expected expected upstream assets are not present in $PUBLIC"
  [ "$returned" -gt 0 ] && \
    echo "FAIL: $returned deliberately removed asset(s) are back in $PUBLIC — see 'removals' in $MANIFEST for why they went"
  exit 1
fi
echo "PASS: all $expected expected upstream assets accounted for ($gone deliberately removed, recorded in $MANIFEST)"
