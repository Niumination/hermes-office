"""
hermes_emit — one-way telemetry from the Hermes ecosystem into Hermes Office.

Why this exists
---------------
Hermes Office can draw twelve kinds of activity, the server validates seventeen
event types, and `POST /event` has been live since day one. None of it moved,
because nothing in the ecosystem ever called it. The office was a window onto a
room nobody walked into.

This module is the thing that walks in. Point it at the office once, then call
`emit_*` from the Telegram gateway, the WhatsApp gateway, Hermes Desktop, or the
A2A peer, and the office starts mirroring real work.

The prime directive
-------------------
**This module must never break its caller.** A gateway that drops a user's
Telegram message because a dashboard was down is worse than no dashboard. So:

  - every public function returns None and raises nothing, ever;
  - the network call happens on a daemon worker thread, never inline;
  - the queue is bounded — when the office is slow, events are dropped, not
    buffered until the gateway runs out of memory;
  - a local rate limiter matches the server's (120/min, burst 30/5s) so a busy
    gateway degrades by shedding rather than by collecting 429s;
  - there are no third-party dependencies. urllib only. Nothing to install,
    nothing to keep patched, no supply-chain surface added to a gateway that
    handles your messages.

Privacy posture
---------------
`docs/EVENTS.md` §3 forbids message content, chat names and user ids on
`channel_msg`, and the server rejects any event carrying them. Rather than make
each caller remember that, `emit_channel_msg` accepts only the fields that are
allowed and silently ignores the rest. The safe thing is the easy thing.

Usage
-----
    from hermes_emit import configure, emit_channel_msg, emit_agent_status

    configure()                      # reads env / ~/.hermes/.env

    emit_channel_msg(platform="telegram", direction="in", agent="cloud")
    emit_agent_status(agent="cloud", state="working")

Configuration (first match wins):
    OFFICE_URL      e.g. https://dash.abstract.biz.id   (or .../event)
    OFFICE_TOKEN    bridge bearer token
    ~/.hermes/.env  OFFICE_URL= / OFFICE_TOKEN= lines

If neither is set, every call becomes a no-op. That is deliberate: importing
this module into a gateway that has not been configured must change nothing.
"""

from __future__ import annotations

import atexit
import json
import os
import queue
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Optional

__all__ = [
    "configure",
    "is_enabled",
    "stats",
    "flush",
    "emit",
    "emit_channel_msg",
    "emit_agent_status",
    "emit_agent_spawned",
    "emit_agent_finished",
    "emit_tool_call",
    "emit_tool_done",
    "emit_mcp_call",
    "emit_a2a_task_in",
    "emit_a2a_task_out",
    "emit_task_update",
    "emit_git_push",
    "emit_cron_fired",
]

# --------------------------------------------------------------------------
# Contract mirrors — keep in step with server/eventbus.js
# --------------------------------------------------------------------------

#: Event types a bridge is allowed to POST. The server also knows five
#: internal-only types (office_chat, agent_moved,
#: approval_requested, approval_resolved); sending those earns a 400, so they
#: are not listed here.
BRIDGE_EVENT_TYPES = frozenset(
    {
        "agent_spawned",
        "agent_finished",
        "tool_call",
        "tool_done",
        "mcp_call",
        "a2a_task_in",
        "a2a_task_out",
        "task_update",
        "cron_fired",
        "git_push",
        "channel_msg",
        "agent_status",
        "service_status",
    }
)

#: A2A v1.0 lifecycle, mirrored from A2A_STATES in server/eventbus.js. An
#: unknown state is dropped here rather than earning a 400 nobody reads.
TASK_STATES = frozenset(
    {
        "sent",  # legacy, == submitted
        "submitted",
        "working",
        "input_required",
        "auth_required",
        "completed",
        "failed",
        "canceled",
        "rejected",
    }
)

#: server/eventbus.js STATUS_STATES
AGENT_STATES = frozenset({"idle", "working", "away"})

#: server/eventbus.js DIRECTIONS
DIRECTIONS = frozenset({"in", "out"})

#: Fields the server refuses on channel_msg (EVENTS.md §3). Listed so the
#: scrubber below stays readable, and so a reader can see exactly what this
#: module guarantees never leaves the machine.
CHANNEL_MSG_FORBIDDEN = frozenset(
    {"text", "message", "chatName", "userId", "chatId", "fromUser"}
)

