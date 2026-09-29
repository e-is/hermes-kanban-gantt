"""kanban-gantt — websocket push prototype for the ONE polling loop that matters.

Spike `t_64075faf`. This module replaces exactly one loop — the 60 s
`refetchInterval` on `GET /gantt` (`src/main.ts:1358-1362`) — with a server push
on the plugin's **own** router (`@router.websocket("/events")`, mounted
automatically at `/api/plugins/kanban-gantt/events`), consumed through the
desktop SDK's existing `ctx.socket` door. Nothing else changes: writes stay on
REST, `GET /gantt` stays exactly as it is and remains the fallback.

Design decisions, all taken from the parent recon notes
(`docs/spikes/current-state-and-requirements.md`, `docs/spikes/websocket-options.md`):

* **Reversible.** The whole feature lives behind `KANBAN_GANTT_WS` (default
  OFF). With it off the route is never registered: `/events` 404s and the client
  keeps its 60 s poll. Nothing else in the plugin can tell the difference.
* **Auth inside the handler.** Starlette's HTTP middleware does not run for the
  `websocket` scope, so the route authenticates itself — it delegates to the
  dashboard's canonical gate (`hermes_cli.web_server_chat._ws_auth_ok`, the same
  one the bundled kanban plugin reuses) and only falls back to its own rules when
  that gate is not importable (standalone dev server).
* **Board pinned at handshake** (`?board=<slug>`), validated with the *same*
  rule as `_board_db_path` — no traversal, no `.`/`..`.
* **One DB read per board per change**, fanned out to N subscribers
  (R11), with a 200–500 ms coalescing window (R5).
* **Drop-and-coalesce per client** — at most one pending frame; a client whose
  send buffer stays full is closed instead of queued.
* **Monotonic per-board version** on every frame (R7) and a **full snapshot as
  the first frame** after subscribe/reconnect (R8).

What this prototype deliberately does NOT do (see the write-up for the full
list): cross-process fan-out, delta frames, `task_events` cursor replay, and
protocol-level ping (the SDK door is receive-only, so the heartbeat is a data
frame and dead-connection detection is the client's job).
"""

from __future__ import annotations

import asyncio
import hmac
import logging
import os
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional

from fastapi import APIRouter, WebSocket

log = logging.getLogger(__name__)


_PLUGIN_API_CACHE: list = []


def _plugin_api():
    """The sibling `plugin_api` module, however this plugin was loaded.

    Standalone (`python plugin_api.py`) and tests put this directory on
    `sys.path`, so a plain `import plugin_api` works. Mounted by the gateway,
    core loads the api file with `spec_from_file_location` and never touches
    `sys.path` (`hermes_cli/web_server_dashboard.py:862`) — so `import plugin_api`
    raises `ImportError` there. Reuse the instance core already loaded (matching
    by file), else fall back to a by-path load of the same file.
    """
    if _PLUGIN_API_CACHE:
        return _PLUGIN_API_CACHE[0]
    import importlib
    import importlib.util
    import sys

    here = Path(__file__).resolve().parent / "plugin_api.py"

    def _matches(mod: Any) -> bool:
        f = getattr(mod, "__file__", None)
        if not f:
            return False
        try:
            return Path(f).resolve() == here
        except OSError:  # pragma: no cover - unreadable path
            return False

    mod = None
    for cand in list(sys.modules.values()):
        if _matches(cand):
            mod = cand
            break
    if mod is None:
        try:
            cand = importlib.import_module("plugin_api")
            mod = cand if _matches(cand) else None
        except Exception:  # noqa: BLE001 - fall through to the by-path load
            mod = None
    if mod is None:
        spec = importlib.util.spec_from_file_location("kanban_gantt_plugin_api", here)
        if spec is None or spec.loader is None:  # pragma: no cover - defensive
            raise ImportError(f"cannot load plugin_api from {here}")
        mod = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = mod
        spec.loader.exec_module(mod)
    _PLUGIN_API_CACHE.append(mod)
    return mod


