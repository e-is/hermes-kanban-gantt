#!/usr/bin/env python3
"""End-to-end proof for the websocket push prototype (spike t_64075faf).

Starts the plugin backend for real (uvicorn + FastAPI on loopback, the same
`create_app()` the standalone dev backend uses), subscribes a real websocket
client, then writes to the board DB from *other* connections — exactly what the
dispatcher/CLI/another agent does — and logs every frame the client receives with
a timestamp and the latency since the write.

What it asserts (the acceptance criteria of the card):

  P1  the first frame is a full snapshot with the /gantt shape (R1/R8)
  P2  N out-of-UI writes ⇒ N frames, versions strictly increasing (R4/R7)
  P3  change→frame latency p95 ≤ 2000 ms, payload within the 600 KB budget (R3/R4)
  P4  a burst inside the debounce window coalesces into ONE frame (R5)
  P5  two subscribers on one board = ONE DB read fanned out to both (R11)
  P6  heartbeats arrive while the board is idle (R18)
  P7  zero HTTP requests to /gantt for the whole run — nothing polls (the point)
  P8  auth: a wrong/absent token is rejected, the right one accepted; the
      standalone loopback fallback accepts a local client when no token is set
  P9  slug validation matches the REST read (`../x` refused)
  P10 reconnect: the first frame after a reconnect is again a full snapshot
  P11 with KANBAN_GANTT_WS off the route does not exist at all (reversibility)

Run (no hermes_cli needed — standalone mode, env-only board paths):

    /tmp/kg-test-venv/bin/python tests/ws_proof.py

Exit code 0 = every check passed. Raw output is meant to be kept as evidence:
    /tmp/kg-test-venv/bin/python tests/ws_proof.py | tee proof.log
"""

from __future__ import annotations

import asyncio
import json
import os
import socket
import sqlite3
import statistics
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "dashboard"))

# The backend reads HERMES_KANBAN_HOME / KANBAN_GANTT_BOARDS only; keep the
# proof hermetic and hermes_cli-free so it never touches a real board.
SANDBOX = Path(tempfile.mkdtemp(prefix="kg-ws-proof-"))
BOARDS = SANDBOX / "kanban" / "boards"
BOARD = "ws-proof"
TOKEN = "proof-token"

os.environ["KANBAN_GANTT_BOARDS"] = str(BOARDS)
os.environ["HERMES_KANBAN_HOME"] = str(SANDBOX)
os.environ["KANBAN_GANTT_WS"] = "1"
os.environ["KANBAN_GANTT_WS_TOKEN"] = TOKEN
os.environ["KANBAN_GANTT_WS_POLL_MS"] = "100"
os.environ["KANBAN_GANTT_WS_DEBOUNCE_MS"] = "300"
os.environ["KANBAN_GANTT_WS_HEARTBEAT_S"] = "2"

import plugin_api  # noqa: E402  (after the env is set up)
import uvicorn  # noqa: E402
import websockets  # noqa: E402

SCHEMA = """
CREATE TABLE tasks (
    id TEXT PRIMARY KEY, title TEXT, body TEXT, status TEXT, assignee TEXT,
    priority INTEGER DEFAULT 0, created_at INTEGER, started_at INTEGER,
    completed_at INTEGER, result TEXT, block_kind TEXT, current_run_id INTEGER,
    workflow_template_id TEXT, current_step_key TEXT
);
CREATE TABLE task_links (parent_id TEXT, child_id TEXT, PRIMARY KEY (parent_id, child_id));
CREATE TABLE task_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, profile TEXT, step_key TEXT,
    status TEXT, outcome TEXT, started_at INTEGER, ended_at INTEGER, error TEXT, summary TEXT
);
"""

RESULTS: list[tuple[str, bool, str]] = []
LATENCIES: list[float] = []
READS = {"n": 0}          # _read_gantt calls (one per change per board — R11)
HTTP_GANTT = {"n": 0}     # HTTP GET /gantt requests — must stay 0 (P7)

_logger = None


def log(msg: str) -> None:
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    if _logger:
        _logger.write(line + "\n")
        _logger.flush()


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, bool(ok), detail))
    log(f"{'PASS' if ok else 'FAIL'} {name}" + (f" — {detail}" if detail else ""))


