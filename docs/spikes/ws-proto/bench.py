"""THROWAWAY SPIKE — measurement harness for the prototype `/events` stream.

Everything is measured against a staging root that holds a real, consistent copy
of a live board (sqlite online backup), served by the plugin's own
`_read_gantt`. Writes go through a separate sqlite connection, exactly like the
dispatcher/CLI/agent do — that is what moves `PRAGMA data_version`.

Sections: baseline | setup | latency | throughput | fanout | resources |
          kick | blip | auth | multi_instance | proxy_idle

  PYTHONPATH=$HOME/.hermes/hermes-agent \
  ~/.hermes/hermes-agent/venv/bin/python docs/spikes/ws-proto/bench.py
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import shutil
import socket
import sqlite3
import statistics
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

import websockets

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
PY = os.environ.get("KG_PY", sys.executable)
RESULTS = REPO / "docs/spikes/results"
BOARD = "gantt-demo"

sys.path.insert(0, str(HERE))
from client import Client  # noqa: E402


# ---------------------------------------------------------------------------
# staging + server plumbing
# ---------------------------------------------------------------------------

def make_staging(tag: str, real_db: str) -> Path:
    root = Path(f"/tmp/kg-wsproto/{tag}")
    if root.exists():
        shutil.rmtree(root)
    dst = root / "kanban" / "boards" / BOARD
    dst.mkdir(parents=True)
    src = sqlite3.connect(f"file:{real_db}?mode=ro", uri=True)
    out = sqlite3.connect(dst / "kanban.db")
    src.backup(out)                       # consistent copy incl. WAL content
    src.close(); out.close()
    (dst / "board.json").write_text(json.dumps({"slug": BOARD, "name": "gantt-demo"}))
    return root


class Server:
    def __init__(self, root: Path, port: int, **cfg):
        self.port = port
        self.cfg = cfg
        env = dict(os.environ)
        env["PYTHONPATH"] = f"{os.path.expanduser('~/.hermes/hermes-agent')}:{REPO}"
        env.pop("HERMES_KANBAN_DB", None)
        env.pop("HERMES_KANBAN_BOARD", None)
        args = [PY, str(HERE / "server.py"), "--root", str(root), "--board", BOARD,
                "--port", str(port)]
        for k, v in cfg.items():
            args += [f"--{k.replace('_', '-')}", str(v)]
        self.proc = subprocess.Popen(args, env=env, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, text=True)
        line = self.proc.stdout.readline()
        try:
            self.ready = json.loads(line)
        except Exception:
            err = self.proc.stderr.read()
            raise RuntimeError(f"server failed to start: {line!r} {err[:2000]}")
        if not self.ready.get("ready"):
            raise RuntimeError(f"server not ready: {self.ready}")
        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                self.stats()
                break
            except Exception:
                if self.proc.poll() is not None:
                    raise RuntimeError(f"server died: {self.proc.stderr.read()[:2000]}")
                time.sleep(0.05)
        else:
            raise RuntimeError("server never answered /_stats")

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    @property
    def ws_url(self) -> str:
        return f"ws://127.0.0.1:{self.port}/events?board={BOARD}"

    def rss_kb(self) -> int:
        for line in Path(f"/proc/{self.proc.pid}/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1])
        return 0

    def cpu_s(self) -> float:
        fields = Path(f"/proc/{self.proc.pid}/stat").read_text().split()
        return (int(fields[13]) + int(fields[14])) / os.sysconf("SC_CLK_TCK")

    def stats(self) -> dict:
        with urllib.request.urlopen(self.base + "/_stats", timeout=5) as r:
            return json.loads(r.read())

    def http(self, path: str) -> tuple[int, float, bytes]:
        t0 = time.perf_counter()
        try:
            with urllib.request.urlopen(self.base + path, timeout=15) as r:
                body = r.read()
            return r.status, (time.perf_counter() - t0) * 1000, body
        except urllib.error.HTTPError as exc:
            return exc.code, (time.perf_counter() - t0) * 1000, exc.read()

    def stop(self) -> None:
        self.proc.terminate()
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()


class Writer:
    """Out-of-process writer, i.e. the dispatcher/CLI/agent case."""

    def __init__(self, root: Path, name="w"):
        self.path = root / "kanban" / "boards" / BOARD / "kanban.db"
        self.name = name
        self.n = 0
        self.conn = sqlite3.connect(self.path, timeout=10, check_same_thread=False)
        self.conn.execute("PRAGMA busy_timeout=5000")

    def add(self, title="proto-write") -> tuple[str, float]:
        self.n += 1
        tid = f"t_proto_{self.name}_{self.n}_{int(time.time()*1000)%100000}"
        t0 = time.time()
        self.conn.execute(
            "INSERT INTO tasks (id,title,status,created_by,priority,created_at) "
            "VALUES (?,?,?,?,?,?)",
            (tid, title, "ready", "proto", 0, int(t0)))
        self.conn.commit()
        return tid, time.time()

    def close(self):
        self.conn.close()


def pct(xs, p):
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(p * len(xs)))], 2) if xs else None


def summarize(xs: list[float]) -> dict:
    if not xs:
        return {"n": 0}
    return {"n": len(xs), "p50": pct(xs, .5), "p95": pct(xs, .95),
            "mean": round(statistics.mean(xs), 2), "max": round(max(xs), 2),
            "min": round(min(xs), 2)}


REAL_DB = os.path.expanduser("~/.hermes/kanban/boards/gantt-demo/kanban.db")


def fresh(tag: str) -> Path:
    """A new consistent copy of the real board for one measurement."""
    return make_staging(tag, REAL_DB)


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


async def wait_for_task_frame(client: Client, tid: str, timeout: float = 10.0):
    """Return (wall time, frame) of the first snapshot that contains `tid`."""
    deadline = time.perf_counter() + timeout
    while time.perf_counter() < deadline:
        for t, _v, frame in client.frame_times:
            if frame.get("type") == "snapshot" and any(
                    x.get("id") == tid for x in frame.get("tasks") or []):
                client.frame_times.clear()
                return t, frame
        await asyncio.sleep(0.005)
    return None, None


# ---------------------------------------------------------------------------
# sections
# ---------------------------------------------------------------------------

async def sec_baseline(root: Path, out: dict) -> None:
    srv = Server(root, free_port(), poll_ms=250, debounce_ms=300, token="")
    try:
        status, ms, body = srv.http(f"/gantt?board={BOARD}")
        payload = json.loads(body)
        snap_bytes = len(body)
        times = []
        for _ in range(30):
            st, ms, _b = await asyncio.to_thread(srv.http, f"/gantt?board={BOARD}")
            times.append(ms)
        # sustained polling load: 20 pages polling as fast as the server answers
        stop = time.time() + 5
        counts = {"n": 0}

        def hammer():
            while time.time() < stop:
                st, t, _ = srv.http(f"/gantt?board={BOARD}")
                counts["n"] += 1

        threads = [threading.Thread(target=hammer) for _ in range(20)]
        cpu0, rss0 = srv.cpu_s(), srv.rss_kb()
        [t.start() for t in threads]
        [t.join() for t in threads]
        cpu1, rss1 = srv.cpu_s(), srv.rss_kb()
        out["baseline"] = {
            "status": status, "snapshot_bytes": snap_bytes,
            "tasks": len(payload.get("tasks") or []),
            "get_gantt_ms": summarize(times),
            "remote_headers_note": "connect-per-request, no ETag, full body",
            "poll_60s_bytes_per_day": snap_bytes * 1440,
            "hammer_20_pages": {"requests": counts["n"], "seconds": 5,
                                "req_per_s": round(counts["n"] / 5, 1),
                                "cpu_s": round(cpu1 - cpu0, 3),
                                "rss_kb": rss1},
        }
    finally:
        srv.stop()


async def sec_setup(root: Path, out: dict) -> None:
    srv = Server(root, free_port(), token="")
    try:
        ms = []
        for _ in range(20):
            c = Client(srv.ws_url, max_dials=1)
            await c.run(until_version=1)
            ms.extend(c.connect_ms)
        out["setup"] = {"handshake_to_first_frame_ms": summarize(ms),
                        "tasks_in_first_frame": len(c.frame_times[-1][2].get("tasks") or [])
                        if c.frame_times else None}
    finally:
        srv.stop()


async def _latency_run(root: Path, out: dict, tag: str, poll_ms: int, debounce_ms: int,
                        n: int = 20, gap: float = 0.3) -> None:
    srv = Server(root, free_port(), poll_ms=poll_ms, debounce_ms=debounce_ms, token="")
    try:
        c = Client(srv.ws_url, max_dials=1)
        run_task = asyncio.create_task(c.run())
        while not c.connects:
            await asyncio.sleep(0.01)
        w = Writer(root, name=tag)
        lat, age, versions = [], [], []
        frame_bytes = None
        frame_tasks = None
        for _ in range(n):
            tid, t_write = w.add()
            t_recv, frame = await wait_for_task_frame(c, tid, timeout=10)
            if t_recv:
                lat.append((t_recv - t_write) * 1000)
                if frame.get("generated_at"):
                    age.append((time.time() - frame["generated_at"]) * 1000)
                versions.append(frame.get("version"))
                if frame_bytes is None:      # first frame = closest to baseline size
                    frame_bytes = len(json.dumps(frame, separators=(",", ":")).encode())
                    frame_tasks = len(frame.get("tasks") or [])
            await asyncio.sleep(gap)
        w.close()
        c.stop(); run_task.cancel()
        stats = await asyncio.to_thread(srv.stats)
        out[tag] = {
            "config": {"poll_ms": poll_ms, "debounce_ms": debounce_ms},
            "write_to_frame_ms": summarize(lat),
            "frame_generated_at_age_ms": summarize(age),
            "versions": versions,
            "server_db_reads": stats["db_reads"],
            "frame_bytes": frame_bytes, "tasks_in_frame": frame_tasks,
            "floor_ms": poll_ms + debounce_ms,
        }
    finally:
        srv.stop()


async def sec_latency(root: Path, out: dict) -> None:
    await _latency_run(fresh("latency-default"), out, "latency_default", 250, 300)
    await _latency_run(fresh("latency-tuned"), out, "latency_tuned", 50, 100)


async def sec_throughput(root: Path, out: dict, seconds: float = 10.0, writers: int = 4,
                         rate_per_writer: float = 50.0, cap: int = 2000) -> None:
    srv = Server(root, free_port(), poll_ms=250, debounce_ms=300, token="")
    try:
        c = Client(srv.ws_url, max_dials=1)
        run_task = asyncio.create_task(c.run())
        while not c.connects:
            await asyncio.sleep(0.01)
        stop = time.time() + seconds
        counts = [0] * writers

        def burst(i):
            w = Writer(root, name=f"t{i}")
            while time.time() < stop and sum(counts) < cap:
                w.add()
                counts[i] += 1
                time.sleep(1.0 / rate_per_writer)
            w.close()

        base_frames = c.frames
        cpu0, rss0 = srv.cpu_s(), srv.rss_kb()
        th = [threading.Thread(target=burst, args=(i,)) for i in range(writers)]
        [t.start() for t in th]
        [t.join() for t in th]
        await asyncio.sleep(1.2)          # drain the tail
        cpu1, rss1 = srv.cpu_s(), srv.rss_kb()
        frames = c.frames - base_frames
        stats = await asyncio.to_thread(srv.stats)
        c.stop(); run_task.cancel()
        out["throughput"] = {
            "config": {"poll_ms": 250, "debounce_ms": 300, "writers": writers},
            "seconds": seconds, "writes": sum(counts), "cap": cap,
            "forced_write_rate": writers * rate_per_writer,
            "writes_per_s": round(sum(counts) / seconds, 1),
            "frames": frames, "frames_per_s": round(frames / seconds, 2),
            "writes_per_frame": round(sum(counts) / max(frames, 1), 1),
            "server_db_reads": stats["db_reads"],
            "cpu_s": round(cpu1 - cpu0, 3),
            "rss_kb": rss1,
        }
    finally:
        srv.stop()


async def sec_fanout(root: Path, out: dict, n_clients: int = 20) -> None:
    srv = Server(root, free_port(), poll_ms=250, debounce_ms=300, token="")
    try:
        rss_before = srv.rss_kb()
        clients = [Client(srv.ws_url, max_dials=1) for _ in range(n_clients)]
        tasks = [asyncio.create_task(c.run()) for c in clients]
        for _ in range(200):
            if all(c.connects for c in clients):
                break
            await asyncio.sleep(0.02)
        await asyncio.sleep(0.5)
        rss_after = srv.rss_kb()
        w = Writer(root, name="fan")
        tid, t_write = w.add()
        got = await asyncio.gather(*[wait_for_task_frame(c, tid, 10) for c in clients])
        lat = [round((r[0] - t_write) * 1000, 1) for r in got if r[0]]
        cpu0 = srv.cpu_s()
        await asyncio.sleep(3)
        cpu1 = srv.cpu_s()
        stats = await asyncio.to_thread(srv.stats)
        for c in clients:
            c.stop()
        for t in tasks:
            t.cancel()
        w.close()
        out["fanout"] = {
            "clients": n_clients, "subscribed": sum(1 for c in clients if c.connects),
            "delivered": len(lat), "one_write_to_all_clients_ms": summarize(lat),
            "server_db_reads_for_one_change": stats["db_reads"],
            "rss_kb_before": rss_before, "rss_kb_after_connect": rss_after,
            "rss_kb_per_connection": round((rss_after - rss_before) / n_clients, 1),
            "idle_cpu_s_per_3s_20_clients": round(cpu1 - cpu0, 3),
            "idle_cpu_percent": round((cpu1 - cpu0) / 3 * 100, 2),
            "frames_per_client": [c.snapshots for c in clients][:5],
        }
    finally:
        srv.stop()


async def sec_kick(root: Path, out: dict) -> None:
    srv = Server(root, free_port(), token="", heartbeat_s=5)
    try:
        c = Client(srv.ws_url, max_dials=3, idle_timeout=12)
        run_task = asyncio.create_task(c.run())
        while not c.connects:
            await asyncio.sleep(0.01)
        await asyncio.sleep(0.3)
        def _kick():
            req = urllib.request.Request(srv.base + "/_kick", method="POST")
            with urllib.request.urlopen(req, timeout=8) as r:
                return json.loads(r.read())

        # must not block this event loop: the server finishes its close handshake
        # with the client, whose loop is this one
        kicked = await asyncio.to_thread(_kick)
        t_kick = time.perf_counter()
        while c.connects < 2 and time.perf_counter() - t_kick < 15:
            await asyncio.sleep(0.01)
        await asyncio.sleep(0.2)
        c.stop(); run_task.cancel()
        out["kick"] = {
            "kicked": kicked, "client_connects": c.connects,
            "reconnected": c.connects >= 2,
            "reconnect_gap_ms": summarize(c.reconnect_gaps),
            "resynced_version": c.last_version,
            "snapshots": c.snapshots, "errors": c.errors[:5],
        }
    finally:
        srv.stop()


class Relay:
    """Transparent TCP relay standing in for a proxy/tunnel. `mode`:
       pass  - forward everything
       stall - stop forwarding after `after` seconds, keep sockets open
       cut   - reset the client connection after `after` seconds
       idle  - close the client connection after `idle` seconds without data
    """

    def __init__(self, target_port: int, mode: str = "pass", after: float = 2.0,
                 idle: float = 2.0):
        self.target_port = target_port
        self.mode = mode
        self.after = after
        self.idle = idle
        self.port = free_port()
        self.server = None
        self.connections = 0

    async def start(self):
        self.server = await asyncio.start_server(self._handle, "127.0.0.1", self.port)
        return self

    async def _handle(self, cr, cw):
        self.connections += 1
        started = time.perf_counter()
        try:
            sr, sw = await asyncio.open_connection("127.0.0.1", self.target_port)
        except Exception:
            cw.close()
            return
        drop = asyncio.Event()

        async def pump(reader, writer, from_client: bool):
            while True:
                try:
                    data = await asyncio.wait_for(reader.read(65536), timeout=0.2)
                except asyncio.TimeoutError:
                    if self.mode == "cut" and time.perf_counter() - started > self.after:
                        drop.set(); return
                    if drop.is_set():
                        return
                    continue
                except Exception:
                    return
                if not data:
                    return
                if self.mode == "stall" and time.perf_counter() - started > self.after:
                    if drop.is_set():
                        return
                    await asyncio.sleep(0.2)
                    continue
                if drop.is_set():
                    return
                try:
                    writer.write(data)
                    await writer.drain()
                except Exception:
                    return

        await asyncio.gather(pump(cr, sw, True), pump(sr, cw, False),
                             return_exceptions=True)
        for w in (cw, sw):
            try:
                w.close()
            except Exception:
                pass

    async def stop(self):
        self.server.close()
        await self.server.wait_closed()


async def sec_blip(root: Path, out: dict) -> None:
    # (a) abrupt reset mid-stream, (b) silent stall detected by the client idle timer
    srv = Server(root, free_port(), token="", heartbeat_s=1)
    try:
        results = {}
        for mode in ("cut", "stall"):
            relay = await Relay(srv.port, mode=mode, after=2.0).start()
            c = Client(f"ws://127.0.0.1:{relay.port}/events?board={BOARD}",
                       max_dials=4, idle_timeout=3.0, backoff_max=2.0)
            run_task = asyncio.create_task(c.run(duration=14))
            await asyncio.sleep(9)
            c.stop()
            await asyncio.wait_for(run_task, timeout=8)
            results[mode] = {
                "connects": c.connects, "reconnect_gaps_ms": summarize(c.reconnect_gaps),
                "errors": c.errors[:6], "snapshots": c.snapshots,
                "versions": [v for _t, v, _f in c.frame_times][-6:],
            }
            await relay.stop()
        out["blip"] = results
    finally:
        srv.stop()


async def sec_auth(root: Path, out: dict) -> None:
    srv = Server(root, free_port(), token="poc-token")
    real = {"absent": None, "wrong": "nope", "valid": "poc-token"}
    results = {}
    try:
        for label, tok in real.items():
            url = srv.ws_url + (f"&token={tok}" if tok else "")
            try:
                ws = await websockets.connect(url, open_timeout=5, ping_interval=None)
                frame = json.loads(await asyncio.wait_for(ws.recv(), 5))
                results[label] = {"handshake": "accepted", "first_frame": frame.get("type"),
                                  "tasks": len(frame.get("tasks") or [])}
                await ws.close()
            except Exception as exc:
                results[label] = {"handshake": "rejected",
                                  "detail": f"{type(exc).__name__}: {exc}"}
        # the shipped gateway, same path: 401 today on /gantt, and the same
        # in-handler gate applies to the ws scope
        try:
            with urllib.request.urlopen(
                    "http://127.0.0.1:9119/api/plugins/kanban-gantt/gantt?board=" + BOARD,
                    timeout=5) as r:
                results["live_gateway_http"] = {"status": r.status}
        except urllib.error.HTTPError as exc:
            results["live_gateway_http"] = {"status": exc.code}
        except Exception as exc:
            results["live_gateway_http"] = {"error": str(exc)}
        out["auth"] = results
    finally:
        srv.stop()


async def sec_multi_instance(root: Path, out: dict) -> None:
    a = Server(root, free_port(), token="", instance="A")
    b = Server(root, free_port(), token="", instance="B")
    try:
        ca = Client(a.ws_url, max_dials=1)
        cb = Client(b.ws_url, max_dials=1)
        ta = asyncio.create_task(ca.run()); tb = asyncio.create_task(cb.run())
        while not (ca.connects and cb.connects):
            await asyncio.sleep(0.01)
        w = Writer(root, name="multi")
        tid, t_write = w.add()
        ra, rb = await asyncio.gather(wait_for_task_frame(ca, tid, 10),
                                      wait_for_task_frame(cb, tid, 10))
        ra, rb = ra[0], rb[0]
        sa = await asyncio.to_thread(a.stats)
        sb = await asyncio.to_thread(b.stats)
        ca.stop(); cb.stop(); ta.cancel(); tb.cancel(); w.close()
        out["multi_instance"] = {
            "instances": 2, "same_database": str(root),
            "A_delivered": ra is not None,
            "B_delivered": rb is not None,
            "A_latency_ms": round((ra - t_write) * 1000, 1) if ra else None,
            "B_latency_ms": round((rb - t_write) * 1000, 1) if rb else None,
            "A_db_reads": sa["db_reads"], "B_db_reads": sb["db_reads"],
            "note": "each process reads on its own; the change detection is per "
                    "process, so N gateways = N reads per change",
        }
    finally:
        a.stop(); b.stop()


async def sec_proxy_idle(root: Path, out: dict) -> None:
    """A proxy that drops connections after N idle seconds: does the data
    heartbeat keep the socket alive, and what does a badly tuned heartbeat cost?"""
    srv = Server(root, free_port(), token="", heartbeat_s=1)
    try:
        # heartbeat 1 s, proxy idle-kill at 3 s -> should stay up
        relay = await Relay(srv.port, mode="idle", idle=3.0).start()
        c = Client(f"ws://127.0.0.1:{relay.port}/events?board={BOARD}",
                   max_dials=6, idle_timeout=4.0, backoff_max=2.0)
        t = asyncio.create_task(c.run(duration=8))
        await asyncio.sleep(8.5)
        c.stop()
        try:
            await asyncio.wait_for(t, timeout=5)
        except Exception:
            pass
        await relay.stop()
        out["proxy_idle"] = {
            "server_heartbeat_s": 1, "proxy_idle_kill_s": 3,
            "connects": c.connects, "reconnects": c.reconnects,
            "heartbeats_seen": c.heartbeats, "errors": c.errors[:4],
        }
    finally:
        srv.stop()


SECTIONS = {
    "baseline": sec_baseline, "setup": sec_setup, "latency": sec_latency,
    "throughput": sec_throughput, "fanout": sec_fanout, "kick": sec_kick,
    "blip": sec_blip, "auth": sec_auth, "multi_instance": sec_multi_instance,
    "proxy_idle": sec_proxy_idle,
}


async def main() -> None:
    global REAL_DB
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", action="append", default=[])
    ap.add_argument("--no-save", action="store_true")
    ap.add_argument("--real-db", default=os.environ.get("KG_REAL_DB", REAL_DB))
    args = ap.parse_args()
    REAL_DB = args.real_db
    root = make_staging(f"run-{int(time.time())}", args.real_db)
    out: dict = {"started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                 "python": sys.version.split()[0], "host": socket.gethostname(),
                 "real_db": args.real_db, "staging_root": str(root),
                 "board": BOARD,
                 "versions": {"fastapi": __import__("fastapi").__version__,
                              "uvicorn": __import__("uvicorn").__version__,
                              "websockets": websockets.__version__}}
    todo = args.only or list(SECTIONS)
    for name in todo:
        t0 = time.perf_counter()
        try:
            await SECTIONS[name](fresh(f"run-{name}"), out)
        except Exception as exc:
            out[name] = {"error": f"{type(exc).__name__}: {exc}"}
        print(f"[{name}] {round(time.perf_counter()-t0, 1)}s", file=sys.stderr, flush=True)
    print(json.dumps(out, indent=2))
    if not args.no_save:
        RESULTS.mkdir(parents=True, exist_ok=True)
        path = RESULTS / "ws-proto.json"
        path.write_text(json.dumps(out, indent=2))
        print(f"saved {path}", file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main())
