#!/usr/bin/env python3
"""Gateway-mount regression test for the websocket prototype.

The gateway does NOT import this plugin the way the standalone dev server does.
Core loads the `api` file with

    spec = importlib.util.spec_from_file_location("hermes_dashboard_plugin_<name>", api_path)
    mod = importlib.util.module_from_spec(spec); sys.modules[name] = mod
    spec.loader.exec_module(mod)
    app.include_router(mod.router, prefix="/api/plugins/<name>",
                       dependencies=[Depends(_plugin_route_secret_scope)])

(`hermes_cli/web_server_dashboard.py:855-882`) — the plugin's own directory is
**never** put on `sys.path`. A plain `import plugin_ws` inside `plugin_api.py`
therefore raises `ImportError` in the only deployment that matters, the error is
swallowed by the "never break the REST backend" guard, and the feature silently
degrades to polling. That is exactly what a real `hermes dashboard` process
logged before this test existed:

    kanban-gantt: websocket prototype unavailable (No module named 'plugin_ws')

So this test imports the plugin the way the gateway does, with the dashboard
directory deliberately absent from `sys.path` (child process, cwd = repo root),
and asserts the route set is correct in both flag states.

Run:  <python-with-fastapi> tests/ws_mount_gateway.py
Exit 0 = passes.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
API = HERE.parent / "dashboard" / "plugin_api.py"

CHILD = r'''
import importlib.util, os, sys

api_path = sys.argv[1]
flag = sys.argv[2]
os.environ["KANBAN_GANTT_WS"] = flag
os.environ.pop("HERMES_KANBAN_DB", None)

# The gateway's exact import: by path, no sys.path entry for the plugin dir.
assert "__file__" , "sanity"
name = "hermes_dashboard_plugin_kanban-gantt"
spec = importlib.util.spec_from_file_location(name, api_path)
mod = importlib.util.module_from_spec(spec)
sys.modules[name] = mod
spec.loader.exec_module(mod)

assert "dashboard" not in " ".join(sys.path), f"plugin dir leaked onto sys.path: {sys.path}"

routes = [getattr(r, "path", None) for r in mod.router.routes]
ws_module = getattr(mod, "plugin_ws", None)

print("ROUTES", routes)
print("PLUGIN_WS", "loaded" if ws_module is not None else "None")
if ws_module is not None:
    api_back = ws_module._plugin_api()
    print("IDENTITY", "same-instance" if api_back is mod else "DUPLICATE-MODULE")
'''

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'} {name}{(' — ' + detail) if detail else ''}")


def run_child(flag: str) -> tuple[str, str]:
    proc = subprocess.run(
        [sys.executable, "-c", CHILD, str(API), flag],
        capture_output=True, text=True, cwd=str(HERE.parent),
    )
    if proc.returncode != 0:
        raise AssertionError(f"child failed (flag={flag}):\n{proc.stdout}\n{proc.stderr}")
    out = proc.stdout
    routes = ""
    ws_state = ""
    identity = ""
    for line in out.splitlines():
        if line.startswith("ROUTES"):
            routes = line[len("ROUTES"):].strip()
        elif line.startswith("PLUGIN_WS"):
            ws_state = line[len("PLUGIN_WS"):].strip()
        elif line.startswith("IDENTITY"):
            identity = line[len("IDENTITY"):].strip()
    return routes, f"{ws_state}|{identity}"


def main() -> int:
    routes_on, state_on = run_child("1")
    check("M1 gateway-style import registers /events when KANBAN_GANTT_WS=1",
          "'/events'" in routes_on, routes_on)
    check("M2 the websocket module is the one the plugin router uses",
          state_on.startswith("loaded") and "same-instance" in state_on, state_on)

    routes_off, state_off = run_child("0")
    check("M3 flag off ⇒ no /events route, REST route set unchanged",
          "'/events'" not in routes_off, routes_off)
    check("M4 flag off ⇒ the websocket module is still importable (no crash)",
          "loaded" in state_off, state_off)

    failed = [n for n, ok, _ in RESULTS if not ok]
    print(f"\nRESULT: {len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
    if failed:
        print("failed: " + ", ".join(failed))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
