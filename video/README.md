# Promo video — kanban-gantt

A 46-second product film for the Kanban Gantt plugin, rendered with
[HyperFrames](https://hyperframes.studio) (HTML + CSS + GSAP, deterministic
frame-by-frame capture).

- 1920×1080 · 30 fps · 46 s · AAC 48 kHz · −16.6 LUFS
- Palette paper / cobalt / sun, Playfair Display 900 + Archivo + JetBrains Mono
- Every screenshot is a real capture of the running desktop app, taken at
  `deviceScaleFactor` 2 (or 4 for the filter strip), not a mockup

## Rebuild it

```bash
cd video
npx --yes hyperframes@0.9.1 preview      # live preview in the browser
npx --yes hyperframes@0.9.1 check        # lint + layout checks
./render.sh                              # final mp4 + loudness mastering
```

`render.sh` writes `kanban-gantt-promo.mp4` (H.264 + AAC, −16 LUFS,
`+faststart`) at the repo root of this folder.

## Re-capture the screenshots

The shots in `assets/shots/` come from the real app. To refresh them:

1. Start Hermes Desktop with the DevTools protocol enabled, i.e. with
   `--remote-debugging-port=9222` (app logged in, plugin installed).
2. Open the plugin page (`#/kanban-gantt`).
3. Run the capture script:

```bash
python3 capture/capture.py --port 9222 --out assets/shots/raw
```

It saves `list.png`, `timeline.png`, `graph.png` at 2× and
`filters.png` at 4×, then prints the ffmpeg crops used by the compositions.
The crop rectangles are tuned for a 1955×1067 window; adjust them if the
layout changes.

## Music

`assets/music/bed-ai.mp3` is a local AI generation, not a stock track:
two 30 s passes of `facebook/musicgen-small` (prompt: minimal editorial
electronic underscore, 118 bpm, instrumental), cross-faded over 4 s and
mastered. `assets/music/gen_musicgen.py` reproduces it (CPU-only venv with
`torch`, `transformers`, `scipy`, `soundfile`; ≈4 min per 30 s clip).

## Structure

| Time    | Scene | File |
|---------|-------|------|
| 0–5 s   | Title + Gantt axis | `compositions/s1-title.html` |
| 5–10 s  | "Every bar is real work" (cobalt) | `compositions/s2-statement.html` |
| 10–17 s | Timeline, real bars, three points | `compositions/s3-proof.html` |
| 17–23 s | List → flip → Graph | `compositions/s4-views.html` |
| 23–29 s | Drag a link between two cards | `compositions/s5-links.html` |
| 29–35 s | Attachment preview | `compositions/s6-attachments.html` |
| 35–39 s | Quick filters (Running/Blocked/Open/All) | `compositions/s7-filters.html` |
| 39–43 s | Install command | `compositions/s8-install.html` |
| 43–46 s | Outro | `compositions/s9-outro.html` |

Cuts sit on the 5 / 10 / 17 / 23 / 29 / 35 / 39 / 43 s grid, each with a
whoosh and a full-frame wipe (`#wipe` in `index.html`).

## Design rules

See `DESIGN.md`: flat paper background, no gradients or shadows, display type
in Playfair 900, monospace for data, cobalt for anything interactive, red only
for blocked work.
