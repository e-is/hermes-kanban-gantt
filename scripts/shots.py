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
import re
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
# A title only the demo seed holds: the capture's proof that the pane really shows that
# board (the header no longer carries a chip to read back).
DEMO_TASK = "Provision the analytics cluster"
# Desktop plugins that must NOT appear in a capture: the sidebar's plugin list is the shell's,
# not the plugin's, so a catalogue image of kanban-gantt should not advertise its neighbours.
OTHER_PLUGINS = ("model-leaderboard", "kanban-graph")
DECISIONS_KEY = "hermes.desktop.pluginDecisions.v2"

# A detail-rich task to open. (The drag pair that used to live here went with the
# drag capture: leaving a drag behind contaminated every later still.)
OPEN_TASK = "Retire the legacy dashboard"


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

    async def click_xy(self, x: float, y: float):
        """Real mouse events at viewport coordinates (menu items ignore .click())."""
        for kind in ("mousePressed", "mouseReleased"):
            await self.call("Input.dispatchMouseEvent",
                            {"type": kind, "x": x, "y": y, "button": "left", "clickCount": 1})

    async def shot(self, name: str, *, clip: dict | None = None):
        params = {"format": "png"}
        if clip:
            params["clip"] = clip
        res = await self.call("Page.captureScreenshot", params)
        if "data" not in res:  # a frame can be missed mid-navigation: retry once
            await asyncio.sleep(0.8)
            res = await self.call("Page.captureScreenshot", params)
        if "data" not in res:
            raise Dead(f"the desktop returned no frame for {name}")
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
    """The catalog screenshots are English; the app follows the ACTIVE GATEWAY's locale.

    Two things this probe must not do. It must not read `document.body.innerText`: the
    open session's transcript is part of the body, so a French conversation made the app
    look French while its chrome was English — the run then "switched" the language and
    aborted on a page that was already correct. And it must run AFTER the gateway switch
    (`ensure_local_gateway`): `display.language` is read from the active connection's
    config, so on the team's remote gateway the whole shell is French. Hence: chrome only.
    """
    probe = await ui.ev("""(() => {
      const chrome = [...document.querySelectorAll('nav button, aside button, header button, [role=tab]')]
        .map(b => (b.getAttribute('aria-label') || '') + ' ' + (b.textContent || ''))
        .join(' | ');
      return { fr: /Nouvelle session|Paramètres|Épinglées|Réglages|Apparence/.test(chrome),
               en: /New session|Settings|Pinned|Appearance/.test(chrome) };
    })()""") or {}
    if not probe.get("fr"):
        print("  language: English ✓" if probe.get("en") else "  language: no French chrome ✓")
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
    still = await ui.ev("""(() => {
      const chrome = [...document.querySelectorAll('nav button, aside button, header button, [role=tab]')]
        .map(b => (b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')).join(' | ');
      return /Nouvelle session|Paramètres|Apparence/.test(chrome);
    })()""")
    print(f"  switch attempt: trigger={picked}, chosen={chosen}, still_french={still}")
    if still:
        raise Dead("the language is still French — switch it in Settings → Appearance, then rerun")


async def press_escape(ui: Desktop):
    """A real Esc, so a menu or sheet the last run left open cannot swallow the next click.

    Learned the hard way: a leftover open menu makes the gateway chip's click CLOSE it, the
    run then finds no « This device » entry and aborts on a shell that was one Escape from fine.
    """
    for kind in ("keyDown", "keyUp"):
        await ui.call("Input.dispatchKeyEvent", {
            "type": kind, "key": "Escape", "code": "Escape",
            "windowsVirtualKeyCode": 27, "nativeVirtualKeyCode": 27
        })
    await asyncio.sleep(0.4)


async def gateway_chip(ui: Desktop) -> str:
    """What the status bar says the window is talking to.

    This, not `hermesDesktop.getConnection()`: with a registered remote gateway that call
    keeps reporting the registry entry (`mode: remote`) even after the window has been
    switched to « This device » — measured on the 1.7.0 shell, where it aborted a run whose
    chrome was already local (and English). The chip is the honest readout.
    """
    return str(await ui.ev("""(() => {
      const c = [...document.querySelectorAll('button')].find(e =>
        /registered gateways|connexions/i.test(e.getAttribute('aria-label') || ''));
      return c ? (c.textContent || '').trim() : '';
    })()""") or "")


