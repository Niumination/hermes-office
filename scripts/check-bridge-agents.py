#!/usr/bin/env python3
"""Gate: the cloud bridge must attribute events to the agent that caused them.

Why this file exists
--------------------
For weeks the office drew MURID 3 over a fleet of fifteen. Nothing was broken
in the obvious sense: the bridge was alive, the server accepted its events, the
watchdog was happy. The bug was that `handler.py` stamped every single event
with agent "cloud", so five LightVela agents arrived as one machine.

That bug survived because no test ever asked "who did this event say it was?".
The same thing happened once before in this repo: `targetRoomFor()` had no test
and quietly mis-read the agent field for months. Two bugs, one root cause — an
attribution contract with nobody checking it. So it gets a gate.

Run: python3 scripts/check-bridge-agents.py
"""

from __future__ import annotations

import importlib.util
import pathlib
import sys

HANDLER = pathlib.Path(__file__).resolve().parents[1] / "bridges" / "hermes-cloud-hook" / "handler.py"


def load():
    spec = importlib.util.spec_from_file_location("office_hook", HANDLER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


CASES = [
    # (context, expected agent, why it matters)
    ({"message_thread_id": 55}, "lv-infra", "telegram sends thread ids as ints"),
    ({"message_thread_id": "55"}, "lv-infra", "and sometimes as strings"),
    ({"topic_id": 838}, "lv-studio", "alternate key name"),
    ({"thread_id": 5}, "lv-contentvela", "alternate key name"),
    ({"message_thread_id": 1}, "lv-general", "the General topic is id 1"),
    ({}, "lv-utama", "no topic means the main chat"),
    ({"message_thread_id": 99999}, "lv-utama", "an unknown topic must not invent an agent"),
    ({"agent": {"name": "Studio"}}, "lv-studio", "object-form agent, as the hook contract allows"),
    ({"agent_name": "Infra"}, "lv-infra", "string-form agent"),
    ({"agent": {}}, "lv-utama", "an empty object is not an identity"),
    ({"agent": None}, "lv-utama", "neither is None"),
    # The one that protects the whole design: a gateway that labels every
    # session with one generic word must not re-collapse the fleet.
    (
        {"message_thread_id": 55, "agent_name": "hermes"},
        "lv-infra",
        "the topic id outranks a generic gateway label",
    ),
    # Names must stay namespaced: Mac's forum has its own topic 1, and the
    # roster is keyed by agent NAME. Without the prefix the offices collide.
    ({"agent_name": "something new"}, "lv-something-new", "unknown names are slugged and prefixed"),
    ({"agent_name": "lv-already"}, "lv-already", "an already-prefixed name is not double-prefixed"),
]


def main() -> int:
    mod = load()
    failures = []

    for ctx, want, why in CASES:
        got = mod._agent_name(ctx)
        if got != want:
            failures.append(f"    {ctx!r}\n      expected {want!r}, got {got!r}  ({why})")

    # The machine heartbeat must stay machine-level: `cloud` is PERMANENT_CAST
    # and represents the box, not a worker. If this drifts, the LightVela office
    # loses its only always-on occupant.
    if mod.DEFAULT_AGENT == "cloud":
        failures.append("    DEFAULT_AGENT collapsed back to 'cloud'")

    # Every mapped topic must produce a distinct agent, or we are back to the
    # original bug wearing a different mask.
    names = list(mod.AGENT_TOPICS.values())
    if len(names) != len(set(names)):
        failures.append(f"    AGENT_TOPICS maps two topics onto one agent: {names}")

    if failures:
        print("FAIL: bridge agent attribution")
        print("\n".join(failures))
        return 1

    print(f"PASS: bridge agent attribution ({len(CASES)} cases, {len(names)} topics mapped)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
