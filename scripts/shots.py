#!/usr/bin/env python3
"""Capture the plugin running in the real desktop, and animate it.

Drives Hermes Desktop over CDP (Chrome DevTools Protocol) — the only harness
that renders the REAL component tree, theme and CSS. Nothing is stubbed here.

Before it touches the UI it makes the run deterministic and private:

  1. the app must expose a CDP page target (see LAUNCH below);
  2. the UI language must be English (the catalog entry's screenshots are "-en-");
  3. the active gateway is switched to « This device », so the captures show the
     LOCAL demo board and none of the team's data;
  4. the sidebar's Pinned and Sessions sections are collapsed, so no session
     title can end up in a screenshot;
  5. the plugin's board switcher is set to the demo board.

Then it walks a scenario, writing PNGs into docs/ and a GIF/MP4 into
docs/animations/ (ffmpeg, palettegen/paletteuse).

LAUNCH (the port is gated: a packaged build never opens it by itself, and on
Wayland the app re-execs itself with --ozone-platform, which would leave the
port on a windowless supervisor — so pass the platform flag yourself):

    pkill -f 'release/linux-unpacked/Hermes'
    ~/.hermes/hermes-agent/apps/desktop/release/linux-unpacked/Hermes \
        --ozone-platform=wayland --remote-debugging-port=9222

Seed the board first: .agents/plans/seed-demo-board.py

Usage:  python3 scripts/shots.py [--port 9222] [--no-gif] [--keep-open]
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

try:
    import websockets
except ImportError:  # pragma: no cover
    sys.exit("need the `websockets` package (present in the Hermes runtime)")

REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "docs"
ANIM = DOCS / "animations"
FRAMES = REPO / ".agents" / "plans" / "shot-frames"
DEMO_BOARD = "gantt-demo"

# A detail-rich task to open, and two rows to animate the drag between.
OPEN_TASK = "Retire the legacy dashboard"
DRAG_FROM = "Ask the vendor for a quota increase"
DRAG_TO = "Ingest pipeline — retry storm on the vendor feed"


class Dead(Exception):
    """Something the script cannot work around — stop and tell the human."""


# ── CDP plumbing ────────────────────────────────────────────────────────────
class Desktop:
    def __init__(self, port: int):
        self.port = port
        self.ws = None
        self._id = 0
        self.frames: list[bytes] = []
        self.screencasting = False

    @staticmethod
    def page_target(port: int) -> dict:
        try:
            targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=8))
        except Exception as exc:
            raise Dead(
                f"no CDP listener on {port} ({exc}).\n"
                "Launch the desktop with the platform flag AND the debug port:\n"
                "  pkill -f 'release/linux-unpacked/Hermes'\n"
                "  ~/.hermes/hermes-agent/apps/desktop/release/linux-unpacked/Hermes \\\n"
                f"      --ozone-platform=wayland --remote-debugging-port={port}"
            ) from exc
        page = next((t for t in targets if t.get("type") == "page" and "devtools" not in (t.get("url") or "").lower()), None)
        if not page:
            raise Dead(
                f"the port answers but lists no page target ({len(targets)} targets).\n"
                "On Wayland this means the debug port landed on the supervisor process while the\n"
                "UI lives in the re-exec child: relaunch passing --ozone-platform=wayland yourself."
            )
        return page

    async def open(self):
        page = self.page_target(self.port)
        self.ws = await websockets.connect(page["webSocketDebuggerUrl"], max_size=128 * 1024 * 1024)
        await self.call("Page.enable")
        await self.call("Runtime.enable")
        return page

    async def call(self, method: str, params: dict | None = None) -> dict:
        self._id += 1
        mid = self._id
        await self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get("method") == "Page.screencastFrame":
                self.frames.append(base64.b64decode(msg["params"]["data"]))
                await self.ws.send(json.dumps({
                    "id": self._id, "method": "Page.screencastFrameAck",
                    "params": {"sessionId": msg["params"]["sessionId"]}}))
                continue
            if msg.get("id") == mid:
                if "error" in msg:
                    raise Dead(f"{method}: {msg['error'].get('message')}")
                return msg.get("result", {})

    async def ev(self, expression: str):
        res = await self.call("Runtime.evaluate",
                              {"expression": expression, "returnByValue": True, "awaitPromise": True})
        out = res.get("result") or {}
        if out.get("subtype") == "error":
            raise Dead(out.get("description", "javascript error"))
        return out.get("value")

    async def click_text(self, text: str, *, exact: bool = True, scope: str = "button") -> bool:
        """Click the first <button> (or given scope) carrying that text."""
        js = f"""(() => {{
          const want = {json.dumps(text)};
          const nodes = [...document.querySelectorAll({json.dumps(scope)})];
          const hit = nodes.find(e => {{
            const t = e.textContent.trim();
            return {'t === want' if exact else 't.includes(want)'};
          }});
          if (!hit) return false;
          hit.click();
          return true;
        }})()"""
        return bool(await self.ev(js))

    async def shot(self, name: str, *, clip: dict | None = None):
        params = {"format": "png"}
        if clip:
            params["clip"] = clip
        res = await self.call("Page.captureScreenshot", params)
        DOCS.mkdir(parents=True, exist_ok=True)
        path = DOCS / f"{name}.png"
        path.write_bytes(base64.b64decode(res["data"]))
        print(f"  ✓ {path.relative_to(REPO)}  ({path.stat().st_size // 1024} kB)")
        return path

    async def start_screencast(self, quality: int = 80):
        FRAMES.mkdir(parents=True, exist_ok=True)
        shutil.rmtree(FRAMES, ignore_errors=True)
        FRAMES.mkdir(parents=True, exist_ok=True)
        await self.call("Page.startScreencast",
                        {"format": "jpeg", "quality": quality, "maxWidth": 1280, "everyNthFrame": 1})
        self.screencasting = True

    async def stop_screencast(self):
        if not self.screencasting:
            return
        await self.call("Page.stopScreencast")
        self.screencasting = False
        for i, data in enumerate(self.frames):
            (FRAMES / f"frame-{i:05d}.jpg").write_bytes(data)
        print(f"  {len(self.frames)} frames captured")


# ── pre-flight ──────────────────────────────────────────────────────────────
async def ensure_english(ui: Desktop):
    """The catalog screenshots are English; the app follows its own locale."""
    probe = await ui.ev("""(() => {
      const txt = document.body.innerText;
      return { fr: /Nouvelle session|Paramètres|Épinglées|Réglages/.test(txt),
               en: /New session|Settings|Pinned/.test(txt) };
    })()""")
    if probe.get("en") and not probe.get("fr"):
        print("  language: English ✓")
        return
    print("  language is not English — opening Settings → Appearance to switch it")
    # gear, top right
    opened = await ui.ev("""(() => {
      const b = [...document.querySelectorAll('button')].find(e =>
        /parameters|settings|réglages|paramètres/i.test((e.getAttribute('aria-label')||'') + (e.getAttribute('title')||'')));
      if (!b) return false; b.click(); return true;
    })()""")
    if not opened:
        raise Dead("could not find the Settings button — set the language to English by hand, then rerun")
    await asyncio.sleep(1.0)
    for label in ("Appearance", "Apparence", "Language", "Langue"):
        await ui.click_text(label, exact=False, scope="button,[role=tab],a")
        await asyncio.sleep(0.4)
    picked = await ui.ev("""(() => {
      const trig = [...document.querySelectorAll('button,[role=combobox]')].find(e =>
        /language|langue/i.test((e.getAttribute('aria-label')||'') + ' ' + e.textContent));
      if (trig) { trig.click(); return 'opened'; }
      return 'no trigger';
    })()""")
    await asyncio.sleep(0.8)
    chosen = await ui.click_text("English", exact=False, scope="[role=option],button,div")
    await asyncio.sleep(1.2)
    await ui.ev("document.body.click()")  # close the sheet
    await asyncio.sleep(0.6)
    still = await ui.ev("(() => /Nouvelle session|Paramètres/.test(document.body.innerText))()")
    print(f"  switch attempt: trigger={picked}, chosen={chosen}, still_french={still}")
    if still:
        raise Dead("the language is still French — switch it in Settings → Appearance, then rerun")


async def ensure_local_gateway(ui: Desktop):
    """Plugin API calls go to the app's ACTIVE gateway; the team's data lives on
    the remote one. Switch to « This device » so the captures stay local."""
    current = await ui.ev("""(async () => {
      try { const r = await window.hermesDesktop.api({ path: '/api/plugins/kanban-gantt/meta' });
            return r && r.board ? 'remote:' + r.board : 'unknown'; } catch (e) { return 'error:' + e.message; }
    })()""")
    print(f"  gateway before: {current}")
    if str(current).startswith("error"):
        print("  (the plugin route is not mounted on the active gateway — continuing)")
    opened = await ui.ev("""(() => {
      const chip = [...document.querySelectorAll('button')].find(e =>
        /registered gateways|gateways|this device|fixe13/i.test((e.getAttribute('aria-label')||'') + ' ' + e.textContent));
      if (!chip) return false; chip.click(); return true;
    })()""")
    if not opened:
        raise Dead("could not find the « Registered gateways » chip in the status bar")
    await asyncio.sleep(0.9)
    picked = await ui.ev("""(() => {
      const want = /this device/i;
      const item = [...document.querySelectorAll('[role=menuitem],[role=option],button,li,div')]
        .filter(e => want.test(e.textContent.trim()) && e.textContent.trim().length < 40)
        .pop();
      if (!item) return false;
      item.click(); return true;
    })()""")
    await asyncio.sleep(2.0)
    if not picked:
        raise Dead("no « This device » entry in the gateway panel — pick it by hand, then rerun")
    after = await ui.ev("""(async () => {
      try { const r = await window.hermesDesktop.api({ path: '/api/plugins/kanban-gantt/boards' });
            return (r.boards || []).map(b => b.slug).join(','); } catch (e) { return 'error'; }
    })()""")
    print(f"  gateway now: {after}")
    if DEMO_BOARD not in str(after):
        raise Dead(f"the demo board '{DEMO_BOARD}' is not visible — is it seeded, and is « This device » active?")


async def collapse_private_sections(ui: Desktop):
    """Hide the user's own sessions before anything is captured."""
    for label in ("Pinned", "Épinglées", "Sessions"):
        clicked = await ui.ev(f"""(() => {{
          const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === {json.dumps(label)});
          if (!b) return 'absent';
          const open = b.getAttribute('aria-expanded') !== 'false';
          if (open) b.click();
          return open ? 'collapsed' : 'already collapsed';
        }})()""")
        if clicked != "absent":
            print(f"  {label}: {clicked}")
    await asyncio.sleep(0.5)


