#!/usr/bin/env python3
"""Capture the Kanban Gantt views from the running Hermes Desktop app.

The desktop app must expose the Chrome DevTools Protocol, e.g. started with
`--remote-debugging-port=9222`, with the plugin page already open
(`#/kanban-gantt`).

Usage:
    python3 capture/capture.py --port 9222 --out assets/shots/raw

Writes list.png / timeline.png / graph.png at 2x and filters.png at 4x, then
prints ffmpeg crop commands matching the ones used by the compositions.

Requires: pip install websocket-client
"""
from __future__ import annotations

import argparse
import json
import pathlib
import time
import urllib.request

import websocket

VIEWS = ("List", "Timeline", "Graph")


class CDP:
    def __init__(self, port: int, width: int, height: int):
        targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
        page = next(
            t for t in targets
            if t.get("type") == "page" and "kanban-gantt" in (t.get("url") or "")
        )
        self.ws = websocket.create_connection(
            page["webSocketDebuggerUrl"], timeout=30, suppress_origin=True
        )
        self.width, self.height = width, height
        self._id = 0
        self.call("Runtime.enable")
        self.call("Page.enable")

    def call(self, method: str, params: dict | None = None):
        self._id += 1
        self.ws.send(json.dumps({"id": self._id, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self._id:
                return msg

    def js(self, expression: str):
        res = self.call("Runtime.evaluate", {"expression": expression, "returnByValue": True})
        return res["result"]["result"].get("value")

    def scale(self, factor: int):
        self.call("Emulation.setDeviceMetricsOverride", {
            "width": self.width, "height": self.height,
            "deviceScaleFactor": factor, "mobile": False,
        })
        time.sleep(1.5)

    def click_view(self, label: str):
        ok = self.js(
            "(()=>{const b=[...document.querySelectorAll('button,[role=button]')]"
            f".find(x=>(x.getAttribute('aria-label')||'')===%r);"
            "if(!b) return false; b.click(); return true;})()" % label
        )
        if not ok:
            raise SystemExit(f"view button not found: {label}")
        time.sleep(1.8)

    def shot(self, path: pathlib.Path):
        import base64
        res = self.call("Page.captureScreenshot", {"format": "png"})
        path.write_bytes(base64.b64decode(res["result"]["data"]))
        print(f"wrote {path}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9222)
    ap.add_argument("--width", type=int, default=1955)
    ap.add_argument("--height", type=int, default=1067)
    ap.add_argument("--out", default="assets/shots/raw")
    args = ap.parse_args()

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    cdp = CDP(args.port, args.width, args.height)

    cdp.scale(2)
    for view in VIEWS:
        cdp.click_view(view)
        cdp.shot(out / f"{view.lower()}.png")

    # The quick-filter strip is small on screen: capture it at 4x and crop.
    cdp.scale(4)
    cdp.shot(out / "filters.png")

    print("\nffmpeg crops used by the compositions (2x captures unless noted):")
    for name, crop, src in [
        ("tl-zoom", "2340:900:560:500", "timeline.png"),
        ("list-zoom", "2540:1000:460:120", "list.png"),
        ("g-pair", "1400:800:760:360", "graph.png"),
        ("graph-full", "3180:1450:700:130", "graph.png"),
        ("filters-strip", "1300:200:1810:110", "filters.png  # 4x"),
    ]:
        print(f"  ffmpeg -y -i {args.out}/{src.split()[0]} -vf crop={crop} assets/shots/{name}.png")


if __name__ == "__main__":
    main()
