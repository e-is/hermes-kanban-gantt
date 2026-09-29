"""Measure the kanban-gantt polling endpoints on a real HTTP loopback socket.

Usage:
  python measure.py --label real --home ~/.hermes --requests 200 \
     --endpoints /meta /boards "/gantt?board=gantt-demo" "/gantt?board=all"

Writes results/<label>.json and prints a compact table.
"""
import argparse
import json
import os
import statistics
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
API = os.environ["GANTT_PLUGIN_API"]
PORT = int(os.environ.get("PORT", "8791"))
BASE = f"http://127.0.0.1:{PORT}"


def pct(xs, p):
    xs = sorted(xs)
    if not xs:
        return float("nan")
    k = min(len(xs) - 1, max(0, int(round((p / 100) * len(xs) + 0.5)) - 1))
    return xs[k]


def server_cpu_ms(pid):
    with open(f"/proc/{pid}/stat") as fh:
        parts = fh.read().split()
    ticks = int(parts[13]) + int(parts[14])
    return ticks * 1000.0 / os.sysconf("SC_CLK_TCK")


def start_server(home):
    env = dict(os.environ)
    env.pop("HERMES_KANBAN_DB", None)
    env.pop("HERMES_KANBAN_BOARD", None)
    env["GANTT_PLUGIN_API"] = API
    env["PORT"] = str(PORT)
    env["HERMES_KANBAN_HOME"] = home
    env["PYTHONPATH"] = os.environ.get("PYTHONPATH", "/home/blavenie/.hermes/hermes-agent")
    proc = subprocess.Popen(
        [sys.executable, str(HERE / "serve.py")], env=env,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    deadline = time.time() + 30
    while time.time() < deadline:
        if proc.poll() is not None:
            raise SystemExit("server died: " + proc.stderr.read().decode()[-2000:])
        try:
            httpx.get(f"{BASE}/meta", timeout=1.0)
            return proc
        except Exception:
            time.sleep(0.2)
    proc.kill()
    raise SystemExit("server never became ready")


def bench(pid, path, n):
    """Steady state: one keep-alive client, sequential (what a mounted page does)."""
    lat, body = [], 0
    with httpx.Client(base_url=BASE, timeout=30.0) as c:
        for _ in range(n):
            t0 = time.perf_counter()
            r = c.get(path)
            lat.append((time.perf_counter() - t0) * 1000)
            body = len(r.content)
            r.raise_for_status()
    cpu0, wall0 = server_cpu_ms(pid), time.perf_counter()
    with httpx.Client(base_url=BASE, timeout=30.0) as c:
        for _ in range(n):
            c.get(path).raise_for_status()
    wall = time.perf_counter() - wall0
    cpu = server_cpu_ms(pid) - cpu0
    return {
        "requests": n, "body_bytes": body,
        "p50_ms": round(pct(lat, 50), 2), "p90_ms": round(pct(lat, 90), 2),
        "p99_ms": round(pct(lat, 99), 2), "max_ms": round(max(lat), 2),
        "mean_ms": round(statistics.fmean(lat), 2),
        "rps": round(n / wall, 1), "server_cpu_ms_per_req": round(cpu / n, 3),
    }


def bench_cold(pid, path, n=30):
    """Cold path: a brand-new TCP connection per request (no keep-alive reuse)."""
    lat = []
    for _ in range(n):
        with httpx.Client(timeout=30.0) as c:
            t0 = time.perf_counter()
            c.get(f"{BASE}{path}").raise_for_status()
            lat.append((time.perf_counter() - t0) * 1000)
    return {"requests": n, "p50_ms": round(pct(lat, 50), 2),
            "p99_ms": round(pct(lat, 99), 2), "max_ms": round(max(lat), 2)}


def bench_herd(path, clients, per_client=5):
    """N windows refetching the same endpoint at the same instant (worst case of
    the 60 s alignment)."""
    lat = []
    lock = threading.Lock()

    def one():
        with httpx.Client(base_url=BASE, timeout=60.0) as c:
            for _ in range(per_client):
                t0 = time.perf_counter()
                r = c.get(path)
                dt = (time.perf_counter() - t0) * 1000
                r.raise_for_status()
                with lock:
                    lat.append(dt)

    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=clients) as ex:
        list(ex.map(lambda _: one(), range(clients)))
    wall = (time.perf_counter() - t0) * 1000
    return {"clients": clients, "requests": clients * per_client,
            "wall_ms": round(wall, 1), "p50_ms": round(pct(lat, 50), 2),
            "p99_ms": round(pct(lat, 99), 2), "max_ms": round(max(lat), 2)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", required=True)
    ap.add_argument("--home", required=True)
    ap.add_argument("--requests", type=int, default=200)
    ap.add_argument("--endpoints", nargs="+", required=True)
    ap.add_argument("--herd", nargs="*", type=int, default=[])
    ap.add_argument("--herd-endpoint", default=None)
    ap.add_argument("--out", default=str(HERE.parent / "results"))
    args = ap.parse_args()

    proc = start_server(args.home)
    try:
        with httpx.Client(base_url=BASE, timeout=30.0) as c:
            meta = c.get("/meta").json()
            boards = c.get("/boards").json()
        print(f"# {args.label}: home={args.home} boards="
              f"{[b['slug'] for b in boards['boards']]} current={boards['current']}",
              flush=True)
        out = {"label": args.label, "home": args.home, "meta": meta,
               "boards": boards, "endpoints": {}, "cold": {}, "herd": [],
               "warmup_requests": args.requests}
        for path in args.endpoints:
            m = bench(proc.pid, path, args.requests)
            out["endpoints"][path] = m
            print(f"{path:42s} p50 {m['p50_ms']:8.2f}  p90 {m['p90_ms']:8.2f}  "
                  f"p99 {m['p99_ms']:8.2f}  max {m['max_ms']:8.2f}  "
                  f"body {m['body_bytes']:>8} B  {m['rps']:>7.1f} rps  "
                  f"cpu {m['server_cpu_ms_per_req']:.2f} ms/req", flush=True)
        for path in args.endpoints:
            if path in ("/meta", "/profiles"):
                continue
            m = bench_cold(proc.pid, path)
            out["cold"][path] = m
            print(f"cold {path:37s} p50 {m['p50_ms']:8.2f}  p99 {m['p99_ms']:8.2f}  "
                  f"max {m['max_ms']:8.2f}", flush=True)
        for n in args.herd:
            for path in ([args.herd_endpoint] if args.herd_endpoint
                         else [p for p in args.endpoints if p.startswith("/gantt")]):
                m = bench_herd(path, n)
                m["path"] = path
                out["herd"].append(m)
                print(f"herd {path:34s} {n:>3} clients  wall {m['wall_ms']:9.1f} ms  "
                      f"p50 {m['p50_ms']:9.2f}  p99 {m['p99_ms']:9.2f}", flush=True)
        Path(args.out).mkdir(parents=True, exist_ok=True)
        (Path(args.out) / f"{args.label}.json").write_text(json.dumps(out, indent=2))
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    main()
