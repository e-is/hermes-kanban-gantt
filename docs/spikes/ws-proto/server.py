"""THROWAWAY SPIKE — minimal websocket server for the gantt board stream.

Not imported by the plugin, no production route touched. It boots the plugin's
real REST reader (`dashboard/plugin_api.py::_read_gantt`, mounted as `/gantt`)
against a *staging copy* of a real board database, and adds the one endpoint
under test: `WS /events?board=<slug>` — native Starlette websocket, the
recommended transport from docs/spikes/websocket-transport-evaluation.md.

Frame contract (mirrors dashboard/plugin_ws.py):
  {"type":"snapshot","board","version","generated_at","tasks","labels"}
  {"type":"heartbeat","board","version","at"}

Behaviour under test:
  * per-board change detection: PRAGMA data_version + stat(), one loop per
    board shared by every subscriber (never one probe per connection),
  * full snapshot as the first frame, monotonic per-board version,
  * data-level heartbeat every --heartbeat-s,
  * drop-and-coalesce per subscriber (one pending frame at most),
  * auth inside the handler, fail closed,
  * one instance-id / one process per port, so the multi-instance run is two
    real processes against one database.

Run:
  PYTHONPATH=$HOME/.hermes/hermes-agent \
  ~/.hermes/hermes-agent/venv/bin/python docs/spikes/ws-proto/server.py \
      --root /tmp/kg-wsproto/root --board gantt-demo --port 8891 --token poc
"""

from __future__ import annotations

import argparse
import asyncio
import hmac
import json
import os
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]   # file -> ws-proto -> spikes -> docs -> repo
_DASH = str(REPO / "dashboard")
if _DASH not in sys.path:
    sys.path.insert(0, _DASH)
    sys.path.insert(0, str(REPO))
# plugin_api imports plugin_ws and registers the SHIPPED /events at import time;
# disable it before that import so only the prototype route exists on the app.
os.environ["KANBAN_GANTT_WS"] = "0"


def _boot_env(root: str, board: str) -> None:
    """Point the plugin's real reader at the staging root before it is used."""
    os.environ.pop("HERMES_KANBAN_DB", None)
    os.environ.pop("HERMES_KANBAN_BOARD", None)
    os.environ["HERMES_KANBAN_HOME"] = root
    os.environ["KANBAN_GANTT_BOARDS"] = str(Path(root) / "kanban" / "boards")
    os.environ["KANBAN_GANTT_WS"] = "0"          # prototype route, not the shipped one


from fastapi import APIRouter, FastAPI, WebSocket, WebSocketDisconnect  # noqa: E402
import uvicorn  # noqa: E402

import plugin_api  # noqa: E402


class Config:
    pass


class Subscriber:
    """One connection. At most one pending frame: a slow client loses
    intermediate states, never the latest (R5/R7/R8 of the protocol note)."""

    __slots__ = ("ws", "queue", "dropped", "sent", "closed")

    def __init__(self, ws: WebSocket):
        self.ws = ws
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=1)
        self.dropped = 0
        self.sent = 0
        self.closed = False

    def offer(self, frame: dict, coalesce: bool) -> None:
        try:
            self.queue.put_nowait(frame)
        except asyncio.QueueFull:
            self.dropped += 1
            if coalesce:
                try:                       # replace the stale pending frame
                    self.queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                try:
                    self.queue.put_nowait(frame)
                except asyncio.QueueFull:
                    self.closed = True     # close 4408 territory in the real route
            else:
                self.closed = True

    async def pump(self) -> None:
        while not self.closed:
            frame = await self.queue.get()
            await self.ws.send_json(frame)
            self.sent += 1


