#!/usr/bin/env python3
"""SPIKE — measurement harness for the websocket proof-of-concept.

Boots the throwaway PoC server (`poc_server.py`), drives real writes into the
real kanban DB from a *separate* connection (what the dispatcher/CLI/another
agent does), and measures, from the client side:

  1. latency      event → client receipt, shipped defaults vs tuned knobs
  2. throughput   writes/s, frames/s, coalescing ratio, fan-out msgs/s
  3. memory       server RSS + fds per connected client
  4. drop         abrupt client-side reset (RST) → auto-reconnect
  5. restart      server SIGTERM and SIGKILL → auto-reconnect, resnapshot

Output: a JSON result blob on stdout (also written to
`docs/spikes/results/ws-poc.json` unless --no-save) and a human log.

Run:
    PYTHONPATH=$HOME/.hermes/hermes-agent \\
      ~/.hermes/hermes-agent/venv/bin/python docs/spikes/ws-poc/poc_bench.py
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import signal
import socket
import sqlite3
import statistics
import struct
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY = sys.executable
TOKEN = "poc-token"
BOARD = "ws-poc"
LOG: list[str] = []


def log(msg: str) -> None:
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    LOG.append(line)


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def stats(values: list[float]) -> dict:
    if not values:
        return {"n": 0}
    ordered = sorted(values)
    return {
        "n": len(values),
        "p50": round(statistics.median(ordered), 2),
        "p95": round(ordered[min(len(ordered) - 1, int(0.95 * len(ordered)))], 2),
        "max": round(ordered[-1], 2),
        "mean": round(statistics.fmean(ordered), 2),
    }


def proc_metrics(pid: int) -> dict:
    """VmRSS (KB) + open fds + threads of the server process."""
    try:
        status = Path(f"/proc/{pid}/status").read_text()
    except OSError:
        return {}
    kv = dict(line.split(":", 1) for line in status.splitlines() if ":" in line)
    return {
        "rss_kb": int(kv["VmRSS"].strip().split()[0]),
        "threads": int(kv["Threads"].strip()),
        "fds": len(list(Path(f"/proc/{pid}/fd").iterdir())),
    }


# ---------------------------------------------------------------------------
# server lifecycle
# ---------------------------------------------------------------------------

class Server:
    def __init__(self, sandbox: Path, port: int, env: dict | None, board_db: Path | None = None):
        self.sandbox = sandbox
        self.port = port
        self.board_db = board_db
        self.env = dict(os.environ)
        # A kanban worker's env pins a board and forbids board mutation.
        for var in ("HERMES_KANBAN_DB", "HERMES_KANBAN_BOARD",
                    "HERMES_DELEGATED_CHILD_CONTEXT"):
            self.env.pop(var, None)
        self.env["PYTHONPATH"] = str(Path.home() / ".hermes/hermes-agent")
        self.env.update(env or {})
        self.proc: subprocess.Popen | None = None
        self.info: dict = {}

    def url(self) -> str:
        return f"ws://127.0.0.1:{self.port}/events?board={BOARD}"

    async def start(self) -> None:
        cmd = [PY, str(HERE / "poc_server.py"), "--port", str(self.port),
               "--token", TOKEN, "--sandbox", str(self.sandbox)]
        self.proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, env=self.env)
        deadline = time.time() + 60
        while time.time() < deadline:
            line = self.proc.stdout.readline()
            if not line:
                break
            line = line.strip()
            if line.startswith("{"):
                self.info = json.loads(line)
                self.board_db = Path(self.info["db"])
                break
        else:
            raise RuntimeError(f"server did not become ready: {self.info}")
        # The ready line is printed before uvicorn starts listening: wait for the socket.
        deadline = time.time() + 30
        while time.time() < deadline:
            try:
                with socket.create_connection(("127.0.0.1", self.port), timeout=0.5):
                    return
            except OSError:
                await asyncio.sleep(0.05)
        raise RuntimeError(f"server on :{self.port} never accepted a connection")

    async def stop(self, sig: int = signal.SIGTERM) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.send_signal(sig)
            for _ in range(100):
                if self.proc.poll() is not None:
                    return
                await asyncio.sleep(0.05)
            self.proc.kill()

    def metrics(self) -> dict:
        return proc_metrics(self.proc.pid) if self.proc and self.proc.poll() is None else {}


# ---------------------------------------------------------------------------
# writes — a separate sqlite connection, like another process would use
# ---------------------------------------------------------------------------

STATUSES = ("todo", "ready", "running", "blocked", "done")


class Writer:
    """An out-of-process writer: its own sqlite connection, like the dispatcher.

    `write()` inserts a new task (one unique change per call, used for latency).
    `touch()` UPDATEs an existing task the way real board traffic mostly looks —
    so the snapshot size stays constant under a sustained rate instead of
    growing with every write.
    """

    def __init__(self, db: Path, pool: int = 40):
        self.db = db
        self.n = 0
        self.lock = threading.Lock()
        self.conn = sqlite3.connect(db, timeout=10)
        self.conn.execute("PRAGMA busy_timeout=10000")
        self.ids = [r[0] for r in self.conn.execute(
            "SELECT id FROM tasks WHERE id LIKE 't_%' ORDER BY id LIMIT ?", (pool,))]
        if not self.ids:
            raise RuntimeError("no seeded tasks to touch")

    def touch(self) -> float:
        with self.lock:
            n = self.n
            self.n += 1
            self.conn.execute(
                "UPDATE tasks SET status=?, priority=? WHERE id=?",
                (STATUSES[n % len(STATUSES)], n % 4, self.ids[n % len(self.ids)]))
            self.conn.commit()
            return time.time()

    def write(self, label: str = "poc") -> float:
        with self.lock:
            n = self.n
            self.n += 1
            now = int(time.time())
            self.conn.execute(
                "INSERT INTO tasks (id,title,status,created_by,priority,created_at) "
                "VALUES (?,?,?,?,?,?)",
                (f"t_poc_{n:06d}", f"[POC] {label} {n}", "ready", "poc", 0, now))
            self.conn.commit()
            return time.time()

    def close(self) -> None:
        self.conn.close()


# ---------------------------------------------------------------------------
# measurements
# ---------------------------------------------------------------------------

async def m_latency(label: str, env: dict, n_writes: int = 20) -> dict:
    from poc_client import PocClient

    sandbox = Path(tempfile.mkdtemp(prefix="kg-ws-poc-lat-"))
    server = Server(sandbox, free_port(), env)
    await server.start()
    client = PocClient(server.url(), TOKEN, max_refused=99)
    task = asyncio.create_task(client.run())
    writer = Writer(server.board_db)
    try:
        first = await client.next_snapshot(timeout=15)
        if first is None:
            raise RuntimeError("no first snapshot")
        log(f"[{label}] first frame: v{first['version']} {first['n_tasks']} tasks "
            f"{first['bytes']} B")
        e2e: list[float] = []
        server_lat: list[float] = []
        for _ in range(n_writes):
            wrote = writer.write(label)
            snap = await client.next_snapshot(after=wrote, timeout=10)
            if snap is None:
                continue
            e2e.append((snap["recv_ts"] - wrote) * 1000)
            if snap["latency_ms"] is not None:
                server_lat.append(snap["latency_ms"])
            await asyncio.sleep(0.05)
        result = {
            "config": env or {"defaults": True},
            "e2e_write_to_client_ms": stats(e2e),
            # generated_at is integer-second in /gantt: ±1 s, not a transport figure.
            "coarse_generated_at_age_ms": stats(server_lat),
            "versions": client.versions()[:6],
            "frame_bytes": first["bytes"],
        }
        log(f"[{label}] e2e write→client p50={result['e2e_write_to_client_ms'].get('p50')} ms "
            f"p95={result['e2e_write_to_client_ms'].get('p95')} ms "
            f"max={result['e2e_write_to_client_ms'].get('max')} ms")
        return result
    finally:
        client.stop()
        await asyncio.gather(task, return_exceptions=True)
        writer.close()
        await server.stop()


async def m_throughput(env: dict, writers: int = 4, seconds: float = 10.0) -> dict:
    from poc_client import PocClient

    sandbox = Path(tempfile.mkdtemp(prefix="kg-ws-poc-tp-"))
    server = Server(sandbox, free_port(), env)
    await server.start()
    client = PocClient(server.url(), TOKEN, max_refused=99)
    task = asyncio.create_task(client.run())
    try:
        await client.next_snapshot(timeout=15)
        db = server.board_db
        stop_at = time.time() + seconds
        counts = {"writes": 0}
        lock = threading.Lock()

        def hammer(k: int) -> None:
            w = Writer(db)
            local = 0
            try:
                while time.time() < stop_at:
                    w.touch()
                    local += 1
            finally:
                w.close()
                with lock:
                    counts["writes"] += local

        threads = [threading.Thread(target=hammer, args=(k,), daemon=True)
                   for k in range(writers)]
        t0 = time.time()
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        t1 = time.time()
        await asyncio.sleep(1.0)                 # let the last coalescing window flush
        snaps = client.snapshots()
        duration = t1 - t0
        result = {
            "config": env or {"defaults": True},
            "writers": writers,
            "seconds": round(duration, 2),
            "writes": counts["writes"],
            "writes_per_s": round(counts["writes"] / duration, 1),
            "frames": len(snaps),
            "frames_per_s": round(len(snaps) / duration, 2),
            "writes_per_frame": round(counts["writes"] / max(len(snaps), 1), 1),
            "frame_bytes": int(statistics.fmean([f["bytes"] for f in snaps])) if snaps else 0,
            "bytes_per_s": round(sum(f["bytes"] for f in snaps) / duration, 0),
            "versions": (client.versions()[:2], client.versions()[-2:]),
        }
        log(f"[throughput] {result['writes']} writes in {duration:.1f}s "
            f"({result['writes_per_s']}/s) → {result['frames']} frames "
            f"({result['frames_per_s']}/s, {result['writes_per_frame']} writes/frame), "
            f"{result['bytes_per_s']:.0f} B/s")
        return result
    finally:
        client.stop()
        await asyncio.gather(task, return_exceptions=True)
        await server.stop()


async def m_fanout(env: dict, clients: int = 20, seconds: float = 5.0,
                   write_rate: float = 20.0) -> dict:
    from poc_client import PocClient

    sandbox = Path(tempfile.mkdtemp(prefix="kg-ws-poc-fan-"))
    server = Server(sandbox, free_port(), env)
    await server.start()
    conns = [PocClient(server.url(), TOKEN, max_refused=99) for _ in range(clients)]
    tasks = [asyncio.create_task(c.run()) for c in conns]
    try:
        for c in conns:
            await c.next_snapshot(timeout=20)
        base = server.metrics()
        writer = Writer(server.board_db)
        wrote = 0
        t0 = time.time()
        while time.time() - t0 < seconds:
            writer.touch()
            wrote += 1
            await asyncio.sleep(1.0 / write_rate)
        await asyncio.sleep(1.0)
        elapsed = time.time() - t0
        after = server.metrics()
        per_client = [len(c.snapshots()) for c in conns]
        total_frames = sum(per_client)
        result = {
            "clients": clients,
            "writes": wrote,
            "writes_per_s": round(wrote / elapsed, 1),
            "frames_per_client": stats([float(x) for x in per_client]),
            "client_msgs_per_s": round(total_frames / elapsed, 1),
            "single_reader": True,
            "server_rss_kb": {"before": base.get("rss_kb"), "after": after.get("rss_kb")},
        }
        log(f"[fanout] {clients} clients × {statistics.median(per_client)} frames "
            f"= {result['client_msgs_per_s']} client-msgs/s "
            f"({wrote} writes at {write_rate}/s)")
        writer.close()
        return result
    finally:
        for c in conns:
            c.stop()
        await asyncio.gather(*tasks, return_exceptions=True)
        await server.stop()


async def m_memory(env: dict, steps: tuple[int, ...] = (0, 10, 25, 50)) -> dict:
    from poc_client import PocClient

    sandbox = Path(tempfile.mkdtemp(prefix="kg-ws-poc-mem-"))
    server = Server(sandbox, free_port(), env)
    await server.start()
    live: list[PocClient] = []
    tasks: list[asyncio.Task] = []
    samples = []
    try:
        for target in steps:
            while len(live) < target:
                c = PocClient(server.url(), TOKEN, max_refused=99)
                live.append(c)
                tasks.append(asyncio.create_task(c.run()))
            # let every socket complete its handshake + first snapshot
            deadline = time.time() + 30
            while time.time() < deadline:
                got = sum(1 for c in live if c.snapshots())
                if got >= target:
                    break
                await asyncio.sleep(0.05)
            await asyncio.sleep(1.0)
            base = proc_metrics(server.proc.pid)
            samples.append({"clients": target, **base})
            log(f"[memory] {target} clients → RSS {base.get('rss_kb')} KB, "
                f"fds {base.get('fds')}, threads {base.get('threads')}")
        zero = next(s for s in samples if s["clients"] == 0)
        top = samples[-1]
        per_client_kb = round((top["rss_kb"] - zero["rss_kb"]) / max(top["clients"], 1), 1)
        per_client_fd = round((top["fds"] - zero["fds"]) / max(top["clients"], 1), 2)
        log(f"[memory] ≈ {per_client_kb} KB and {per_client_fd} fd per connected client")
        return {"samples": samples, "kb_per_client": per_client_kb,
                "fds_per_client": per_client_fd}
    finally:
        for c in live:
            c.stop()
        await asyncio.gather(*tasks, return_exceptions=True)
        await server.stop()


async def m_drop_rst(env: dict) -> dict:
    """Abrupt reset on a LIVE client socket: SO_LINGER 0 + abort ⇒ RST on the wire.

    The client under test is the one that takes the beating — this measures its
    own auto-reconnect, not a fresh handshake.
    """
    from poc_client import PocClient

    sandbox = Path(tempfile.mkdtemp(prefix="kg-ws-poc-rst-"))
    server = Server(sandbox, free_port(), env)
    await server.start()
    writer = Writer(server.board_db)
    client = PocClient(server.url(), TOKEN, max_refused=99)
    task = asyncio.create_task(client.run())
    try:
        first = await client.next_snapshot(timeout=20)
        v_before = first["version"]
        dropped_at = client.force_reset()
        event = {"kind": "disconnect"}
        deadline = time.time() + 20
        while time.time() < deadline:
            later = [e for e in client.events if e["ts"] > dropped_at]
            if any(e["kind"] == "connect" for e in later):
                break
            await asyncio.sleep(0.02)
        reconnect = next((e for e in client.events
                          if e["kind"] == "connect" and e["ts"] > dropped_at), None)
        snap = await _next_snapshot_after(client, reconnect["ts"] if reconnect else dropped_at,
                                          timeout=10)
        wrote = writer.write("after-rst")
        live = await client.next_snapshot(after=wrote, timeout=10)
        result = {
            "version_before_drop": v_before,
            "version_after_reconnect": snap["version"] if snap else None,
            "snapshot_on_reconnect": bool(snap and snap["n_tasks"] > 0),
            "detect_and_reconnect_ms": round((reconnect["ts"] - dropped_at) * 1000, 1)
            if reconnect else None,
            "retry_delays_ms": [round(e["delay"] * 1000) for e in client.events
                                if e["kind"] == "retry"],
            "frame_after_write": bool(live),
            "post_write_latency_ms": round((live["recv_ts"] - wrote) * 1000, 1) if live else None,
        }
        log(f"[drop/rst] auto-reconnect in {result['detect_and_reconnect_ms']} ms, "
            f"v{v_before} → v{result['version_after_reconnect']} "
            f"(snapshot={result['snapshot_on_reconnect']}), "
            f"post-write frame={result['frame_after_write']} in "
            f"{result['post_write_latency_ms']} ms")
        return result
    finally:
        client.stop()
        await asyncio.gather(task, return_exceptions=True)
        writer.close()
        await server.stop()


async def m_restart(env: dict, sig: int, label: str, downtime: float = 3.0) -> dict:
    from poc_client import PocClient

    sandbox = Path(tempfile.mkdtemp(prefix=f"kg-ws-poc-{label}-"))
    port = free_port()
    server = Server(sandbox, port, env)
    await server.start()
    board_db = server.board_db
    client = PocClient(server.url(), TOKEN, max_refused=999)
    task = asyncio.create_task(client.run())
    try:
        first = await client.next_snapshot(timeout=20)
        v_before = first["version"]
        await asyncio.sleep(0.5)
        killed_at = time.time()
        await server.stop(sig)
        log(f"[{label}] server {signal.Signals(sig).name} at v{v_before}; "
            f"down for {downtime}s")
        await asyncio.sleep(downtime)
        server2 = Server(sandbox, port, env, board_db=board_db)
        await server2.start()
        back_at = time.time()
        # First frame after the outage: must be a full snapshot (a new stream).
        snap = await _next_snapshot_after(client, killed_at + downtime, timeout=40)
        seen_at = time.time()
        result = {
            "signal": signal.Signals(sig).name,
            "version_before": v_before,
            "version_after_restart": snap["version"] if snap else None,
            "snapshot_after_restart": bool(snap and snap["n_tasks"] > 0),
            "detect_ms": round((seen_at - killed_at) * 1000, 0),
            "recovery_after_server_up_ms": round((seen_at - back_at) * 1000, 0),
            "retry_delays_ms": [round(e["delay"] * 1000) for e in client.events
                                if e["kind"] == "retry"][-8:],
            "connects": sum(1 for e in client.events if e["kind"] == "connect"),
            "gave_up": client.gave_up,
        }
        log(f"[{label}] reconnect {result['detect_ms']} ms after the kill "
            f"({result['recovery_after_server_up_ms']} ms after the server was back), "
            f"snapshot v{result['version_after_restart']}, "
            f"retry ladder {result['retry_delays_ms']} ms")
        await server2.stop()
        return result
    finally:
        client.stop()
        await asyncio.gather(task, return_exceptions=True)


async def _next_snapshot_after(client, ts: float, timeout: float):
    deadline = time.time() + timeout
    while time.time() < deadline:
        for f in client.frames:
            if f["type"] == "snapshot" and f["recv_ts"] >= ts:
                return f
        await asyncio.sleep(0.05)
    return None


async def m_auth(env: dict) -> dict:
    """The client's handshake is authenticated: bad token and no token are refused."""
    import websockets

    sandbox = Path(tempfile.mkdtemp(prefix="kg-ws-poc-auth-"))
    server = Server(sandbox, free_port(), env)
    await server.start()
    out = {}
    try:
        for label, qs in (("absent", ""), ("wrong", "&token=nope")):
            try:
                async with websockets.connect(
                        f"{server.url()}{qs}", ping_interval=None) as ws:
                    await asyncio.wait_for(ws.recv(), timeout=5)
                    out[label] = "ACCEPTED"
            except Exception as exc:                     # noqa: BLE001
                out[label] = f"{type(exc).__name__}: {str(exc)[:80]}"
        async with websockets.connect(f"{server.url()}&token={TOKEN}") as ws:
            frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
            out["valid"] = f"ACCEPTED v{frame['version']} {len(frame['tasks'])} tasks"
        log(f"[auth] absent={out['absent']} wrong={out['wrong']} valid={out['valid']}")
        return out
    finally:
        await server.stop()


