"""Hermes Office bridge — gateway lifecycle hook → office-server event.

Fires on Hermes gateway lifecycle events and POSTs a normalized event to the
Hermes Office server. MUST never block or break the gateway pipeline: all work
is fire-and-forget with a hard timeout and silent failure.

Install:  cp -r bridges/hermes-cloud-hook ~/.hermes/hooks/office-bridge
Config:   OFFICE_URL    (default http://127.0.0.1:7333/event)
          OFFICE_CLOUD_TOKEN  (bearer, read from ~/.hermes/.env or environment)
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.request
from pathlib import Path

OFFICE_URL = os.environ.get("OFFICE_URL", "http://127.0.0.1:7333/event")
TIMEOUT = 2.0
_SENT_STARTUP = False

# --- agent identity -------------------------------------------------------
#
# The owner's model is KANTOR -> RUANG -> MEJA -> AGEN = machine -> category ->
# repo -> telegram topic. An AGENT IS A TOPIC. Until now this bridge stamped
# every event with agent "cloud", so all five LightVela agents arrived as one
# machine and the office drew MURID 3 over a fleet of fifteen.
#
# Topic id -> agent name. Names are prefixed "lv-" because topic numbers are
# per-chat: Mac's forum has its own topic 1, and the office roster is keyed by
# agent NAME. Without the prefix the two offices would collide into one agent.
AGENT_TOPICS = {
    "55": "lv-infra",
    "1": "lv-general",
    "838": "lv-studio",
    "5": "lv-contentvela",
}

# No topic id means the main chat, which is the gateway's own agent.
DEFAULT_AGENT = "lv-utama"

# The gateway's context schema is not declared in HOOK.yaml, so rather than
# guess one key we read every plausible one. Topic wins over an explicit name:
# a gateway that labels every session "hermes" would re-collapse the fleet
# under a different word, and the topic id is the owner's actual model.
_TOPIC_KEYS = (
    "message_thread_id",
    "topic_id",
    "thread_id",
    "message_topic_id",
    "topic",
)
_NAME_KEYS = ("agent_name", "agent", "agent_id", "persona")

# Telegram calls a DM "private"; this gateway says "dm". Both, plus whatever a
# future platform calls it, only ever serve to tell two samples apart.
_CHAT_KIND_KEYS = ("chat_type", "chat_kind")

# One schema line per (event type, chat kind, topic). Bounded so that a key we
# guessed wrong about — one holding a per-message unique value — costs 40 lines
# instead of a disk.
_SCHEMA_SEEN: set[tuple[str, str, str]] = set()
_SCHEMA_MAX = 40

# Match the mac relay (HEARTBEAT_EVERY=30); office watchdog cutoff is 90s.
HEARTBEAT_EVERY = float(os.environ.get("OFFICE_HEARTBEAT_EVERY", "30"))
_HEARTBEAT_STARTED = False
_HEARTBEAT_LOCK = threading.Lock()


def _read_token() -> str:
    """Bearer token from environment, else from the secrets .env (per-key parse, no exec)."""
    tok = os.environ.get("OFFICE_CLOUD_TOKEN", "").strip()
    if tok:
        return tok
    env_path = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes")) / ".env"
    try:
        for line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if line.startswith("OFFICE_CLOUD_TOKEN=") and not line.startswith("#"):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return ""


def _post(payload: dict) -> None:
    """Fire-and-forget POST; any failure is swallowed (never touch the gateway)."""
    token = _read_token()
    if not token:
        return
    data = json.dumps(payload).encode("utf-8")

    def _run() -> None:
        try:
            req = urllib.request.Request(
                OFFICE_URL,
                data=data,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {token}",
                },
                method="POST",
            )
            urllib.request.urlopen(req, timeout=TIMEOUT).read()
        except Exception:
            pass

    threading.Thread(target=_run, daemon=True).start()


def _slug(value: str) -> str:
    """Lowercase ASCII slug, prefixed so it can never collide with a Mac agent."""
    out = []
    for ch in value.strip().lower():
        if ch.isalnum():
            out.append(ch)
        elif ch in " _-/" and out and out[-1] != "-":
            out.append("-")
    name = "".join(out).strip("-")[:28]
    if not name:
        return ""
    return name if name.startswith("lv-") else f"lv-{name}"


def _walk(ctx: dict):
    """Yield (key, value) from ctx and one level into nested dicts / lists.

    The gateway's context turned out not to be flat: the first production
    sample was `platforms: list`, not the scalar soup this bridge assumed.
    A topic id sitting one level down must not read as "no topic at all".
    """
    for key, val in ctx.items():
        yield key, val
        if isinstance(val, dict):
            for k2, v2 in val.items():
                yield k2, v2
        elif isinstance(val, (list, tuple)):
            for item in val:
                if isinstance(item, dict):
                    for k2, v2 in item.items():
                        yield k2, v2


def _agent_name(ctx: dict) -> str:
    """Resolve which of the LightVela agents produced this event."""
    for key, raw in _walk(ctx):
        if key not in _TOPIC_KEYS or raw is None:
            continue
        topic = str(raw).strip()
        if topic in AGENT_TOPICS:
            return AGENT_TOPICS[topic]
    for key, raw in _walk(ctx):
        if key not in _NAME_KEYS:
            continue
        if isinstance(raw, dict):
            raw = raw.get("name") or raw.get("id")
        if isinstance(raw, str):
            slug = _slug(raw)
            if slug:
                return slug
    return DEFAULT_AGENT


def _schema_key(event_type: str, ctx: dict) -> tuple[str, str, str]:
    """Decide whether this context shape is already on record.

    Keyed on (event type, chat kind, topic id) and not on the event type
    alone. Under the old key the first DM to reach a freshly started gateway
    claimed `agent:start` for the whole life of the process, and every later
    event — including the group-topic ones the file was written to capture —
    was dropped before a single byte was formatted. The log looked settled
    while holding exactly the sample that could not answer the question.
    """
    kind = ""
    for key, raw in _walk(ctx):
        if key in _CHAT_KIND_KEYS and isinstance(raw, str) and raw.strip():
            kind = raw.strip()[:16]
            break
    topic = ""
    for key, raw in _walk(ctx):
        if key in _TOPIC_KEYS and raw is not None:
            text = str(raw).strip()
            if text:
                topic = text[:24]
                break
    return (event_type, kind, topic)


def _log_schema(event_type: str, ctx: dict) -> None:
    """Record the context shape once per (event type, chat kind, topic).

    The first version of this logged once, globally. In a gateway's lifetime
    the first event through here is always `gateway:startup` — a machine
    waking up, with no conversation attached — so it recorded
    `platforms: list` and nothing else. That was then read as "the gateway
    never sends a topic id", which the sample could not possibly show. The
    one event guaranteed to carry no topic is a useless place to look for one.

    So: one line per distinct (event type, chat kind, topic), appended, with
    nested keys one level deep, and a hard ceiling of _SCHEMA_MAX lines per
    process so an unexpectedly unique key cannot turn a debug aid into a leak.

    Key names and types only, EXCEPT for keys that name an id and hold a short
    scalar — those get their value too. A telegram thread id is routing
    metadata, not message content, and docs/EVENTS.md 3 is about content.
    Without the value this file tells us a topic arrived but not which one,
    which is the same dead end one layer up.
    """
    key = _schema_key(event_type, ctx)
    if key in _SCHEMA_SEEN or len(_SCHEMA_SEEN) >= _SCHEMA_MAX:
        return
    _SCHEMA_SEEN.add(key)
    try:
        home = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
        home.mkdir(parents=True, exist_ok=True)
        fields = []
        for key, val in sorted(_walk(ctx), key=lambda kv: str(kv[0])):
            tag = f"{key}:{type(val).__name__}"
            idish = any(w in str(key).lower() for w in ("id", "topic", "thread", "chat"))
            if idish and isinstance(val, (int, str)) and not isinstance(val, bool):
                text = str(val)
                if len(text) <= 24:
                    tag += f"={text}"
                else:
                    # Never print nothing. A long id used to vanish entirely,
                    # which told us a thread id arrived but not what KIND —
                    # and "55" versus a 36-char session uuid are opposite
                    # answers. The shape is the whole diagnosis, so show
                    # enough to classify it and no more.
                    tag += f"=<{len(text)}ch>{text[:8]}…"
            fields.append(tag)
        line = f"{time.strftime('%F %T')} {event_type} -> {', '.join(fields) or '(empty)'}\n"
        with (home / "office-bridge-schema.log").open("a", encoding="utf-8") as fh:
            fh.write(line)
    except OSError:
        pass


def _event_type(event_type: str) -> str | None:
    return {
        "gateway:startup": "agent_status",
        "session:start": "agent_spawned",
        "agent:start": "tool_call",
        "agent:step": "tool_call",
        "agent:end": "agent_finished",
        "session:end": "agent_finished",
    }.get(event_type)


def _heartbeat_loop() -> None:
    """Re-assert liveness so the office watchdog does not mark cloud 'away'."""
    while True:
        time.sleep(HEARTBEAT_EVERY)
        try:
            _post(
                {
                    "type": "agent_status",
                    "agent": {"name": "cloud", "role": "generalist", "id": "cloud"},
                    "state": "idle",
                    "ts": int(time.time() * 1000),
                }
            )
        except Exception:
            pass


def _ensure_heartbeat() -> None:
    """Start the heartbeat thread once, on first hook invocation.

    The office-server marks an agent 'away' after 90s of silence. This bridge
    previously sent agent_status exactly once (_SENT_STARTUP) and nothing
    after, so the cloud agent appeared permanently away. The mac relay already
    did this (HEARTBEAT_EVERY=30); cloud was the odd one out.
    """
    global _HEARTBEAT_STARTED
    with _HEARTBEAT_LOCK:
        if _HEARTBEAT_STARTED:
            return
        _HEARTBEAT_STARTED = True
    threading.Thread(target=_heartbeat_loop, name="office-heartbeat", daemon=True).start()


def handle(event_type: str, context: dict) -> None:
    """Entry point invoked by the gateway hook registry (sync; work is queued off-thread)."""
    global _SENT_STARTUP
    _ensure_heartbeat()
    mapped = _event_type(event_type)
    if not mapped:
        return
    ctx = context or {}
    _log_schema(event_type, ctx)
    who = _agent_name(ctx)
    base = {
        "type": mapped,
        "agent": {
            "name": who,
            "role": "generalist",
            "id": who,
        },
        "ts": int(time.time() * 1000),
        "meta": {
            "platform": str(ctx.get("platform", ""))[:32],
            "chat_type": str(ctx.get("chat_type", ""))[:16],
            "session_id": str(ctx.get("session_id", ""))[:64],
        },
    }
    if mapped == "agent_status":
        if _SENT_STARTUP:
            return
        _SENT_STARTUP = True
        # gateway:startup is a MACHINE fact, not an agent one: the box came up,
        # nobody has spoken yet. Attributing it to an agent would put a worker
        # in a room on the strength of a reboot.
        base["agent"] = {"name": "cloud", "role": "generalist", "id": "cloud"}
        base["state"] = "idle"
    elif mapped == "agent_spawned":
        base["agent"]["task"] = str(ctx.get("message", ""))[:200]
    elif mapped == "tool_call":
        base["agentId"] = who
        base["tool"] = "agent_step"
        # Do NOT forward message content to the office (privacy); only length.
        base["detail"] = f"step ({len(str(ctx.get('message', '')))} chars)"
    elif mapped == "agent_finished":
        base["agentId"] = who
        base["summary"] = ""
    _post(base)
