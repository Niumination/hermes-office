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


def _event_type(event_type: str) -> str | None:
    return {
        "gateway:startup": "agent_status",
        "session:start": "agent_spawned",
        "agent:start": "tool_call",
        "agent:step": "tool_call",
        "agent:end": "agent_finished",
        "session:end": "agent_finished",
    }.get(event_type)


def handle(event_type: str, context: dict) -> None:
    """Entry point invoked by the gateway hook registry (sync; work is queued off-thread)."""
    global _SENT_STARTUP
    mapped = _event_type(event_type)
    if not mapped:
        return
    ctx = context or {}
    base = {
        "type": mapped,
        "agent": {
            "name": "cloud",
            "role": "generalist",
            "id": "cloud",
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
        base["state"] = "idle"
    elif mapped == "agent_spawned":
        base["agent"]["task"] = str(ctx.get("message", ""))[:200]
    elif mapped == "tool_call":
        base["agentId"] = "cloud"
        base["tool"] = "agent_step"
        # Do NOT forward message content to the office (privacy); only length.
        base["detail"] = f"step ({len(str(ctx.get('message', '')))} chars)"
    elif mapped == "agent_finished":
        base["agentId"] = "cloud"
        base["summary"] = ""
    _post(base)