async def ensure_local_gateway(ui: Desktop):
    """Plugin API calls follow the app's ACTIVE gateway — the team's boards live
    on the remote one, so switch to « This device » and prove it before capturing.

    Two traps found the hard way: the status-bar chip's own text contains
    "This device", so a text search can click the chip instead of the menu item;
    and `hermesDesktop.api({path})` WITHOUT a connectionId falls through to the
    legacy route, which is the remote — a probe that looks like an answer but
    reports the wrong gateway. Hence the mouse click and the pinned probe.
    """
    # The chip only names the active gateway once one is applied, which is after
    # the boot settles — a run started too early used to bail out here.
    label = ""
    for _ in range(20):
        label = await gateway_chip(ui)
        if label:
            break
        await asyncio.sleep(3)
    if not label:
        raise Dead("could not find the « Registered gateways » chip in the status bar")
    print(f"  gateway chip: {label}")

    if not re.search(r"this device|cet appareil", label, re.I):
        await press_escape(ui)   # a leftover menu would be CLOSED by the chip click

        chip_box = await ui.ev("""(() => {
          const c = [...document.querySelectorAll('button')].find(e =>
            /registered gateways|connexions/i.test(e.getAttribute('aria-label') || ''));
          if (!c) return null;
          const r = c.getBoundingClientRect();
          return JSON.stringify([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]);
        })()""")
        if not chip_box or chip_box == "null":
            raise Dead("could not locate the gateway chip's position")
        cx, cy = json.loads(chip_box)
        await ui.click_xy(cx, cy)  # a real pointer click: the menu ignores .click()

        # the menu renders asynchronously; its items are language-dependent
        box = None
        for _ in range(8):
            await asyncio.sleep(0.5)
            box = await ui.ev("""(() => {
              const item = [...document.querySelectorAll('[role=menuitemradio],[role=menuitem]')]
                .find(e => /this device|cet appareil/i.test(e.textContent.trim()));
              if (!item) return null;
              const r = item.getBoundingClientRect();
              return JSON.stringify([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]);
            })()""")
            if box and box != "null":
                break
        if not box or box == "null":
            raise Dead("no « This device » entry in the gateway menu — pick it by hand, then rerun")
        x, y = json.loads(box)
        await ui.click_xy(x, y)
        await asyncio.sleep(3)

        # Switching asks for confirmation in the UI ("Switch to this device?").
        confirm = await ui.ev("""(() => {
          const d = [...document.querySelectorAll('[role=alertdialog],[role=dialog]')]
            .filter(e => e.getBoundingClientRect().width > 100).pop();
          if (!d) return null;
          const b = [...d.querySelectorAll('button')]
            .find(e => /switch|basculer|confirm|confirmer/i.test(e.textContent.trim()));
          if (!b) return null;
          const r = b.getBoundingClientRect();
          return JSON.stringify([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]);
        })()""")
        if confirm and confirm != "null":
            x, y = json.loads(confirm)
            await ui.click_xy(x, y)
            print("  confirmed the gateway switch")
            await asyncio.sleep(9)
        else:
            await asyncio.sleep(6)

    after = await gateway_chip(ui)
    print(f"  gateway chip now: {after}")
    if not re.search(r"this device|cet appareil", after, re.I):
        raise Dead(f"still not on « This device » ({after!r}) — switch it by hand, then rerun")

    # Pinned to the local connection: this is the route the plugin's own calls use.
    boards = await ui.ev("""(async () => {
      try { const r = await window.hermesDesktop.api({ path: '/api/plugins/kanban-gantt/boards', connectionId: 'local' });
            return (r.boards || []).map(b => b.slug).join(','); } catch (e) { return 'error: ' + e.message; }
    })()""")
    print(f"  local gateway boards: {boards}")
    if DEMO_BOARD not in str(boards):
        raise Dead(f"the demo board '{DEMO_BOARD}' is not on this gateway — seed it first "
                   "(.agents/plans/seed-demo-board.py)")


async def ensure_current_board(ui: Desktop):
    """Point the gateway at the demo board, then remount the plugin surface.

    The plugin paints the CURRENT board of its gateway. A gateway that holds only
    named boards has no root kanban.db, so its current board resolves to
    `default` — which does not exist — and the pane spins forever. Switching the
    gateway also leaves the surface bound to the connection it was mounted under,
    so the renderer is reloaded before the plugin is opened again.
    """
    code = (f"from hermes_cli import kanban_db as k; k.set_current_board({DEMO_BOARD!r}); "
            "print(k.get_current_board())")
    env = {**os.environ, "PYTHONPATH": str(Path.home() / ".hermes" / "hermes-agent")}
    out = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True)
    if out.returncode != 0:
        raise Dead("could not set the current board:\n" + (out.stderr or out.stdout)[-400:])
    print(f"  current board: {out.stdout.strip()}")

    await ui.call("Page.enable")
    # UI state the frames must not inherit. The label column's width is persisted,
    # and a previous run (or a manual drag) can leave the timeline crushed against
    # the drawer; the view mode is persisted too. Reset both to the plugin's own
    # defaults while the page is about to be reloaded anyway, so the captures show
    # the layout the catalog should show rather than whatever the last run left.
    # The frames must not inherit what a previous run — or a manual test — left
    # behind: the column width, the view mode, and the SHELL's own light/dark mode
    # (this machine follows the system, and a switch to dark turned every capture
    # dark). Both shell values are put back at the end of the run.
    RESTORE["mode"] = await ui.ev("(() => localStorage.getItem('hermes-desktop-mode-v1'))")
    RESTORE["sidebar"] = await resize_sidebar(ui)
    await ui.ev("""(() => {
      localStorage.setItem('hermes.plugin.kanban-gantt.labelW', '400');
      localStorage.setItem('hermes.plugin.kanban-gantt.viewMode', '"timeline"');
      localStorage.setItem('hermes-desktop-mode-v1', 'light');
      return true;
    })()""")
    await ui.call("Page.reload", {"ignoreCache": False})
    await asyncio.sleep(9)


