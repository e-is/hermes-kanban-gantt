"""Baseline: the polling client (what we have today).

GET /api/tasks every `interval` seconds, forever, whether or not anything
changed. Records the same two metrics as the ws client so the comparison is
apples-to-apples:
  * freshness lag = client_receive_time - payload["server_time"]
    (how stale the data the user is looking at was)
  * requests + bytes transferred

Run:  python poller.py --interval 2 --duration 20
"""
from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time
import urllib.request

METRICS: dict = {
    "transport": "poll",
    "requests": 0,
    "bytes": 0,
    "revisions_seen": 0,
    "freshness_lag_ms": [],
    "transport_latency_ms": [],
    "request_latency_ms": [],
    "errors": 0,
    "detection_events": [],
}


async def run(base: str, interval: float, duration: float, out: str) -> dict:
    loop = asyncio.get_running_loop()
    t_end = time.time() + duration
    last_rev = None
    while time.time() < t_end:
        t0 = time.time()
        try:
            body = await loop.run_in_executor(None, _get, f"{base}/api/tasks")
        except Exception:
            METRICS["errors"] += 1
            await asyncio.sleep(interval)
            continue
        t1 = time.time()
        METRICS["requests"] += 1
        METRICS["bytes"] += len(body)
        METRICS["request_latency_ms"].append((t1 - t0) * 1000)
        data = json.loads(body)
        METRICS["freshness_lag_ms"].append((t1 - data["data_time"]) * 1000)
        METRICS["transport_latency_ms"].append((t1 - data["server_time"]) * 1000)
        if last_rev is not None and data["revision"] != last_rev:
            METRICS["revisions_seen"] += 1
            METRICS["detection_events"].append(
                {"revision": data["revision"],
                 "detected_after_ms": (t1 - data["data_time"]) * 1000}
            )
        last_rev = data["revision"]
        await asyncio.sleep(max(0.0, interval - (time.time() - t0)))

    with open(out, "w") as fh:
        json.dump(METRICS, fh, indent=2)
    summarise(METRICS)
    return METRICS


def _get(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=5) as resp:
        return resp.read()


def summarise(m: dict) -> None:
    lag = m["freshness_lag_ms"]
    print(f"[poll] requests={m['requests']} bytes={m['bytes']} errors={m['errors']}")
    if lag:
        print(f"[poll] freshness lag ms: median={statistics.median(lag):.1f} "
              f"p95={percentile(lag, 95):.1f} max={max(lag):.1f}")
    if m["transport_latency_ms"]:
        print(f"[poll] transport latency ms: median="
              f"{percentile(m['transport_latency_ms'], 50):.2f}")
    if m["request_latency_ms"]:
        print(f"[poll] http round-trip ms: median="
              f"{statistics.median(m['request_latency_ms']):.1f}")


def percentile(values: list[float], p: float) -> float:
    if not values:
        return float("nan")
    s = sorted(values)
    k = (len(s) - 1) * p / 100
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8788")
    ap.add_argument("--interval", type=float, default=2.0)
    ap.add_argument("--duration", type=float, default=20.0)
    ap.add_argument("--out", default="poll_metrics.json")
    a = ap.parse_args()
    asyncio.run(run(a.base, a.interval, a.duration, a.out))
