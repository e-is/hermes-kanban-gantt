#!/usr/bin/env python3
"""Render the catalogue card for kanban-gantt as a 2:1 PNG.

The card is DRAWN, not generated. The other catalogue entries are terminal-style
cards whose typography no image model reproduces reliably — FLUX turns
"plugins install" into glyph soup — so the card is composed in HTML/CSS, which
also leaves one obvious place to tweak the wording, the palette or the bars, and
rasterised with the Chromium Hermes already ships.

It needs neither the desktop nor a CDP port, so it runs anywhere:

    python3 scripts/card.py                    # -> docs/catalog-card.png
    python3 scripts/card.py --out /tmp/x.png --scale 1 --keep-html

`scripts/shots.py` calls it at the end of a capture run (skip with
`--no-card`), so one command keeps the stills and the catalogue card in sync.

Format: the catalogue's entries are all 2:1 banners — measured on four of them:
1600x800, 1280x640, 1200x600, 1280x640 — so 1280x640 is the default, rendered at
2x and downscaled for crisp text.
"""

from __future__ import annotations

import argparse
import glob
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MANIFEST = REPO / "plugin.yaml"

# ── what the card says ───────────────────────────────────────────────────────
# Edit here, nothing else. `VERSION` comes from the manifest so the card cannot
# claim a release the plugin is not on.
PACKAGE = "kanban-gantt"
TAGLINE = ("Kanban timelines for <b>Hermes Agent</b> "
           "— every task becomes a bar")
SPECS = ["SQLite · local store", "boards · tasks · links",
         "<span class=\"hl\">no API keys</span>", "one bar per task · real timestamps"]

# ── the drawn gantt ─────────────────────────────────────────────────────────
# label (leading spaces = depth, kept verbatim), fold box, (start %, width %),
# dashed?, annotation. Starts are staggered on purpose: a waterfall rhythm reads
# as a plan, an aligned stack reads as a table.
BLUE, GREEN, AMBER = "#4a84fe", "#3fb950", "#d29922"
ROWS: list[tuple[str, str, tuple[int, int], bool, str, str]] = [
    ("agent · kanban board",      "",      (0, 100), False, "running",           BLUE),
    ("└ Provision the cluster",   "minus", (4, 62),  False, "done ✓",            GREEN),
    ("  └ Warehouse migration",   "minus", (20, 42), False, "running",           BLUE),
    ("    └ Backfill partitions", "leaf",  (38, 42), True,  "waiting on parent", AMBER),
    ("└ Retire the dashboard",    "plus",  (6, 26),  False, "done ✓",            GREEN),
    ("  └ Operator guide",        "leaf",  (26, 74), True,  "todo",              AMBER),
]

# ── the look ────────────────────────────────────────────────────────────────
BG, PANEL, GRID = "#0d1117", "#11161d", "rgba(255,255,255,.035)"
FG, MUTED, BORDER = "#e6edf3", "#8b949e", "#30363d"
MONO = ('ui-monospace, "JetBrains Mono", "Cascadia Mono", "DejaVu Sans Mono", monospace')
WIDTH, HEIGHT = 1280, 640


def version() -> str:
    """`version:` from plugin.yaml, so the card cannot drift from the release."""
    try:
        m = re.search(r'^version:\s*["\']?([^"\'\n]+)', MANIFEST.read_text(encoding="utf-8"), re.M)
        return m.group(1).strip() if m else ""
    except OSError:
        return ""


def row_html(label: str, glyph: str, span: tuple[int, int], dashed: bool,
             note: str, color: str) -> str:
    box = {"minus": '<span class="bx">−</span>', "plus": '<span class="bx">+</span>'}.get(
        glyph, '<span class="bx empty"></span>')
    style = f"left:{span[0]}%;width:{span[1]}%;" + (
        f"border-color:{color};" if dashed else f"background:{color};")
    cls = "bar wait" if dashed else "bar"
    return (f'\n      <div class="row">\n'
            f'        <div class="lab">{box}<span class="name">{label}</span></div>\n'
            f'        <div class="track"><span class="{cls}" style="{style}"></span></div>\n'
            f'        <div class="note">{note}</div>\n'
            f'      </div>')


