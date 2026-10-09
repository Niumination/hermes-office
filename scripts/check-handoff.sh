#!/usr/bin/env bash
#
# check-handoff.sh — prove this tree is byte-identical to the one that was sent.
#
# WHY THIS EXISTS
# ---------------
# Every other gate in this repo answers "is the code right?". This one answers
# a question that comes first and is usually assumed: "did I receive what was
# sent?"
#
# That assumption broke nine times while this fork was being built. The
# workspace snapshot silently dropped directories between one command and the
# next: node_modules twice, the 36 top-level files of art/originals/sprites
# three times, .github/workflows/ci.yml twice, SPRITES.json reverted to an
# older revision once, and ~25 MB of source renders lost permanently. Nothing
# announced any of it. The gates caught the consequences; nothing caught the
# cause.
#
# A transfer between two machines is the same failure mode with more chances
# to go wrong. So the tree carries a hash of itself, and the receiving side
# can settle the question in one command before debugging anything else.
#
#   bash scripts/check-handoff.sh            # verify against MANIFEST.sha256
#   bash scripts/check-handoff.sh --write    # re-record after deliberate change
#
# Exit 0 = every file matches. Exit 1 = something arrived different, missing,
# or extra — and it says which.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
MANIFEST="MANIFEST.sha256"

# Everything a clone needs, and nothing a clone regenerates. node_modules,
# dist and data are excluded because they are outputs: hashing them would
# make the manifest fail for correct reasons, which trains people to ignore
# it — the precise failure this file exists to prevent.
list_files() {
  find . \
    -path ./node_modules -prune -o \
    -path ./frontend/node_modules -prune -o \
    -path ./.git -prune -o \
    -path ./dist -prune -o \
    -path ./frontend/dist -prune -o \
    -path ./data -prune -o \
    -path ./coverage -prune -o \
    -name '.env.office' -prune -o \
    -name '.DS_Store' -prune -o \
    -name "$MANIFEST" -prune -o \
    -type f -print | sed 's|^\./||' | LC_ALL=C sort
}

if [[ "${1:-}" == "--write" ]]; then
  # `--write` blesses whatever is on disk. That is the point, and it is also
  # the danger: this exact command recorded a SPRITES.json that had silently
  # reverted to an older 250-entry revision, and the resulting manifest then
  # certified the damaged tree as intact. An integrity tool that can be made
  # to vouch for corruption is worse than none, because it ends the
  # investigation.
  #
  # So the cheap asset gates must agree with their own manifests before this
  # one is allowed to record anything. They take milliseconds and they are
  # exactly the files that kept reverting.
  if [[ "${2:-}" != "--force" ]]; then
    for gate in check-sprites.py check-plates.py; do
      if ! out=$(python3 "scripts/$gate" 2>&1); then
        echo "REFUSING to write $MANIFEST: scripts/$gate is red."
        echo "$out" | tail -6 | sed 's/^/  /'
        echo
        echo "Recording now would certify this state as the intended one."
        echo "Fix it first, or override deliberately with:"
        echo "  bash scripts/check-handoff.sh --write --force"
        exit 1
      fi
    done
  fi
  list_files | xargs -d '\n' sha256sum > "$MANIFEST"
  echo "wrote $MANIFEST ($(wc -l < "$MANIFEST") files, $(du -sh --exclude=node_modules --exclude=.git . | cut -f1) tree)"
  exit 0
fi

if [[ ! -f "$MANIFEST" ]]; then
  echo "FAIL: no $MANIFEST — this tree cannot prove what it is."
  echo "      If you are the sender, run: bash scripts/check-handoff.sh --write"
  exit 1
fi

fail=0

# 1. Content. sha256sum reports both corruption and absence.
bad=$(sha256sum -c "$MANIFEST" --quiet 2>&1 | head -40)
if [[ -n "$bad" ]]; then
  n=$(echo "$bad" | wc -l)
  echo "FAIL: $n file(s) missing or altered since the manifest was written:"
  echo "$bad" | sed 's/^/  - /'
  fail=1
fi

# 2. Extra files. A file that arrived without being sent is as much a
#    transfer defect as one that vanished, and it is the half `sha256sum -c`
#    cannot see.
extra=$(comm -23 <(list_files) <(cut -d' ' -f3- "$MANIFEST" | LC_ALL=C sort))
if [[ -n "$extra" ]]; then
  echo "FAIL: $(echo "$extra" | wc -l) file(s) present but not in the manifest:"
  echo "$extra" | head -20 | sed 's/^/  + /'
  fail=1
fi

# 3. The counts that kept silently changing. Redundant with the hashes by
#    design: when a whole directory disappears the hash list prints hundreds
#    of lines, and the reader needs the one sentence that names the cause.
declare -A EXPECT=(
  ["art/originals/sprites|*.webp"]=100
  ["art/donghua-cast|*.webp"]=16
  ["frontend/public/sprites|*.webp"]=282
  ["frontend/public/rooms|*.webp"]=22   # 18 tema bawaan + 4 tema 宗門 di rooms/sect/
)
for key in "${!EXPECT[@]}"; do
  dir="${key%%|*}"; pat="${key##*|}"; want="${EXPECT[$key]}"
  got=$(find "$dir" -name "$pat" 2>/dev/null | wc -l)
  if [[ "$got" != "$want" ]]; then
    echo "FAIL: $dir holds $got $pat, expected $want"
    [[ "$dir" == "art/originals/sprites" ]] && echo "      (the 36 top-level files here vanished three times in one session — recover them before anything else)"
    fail=1
  fi
done

if [[ -f .github/workflows/ci.yml ]]; then :; else
  echo "FAIL: .github/workflows/ci.yml is missing — restore it with: bash scripts/install-ci.sh"
  fail=1
fi

if [[ $fail -ne 0 ]]; then
  echo
  echo "Do not debug the code until this passes. A tree that is not what it"
  echo "claims to be will fail the other gates for reasons that are not real."
  exit 1
fi

echo "PASS: $(wc -l < "$MANIFEST") files match $MANIFEST byte-for-byte; no extras; asset counts intact"