async def collapse_private_sections(ui: Desktop):
    """Hide the user's own sessions before anything is captured."""
    for label in ("Pinned", "Sessions", "Épinglées"):
        clicked = await ui.ev(f"""(() => {{
          const want = {json.dumps(label)}.toLowerCase();
          const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim().toLowerCase() === want);
          if (!b) return 'absent';
          const open = b.getAttribute('aria-expanded') !== 'false';
          if (open) b.click();
          return open ? 'collapsed' : 'already collapsed';
        }})()""")
        if clicked != "absent":
            print(f"  {label}: {clicked}")
    # Every OTHER sidebar section (Telegram, Cron jobs, …) lists session titles as well, and its
    # header carries no aria-expanded. The section's own container does the talking: a collapsed
    # group holds its header alone, an open one holds more — so the count is what keeps this
    # idempotent (clicking a collapsed header would OPEN it).
    other = await ui.ev("""(() => {
      const heads = [...document.querySelectorAll('button')].filter(e => {
        const r = e.getBoundingClientRect();
        return r.x < 260 && r.y > 60 &&
          /^(Telegram|Cron jobs|Discord|Slack|Projects|Workspaces)/i.test((e.textContent || '').trim());
      });
      let n = 0;
      for (const h of heads) {
        const section = h.parentElement && h.parentElement.parentElement;
        if (section && section.children.length > 1) { h.click(); n++; }
      }
      return n;
    })()""")
    if other:
        print(f"  other sidebar sections: {other} collapsed")
    await asyncio.sleep(0.6)


# ── the scenario ────────────────────────────────────────────────────────────
SIDEBAR_W = 232       # px — what the shell's sidebar is dragged to for a capture
RESTORE: dict = {}    # shell state the run must put back (mode, sidebar width)


async def resize_sidebar(ui: Desktop, target: int = SIDEBAR_W):
    """Drag the shell's sidebar sash in, the way a user would.

    The sidebar owns a third of the frame otherwise, and nothing it shows is the
    subject. The width is the shell's own persisted layout, so the run leaves it
    where the user finds it — hence the printed before/after, and the one drag
    that puts it back if you want the old value.
    """
    box = await ui.ev("""(() => {
      const s = [...document.querySelectorAll('[role=separator]')].find(e => {
        const r = e.getBoundingClientRect();
        return /col-resize/.test(getComputedStyle(e).cursor) && r.x < 600 && r.height > 400;
      });
      if (!s) return null;
      const r = s.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
                              before: Math.round(r.x) });
    })()""")
    if not box:
        print("  ! sidebar sash not found — leaving the sidebar alone")
        return None
    b = json.loads(box)
    if abs(b["before"] - target) < 4:
        print(f"  sidebar: already {b['before']}px")
        return b["before"]
    await ui.call("Input.dispatchMouseEvent", {"type": "mousePressed", "x": b["x"], "y": b["y"],
                                               "button": "left", "clickCount": 1})
    for i in range(1, 9):
        x = round(b["x"] + (target - b["before"]) * i / 8)
        await ui.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": b["y"],
                                                   "button": "left"})
        await asyncio.sleep(0.03)
    await ui.call("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": round(b["x"] + (target - b["before"])),
                                               "y": b["y"], "button": "left", "clickCount": 1})
    await asyncio.sleep(0.5)
    after = await ui.ev("""(() => {
      const s = [...document.querySelectorAll('[role=separator]')].find(e => {
        const r = e.getBoundingClientRect();
        return /col-resize/.test(getComputedStyle(e).cursor) && r.x < 600 && r.height > 400;
      });
      return s ? Math.round(s.getBoundingClientRect().x) : null;
    })()""")
    print(f"  sidebar: {b['before']}px -> {after}px")
    return b["before"]


async def open_plugin(ui: Desktop):
    """Open the plugin surface with a REAL pointer click, then wait until it is mounted.

    The sidebar ignores synthetic clicks in this shell — the same trap as the board switcher — and
    the old version only checked that the entry EXISTED. So a reload that closed the surface (the
    view-state reset does exactly that) left the run about to capture a page that was never opened,
    and to photograph an empty plugin without saying so.
    """
    await press_escape(ui)   # never click through a sheet the last run left open
    box = await ui.ev("""(() => {
      const span = [...document.querySelectorAll('span')].find(s => s.textContent.trim() === 'Kanban Gantt');
      const btn = span && span.closest('button');
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()""")
    if not box:
        raise Dead("the « Kanban Gantt » entry is missing from the sidebar")
    await ui.click_xy(box["x"], box["y"])
    # Mounted means its own chrome is on screen, and the view toggle is the stable anchor:
    # 1.7.0's header carries the board's own name where « Board … » used to sit, so the old
    # text probe waited twenty seconds on a page that was already open.
    for _ in range(20):
        await asyncio.sleep(1.0)
        ready = await ui.ev("""(() => [...document.querySelectorAll('button')]
          .some(e => (e.getAttribute('aria-label') || '').trim() === 'Graph'))()""")
        if ready:
            print("  plugin surface mounted")
            return
    raise Dead("« Kanban Gantt » was clicked but its page never mounted")