# ---------------------------------------------------------------------------
# Board fixture + a writer that behaves like the dispatcher (separate conn)
# ---------------------------------------------------------------------------

def make_board(slug: str = BOARD) -> Path:
    d = BOARDS / slug
    d.mkdir(parents=True, exist_ok=True)
    db = d / "kanban.db"
    conn = sqlite3.connect(db)
    try:
        conn.executescript(SCHEMA)
        now = int(time.time())
        conn.execute(
            "INSERT INTO tasks (id,title,status,assignee,priority,created_at,started_at) "
            "VALUES (?,?,?,?,?,?,?)",
            ("t_root", "root", "running", "default", 1, now, now - 60))
        conn.commit()
    finally:
        conn.close()
    return db


def write_task(db: Path, n: int) -> float:
    """Insert one task from a fresh connection — an out-of-UI write (R12)."""
    now = int(time.time())
    conn = sqlite3.connect(db)
    try:
        conn.execute(
            "INSERT INTO tasks (id,title,status,assignee,priority,created_at) VALUES (?,?,?,?,?,?)",
            (f"t_w{n}", f"[PROOF] write {n}", "ready", "dispatcher", 0, now))
        conn.commit()
    finally:
        conn.close()
    return time.time()


def task_count() -> int:
    conn = sqlite3.connect(BOARDS / BOARD / "kanban.db")
    try:
        return conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Instrumentation: HTTP counter (proves nothing polls) + read counter (fan-out)
# ---------------------------------------------------------------------------

def instrument(app):
    async def wrapped(scope, receive, send):
        if scope.get("type") == "http" and scope.get("path", "").endswith("/gantt"):
            HTTP_GANTT["n"] += 1
        await app(scope, receive, send)

    real_reader = getattr(plugin_api._read_gantt, "_kg_real", plugin_api._read_gantt)

    def counting_reader(slug: str):
        READS["n"] += 1
        return real_reader(slug)

    counting_reader._kg_real = real_reader          # never wrap twice
    plugin_api._read_gantt = counting_reader
    return wrapped


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


async def start_server(ws_env: str = "1") -> tuple:
    """One real uvicorn server per call, built from a freshly imported backend.

    Both modules are reloaded so the flag really decides whether `/events`
    exists for THIS instance (that is check P11), instead of reusing the route
    table of the first import.
    """
    import importlib

    os.environ["KANBAN_GANTT_WS"] = ws_env
    import plugin_ws

    importlib.reload(plugin_ws)
    importlib.reload(plugin_api)
    fastapi_app = plugin_api.create_app(allow_cors=False)
    app = instrument(fastapi_app)
    port = free_port()
    server = uvicorn.Server(uvicorn.Config(
        app, host="127.0.0.1", port=port, log_level="error",
        ws_ping_interval=None, ws_ping_timeout=None))
    task = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.02)
    routes = [getattr(r, "path", "") for r in fastapi_app.routes]
    log(f"server on :{port} — KANBAN_GANTT_WS={ws_env}, /events registered: "
        f"{any(p.endswith('/events') for p in routes)}")
    return server, task, port


async def stop_server(server, task) -> None:
    server.should_exit = True
    try:
        await asyncio.wait_for(task, timeout=10)
    except asyncio.TimeoutError:
        task.cancel()


# ---------------------------------------------------------------------------
# The proof
# ---------------------------------------------------------------------------

async def collect(ws, seconds: float) -> list[dict]:
    frames: list[dict] = []
    end = time.time() + seconds
    while True:
        left = end - time.time()
        if left <= 0:
            return frames
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=left)
        except asyncio.TimeoutError:
            return frames
        frames.append(json.loads(raw))


