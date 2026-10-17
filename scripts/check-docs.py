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


def pkg_scripts(root: str) -> dict:
    """The root package.json scripts block, or an empty dict."""
    try:
        return json.load(open(os.path.join(root, "package.json"),
                              encoding="utf-8")).get("scripts", {})
    except Exception:
        return {}


def pkg_engines_major(root: str):
    """The supported Node floor, as a single integer, or None.

    Declared in exactly one place — package.json → engines.node — so that
    verify.sh's preflight, SUPPORT.md's prose and this checker cannot each
    hold a different opinion about what the floor is.
    """
    try:
        pkg = json.load(open(os.path.join(root, "package.json"),
                             encoding="utf-8"))
        return int(re.sub(r"[^0-9.]", "", pkg["engines"]["node"]).split(".")[0])
    except Exception:
        return None


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

        # These three are load-bearing promises, not prose. If the words
        # leave the PRD the product changed; this only checks they are still
        # claimed. "Persona 4" is here because its REMOVAL is the promise:
        # the section must stay, marked dicabut, so that re-adding a visitor
        # role requires deleting a documented retraction rather than quietly
        # filling a gap.
        for phrase in ("Tidak pernah membaca isi prompt", "Jangan pernah per-kursi",
                       "Persona 4: pengunjung anonim — **dihapus"):
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
            css = open(os.path.join(ROOT, "frontend/src/styles/sect.css"),
                       encoding="utf-8").read()
            check("UI-SPEC OKLCH token count", m.group(1), css.count("oklch("))

        # "**1 `!important`**" — the number must stay honest.
        # Comments are stripped first: donghua.css now explains in prose WHY
        # the flags were removed, and counting the word inside that
        # explanation reported three flags in a file that has one.
        m = want("the !important count", r"\*\*(\d+) `!important`\*\*", ui,
                 "UI-SPEC.md")
        if m:
            css = open(os.path.join(ROOT, "frontend/src/styles/sect.css"),
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
        # The UI is Bahasa Indonesia (README.id.md promise), so the rendered
        # sentence is the Indonesian one; the English UI-SPEC quotes it
        # verbatim for the design record so the check stays meaningful.
        # The sentence moved with the component: AuditBadge was deleted with
        # the old chrome and restored as sect/Seal.tsx. The claim is the same
        # compliance claim, rendered in the same words, in the file that now
        # ships it.
        badge = os.path.join(ROOT, "frontend/src/sect/Seal.tsx")
        RENDERED = "Tahan-rusak, bukan anti-rusak"
        if RENDERED in ui and os.path.exists(badge):
            checks += 1
            if RENDERED not in open(badge, encoding="utf-8").read():
                failures.append(
                    "UI-SPEC claims AuditBadge renders 'Tahan-rusak, bukan "
                    "anti-rusak.' but the component no longer contains it")


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
    _fr = os.path.join(ROOT, "docs", "FLIGHT-RECORDER.md")
    text["docs/FLIGHT-RECORDER.md"] = (open(_fr, encoding="utf-8").read()
                                       if os.path.exists(_fr) else None)
    _support = os.path.join(ROOT, "docs", "SUPPORT.md")
    text["docs/SUPPORT.md"] = (open(_support, encoding="utf-8").read()
                               if os.path.exists(_support) else None)

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
        # HANDOFF.md's pattern used to be a bare `(\d+) gerbang`, which swept
        # up every number in the file that looked like a gate count —
        # including "13/14 gerbang hijau", a dated record of how a particular
        # run went. Adding a gate then demanded that the historical note be
        # edited to say something that never happened. A checker that forces
        # the past to be rewritten to stay green is worse than no checker, so
        # it now binds only the live claim: the row in the script table.
        for rel, pattern in (("AGENTS.md", r"all (\d+) gates"),
                             ("HANDOFF.md",
                              r"\|\s*`scripts/verify\.sh`\s*\|[^|]*?(\d+) gerbang")):
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

    # ── every governed room resolves to a hall name ───────────────────
    # The theme used to carry a hand-written SECT_HALLS table and this check
    # read it. That table was withdrawn on 2026-10-17: six of its eight halls
    # named rooms the owner does not have. Names now come from the ecosystem
    # model via hallFor(), so the check reads the same two sources hallFor
    # does, rather than a literal that no longer exists.
    #
    # The guarantee is unchanged: a room the policy governs but nothing can
    # name renders as a bare id on a rung, which is the gap this catches.
    _sect_path = os.path.join(ROOT, "frontend/src/theme/sect.ts")
    _eco_path = os.path.join(ROOT, "frontend/src/eco/ecosystem.ts")
    sect_src = (open(_sect_path, encoding="utf-8").read()
                if os.path.exists(_sect_path) else "")
    eco_src = (open(_eco_path, encoding="utf-8").read()
               if os.path.exists(_eco_path) else "")
    if sect_src and eco_src:
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
        # Rooms the ecosystem declares, spelled the way the policy spells them.
        rooms_block = eco_src[eco_src.find("const MAC_ROOMS"):
                              eco_src.find("export const ROOMS")]
        nameable = {
            f"{office}/{rid}"
            for rid, office in re.findall(
                r"\{\s*id:\s*'([^']+)',\s*office:\s*'([^']+)'", rooms_block)
        }
        # Plus the one governed room that names no place on purpose. Read the
        # constant rather than hard-coding it, so a rename cannot slip past.
        m_unmapped = re.search(r"UNMAPPED_ROOM\s*=\s*'([^']+)'", sect_src)
        if m_unmapped:
            nameable.add(m_unmapped.group(1))
        if not governed:
            failures.append(
                "could not read the policy room ids to check the sect theme against")
        elif not m_unmapped:
            failures.append(
                "frontend/src/theme/sect.ts no longer declares UNMAPPED_ROOM; "
                "the policy default would render as a bare id")
        else:
            missing = [r for r in governed if r not in nameable]
            if missing:
                failures.append(
                    "no hall name resolves for governed room(s): "
                    + ", ".join(sorted(missing)))

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

    # The price table is gone, and this check is its inverse.
    #
    # It used to assert that all four documents quoted the same four tiers on
    # a single PRICE ROW — $0 / $39 / $299 / $2,000 — because an earlier
    # version searched the whole file and passed a table mutated to $2,400
    # while the correct figure still sat two paragraphs away in prose. A green
    # check over a document quoting the wrong price is worse than no check.
    #
    # Those tiers were retracted in Oct 2026: there is one owner, no seats and
    # nothing to sell (docs/PRICING.md). The retraction is the kind that gets
    # quietly undone — a tier table is easy to paste back in, and it drags a
    # second principal with it, which is exactly how the guest role and its
    # redaction pipeline were justified in the first place. So the assertion
    # is inverted rather than deleted: no price may reappear in a table row.
    # Prose may discuss the old figures; `docs/PRICING.md` does, deliberately.
    # Room budgets ($0.25/hr for the lobby) are facts about policy and must
    # stay; only the retracted LICENCE figures are forbidden. Matching those
    # exact numbers keeps the check narrow enough to be true.
    RETRACTED = ("$39", "$299", "$2,000", "$2.000", "$2,400")
    for rel in list(READMES.values()) + list(PRICINGS.values()):
        if text.get(rel) is None:
            continue
        checks += 1
        offenders = [
            ln.strip() for ln in text[rel].splitlines()
            if ln.lstrip().startswith("|")
            and any(t in ln for t in RETRACTED)
            # The competitor comparison quotes other vendors' prices on
            # purpose; it is a claim about them, not an offer.
            and not any(v in ln for v in ("LangSmith", "Langfuse", "Laminar"))
        ]
        if offenders:
            failures.append(
                f"{rel} quotes a retracted licence price in a table row: "
                f"{offenders[0][:70]!r} — see docs/PRICING.md")

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
        # 2026-10-15: 132 -> 32. The 100 `derived` upstream sprites stay
        # retired; the 32 donghua `built` ones came back together with the
        # reader that renders them. These numbers are pinned here AND in the
        # doc on purpose — the check is that the two agree with the manifest,
        # so moving the product means moving all three deliberately.
        check("docs/SPRITES.md total sprites", "32", str(spm["count"]))
        for kind, claimed in (("derived", "0"), ("built", "32"),
                              ("unsourced", "0")):
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
        # Until 2026-10-10 this file checked that *every* character sprite was
        # unsourced — it was documenting a known gap and making sure the prose
        # did not outlive it. The gap is now closed the other way: the 150
        # legacy cast sprites were deleted, 108 of them recognisable likenesses
        # from a television series, shipped inside a product priced at $2,000+
        # and rendered by nothing.
        #
        # What replaces that check is a stronger claim than the one it retires:
        # every sprite this repo ships can be rebuilt from a committed source.
        # One unsourced file breaks it, so it is counted, not described.
        checks += 1
        unsourced = [e for e in spm["sprites"]
                     if e["provenance"] == "unsourced"]
        if unsourced:
            failures.append(
                f"{len(unsourced)} sprite(s) ship with no source (e.g. "
                f"{unsourced[0]['file']}), but docs/SPRITES.md claims every "
                f"shipped sprite is reproducible. Give it an original and run "
                f"the pipeline, or do not ship it")
        # The directories must stay gone. Restoring one from git history is how
        # a deleted liability returns unnoticed: every other gate only looks at
        # what is present, and a restored file matches its own hash perfectly.
        checks += 1
        back = [d for d in ("frontend/public/sprites/characters",
                            "frontend/public/sprites/office/characters")
                if os.path.isdir(os.path.join(ROOT, d))]
        if back:
            failures.append(
                f"the deleted legacy cast is back on disk ({', '.join(back)}); "
                f"it was removed for IP exposure, not to save bytes")
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
    # --- bundle size ------------------------------------------------------
    # The READMEs print a bundle size in the same table as the test counts,
    # which makes it read like the same machine measured both. It did not.
    # Nothing checked this number, and on 2026-10-09 six major versions landed
    # in forty minutes (React 19, TypeScript 7, Vite 8, Express 5,
    # better-sqlite3 13, ESLint 10). The real bundle moved 216 kB -> 299 kB
    # while both READMEs still said 216 kB.
    #
    # A 38% miss matters more here than anywhere else in this file, because
    # bundle size is the whole of ADR D3: we refuse React Three Fiber on the
    # grounds that it costs ~250 kB and we ship +7,8 kB. An unchecked 216 kB
    # lets that argument stay quotable long after it stopped being true.
    #
    # Measured from the built asset, so it cannot flatter itself.
    #
    # An absent frontend/dist is a failure here, not a skip. Skipping would
    # drop the check count below the self-count the READMEs publish, and the
    # run would die on "README.md claims 94 ... this run checked 92" — a red
    # that names the wrong problem, which is the exact defect this file
    # exists to prevent. Both CI (it builds dist for the static-serving test)
    # and verify.sh (the frontend-build gate runs first) reach this point
    # with dist present, so the failure only fires on an unbuilt tree, and it
    # says what to run.
    dist_assets = os.path.join(ROOT, "frontend", "dist", "assets")
    have_dist = os.path.isdir(dist_assets)
    if have_dist:
        def _total(ext):
            return sum(os.path.getsize(os.path.join(dist_assets, f))
                       for f in os.listdir(dist_assets) if f.endswith(ext))
        real = {"JS": _total(".js") / 1000.0, "CSS": _total(".css") / 1000.0}
    # Minifier output is not byte-stable across machines or minor tool
    # versions. 3% absorbs that; it does not absorb a major-version jump.
    TOL = 0.03
    BUNDLE = {
        "README.md": r"\| Bundle \| ([\d.,]+) kB JS · ([\d.,]+) kB CSS \|",
        "README.id.md": r"\| Bundel \| ([\d.,]+) kB JS · ([\d.,]+) kB CSS \|",
    }
    for rel, pattern in BUNDLE.items():
        if text.get(rel) is None:
            continue
        checks += 1
        if not have_dist:
            failures.append(
                f"{rel} states a bundle size but frontend/dist is absent, so "
                f"the claim cannot be checked. Run "
                f"`cd frontend && npm ci && npm run build` first — or use "
                f"`bash scripts/verify.sh`, which builds before it asks.")
            continue
        m = re.search(pattern, text[rel])
        if not m:
            failures.append(
                f"{rel} no longer states a bundle size this checker can "
                f"read; the claim must not be allowed to become unreadable "
                f"instead of wrong")
            continue
        claimed = {"JS": float(m.group(1).replace(",", ".")),
                   "CSS": float(m.group(2).replace(",", "."))}
        for label in ("JS", "CSS"):
            want_kb, got_kb = claimed[label], real[label]
            if abs(want_kb - got_kb) > max(got_kb * TOL, 1.0):
                failures.append(
                    f"{rel} claims {want_kb:g} kB {label}; the built "
                    f"bundle is {got_kb:.1f} kB "
                    f"({(got_kb - want_kb) / want_kb * 100:+.0f}%)")

    # --- the contrast gate's own advertised size ---------------------------
    # Both READMEs tell a buyer how many token pairs gate 14 measures. That
    # number was 13 and unbound: the gate grew to 29 pairs when the app
    # chrome was brought under it, and nothing would have noticed the README
    # still promising 13. A claim about how much checking happens is exactly
    # the claim a sceptical buyer checks first.
    #
    # The count is taken by RUNNING the gate rather than by counting entries
    # in its source, because the source has two lists and one of them is
    # measured twice (once per palette) — a reader of the source gets it
    # wrong, and so would a regex.
    out, err = _run(["python3", os.path.join("scripts", "check-contrast.py")], ROOT)
    m = re.search(r"PASS: (\d+) token pairs", out + err)
    if m is None:
        failures.append(
            "scripts/check-contrast.py did not report a pair count, so the "
            "number both READMEs advertise cannot be verified. Run gate 14 "
            "on its own: python3 scripts/check-contrast.py")
        checks += 2
    else:
        measured = int(m.group(1))
        for rel, pattern in (("README.md", r"\| theme contrast \| (\d+) token pairs"),
                             ("README.id.md", r"\| theme contrast \| (\d+) pasangan token")):
            got = want("its contrast pair count", pattern, text.get(rel) or "", rel)
            if got and int(got.group(1)) != measured:
                failures.append(
                    f"{rel} says gate 14 measures {got.group(1)} token pairs; "
                    f"it measures {measured}")
            checks += 1

    # --- the ledger load test ---------------------------------------------
    # FLIGHT-RECORDER.md §9a prints a concurrency figure — 50 agents x 40
    # decisions — and a throughput that was measured at exactly that shape.
    # Change the shape in the script and the documented numbers stop
    # describing the run that produced them, which is a subtler lie than a
    # wrong number: both the figure and the method look plausible, and only
    # together are they wrong.
    #
    # The throughput itself is deliberately NOT checked. It is a property of
    # the machine, and a gate that fails on a busy runner teaches people to
    # re-run gates until they pass.
    fr = text.get("docs/FLIGHT-RECORDER.md")
    bench_path = os.path.join(ROOT, "scripts", "bench-ledger.mjs")
    bench = (open(bench_path, encoding="utf-8").read()
             if os.path.exists(bench_path) else "")

    def _const(name):
        m = re.search(rf"const {name} = CHECK \? \d+ : (\d+);", bench)
        return int(m.group(1)) if m else None

    agents, per_agent = _const("AGENTS"), _const("PER_AGENT")
    m = re.search(r"(\d+) agen serentak . (\d+) keputusan", fr or "")
    if not bench:
        failures.append("scripts/bench-ledger.mjs is missing, but "
                        "FLIGHT-RECORDER.md documents its results")
    elif not m:
        failures.append("docs/FLIGHT-RECORDER.md no longer states the load "
                        "shape its throughput figure was measured at")
    elif (int(m.group(1)), int(m.group(2))) != (agents, per_agent):
        failures.append(
            f"docs/FLIGHT-RECORDER.md reports a run of {m.group(1)}x{m.group(2)} "
            f"but bench-ledger.mjs runs {agents}x{per_agent}")
    checks += 1

    if "npm run bench:ledger" in (fr or "") and \
            "bench:ledger" not in pkg_scripts(ROOT):
        failures.append("docs/FLIGHT-RECORDER.md tells the reader to run "
                        "`npm run bench:ledger`, but package.json has no "
                        "such script")
    checks += 1

    # --- the runtime support matrix ---------------------------------------
    # SUPPORT.md tells an enterprise reviewer which Node versions are
    # supported and until when. That is the single most expensive sentence in
    # the documentation to get wrong, because it is the one a buyer plans a
    # deployment around, and it rots in three independent ways: the CI matrix
    # changes, the floor in `engines` changes, or a date simply arrives.
    #
    # All three are bound here. The dates are not fetched — nothing in this
    # checker reaches the network — they are read out of the table and
    # compared against the clock, so an EOL that has passed turns the build
    # red on the day it passes rather than whenever someone next reads the
    # page.
    import datetime

    sup = text.get("docs/SUPPORT.md")
    wf = os.path.join(ROOT, "ci", "workflow.yml")
    wf_text = open(wf, encoding="utf-8").read() if os.path.exists(wf) else ""

    if sup is None:
        failures.append("docs/SUPPORT.md is missing — the support matrix "
                        "cannot be verified")
        checks += 4
    else:
        rows = re.findall(r"^\|\s*(\d+)\.x[^|]*\|[^|]*\|\s*(\d{4}-\d{2}-\d{2})\s*\|",
                          sup, re.M)
        listed = sorted(v for v, _ in rows)

        m = re.search(r"node:\s*\[([^\]]*)\]", wf_text)
        ci_versions = sorted(re.findall(r"\d+", m.group(1))) if m else []
        if not rows:
            failures.append("docs/SUPPORT.md has no readable support matrix")
        elif listed != ci_versions:
            failures.append(
                f"docs/SUPPORT.md claims support for Node {', '.join(listed)} "
                f"but the CI matrix runs {', '.join(ci_versions) or '(none found)'}")
        checks += 1

        # The floor is declared in package.json and quoted in the prose. One
        # of those is authoritative; this makes sure it is the same one.
        engines = pkg_engines_major(ROOT)
        m = re.search(r"Node\s*>=\s*(\d+)", sup)
        if not m:
            failures.append("docs/SUPPORT.md no longer states the Node floor "
                            "in a form this checker can read")
        elif engines is None:
            failures.append("package.json has no readable engines.node, so "
                            "the floor SUPPORT.md quotes cannot be checked")
        elif int(m.group(1)) != engines:
            failures.append(
                f"docs/SUPPORT.md quotes a floor of Node >= {m.group(1)}; "
                f"package.json engines.node says >= {engines}")
        checks += 1

        today = datetime.date.today()
        expired = [(v, d) for v, d in rows
                   if datetime.date.fromisoformat(d) < today]
        for v, d in expired:
            failures.append(
                f"docs/SUPPORT.md still lists Node {v}.x as supported, but "
                f"its stated EOL ({d}) has passed. Drop it from the CI "
                f"matrix and this table, or correct the date.")
        checks += 1

        # The page quotes the preflight's own output. A quoted error message
        # is a claim like any other, and this one goes stale the moment the
        # wording in verify.sh changes.
        quoted = re.search(r"^FAIL: (this repo requires Node >= )",
                           sup, re.M)
        vsh_text = open(os.path.join(ROOT, "scripts", "verify.sh"),
                        encoding="utf-8").read()
        if not quoted:
            failures.append("docs/SUPPORT.md no longer quotes the Node "
                            "preflight message it describes")
        elif quoted.group(1) not in vsh_text:
            failures.append(
                "docs/SUPPORT.md quotes a preflight message that verify.sh "
                "does not print any more")
        checks += 1

    # --- the one command we invite buyers to run --------------------------
    # The README and both pricing pages now sell a command: clone, npm ci,
    # npm run verify, 14 gates, about 3.5 minutes. That is a sales claim, and
    # it has three ways to rot. The script can be renamed out of
    # package.json, leaving the pages pointing at a command that does not
    # exist. A gate can be added, renamed or dropped in verify.sh while the
    # README table keeps the old list. And the count in the prose can drift
    # away from the list directly beneath it. A pricing page that boasts
    # about executable claims and then misstates its own gate list is worse
    # than one that never boasted, so all three are bolted down here.
    vsh = open(os.path.join(ROOT, "scripts", "verify.sh"), encoding="utf-8").read()
    # The sprite gate appears twice in verify.sh: the rebuild in a full run,
    # the hash-only variant under --fast. The documented list is the full run.
    gates = [g for g in re.findall(r'^\s*gate\s+"([^"]+)"', vsh, re.M)
             if g != "sprites (hash only)"]

    pkg = json.loads(open(os.path.join(ROOT, "package.json"), encoding="utf-8").read())
    for script_name in ("verify", "verify:fast"):
        if script_name not in pkg.get("scripts", {}):
            failures.append(
                f"the docs tell buyers to run `npm run {script_name}`, but "
                f"package.json has no \"{script_name}\" script")
        checks += 1

    GATE_COUNT = {
        "README.md": r"\*\*(\d+) gates, about",
        "README.id.md": r"\*\*(\d+) gerbang, sekitar",
        "docs/PRICING.md": r"(\d+) gates, about \d",
        "docs/PRICING.id.md": r"(\d+) gerbang, sekitar \d",
    }
    for rel, pattern in GATE_COUNT.items():
        m = want("its gate count", pattern, text.get(rel) or "", rel)
        if m and int(m.group(1)) != len(gates):
            failures.append(
                f"{rel} advertises {m.group(1)} gates; verify.sh runs "
                f"{len(gates)}")
        checks += 1

    # The table is the part a buyer reads before deciding to trust the repo,
    # so it is compared row for row and in order, not merely counted.
    for rel in ("README.md", "README.id.md"):
        body = text.get(rel) or ""
        tbl = re.search(r"^\|\s*(?:Gate|Gerbang)\s*\|[^\n]*\n\|[-| :]+\|\n"
                        r"((?:\|[^\n]*\n)+)", body, re.M)
        if not tbl:
            failures.append(
                f"{rel} no longer has a gate table this checker can read, so "
                f"its gate list cannot be held to verify.sh")
        else:
            listed = [row.split("|")[1].strip()
                      for row in tbl.group(1).strip().splitlines()]
            if listed != gates:
                missing = [g for g in gates if g not in listed]
                extra = [g for g in listed if g not in gates]
                detail = []
                if missing:
                    detail.append("missing " + ", ".join(repr(g) for g in missing))
                if extra:
                    detail.append("lists unknown " + ", ".join(repr(g) for g in extra))
                if not detail:
                    detail.append("same gates in a different order")
                failures.append(
                    f"{rel}'s gate table does not match verify.sh: "
                    + "; ".join(detail))
        checks += 1

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