# ── the scenario ────────────────────────────────────────────────────────────
async def open_plugin(ui: Desktop):
    ok = await ui.ev("""(() => {
      const span = [...document.querySelectorAll('span')].find(s => s.textContent.trim() === 'Kanban Gantt');
      const btn = span && span.closest('button');
      if (!btn) return false; btn.click(); return true;
    })()""")
    if not ok:
        raise Dead("the « Kanban Gantt » entry is missing from the sidebar")
    await asyncio.sleep(2.5)


async def select_board(ui: Desktop):
    opened = await ui.ev("""(() => {
      const b = [...document.querySelectorAll('button')].find(e => /^Board\\b/.test(e.textContent.trim()));
      if (!b) return false; b.click(); return true;
    })()""")
    await asyncio.sleep(0.8)
    if opened:
        await ui.click_text(DEMO_BOARD, exact=False, scope="[role=menuitem],button,div")
        await asyncio.sleep(2.0)
    rows = await ui.ev("(() => document.body.innerText.split('\\n').filter(t => t.trim().length > 12).length)()")
    print(f"  rows with text: {rows}")


async def run_scenario(ui: Desktop, *, make_gif: bool):
    print("scenario")
    await ui.shot("screenshot-en-01")

    # the enrichments the drawer has to show
    clicked = await ui.ev(f"""(() => {{
      const want = {json.dumps(OPEN_TASK)};
      const row = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === want);
      if (!row) return false; row.click(); return true;
    }})()""")
    if clicked:
        await asyncio.sleep(1.6)
        await ui.shot("screenshot-en-02-details")
    else:
        print("  ! task to open not found — skipping the drawer shot")

    # the creation dialog, left unsubmitted
    await ui.ev("""(() => {
      const b = [...document.querySelectorAll('button')].find(e => /new task|nouvelle tâche/i.test(e.textContent.trim()));
      if (b) b.click();
    })()""")
    await asyncio.sleep(1.0)
    await ui.shot("screenshot-en-03-new-task")
    await ui.ev("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))")
    await asyncio.sleep(0.6)

    # the drag: refused target first (red), then the accepted drop
    if make_gif:
        await ui.start_screencast()
    await ui.ev(f"""(() => {{
      const want = {json.dumps(DRAG_FROM)};
      const from = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === want);
      const to = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === {json.dumps(DRAG_TO)});
      if (!from || !to) return false;
      const cell = from.closest('[draggable=true]') || from.parentElement;
      const target = to.closest('tr,div');
      const data = new DataTransfer();
      cell.dispatchEvent(new DragEvent('dragstart', {{bubbles: true, dataTransfer: data}}));
      target.dispatchEvent(new DragEvent('dragover', {{bubbles: true, dataTransfer: data}}));
      target.dispatchEvent(new DragEvent('drop', {{bubbles: true, dataTransfer: data}}));
      return true;
    }})()""")
    await asyncio.sleep(2.0)
    await ui.shot("screenshot-en-04-move")
    if make_gif:
        await ui.stop_screencast()