async def main() -> int:
    global LOG
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-save", action="store_true")
    ap.add_argument("--only", default="", help="comma-separated section names")
    args = ap.parse_args()
    only = {s.strip() for s in args.only.split(",") if s.strip()}

    tuned = {
        "KANBAN_GANTT_WS_POLL_MS": "50",
        "KANBAN_GANTT_WS_DEBOUNCE_MS": "100",
        "KANBAN_GANTT_WS_HEARTBEAT_S": "5",
    }
    default_env: dict = {"KANBAN_GANTT_WS_HEARTBEAT_S": "5"}
    results: dict = {"started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                     "python": sys.version.split()[0],
                     "host": socket.gethostname(),
                     "sections": {}}

    plan = [
        ("auth", lambda: m_auth(default_env)),
        ("latency_default", lambda: m_latency("latency/default", default_env)),
        ("latency_tuned", lambda: m_latency("latency/tuned", tuned)),
        ("throughput_default", lambda: m_throughput(default_env)),
        ("throughput_tuned", lambda: m_throughput(tuned)),
        # Frame-rate ceiling: the coalescing window removed and the change-detection
        # poll at its minimum (25 ms), one writer. This is the "messages/s" roof.
        ("frame_ceiling", lambda: m_throughput(
            {"KANBAN_GANTT_WS_POLL_MS": "25", "KANBAN_GANTT_WS_DEBOUNCE_MS": "0",
             "KANBAN_GANTT_WS_HEARTBEAT_S": "5"}, writers=1, seconds=5.0)),
        ("fanout_20", lambda: m_fanout(tuned, clients=20, seconds=5, write_rate=20)),
        ("memory", lambda: m_memory(tuned)),
        ("drop_rst", lambda: m_drop_rst(default_env)),
        ("restart_term", lambda: m_restart(default_env, signal.SIGTERM, "restart-term")),
        ("restart_kill", lambda: m_restart(default_env, signal.SIGKILL, "restart-kill")),
    ]
    for name, fn in plan:
        if only and name not in only:
            continue
        log(f"===== {name} =====")
        try:
            results["sections"][name] = await fn()
        except Exception as exc:                          # noqa: BLE001
            import traceback
            traceback.print_exc()
            results["sections"][name] = {"error": f"{type(exc).__name__}: {exc}"}

    if not args.no_save:
        out = HERE.parent / "results" / "ws-poc.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(results, indent=2) + "\n")
        (out.parent / "ws-poc.log").write_text("\n".join(LOG) + "\n")
        log(f"results written to {out}")
    print(json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(HERE))
    raise SystemExit(asyncio.run(main()))