async def select_board(ui: Desktop):
    """Point the plugin at the demo board through its stored preference, then prove it.

    The 1.7.0 header shows the board's own name instead of a « Board … » chip, so there is no
    switcher to click by label — and clicking blind is what the old comment was warning about.
    Worse, the plugin reads a PER-CONNECTION key (`board.<connectionId>`), and that scope stays
    the registry's connection even after the window was switched to « This device »: `board.local`
    already read `gantt-demo` while the page painted `sumaris`. So every `board*` key is pointed
    at the demo board, the page reloaded, and the result checked against a task only that seed
    holds — a title, not a chip, because a title is what the pane actually draws.
    """
    keys = await ui.ev("""(() => {
      const out = [];
      for (const k of Object.keys(localStorage)) {
        if (!/^hermes\\.plugin\\.kanban-gantt\\.board/.test(k)) continue;
        localStorage.setItem(k, JSON.stringify('gantt-demo'));
        out.push(k);
      }
      return out;
    })()""")
    print(f"  board preference(s) set: {', '.join(keys or []) or 'none'}")
    await ui.call("Page.reload", {"ignoreCache": False})
    await asyncio.sleep(9)
    await open_plugin(ui)
    # AFTER the reload, not before: the sections' collapse is not persisted, and the reload
    # above re-opens them — which is how a run that collapsed earlier still photographed the
    # user's own session titles.
    await collapse_private_sections(ui)
    text = str(await ui.ev("(() => document.body.innerText)()") or "")
    if DEMO_TASK not in text:
        raise Dead(f"the page does not show the demo board (no {DEMO_TASK!r}) — "
                   "the captures would show the wrong data")
    print("  board: the demo seed is on screen")
    rows = await ui.ev("(() => document.body.innerText.split('\\n').filter(t => t.trim().length > 12).length)()")
    print(f"  rows with text: {rows}")


async def close_file_explorer(ui: Desktop):
    """Close the project file-browser panel: its tree is workspace noise in a capture.

    The panel lives in the shell's « right sidebar » (whose SIDE the user can swap — it renders
    on the left here), and its own toolbar only offers gitignored / refresh / collapse-all. The
    titlebar's « Hide right sidebar » is the control that actually closes it, and its label flips
    to « Show … » once it is, so the presence of the tree's own buttons is what decides.
    """
    tree_open = """(() => [...document.querySelectorAll('button')]
      .some(e => /refresh tree|actualiser l/i.test(e.getAttribute('aria-label') || '')))()"""
    if not await ui.ev(tree_open):
        print("  file explorer: already closed")
        return
    if not await click_attr(ui, "Hide right sidebar"):
        print("  ! no « Hide right sidebar » button — leaving the file explorer as it is")
        return
    await asyncio.sleep(1.2)
    if await ui.ev(tree_open):
        print("  ! the file explorer is still on screen")
    else:
        print("  file explorer: closed")


async def hide_other_plugins(ui: Desktop):
    """Take the other desktop plugins off the sidebar for THIS run, and put them back after.

    The desktop keeps its own per-plugin switches in `hermes.desktop.pluginDecisions.v2` — a name
    -> enabled map, independent of `hermes plugins disable`, which only tells the gateway's
    registry. The map as found is saved in RESTORE and re-applied by `restore_plugin_decisions`;
    a capture has no business leaving the user's app reconfigured.
    """
    RESTORE["pluginDecisions"] = await ui.ev(f"localStorage.getItem({DECISIONS_KEY!r})")
    after = await ui.ev(f"""(() => {{
      const key = {DECISIONS_KEY!r};
      let map = {{}};
      try {{ map = JSON.parse(localStorage.getItem(key) || '{{}}'); }} catch (e) {{ map = {{}}; }}
      for (const name of {json.dumps(list(OTHER_PLUGINS))}) map[name] = false;
      map['kanban-gantt'] = true;
      localStorage.setItem(key, JSON.stringify(map));
      return Object.entries(map).map(([k, v]) => `${{k}}=${{v ? 'on' : 'off'}}`);
    }})()""")
    print(f"  plugin decisions: {', '.join(after or [])}")