def html() -> str:
    rows = "".join(row_html(*r) for r in ROWS)
    specs = "<br>\n      ".join(SPECS)
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>kanban-gantt catalogue card</title><style>
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  html,body {{ width:{WIDTH}px; height:{HEIGHT}px; }}
  body {{
    background:{BG}; color:{FG}; font-family:{MONO}; overflow:hidden;
    background-image:
      linear-gradient(to right, {GRID} 1px, transparent 1px),
      linear-gradient(to bottom, {GRID} 1px, transparent 1px);
    background-size:40px 40px, 40px 40px;
  }}
  .card {{ position:relative; width:{WIDTH}px; height:{HEIGHT}px; padding:46px 56px 34px; }}
  .top {{ display:flex; justify-content:space-between; align-items:flex-start; gap:40px; }}
  .cmd {{ font-size:15px; color:{MUTED}; }}
  .cmd b {{ color:{GREEN}; font-weight:600; }}
  h1 {{ font-size:76px; line-height:1.02; font-weight:700; letter-spacing:-1.5px; color:#dfe6ee; margin-top:14px; }}
  h1 .dash {{ color:{BLUE}; }}
  .tag {{ margin-top:14px; font-size:20px; color:{MUTED}; }}
  .tag b {{ color:{FG}; font-weight:600; }}
  .specs {{ text-align:right; font-size:14px; color:{MUTED}; line-height:1.85; white-space:nowrap; }}
  .specs .hl {{ color:{BLUE}; }}
  .gantt {{ position:absolute; left:56px; right:56px; bottom:86px; }}
  .row {{ display:grid; grid-template-columns:300px 1fr 190px; align-items:center; height:39px; }}
  .lab {{ display:flex; align-items:center; gap:8px; font-size:14.5px; color:#c9d1d9; }}
  .name {{ white-space:pre; }}
  .bx {{ width:15px; height:15px; flex:0 0 15px; display:inline-flex; align-items:center; justify-content:center;
        border:1px solid {BORDER}; border-radius:3px; font-size:11px; color:{MUTED}; background:#161b22; }}
  .bx.empty {{ border-color:transparent; background:transparent; }}
  .track {{ position:relative; height:26px; border-radius:3px;
           background:repeating-linear-gradient(90deg, rgba(255,255,255,.03) 0 1px, transparent 1px 34px), {PANEL}; }}
  .bar {{ position:absolute; top:5px; height:16px; border-radius:3px; display:block; }}
  .bar.wait {{ background:transparent; border:1.5px dashed {AMBER}; }}
  .note {{ text-align:right; font-size:13px; color:{MUTED}; padding-right:6px; }}
</style></head>
<body><div class="card">
  <div class="top">
    <div>
      <div class="cmd">$ hermes plugins install <b>{PACKAGE}</b></div>
      <h1>kanban<span class="dash">-</span>gantt</h1>
      <div class="tag">{TAGLINE}</div>
    </div>
    <div class="specs">
      {specs}
    </div>
  </div>
  <div class="gantt">{rows}</div>
</div></body></html>
"""


def find_chrome() -> str:
    """Hermes ships a Chromium; fall back to the system's."""
    cands: list[str] = [os.environ.get("HERMES_CHROME", ""), os.environ.get("CHROME_PATH", "")]
    try:
        sys.path.insert(0, str(Path.home() / ".hermes" / "hermes-agent"))
        from hermes_cli.browser_runtime import chromium_executable  # type: ignore
        cands.append(chromium_executable(allow_override=False) or "")
    except Exception:
        pass
    cands += sorted(glob.glob(str(Path.home() / ".hermes" / "tools" / "chromium-*" / "chrome-linux64" / "chrome")))
    cands += ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]
    for c in cands:
        if c and os.access(c, os.X_OK):
            return c
    raise SystemExit("card: no Chromium found — set HERMES_CHROME to one")


def render(out: Path, scale: int) -> Path:
    chrome = find_chrome()
    html_path = out.with_suffix(".html")          # kept next to the PNG: it IS the source
    html_path.parent.mkdir(parents=True, exist_ok=True)
    html_path.write_text(html(), encoding="utf-8")

    raw = html_path.with_name(html_path.stem + f"@{scale}x.png")
    subprocess.run([chrome, "--headless=new", "--no-sandbox", "--hide-scrollbars",
                    f"--force-device-scale-factor={scale}", f"--window-size={WIDTH},{HEIGHT}",
                    f"--screenshot={raw}", f"file://{html_path}"],
                   check=True, capture_output=True, timeout=180)

    if scale > 1:                       # downscale for crisp text at 1x
        try:
            from PIL import Image
            resample = getattr(getattr(Image, "Resampling", Image), "LANCZOS", 1)
            Image.open(raw).convert("RGB").resize((WIDTH, HEIGHT), resample).save(out, "PNG", optimize=True)
            raw.unlink()
        except ImportError:
            # No PIL: rather than ship a 2x file the catalogue does not want, render
            # again at 1x. Slightly less crisp, but the dimensions stay correct.
            print("card: no PIL — re-rendering at scale 1 to keep 1280x640")
            subprocess.run([chrome, "--headless=new", "--no-sandbox", "--hide-scrollbars",
                            "--force-device-scale-factor=1", f"--window-size={WIDTH},{HEIGHT}",
                            f"--screenshot={out}", f"file://{html_path}"],
                           check=True, capture_output=True, timeout=180)
            raw.unlink(missing_ok=True)
    else:
        raw.replace(out)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Render the kanban-gantt catalogue card (2:1 PNG).")
    ap.add_argument("--out", default=str(REPO / "docs" / "catalog-card.png"))
    ap.add_argument("--scale", type=int, default=2, help="device scale factor (2 = crisp, downscaled)")
    args = ap.parse_args()

    out = Path(args.out)
    path = render(out, args.scale)
    v = version()
    print(f"card: {path.relative_to(REPO) if str(path).startswith(str(REPO)) else path}"
          f"  ({WIDTH}x{HEIGHT}, scale {args.scale}{', version ' + v if v else ''})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
