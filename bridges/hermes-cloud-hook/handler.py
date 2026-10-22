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

_SCHEMA_LOGGED = False

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


def _agent_name(ctx: dict) -> str:
    """Resolve which of the LightVela agents produced this event."""
    for key in _TOPIC_KEYS:
        raw = ctx.get(key)
        if raw is None:
            continue
        topic = str(raw).strip()
        if topic in AGENT_TOPICS:
            return AGENT_TOPICS[topic]
    for key in _NAME_KEYS:
        raw = ctx.get(key)
        if isinstance(raw, dict):
            raw = raw.get("name") or raw.get("id")
        if isinstance(raw, str):
            slug = _slug(raw)
            if slug:
                return slug
    return DEFAULT_AGENT


def _log_schema_once(ctx: dict) -> None:
    """Record the context KEYS once so the real schema stops being a guess.

    Key names and value types only — never values. The privacy contract in
    docs/EVENTS.md 3 says message content does not leave the gateway, and a
    debug aid is not a reason to bend it.
    """
    global _SCHEMA_LOGGED
    if _SCHEMA_LOGGED:
        return
    _SCHEMA_LOGGED = True
    try:
        home = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
        home.mkdir(parents=True, exist_ok=True)
        fields = sorted(f"{k}:{type(v).__name__}" for k, v in ctx.items())
        (home / "office-bridge-schema.log").write_text(
            f"{time.strftime('%F %T')} context keys = {', '.join(fields) or '(empty)'}\n",
            encoding="utf-8",
        )
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
    _log_schema_once(ctx)
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