class BoardStream:
    def __init__(self, slug: str, cfg: argparse.Namespace, stats: dict):
        self.slug = slug
        self.cfg = cfg
        self.stats = stats
        self.version = 0
        self.subs: set[Subscriber] = set()
        self.signature = None
        self.last_push = 0.0
        self.reads = 0
        self.probes = 0
        self.task: asyncio.Task | None = None
        self.conn = None

    # -- change detection -------------------------------------------------
    def _probe(self):
        if self.conn is None:
            import sqlite3
            path = plugin_api._board_db_path(self.slug)
            self.conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True,
                                        check_same_thread=False)
        dv = self.conn.execute("PRAGMA data_version").fetchone()[0]
        st = os.stat(plugin_api._board_db_path(self.slug))
        return (int(dv), st.st_mtime_ns, st.st_size)

    def _read(self) -> dict:
        self.reads += 1
        self.stats["db_reads"] += 1
        return plugin_api._read_gantt(self.slug)

    def next_version(self) -> int:
        self.version += 1
        return self.version

    def broadcast(self, frame: dict) -> None:
        self.stats["frames_out"] += 1
        for sub in list(self.subs):
            sub.offer(frame, coalesce=True)

    # -- the loop ---------------------------------------------------------
    async def ensure_running(self) -> None:
        if self.task is None or self.task.done():
            self.task = asyncio.get_running_loop().create_task(self._loop())

    async def _loop(self) -> None:
        loop = asyncio.get_running_loop()
        self.signature = await loop.run_in_executor(None, self._probe)
        self.last_push = time.time()
        while self.subs:
            t0 = time.perf_counter()
            try:
                sig = await loop.run_in_executor(None, self._probe)
            except Exception:
                await asyncio.sleep(self.cfg.poll_ms / 1000)
                continue
            self.probes += 1
            self.stats["probes"] += 1
            self.stats["probe_us_sum"] += (time.perf_counter() - t0) * 1e6
            if sig != self.signature:
                if self.cfg.debounce_ms:
                    await asyncio.sleep(self.cfg.debounce_ms / 1000)
                    sig = await loop.run_in_executor(None, self._probe)
                try:
                    payload = await loop.run_in_executor(None, self._read)
                except Exception as exc:                      # pragma: no cover
                    print(json.dumps({"warn": "read failed", "err": str(exc)}),
                          file=sys.stderr, flush=True)
                    await asyncio.sleep(self.cfg.poll_ms / 1000)
                    continue
                self.signature = sig
                self.last_push = time.time()
                self.broadcast(snapshot_frame(payload, self.next_version()))
            elif time.time() - self.last_push >= self.cfg.heartbeat_s:
                self.last_push = time.time()
                self.broadcast(heartbeat_frame(self.slug, self.version))
            await asyncio.sleep(self.cfg.poll_ms / 1000)

    def attach(self, sub: Subscriber, signature) -> None:
        if not self.subs:
            self.signature = signature
        self.subs.add(sub)
        self.stats["subscribers"] = len(self.subs)

    def detach(self, sub: Subscriber) -> None:
        sub.closed = True
        self.subs.discard(sub)
        self.stats["subscribers"] = len(self.subs)


def snapshot_frame(payload: dict, version: int) -> dict:
    return {"type": "snapshot", "board": payload.get("board"), "version": version,
            "generated_at": payload.get("generated_at"),
            "tasks": payload.get("tasks") or [], "labels": payload.get("labels") or []}


def heartbeat_frame(board: str, version: int) -> dict:
    return {"type": "heartbeat", "board": board, "version": version, "at": int(time.time())}


STREAMS: dict[str, BoardStream] = {}
STATS = {"db_reads": 0, "frames_out": 0, "probes": 0, "probe_us_sum": 0.0,
         "subscribers": 0, "handshakes": 0, "rejected": 0, "kicks": 0}
CFG: argparse.Namespace


def authorize(ws: WebSocket) -> tuple[bool, str]:
    if not CFG.token:
        return True, "open-dev-server"
    presented = (ws.query_params.get("token") or "").strip()
    header = ws.headers.get("x-prototype-token") or ""
    candidate = presented or header
    if not candidate:
        return False, "absent"
    if not hmac.compare_digest(candidate, CFG.token):
        return False, "wrong"
    return True, "token"


