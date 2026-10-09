#!/usr/bin/env python3
"""
check-docs.py — verify that the docs describe the repo that exists.

Covers ARCHITECTURE.md, PRD.md, UI-SPEC.md, AGENTS.md, HANDOFF.md,
README.md and docs/PRICING.md.

WHY THIS EXISTS
---------------
This project's most persistent defect has not been in the code. It has been
documentation that outran reality, and then "corrections" that were themselves
wrong:

  - The CHANGELOG claimed a CI workflow with three jobs. There was no
    .github/ directory. The first correction said the file was fictional; the
    second said it was never created. Both were wrong — it had been written
    twice and the directory did not survive. Three explanations before the
    true one.
  - The README described a GitHub poller watching "org Niumination (128
    repos)". Niumination is a User, not an Organization, so the endpoint it
    polled could never return 200.
  - A WebP conversion silently dropped two room plates. Nothing referenced
    them, so nothing noticed — twice.

The pattern is the same every time: a claim that nothing executes. Prose is
not type-checked, so it rots silently while the tests stay green.

This script executes the claims. It is deliberately narrow — it checks only
assertions that can be mechanically derived from the source, because a doc
checker that needs maintenance is one more thing that rots. Narrative text is
left alone; numbers and route tables are not.

PRD.md and UI-SPEC.md were added to this checker in Fase 10. Before that
they sat outside it and rotted exactly as predicted: both still described
a pixel-art personal tool drawn to a canvas, with a SQLite events table
and an /api/agents route that were never built. Being outside the checker
is what let them do that quietly.

Exit 0 = every checked claim matches. Exit 1 = a doc lies.
"""
import glob
import json
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOC = os.path.join(ROOT, "docs", "ARCHITECTURE.md")

failures: list[str] = []
checks = 0



# --- reading a child process's prose safely -----------------------------
#
# Three checks below run a test runner and parse its output. Colour breaks
# that parse, and colour is not the child's decision: picocolors, which
# vitest ships, turns ANSI on whenever CI is set, with no terminal attached:
#
#     !(NO_COLOR || --no-color) && (FORCE_COLOR || --color || win32 ||
#                                   (isTTY && TERM != "dumb") || !!env.CI)
#
# So this checker passed on every developer machine and could not pass on
# any CI runner. "Tests  129 passed" arrived wrapped in escape sequences,
# the count regex missed, and the gate reported "could not read the runner"
# -- which reads like a broken environment, not a broken parser. It was red
# on its first and only CI run for exactly this reason.
#
# Two defences, because either alone is one tool away from failing again:
#   1. ask the child not to colour. NO_COLOR is honoured and FORCE_COLOR is
#      REMOVED rather than set to "0" -- picocolors tests that variable for
#      truthiness, and the string "0" is truthy in JavaScript, so
#      FORCE_COLOR=0 would switch colour ON.
#   2. strip ANSI from what comes back regardless, so a tool that ignores
#      NO_COLOR cannot reintroduce the bug.
_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")


def _plain(s: str) -> str:
    """Drop ANSI escape sequences so a regex can read the text underneath."""
    return _ANSI_RE.sub("", s)


def _run(cmd, cwd, timeout=None):
    """Run a child whose output we intend to parse.

    Returns (stdout, stderr), both already stripped of colour.
    """
    env = dict(os.environ)
    env["NO_COLOR"] = "1"
    env.pop("FORCE_COLOR", None)
    out = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True,
                         env=env, timeout=timeout)
    return _plain(out.stdout), _plain(out.stderr)





def _abi_hint(blob: str) -> str:
    """Tell the truth when the runtime, not the code, is what broke.

    better-sqlite3 is a native addon. Install under one Node and run under
    another and every suite that opens the ledger dies in dlopen -- about a
    third of this repo. The count alone then says "100 failing tests, fix
    the tests", which sends a buyer to debug code that is fine. This repo
    supports Node 20, 22 and 24 precisely so people will switch between
    them, which makes this a routine mistake, not an exotic one.
    """
    if "ERR_DLOPEN_FAILED" not in blob and "NODE_MODULE_VERSION" not in blob:
        return "fix the tests, not the README"
    m = re.search(r"NODE_MODULE_VERSION (\d+)\.\s*This version of Node\.js "
                  r"requires\s*NODE_MODULE_VERSION (\d+)", blob)
    detail = ""
    if m:
        abi = {"115": "20", "127": "22", "137": "24"}
        built, want = m.group(1), m.group(2)
        detail = (" (addon built for Node %s, running Node %s)"
                  % (abi.get(built, "ABI " + built), abi.get(want, "ABI " + want)))
    return ("the tests are fine — a native addon was built against a "
            "different Node version%s. Run `npm rebuild` (or reinstall) "
            "with the Node you are testing on" % detail)


def _keep_evidence(name: str, blob: str) -> str:
    """Write the runner output to disk when a suite fails.

    An intermittent failure that leaves no trace cannot be fixed. This
    checker once reported 100 failing backend tests on a tree where the
    same command passed 305/305 twenty times in a row; by the time anyone
    re-ran it, the output was gone. Now the evidence outlives the run.

    Best effort on purpose: if the file cannot be written, the failure
    being reported is still the important one, so the inability to save a
    log must never replace it.
    """
    try:
        path = os.path.join(tempfile.gettempdir(),
                            "check-docs-%s-failure.log" % name)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(blob)
        return "; full runner output saved to %s" % path
    except OSError:
        return ""


