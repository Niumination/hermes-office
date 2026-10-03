#!/usr/bin/env python3
"""octo-watcher.py — git_push event feeder for Hermes Office (Octo 🐙).

Watches local git repos for new commits (periodic scan, no fswatch needed)
and POSTs `git_push` events to the Hermes Office server so the Octo character
appears at the GitHub desk.

Designed to run alongside mac-relay.sh (or standalone on the cloud server):
  python3 octo-watcher.py            # foreground
  python3 octo-watcher.py --once     # single scan (for cron/launchd)

Env:
  OFFICE_URL          default http://127.0.0.1:7333/event
  OFFICE_MAC_TOKEN    bearer token (falls back to ~/.hermes/.env OFFICE_MAC_TOKEN,
                      then OFFICE_CLOUD_TOKEN — so it works on both Mac and cloud)
  WATCH_ROOTS         colon-separated roots to scan for .git dirs
                      (default: $HOME/Desktop/Niumination on Mac,
                       $HOME/niumination on cloud)
  SCAN_INTERVAL       seconds between scans (default 60)
  STATE_FILE          where to persist last-seen commit per repo
                      (default ~/.hermes/office-octo-state.json)

Private repos are reported as `[private]` (SECURITY.md guest-sanitization).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

OFFICE_URL = os.environ.get("OFFICE_URL", "http://127.0.0.1:7333/event")
SCAN_INTERVAL = int(os.environ.get("SCAN_INTERVAL", "60"))
STATE_FILE = Path(os.environ.get(
    "STATE_FILE", os.environ.get("HERMES_HOME", str(Path.home() / ".hermes")) + "/office-octo-state.json"))
ONCE = "--once" in sys.argv

MAC_ROOT = str(Path.home() / "Desktop" / "Niumination")
CLOUD_ROOT = str(Path.home() / "niumination")
WATCH_ROOTS = [r for r in os.environ.get(
    "WATCH_ROOTS",
    MAC_ROOT if Path(MAC_ROOT).is_dir() else CLOUD_ROOT,
).split(":") if r]


def read_token() -> str:
    for key in ("OFFICE_MAC_TOKEN", "OFFICE_CLOUD_TOKEN"):
        tok = os.environ.get(key, "").strip()
        if tok:
            return tok
    env_path = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes")) / ".env"
    try:
        for line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            for key in ("OFFICE_MAC_TOKEN=", "OFFICE_CLOUD_TOKEN="):
                if line.startswith(key) and not line.startswith("#"):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return ""


TOKEN = read_token()


def post(payload: dict) -> None:
    if not TOKEN:
        return
    data = json.dumps(payload).encode()
    try:
        req = urllib.request.Request(
            OFFICE_URL, data=data,
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {TOKEN}"},
            method="POST")
        urllib.request.urlopen(req, timeout=5).read()
    except Exception:
        pass  # fire-and-forget — never crash the watcher


def find_repos() -> list[Path]:
    repos = []
    for root in WATCH_ROOTS:
        root_p = Path(root)
        if not root_p.is_dir():
            continue
        # shallow scan: root level + one level deep (matches ~50-repo ecosystem layout)
        for child in sorted(root_p.iterdir()):
            if (child / ".git").exists():
                repos.append(child)
            elif child.is_dir():
                for gc in sorted(child.iterdir()):
                    if (gc / ".git").exists():
                        repos.append(gc)
    return repos


def head_commit(repo: Path) -> str | None:
    git = repo / ".git"
    # worktree or plain .git dir
    try:
        r = subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=10)
        if r.returncode == 0:
            return r.stdout.strip()
        # submodule/bare fallback
        head = git / "HEAD"
        if head.exists():
            return head.read_text().strip()[:40]
    except Exception:
        pass
    return None


def is_private(repo: Path) -> bool:
    try:
        url = subprocess.run(
            ["git", "-C", str(repo), "remote", "get-url", "origin"],
            capture_output=True, text=True, timeout=10).stdout.strip()
        # heuristic: Niumination org has mixed visibility; name-based opt-out
        name = repo.name.lower()
        return any(m in name for m in ("brain", "private", "secret", "vault"))
    except Exception:
        return False


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return {}


def save_state(state: dict) -> None:
    try:
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(state, indent=1))
    except Exception:
        pass


def scan() -> None:
    state = load_state()
    changed = False
    for repo in find_repos():
        head = head_commit(repo)
        if not head:
            continue
        prev = state.get(str(repo))
        if prev and prev != head:
            name = "[private]" if is_private(repo) else repo.name
            # commit count since prev is unknown cheaply → send 1
            post({
                "type": "git_push",
                "repo": name,
                "commits": 1,
                "agent": {"name": "octo", "id": "octo", "role": "github"},
                "ts": int(time.time() * 1000),
                "meta": {"host": os.uname().nodename[:32]},
            })
            print(f"git_push: {name} {prev}..{head}")
            changed = True
        state[str(repo)] = head
    if changed or not STATE_FILE.exists():
        save_state(state)


def main() -> None:
    if not TOKEN:
        print("octo-watcher: no OFFICE_MAC_TOKEN/OFFICE_CLOUD_TOKEN — exiting", file=sys.stderr)
        sys.exit(1)
    if ONCE:
        scan()
        return
    print(f"octo-watcher: watching {WATCH_ROOTS} every {SCAN_INTERVAL}s → {OFFICE_URL}")
    while True:
        scan()
        time.sleep(SCAN_INTERVAL)


if __name__ == "__main__":
    main()
