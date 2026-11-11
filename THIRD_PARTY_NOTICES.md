# Third-party notices

Hermes Kanban Gantt is GPL-3.0 (see [LICENSE](LICENSE)). It includes code adapted from the
following project, used under its own licence, whose notice is reproduced below as that licence
requires.

## hermes-whiteboard

- Source: https://github.com/Adolanium/hermes-whiteboard (commit `9151ee9`)
- Licence: MIT — Copyright (c) 2026 Adolanium
- What is adapted (the **whiteboard view**):
  - `src/ui/WhiteboardView.tsx` — the stylesheet (`.wb-*` classes and values), the stamps
    (`STICKERS`, `Sticker`), the agent cursor, `smoothPath`, `edgePoint`, the road, branch and
    arrow drawing, the note / stop / frame / hub / delivered-card views, `fitView` / `zoomAt`, the
    wheel and pointer handling of the canvas, the zoom bar and the layout pills;
  - `src/core/whiteboard-core.ts` — the `layoutSpec` geometry (note, stop and hub sizes, the sine
    road, the frame grid: `frameSlots`, `frameSize`), `tiltOf`, `pathFractions`, `boundsOf`;
  - `tests/whiteboard-core.test.mjs` — specs ported from `tests/board.test.mjs`.
- The model, the kanban mapping (milestones, phases, hand-over, links) and everything else in this
  repository are original work under GPL-3.0.
- The built artifacts (`desktop/plugin.js`, `desktop/whiteboard-core.js`) carry the notice below
  at their end.

```
MIT License

Copyright (c) 2026 Adolanium

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