# ---------------------------------------------------------------------------
# Feature flag + tuning knobs (all env-driven so nothing needs a redeploy)
# ---------------------------------------------------------------------------

WS_ENABLE_ENV = "KANBAN_GANTT_WS"            # "1"/"true"/"on" → expose /events
WS_TOKEN_ENV = "KANBAN_GANTT_WS_TOKEN"       # optional explicit expected token
WS_POLL_MS_ENV = "KANBAN_GANTT_WS_POLL_MS"   # change-detection cadence
WS_DEBOUNCE_MS_ENV = "KANBAN_GANTT_WS_DEBOUNCE_MS"
WS_HEARTBEAT_S_ENV = "KANBAN_GANTT_WS_HEARTBEAT_S"
WS_MAX_OVERRUNS_ENV = "KANBAN_GANTT_WS_MAX_OVERRUNS"
WS_GRACE_S_ENV = "KANBAN_GANTT_WS_GRACE_S"

CLOSE_POLICY_VIOLATION = 1008
CLOSE_TRY_AGAIN = 1013
CLOSE_SLOW_CONSUMER = 4408   # app-level: send buffer stayed full


def _env_flag(name: str, default: bool = False) -> bool:
    raw = (os.environ.get(name) or "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on", "enabled")


def _env_int(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


@dataclass(frozen=True)
class WsConfig:
    poll_s: float = 0.25          # change-detection cadence
    debounce_s: float = 0.3       # 200–500 ms coalescing window (R5)
    heartbeat_s: float = 20.0     # data-level heartbeat frame
    max_overruns: int = 3         # consecutive dropped frames before we close
    max_pending: int = 1          # frames that may wait for a slow client (R5)
    grace_s: float = 60.0         # keep a board stream (and its version) alive
                                  # after the last subscriber leaves, so a
                                  # reconnect resumes instead of restarting at 1

    @classmethod
    def from_env(cls) -> "WsConfig":
        return cls(
            poll_s=max(_env_int(WS_POLL_MS_ENV, 250), 25) / 1000.0,
            debounce_s=max(_env_int(WS_DEBOUNCE_MS_ENV, 300), 0) / 1000.0,
            heartbeat_s=max(_env_int(WS_HEARTBEAT_S_ENV, 20), 1),
            max_overruns=max(_env_int(WS_MAX_OVERRUNS_ENV, 3), 1),
            grace_s=max(_env_int(WS_GRACE_S_ENV, 60), 0),
        )


def websocket_enabled() -> bool:
    """True when the events route should exist.

    ON by default: the page carries no Refresh button, so the push IS the update
    path. The flag survives only as an emergency off-switch for a gateway that
    must not open websockets (``KANBAN_GANTT_WS=0``) — the client keeps polling
    as its safety net whenever the route is absent or the socket dies.
    """
    return _env_flag(WS_ENABLE_ENV, True)


# ---------------------------------------------------------------------------
# Auth — fail closed, and never widen the standalone dev server
# ---------------------------------------------------------------------------

def _client_is_loopback(ws: WebSocket) -> bool:
    host = ""
    try:
        host = (ws.client.host if ws.client else "") or ""
    except Exception:
        host = ""
    return host in ("127.0.0.1", "::1", "localhost")


def authorize(ws: WebSocket) -> tuple[bool, str]:
    """Authorize a WS upgrade. Returns ``(ok, how)``.

    1. An explicit ``KANBAN_GANTT_WS_TOKEN`` (if set) is compared in constant
       time — this is the only rule the *standalone* dev server needs.
    2. Otherwise the dashboard's canonical gate decides
       (`web_server_chat._ws_auth_ok`: loopback `?token=`, gated `?ticket=` /
       `?internal=`). That gate is the same one the bundled kanban plugin uses,
       so the prototype cannot drift from core auth.
    3. If the host core is not importable (bare standalone server), accept
       loopback clients only — never a wider socket than the HTTP surface
       already has (R16).
    """
    token = ""
    try:
        token = (ws.query_params.get("token") or "").strip()
        if not token:
            authorization = ws.headers.get("authorization") or ""
            if authorization.lower().startswith("bearer "):
                token = authorization[7:].strip()
    except Exception:
        token = ""

    expected = (os.environ.get(WS_TOKEN_ENV) or "").strip()
    if expected:
        if token and hmac.compare_digest(token.encode(), expected.encode()):
            return True, "env_token"
        return False, "env_token_mismatch"

    try:
        from hermes_cli import web_server_chat as _core

        return (True, "core_gate") if bool(_core._ws_auth_ok(ws)) else (False, "core_reject")
    except Exception:
        # Standalone dev server (no hermes_cli): loopback only.
        return (True, "loopback") if _client_is_loopback(ws) else (False, "no_gate")


# ---------------------------------------------------------------------------
# Change detection — one read-only connection per board, on its own thread
# ---------------------------------------------------------------------------

def _db_signature(conn: sqlite3.Connection, path: Path) -> tuple:
    """Cheap "did the board change?" probe.

    `PRAGMA data_version` only moves on changes made by *other* connections,
    which is exactly the case we care about (dispatcher, CLI, another agent) —
    so the connection must be long-lived. mtime/size ride along as a belt-and-
    braces check for a replaced file (schema edit, restore from backup).
    """
    data_version = conn.execute("PRAGMA data_version").fetchone()[0]
    stat = path.stat()
    return (int(data_version), stat.st_mtime_ns, stat.st_size)


class BoardStream:
    """One watcher per board, shared by every subscriber of that board.

    Owns: a single-thread pool (sqlite connections are not thread-safe, and this
    keeps the read off the event loop), the monotonic frame version, the change
    poll loop, the coalescing window and the fan-out.
    """

    def __init__(self, board: str, reader: Callable[[str], dict], config: WsConfig):
        self.board = board
        self.reader = reader
        self.config = config
        self.version = 0
        self.subscribers: dict[int, "Subscriber"] = {}
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix=f"kg-ws-{board}")
        self._conn: Optional[sqlite3.Connection] = None
        self._path: Optional[Path] = None
        self._last_sig: Optional[tuple] = None
        self._task: Optional[asyncio.Task] = None
        self._drop_handle: Optional[asyncio.TimerHandle] = None
        self._running = False
        self.last_push_at = 0.0

    # ── lifecycle ──────────────────────────────────────────────────────────
    def start(self) -> None:
        self._running = True
        if self._task is None or self._task.done():
            self._task = asyncio.get_running_loop().create_task(self._loop())

    def stop(self) -> None:
        self._running = False
        self._cancel_drop()
        if self._task is not None and not self._task.done():
            self._task.cancel()
        self._task = None
        self._close_conn()
        self._pool.shutdown(wait=False, cancel_futures=True)

    # ── grace window ───────────────────────────────────────────────────────
    # R7/R8: the version must keep moving for a board that people keep watching
    # (page reload, gateway switch, tab sleep). Tearing the stream — and its
    # counter — down the instant the last socket closes made every reconnect come
    # back as version 1, i.e. below what the client had already rendered, so a
    # gap-aware client could not tell a restart from a resync.
    def _schedule_drop(self) -> None:
        self._cancel_drop()
        if self.config.grace_s <= 0:
            HUB.drop(self.board)
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:                 # detached from the loop: drop now
            HUB.drop(self.board)
            return
        self._drop_handle = loop.call_later(self.config.grace_s, self._drop_if_idle)

    def _cancel_drop(self) -> None:
        if self._drop_handle is not None:
            self._drop_handle.cancel()
            self._drop_handle = None

    def _drop_if_idle(self) -> None:
        self._drop_handle = None
        if not self.subscribers:
            HUB.drop(self.board)

    def _close_conn(self) -> None:
        conn, self._conn, self._path = self._conn, None, None
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass

    # ── sqlite access, always on the pool thread ───────────────────────────
    def _conn_for(self, path: Path) -> sqlite3.Connection:
        if self._conn is None or self._path != path:
            self._close_conn()
            self._conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
            self._path = path
        return self._conn

    async def _signature(self) -> Optional[tuple]:
        """Current signature, or None when the board file is gone/unreadable."""
        _board_db_path = _plugin_api()._board_db_path  # no cycle: loaded lazily

        def work():
            path = _board_db_path(self.board)
            return _db_signature(self._conn_for(path), path)

        try:
            return await asyncio.get_running_loop().run_in_executor(self._pool, work)
        except Exception:
            self._close_conn()
            self._last_sig = None
            return None

    async def snapshot(self) -> dict:
        return await asyncio.get_running_loop().run_in_executor(
            self._pool, self.reader, self.board)

    async def signature(self) -> Optional[tuple]:
        """Public wrapper used by the handshake (see ``_signature``)."""
        return await self._signature()

    # ── subscribers ────────────────────────────────────────────────────────
    def attach(self, sub: "Subscriber", signature: Optional[tuple]) -> None:
        self._cancel_drop()
        self.subscribers[id(sub)] = sub
        if signature is not None:
            self._last_sig = signature
        self.start()

    def detach(self, sub: "Subscriber") -> None:
        self.subscribers.pop(id(sub), None)
        if not self.subscribers:
            self._schedule_drop()

    def broadcast(self, frame: dict) -> None:
        for sub in list(self.subscribers.values()):
            sub.offer(frame)

    def next_version(self) -> int:
        self.version += 1
        return self.version

    # ── the loop ───────────────────────────────────────────────────────────
    async def _loop(self) -> None:
        try:
            while self._running:
                if not self.subscribers:
                    # Grace window: nothing to fan out to, but the stream (and
                    # its version) must survive a reconnect. No DB reads here.
                    await asyncio.sleep(self.config.poll_s)
                    continue
                sig = await self._signature()
                if sig is not None and sig != self._last_sig:
                    # Coalesce: a burst of worker writes must yield ONE frame.
                    if self.config.debounce_s:
                        await asyncio.sleep(self.config.debounce_s)
                        settled = await self._signature()
                        if settled is not None:
                            sig = settled
                    if not self.subscribers:
                        continue
                    try:
                        payload = await self.snapshot()
                    except Exception as exc:  # board vanished / schema drift
                        log.warning("kanban-gantt ws: read failed for %s: %s", self.board, exc)
                        payload = None
                    self._last_sig = sig
                    if payload is not None:
                        self.last_push_at = time.time()
                        self.broadcast(snapshot_frame(payload, self.next_version()))
                elif time.time() - self.last_push_at >= self.config.heartbeat_s:
                    # Data-level heartbeat: the SDK door has no protocol-level
                    # ping/pong and uvicorn disables its ping on loopback, so an
                    # idle stream would otherwise look dead to both sides.
                    self.last_push_at = time.time()
                    self.broadcast(heartbeat_frame(self.board, self.version))
                await asyncio.sleep(self.config.poll_s)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # never kill the dashboard worker
            log.warning("kanban-gantt ws: stream loop error (%s): %s", self.board, exc)
        finally:
            self._close_conn()