#: EVENTS.md §1
MAX_STRING_LEN = 500

# Server limiter is 120/min with a 30-per-5s burst. Staying just under it means
# a chatty gateway sheds its own excess instead of being throttled, which keeps
# the office's rate-limit counters meaningful for real anomalies.
_RATE_PER_MINUTE = 110
_RATE_BURST = 25
_RATE_BURST_WINDOW_S = 5.0

_QUEUE_MAX = 256
_HTTP_TIMEOUT_S = 3.0
_RETRY_DELAYS_S = (0.5, 2.0)  # two retries, then drop


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------


def _read_dotenv(path: str) -> Dict[str, str]:
    """Parse KEY=VALUE lines. Never raises: an unreadable file yields {}."""
    out: Dict[str, str] = {}
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                out[k.strip()] = v.strip().strip("'\"")
    except Exception:
        pass
    return out


def _normalise_url(raw: str) -> str:
    """Accept a bare origin or a full /event URL; always return the /event URL."""
    url = raw.strip().rstrip("/")
    if not url:
        return ""
    if url.endswith("/event"):
        return url
    return url + "/event"


class _State:
    def __init__(self) -> None:
        self.url: str = ""
        self.token: str = ""
        self.source: str = ""
        self.lock = threading.Lock()
        self.q: "queue.Queue[Dict[str, Any]]" = queue.Queue(maxsize=_QUEUE_MAX)
        self.worker: Optional[threading.Thread] = None
        self.sent = 0
        self.dropped_full = 0
        self.dropped_rate = 0
        self.dropped_invalid = 0
        self.failed = 0
        self._minute: list = []
        self._burst: list = []


_s = _State()


def configure(
    url: Optional[str] = None,
    token: Optional[str] = None,
    source: Optional[str] = None,
    dotenv_path: Optional[str] = None,
) -> bool:
    """
    Point this process at an office. Safe to call more than once.

    Resolution order: explicit argument → environment → ~/.hermes/.env.

    Returns True when an office is configured. A False return is not an error
    and is not logged: an unconfigured gateway simply emits nothing.
    """
    env_path = dotenv_path or os.path.expanduser("~/.hermes/.env")
    dotenv = _read_dotenv(env_path)

    resolved_url = (
        url
        or os.environ.get("OFFICE_URL")
        or dotenv.get("OFFICE_URL")
        or ""
    )
    resolved_token = (
        token
        or os.environ.get("OFFICE_TOKEN")
        or os.environ.get("OFFICE_MAC_TOKEN")
        or os.environ.get("OFFICE_CLOUD_TOKEN")
        or dotenv.get("OFFICE_TOKEN")
        or dotenv.get("OFFICE_MAC_TOKEN")
        or ""
    )

    with _s.lock:
        _s.url = _normalise_url(resolved_url)
        _s.token = resolved_token.strip()
        _s.source = (
            source
            or os.environ.get("OFFICE_SOURCE")
            or dotenv.get("OFFICE_SOURCE")
            or "hermes-emit"
        )
        enabled = bool(_s.url and _s.token)
        if enabled and (_s.worker is None or not _s.worker.is_alive()):
            _s.worker = threading.Thread(
                target=_run_worker, name="hermes-emit", daemon=True
            )
            _s.worker.start()
    return enabled


def is_enabled() -> bool:
    """True when both a URL and a token are known."""
    with _s.lock:
        return bool(_s.url and _s.token)


def stats() -> Dict[str, int]:
    """
    Counters for an operator who wants to know whether the bridge is healthy
    without turning on logging. `dropped_rate` climbing means the gateway is
    busier than the office's limiter allows; `failed` climbing means the office
    is unreachable.
    """
    with _s.lock:
        return {
            "sent": _s.sent,
            "failed": _s.failed,
            "dropped_full": _s.dropped_full,
            "dropped_rate": _s.dropped_rate,
            "dropped_invalid": _s.dropped_invalid,
            "queued": _s.q.qsize(),
        }


# --------------------------------------------------------------------------
# Rate limiting — mirrors the server so we shed before it does
# --------------------------------------------------------------------------


