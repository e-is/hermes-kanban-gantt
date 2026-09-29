#!/usr/bin/env python3
"""Real-gateway websocket upgrade probe (spike t_01745262).

Drives a REAL `hermes dashboard` process (core mount path: include_router +
_plugin_route_secret_scope + uvicorn, plugin installed as a user plugin under a
throwaway HERMES_HOME) and answers the question the spike could not answer from
the standalone proof: **does the plugin's websocket upgrade survive the gateway?**

  1. upgrade with no credential            → must be refused, nothing leaked
  2. upgrade with the dashboard token      → must be accepted, first frame = snapshot
  3. write to the board DB from another process (CLI/dispatcher shape)
                                          → must push a new snapshot, latency measured
  4. second subscriber                     → must also be accepted (fan-out path)
  5. subscribe to a board that does not exist → refused, no crash

Usage:  python probes.py <port> <token> <board-slug> <board-db-path>
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import sys
import time

import websockets

PORT = int(sys.argv[1])
TOKEN = sys.argv[2]
BOARD = sys.argv[3]
DB = sys.argv[4]

URL = f"ws://127.0.0.1:{PORT}/api/plugins/kanban-gantt/events"
RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'} {name}{(' — ' + detail) if detail else ''}", flush=True)


def add_task(title: str) -> None:
    conn = sqlite3.connect(DB, timeout=5)
    try:
        n = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
        conn.execute(
            "INSERT INTO tasks (id, title, body, status, assignee, priority, created_at) "
            "VALUES (?, ?, '', 'todo', 'probe', 0, ?)",
            (f"probe-{n}-{int(time.time() * 1000) % 100000}", title, int(time.time())),
        )
        conn.commit()
    finally:
        conn.close()


async def read_frame(ws, timeout: float = 8.0) -> dict | None:
    try:
        raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
    except (asyncio.TimeoutError, websockets.exceptions.ConnectionClosed):
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


async def main() -> int:
    # ── 1. no credential ──────────────────────────────────────────────────
    url = f"{URL}?board={BOARD}"
    try:
        async with websockets.connect(url, open_timeout=8) as ws:
            frame = await read_frame(ws, 3)
            if frame is None:
                check("G1 unauthenticated upgrade refused", True, "accepted then closed, no frame")
            else:
                check("G1 unauthenticated upgrade refused", False, f"received {frame.get('type')}")
    except Exception as exc:
        check("G1 unauthenticated upgrade refused", True, type(exc).__name__)

    # ── 2. dashboard token ────────────────────────────────────────────────
    url = f"{URL}?board={BOARD}&token={TOKEN}"
    async with websockets.connect(url, open_timeout=8) as ws:
        first = await read_frame(ws, 8)
        ok = bool(first) and first.get("type") == "snapshot" and "tasks" in first
        check("G2 gateway accepts the upgrade and pushes a snapshot first",
              ok, f"type={first and first.get('type')} version={first and first.get('version')} "
                  f"tasks={len(first['tasks']) if ok else '?'} bytes={len(json.dumps(first or {}))}")

        # ── 3. write from another process → push ──────────────────────────
        lat: list[float] = []
        versions = []
        for i in range(3):
            t0 = time.time()
            add_task(f"[probe] gateway push {i}")
            frame = await read_frame(ws, 8)
            if frame is None:
                check(f"G3 write {i} pushed a frame", False, "no frame within 8 s")
                continue
            lat.append((time.time() - t0) * 1000)
            versions.append(frame.get("version"))
        check("G3 out-of-process writes are pushed over the gateway socket",
              len(lat) == 3, f"latencies_ms={[round(x) for x in lat]} versions={versions}")

        # ── 4. second subscriber on the same board ────────────────────────
        try:
            async with websockets.connect(url, open_timeout=8) as ws2:
                f2 = await read_frame(ws2, 8)
                check("G4 a second subscriber is accepted on the same board",
                      bool(f2) and f2.get("type") == "snapshot",
                      f"version={f2 and f2.get('version')}")
        except Exception as exc:
            check("G4 a second subscriber is accepted on the same board", False, type(exc).__name__)

    # ── 5. unknown board ──────────────────────────────────────────────────
    try:
        async with websockets.connect(f"{URL}?board=does-not-exist&token={TOKEN}", open_timeout=8) as ws:
            frame = await read_frame(ws, 3)
            check("G5 unknown board refused (no crash, no frame)", frame is None,
                  "accepted then closed" if frame is None else "got a frame")
    except Exception as exc:
        check("G5 unknown board refused (no crash, no frame)", True, type(exc).__name__)

    failed = [n for n, ok, _ in RESULTS if not ok]
    print(f"\nGATEWAY RESULT: {len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
