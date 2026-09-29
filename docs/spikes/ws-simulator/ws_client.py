"""Websocket client: subscribe once, receive pushes, reconnect with backoff.

Records connection setup time, per-message latency, and what happens when the
connection is dropped (server-side close or transport-level failure).

Run:  python ws_client.py --duration 20
"""
from __future__ import annotations

import argparse
import asyncio
import json
import random
import statistics
import time

from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

URL = "ws://127.0.0.1:8787/ws"
BACKOFF_BASE = 0.25   # first retry after ~250ms
BACKOFF_CAP = 5.0
BACKOFF_JITTER = 0.2

METRICS: dict = {
    "transport": "ws",
    "connects": 0,
    "drops": 0,
    "connect_setup_ms": [],
    "message_latency_ms": [],
    "transport_latency_ms": [],
    "freshness_lag_ms": [],
    "reconnect_delays_ms": [],
    "disconnected_windows_ms": [],
    "messages": 0,
    "bytes": 0,
    "revisions_seen": 0,
    "detection_events": [],
}


async def run(url: str, duration: float, out: str) -> dict:
    t_end = time.time() + duration
    attempt = 0
    last_rev = None
    disconnected_since: float | None = None

    while time.time() < t_end:
        t_conn = time.time()
        try:
            async with connect(url, open_timeout=5, ping_interval=5,
                               ping_timeout=5) as ws:
                # --- connected ---
                if disconnected_since is not None:
                    METRICS["disconnected_windows_ms"].append(
                        (t_conn - disconnected_since) * 1000)
                    disconnected_since = None
                METRICS["connects"] += 1
                METRICS["connect_setup_ms"].append((time.time() - t_conn) * 1000)
                attempt = 0
                await ws.send(json.dumps({"op": "subscribe"}))

                while True:
                    timeout = max(0.0, t_end - time.time())
                    if timeout <= 0:
                        return _finish(out)
                    raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
                    t_recv = time.time()
                    METRICS["bytes"] += len(raw)
                    data = json.loads(raw)
                    if "revision" not in data:
                        continue
                    METRICS["messages"] += 1
                    METRICS["transport_latency_ms"].append(
                        (t_recv - data["server_time"]) * 1000)
                    METRICS["freshness_lag_ms"].append(
                        (t_recv - data["data_time"]) * 1000)
                    if last_rev is not None and data["revision"] != last_rev:
                        METRICS["revisions_seen"] += 1
                        METRICS["detection_events"].append(
                            {"revision": data["revision"],
                             "detected_after_ms": (t_recv - data["data_time"]) * 1000})
                    last_rev = data["revision"]
        except (ConnectionClosed, OSError, asyncio.TimeoutError) as exc:
            if time.time() >= t_end:
                break
            METRICS["drops"] += 1
            if disconnected_since is None:
                disconnected_since = time.time()
            delay = min(BACKOFF_CAP, BACKOFF_BASE * (2 ** attempt))
            delay *= 1 + random.uniform(-BACKOFF_JITTER, BACKOFF_JITTER)
            attempt += 1
            METRICS["reconnect_delays_ms"].append(delay * 1000)
            print(f"[ws] disconnected ({type(exc).__name__}); retry in "
                  f"{delay * 1000:.0f}ms", flush=True)
            await asyncio.sleep(delay)
    return _finish(out)


def _finish(out: str) -> dict:
    with open(out, "w") as fh:
        json.dump(METRICS, fh, indent=2)
    summarise()
    return METRICS


def summarise() -> None:
    m = METRICS
    print(f"[ws] connects={m['connects']} drops={m['drops']} "
          f"messages={m['messages']} bytes={m['bytes']} "
          f"revisions={m['revisions_seen']}")
    if m["connect_setup_ms"]:
        print(f"[ws] connect setup ms: median="
              f"{statistics.median(m['connect_setup_ms']):.1f} "
              f"max={max(m['connect_setup_ms']):.1f}")
    if m["transport_latency_ms"]:
        print(f"[ws] transport latency ms: median="
              f"{statistics.median(m['transport_latency_ms']):.2f} "
              f"p95={percentile(m['transport_latency_ms'], 95):.2f} "
              f"max={max(m['transport_latency_ms']):.2f}")
    if m["freshness_lag_ms"]:
        print(f"[ws] freshness lag ms: median="
              f"{statistics.median(m['freshness_lag_ms']):.2f} "
              f"p95={percentile(m['freshness_lag_ms'], 95):.2f} "
              f"max={max(m['freshness_lag_ms']):.2f}")
    if m["disconnected_windows_ms"]:
        print(f"[ws] disconnected windows ms: "
              f"{[round(x) for x in m['disconnected_windows_ms']]}")
    if m["reconnect_delays_ms"]:
        print(f"[ws] retry delays ms: {[round(x) for x in m['reconnect_delays_ms']]}")


def percentile(values: list[float], p: float) -> float:
    s = sorted(values)
    k = (len(s) - 1) * p / 100
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=URL)
    ap.add_argument("--duration", type=float, default=20.0)
    ap.add_argument("--out", default="ws_metrics.json")
    a = ap.parse_args()
    asyncio.run(run(a.url, a.duration, a.out))
