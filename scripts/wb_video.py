#!/usr/bin/env python3
"""Record the whiteboard mode the way scripts/shots.py records the catalogue captures.

Same pre-flight as shots.py (imported, not copied): the LOCAL gateway (« This device »), English
chrome, the other desktop plugins hidden, the sidebar's Pinned/Sessions sections collapsed, the
sidebar narrowed, the file explorer closed — so no session title and none of the team's data can
end up in the video. Then it walks the three layouts, a drag and a click, recorded with
x11grab (smooth video; CDP screencast only pushes a frame when pixels change).

Seed first (English, disposable — the gateway dispatches it):
    python3 ~/.hermes/cache/scratch/seed_wb_demo_en.py

Usage:  python3 scripts/wb_video.py [--display :99] [--out docs/whiteboard-demo.mp4]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import shots  # noqa: E402

BOARD = "whiteboard-demo-en"
PROOF = "Scope signed off"   # a title only this seed holds
shots.DEMO_BOARD = BOARD


async def real_drag(ui, x, y, x2, y2, steps=14):
    await ui.call("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "left", "buttons": 1, "clickCount": 1})
    for i in range(1, steps + 1):
        await ui.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x + (x2 - x) * i / steps,
                                                   "y": y + (y2 - y) * i / steps, "button": "left", "buttons": 1})
        await asyncio.sleep(0.04)
    await ui.call("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x2, "y": y2, "button": "left", "buttons": 0, "clickCount": 1})


async def center(ui, selector, index=0):
    box = await ui.ev(f"""(() => {{
      const e = document.querySelectorAll({json.dumps(selector)})[{index}];
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return {{ x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.x + 40, top: r.y + 22 }};
    }})()""")
    if not box:
        raise shots.Dead(f"nothing matches {selector}[{index}]")
    return box


async def pill(ui, label):
    if not await shots.click_exact(ui, label, selector=".wb-layouts button"):
        raise shots.Dead(f"no « {label} » layout pill")
    await asyncio.sleep(2.2)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9222)
    ap.add_argument("--display", default=os.environ.get("DISPLAY", ":99"))
    ap.add_argument("--size", default="1600x1000")
    ap.add_argument("--out", default=str(shots.ANIM / "whiteboard.mp4"))
    args = ap.parse_args()

    ui = shots.Desktop(args.port)
    await ui.open()
    rec = None
    try:
        await shots.ensure_local_gateway(ui)
        await shots.ensure_english(ui)
        await shots.hide_other_plugins(ui)

        env = {**os.environ, "PYTHONPATH": str(Path.home() / ".hermes" / "hermes-agent")}
        py = str(Path.home() / ".hermes" / "hermes-agent" / "venv" / "bin" / "python3")
        out = subprocess.run([py, "-c", f"from hermes_cli import kanban_db as k; k.set_current_board({BOARD!r}); print(k.get_current_board())"],
                             env=env, capture_output=True, text=True)
        print(f"  current board: {out.stdout.strip() or out.stderr[-200:]}")

        shots.RESTORE["mode"] = await ui.ev("localStorage.getItem('hermes-desktop-mode-v1')")
        await ui.ev(f"""(() => {{
          for (const k of Object.keys(localStorage))
            if (/^hermes\\.plugin\\.kanban-gantt\\.board/.test(k)) localStorage.setItem(k, JSON.stringify({BOARD!r}));
          localStorage.setItem('hermes.plugin.kanban-gantt.board.local', JSON.stringify({BOARD!r}));
          localStorage.setItem('hermes.plugin.kanban-gantt.viewMode', JSON.stringify('whiteboard'));
          localStorage.setItem('hermes.plugin.kanban-gantt.wbLayout@{BOARD}', JSON.stringify('route'));
          localStorage.removeItem('hermes.plugin.kanban-gantt.wbPos@{BOARD}');
          localStorage.setItem('hermes-desktop-mode-v1', 'light');
          return 1;
        }})()""")
        await ui.call("Page.reload", {"ignoreCache": False})
        await asyncio.sleep(9)
        shots.RESTORE["sidebar"] = await shots.resize_sidebar(ui)
        await shots.open_plugin(ui)
        await shots.collapse_private_sections(ui)
        await shots.close_file_explorer(ui)
        if PROOF not in str(await ui.ev("document.body.innerText") or ""):
            raise shots.Dead(f"the page does not show {BOARD} (no {PROOF!r})")
        print("  board: the English seed is on screen")
        # The catalogue stills first, one per layout, then the walkthrough.
        for name, label in (("screenshot-en-09-whiteboard", "Route"), ("screenshot-en-10-whiteboard-columns", "Columns"),
                            ("screenshot-en-11-whiteboard-map", "Map")):
            await pill(ui, label)
            await ui.shot(name)
        await pill(ui, "Route")

        rec = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "x11grab", "-framerate", "25",
                                "-video_size", args.size, "-i", args.display, "-t", "60",
                                "-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "20", args.out],
                               stdin=subprocess.PIPE)
        await asyncio.sleep(2.5)

        # Route: zoom in on the road, then back to the whole plan.
        zin = await center(ui, ".wb-zoom button", 2)   # tidy, out, in, fit
        for _ in range(2):
            await ui.click_xy(zin["x"], zin["y"])
            await asyncio.sleep(1.2)
        await asyncio.sleep(1.5)
        fit = await center(ui, ".wb-zoom button", 3)
        await ui.click_xy(fit["x"], fit["y"])
        await asyncio.sleep(2.2)

        # Hover a card: « Hand to Hermes » and the link port come up (nothing is clicked — a
        # hand-over on a live gateway dispatches a real agent).
        h = await center(ui, "[data-wb-note]", 2)
        await ui.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": h["x"], "y": h["y"]})
        await asyncio.sleep(2.5)

        # Double-click the board: a new card under that phase's milestone (cancelled).
        s = await center(ui, "[data-wb-marker]", 1)
        for n in (1, 2):
            for kind in ("mousePressed", "mouseReleased"):
                await ui.call("Input.dispatchMouseEvent", {"type": kind, "x": s["x"] + 190, "y": s["y"] + 230, "button": "left", "clickCount": n})
        await asyncio.sleep(3.0)
        await shots.press_escape(ui)
        await asyncio.sleep(1.2)

        await pill(ui, "Columns")
        await asyncio.sleep(1.0)
        await pill(ui, "Map")
        await asyncio.sleep(1.0)

        # Drag a whole frame: its notes come with it.
        f = await center(ui, "[data-wb-frame]", 1)
        await real_drag(ui, f["left"], f["top"], f["left"] + 170, f["top"] + 70)
        await asyncio.sleep(2.0)

        # Tidy puts the map back; the route never moved.
        t = await center(ui, ".wb-zoom button", 0)
        await ui.click_xy(t["x"], t["y"])
        await asyncio.sleep(2.0)
        await pill(ui, "Route")
        await asyncio.sleep(1.0)
        await shots.click_exact(ui, "Copy Markdown", selector=".wb-compose button")
        await asyncio.sleep(2.0)
        n = await center(ui, "[data-wb-note]", 1)
        await ui.click_xy(n["x"], n["y"])
        await asyncio.sleep(3.5)
        await shots.press_escape(ui)
        await asyncio.sleep(2.0)
    finally:
        if rec:
            try:
                rec.communicate(b"q", timeout=15)
            except Exception:
                rec.kill()
            print(f"  ✓ {args.out}")
        try:
            await ui.ev(f"localStorage.removeItem('hermes.plugin.kanban-gantt.wbPos@{BOARD}')")
            await shots.restore_plugin_decisions(ui)
            width = shots.RESTORE.get("sidebar")
            if width:
                await shots.resize_sidebar(ui, int(width))
            if shots.RESTORE.get("mode") is not None:
                await ui.ev(f"localStorage.setItem('hermes-desktop-mode-v1', {json.dumps(str(shots.RESTORE['mode']))})")
            await ui.call("Page.reload", {"ignoreCache": False})
            await asyncio.sleep(6)
        except Exception as exc:
            print(f"  ! could not restore the shell state: {exc}")
        if ui.ws:
            await ui.ws.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except shots.Dead as exc:
        print(f"\nSTOP: {exc}\n", file=sys.stderr)
        sys.exit(1)
