"""THROWAWAY SPIKE — minimal client for the prototype `/events` stream.

Deliberately shaped like the desktop SDK door (`ctx.socket`):
  * token on the handshake, no `onOpen` event (the first frame is the probe),
  * first-frame timeout, idle timeout = 2.5 x heartbeat,
  * reconnect with full-jitter backoff, a dial cap, then gives up,
  * JSON frames only, receive-only.

Used as a library by bench.py and as a CLI for a manual check.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import time

import websockets


class Client:
    def __init__(self, url: str, token: str = "", first_frame_timeout: float = 5.0,
                 idle_timeout: float = 50.0, max_dials: int = 5,
                 backoff_min: float = 0.5, backoff_max: float = 30.0):
        self.url = url
        self.token = token
        self.first_frame_timeout = first_frame_timeout
        self.idle_timeout = idle_timeout
        self.max_dials = max_dials
        self.backoff_min = backoff_min
        self.backoff_max = backoff_max

        self.connects = 0
        self.dials = 0
        self.reconnects = 0
        self.frames = 0
        self.snapshots = 0
        self.heartbeats = 0
        self.last_version = 0
        self.connect_ms: list[float] = []
        self.frame_times: list[tuple[float, int, dict]] = []   # t, version, frame
        self.errors: list[str] = []
        self.reconnect_gaps: list[float] = []
        self._stop = False
        self._ws = None

    def _dial_url(self) -> str:
        if not self.token:
            return self.url
        sep = "&" if "?" in self.url else "?"
        return f"{self.url}{sep}token={self.token}"

    async def run(self, duration: float | None = None, until_version: int | None = None,
                  on_frame=None) -> None:
        deadline = time.perf_counter() + duration if duration else None
        last_drop = None
        while not self._stop:
            if self.dials >= self.max_dials and self.reconnects > 0:
                self.errors.append("dial-cap")
                return
            if deadline and time.perf_counter() > deadline:
                return
            self.dials += 1
            t_dial = time.perf_counter()
            try:
                self._ws = await websockets.connect(
                    self._dial_url(), open_timeout=self.first_frame_timeout,
                    ping_interval=None, max_size=64 * 1024 * 1024)
                await self._session(deadline, until_version, on_frame, t_dial, last_drop)
            except Exception as exc:                       # refused / reset / idle
                self.errors.append(f"{type(exc).__name__}: {exc}")
            finally:
                try:
                    if self._ws is not None:
                        # A stalled peer (proxy/tunnel blip) never answers the
                        # close handshake: bound it, then abort the transport.
                        await asyncio.wait_for(self._ws.close(), timeout=2.0)
                except Exception:
                    try:
                        self._ws.transport.abort()
                    except Exception:
                        pass
                self._ws = None
            if self._stop or (until_version and self.last_version >= until_version):
                return
            if deadline and time.perf_counter() > deadline:
                return
            last_drop = time.perf_counter()
            delay = random.uniform(0, min(self.backoff_max,
                                          self.backoff_min * (2 ** (self.dials - 1))))
            await asyncio.sleep(delay)

    async def _session(self, deadline, until_version, on_frame, t_dial, last_drop) -> None:
        self.connects += 1
        first = True
        last_frame_at = time.perf_counter()
        while True:
            timeout = self.first_frame_timeout if first else self.idle_timeout
            if deadline:
                timeout = max(0.05, min(timeout, deadline - time.perf_counter()))
            try:
                raw = await asyncio.wait_for(self._ws.recv(), timeout=timeout)
            except asyncio.TimeoutError:
                if deadline and time.perf_counter() >= deadline:
                    return
                self.errors.append(f"timeout:{'first-frame' if first else 'idle'}")
                return
            now = time.perf_counter()
            if first:
                self.connect_ms.append((now - t_dial) * 1000)
                if last_drop is not None:
                    self.reconnect_gaps.append((now - last_drop) * 1000)
                    self.reconnects += 1
                first = False
            last_frame_at = now
            frame = json.loads(raw)
            self.frames += 1
            if frame.get("type") == "snapshot":
                self.snapshots += 1
                v = frame.get("version", 0)
                if v < self.last_version:
                    self.errors.append(f"version-reset:{self.last_version}->{v}")
                self.last_version = max(self.last_version, v)
            else:
                self.heartbeats += 1
            self.frame_times.append((time.time(), self.last_version, frame))
            if on_frame:
                on_frame(frame, now)
            if until_version and self.last_version >= until_version:
                return
            if deadline and time.perf_counter() > deadline:
                return
            _ = last_frame_at

    def stop(self) -> None:
        self._stop = True


async def _main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--token", default="")
    ap.add_argument("--duration", type=float, default=20)
    args = ap.parse_args()
    c = Client(args.url, args.token)

    def show(frame, now):
        if frame.get("type") == "snapshot":
            print(f"{now:.3f} snapshot v{frame['version']} "
                  f"{len(frame.get('tasks') or [])} tasks")

    await c.run(duration=args.duration, on_frame=show)
    print(json.dumps({"connects": c.connects, "frames": c.frames,
                      "snapshots": c.snapshots, "heartbeats": c.heartbeats,
                      "connect_ms": [round(x, 1) for x in c.connect_ms],
                      "errors": c.errors}, indent=2))


if __name__ == "__main__":
    asyncio.run(_main())