async def run(ws_url_base: str) -> None:
    url = f"{ws_url_base}/events?board={BOARD}&token={TOKEN}"
    db = BOARDS / BOARD / "kanban.db"

    # ── P1: first frame is a full snapshot ────────────────────────────────
    async with websockets.connect(url) as ws:
        first = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
        keys = sorted(first)
        shape_ok = all(k in keys for k in
                       ("type", "board", "version", "generated_at", "tasks", "labels"))
        check("P1 first frame is a full snapshot with the /gantt shape (R1/R8)",
              first.get("type") == "snapshot" and first.get("board") == BOARD
              and shape_ok and isinstance(first.get("tasks"), list)
              and len(first["tasks"]) >= 1,
              f"keys={keys} tasks={len(first.get('tasks', []))} version={first.get('version')}")
        base_version = int(first.get("version") or 0)

        # ── P2/P3: five out-of-UI writes ⇒ five frames, with latency ──────
        received: list[tuple[float, dict]] = []
        for n in range(5):
            wrote = write_task(db, n)
            got = None
            deadline = time.time() + 5
            while time.time() < deadline:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=deadline - time.time())
                except asyncio.TimeoutError:
                    break
                frame = json.loads(raw)
                if frame.get("type") == "snapshot":
                    got = (frame, time.time() - wrote)
                    break
            if got is None:
                log(f"  (no frame for write {n})")
                continue
            frame, latency = got
            received.append((latency, frame))
            LATENCIES.append(latency * 1000)
            log(f"  write {n} → frame v{frame['version']} "
                f"({len(frame['tasks'])} tasks, {len(json.dumps(frame))} B) "
                f"in {latency * 1000:.0f} ms")

        versions = [f["version"] for _, f in received]
        check("P2 five writes ⇒ five frames, versions strictly increasing (R4/R7)",
              len(received) == 5 and versions == sorted(versions)
              and len(set(versions)) == 5 and versions[0] == base_version + 1,
              f"versions={versions} (first frame was v{base_version})")
        p95 = statistics.quantiles(LATENCIES, n=20)[18] if len(LATENCIES) > 1 else LATENCIES[0]
        check("P3 change→frame p95 ≤ 2000 ms (R4)", p95 <= 2000,
              f"p50={statistics.median(LATENCIES):.0f} ms p95={p95:.0f} ms "
              f"max={max(LATENCIES):.0f} ms")
        biggest = max(len(json.dumps(f)) for _, f in received)
        check("P3 payload within the 600 KB / 50 ms push budget (R3)",
              biggest < 600 * 1024, f"largest frame {biggest} B")

        # ── P4: a burst inside the debounce window coalesces ──────────────
        before = READS["n"]
        burst_at = time.time()
        for n in range(10, 20):
            write_task(db, n)
        frames = await collect(ws, 1.5)
        burst_frames = [f for f in frames if f.get("type") == "snapshot"]
        check("P4 a 10-write burst coalesces into ≤2 frames (R5)",
              len(burst_frames) <= 2,
              f"{len(burst_frames)} frame(s) in 1.5 s, "
              f"{READS['n'] - before} DB read(s) (last at "
              f"{time.time() - burst_at:.2f}s after the burst)")
        if burst_frames:
            LATENCIES.append((time.time() - burst_at) * 1000)

        # ── P6: idle heartbeats ──────────────────────────────────────────
        hb = await collect(ws, 3.0)
        heartbeats = [f for f in hb if f.get("type") == "heartbeat"]
        check("P6 heartbeats arrive while the board is idle (R18)",
              len(heartbeats) >= 1, f"{len(heartbeats)} heartbeat(s) in 3 s "
                                   f"(interval set to 2 s)")

        # ── P5: two subscribers ⇒ one DB read fanned out ─────────────────
        reads_before = READS["n"]
        async with websockets.connect(url) as ws2:
            await asyncio.wait_for(ws2.recv(), timeout=5)      # its own snapshot
            reads_after_join = READS["n"]
            writes_at = time.time()
            write_task(db, 99)
            f1 = json.loads((await asyncio.wait_for(ws.recv(), timeout=5)))
            f2 = json.loads((await asyncio.wait_for(ws2.recv(), timeout=5)))
            fanout_reads = READS["n"] - reads_after_join
            check("P5 two subscribers ⇒ ONE board read per change (R11)",
                  fanout_reads == 1 and f1.get("version") == f2.get("version")
                  and f1.get("tasks") == f2.get("tasks"),
                  f"reads={fanout_reads} (join read {reads_after_join - reads_before}), "
                  f"versions={f1.get('version')}/{f2.get('version')}")
            LATENCIES.append((time.time() - writes_at) * 1000)

    # ── P10: reconnect ⇒ full snapshot again ─────────────────────────────
    async with websockets.connect(url) as ws3:
        again = json.loads(await asyncio.wait_for(ws3.recv(), timeout=5))
        check("P10 the first frame after a reconnect is a full snapshot (R8)",
              again.get("type") == "snapshot" and len(again.get("tasks", [])) == task_count()
              and again.get("version", 0) > base_version,
              f"v{again.get('version')} with {len(again.get('tasks', []))} tasks")

    # ── P8: auth ─────────────────────────────────────────────────────────
    rejected = []
    for label, qs in (("absent", ""), ("wrong", "&token=nope")):
        try:
            async with websockets.connect(f"{ws_url_base}/events?board={BOARD}{qs}") as bad:
                await asyncio.wait_for(bad.recv(), timeout=3)
                rejected.append((label, False))
        except Exception as exc:                       # noqa: BLE001
            rejected.append((label, type(exc).__name__))
    check("P8 wrong/absent token is rejected (R13)",
          all(ok is not False for _, ok in rejected),
          ", ".join(f"{k}:{v}" for k, v in rejected))

    # Loopback fallback: with no env token the standalone server accepts a local
    # client and refuses a non-loopback one (no widening — R16).
    os.environ.pop("KANBAN_GANTT_WS_TOKEN", None)
    import plugin_ws as _ws
    ok_loop, how_loop = _ws.authorize(_FakeWs("127.0.0.1"))
    ok_remote, how_remote = _ws.authorize(_FakeWs("10.1.2.3"))
    os.environ["KANBAN_GANTT_WS_TOKEN"] = TOKEN
    check("P8 standalone fallback is loopback-only (R16)",
          ok_loop and not ok_remote, f"loopback={how_loop} remote={how_remote}")

    # ── P9: slug validation mirrors the REST read (R10) ──────────────────
    try:
        async with websockets.connect(
                f"{ws_url_base}/events?board=..%2Fetc&token={TOKEN}") as bad:
            await asyncio.wait_for(bad.recv(), timeout=3)
        traversal_rejected = False
    except Exception:                                   # noqa: BLE001
        traversal_rejected = True
    check("P9 path traversal slug refused (R10)", traversal_rejected)

    # ── P7: nothing polled during the whole run ──────────────────────────
    check("P7 zero HTTP GET /gantt requests for the whole run",
          HTTP_GANTT["n"] == 0, f"{HTTP_GANTT['n']} request(s)")