def encode_animation():
    frames = sorted(FRAMES.glob("frame-*.jpg"))
    if not frames:
        print("  no frames — no animation produced")
        return
    ANIM.mkdir(parents=True, exist_ok=True)
    mp4 = ANIM / "kanban-gantt.gif"
    palette = FRAMES / "palette.png"
    pattern = str(FRAMES / "frame-%05d.jpg")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "8", "-i", pattern,
                    "-vf", "scale=1280:-1:flags=lanczos,palettegen", str(palette)], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "8", "-i", pattern,
                    "-i", str(palette), "-lavfi", "paletteuse", str(mp4)], check=True)
    print(f"  ✓ {mp4.relative_to(REPO)}  ({mp4.stat().st_size // 1024} kB, {len(frames)} frames)")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("HERMES_CDP_PORT", "9222")))
    ap.add_argument("--no-gif", action="store_true")
    args = ap.parse_args()

    ui = Desktop(args.port)
    page = await ui.open()
    print(f"attached: {page.get('title')} ({args.port})")
    try:
        await ensure_english(ui)
        await ensure_local_gateway(ui)
        await collapse_private_sections(ui)
        await open_plugin(ui)
        await select_board(ui)
        await run_scenario(ui, make_gif=not args.no_gif)
    finally:
        if ui.screencasting:
            await ui.stop_screencast()
            ui.screencasting = False
        if not args.no_gif:
            encode_animation()
        if ui.ws:
            await ui.ws.close()
    print("done")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Dead as exc:
        print(f"\nSTOP: {exc}\n", file=sys.stderr)
        sys.exit(1)
