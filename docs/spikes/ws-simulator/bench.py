"""Benchmark harness: run the poller and the ws client against one server.

Two phases, because they answer different questions:

  phase 1 "load"     - constant mutations every 0.5s, poller at --interval.
                       Measures throughput (frames vs bytes), transport
                       latency, and what happens when the server hangs up on
                       every ws client (POST /chaos at half-time).
  phase 2 "sparse"   - no automatic mutations; the bench fires POST /mutate at
                       known times. Measures the metric that actually decides
                       the trade-off: how long after a change does the client
                       see it? (poller: up to one interval; ws: immediately)

Writes results.json and prints the comparison tables.

Run:  python bench.py --duration 24 --sparse-duration 18 --interval 2
"""
from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
PY = sys.executable


# ------------------------------------------------------------------ utilities
async def wait_for_server(base: str, timeout: float = 10.0) -> float:
    loop = asyncio.get_running_loop()
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            await loop.run_in_executor(None, _ping, base)
            return (time.time() - t0) * 1000
        except Exception:
            await asyncio.sleep(0.05)
    raise RuntimeError("server did not come up")


def _ping(base: str) -> None:
    with urllib.request.urlopen(f"{base}/api/tasks", timeout=2) as r:
        r.read()


def _post(url: str) -> None:
    req = urllib.request.Request(url, method="POST")
    with urllib.request.urlopen(req, timeout=5) as r:
        r.read()


async def later(delay: float, action, label: str) -> None:
    await asyncio.sleep(delay)
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, action)
    print(f"[bench] {label} at t+{delay:.1f}s", flush=True)