def _which_failed(blob: str, limit: int = 8) -> str:
    """Name the tests that failed, not just how many.

    This exists because of a real incident: a run of this checker reported
    "100 failing test(s)" while `node --test tests/*.test.js` passed 305/305
    standalone, 20 times in a row and under 4x CPU load. The count alone
    made the event undiagnosable -- by the time anyone looked, the evidence
    was gone. A count is a smoke alarm; this is the bit that says which room.

    TAP and the spec reporter are both handled, because the runtime matrix
    spans Node 20/22 (TAP) and 24 (spec).
    """
    names = re.findall(r"^not ok \d+ - (.+?)\s*$", blob, re.M)
    if not names:
        names = re.findall(r"^\s*\u2716 (.+?)(?:\s*\(|$)", blob, re.M)
    if not names:
        return " (no failing test names found in the runner output)"
    shown = names[:limit]
    more = "" if len(names) <= limit else f", and {len(names) - limit} more"
    return "; failed: " + ", ".join(shown) + more


def _backend_counts():
    """Ask node's test runner for its counts in a format it promises to keep.

    `--test-reporter=tap` is explicit on purpose. Node's DEFAULT reporter is
    not stable across releases: a non-TTY run prints TAP on 20 and 22
    ("# tests 305") and the spec reporter on 24 ("i tests 305"). A checker
    that reads whatever the default happens to be passes on the version you
    run today and fails on the next LTS, reporting "could not read the
    runner" instead of naming the real problem. Asking for a named reporter
    makes the format part of the request rather than a coincidence.

    Returns (blob, total, passed, failed); any count may be None if the
    runner could not be read at all.
    """
    so, se = _run(["node", "--test", "--test-reporter=tap", *_test_files()],
                  ROOT, timeout=900)
    blob = so + se

    def num(key):
        m = re.search(r"^# %s (\d+)$" % key, blob, re.M)
        return m.group(1) if m else None

    return blob, num("tests"), num("pass"), num("fail")


def _frontend_counts(fe):
    """Ask vitest for JSON instead of for a sentence.

    The prose this used to scrape is already gone in the version the
    security upgrade needs: `--reporter=basic` was deprecated in Vitest 2
    and removed in Vitest 3. JSON is the runner's machine contract, so it
    survives both the upgrade and whatever the console formatter does next.

    Returns (blob, total, passed, failed), counts as strings or None.
    """
    with tempfile.TemporaryDirectory(prefix="vitest-json-") as tmp:
        out = os.path.join(tmp, "report.json")
        so, se = _run(["npx", "vitest", "run", "--reporter=json",
                       "--outputFile=" + out], fe, timeout=900)
        blob = so + se
        try:
            with open(out, encoding="utf-8") as fh:
                d = json.load(fh)
        except (OSError, ValueError):
            return blob, None, None, None
    total = d.get("numTotalTests")
    failed = d.get("numFailedTests")
    passed = d.get("numPassedTests")
    if passed is None and total is not None and failed is not None:
        passed = total - failed
    fmt = lambda v: None if v is None else str(v)
    return blob, fmt(total), fmt(passed), fmt(failed)


def _self_test_parsers() -> None:
    """Prove the output parsers survive colour before trusting their silence.

    This is not a documentation claim and is deliberately not counted as one.
    It is the regression guard for the defect above: the failure mode was a
    checker that could not read its own runner and blamed the environment,
    so the coloured case is asserted on every run rather than assumed.
    """
    tap = "\x1b[32m# tests 305\x1b[39m\n# pass 305\n# fail 0\n"
    plain = _plain(tap)
    for key, expected in (("tests", "305"), ("pass", "305"), ("fail", "0")):
        m = re.search(r"^# %s (\d+)$" % key, plain, re.M)
        if not m or m.group(1) != expected:
            raise SystemExit(
                "FAIL: the TAP parser cannot read '# %s' from coloured output" % key)


def check(label: str, claimed, actual) -> None:
    global checks
    checks += 1
    if str(claimed).strip() != str(actual).strip():
        failures.append(f"{label}: doc says {claimed!r}, repo has {actual!r}")

def want(label: str, pattern: str, haystack: str, where: str, flags=0):
    """Find a pattern that is not allowed to disappear.

    Every optional `if m:` in this file used to be a check that could vanish:
    reword the prose, the regex stops matching, the check stops running, and
    the run still prints PASS with a quietly smaller total. That happened to
    the shipped-sprite count, and nearly happened to the provenance table —
    where a bare substring test stayed green on a coincidence.

    So no pattern here is optional. A pattern that stops matching is a
    failure, named after the claim it used to verify, because "nobody states
    this any more" and "this is still true" must never look the same.
    """
    global checks
    m = re.search(pattern, haystack, flags)
    if m is None:
        checks += 1
        failures.append(
            f"{where} no longer states {label} in the form {pattern!r} — "
            f"that check silently stopped running")
    return m


def _test_files() -> list[str]:
    """Expand the test glob in Python, not in node and not in a shell.

    subprocess without shell=True hands node the literal string
    "tests/*.test.js". Node only expands that from v22, and this repo ran
    on Node 20 when the bug was found: it printed "Could not find", ran
    zero tests, and this checker reported "could not read the runner"
    instead of a test count. Expanding here keeps that true on every
    runtime, including the ones not invented yet.

    Expanding here drops the dependency on both a shell and a node version.
    An empty result is a hard stop: counting zero tests and calling it a
    match is the false green this file exists to prevent.
    """
    hits = sorted(glob.glob(os.path.join(ROOT, "tests", "*.test.js")))
    if not hits:
        raise SystemExit("FAIL: no tests/*.test.js found — nothing to count")
    return hits