class Hub:
    """board slug → shared BoardStream."""

    def __init__(self) -> None:
        self.streams: dict[str, BoardStream] = {}

    def get(self, board: str, reader: Callable[[str], dict], config: WsConfig) -> BoardStream:
        stream = self.streams.get(board)
        if stream is None:
            stream = BoardStream(board, reader, config)
            self.streams[board] = stream
        return stream

    def drop(self, board: str) -> None:
        stream = self.streams.pop(board, None)
        if stream is not None:
            stream.stop()


HUB = Hub()


class Subscriber:
    """One socket. At most ``max_pending`` frames wait; older ones are dropped."""

    def __init__(self, ws: WebSocket, config: WsConfig):
        self.ws = ws
        self.config = config
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=max(config.max_pending, 1))
        self.overruns = 0
        self.closing = False

    def offer(self, frame: dict) -> None:
        """Drop-and-coalesce: never grow a backlog for a slow client (R5)."""
        while True:
            try:
                self.queue.put_nowait(frame)
                return
            except asyncio.QueueFull:
                try:
                    self.queue.get_nowait()      # discard the stale pending frame
                except asyncio.QueueEmpty:
                    pass
                self.overruns += 1
                if self.overruns > self.config.max_overruns:
                    self.closing = True
                    # Unblock the writer so it can close the socket.
                    try:
                        self.queue.put_nowait({"type": "close", "reason": "slow_consumer"})
                    except asyncio.QueueFull:
                        pass
                    return

    async def pump(self) -> None:
        """Writer task: one send at a time, overruns reset on a clean send."""
        while True:
            frame = await self.queue.get()
            if frame.get("type") == "close":
                return
            await self.ws.send_json(frame)
            self.overruns = 0


