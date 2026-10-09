#!/usr/bin/env bash
# Gate: nothing this repo installs is allowed to float, and Dependabot has to
# actually cover every ecosystem that exists.
#
# Four of this repo's supply-chain defects were the same shape — something
# pinned, then forgotten — and none of them were caught by a gate. Dependabot
# (added in patch 006) watches for new versions; this watches that the pinning
# discipline and Dependabot's coverage do not quietly drift apart.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
note() { echo "  $1"; fail=1; }

# 1. No inline pip pins. They are invisible to Dependabot.
inline=$(grep -nE '^\s*run:.*pip install' ci/workflow.yml | grep -v -- '-r requirements' || true)
if [ -n "$inline" ]; then
  note "ci/workflow.yml installs pip packages inline instead of via a requirements file:"
  echo "$inline" | sed 's/^/      /'
fi

# 2. Every requirement is pinned with ==, not >= or ~= or bare.
for f in requirements-ci.txt requirements-dev.txt; do
  [ -f "$f" ] || { note "$f is missing"; continue; }
  loose=$(grep -vE '^\s*(#|$|-r )' "$f" | grep -vE '==' || true)
  [ -n "$loose" ] && note "$f has unpinned entries: $(echo "$loose" | tr '\n' ' ')"
done

# 3. No floating npm versions.
for f in package.json frontend/package.json; do
  loose=$(node -e '
    const p = require("./'"$f"'");
    const bad = [];
    for (const k of ["dependencies", "devDependencies"])
      for (const [n, v] of Object.entries(p[k] || {}))
        if (/^(\*|latest|)$/.test(v) || /^https?:/.test(v)) bad.push(n + "@" + v);
    process.stdout.write(bad.join(" "));
  ')
  [ -n "$loose" ] && note "$f has floating versions: $loose"
done

# 4. Dependabot covers every ecosystem that is actually present.
db=.github/dependabot.yml
if [ ! -f "$db" ]; then
  note "$db is missing — nothing is watching for new versions"
else
  want=""
  [ -f package.json ]           && want="$want npm:/"
  [ -f frontend/package.json ]  && want="$want npm:/frontend"
  [ -d .github/workflows ]      && want="$want github-actions:/"
  ls requirements*.txt >/dev/null 2>&1 && want="$want pip:/"
  have=$(python3 - "$db" <<'PY'
import sys, re
t = open(sys.argv[1]).read()
blocks = re.findall(r'-\s*package-ecosystem:\s*["\']?([\w-]+)["\']?(.*?)(?=\n\s*-\s*package-ecosystem:|\Z)',
                    t, re.S)
for eco, body in blocks:
    m = re.search(r'directory:\s*["\']?([^"\'\n]+)', body)
    print(f"{eco}:{(m.group(1) if m else '?').strip()}")
PY
)
  for w in $want; do
    echo "$have" | grep -qx "$w" || note "dependabot.yml does not cover $w"
  done
fi

if [ "$fail" -eq 0 ]; then
  echo "PASS: every dependency is pinned and Dependabot covers every ecosystem present"
  exit 0
fi
echo "FAIL: dependency pinning or Dependabot coverage has drifted"
exit 1
