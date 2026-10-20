#!/usr/bin/env bash
#
# verify.sh — the whole baseline, one command.
#
# This exists so that "is this branch green?" has exactly one answer produced
# exactly one way. Every number quoted in the README, the PRD and the other
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

# Runtime first, before a single dependency is installed.
#
# This script is the one command a buyer is invited to run, so its worst
# possible behaviour is to fail in a way that looks like the product is
# broken. On Node 20 it did exactly that: better-sqlite3 13 is a native addon
# built against a newer ABI, the backend suite died with SIGSEGV, and the run
# printed 56 failing tests and five red gates. Nothing was wrong with the
# repo — the runtime was simply one the repo no longer supports — but nobody
# reading that output would have believed it.
#
# The supported floor is read from package.json rather than written here, so
# this check cannot drift away from `engines`.
need=$(node -p "require('./package.json').engines.node.replace(/[^0-9.]/g,'').split('.')[0]" 2>/dev/null || echo "")
have=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo "")
if [[ -n "$need" && -n "$have" && "$have" -lt "$need" ]]; then
  echo "FAIL: this repo requires Node >= $need; you are running $(node -v)."
  echo
  echo "  Nothing below would be trustworthy on this runtime. better-sqlite3 is"
  echo "  a native addon and the backend suite crashes rather than fails, which"
  echo "  reads like broken code instead of a wrong Node."
  echo
  echo "  Install Node $need or newer, then re-run: npm run verify"
  exit 1
fi

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
gate "ledger under load"   node scripts/bench-ledger.mjs --check
gate "upstream assets"     bash scripts/check-assets.sh
gate "ci workflow"         bash scripts/check-ci.sh
gate "dependency pins"     bash scripts/check-pins.sh
gate "sbom"                python3 scripts/make-sbom.py --check
gate "deployable"          bash scripts/check-deployable.sh
gate "dev server routes"   bash scripts/check-dev-server.sh
gate "room plates"         python3 scripts/check-plates.py
gate "theme contrast"      python3 scripts/check-contrast.py
gate "doc claims"          python3 scripts/check-docs.py
if [[ $FAST -eq 1 ]]; then
  gate "sprites (hash only)" python3 scripts/check-sprites.py
  echo "  (--fast: skipped the byte-exact sprite rebuild)"
else
  gate "sprites (+rebuild)"  python3 scripts/check-sprites.py --regen
fi

# The only gate that leaves the repository. Everything above proves the tree is
# self-consistent; this one asks the running site whether any of that reached a
# user. Set SKIP_LIVE=1 to work offline.
#
# Keep this list at one. The failure this project actually suffered was an
# apparatus growing faster than the product, so a second live gate should
# replace a question here rather than be appended to it.
gate "live site"           bash scripts/check-live.sh

echo
# The report is written on every full run, pass or fail. A report that only
# appears when everything is green is a marketing asset, not evidence: the
# absence of a red report is indistinguishable from nobody having run the
# suite, which is the ambiguity this file exists to remove.
#
# --fast runs are deliberately NOT recorded. They skip the byte-exact sprite
# rebuild, so recording them would let a weaker run overwrite the evidence of
# a stronger one.
if [[ $FAST -eq 0 ]]; then
  REPORT=handoff/VERIFY-REPORT.json
  bundle_js=$(ls -1 frontend/dist/assets/index-*.js 2>/dev/null | head -1)
  PASS_LIST="${pass[*]:-}" FAIL_LIST="${fail[*]:-}" BUNDLE="${bundle_js##*/}" \
  python3 - "$REPORT" <<'PY'
import hashlib, json, os, subprocess, sys, datetime

out = sys.argv[1]
passed = [g for g in os.environ.get("PASS_LIST", "").split() if g]
failed = [g for g in os.environ.get("FAIL_LIST", "").split() if g]
# Gate names contain spaces, so a space-split loses them. Recover by matching
# against verify.sh's own invocation list rather than guessing.
names = []
for line in open("scripts/verify.sh", encoding="utf-8"):
    line = line.strip()
    if line.startswith('gate "'):
        names.append(line.split('"')[1])
joined_pass = " ".join(passed)
gates = []
for n in names:
    if n in joined_pass:
        gates.append({"gate": n, "ok": True})
    elif n in " ".join(failed):
        gates.append({"gate": n, "ok": False})

def git(*a):
    try:
        return subprocess.run(["git", *a], capture_output=True, text=True,
                              timeout=10).stdout.strip() or None
    except Exception:
        return None

bundle = os.environ.get("BUNDLE") or None
bundle_sha = None
if bundle:
    p = os.path.join("frontend", "dist", "assets", bundle)
    if os.path.exists(p):
        bundle_sha = hashlib.sha256(open(p, "rb").read()).hexdigest()

doc = {
    "generatedAt": datetime.datetime.now(datetime.timezone.utc)
                   .replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    "commit": git("rev-parse", "HEAD"),
    "branch": git("rev-parse", "--abbrev-ref", "HEAD"),
    "dirty": bool(git("status", "--porcelain")),
    "gates": gates,
    "gatesGreen": sum(1 for g in gates if g["ok"]),
    "gatesTotal": len(gates),
    # The bundle fingerprint is the point of this file. A server can compare it
    # against what it is actually serving and prove the deployed build is the
    # verified build — the failure we hit for weeks, where a live instance
    # served an older bundle and nothing in the product could say so.
    "bundle": {"file": bundle, "sha256": bundle_sha},
}
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w", encoding="utf-8") as fh:
    json.dump(doc, fh, indent=2)
    fh.write("\n")
print(f"  wrote {out} ({doc['gatesGreen']}/{doc['gatesTotal']} gates, "
       f"bundle {(bundle or 'none')})")
PY
fi

echo
if [[ ${#fail[@]} -eq 0 ]]; then
  echo "PASS: ${#pass[@]}/${#pass[@]} gates green"
  exit 0
fi
echo "FAIL: ${#fail[@]} of $(( ${#pass[@]} + ${#fail[@]} )) gates red — ${fail[*]}"
exit 1