app = FastAPI()
router = APIRouter()


@router.websocket("/events")
async def events(ws: WebSocket) -> None:
    ok, how = authorize(ws)
    STATS["handshakes"] += 1
    if not ok:
        STATS["rejected"] += 1
        print(json.dumps({"reject": how}), file=sys.stderr, flush=True)
        await ws.close(code=1008)          # fail closed, before accept -> HTTP 403
        return
    slug = (ws.query_params.get("board") or "").strip() or CFG.board
    try:
        plugin_api._board_db_path(slug)
    except Exception as exc:
        STATS["rejected"] += 1
        print(json.dumps({"reject": "bad-board", "board": slug, "err": str(exc)}),
              file=sys.stderr, flush=True)
        await ws.close(code=1008)
        return

    await ws.accept()
    stream = STREAMS.setdefault(slug, BoardStream(slug, CFG, STATS))
    sub = Subscriber(ws)
    pump = asyncio.get_running_loop().create_task(sub.pump())
    try:
        loop = asyncio.get_running_loop()
        signature = await loop.run_in_executor(None, stream._probe)
        payload = await loop.run_in_executor(None, stream._read)
        await ws.send_json(snapshot_frame(payload, stream.next_version()))
        stream.attach(sub, signature)
        await stream.ensure_running()
        while not sub.closed:
            try:
                await asyncio.wait_for(ws.receive(), timeout=CFG.poll_ms / 1000)
            except asyncio.TimeoutError:
                pass
            except Exception:
                break
    except WebSocketDisconnect:
        pass
    finally:
        stream.detach(sub)
        sub.closed = True
        pump.cancel()


@router.get("/_stats")
async def stats() -> dict:
    out = dict(STATS)
    out["probes"] = max(STATS["probes"], 1)
    out["probe_us_p50_hint"] = round(STATS["probe_us_sum"] / out["probes"], 1)
    out["streams"] = {s: {"version": st.version, "reads": st.reads,
                          "subs": len(st.subs)} for s, st in STREAMS.items()}
    out["pid"] = os.getpid()
    return out


@router.post("/_kick")
async def kick() -> dict:
    """Force-drop every live subscriber — the 'gateway restarted' test."""
    n = 0
    for stream in STREAMS.values():
        for sub in list(stream.subs):
            n += 1
            try:
                await sub.ws.close(code=1012)
            except Exception:
                pass
            stream.detach(sub)
    STATS["kicks"] += 1
    return {"kicked": n}


app.include_router(plugin_api.router)      # real /gantt, /boards, ... at root
app.include_router(router)


def main() -> None:
    global CFG
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True, help="staging HERMES_KANBAN_HOME")
    ap.add_argument("--board", default="gantt-demo")
    ap.add_argument("--port", type=int, default=8891)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--token", default="")
    ap.add_argument("--poll-ms", type=int, default=250)
    ap.add_argument("--debounce-ms", type=int, default=300)
    ap.add_argument("--heartbeat-s", type=float, default=20.0)
    ap.add_argument("--instance", default="A")
    CFG = ap.parse_args()
    _boot_env(CFG.root, CFG.board)
    print(json.dumps({"ready": True, "port": CFG.port, "board": CFG.board,
                      "instance": CFG.instance, "token": bool(CFG.token),
                      "poll_ms": CFG.poll_ms, "debounce_ms": CFG.debounce_ms,
                      "db": str(plugin_api._board_db_path(CFG.board))}),
          flush=True)
    uvicorn.run(app, host=CFG.host, port=CFG.port, log_level="warning",
                ws_ping_interval=None if CFG.host in ("127.0.0.1", "localhost") else 20,
                ws_ping_timeout=None if CFG.host in ("127.0.0.1", "localhost") else 20)


if __name__ == "__main__":
    main()
