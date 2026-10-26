#!/usr/bin/env python3
"""SPIKE — minimal websocket client that mimics the desktop SDK door.

The desktop hands a plugin exactly one push door (`ctx.socket`): a JSON
websocket to the plugin's namespace, **receive-only**, which auto-reconnects
with full-jitter backoff (500 ms → 30 s) and gives up after 5 consecutive
refused dials. This class is a stand-in for that door so the PoC measures the
contract the plugin actually gets, not an idealised client:

  * token on the handshake query (`?token=…`), never logged;
  * the first frame on every connection is a full snapshot — on connect and
    after each reconnect;
  * liveness judged from *data* frames (a `heartbeat` frame), because the door
    has no `ping` and no `onOpen`;
  * reconnect: full jitter, base 500 ms, cap 30 s, give up after
    `max_refused` consecutive dials (default 5, same as the SDK door).

Recording: every frame is stored with receive timestamp, size and the
server-side production latency (`recv - generated_at`).

Standalone run (against a server started by poc_server.py):

    ~/.hermes/hermes-agent/venv/bin/python docs/spikes/ws-poc/poc_client.py \
        --url 'ws://127.0.0.1:8791/events?board=ws-poc' --token poc-token \
        --duration 20
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import socket
import statistics
import struct
import time

import websockets

BACKOFF_BASE = 0.5
BACKOFF_CAP = 30.0


def full_jitter(attempt: int, base: float = BACKOFF_BASE, cap: float = BACKOFF_CAP) -> float:
    """SDK door's ladder: min(cap, base * 2**attempt), then full jitter."""
    return random.uniform(0.0, min(cap, base * (2 ** attempt)))