# ---------------------------------------------------------------------------
# Frames
# ---------------------------------------------------------------------------

def snapshot_frame(payload: dict, version: int) -> dict:
    """R1/R2/R8: the `/gantt` snapshot verbatim, tagged with a frame header."""
    return {
        "type": "snapshot",
        "board": payload.get("board"),
        "version": version,
        "generated_at": payload.get("generated_at"),
        "tasks": payload.get("tasks") or [],
        "labels": payload.get("labels") or [],
    }


def heartbeat_frame(board: str, version: int) -> dict:
    return {"type": "heartbeat", "board": board, "version": version,
            "at": int(time.time())}


# ---------------------------------------------------------------------------
# The route
# ---------------------------------------------------------------------------

def attach(router: APIRouter, reader: Optional[Callable[[str], dict]] = None) -> bool:
    """Register `/events` on the plugin router when the flag is on.

    Returns True when the route was registered. `reader` defaults to
    `plugin_api._read_gantt` (resolved lazily so import order never matters).
    """
    if not websocket_enabled():
        log.info("kanban-gantt ws: %s=0 — /events not registered (polling only)",
                 WS_ENABLE_ENV)
        return False

    if reader is None:
        reader = _default_reader()

    config = WsConfig.from_env()

    @router.websocket("/events")
    async def stream_events(ws: WebSocket) -> None:  # noqa: D401
        ok, how = authorize(ws)
        if not ok:
            # R15: never echo the presented credential into the log.
            log.info("kanban-gantt ws: rejected upgrade (%s)", how)
            await ws.close(code=CLOSE_POLICY_VIOLATION)
            return

        slug = (ws.query_params.get("board") or "").strip()
        api = _plugin_api()
        if not slug:
            slug = api._resolve_board(None)
        try:
            api._board_db_path(slug)      # R10: same validation as the REST read
        except Exception:
            await ws.close(code=CLOSE_POLICY_VIOLATION)
            return

        await ws.accept()
        stream = HUB.get(slug, reader, config)
        sub = Subscriber(ws, config)
        pump = asyncio.get_running_loop().create_task(sub.pump())
        try:
            # R8: first frame is a full snapshot, and the change signature is
            # captured *before* the read so a write landing in between is still
            # detected on the next tick instead of being silently absorbed.
            signature = await stream.signature()
            payload = await stream.snapshot()
            version = stream.next_version()
            stream.last_push_at = time.time()
            await ws.send_json(snapshot_frame(payload, version))
            stream.attach(sub, signature)
            while not sub.closing:
                # Detect a dead peer without waiting for a push: the client
                # sends nothing today, so a receive timeout is the normal path.
                try:
                    await asyncio.wait_for(ws.receive(), timeout=config.poll_s)
                except asyncio.TimeoutError:
                    pass
            log.info("kanban-gantt ws: closing %s (slow consumer)", slug)
            await ws.close(code=CLOSE_SLOW_CONSUMER)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # Log WHY, not just the class: a ModuleNotFoundError's type alone
            # hides the one fact that makes it fixable (the module's name). This
            # line cost a debugging round-trip exactly that way.
            log.warning("kanban-gantt ws: stream for %s ended: %s: %s",
                        slug, type(exc).__name__, exc)
        finally:
            stream.detach(sub)
            pump.cancel()

    return True


def _default_reader() -> Callable[[str], dict]:
    def reader(board: str) -> dict:
        return _plugin_api()._read_gantt(board)
    return reader
