#!/usr/bin/env python3
"""Tiny CDP driver for the whiteboard captures.

The repo's `scripts/shots.py` is the full scenario runner (seed, board switch, GIF). This
one is the minimum needed to look at ONE view: navigate to the page, click the fourth view
chip, screenshot each layout. Same transport (websockets), no assumptions about a demo board.

Usage:
  python3 scripts/cdp.py state
  python3 scripts/cdp.py goto /kanban-gantt
  python3 scripts/cdp.py clicks            # list clickable buttons with their labels
  python3 scripts/cdp.py click "Tableau blanc"
  python3 scripts/cdp.py shot out.png
"""
from __future__ import annotations

import asyncio
import base64
import json
import sys
import urllib.request

import websockets


def page_ws(port: int = 9222) -> str:
    with urllib.request.urlopen(f"http://localhost:{port}/json/list", timeout=5) as r:
        targets = json.load(r)
    pages = [t for t in targets if t.get("type") == "page"]
    if not pages:
        raise SystemExit("no page target")
    return pages[0]["webSocketDebuggerUrl"]


class CDP:
    def __init__(self, ws):
        self.ws = ws
        self.n = 0

    async def call(self, method, **params):
        self.n += 1
        await self.ws.send(json.dumps({"id": self.n, "method": method, "params": params}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get("id") == self.n:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    async def js(self, expression):
        result = await self.call("Runtime.evaluate", expression=expression, returnByValue=True, awaitPromise=True)
        return result.get("result", {}).get("value")

    async def shot(self, path):
        data = await self.call("Page.captureScreenshot", format="png")
        with open(path, "wb") as handle:
            handle.write(base64.b64decode(data["data"]))
        print("shot:", path)


async def main():
    command = sys.argv[1] if len(sys.argv) > 1 else "state"
    async with websockets.connect(page_ws(), max_size=2**26) as ws:
        cdp = CDP(ws)
        await cdp.call("Page.enable")
        await cdp.call("Runtime.enable")

        if command == "state":
            print("url:", await cdp.js("location.href"))
            print("title:", await cdp.js("document.title"))
            print("body:", (await cdp.js("document.body.innerText") or "")[:1200])

        elif command == "goto":
            await cdp.js(f"location.hash = '#{sys.argv[2]}'")
            await asyncio.sleep(2.5)
            print("url:", await cdp.js("location.href"))

        elif command == "clicks":
            print(await cdp.js("""
                JSON.stringify([...document.querySelectorAll('button')]
                  .map(b => ({ label: (b.getAttribute('aria-label') || b.title || b.innerText || '').trim().slice(0, 40),
                               pressed: b.getAttribute('aria-pressed') }))
                  .filter(x => x.label))
            """))

        elif command == "click":
            label = sys.argv[2]
            ok = await cdp.js("""
                (() => {
                  const want = %s;
                  const hit = [...document.querySelectorAll('button')].find(b =>
                    ((b.getAttribute('aria-label') || b.title || b.innerText || '').trim()) === want);
                  if (!hit) return false;
                  hit.click();
                  return true;
                })()
            """ % json.dumps(label))
            await asyncio.sleep(1.2)
            print("clicked:", ok)
            print("pressed:", await cdp.js("""
                JSON.stringify([...document.querySelectorAll('button[aria-pressed="true"]')]
                  .map(b => (b.getAttribute('aria-label') || b.title || b.innerText || '').trim()))
            """))

        elif command == "locate":
            text = sys.argv[2]
            box = await cdp.js("""
                (() => {
                  const want = %s;
                  const nodes = [...document.querySelectorAll('button,[role=tab],a,span,div')];
                  const hit = nodes.reverse().find(e => (e.innerText || '').trim() === want);
                  if (!hit) return null;
                  const r = hit.getBoundingClientRect();
                  if (r.width < 2 || r.height < 2) return null;
                  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
                })()
            """ % json.dumps(text))
            print(box)

        elif command == "mouse":
            x, y = int(sys.argv[2]), int(sys.argv[3])
            for kind in ("mousePressed", "mouseReleased"):
                await cdp.call("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", clickCount=1)
                await asyncio.sleep(0.08)
            await asyncio.sleep(1.0)
            print("clicked at", x, y)

        elif command == "drag":
            x, y, x2, y2 = (int(v) for v in sys.argv[2:6])
            await cdp.call("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y, button="left", buttons=1, clickCount=1)
            for i in range(1, 11):
                await cdp.call("Input.dispatchMouseEvent", type="mouseMoved", x=x + (x2 - x) * i // 10, y=y + (y2 - y) * i // 10, button="left", buttons=1)
                await asyncio.sleep(0.03)
            await cdp.call("Input.dispatchMouseEvent", type="mouseReleased", x=x2, y=y2, button="left", buttons=0, clickCount=1)
            await asyncio.sleep(0.8)
            print("dragged", x, y, "->", x2, y2)

        elif command == "wheel":
            x, y, dy = int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
            await cdp.call("Input.dispatchMouseEvent", type="mouseWheel", x=x, y=y, deltaX=0, deltaY=dy)
            await asyncio.sleep(0.6)
            print("wheel", dy, "at", x, y)

        elif command == "reload":
            await cdp.call("Page.reload", ignoreCache=False)
            await asyncio.sleep(float(sys.argv[2]) if len(sys.argv) > 2 else 8)
            print("reloaded")

        elif command == "shot":
            await cdp.shot(sys.argv[2])

        elif command == "eval":
            print(await cdp.js(sys.argv[2]))

        else:
            raise SystemExit(f"unknown command {command}")


asyncio.run(main())