def _allow_now() -> bool:
    now = time.monotonic()
    _s._minute = [t for t in _s._minute if now - t < 60.0]
    _s._burst = [t for t in _s._burst if now - t < _RATE_BURST_WINDOW_S]
    if len(_s._minute) >= _RATE_PER_MINUTE or len(_s._burst) >= _RATE_BURST:
        return False
    _s._minute.append(now)
    _s._burst.append(now)
    return True


# --------------------------------------------------------------------------
# Worker
# --------------------------------------------------------------------------


def _post_once(payload: Dict[str, Any]) -> bool:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        _s.url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {_s.token}",
            "User-Agent": "hermes-emit/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT_S) as resp:
            return 200 <= resp.status < 300
    except urllib.error.HTTPError as exc:
        # 4xx is our fault and will not improve on retry — drop it. The one
        # exception is 429: the office is busy, so backing off is correct.
        if exc.code == 429:
            return False
        return True  # "handled": stop retrying a malformed or rejected event
    except Exception:
        return False


def _run_worker() -> None:
    while True:
        payload = _s.q.get()
        if payload is None:  # shutdown sentinel
            _s.q.task_done()
            return
        ok = False
        for attempt in range(len(_RETRY_DELAYS_S) + 1):
            ok = _post_once(payload)
            if ok:
                break
            if attempt < len(_RETRY_DELAYS_S):
                time.sleep(_RETRY_DELAYS_S[attempt])
        with _s.lock:
            if ok:
                _s.sent += 1
            else:
                _s.failed += 1
        _s.q.task_done()


