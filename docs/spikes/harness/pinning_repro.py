"""Reproduce the HERMES_KANBAN_DB pinning failure mode (§3/§5.1 of the baseline).

With HERMES_KANBAN_DB set (the env the dispatcher injects into every worker),
any requested slug resolves to the pinned DB: the response is served 200 with the
pinned board's tasks, relabelled with the slug the client asked for.

Usage: python pinning_repro.py   (writes ../results/pinning-repro.txt)
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
API = os.environ["GANTT_PLUGIN_API"]
PORT = int(os.environ.get("PORT", "8795"))
BASE = f"http://127.0.0.1:{PORT}"
HOME = os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))
PIN = os.environ.get("PINNED_DB", f"{HOME}/kanban/boards/gantt-demo/kanban.db")


def start(keep_pin: bool):
    env = dict(os.environ)
    env["GANTT_PLUGIN_API"] = API
    env["PORT"] = str(PORT)
    env["HERMES_KANBAN_HOME"] = HOME
    env["PYTHONPATH"] = "/home/blavenie/.hermes/hermes-agent"
    env["HERMES_KANBAN_DB"] = PIN
    if keep_pin:
        env["KEEP_PIN"] = "1"        # serve.py keeps HERMES_KANBAN_DB
    else:
        env.pop("KEEP_PIN", None)    # serve.py strips the pin itself
    proc = subprocess.Popen([sys.executable, str(HERE / "serve.py")], env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    for _ in range(100):
        if proc.poll() is not None:
            raise SystemExit(proc.stderr.read().decode()[-1500:])
        try:
            httpx.get(f"{BASE}/meta", timeout=1.0)
            return proc
        except Exception:
            time.sleep(0.2)
    proc.kill()
    raise SystemExit("no readiness")


lines = []
for label, keep in (("pin stripped (baseline harness)", False),
                    ("HERMES_KANBAN_DB set (worker env)", True)):
    proc = start(keep)
    try:
        with httpx.Client(base_url=BASE, timeout=10.0) as c:
            r = c.get("/gantt?board=sumaris-pod")
            body = r.json() if r.status_code == 200 else {"detail": r.text[:200]}
            ids = sorted(t["id"] for t in body.get("tasks", []))[:3] if r.status_code == 200 else []
            lines.append(
                f"{label}\n  GET /gantt?board=sumaris-pod -> {r.status_code} "
                f"({len(r.content)} B) board={body.get('board')!r} tasks={len(body.get('tasks', []))} "
                f"first ids={ids}\n  server saw HERMES_KANBAN_DB={PIN}")
            r2 = c.get("/gantt?board=all")
            b2 = r2.json() if r2.status_code == 200 else {}
            if r2.status_code == 200:
                per_board = {}
                for t in b2.get("tasks", []):
                    per_board[t.get("board")] = per_board.get(t.get("board"), 0) + 1
                lines.append(f"  GET /gantt?board=all -> {r2.status_code} "
                             f"({len(r2.content)} B) tasks per board={per_board}")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
    time.sleep(0.3)

out = "\n".join(lines) + "\n"
(HERE.parent / "results").mkdir(parents=True, exist_ok=True)
(HERE.parent / "results" / "pinning-repro.txt").write_text(out)
print(out)
