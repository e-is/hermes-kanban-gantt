"""Spike server: the SAME payload pushed over websockets and polled over HTTP.

Two listeners, one process, one shared Board:
  * HTTP  GET /api/tasks  -> the polling contract (baseline, "what we have today")
  * WS    /ws             -> {"op":"subscribe"} ... push on every mutation
  * HTTP  POST /chaos     -> hang up on every ws client (reconnect testing)

Run:  python server.py [--http-port 8788] [--ws-port 8787]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from websockets.asyncio.server import serve

from board import Board

BOARD: Board | None = None
STATS = {"ws_connects": 0, "ws_disconnects": 0, "polls": 0, "pushes": 0}
# Chaos switch: POST /chaos makes the server hang up on every ws client so we can
# observe reconnect behaviour. Thread-set, loop-read -> fine for a spike.
CHAOS = threading.Event()
# Manual single mutation, used for the "sparse change" measurement: set by
# POST /mutate, consumed by the async loop.
MUTATE = threading.Event()


# ---------------------------------------------------------------- polling side
class PollHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?")[0] != "/api/tasks":
            self.send_error(404)
            return
        STATS["polls"] += 1
        body = json.dumps(BOARD.snapshot()).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args) -> None:  # silence per-request stderr spam
        pass

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?")[0]
        if path == "/chaos":
            CHAOS.set()
        elif path == "/mutate":
            MUTATE.set()
        else:
            self.send_error(404)
            return
        self.send_response(202)
        self.send_header("Content-Length", "0")
        self.end_headers()


def start_http_server(port: int) -> ThreadingHTTPServer:
    srv = ThreadingHTTPServer(("127.0.0.1", port), PollHandler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


# ------------------------------------------------------------ websocket side
class Hub:
    """Fan-out to subscribed clients. HACKY: no per-client queue, no auth,
    no backpressure - a slow client just blocks the broadcast loop."""

    def __init__(self) -> None:
        self.clients: set = set()
        self.last_payload: dict | None = None

    async def subscribe(self, ws) -> None:
        self.clients.add(ws)
        STATS["ws_connects"] += 1
        if self.last_payload is None:
            self.last_payload = BOARD.snapshot()
        await ws.send(json.dumps(self.last_payload))

    def unsubscribe(self, ws) -> None:
        self.clients.discard(ws)
        STATS["ws_disconnects"] += 1

    async def broadcast(self, payload: dict) -> None:
        self.last_payload = payload
        STATS["pushes"] += 1
        msg = json.dumps(payload)
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.unsubscribe(ws)


async def updater(hub: Hub, period: float) -> None:
    """Stand-in for the production change feed.

    Slow control tick (20ms) so that a manual POST /mutate is not delayed by an
    auto-mutation period: the delay we measure must be the transport's, not the
    simulator's. period <= 0 disables auto mutations entirely (sparse-change
    mode: only POST /mutate moves the data).
    """
    next_auto = (time.monotonic() + period) if period > 0 else float("inf")
    while True:
        await asyncio.sleep(0.02)
        if CHAOS.is_set():
            CHAOS.clear()
            for ws in list(hub.clients):
                await ws.close(code=1011, reason="chaos: simulated server drop")
            continue
        if MUTATE.is_set():
            MUTATE.clear()
            await hub.broadcast(BOARD.mutate())
            continue
        if time.monotonic() >= next_auto:
            next_auto = time.monotonic() + period
            await hub.broadcast(BOARD.mutate())


async def ws_handler(ws, hub: Hub) -> None:
    await hub.subscribe(ws)
    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if msg.get("op") == "subscribe":
                await ws.send(json.dumps(BOARD.snapshot()))
            elif msg.get("op") == "ping":
                await ws.send(json.dumps({"op": "pong", "t": time.time()}))
    except Exception:
        pass  # client vanished / chaos close: not interesting in a spike
    finally:
        hub.unsubscribe(ws)


async def main() -> None:
    global BOARD
    ap = argparse.ArgumentParser()
    ap.add_argument("--http-port", type=int, default=8788)
    ap.add_argument("--ws-port", type=int, default=8787)
    ap.add_argument("--update-period", type=float, default=0.5,
                    help="seconds between simulated mutations")
    args = ap.parse_args()

    BOARD = Board()
    start_http_server(args.http_port)
    hub = Hub()

    async with serve(lambda ws: ws_handler(ws, hub), "127.0.0.1", args.ws_port):
        print(f"spike server up: http://127.0.0.1:{args.http_port}/api/tasks  "
              f"ws://127.0.0.1:{args.ws_port}/ws", flush=True)
        await asyncio.gather(updater(hub, args.update_period), asyncio.Future())


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