async def restore_plugin_decisions(ui: Desktop):
    saved = RESTORE.get("pluginDecisions")
    if saved is None:
        return
    await ui.ev(f"""(() => {{
      localStorage.setItem({DECISIONS_KEY!r}, {json.dumps(saved)});
      return 1;
    }})()""")
    RESTORE.pop("pluginDecisions", None)
    print("  plugin decisions restored")
    RESTORE["needsReload"] = True


async def click_exact(ui: Desktop, text: str, *, selector: str = "button") -> bool:
    """Click the last element whose trimmed text is exactly `text`, with REAL pointer events.

    Menu items and segmented controls ignore synthetic `.click()` in this shell — the board
    switcher taught us that — so anything that opens or picks from a popup goes through
    coordinates. The LAST match is the innermost visible one (a menu item's div and its span
    both carry the label).
    """
    box = await ui.ev(f"""(() => {{
      const want = {json.dumps(text)};
      const hits = [...document.querySelectorAll({json.dumps(selector)})]
        .filter(e => (e.textContent || '').trim() === want);
      const hit = hits[hits.length - 1];
      if (!hit) return null;
      const r = hit.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return {{ x: r.left + r.width / 2, y: r.top + r.height / 2 }};
    }})()""")
    if not box:
        return False
    await ui.click_xy(box["x"], box["y"])
    return True


async def click_attr(ui: Desktop, label: str) -> bool:
    """Click the first on-screen element whose aria-label is exactly `label`, by coordinates."""
    box = await ui.ev(f"""(() => {{
      const want = {json.dumps(label)};
      const hit = [...document.querySelectorAll('[aria-label]')]
        .filter(e => e.getAttribute('aria-label') === want)
        .find(e => {{ const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }});
      if (!hit) return null;
      const r = hit.getBoundingClientRect();
      return {{ x: r.left + r.width / 2, y: r.top + r.height / 2 }};
    }})()""")
    if not box:
        return False
    await ui.click_xy(box["x"], box["y"])
    return True


async def capture_graph(ui: Desktop, name: str = "screenshot-en-08-graph"):
    """The third mode, captured on the demo board in « Flow, top down » with the scope on « All ».

    Both choices are deliberate. `down` is the arrangement a reader meets first and the one
    that reads like a dependency tree; the scope must be `All`, because any narrower scope
    hides exactly the edges the picture exists to show. Fit comes last: the camera is
    persisted per board, so a zoom left by a previous session frames a corner.
    """
    # The scenario above opened a task's detail. A docked drawer squeezes the graph to two
    # thirds of the pane and lights a lineage nobody asked for — not what a catalogue image
    # should show. Escape is the page's own shortcut for it; the button is the fallback, and
    # the LAST one is the drawer's (the tab strip has a Close of its own, far to the left).
    await press_escape(ui)
    await asyncio.sleep(0.9)
    if await ui.ev("(() => /Add a comment/i.test(document.body.innerText))()"):
        box = await ui.ev("""(() => {
          const btns = [...document.querySelectorAll('button')]
            .filter(e => /^close$/i.test((e.getAttribute('aria-label') || '').trim()))
            .map(e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
          return btns.length ? btns[btns.length - 1] : null;
        })()""")
        if box:
            await ui.click_xy(box["x"], box["y"])
            await asyncio.sleep(0.9)
        if await ui.ev("(() => /Add a comment/i.test(document.body.innerText))()"):
            print("  ! the task detail is still open — the graph will be narrower than it should")

    if not await ui.click_text("Graph"):
        print("  ! graph toggle not found — skipping the graph shot")
        return None
    await asyncio.sleep(1.8)
    if await click_attr(ui, "How the cards are arranged"):
        await asyncio.sleep(0.7)
        if not await click_exact(ui, "Flow, top down", selector="[role=menuitem]"):
            print("  ! « Flow, top down » not in the arrangement menu — keeping the default")
        await asyncio.sleep(1.6)
    else:
        print("  ! arrangement dropdown not found — capturing the default arrangement")
    if await click_exact(ui, "All", selector='[aria-label="Which tasks are shown"] button'):
        await asyncio.sleep(1.0)
    else:
        print("  ! scope toggle not found — the scope stays as the run found it")
    if await click_attr(ui, "Fit"):
        await asyncio.sleep(1.4)
    return await ui.shot(name)


