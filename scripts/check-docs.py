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
