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
import os
import pathlib
import sys
import tempfile

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
    # --- nested shapes -----------------------------------------------------
    # Production's first schema sample came back `platforms: list`, not the
    # flat scalar soup this bridge originally assumed. A topic id one level
    # down must not read as "no topic at all".
    (
        {"platforms": [{"name": "telegram", "message_thread_id": 55}]},
        "lv-infra",
        "topic inside a list of platform dicts",
    ),
    ({"message": {"message_thread_id": 838}}, "lv-studio", "topic inside a nested dict"),
    (
        {"platforms": [{"name": "telegram"}], "topic_id": 5},
        "lv-contentvela",
        "nested platforms plus a top-level topic",
    ),
    ({"platforms": ["telegram"]}, "lv-utama", "a list of plain strings is not an identity"),
    # Production sends `thread_id` as a STRING. Both shapes must resolve, and
    # a session uuid that merely happens to live under an id-ish key must not.
    ({"thread_id": "55"}, "lv-infra", "thread_id arrives as a string in production"),
    (
        {"thread_id": "c0ffee12-3456-7890-abcd-ef0123456789"},
        "lv-utama",
        "a session uuid is not a telegram topic",
    ),
]


DM = {
    "chat_id": 2077300493,
    "chat_type": "dm",
    "message": "halo",
    "platform": "telegram",
    "session_id": "20261017_150749_e462ccf0",
    "thread_id": "",
    "user_id": 2077300493,
}
GROUP_55 = dict(DM, chat_id=-1004204696417, chat_type="supergroup", thread_id="55")
GROUP_838 = dict(GROUP_55, thread_id="838")


def read_log(mod, home) -> list[str]:
    path = pathlib.Path(home) / "office-bridge-schema.log"
    if not path.exists():
        return []
    return [ln for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]


def check_schema_log(mod, failures) -> int:
    """The debug log must survive its own first sample.

    This is the gate the previous round was missing. `_log_schema` recorded
    one line per event type, so the first DM to reach a fresh gateway claimed
    `agent:start` permanently and every group-topic event after it was
    discarded before formatting. The file read as settled while holding the
    one sample that could not answer the question it existed for: which topic
    id does a forum message carry? A diagnostic that drops the evidence is
    worse than no diagnostic, because it is trusted.
    """
    checks = 0

    def fresh():
        home = tempfile.mkdtemp()
        os.environ["HERMES_HOME"] = home
        mod._SCHEMA_SEEN.clear()
        return home

    # 1. A DM first, then the same event type from a group topic: BOTH recorded.
    home = fresh()
    mod._log_schema("agent:start", DM)
    mod._log_schema("agent:start", GROUP_55)
    lines = read_log(mod, home)
    checks += 1
    if len(lines) != 2:
        failures.append(
            f"    a group-topic agent:start after a DM was dropped: {len(lines)} line(s), expected 2"
        )
    elif "thread_id:str=55" not in lines[1]:
        failures.append(f"    the group line does not carry the topic id: {lines[1]!r}")

    # 2. Deduplication still holds — the log must not grow once per event.
    checks += 1
    for _ in range(5):
        mod._log_schema("agent:start", DM)
        mod._log_schema("agent:start", GROUP_55)
    if len(read_log(mod, home)) != 2:
        failures.append("    repeating identical contexts kept appending lines")

    # 3. A second topic in the same chat is a separate sample, not a duplicate.
    checks += 1
    mod._log_schema("agent:start", GROUP_838)
    lines = read_log(mod, home)
    if len(lines) != 3 or "thread_id:str=838" not in lines[2]:
        failures.append(f"    a second topic did not produce its own line: {lines!r}")

    # 4. Bounded. If `thread_id` ever turns out to hold a per-message unique
    #    value, this costs _SCHEMA_MAX lines instead of unbounded disk.
    checks += 1
    home = fresh()
    for i in range(mod._SCHEMA_MAX * 3):
        mod._log_schema("agent:step", dict(GROUP_55, thread_id=str(900000 + i)))
    if len(read_log(mod, home)) > mod._SCHEMA_MAX:
        failures.append(f"    schema log is unbounded (> {mod._SCHEMA_MAX} lines)")

    # 5. A long id is still classified rather than hidden: "55" and a session
    #    uuid are opposite answers, so the shape has to survive truncation.
    checks += 1
    home = fresh()
    mod._log_schema("agent:start", dict(DM, thread_id="c0ffee12-3456-7890-abcd-ef0123456789"))
    lines = read_log(mod, home)
    if not lines or "thread_id:str=<36ch>c0ffee12" not in lines[0]:
        failures.append(f"    a long thread id lost its shape: {lines!r}")

    os.environ.pop("HERMES_HOME", None)
    return checks


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

    schema_checks = check_schema_log(mod, failures)

    if failures:
        print("FAIL: bridge agent attribution")
        print("\n".join(failures))
        return 1

    print(
        f"PASS: bridge agent attribution ({len(CASES)} cases, {len(names)} topics mapped, "
        f"{schema_checks} schema-log checks)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