async def run_scenario(ui: Desktop, *, make_gif: bool):
    print("scenario")
    # The view mode is PERSISTED, so a previous run — or a manual test — can leave
    # the app in list mode. Force the timeline first: every capture up to the list
    # shot at the end of this function is a timeline, whatever the run found.
    before = await ui.ev("(() => localStorage.getItem('hermes.plugin.kanban-gantt.viewMode'))")
    await ui.click_text("Timeline")
    await asyncio.sleep(1.0)
    await ui.shot("screenshot-en-01")

    # the enrichments the drawer has to show
    clicked = await ui.ev(f"""(() => {{
      const want = {json.dumps(OPEN_TASK)};
      const leaves = [...document.querySelectorAll('*')].filter(e => e.children.length === 0);
      const row = leaves.find(e => e.textContent.trim() === want) ||
                  leaves.find(e => e.textContent.trim().startsWith(want.slice(0, 24)));
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

    # The drag-and-drop step that used to be captured here is GONE: the still was
    # near-useless in a catalogue, and the drag it left behind kept its outline on
    # the source row and its highlight on the target — which contaminated every
    # still taken after it. What the animation records instead is what the column
    # and the toggle actually do, at the end of this function.


    # ── the tree column: fold a branch, so the affordance reads on screen ─────
    # A collapsed parent is what the column is for: the boxed `+`, the hidden
    # count in its tooltip, and the connectors that survive around it.
    async def toggle_first(prefix: str) -> bool:
        """Click the first fold square whose aria-label starts with `prefix`."""
        return bool(await ui.ev(f"""(() => {{
          const sq = [...document.querySelectorAll('span[role=button]')]
            .find(s => (s.getAttribute('aria-label') || '').startsWith({json.dumps(prefix)}));
          if (!sq) return false;
          sq.click();
          return true;
        }})()"""))

    if await toggle_first("Collapse "):
        await asyncio.sleep(0.9)
        await ui.shot("screenshot-en-05-tree-folded")
        await toggle_first("Expand ")          # the list shots show the whole tree
        await asyncio.sleep(0.7)
    else:
        print("  ! no fold square found — skipping the folded-tree shot")

    # ── the list view: the LAST captures are in list mode ────────────────────
    # Same page, same board: the toggle trades the timeline for task / assignee /
    # status / last activity.
    if await ui.click_text("List"):
        await asyncio.sleep(1.2)
        await ui.shot("screenshot-en-06-list")
        # and the point of the two views sharing one column: a row in list mode
        # keeps its fold square, its connectors and its indentation
        if await toggle_first("Collapse "):
            await asyncio.sleep(0.9)
            await ui.shot("screenshot-en-07-list-folded")
            await toggle_first("Expand ")
            await asyncio.sleep(0.6)
    else:
        print("  ! list toggle not found — skipping the list-view shots")

    # ── the graph view: the dependency structure of the same board ───────────
    await capture_graph(ui)

    # The animation, LAST: Page.captureScreenshot returns no frame while a
    # screencast runs, so every still above has to be taken first.
    if make_gif:
        # Back to the timeline first: the fold beats below are timeline affordances, and the
        # graph capture above left the page on the third view.
        await ui.click_text("Timeline")
        await asyncio.sleep(0.9)
        await ui.start_screencast()
        await toggle_first("Collapse ")
        await asyncio.sleep(0.9)
        await toggle_first("Expand ")
        await asyncio.sleep(0.7)
        await ui.click_text("Timeline")
        await asyncio.sleep(0.4)
        await ui.click_text("List")
        await asyncio.sleep(1.0)
        # …and the third mode, which is what this release is about.
        await ui.click_text("Graph")
        await asyncio.sleep(1.8)
        await ui.stop_screencast()
        await asyncio.sleep(0.4)

    # Leave the app in the mode the run found it in.
    if before and "list" in str(before):
        await ui.click_text("List")
    else:
        await ui.click_text("Timeline")
    await asyncio.sleep(0.6)


def cleanup_board():
    """Delete the demo board, because the gateway DISPATCHES it.

    Measured the hard way: an `auto-decomposer` split the triage card into
    children within a minute of seeding and the dispatcher spawned real agent runs
    (`spawned=2` in the gateway log) that spent tokens on demo data. The board is
    therefore built by the seed at the start of a run and removed here at the end,
    so the window in which it can attract a worker is seconds, and a stray board
    never survives between captures.
    """
    board_dir = Path.home() / ".hermes" / "kanban" / "boards" / DEMO_BOARD
    if not board_dir.exists():
        return
    code = ("import sys, os;"
            "sys.path.insert(0, os.path.expanduser('~/.hermes/hermes-agent'));"
            "from hermes_cli import kanban_db as k;"
            "from hermes_cli import kanban_db_connect;"
            "c = kanban_db_connect.connect(board=sys.argv[1]);"
            "ids = [r[0] for r in c.execute('SELECT id FROM tasks')];"
            "[k.archive_task(c, t) for t in ids];"
            "c.commit();"
            "print(len(ids))")
    env = {**os.environ, "PYTHONPATH": str(Path.home() / ".hermes" / "hermes-agent")}
    out = subprocess.run([sys.executable, "-c", code, DEMO_BOARD], env=env, capture_output=True, text=True)
    if out.returncode == 0:
        print(f"  archived {out.stdout.strip()} demo tasks before removing the board")
    shutil.rmtree(board_dir, ignore_errors=True)
    print(f"  removed the demo board ({board_dir}) — the gateway dispatches it, so it must not linger")


def encode_animation():
    frames = sorted(FRAMES.glob("frame-*.jpg"))
    if not frames:
        print("  no frames — no animation produced")
        return
    ANIM.mkdir(parents=True, exist_ok=True)
    gif = ANIM / "kanban-gantt.gif"
    mp4 = ANIM / "kanban-gantt.mp4"
    palette = FRAMES / "palette.png"
    # A captured frame is a BEAT, not a tick: Chromium pushes one only when the pixels change,
    # so a run yields 4–12 frames whatever its duration. Encoding them at a nominal 8 fps turned
    # a five-beat walkthrough into a half-second flash (measured: 4 frames, 0.5 s). Each frame is
    # therefore held for most of a second through a concat list, and the 8 fps the palette pass
    # declares is just the sampling grid for the GIF encoder.
    HOLD = 0.9
    listing = FRAMES / "frames.txt"
    listing.write_text("".join(f"file '{f.resolve()}'\nduration {HOLD}\n" for f in frames)
                       + f"file '{frames[-1].resolve()}'\n")
    source = ["-f", "concat", "-safe", "0", "-i", str(listing)]
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *source,
                    "-vf", "fps=8,scale=1280:-1:flags=lanczos,palettegen", str(palette)], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *source,
                    "-i", str(palette), "-lavfi", "fps=8,paletteuse", str(gif)], check=True)
    print(f"  ✓ {gif.relative_to(REPO)}  ({gif.stat().st_size // 1024} kB, "
          f"{len(frames)} beats held {HOLD}s each)")
    # MP4 as well: easier to review than a GIF, and what a release page embeds.
    try:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *source,
                        "-vf", "fps=8,scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264",
                        "-pix_fmt", "yuv420p", "-crf", "20", str(mp4)], check=True)
        print(f"  ✓ {mp4.relative_to(REPO)}  ({mp4.stat().st_size // 1024} kB)")
    except subprocess.CalledProcessError as exc:
        print(f"  (no MP4: {exc})")


async def notify(ui: Desktop, message: str):
    """Tell the human the run is over — WITHOUT blocking the renderer.

    `alert()` is a native dialog in this shell: it freezes the page's JS until someone clicks
    OK, and that freezes CDP with it. Measured: a run that ended on an alert left the app
    unreachable minutes later (`Page.captureScreenshot` and `Runtime.evaluate` both timing out,
    while `/json` still answered). A desktop notification, or nothing but the log line, is the
    right amount of courtesy.
    """
    try:
        channel = await ui.ev(f"""(() => {{
          const text = {json.dumps(message)};
          const d = window.hermesDesktop;
          if (d && typeof d.notify === 'function') {{
            try {{ d.notify({{ kind: 'info', message: text }}); return 'host'; }} catch (e) {{}}
          }}
          if (window.Notification && Notification.permission === 'granted') {{
            try {{ new Notification('Kanban Gantt — capture', {{ body: text }}); return 'web'; }} catch (e) {{}}
          }}
          return 'none';
        }})()""")
        print(f"  notified via: {channel}")
    except Exception as exc:  # a notification is a courtesy, never a failure
        print(f"  (could not raise the notification: {exc})")


async def reset_view_state(ui: Desktop):
    """Put the plugin page back to its default surface before capturing.

    Every key below survives a reload, so a capture run inherits whatever the last session left:
    a list view instead of the timeline, the "only tasks with attachments" filter still on, a
    folded tree. The scenario then finds no fold square and no task to open.
    """
    folds = await ui.ev("""(() => {
      localStorage.removeItem('hermes.plugin.kanban-gantt.viewMode');
      localStorage.removeItem('hermes.plugin.kanban-gantt.onlyAttachments');
      localStorage.removeItem('hermes.plugin.kanban-gantt.disabledStatuses');
      const foldKeys = Object.keys(localStorage).filter(k => k.indexOf('kanban-gantt.fold') >= 0);
      foldKeys.forEach(k => localStorage.removeItem(k));
      return foldKeys.length;
    })()""")
    await ui.call("Page.reload", {"ignoreCache": True})
    await asyncio.sleep(9)
    print(f"  view state reset ({folds} fold key(s) cleared)")


def seed_board():
    """Re-seed the demo board, then capture at once.

    The board is a live kanban board: the dispatcher works it (an
    `auto-decomposer` run splits a triage task within a minute of seeding), so a
    capture is only faithful if it happens right after a fresh seed.
    """
    script = REPO / ".agents" / "plans" / "seed-demo-board.py"
    if not script.is_file():
        raise Dead(f"seed script not found at {script.relative_to(REPO)}")
    python = os.environ.get("HERMES_SEED_PYTHON") or sys.executable
    env = {**os.environ, "PYTHONPATH": str(Path.home() / ".hermes" / "hermes-agent")}
    print(f"seeding the demo board ({script.name}, {python})")
    out = subprocess.run([python, str(script)], env=env, capture_output=True, text=True)
    tail = [l for l in out.stdout.splitlines() if l.strip().startswith(("board", "tasks=", "  archived", "  "))]
    for line in tail[-3:]:
        print("  " + line.strip())
    if out.returncode != 0:
        raise Dead("seeding failed:\n" + (out.stderr or out.stdout)[-600:])
    if "import ruamel" in out.stderr or "No module named 'ruamel'" in out.stderr:
        raise Dead("the seed needs an interpreter with hermes_cli's dependencies — "
                   "set HERMES_SEED_PYTHON to one that has ruamel.yaml")


def render_card():
    """Draw the catalogue card (scripts/card.py) — no desktop, no CDP needed."""
    script = REPO / "scripts" / "card.py"
    if not script.is_file():
        print("  ! scripts/card.py not found — skipping the catalogue card")
        return
    env = {**os.environ, "PYTHONPATH": str(Path.home() / ".hermes" / "hermes-agent")}
    out = subprocess.run([sys.executable, str(script)], capture_output=True, text=True, env=env)
    for line in out.stdout.splitlines():
        if line.startswith("card:"):
            print("  " + line)
    if out.returncode != 0:
        print("  ! card render failed: " + (out.stderr or out.stdout)[-300:])


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("HERMES_CDP_PORT", "9222")))
    ap.add_argument("--no-gif", action="store_true")
    ap.add_argument("--no-seed", action="store_true",
                    help="keep the board as it is (it is dispatchable: agents may have worked on it)")
    ap.add_argument("--keep-board", action="store_true",
                    help="leave the seeded demo board in place (it is dispatched, so it spends tokens)")
    ap.add_argument("--no-card", action="store_true",
                    help="skip the catalogue card (scripts/card.py draws it; no desktop needed)")
    args = ap.parse_args()

    if not args.no_seed:
        seed_board()

    ui = Desktop(args.port)
    page = await ui.open()
    print(f"attached: {page.get('title')} ({args.port})")
    outcome = "Capture terminée."
    try:
        # Gateway FIRST: the shell's locale is read from the ACTIVE connection's config,
        # so switching afterwards would mean capturing French chrome after checking for
        # English on the remote gateway (the team's is French).
        await ensure_local_gateway(ui)
        await ensure_english(ui)
        # Stored now, applied by the reloads below — and put back in the `finally`.
        await hide_other_plugins(ui)
        await ensure_current_board(ui)
        # The capture must not inherit what the last session left on the page. These keys survive a
        # reload, so a run could find a list view instead of the timeline, the "only tasks with
        # attachments" filter still on, or a folded tree — and then report "no fold square found",
        # no task to open, and five frames instead of twelve.
        await reset_view_state(ui)
        await open_plugin(ui)
        await select_board(ui)
        # After the last reload: the file browser's panel state is restored by the shell on boot.
        await close_file_explorer(ui)
        await run_scenario(ui, make_gif=not args.no_gif)
    except Dead as exc:
        outcome = f"Capture interrompue : {exc}"
        raise
    except Exception as exc:  # unexpected: still tell the human
        outcome = f"Capture interrompue ({type(exc).__name__}) : {exc}"
        raise
    finally:
        if ui.screencasting:
            await ui.stop_screencast()
            ui.screencasting = False
        # Put the shell back the way the run found it: a capture has no business
        # leaving the user in light mode with a narrower sidebar.
        try:
            await restore_plugin_decisions(ui)
            if RESTORE.get("sidebar"):
                await resize_sidebar(ui, int(RESTORE["sidebar"]))
            if RESTORE.get("mode") is not None:
                await ui.ev(f"""(() => {{
                  localStorage.setItem('hermes-desktop-mode-v1', {json.dumps(str(RESTORE['mode']))});
                  return true;
                }})()""")
                await ui.call("Page.reload", {"ignoreCache": False})
                await asyncio.sleep(7)
                RESTORE.pop("needsReload", None)
            # The plugin switches are only read at boot: without this the sidebar would keep
            # hiding the neighbours until the user restarted the app themselves.
            if RESTORE.pop("needsReload", False):
                await ui.call("Page.reload", {"ignoreCache": False})
                await asyncio.sleep(7)
        except Exception as exc:
            print(f"  ! could not restore the shell state: {exc}")
        if not args.no_card:
            render_card()
        if not args.no_gif:
            try:
                encode_animation()
            except Exception as exc:
                print(f"  ! animation not encoded: {exc}")
        if not args.keep_board:
            try:
                cleanup_board()
            except Exception as exc:
                print(f"  ! demo board not removed: {exc}")
        shots = sorted(p.name for p in DOCS.glob("screenshot-en-*.png"))
        gif = ANIM / "kanban-gantt.gif"
        detail = "\n".join(f"• docs/{s}" for s in shots[-4:])
        if gif.is_file():
            detail += f"\n• docs/animations/{gif.name}"
        await notify(ui, f"{outcome}\n\n{detail}\n\n(écrits dans hermes-kanban-gantt)")
        if ui.ws:
            await ui.ws.close()
    print("done")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Dead as exc:
        print(f"\nSTOP: {exc}\n", file=sys.stderr)
        sys.exit(1)