async def phase(name: str, args, update_period: float, duration: float,
                chaos_at: float | None, mutate_at: list[float]) -> dict:
    http_base = f"http://127.0.0.1:{args.http_port}"
    poll_json, ws_json = f"poll_{name}.json", f"ws_{name}.json"
    srv = subprocess.Popen(
        [PY, str(HERE / "server.py"), "--http-port", str(args.http_port),
         "--ws-port", str(args.ws_port), "--update-period", str(update_period)],
        cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    print(f"\n=== phase '{name}' (update-period={update_period}s, "
          f"duration={duration}s) ===", flush=True)
    try:
        t_setup = await wait_for_server(http_base)
        print(f"[bench] server ready in {t_setup:.0f}ms", flush=True)
        procs = [
            await asyncio.create_subprocess_exec(
                PY, str(HERE / "poller.py"), "--interval", str(args.interval),
                "--duration", str(duration), "--out", poll_json, cwd=HERE,
                stdout=open(HERE / f"poller_{name}.log", "w"),
                stderr=asyncio.subprocess.STDOUT),
            await asyncio.create_subprocess_exec(
                PY, str(HERE / "ws_client.py"), "--duration", str(duration),
                "--out", ws_json, cwd=HERE,
                stdout=open(HERE / f"ws_client_{name}.log", "w"),
                stderr=asyncio.subprocess.STDOUT),
        ]
        waiters = [p.wait() for p in procs]
        if chaos_at is not None:
            waiters.append(later(chaos_at, lambda: _post(f"{http_base}/chaos"),
                                 "fired POST /chaos"))
        for t in mutate_at:
            waiters.append(later(t, lambda: _post(f"{http_base}/mutate"),
                                 "fired POST /mutate"))
        await asyncio.gather(*waiters)
        for p, label in zip(procs, ("poller", "ws_client")):
            if p.returncode != 0:
                print(f"--- {label} exit={p.returncode} ---")
                print((HERE / f"{label}_{name}.log").read_text())
    finally:
        srv.terminate()
        try:
            out, _ = srv.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            srv.kill()
            out, _ = srv.communicate()
        tail = [ln for ln in out.strip().splitlines() if ln.strip()]
        print("--- server log (last lines) ---")
        print("\n".join(tail[-4:]))

    poll_path, ws_path = HERE / poll_json, HERE / ws_json
    for p in (poll_path, ws_path):
        if not p.exists():
            raise SystemExit(f"missing metric file {p}; see {HERE}/*_{name}.log")
    return {"setup_ms": t_setup,
            "poll": json.loads(poll_path.read_text()),
            "ws": json.loads(ws_path.read_text())}


# --------------------------------------------------------------------- report
def percentile(values: list[float], p: float) -> float:
    if not values:
        return float("nan")
    s = sorted(values)
    k = (len(s) - 1) * p / 100
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def row(label: str, p, w) -> None:
    p = f"{p:.2f}" if isinstance(p, float) else str(p)
    w = f"{w:.2f}" if isinstance(w, float) else str(w)
    print(f"{label:<38}{p:>15}{w:>15}")


def table(title: str, res: dict) -> None:
    poll, ws = res["poll"], res["ws"]
    print(f"\n--- {title} ---")
    print(f"{'metric':<38}{'polling':>15}{'websocket':>15}")
    row("frames received", poll["requests"], ws["messages"])
    row("bytes received", poll["bytes"], ws["bytes"])
    row("connections opened", "-", ws["connects"])
    row("transport latency ms (median)",
        percentile(poll["transport_latency_ms"], 50),
        percentile(ws["transport_latency_ms"], 50))
    row("displayed-data staleness ms (median)",
        percentile(poll["freshness_lag_ms"], 50),
        percentile(ws["freshness_lag_ms"], 50))
    row("displayed-data staleness ms (p95)",
        percentile(poll["freshness_lag_ms"], 95),
        percentile(ws["freshness_lag_ms"], 95))
    row("revisions noticed", poll["revisions_seen"], ws["revisions_seen"])
    row("errors / drops", poll["errors"], ws["drops"])
    if ws["connect_setup_ms"]:
        row("ws connect setup ms (median)", "-",
            percentile(ws["connect_setup_ms"], 50))
    if ws["disconnected_windows_ms"]:
        row("ws outage windows ms", "-",
            ", ".join(f"{x:.0f}" for x in ws["disconnected_windows_ms"]))


def detection_table(title: str, res: dict) -> None:
    print(f"\n--- {title}: delay from change to visibility, ms ---")
    print(f"{'change #':<38}{'polling':>15}{'websocket':>15}")
    p = res["poll"]["detection_events"]
    w = res["ws"]["detection_events"]
    for i in range(max(len(p), len(w))):
        pv = f"{p[i]['detected_after_ms']:.1f}" if i < len(p) else "-"
        wv = f"{w[i]['detected_after_ms']:.1f}" if i < len(w) else "-"
        print(f"{'change ' + str(i + 1):<38}{pv:>15}{wv:>15}")
    if p and w:
        pm = statistics.median([e["detected_after_ms"] for e in p])
        wm = statistics.median([e["detected_after_ms"] for e in w])
        print(f"{'median':<38}{pm:>15.1f}{wm:>15.1f}")


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--duration", type=float, default=24.0, help="phase 1 length")
    ap.add_argument("--sparse-duration", type=float, default=18.0)
    ap.add_argument("--interval", type=float, default=2.0, help="poll cadence")
    ap.add_argument("--http-port", type=int, default=8788)
    ap.add_argument("--ws-port", type=int, default=8787)
    a = ap.parse_args()

    load = await phase("load", a, update_period=0.5, duration=a.duration,
                       chaos_at=a.duration / 2, mutate_at=[])
    sparse = await phase("sparse", a, update_period=0, duration=a.sparse_duration,
                         chaos_at=None, mutate_at=[4.0, 9.0, 14.0])

    (HERE / "results.json").write_text(json.dumps(
        {"phase1_load": load, "phase2_sparse": sparse}, indent=2))
    table("phase 1 - continuous changes + one forced disconnect", load)
    table("phase 2 - sparse changes", sparse)
    detection_table("phase 2 - sparse changes", sparse)
    print(f"\nwrote {HERE / 'results.json'}")


if __name__ == "__main__":
    asyncio.run(main())
