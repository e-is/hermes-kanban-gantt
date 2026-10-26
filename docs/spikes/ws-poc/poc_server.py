#!/usr/bin/env python3
"""SPIKE — throwaway PoC server: the plugin's REAL push route on a sandbox board.

Nothing here is wired into a production path. It boots the same FastAPI app the
plugin serves (`dashboard/plugin_api.create_app`, which mounts
`dashboard/plugin_ws.py`'s `/events` websocket), against a throwaway kanban
board created through the real domain layer (`hermes_cli.kanban_db`), so the
schema and the payload are the production ones — no stand-in shape.

Isolation:
  * `KANBAN_GANTT_BOARDS` / `HERMES_KANBAN_HOME` point at a scratch dir, so the
    real profile's boards are physically unreachable.
  * `KANBAN_GANTT_WS=1` + `KANBAN_GANTT_WS_TOKEN=<token>`: the same env-only
    feature flag the gateway uses. With `KANBAN_GANTT_WS=0` the route is not
    registered at all.
  * The board is created by this process and deleted with the scratch dir.

Prints one JSON line and then serves until SIGTERM/SIGINT:

    {"ready": true, "port": 8791, "board": "ws-poc", "boards": "...", "pid": 123,
     "url": "ws://127.0.0.1:8791/events?board=ws-poc&token=..."}

Usage (usually spawned by poc_bench.py):
    PYTHONPATH=$HOME/.hermes/hermes-agent \
      ~/.hermes/hermes-agent/venv/bin/python docs/spikes/ws-poc/poc_server.py \
      --port 8791 --tasks 20 --token poc-token
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parents[3] / "dashboard"
BOARD = "ws-poc"


def prepare_sandbox(sandbox: Path, tasks: int) -> Path:
    """Throwaway boards root + one board built through the real domain layer."""
    boards = sandbox / "kanban" / "boards"
    os.environ["KANBAN_GANTT_BOARDS"] = str(boards)
    os.environ["HERMES_KANBAN_HOME"] = str(sandbox)
    os.environ["HERMES_HOME"] = str(sandbox)
    # A kanban worker's env pins one board DB; the PoC must resolve its own slug.
    for var in ("HERMES_KANBAN_DB", "HERMES_KANBAN_BOARD",
                "HERMES_DELEGATED_CHILD_CONTEXT"):
        os.environ.pop(var, None)

    sys.path.insert(0, str(PLUGIN_DIR))
    from hermes_cli import kanban_db, kanban_db_boards, kanban_db_connect

    kanban_db_boards.create_board(BOARD)
    conn = kanban_db_connect.connect(board=BOARD)
    try:
        for i in range(tasks):
            kanban_db.create_task(
                conn, title=f"[POC] seed task {i:02d}",
                priority=i % 4, created_by="ws-poc",
                assignee="default" if i % 2 == 0 else None,
            )
    finally:
        conn.close()
    return boards / BOARD / "kanban.db"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8791)
    ap.add_argument("--tasks", type=int, default=20)
    ap.add_argument("--token", default="poc-token")
    ap.add_argument("--sandbox", default="")
    args = ap.parse_args()

    sandbox = Path(args.sandbox) if args.sandbox else Path(
        tempfile.mkdtemp(prefix="kg-ws-poc-"))
    sandbox.mkdir(parents=True, exist_ok=True)

    # Env-only configuration: exactly the knobs the shipped plugin reads.
    os.environ.setdefault("KANBAN_GANTT_WS", "1")
    os.environ.setdefault("KANBAN_GANTT_WS_TOKEN", args.token)
    db = prepare_sandbox(sandbox, args.tasks)

    import uvicorn  # noqa: E402  (after the sandbox env is in place)
    import plugin_api  # noqa: E402

    app = plugin_api.create_app(allow_cors=False)
    routes = [getattr(r, "path", "") for r in app.routes]
    print(json.dumps({
        "ready": True,
        "port": args.port,
        "board": BOARD,
        "db": str(db),
        "boards": str(sandbox / "kanban" / "boards"),
        "pid": os.getpid(),
        "events_route": any(p.endswith("/events") for p in routes),
        "url": f"ws://127.0.0.1:{args.port}/events?board={BOARD}&token={args.token}",
    }), flush=True)

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning",
                ws_ping_interval=None, ws_ping_timeout=None)
    return 0


if __name__ == "__main__":
    sys.exit(main())