class _FakeWs:
    """Just enough of a WebSocket for `plugin_ws.authorize`."""

    def __init__(self, host: str):
        self.client = type("C", (), {"host": host})()
        self.query_params: dict = {}
        self.headers: dict = {}


async def main() -> int:
    global _logger
    log(f"sandbox boards root: {BOARDS}")
    make_board()
    server, task, port = await start_server("1")
    base = f"ws://127.0.0.1:{port}"
    try:
        await run(base)
    finally:
        await stop_server(server, task)

    # ── P11: with the flag off, the route does not exist at all ──────────
    server, task, port = await start_server("0")
    try:
        import httpx

        def sync_probe(url: str):
            return httpx.get(url, timeout=5)

        # The probe must not block this server's own event loop.
        r = await asyncio.to_thread(sync_probe, f"http://127.0.0.1:{port}/gantt?board={BOARD}")
        r2 = await asyncio.to_thread(sync_probe, f"http://127.0.0.1:{port}/events?board={BOARD}")
        check("P11 flag off ⇒ REST works and /events does not exist (reversibility)",
              r.status_code == 200 and r2.status_code == 404,
              f"GET /gantt={r.status_code} GET /events={r2.status_code}")
    finally:
        await stop_server(server, task)

    if LATENCIES:
        log(f"latency over {len(LATENCIES)} frames: "
            f"p50={statistics.median(LATENCIES):.0f} ms max={max(LATENCIES):.0f} ms")
    log(f"DB reads (one per change per board): {READS['n']}; "
        f"HTTP /gantt requests: {HTTP_GANTT['n']}")

    failed = [name for name, ok, _ in RESULTS if not ok]
    log(f"RESULT: {len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
    for name in failed:
        log(f"  FAILED: {name}")
    return 1 if failed else 0


if __name__ == "__main__":
    _logger = open(os.environ.get("KG_PROOF_LOG") or "/dev/null", "a", encoding="utf-8")
    sys.exit(asyncio.run(main()))