class PocClient:
    def __init__(self, url: str, token: str | None = None, *,
                 max_refused: int = 5, idle_timeout: float = 0.0,
                 give_up_after_s: float | None = None):
        sep = "&" if "?" in url else "?"
        self.url = f"{url}{sep}token={token}" if token else url
        self.max_refused = max_refused
        # 0 disables: the door has no idle timer; the plugin's heartbeat is the smell test.
        self.idle_timeout = idle_timeout
        self.give_up_after_s = give_up_after_s
        self.frames: list[dict] = []
        self.events: list[dict] = []          # connect / disconnect / retry / giveup
        self._queue: asyncio.Queue = asyncio.Queue()
        self._stop = asyncio.Event()
        self.refused = 0
        self.gave_up = False
        self._ws = None

    # ── public helpers for the bench ───────────────────────────────────────
    async def next_snapshot(self, after: float = 0.0, timeout: float = 5.0):
        """First snapshot frame with recv_ts >= `after` (None on timeout)."""
        deadline = time.time() + timeout
        for f in self.frames:
            if f["type"] == "snapshot" and f["recv_ts"] >= after and not f.get("_seen"):
                f["_seen"] = True
                return f
        while True:
            left = deadline - time.time()
            if left <= 0:
                return None
            try:
                f = await asyncio.wait_for(self._queue.get(), timeout=left)
            except asyncio.TimeoutError:
                return None
            if f["type"] == "snapshot" and f["recv_ts"] >= after:
                f["_seen"] = True
                return f

    def stop(self) -> None:
        self._stop.set()

    def force_reset(self) -> float:
        """Yank the current socket out from under the client with a real RST.

        SO_LINGER {on, 0} makes close() send RST instead of FIN, so the server
        sees a connection reset — the same thing a killed network path looks
        like. The client must notice and reconnect on its own.
        """
        ws = self._ws
        if ws is None:
            raise RuntimeError("not connected")
        sock = ws.transport.get_extra_info("socket")
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
        at = time.time()
        ws.transport.abort()
        return at

    def snapshots(self) -> list[dict]:
        return [f for f in self.frames if f["type"] == "snapshot"]

    def versions(self) -> list[int]:
        return [f["version"] for f in self.snapshots()]

    # ── the loop ───────────────────────────────────────────────────────────
    async def run(self) -> None:
        attempt = 0
        started = time.time()
        while not self._stop.is_set():
            try:
                async with websockets.connect(
                        self.url, ping_interval=None, open_timeout=5,
                        max_queue=32) as ws:
                    attempt = 0
                    self.refused = 0
                    self._ws = ws
                    self.events.append({"kind": "connect", "ts": time.time()})
                    await self._read(ws)
            except Exception as exc:                       # noqa: BLE001
                self.events.append({"kind": "disconnect", "ts": time.time(),
                                    "error": f"{type(exc).__name__}: {exc}"[:200]})
                if isinstance(exc, (ConnectionRefusedError, OSError)):
                    self.refused += 1
                if self.give_up_after_s and time.time() - started > self.give_up_after_s:
                    self.gave_up = True
                    self.events.append({"kind": "giveup", "ts": time.time(),
                                        "why": "give_up_after_s"})
                    return
                if self.refused >= self.max_refused:
                    self.gave_up = True
                    self.events.append({"kind": "giveup", "ts": time.time(),
                                        "why": f"{self.refused} consecutive refused dials"})
                    return
            if self._stop.is_set():
                return
            delay = full_jitter(attempt)
            attempt += 1
            self.events.append({"kind": "retry", "ts": time.time(), "delay": delay})
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=delay)
                return
            except asyncio.TimeoutError:
                pass

    async def _read(self, ws) -> None:
        while not self._stop.is_set():
            timeout = self.idle_timeout or None
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
            except asyncio.TimeoutError:
                self.events.append({"kind": "idle_timeout", "ts": time.time()})
                raise
            recv = time.time()
            try:
                frame = json.loads(raw)
            except ValueError:
                continue
            generated = frame.get("generated_at")
            stat = {
                "type": frame.get("type") or ("snapshot" if "tasks" in frame else "?"),
                "version": int(frame.get("version") or 0),
                "n_tasks": len(frame.get("tasks") or []),
                "bytes": len(raw),
                "recv_ts": recv,
                "generated_at": generated,
                "latency_ms": ((recv - generated) * 1000.0) if generated else None,
                "board": frame.get("board"),
            }
            self.frames.append(stat)
            self._queue.put_nowait(stat)

    # ── reporting ──────────────────────────────────────────────────────────
    def report(self) -> dict:
        lat = [f["latency_ms"] for f in self.frames if f["latency_ms"] is not None]
        connects = [e for e in self.events if e["kind"] == "connect"]
        return {
            "frames": len(self.frames),
            "snapshots": len(self.snapshots()),
            "heartbeats": sum(1 for f in self.frames if f["type"] == "heartbeat"),
            "bytes": sum(f["bytes"] for f in self.frames),
            "versions": self.versions(),
            # `generated_at` is integer seconds in the /gantt payload, so this is
            # only good to ±1 s — kept for sanity, never used as a latency figure.
            "coarse_generated_at_age_ms": _stats(lat),
            "connects": len(connects),
            "gave_up": self.gave_up,
            "events": _public_events(self.events),
        }


def _public_events(events: list[dict]) -> list[dict]:
    out = []
    for e in events[-40:]:
        out.append({k: (round(v, 3) if isinstance(v, float) else v) for k, v in e.items()})
    return out


def _stats(values: list[float]) -> dict:
    if not values:
        return {}
    ordered = sorted(values)
    p95 = ordered[min(len(ordered) - 1, int(0.95 * len(ordered)))]
    return {"n": len(values), "p50": round(statistics.median(values), 2),
            "p95": round(p95, 2), "max": round(ordered[-1], 2),
            "mean": round(statistics.fmean(values), 2)}


async def _main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--token", default="")
    ap.add_argument("--duration", type=float, default=20.0)
    ap.add_argument("--max-refused", type=int, default=5)
    ap.add_argument("--idle-timeout", type=float, default=0.0)
    args = ap.parse_args()

    client = PocClient(args.url, args.token or None,
                       max_refused=args.max_refused, idle_timeout=args.idle_timeout)
    task = asyncio.create_task(client.run())
    await asyncio.sleep(args.duration)
    client.stop()
    await asyncio.gather(task, return_exceptions=True)
    print(json.dumps(client.report(), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
