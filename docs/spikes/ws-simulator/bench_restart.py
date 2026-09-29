"""Failure test: the server dies completely, then comes back.

POST /chaos only closes the socket while the process stays up, which is the
easy case. This harness kills the server process mid-session and restarts it
~5s later, so the client has to survive a real outage: repeated failed connect
attempts, exponential backoff with jitter, and resync on reconnect.

Run:  python bench_restart.py
"""
from __future__ import annotations

import asyncio
import json
import statistics
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent
PY = sys.executable
HTTP_PORT, WS_PORT = 8798, 8797


def start_server() -> subprocess.Popen:
    return subprocess.Popen(
        [PY, str(HERE / "server.py"), "--http-port", str(HTTP_PORT),
         "--ws-port", str(WS_PORT), "--update-period", "0.5"],
        cwd=HERE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


async def wait_ready(timeout: float = 10.0) -> float:
    import urllib.request
    loop = asyncio.get_running_loop()
    t0 = time.time()

    def ping() -> None:
        with urllib.request.urlopen(f"http://127.0.0.1:{HTTP_PORT}/api/tasks",
                                    timeout=1) as r:
            r.read()
    while time.time() - t0 < timeout:
        try:
            await loop.run_in_executor(None, ping)
            return (time.time() - t0) * 1000
        except Exception:
            await asyncio.sleep(0.05)
    raise RuntimeError("server never came up")


async def main() -> None:
    client = await asyncio.create_subprocess_exec(
        PY, str(HERE / "ws_client.py"), "--url",
        f"ws://127.0.0.1:{WS_PORT}/ws", "--duration", "22",
        "--out", "ws_restart.json", cwd=HERE,
        stdout=open(HERE / "ws_client_restart.log", "w"),
        stderr=asyncio.subprocess.STDOUT)

    srv = start_server()
    print(f"[restart] server up in {await wait_ready():.0f}ms")

    await asyncio.sleep(6)
    print("[restart] KILLING server", flush=True)
    srv.terminate()
    srv.wait(timeout=5)

    await asyncio.sleep(5)
    print("[restart] restarting server", flush=True)
    srv = start_server()
    print(f"[restart] server back in {await wait_ready():.0f}ms", flush=True)

    await client.wait()
    srv.terminate()
    srv.wait(timeout=5)

    m = json.loads((HERE / "ws_restart.json").read_text())
    print("\n--- ws behaviour across a 5s server outage ---")
    print(f"connects                 {m['connects']}")
    print(f"drops detected           {m['drops']}")
    print(f"messages received        {m['messages']}")
    print(f"reconnect delays (ms)    "
          f"{[round(x) for x in m['reconnect_delays_ms']]}")
    windows = m["disconnected_windows_ms"]
    print(f"outage windows (ms)      {[round(x) for x in windows]}")
    if windows:
        print(f"  -> the real outage was ~5000ms; client spent "
              f"{statistics.median(windows):.0f}ms (median) disconnected before "
              f"reconnecting")


if __name__ == "__main__":
    asyncio.run(main())