def want_all(label: str, pattern: str, haystack: str, where: str,
             minimum: int, flags=0) -> list:
    """Same contract for table-driven checks.

    A `re.findall` that matches nothing is the quietest failure mode in this
    file: the loop body simply never runs, so a deleted table costs zero
    checks and raises zero complaints.
    """
    global checks
    hits = re.findall(pattern, haystack, flags)
    if len(hits) < minimum:
        checks += 1
        failures.append(
            f"{where}: expected at least {minimum} {label} row(s), found "
            f"{len(hits)} — the table was renamed, reformatted or deleted")
    return hits


def main() -> int:
    global checks
    _self_test_parsers()
    if not os.path.exists(DOC):
        print(f"FAIL: {DOC} missing")
        return 1
    doc = open(DOC, encoding="utf-8").read()

    # --- 1. module line counts ------------------------------------------
    # These appear in the module map as `name.js   <lines>   description`.
    # They are the fastest thing in the doc to go stale.
    for name, claimed in want_all(
            "server line-count", r"^(\w[\w-]*\.js)\s+(\d+)", doc,
            "ARCHITECTURE.md", 4, re.M):
        path = os.path.join(ROOT, "server", name)
        if os.path.exists(path):
            actual = len(open(path, encoding="utf-8").read().splitlines())
            check(f"server/{name} line count", claimed, actual)

    # --- 2. asset counts -------------------------------------------------
    m = want("the room plate count", r"\*\*(\d+) pelat ruangan\*\*", doc,
             "ARCHITECTURE.md")
    if m:
        check("room plate count", m.group(1),
              len(glob.glob(os.path.join(ROOT, "frontend/public/rooms/*.webp"))))

    # Anchored on "dikirim" rather than "distilisasi": the sentence used to say
    # 250 sprites were programmatically stylized, which was false (only 100
    # ever were). Rewording it silently un-matched this regex and the check
    # stopped running without failing — a check that can vanish is not a check,
    # so a missing pattern is now a loud failure rather than a skip.
    m = want("the shipped sprite count", r"\*\*(\d+) sprite\*\* dikirim", doc,
             "ARCHITECTURE.md")
    if m:
        check("sprite count", m.group(1),
              len(glob.glob(os.path.join(ROOT, "frontend/public/sprites/**/*.webp"),
                            recursive=True)))

    # --- 3. the route table ----------------------------------------------
    # The most load-bearing table in the file: it documents which guard
    # protects which endpoint. A route added to index.js without a row here
    # is exactly how an endpoint ends up world-readable by accident, because
    # the reviewer's mental model comes from this table.
    src = open(os.path.join(ROOT, "server", "index.js"), encoding="utf-8").read()
    real: dict[str, str] = {}
    for verb, path, guard in re.findall(
        r'app\.(get|post|put|delete)\("([^"]+)"\s*,\s*([A-Za-z_][\w.]*)?', src
    ):
        if not path.startswith("/"):
            continue
        # A route may be registered more than once (e.g. "/" for the SPA and
        # for the auto-guest middleware); the guarded form is what matters.
        key = f"{verb.upper()} {path}"
        if key not in real or guard:
            real[key] = guard or "-"

    documented: set[str] = set()
    for row in re.findall(r"^\|\s*(GET|POST|PUT|DELETE)\s*\|(.+?)\|", doc, re.M):
        verb, paths = row[0], row[1]
        for p in re.findall(r"`([^`]+)`", paths):
            documented.add(f"{verb} {p}")

    undocumented = sorted(set(real) - documented)
    if undocumented:
        failures.append(
            "routes in index.js with no row in the route table: "
            + ", ".join(undocumented)
        )
    checks += 1

    phantom = sorted(documented - set(real))
    if phantom:
        failures.append(
            "routes documented that do not exist in index.js: " + ", ".join(phantom)
        )
    checks += 1

    # --- 4. test counts ---------------------------------------------------
    # Counted from the source rather than by running the suites: this script
    # has to stay fast enough that nobody is tempted to skip it.
    m = re.search(r"\| Backend \| \*\*(\d+)\*\*", doc)
    if m:
        # A suite that could not even load its dependencies reports a small
        # count and looks exactly like a stale doc. Reporting that as "the
        # doc lies" is how a checker teaches people to ignore it, so the two
        # cases are separated explicitly.
        if not os.path.isdir(os.path.join(ROOT, "node_modules")):
            print("SKIP: backend test count — node_modules missing, run `npm ci` first")
        else:
            blob, total, _passed, _failed = _backend_counts()
            if "ERR_MODULE_NOT_FOUND" in blob:
                failures.append(
                    "backend suite could not load (ERR_MODULE_NOT_FOUND) — "
                    "run `npm ci`; this is an environment problem, not a doc problem"
                )
                checks += 1
            elif total is not None:
                check("backend test count", m.group(1), total)
            else:
                # Staying silent here used to shift the total claim count,
                # so the run reported "checked 85" alongside the real
                # failure and buried it. Count the check, name the cause.
                failures.append("backend test count — could not read the runner")
                checks += 1

    m = re.search(r"\| Frontend \| \*\*(\d+)\*\*", doc)
    if m:
        # This used to count `it(` occurrences by globbing *.test.tsx and
        # splitting it.each([...]) on commas. Both halves were wrong:
        #
        #   - the glob missed *.test.ts (no x), so agentManager.test.ts and
        #     its 75 cases were invisible. The claim "44" passed for months
        #     by coincidence, which is the worst way for a checker to pass.
        #   - splitting it.each on commas miscounts every table whose rows
        #     are arrays, because the commas inside the rows also split.
        #
        # Ask the runner instead. Slower, but a checker that is confidently
        # wrong is worse than one that takes four seconds.
        fe = os.path.join(ROOT, "frontend")
        if not os.path.isdir(os.path.join(fe, "node_modules")):
            print("SKIP: frontend test count — frontend/node_modules missing, "
                  "run `npm ci` in frontend/ first")
        else:
            blob, total, _passed, _failed = _frontend_counts(fe)
            if "ERR_MODULE_NOT_FOUND" in blob or "failed to load config" in blob:
                failures.append(
                    "frontend suite could not start — run `npm ci` in frontend/; "
                    "this is an environment problem, not a doc problem"
                )
                checks += 1
            elif total is not None:
                check("frontend test count", m.group(1), total)
            else:
                failures.append("frontend test count — vitest wrote no JSON report")
                checks += 1

    # --- 5. PRD.md --------------------------------------------------------
    prd_path = os.path.join(ROOT, "docs", "PRD.md")
    if os.path.exists(prd_path):
        prd = open(prd_path, encoding="utf-8").read()
        index = open(os.path.join(ROOT, "server", "index.js"), encoding="utf-8").read()
        chat = open(os.path.join(ROOT, "server", "chat.js"), encoding="utf-8").read()

        # "21 rute tingkat-atas + 7 sub-rute chat"
        m = want("the route totals",
                 r"(\d+) rute tingkat-atas \+ (\d+) sub-rute chat", prd,
                 "PRD.md")
        if m:
            # Count (method, path) PAIRS, not unique paths. GET and POST on
            # /approvals/:id are two routes with two guards and two failure
            # modes; collapsing them to one is how a route table loses an
            # endpoint nobody then reviews.
            top = set(re.findall(
                r"app\.(get|post|put|delete)\(\s*[\"']([^\"']+)", index))
            # The chat router is named `r`, not `router` — match any receiver
            # so renaming the variable cannot silently zero this check.
            sub = set(re.findall(
                r"\b\w+\.(get|post|put|delete)\(\s*[\"'](/[^\"']*)", chat))
            check("PRD top-level route count", m.group(1), len(top))
            check("PRD chat sub-route count", m.group(2), len(sub))

        # "12 ruangan, 18 pelat, 250 sprite"
        m = want("the asset inventory",
                 r"(\d+) ruangan, (\d+) pelat, (\d+) sprite", prd, "PRD.md")
        if m:
            rooms_ts = open(os.path.join(ROOT, "frontend/src/rooms.ts"), encoding="utf-8").read()
            check("PRD room count", m.group(1),
                  len(re.findall(r"^  '[a-z-]+': \{", rooms_ts, re.M)))
            check("PRD plate count", m.group(2),
                  len(glob.glob(os.path.join(ROOT, "frontend/public/rooms/*.webp"))))
            check("PRD sprite count", m.group(3),
                  len(glob.glob(os.path.join(ROOT, "frontend/public/sprites/**/*.webp"),
                                recursive=True)))

        # The guest contract and the "never read prompt content" fence are
        # load-bearing promises, not prose. If the words leave the PRD the
        # product changed; this only checks they are still claimed.
        for phrase in ("Tidak pernah membaca isi prompt", "Jangan pernah per-kursi"):
            checks += 1
            if phrase not in prd:
                failures.append(f"PRD no longer states: {phrase!r}")

    # --- 6. UI-SPEC.md ----------------------------------------------------
    ui_path = os.path.join(ROOT, "docs", "UI-SPEC.md")
    if os.path.exists(ui_path):
        ui = open(ui_path, encoding="utf-8").read()

        # CSS line-count table: | `name.css` | 1.582 | role |
        for name, claimed in want_all(
                "CSS line-count", r"\| `([a-z]+\.css)` \| ([\d.]+) \|", ui,
                "UI-SPEC.md", 1):
            f = os.path.join(ROOT, "frontend/src/styles", name)
            if os.path.exists(f):
                actual = sum(1 for _ in open(f, encoding="utf-8"))
                check(f"UI-SPEC {name} line count",
                      claimed.replace(".", ""), actual)

        # "19 token OKLCH"
        m = want("the OKLCH token count", r"(\d+) token OKLCH", ui, "UI-SPEC.md")
        if m:
            css = open(os.path.join(ROOT, "frontend/src/styles/donghua.css"),
                       encoding="utf-8").read()
            check("UI-SPEC OKLCH token count", m.group(1), css.count("oklch("))

        # "**1 `!important`**" — the number must stay honest.
        # Comments are stripped first: donghua.css now explains in prose WHY
        # the flags were removed, and counting the word inside that
        # explanation reported three flags in a file that has one.
        m = want("the !important count", r"\*\*(\d+) `!important`\*\*", ui,
                 "UI-SPEC.md")
        if m:
            css = open(os.path.join(ROOT, "frontend/src/styles/donghua.css"),
                       encoding="utf-8").read()
            decls = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
            check("UI-SPEC !important count", m.group(1), decls.count("!important"))

        # Component line counts: `Name` (171 baris)
        for name, claimed in want_all(
                "component line-count", r"`(\w+)` \((\d+) baris\)", ui,
                "UI-SPEC.md", 3):
            hits = glob.glob(os.path.join(ROOT, f"frontend/src/**/{name}.tsx"),
                             recursive=True)
            if hits:
                actual = sum(1 for _ in open(hits[0], encoding="utf-8"))
                check(f"UI-SPEC {name}.tsx line count", claimed, actual)

        # LIGHT_DX, LIGHT_DY = -2, -3 — the shader rake and the baked rim
        # light must agree or the whole 3D illusion collapses. The doc calls
        # this the one number nobody may change unilaterally, so it is pinned.
        m = want("the pinned light direction",
                 r"LIGHT_DX, LIGHT_DY = (-?\d+), (-?\d+)", ui, "UI-SPEC.md")
        if m:
            py = open(os.path.join(ROOT, "scripts/stylize-donghua.py"),
                      encoding="utf-8").read()
            # The doc half and the code half can each vanish. Losing the code
            # half is worse: the doc would still pin a number that nothing
            # compares against.
            got = want("LIGHT_DX/LIGHT_DY",
                       r"LIGHT_DX,\s*LIGHT_DY\s*=\s*(-?\d+),\s*(-?\d+)", py,
                       "scripts/stylize-donghua.py")
            if got:
                check("UI-SPEC light direction",
                      f"{m.group(1)},{m.group(2)}", f"{got.group(1)},{got.group(2)}")

        # The AuditBadge sentence is a compliance claim rendered to users.
        badge = os.path.join(ROOT, "frontend/src/components/AuditBadge.tsx")
        if "Tamper-evident, not tamper-proof" in ui and os.path.exists(badge):
            checks += 1
            if "Tamper-evident, not tamper-proof" not in open(badge, encoding="utf-8").read():
                failures.append(
                    "UI-SPEC claims AuditBadge renders 'Tamper-evident, not "
                    "tamper-proof.' but the component no longer contains it")


    # --- README.md / README.id.md / PRICING.md / PRICING.id.md -----------
    # The selling documents are the ones most likely to drift and the most
    # damaging when they do: every other doc rotting embarrasses a developer,
    # these mislead a buyer.
    #
    # They now exist in two languages, which doubles the surface. A
    # translation is a second place for a claim to rot, and it rots more
    # quietly than the original because whoever edits the English version
    # often cannot read the other one. So the checks below are mostly
    # PARITY checks: the two versions must agree on every number and still
    # carry every promise. Wording is left alone; commitments are not.
    BACKEND_PASSES = [None]
    READMES = {"en": "README.md", "id": "README.id.md"}
    PRICINGS = {"en": "docs/PRICING.md", "id": "docs/PRICING.id.md"}
    text = {}
    for lang, rel in list(READMES.items()) + list(PRICINGS.items()):
        full = os.path.join(ROOT, rel)
        text[rel] = open(full, encoding="utf-8").read() if os.path.exists(full) else None
    # AGENTS.md also quotes the claim total, so it has to be readable here
    # for the self-count backstop at the bottom of this function.
    _agents = os.path.join(ROOT, "AGENTS.md")
    text["AGENTS.md"] = (open(_agents, encoding="utf-8").read()
                         if os.path.exists(_agents) else None)

    readme_path = os.path.join(ROOT, READMES["en"])
    rd = text[READMES["en"]]

    # Promises that constrain the code, in both languages. Each is enforced
    # somewhere in the repo; if the enforcement goes, the promise is a lie.
    PROMISES = [
        ("never reads prompt content", {
            "README.md": "never reads your prompt content",
            "README.id.md": "Tidak membaca isi prompt"}),
        ("tamper-evident, not tamper-proof", {
            "README.md": "Tamper-evident, not tamper-proof",
            "README.id.md": "Tahan-rusak, bukan anti-rusak"}),
        ("no per-seat pricing", {
            "README.md": "not sold per seat",
            "README.id.md": "Tidak dijual per kursi"}),
    ]
    for label, per_file in PROMISES:
        for rel, phrase in per_file.items():
            if text.get(rel) is None:
                continue
            checks += 1
            if phrase not in text[rel]:
                failures.append(f"{rel} dropped the '{label}' promise")

    # Test counts: asked of the runners, not counted by hand, and both
    # language versions must quote the same figure.
    # PRICING.md is read by buyers, so its numbers rot in the most expensive
    # place. It sat outside this checker and drifted exactly as predicted:
    # it was still selling "61 machine-verified claims" when the real figure
    # had moved to 83. Both sales files now quote the same figures as the
    # READMEs, checked against the same runners.
    # The supported runtime is a security statement, not a style note.
    # Node 20 reached end of life on 2026-04-30 and receives no patches, so
    # a README still advertising it is exactly the kind of claim that
    # outruns reality — the failure this file exists to catch. Read the
    # number from package.json instead of trusting the prose.
    with open(os.path.join(ROOT, "package.json"), encoding="utf-8") as fh:
        engines = (json.load(fh).get("engines") or {}).get("node", "")
    m_eng = re.search(r"(\d+)", engines)
    if m_eng:
        checks += 1
        for rel in READMES.values():
            if text.get(rel) is None:
                continue
            m_doc = re.search(r"Node\s*(?:\u2265|>=)\s*(\d+)", text[rel])
            if m_doc and m_doc.group(1) != m_eng.group(1):
                failures.append(
                    f"{rel} advertises Node >= {m_doc.group(1)} but "
                    f"package.json engines says '{engines}'")

    # ── verify.sh gate count ──────────────────────────────────────────
    # AGENTS.md and HANDOFF.md are the two files a new agent reads first, and
    # neither was in this checker's reach — so both quoted a gate count that
    # went stale the moment a gate was added, with nothing to complain. The
    # truth comes from verify.sh itself: unique gate names, with the
    # parenthetical stripped so "sprites (hash only)" and "sprites (+rebuild)"
    # count once rather than twice.
    verify_sh = os.path.join(ROOT, "scripts", "verify.sh")
    if os.path.exists(verify_sh):
        with open(verify_sh, encoding="utf-8") as fh:
            names = re.findall(r'^\s*gate\s+"([^"]+)"', fh.read(), re.M)
        actual = len({re.sub(r"\s*\(.*", "", n) for n in names})
        for rel, pattern in (("AGENTS.md", r"all (\d+) gates"),
                             ("HANDOFF.md", r"(\d+) gerbang")):
            path = os.path.join(ROOT, rel)
            if not os.path.exists(path):
                continue
            checks += 1
            with open(path, encoding="utf-8") as fh:
                claimed = set(re.findall(pattern, fh.read()))
            if not claimed:
                failures.append(
                    f"{rel}: states no gate count for verify.sh to be checked against")
            elif claimed != {str(actual)}:
                failures.append(
                    f"{rel} claims {'/'.join(sorted(claimed))} gates but "
                    f"verify.sh runs {actual}")

    # ── sect theme covers every governed room ─────────────────────────
    # frontend/src/theme/sect.ts names a hall per room. A room the policy
    # governs but the theme forgot would render as a blank rung — the kind of
    # gap that only shows up when someone finally clicks it. The room ids come
    # from the policy itself rather than a second list.
    _sect_path = os.path.join(ROOT, "frontend/src/theme/sect.ts")
    sect_src = (open(_sect_path, encoding="utf-8").read()
                if os.path.exists(_sect_path) else "")
    if sect_src:
        checks += 1
        try:
            ids = subprocess.run(
                ["node", "-e",
                 "import('./server/policy.js').then(m=>"
                 "console.log(Object.keys(m.DEFAULT_POLICY.rooms).join(',')))"],
                cwd=ROOT, capture_output=True, text=True, timeout=60)
            governed = [r for r in ids.stdout.strip().split(",") if r]
        except Exception:
            governed = []
        body = sect_src.split("SECT_HALLS", 1)[-1]
        named = set(re.findall(r"^\s*'?([a-z][a-z-]*)'?\s*:\s*\{", body, re.M))
        if not governed:
            failures.append(
                "could not read the policy room ids to check the sect theme against")
        else:
            missing = [r for r in governed if r not in named]
            if missing:
                failures.append(
                    "frontend/src/theme/sect.ts has no hall for governed "
                    f"room(s): {', '.join(sorted(missing))}")

    RUNNERS = [
        ("backend", r"\| (?:Backend tests|Test backend) \| \*\*(\d+)\*\* \|"),
        ("frontend", r"\| (?:Frontend tests|Test frontend) \| \*\*(\d+)\*\* \|"),
    ]
    for name, pattern in RUNNERS:
        claimed = {}
        for rel in READMES.values():
            if text.get(rel) is None:
                continue
            m = re.search(pattern, text[rel])
            if m:
                claimed[rel] = m.group(1)
        if not claimed:
            continue
        checks += 1
        if name == "backend":
            blob, _total, passed, failing = _backend_counts()
        else:
            blob, _total, passed, failing = _frontend_counts(
                os.path.join(ROOT, "frontend"))
        # A failing suite lowers the pass count, which this check would
        # otherwise report as "the doc lies" — sending the reader to edit a
        # number when the real problem is a broken test. It misled the
        # author of this very function once, which is how it got written.
        if name == "backend" and passed:
            BACKEND_PASSES[0] = passed
        if failing is not None and failing != "0":
            failures.append(
                f"{name} suite has {failing} failing test(s) — "
                + _abi_hint(blob)
                + _which_failed(blob) + _keep_evidence(name, blob))
        elif passed is None:
            failures.append(f"README {name} test count: could not read the runner")
        else:
            for rel, value in claimed.items():
                if value != passed:
                    failures.append(
                        f"{rel} {name} test count: doc says '{value}', "
                        f"runner reports {passed}")

    # The quickstart is the first command a buyer types. A README that opens
    # with a script that does not exist ends the evaluation there.
    for rel in READMES.values():
        if text.get(rel) is None:
            continue
        for cmd in re.findall(r"bash (scripts/[\w.-]+)", text[rel]):
            checks += 1
            if not os.path.exists(os.path.join(ROOT, cmd)):
                failures.append(f"{rel} tells the reader to run {cmd}, which does not exist")

    # Prices must be identical across all four documents. Two currencies
    # formats are in play (1.000 vs 1,000), so each tier carries both.
    # Prices must be identical across all four documents, and the check has
    # to look at the PRICE ROW, not the document.
    #
    # The first version searched the whole file for each tier. It passed a
    # table that had been mutated to $2,400 because the correct $2,000 still
    # appeared two paragraphs later in prose — a green check over a document
    # quoting the wrong price, which is worse than having no check at all.
    TIERS_EN = ["$0", "$39", "$299", "$2,000"]
    TIERS_ID = ["$0", "$39", "$299", "$2.000"]
    for rel in list(READMES.values()) + list(PRICINGS.values()):
        if text.get(rel) is None:
            continue
        checks += 1
        tiers = TIERS_ID if rel.endswith(".id.md") else TIERS_EN
        row = next(
            (ln for ln in text[rel].splitlines()
             if all(t in ln for t in tiers) and ln.lstrip().startswith("|")),
            None,
        )
        if row is None:
            failures.append(
                f"{rel} has no single line quoting all four tiers "
                f"({', '.join(tiers)}) — the price table drifted or was reworded")

    # Each language version must point at the other, and at its own-language
    # pricing page. A dead language switcher is how a translation starts
    # being invisible, and then being forgotten.
    SWITCHERS = [
        ("README.md", "README.id.md"), ("README.id.md", "README.md"),
        ("docs/PRICING.md", "PRICING.id.md"), ("docs/PRICING.id.md", "PRICING.md"),
    ]
    for rel, target in SWITCHERS:
        if text.get(rel) is None:
            continue
        checks += 1
        if f"]({target})" not in text[rel]:
            failures.append(f"{rel} has no working language switcher to {target}")

    # docs/ROOM-PLATES.md publishes the acceptance thresholds that paying
    # customers use to add their own rooms. If a threshold moves in the
    # checker and the prose does not follow, we have sold extensibility
    # documented by a number that is no longer enforced. Bind prose to source.
    def _slurp(rel):
        fp = os.path.join(ROOT, rel)
        return open(fp, encoding="utf-8").read() if os.path.exists(fp) else ""

    plates_src = _slurp("scripts/check-plates.py")
    rp = _slurp("docs/ROOM-PLATES.md")
    if plates_src and rp:
        for label, pattern in (
            ("unique-colour floor", r"MIN_UNIQUE\s*=\s*(\d+)"),
            ("byte floor", r"MIN_BYTES,\s*MAX_BYTES\s*=\s*(\d+) \* 1024"),
            ("byte ceiling", r"MAX_BYTES\s*=\s*\d+ \* 1024,\s*(\d+) \* 1024"),
            ("off-palette trigger", r"OFF_PALETTE_PCT\s*=\s*(\d+)"),
            ("mean-luminance floor", r"LUM_MEAN\s*=\s*\(0\.(\d+),"),
            ("p5 ceiling", r"MAX_P5\s*=\s*0\.(\d+)"),
            ("p95 floor", r"MIN_P95\s*=\s*0\.(\d+)"),
        ):
            m = re.search(pattern, plates_src)
            if not m:
                failures.append(f"check-plates.py no longer defines the {label}")
                checks += 1
                continue
            n = m.group(1)
            shown = n if label.startswith(("unique", "byte", "off")) else f"0,{n}"
            checks += 1
            if shown not in rp:
                failures.append(
                    f"docs/ROOM-PLATES.md does not quote the {label} "
                    f"({shown}) that check-plates.py enforces")

        import json as _json
        man = _json.loads(_slurp("frontend/public/rooms/PLATES.json"))
        entries = man["plates"] if isinstance(man, dict) else man
        # This used to compare the manifest against a literal 18 typed into
        # this file. That is not a documentation check — it is the checker
        # holding its own private copy of the number, free to disagree with
        # every document while still reporting PASS. The claim belongs to the
        # doc; this reads it from there.
        m_pc = want("the recorded plate count", r"\*\*(\d+) plate\*\*", rp,
                    "docs/ROOM-PLATES.md")
        if m_pc:
            check("docs/ROOM-PLATES.md plate count",
                  m_pc.group(1), str(len(entries)))
        reviewed = [e for e in entries if e.get("offPaletteReviewed")]
        # Every reviewed exception must be named in the prose. An unexplained
        # waiver in a manifest is how a real defect gets grandfathered in.
        for e in reviewed:
            checks += 1
            if e["file"].replace(".webp", "") not in rp:
                failures.append(
                    f"{e['file']} carries offPaletteReviewed but "
                    f"docs/ROOM-PLATES.md never explains why")

    # docs/SPRITES.md states how many sprites are reproducible and how many
    # are not. The unsourced count is the uncomfortable one, and it is exactly
    # the number most likely to be quietly left behind once the gap is closed.
    sp_manifest = os.path.join(ROOT, "frontend/public/sprites/SPRITES.json")
    sd = _slurp("docs/SPRITES.md")
    if os.path.exists(sp_manifest) and sd:
        import json as _json2
        with open(sp_manifest, encoding="utf-8") as fh:
            spm = _json2.load(fh)
        by = spm["byProvenance"]
        check("docs/SPRITES.md total sprites", "282", str(spm["count"]))
        for kind, claimed in (("derived", "100"), ("built", "32"),
                              ("unsourced", "150")):
            check(f"docs/SPRITES.md {kind} count", claimed, str(by.get(kind, 0)))
            # Substring matching is not enough here: a bare "32" is also
            # inside "132", so deleting the number from the table used to
            # pass on a coincidence elsewhere in the prose. Bind the claim to
            # the provenance table row, which is where the doc states it.
            checks += 1
            if not re.search(rf"\|\s*`{kind}`\s*\|\s*{claimed}\s*\|", sd):
                failures.append(
                    f"docs/SPRITES.md provenance table does not state "
                    f"{kind} = {claimed}")
        # The claim that every character is unsourced is the whole point of
        # that document. If someone runs the pipeline over the characters, the
        # prose becomes a lie and must be rewritten, not silently outlived.
        chars = [e for e in spm["sprites"]
                 if e["file"].startswith(("characters/", "office/characters/"))]
        unsourced_chars = [e for e in chars if e["provenance"] == "unsourced"]
        checks += 1
        if len(chars) != len(unsourced_chars):
            failures.append(
                f"docs/SPRITES.md says no character has been through the "
                f"pipeline, but {len(chars) - len(unsourced_chars)} of "
                f"{len(chars)} now have originals — rewrite the doc")
        checks += 1
        if "art/donghua-cast" not in sd:
            failures.append(
                "docs/SPRITES.md never names art/donghua-cast as the source "
                "the 32 `built` sprites rebuild from — without it the "
                "reproducibility claim has no stated input")
        # The old cast is shipped but no longer rendered. If anyone re-wires
        # the app back to it, this prose becomes wrong in the other direction.
        src = ""
        for f in ("frontend/src/components/Character.tsx",
                  "frontend/src/config.ts"):
            src += _slurp(f) or ""
        checks += 1
        refs = [d for d in ("office/characters", "/sprites/characters")
                if d in src]
        if refs:
            failures.append(
                f"docs/SPRITES.md says the old cast is rendered by nothing, "
                f"but frontend/src still references {', '.join(refs)}")
        check("docs/SPRITES.md office/characters count", "108",
              str(len([e for e in chars
                       if e["file"].startswith("office/characters/")])))

    # stylize-donghua.py must never again point its originals tree at a path
    # that exists on one machine. This is the defect that silently destroyed
    # all 250 sprites for anyone who cloned the repo and ran it.
    sty = _slurp("scripts/stylize-donghua.py")
    if sty:
        checks += 1
        if '"/home/user' in sty or "'/home/user" in sty:
            failures.append(
                "scripts/stylize-donghua.py hardcodes an absolute /home/user "
                "path again — on any other machine it treats shipped art as "
                "the pristine original and double-filters it")

    # The sales files quote the backend test count in prose, not a table.
    # Same number, same runner, different sentence — so it gets the same
    # treatment rather than being trusted because it reads like marketing.
    for rel in PRICINGS.values():
        if text.get(rel) is None:
            continue
        m = want("the backend test count",
                 r"(?:carries|punya) (\d+) (?:backend tests|test backend)",
                 text[rel], rel)
        if m:
            check(f"{rel} backend test count", m.group(1), BACKEND_PASSES[0])

    # The count of checked claims is itself a claim in the README, and it is
    # the one guaranteed to rot: every future check added here invalidates
    # it. Evaluated last, and counts itself, so the number the README quotes
    # is the number this run actually verified.
    SELF = {
        "README.md": r"\| Machine-verified doc claims \| \*\*(\d+)\*\*",
        "README.id.md": r"\| Klaim dokumen yang diverifikasi mesin \| \*\*(\d+)\*\*",
        "docs/PRICING.md": r"(\d+) machine-verified documentation",
        "docs/PRICING.id.md": r"(\d+) klaim dokumen yang diverifikasi mesin",
        # AGENTS.md drifted to 87 while the real total was 91 and nothing
        # caught it, because this dict was the only thing that looks at a
        # self-count and AGENTS.md was not in it. A doc that states the
        # number must be held to it, wherever it states it.
        "AGENTS.md": r"compares (\d+) documented claims",
    }
    # Both language versions must quote the SAME total, so every self-claim
    # is counted before any is compared. Incrementing inside the loop gave
    # the English file 70 and the Indonesian 71 — a number that is correct
    # in one file and wrong in the other is not a number worth printing.
    # This block is the backstop for every check above: if one of them stops
    # running, the total drops and the READMEs' figure no longer matches. So
    # the backstop must not be allowed to vanish the same way — if BOTH files
    # lost their row, `found` was empty, the comparison loop did nothing, and
    # a run missing checks printed PASS. Now a missing row is a failure.
    found = {}
    for rel, pattern in SELF.items():
        if text.get(rel) is None:
            failures.append(f"{rel} is missing — its self-count cannot be verified")
            checks += 1
            continue
        m = want("its machine-verified claim count", pattern, text[rel], rel)
        if m:
            found[rel] = int(m.group(1))
            checks += 1
    for rel, claimed_total in found.items():
        if claimed_total != checks:
            failures.append(
                f"{rel} claims {claimed_total} machine-verified doc claims; "
                f"this run checked {checks}")

    # --- report -----------------------------------------------------------
    if failures:
        print(f"FAIL: {len(failures)} of {checks} documentation claims do not match\n")
        for f in failures:
            print(f"  - {f}")
        print("\nFix the doc (or the code), then re-run: python3 scripts/check-docs.py")
        return 1

    print(f"PASS: all {checks} checkable claims across ARCHITECTURE.md, PRD.md, UI-SPEC.md, AGENTS.md, HANDOFF.md and both READMEs match the repo")
    return 0


if __name__ == "__main__":
    sys.exit(main())