def flush(timeout: float = 5.0) -> bool:
    """
    Block until queued events are delivered. Only useful in short-lived
    scripts; long-running gateways should never call it. Returns True if the
    queue drained in time.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if _s.q.empty():
            return True
        time.sleep(0.05)
    return _s.q.empty()


def _shutdown() -> None:
    try:
        flush(timeout=2.0)
    except Exception:
        pass


atexit.register(_shutdown)


# --------------------------------------------------------------------------
# Core emit
# --------------------------------------------------------------------------


def _clamp(value: Any) -> Any:
    if isinstance(value, str) and len(value) > MAX_STRING_LEN:
        return value[:MAX_STRING_LEN]
    return value


def emit(event_type: str, **fields: Any) -> None:
    """
    Queue one event. Returns immediately; never raises.

    Prefer the typed `emit_*` helpers — they encode the server's required
    fields, so a mistake is caught here rather than silently 400-ing in
    production where nobody is reading the response.
    """
    try:
        if not is_enabled():
            return
        if event_type not in BRIDGE_EVENT_TYPES:
            with _s.lock:
                _s.dropped_invalid += 1
            return

        payload: Dict[str, Any] = {"type": event_type}
        for key, value in fields.items():
            if value is None:
                continue
            payload[key] = _clamp(value)
        payload.setdefault("source", _s.source)

        if not _allow_now():
            with _s.lock:
                _s.dropped_rate += 1
            return
        try:
            _s.q.put_nowait(payload)
        except queue.Full:
            with _s.lock:
                _s.dropped_full += 1
    except Exception:
        # The prime directive. Nothing that happens in here may surface.
        return


# --------------------------------------------------------------------------
# Typed helpers — one per event the office can draw
# --------------------------------------------------------------------------


def emit_channel_msg(
    platform: str,
    direction: str = "in",
    agent: Optional[str] = None,
    channel_type: Optional[str] = None,
) -> None:
    """
    A message crossed a chat gateway. This is the event that makes the office
    move when you type into Telegram.

    Content is *not* a parameter and cannot be passed. Only the shape of the
    traffic travels: which platform, which way, which agent. The office shows
    that you are talking to an agent, never what you said.
    """
    if direction not in DIRECTIONS:
        direction = "in"
    emit(
        "channel_msg",
        platform=platform,
        direction=direction,
        agent=agent,
        channelType=channel_type,
    )


def emit_agent_status(agent: str, state: str) -> None:
    """
    Heartbeat / liveness. `state` is one of idle, working, away.

    The office marks an agent away after 90s without one of these, so a
    long-running agent should re-send every 30s.
    """
    if state not in AGENT_STATES:
        return
    emit("agent_status", agent=agent, state=state)


def emit_agent_spawned(
    name: str, role: Optional[str] = None, agent_id: Optional[str] = None
) -> None:
    """A new agent came into existence. `agent` must be an object server-side."""
    agent: Dict[str, Any] = {"name": name}
    if role:
        agent["role"] = role
    if agent_id:
        agent["id"] = agent_id
    emit("agent_spawned", agent=agent)


def emit_agent_finished(agent_id: str, result: Optional[str] = None) -> None:
    """An agent run ended."""
    emit("agent_finished", agentId=agent_id, result=result)


def emit_tool_call(agent_id: str, tool: str, target: Optional[str] = None) -> None:
    """An agent started using a tool. Drives the working animation."""
    emit("tool_call", agentId=agent_id, tool=tool, target=target)


def emit_tool_done(
    agent_id: str, tool: Optional[str] = None, ok: Optional[bool] = None
) -> None:
    """A tool call finished."""
    emit("tool_done", agentId=agent_id, tool=tool, ok=ok)


def emit_mcp_call(server: str, tool: str, agent_id: Optional[str] = None) -> None:
    """An MCP tool was invoked."""
    emit("mcp_call", server=server, tool=tool, agentId=agent_id)


def emit_a2a_task_in(
    dest: str,
    peer: Optional[str] = None,
    task_id: Optional[str] = None,
    summary: Optional[str] = None,
) -> None:
    """
    A peer handed this machine a task. `dest` is the agent receiving it.

    `summary` is shown verbatim in the office, so pass a label ("repo X: fix
    build"), never the full prompt.
    """
    emit("a2a_task_in", dest=dest, peer=peer, taskId=task_id, summary=summary)


def emit_a2a_task_out(
    origin: str,
    state: str = "working",
    peer: Optional[str] = None,
    task_id: Optional[str] = None,
    summary: Optional[str] = None,
) -> None:
    """
    This machine's task to a peer changed state.

    `state` accepts the A2A v1.0 lifecycle (submitted, working, input_required,
    auth_required, completed, failed, canceled, rejected) as well as the legacy
    `sent`. Older office builds only know sent/working/completed/failed and
    will answer 400 for the rest; that is a dropped event, not a broken
    gateway.
    """
    emit(
        "a2a_task_out",
        origin=origin,
        state=state,
        peer=peer,
        taskId=task_id,
        summary=summary,
    )


def emit_task_update(
    task_id: str,
    state: str = "working",
    title: Optional[str] = None,
    agent: Optional[str] = None,
    origin: Optional[str] = None,
    repo: Optional[str] = None,
) -> None:
    """
    Put a task on the Amanat board, or move one along.

    This is the event that answers "working on *what*". Everything else the
    office draws describes posture — who is online, which room, which tool.
    Without this the board stays empty no matter how busy the fleet looks.

    `origin` should say where the order came from (`telegram`, `whatsapp`,
    `desktop`, `a2a`, `cron`), not which machine relayed it. The office uses
    it to show how you actually give orders.

    `title` is displayed verbatim to the owner and redacted for guests, so a
    short label is right — "repo X: fix build", never the whole prompt.
    """
    if state not in TASK_STATES:
        return
    emit(
        "task_update",
        taskId=task_id,
        state=state,
        title=title,
        agent=agent,
        origin=origin,
        repo=repo,
    )


def emit_git_push(
    repo: str,
    branch: Optional[str] = None,
    commits: Optional[int] = None,
    agent_id: Optional[str] = None,
) -> None:
    """Code reached a remote."""
    emit("git_push", repo=repo, branch=branch, commits=commits, agentId=agent_id)


def emit_cron_fired(job: str, dest: Optional[str] = None, ok: Optional[bool] = None) -> None:
    """A scheduled job ran."""
    emit("cron_fired", job=job, dest=dest, ok=ok)


# --------------------------------------------------------------------------
# Self-check
# --------------------------------------------------------------------------

if __name__ == "__main__":  # pragma: no cover
    import sys

    ok = configure()
    print(f"configured : {ok}")
    print(f"url        : {_s.url or '(unset)'}")
    print(f"token      : {'set' if _s.token else '(unset)'}")
    print(f"source     : {_s.source}")
    if not ok:
        print("\nSet OFFICE_URL and OFFICE_TOKEN, or put them in ~/.hermes/.env")
        sys.exit(1)

    print("\nsending a probe (channel_msg, telegram, in) …")
    emit_channel_msg(platform="telegram", direction="in", agent="cloud")
    flush(timeout=6.0)
    print(json.dumps(stats(), indent=2))
    sys.exit(0 if stats()["sent"] else 2)
