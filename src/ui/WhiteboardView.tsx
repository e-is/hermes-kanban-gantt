import { Codicon, icons, Streamdown } from '@hermes/plugin-sdk'
import { useEffect, useMemo, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

import {
  applyPositions, arrowsOf, boardFromTasks, boardMarkdown, boardTable, boundsOf, layoutBoard, overlaps,
  handable, pathFractions, planNext, positionsFor, toDelimited, withoutLayout, withPosition
} from '../core/whiteboard-core'

/**
 * The fourth view: the board as a spatial plan.
 *
 * The LOOK is Adolanium/hermes-whiteboard's (MIT), ported as-is: its stylesheet, its stamps,
 * its taped notes, its road, its hub, its zoom bar — same classes, same values. Only the
 * data differs: every note IS a kanban card, a stop or a frame IS a milestone card, and the
 * view writes nothing back except where the reader put things.
 *
 * Copyright (c) Adolanium — the CSS block, `STICKERS`, `Sticker`, `smoothPath` and the road
 * drawing below are taken from hermes-whiteboard `desktop/plugin.js` (MIT licence).
 */

/* ─────────────────────────────── look (ported) ───────────────────────────── */

const STYLE_ID = 'kanban-gantt-whiteboard-styles'
const HERMES_HUE = 41
const INK = 'hsl(232 26% 17%)'
const GOLD = `hsl(${HERMES_HUE} 92% 56%)`
const LINE_INK = 'var(--wb-line)'
const DISPLAY = "'Collapse', var(--font-sans, system-ui), serif"

const TONES: Record<string, { paper: string; edge: string }> = {
  butter: { paper: 'hsl(47 96% 84%)', edge: 'hsl(43 80% 66%)' },
  peach: { paper: 'hsl(22 96% 87%)', edge: 'hsl(18 78% 72%)' },
  mint: { paper: 'hsl(150 52% 84%)', edge: 'hsl(152 38% 66%)' },
  sky: { paper: 'hsl(205 86% 88%)', edge: 'hsl(208 62% 72%)' },
  lilac: { paper: 'hsl(266 72% 90%)', edge: 'hsl(266 46% 76%)' },
  paper: { paper: 'hsl(40 40% 98%)', edge: 'hsl(36 18% 80%)' }
}

const CSS = `
.wb-page { --wb-line: hsl(232 26% 17%); position: relative; display: flex; flex: 1; height: 100%; min-height: 0; flex-direction: column; overflow: hidden; color: var(--ui-text-primary); }
.wb-btn { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 8px; border: 1px solid transparent; background: transparent; color: var(--ui-text-secondary); font: 500 12px var(--font-sans, system-ui); cursor: pointer; white-space: nowrap; transition: background .15s, color .15s, border-color .15s; }
.wb-btn:hover { background: color-mix(in srgb, var(--ui-text-primary) 6%, transparent); color: var(--ui-text-primary); }
.wb-btn svg { width: 15px; height: 15px; flex-shrink: 0; }
.wb-btn.wb-icon { width: 28px; padding: 0; justify-content: center; }
.wb-canvas { position: relative; flex: 1; min-height: 0; overflow: hidden; cursor: default; touch-action: none; user-select: none;
  background-color: hsl(40 44% 95.5%);
  background-image: radial-gradient(color-mix(in oklab, var(--ui-text-primary) 17%, transparent) 1px, transparent 1.3px); }
:root.dark .wb-page { --wb-line: hsl(40 32% 86%); }
:root.dark .wb-canvas { background-color: hsl(228 13% 12%); background-image: radial-gradient(hsl(40 30% 90% / .16) 1px, transparent 1.3px); }
:root.dark .wb-hub { background: hsl(40 45% 96%); color: ${INK}; }
:root.dark .wb-frame { background: hsl(228 14% 16% / .7); }
.wb-canvas.wb-panning { cursor: grabbing; }
.wb-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.wb-world.wb-glide { transition: transform .6s cubic-bezier(.2, .8, .2, 1); }
.wb-item { position: absolute; transition: left .55s cubic-bezier(.2, .8, .2, 1), top .55s cubic-bezier(.2, .8, .2, 1), width .4s, height .4s; }
.wb-item.wb-dragging { transition: none; z-index: 40; }
.wb-note { position: absolute; inset: 0; padding: 18px 14px 12px; border-radius: 3px 3px 12px 3px; color: ${INK}; font: calc(14px * var(--wb-k, 1))/1.34 var(--font-sans, system-ui); box-shadow: 0 1px 0 hsl(30 20% 40% / .18), 0 10px 22px -14px hsl(30 30% 20% / .5); display: flex; flex-direction: column; gap: 6px; cursor: grab; }
.wb-note:hover { box-shadow: 0 1px 0 hsl(30 20% 40% / .2), 0 16px 30px -16px hsl(30 30% 20% / .55); }
.wb-note-text { flex: 0 1 auto; min-height: 0; overflow: hidden; word-break: break-word; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; }
.wb-note .wb-meta { margin-top: auto; }
.wb-far .wb-note .wb-meta { display: none; }
.wb-tape { position: absolute; top: -9px; left: 50%; width: 62px; height: 18px; margin-left: -31px; background: hsl(${HERMES_HUE} 40% 92% / .72); box-shadow: 0 1px 2px hsl(30 20% 30% / .12); clip-path: polygon(3% 8%, 97% 0, 100% 92%, 0 100%); }
.wb-selected > div > .wb-note, .wb-selected > div > .wb-frame, .wb-selected > div > .wb-card { outline: 2px solid hsl(${HERMES_HUE} 85% 52%); outline-offset: 3px; }
.wb-meta { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.wb-chip { display: inline-flex; align-items: center; gap: 3px; height: 18px; padding: 0 6px; border-radius: 99px; font: 500 10.5px var(--font-sans, system-ui); background: hsl(30 30% 20% / .09); color: hsl(232 20% 28%); }
.wb-chip.wb-act { background: hsl(${HERMES_HUE} 90% 55% / .3); color: hsl(30 60% 22%); }
.wb-work { position: absolute; left: 10px; right: 10px; bottom: 9px; display: flex; align-items: center; gap: 6px; font: 500 11px var(--font-sans, system-ui); color: hsl(232 20% 30%); }
.wb-work-dot { width: 7px; height: 7px; border-radius: 99px; flex-shrink: 0; animation: wb-breathe 1.2s ease-in-out infinite; }
@keyframes wb-breathe { 50% { transform: scale(1.6); opacity: .5; } }
.wb-work span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.wb-frame { position: absolute; inset: 0; border-radius: 18px; border: 1.5px dashed color-mix(in oklab, var(--ui-text-primary) 28%, transparent); background: color-mix(in oklab, var(--ui-surface-background) 55%, transparent); cursor: grab; }
.wb-frame-head { position: absolute; left: 14px; right: 14px; top: 10px; display: flex; align-items: center; gap: 8px; height: 40px; }
.wb-frame-stamp { margin: -22px 0 0 -26px; flex-shrink: 0; }
.wb-frame-head b { font: 400 calc(21px * min(var(--wb-k, 1), 1.4))/1.1 ${DISPLAY}; letter-spacing: .01em; color: var(--ui-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-card { position: absolute; inset: 0; border-radius: 16px; padding: 14px 14px 12px 84px; transition: box-shadow .5s; background: hsl(40 45% 98%); color: ${INK}; box-shadow: 0 1px 0 hsl(30 20% 40% / .2), 0 14px 30px -18px hsl(30 30% 20% / .55); display: flex; gap: 10px; cursor: grab; }
.wb-card-body { min-width: 0; display: flex; flex-direction: column; gap: 6px; justify-content: center; }
.wb-card-body b { font: 400 calc(21px * min(var(--wb-k, 1), 1.3))/1.1 ${DISPLAY}; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.wb-card-stamp { position: absolute; left: -26px; top: -30px; }
.wb-card-done { box-shadow: 0 0 0 2.5px hsl(${HERMES_HUE} 92% 56%), 0 14px 30px -18px hsl(30 30% 20% / .55); }
.wb-travelled { transition: stroke-dasharray 1.4s cubic-bezier(.4, 0, .2, 1), stroke-opacity .4s; }
.wb-label { align-self: flex-start; height: 20px; padding: 0 8px; border-radius: 99px; font: 600 10.5px/20px var(--font-sans, system-ui); background: ${INK}; color: hsl(40 60% 96%); }
.wb-hub { position: absolute; inset: 0; border-radius: 26px; padding: 18px 22px; background: ${INK}; color: hsl(40 60% 96%); display: flex; align-items: center; gap: 14px; box-shadow: 0 18px 40px -20px hsl(232 40% 10% / .7); cursor: grab; }
.wb-hub b { font: 400 30px/1.05 ${DISPLAY}; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.wb-free { position: absolute; inset: 0; cursor: grab; }
.wb-titletext { font: 400 calc(58px * min(var(--wb-k, 1), 1.35))/1.02 ${DISPLAY}; color: var(--ui-text-primary); white-space: nowrap; }
.wb-sticker { display: block; overflow: visible; filter: drop-shadow(0 4px 6px hsl(30 30% 20% / .22)); }
.wb-stamp { fill: hsl(42 55% 97%); stroke: hsl(30 25% 30% / .22); stroke-width: 1; }
.wb-stamp-ring { fill: none; stroke: hsl(30 25% 30% / .28); stroke-width: 1; stroke-dasharray: 1.5 3; }
.wb-links { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; }
.wb-zoom { position: absolute; z-index: 5; right: 14px; bottom: 16px; display: flex; align-items: center; gap: 2px; padding: 4px; border-radius: 12px; background: var(--ui-surface-background); border: 1px solid var(--ui-stroke-secondary); }
.wb-zoom span { min-width: 42px; text-align: center; font: 500 11px var(--font-sans, system-ui); color: var(--ui-text-secondary); }
.wb-compose { position: absolute; z-index: 7; left: 50%; bottom: 18px; width: min(640px, calc(100% - 300px)); transform: translateX(-50%); border-radius: 18px; background: var(--ui-surface-background); border: 1px solid var(--ui-stroke-secondary); box-shadow: 0 22px 44px -26px hsl(230 30% 10% / .55); padding: 10px 10px 8px 14px; }
.wb-layouts { display: flex; align-items: center; gap: 4px; margin-top: 6px; overflow: hidden; }
.wb-compose .wb-layouts { margin-top: 0; }
.wb-layouts > * { white-space: nowrap; flex-shrink: 0; }
.wb-layouts button { height: 22px; padding: 0 9px; border-radius: 99px; border: 1px solid var(--ui-stroke-secondary); background: transparent; color: var(--ui-text-tertiary); font: 500 11px var(--font-sans, system-ui); cursor: pointer; }
.wb-layouts button.wb-on { background: var(--ui-text-primary); border-color: var(--ui-text-primary); color: var(--ui-surface-background); }
.wb-layouts .wb-hint { margin-left: auto; font: 11px var(--font-sans, system-ui); color: var(--ui-text-quaternary); }
.wb-empty { position: absolute; z-index: 4; left: 50%; top: 42%; transform: translate(-50%, -50%); width: min(560px, calc(100% - 48px)); text-align: center; pointer-events: none; }
.wb-empty p { margin: 0 auto 18px; max-width: 440px; font: 14px/1.5 var(--font-sans, system-ui); color: var(--ui-text-secondary); }
.wb-hand { position: absolute; right: 8px; bottom: 8px; display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px; border-radius: 99px; border: 1px solid hsl(30 40% 25% / .25); background: hsl(40 60% 99% / .9); color: ${INK}; font: 600 11px var(--font-sans, system-ui); cursor: pointer; opacity: 0; transform: translateY(3px); transition: opacity .15s, transform .15s; z-index: 2; }
.wb-item:hover .wb-hand, .wb-selected .wb-hand, .wb-hand.wb-show { opacity: 1; transform: none; }
.wb-hand:hover { background: hsl(${HERMES_HUE} 95% 62%); border-color: hsl(${HERMES_HUE} 70% 40% / .5); }
.wb-hand svg { width: 13px; height: 13px; }
.wb-far .wb-hand { display: none; }
.wb-selected > div > .wb-result { outline: 2px solid hsl(${HERMES_HUE} 85% 52%); outline-offset: 3px; }
.wb-lit > div > .wb-note, .wb-lit > div > .wb-card, .wb-lit > div > .wb-frame { outline: 2px dashed hsl(${HERMES_HUE} 85% 50%); outline-offset: 4px; }
.wb-result { position: absolute; inset: 0; border-radius: 14px; padding: 14px 16px 12px; background: hsl(40 50% 99%); color: ${INK}; border: 1px solid hsl(${HERMES_HUE} 60% 50% / .35); box-shadow: 0 16px 34px -20px hsl(30 40% 20% / .6); display: flex; flex-direction: column; gap: 6px; cursor: grab; overflow: hidden; }
.wb-result-head { display: flex; align-items: flex-start; gap: 8px; }
.wb-result-head b { flex: 1; font: 400 calc(18px * min(var(--wb-k, 1), 1.35))/1.15 ${DISPLAY}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-postmark { flex-shrink: 0; transform: rotate(-8deg); animation: wb-stamp .55s cubic-bezier(.2, 1.5, .4, 1) .3s both; white-space: nowrap; text-transform: uppercase; padding: 2px 7px; border: 1.5px solid hsl(${HERMES_HUE} 70% 38%); border-radius: 6px; color: hsl(${HERMES_HUE} 70% 32%); font: 700 9.5px var(--font-sans, system-ui); letter-spacing: .08em; }
.wb-result-body { flex: 1; min-height: 0; overflow: auto; font: 12.5px/1.45 var(--font-sans, system-ui); cursor: text; user-select: text; }
.wb-result-body, .wb-result-body * { color: ${INK} !important; background-color: transparent !important; }
.wb-result-body p { margin: 0 0 6px; }
.wb-result-body ul, .wb-result-body ol { margin: 0 0 6px; padding-left: 18px; }
.wb-result-body h1, .wb-result-body h2, .wb-result-body h3 { font-size: 13px; margin: 4px 0; }
@keyframes wb-stamp { from { opacity: 0; transform: rotate(-22deg) scale(2.6); } to { opacity: 1; transform: rotate(-8deg) scale(1); } }
.wb-brief { border: 2px solid hsl(${HERMES_HUE} 85% 52%); }
.wb-port { position: absolute; right: -11px; top: 50%; width: 16px; height: 16px; margin-top: -8px; border-radius: 99px; background: hsl(${HERMES_HUE} 92% 56%); border: 2px solid hsl(40 60% 99%); box-shadow: 0 2px 6px hsl(30 30% 20% / .35); cursor: crosshair; z-index: 3; transform: scale(var(--wb-inv, 1)); opacity: 0; transition: opacity .15s; }
.wb-item:hover > .wb-port, .wb-selected > .wb-port { opacity: 1; }
.wb-cursor { position: absolute; left: 0; top: 0; z-index: 30; pointer-events: none; transition: transform .55s cubic-bezier(.2, .8, .2, 1), opacity .3s; }
.wb-cursor-label { position: absolute; left: 20px; top: 20px; height: 22px; padding: 0 9px; border-radius: 7px 99px 99px 99px; font: 600 11.5px/22px var(--font-sans, system-ui); color: ${INK}; white-space: nowrap; box-shadow: 0 6px 14px -8px hsl(30 40% 20% / .6); }
.wb-marquee { position: absolute; z-index: 25; border: 1px solid hsl(${HERMES_HUE} 85% 50%); background: hsl(${HERMES_HUE} 90% 60% / .1); border-radius: 4px; pointer-events: none; }
.wb-badge { min-width: 16px; height: 16px; padding: 0 5px; border-radius: 99px; font: 600 10px/16px var(--font-sans, system-ui); background: hsl(${HERMES_HUE} 90% 55%); color: ${INK}; text-align: center; }
.wb-btn:disabled { opacity: .45; cursor: default; }
.wb-btn.wb-go { background: hsl(${HERMES_HUE} 92% 56%); color: ${INK}; font-weight: 600; }
.wb-btn.wb-go:hover { background: hsl(${HERMES_HUE} 95% 62%); color: ${INK}; }
.wb-btn.wb-go .wb-badge { background: ${INK}; color: hsl(${HERMES_HUE} 92% 62%); }
.wb-compose-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.wb-compose-row .wb-next { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 13px var(--font-sans, system-ui); color: var(--ui-text-secondary); }
.wb-arrow-hit { pointer-events: stroke; cursor: pointer; }
.wb-unlink { position: absolute; z-index: 26; transform: translate(-50%, -50%); }
.wb-unlink .wb-btn { background: var(--ui-surface-background); border-color: var(--ui-stroke-secondary); box-shadow: 0 10px 22px -14px hsl(230 30% 10% / .6); }
@media (prefers-reduced-motion: reduce) { .wb-item, .wb-cursor, .wb-world.wb-glide { transition: none; } .wb-work-dot, .wb-postmark { animation: none; } }
`

function installStyles() {
  if (typeof document === 'undefined' || typeof document.head?.append !== 'function') return
  if (document.getElementById(STYLE_ID)) return
  const node = document.createElement('style')
  node.id = STYLE_ID
  node.textContent = CSS
  document.head.append(node)
}

/** Whiteboard's round stamps, the ones a plan uses (64-unit box: `fill` takes the colour,
 *  `ink` is the line work). */
const STICKERS: Record<string, { hue: number; fill: string[]; ink: string[] }> = {
  flag: { hue: 152, fill: ['M22 15c8-4 14 4 22 0v18c-8 4-14-4-22 0Z'], ink: ['M22 52V13', 'M22 15c8-4 14 4 22 0v18c-8 4-14-4-22 0'] },
  target: { hue: 350, fill: ['M32 14a18 18 0 1 0 0.1 0Z'], ink: ['M32 14a18 18 0 1 0 0.1 0', 'M32 22a10 10 0 1 0 0.1 0', 'M32 29a3 3 0 1 0 0.1 0', 'M32 32L50 14M44 14h6v6'] },
  rocket: { hue: 8, fill: ['M32 12c8 6 11 15 9 26H23c-2-11 1-20 9-26Z'], ink: ['M32 12c8 6 11 15 9 26H23c-2-11 1-20 9-26Z', 'M23 38l-6 7 8-1M41 38l6 7-8-1', 'M28 41c1 5 2 8 4 11 2-3 3-6 4-11', 'M32 22a3.5 3.5 0 1 0 0.1 0'] },
  calendar: { hue: 205, fill: ['M15 22h34v26a4 4 0 0 1-4 4H19a4 4 0 0 1-4-4Z'], ink: ['M19 17h26a4 4 0 0 1 4 4v27a4 4 0 0 1-4 4H19a4 4 0 0 1-4-4V21a4 4 0 0 1 4-4Z', 'M15 27h34', 'M24 13v8M40 13v8', 'M23 35h3M31 35h3M39 35h3M23 43h3M31 43h3'] },
  trophy: { hue: 42, fill: ['M22 14h20v10a10 10 0 0 1-20 0Z'], ink: ['M22 14h20v10a10 10 0 0 1-20 0Z', 'M22 18h-6c0 6 3 9 7 10M42 18h6c0 6-3 9-7 10', 'M32 34v8M24 50h16M26 42h12v8H26Z'] },
  star: { hue: 46, fill: ['M32 12l6 13 14 2-10 10 2 14-12-7-12 7 2-14-10-10 14-2Z'], ink: ['M32 12l6 13 14 2-10 10 2 14-12-7-12 7 2-14-10-10 14-2Z'] },
  chart: { hue: 152, fill: ['M16 38h7v12h-7Z', 'M28 30h7v20h-7Z', 'M40 22h7v28h-7Z'], ink: ['M16 38h7v12h-7ZM28 30h7v20h-7ZM40 22h7v28h-7Z', 'M14 27l12-9 8 5 14-11', 'M42 12h6v6'] },
  gear: { hue: 220, fill: ['M32 16l4 1 2-3 5 3-1 4 3 3 4-1 3 5-3 2 1 4-1 4 3 2-3 5-4-1-3 3 1 4-5 3-2-3-4 1-4-1-2 3-5-3 1-4-3-3-4 1-3-5 3-2-1-4 1-4-3-2 3-5 4 1 3-3-1-4 5-3 2 3Z'], ink: ['M32 16l4 1 2-3 5 3-1 4 3 3 4-1 3 5-3 2 1 4-1 4 3 2-3 5-4-1-3 3 1 4-5 3-2-3-4 1-4-1-2 3-5-3 1-4-3-3-4 1-3-5 3-2-1-4 1-4-3-2 3-5 4 1 3-3-1-4 5-3 2 3Z', 'M32 25a7 7 0 1 0 0.1 0'] },
  pin: { hue: 8, fill: ['M32 51C22 39 18 32 18 26a14 14 0 0 1 28 0c0 6-4 13-14 25Z'], ink: ['M32 51C22 39 18 32 18 26a14 14 0 0 1 28 0c0 6-4 13-14 25Z', 'M32 21a5 5 0 1 0 0.1 0'] },
  sandal: { hue: 41, fill: ['M15 42c0-12 9-22 22-25 7-2 12 0 14 2-6 1-10 3-13 6 6-1 11 0 13 2-6 1-10 3-12 6 5 0 9 1 11 3-7 2-12 5-17 8-6 4-12 4-18-2Z'], ink: ['M15 42c0-12 9-22 22-25 7-2 12 0 14 2-6 1-10 3-13 6 6-1 11 0 13 2-6 1-10 3-12 6 5 0 9 1 11 3-7 2-12 5-17 8-6 4-12 4-18-2Z', 'M21 38c4-7 10-12 17-15M25 41c4-5 9-8 14-10M29 44c3-3 7-5 11-6'] },
  spark: { hue: 266, fill: ['M32 12c2 11 6 16 17 18-11 2-15 7-17 18-2-11-6-16-17-18 11-2 15-7 17-18Z'], ink: ['M32 12c2 11 6 16 17 18-11 2-15 7-17 18-2-11-6-16-17-18 11-2 15-7 17-18Z', 'M48 44c1 3 2 4 5 5-3 1-4 2-5 5-1-3-2-4-5-5 3-1 4-2 5-5Z'] }
}

function Sticker({ name, size = 56, tilt = 0 }: { name?: string; size?: number; tilt?: number }) {
  const sticker = STICKERS[name || 'spark'] || STICKERS.spark
  const fill = `hsl(${sticker.hue} 82% 66%)`
  return jsxs('svg', {
    className: 'wb-sticker',
    role: 'img',
    'aria-hidden': true,
    style: { height: size, width: size, transform: tilt ? `rotate(${tilt}deg)` : undefined },
    viewBox: '0 0 64 64',
    children: [
      jsx('circle', { className: 'wb-stamp', cx: 32, cy: 32, r: 30.5 }, 's'),
      jsx('circle', { className: 'wb-stamp-ring', cx: 32, cy: 32, r: 27 }, 'r'),
      jsx('g', { transform: 'translate(1.6 1.8)', children: sticker.fill.map((d, i) => jsx('path', { d, fill, stroke: 'none' }, `f${i}`)) }, 'f'),
      jsx('g', {
        fill: 'none', stroke: INK, strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2.4,
        children: sticker.ink.map((d, i) => jsx('path', { d }, `i${i}`))
      }, 'i')
    ]
  })
}

/** A smooth curve through points (Catmull-Rom as cubic Béziers). */
function smoothPath(points: { x: number; y: number }[]) {
  if (points.length < 2) return ''
  let d = `M${points[0].x} ${points[0].y}`
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] || p2
    d += ` C${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6} ${p2.x - (p3.x - p1.x) / 6} ${p2.y - (p3.y - p1.y) / 6} ${p2.x} ${p2.y}`
  }
  return d
}

const anchorOf = (stop: any) =>
  stop.side === 'below' ? { x: stop.x + stop.w / 2, y: stop.y - 56 } : { x: stop.x + stop.w / 2, y: stop.y + stop.h + 56 }

const centerOf = (item: any) => ({ x: item.x + item.w / 2, y: item.y + item.h / 2 })
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** Small line icons whiteboard draws itself (same weight as the app's). */
const LINE: Record<string, string> = {
  hand: 'M5 12h11M12 6l6 6-6 6',
  play: 'M8 5l11 7-11 7Z',
  wand: 'M5 19L15 9M14 4v3M19 9h-3M17.5 5.5l-2 2M11 4.5l.8 1.6M19.5 13l-1.6-.8',
  check: 'M5 12l5 5L20 7',
  unlink: 'M5 19L19 5M10 5h9v9M5 5l4 4M15 15l4 4'
}

function Line({ name }: { name: string }) {
  return jsx('svg', {
    'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.8,
    viewBox: '0 0 24 24', children: jsx('path', { d: LINE[name] })
  })
}

/** Cursors for the agents at work: Hermes is gold, each other profile takes the next hue. */
const AGENT_HUES = [262, 172, 12, 205, 330]
function hueOf(name: string) {
  if (!name || name === 'default' || name === 'hermes') return HERMES_HUE
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return AGENT_HUES[Math.abs(hash) % AGENT_HUES.length]
}

function Cursor({ x, y, label, hue }: { x: number; y: number; label: string; hue: number }) {
  const gold = hue === HERMES_HUE
  const fill = `hsl(${hue} 88% ${gold ? 56 : 62}%)`
  return jsxs('div', {
    className: 'wb-cursor',
    'data-wb-cursor': label,
    style: { transform: `translate(${Math.round(x)}px, ${Math.round(y)}px)` },
    children: [
      jsxs('svg', {
        'aria-hidden': true, height: 30, width: 30, viewBox: '0 0 30 30', style: { overflow: 'visible' },
        children: [
          // The wing: Hermes travels.
          jsx('path', { d: 'M10 4c-4-3-9-3-10-1 3 0 5 1 7 3-3-1-6 0-7 2 3-1 6 0 8 1', fill: 'none', stroke: fill, strokeLinecap: 'round', strokeWidth: 2, transform: 'translate(-2 8)' }, 'w'),
          jsx('path', { d: 'M3 2l17 8-7.5 2.2L9 20Z', fill, stroke: INK, strokeLinejoin: 'round', strokeWidth: 1.6 }, 'a')
        ]
      }, 'svg'),
      jsx('div', { className: 'wb-cursor-label', style: { background: fill }, children: label }, 'l')
    ]
  })
}

function edgePoint(rect: any, toward: { x: number; y: number }) {
  const c = centerOf(rect)
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (!dx && !dy) return c
  const scale = Math.min(dx ? (rect.w / 2 + 6) / Math.abs(dx) : Infinity, dy ? (rect.h / 2 + 6) / Math.abs(dy) : Infinity)
  return { x: c.x + dx * scale, y: c.y + dy * scale }
}

function Links({ items, links, arrows, at, wire, picked, onPick }: any) {
  const byId = new Map<string, any>(items.map((item: any) => [item.id, item]))
  const route = items.filter((item: any) => item.kind === 'waypoint').map(at)
  const anchors = route.map(anchorOf)
  const lead = anchors.length > 1
    ? [{ x: anchors[0].x - 140, y: anchors[0].y + 24 }, ...anchors, { x: anchors[anchors.length - 1].x + 140, y: anchors[anchors.length - 1].y - 24 }]
    : anchors
  const road = smoothPath(lead)
  const children: any[] = []
  // The road turns gold up to the last stop passed, in order — a milestone card done.
  const travelled = route.findIndex((stop: any) => !stop.done)
  const doneCount = travelled < 0 ? route.length : travelled
  const fraction = doneCount === 0 || lead.length < 2 ? 0 : doneCount === route.length ? 1 : pathFractions(lead)[doneCount]

  if (road) {
    children.push(
      jsx('path', { d: road, fill: 'none', stroke: `hsl(${HERMES_HUE} 85% 58% / .3)`, strokeLinecap: 'round', strokeWidth: 30 }, 'road'),
      jsx('path', { className: 'wb-travelled', d: road, fill: 'none', pathLength: 1, stroke: GOLD, strokeDasharray: `${fraction} 1`, strokeLinecap: 'round', strokeOpacity: fraction > 0 ? 1 : 0, strokeWidth: 30 }, 'gold'),
      jsx('path', { d: road, fill: 'none', stroke: LINE_INK, strokeDasharray: '2 11', strokeLinecap: 'round', strokeWidth: 2.4 }, 'lane')
    )
  }

  route.forEach((stop: any, index: number) => {
    const anchor = anchors[index]
    const edge = stop.side === 'below' ? stop.y : stop.y + stop.h
    children.push(
      jsx('path', { d: `M${anchor.x} ${anchor.y} L${anchor.x} ${edge}`, stroke: LINE_INK, strokeDasharray: '1 5', strokeLinecap: 'round', strokeWidth: 2 }, `stem${stop.id}`),
      jsx('circle', { cx: anchor.x, cy: anchor.y, fill: stop.done ? GOLD : 'hsl(42 55% 97%)', r: 15, stroke: INK, strokeWidth: 2.2 }, `dot${stop.id}`),
      stop.done
        ? jsx('path', { d: `M${anchor.x - 6} ${anchor.y + 0.5} l4.5 4.5 l7.5 -9`, fill: 'none', stroke: INK, strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2.6 }, `ok${stop.id}`)
        : jsx('text', { fill: INK, fontFamily: 'var(--font-sans, system-ui)', fontSize: 12, fontWeight: 700, textAnchor: 'middle', x: anchor.x, y: anchor.y + 4, children: String(index + 1) }, `num${stop.id}`)
    )
  })

  for (const link of links) {
    if (link.kind !== 'branch') continue
    const from = byId.get(link.from)
    const to = byId.get(link.to)
    if (!from || !to) continue
    const p = centerOf(at(from))
    const q = centerOf(at(to))
    const mx = (p.x + q.x) / 2
    const my = (p.y + q.y) / 2 - 40
    children.push(jsx('path', { d: `M${p.x} ${p.y} Q${mx} ${my} ${q.x} ${q.y}`, fill: 'none', stroke: LINE_INK, strokeLinecap: 'round', strokeOpacity: 0.34, strokeWidth: 2.4 }, link.id))
  }

  // Dependencies: whiteboard's arrow, drawn between two cards; a click picks it (to unlink).
  for (const arrow of arrows) {
    const a = byId.get(arrow.from)
    const b = byId.get(arrow.to)
    if (!a || !b) continue
    const A = at(a)
    const B = at(b)
    const p = edgePoint(A, centerOf(B))
    const q = edgePoint(B, centerOf(A))
    const angle = Math.atan2(q.y - p.y, q.x - p.x)
    const wing = (turn: number) => `${q.x - 14 * Math.cos(angle + turn)},${q.y - 14 * Math.sin(angle + turn)}`
    const on = picked === arrow.id
    const ink = on ? GOLD : LINE_INK
    const d = `M${p.x} ${p.y} L${q.x - 6 * Math.cos(angle)} ${q.y - 6 * Math.sin(angle)}`
    children.push(
      jsx('path', { d, fill: 'none', stroke: ink, strokeLinecap: 'round', strokeWidth: on ? 3.2 : 2.4, 'data-wb-arrow': arrow.id }, arrow.id),
      jsx('polygon', { fill: ink, points: `${q.x},${q.y} ${wing(0.42)} ${wing(-0.42)}` }, `${arrow.id}head`),
      jsx('path', { className: 'wb-arrow-hit', d, fill: 'none', stroke: 'transparent', strokeWidth: 16, 'data-arrow': arrow.id, onPointerDown: (event: any) => { event.stopPropagation(); onPick?.(arrow.id) } }, `${arrow.id}hit`)
    )
  }

  const source = wire ? byId.get(wire.from) : null
  if (source) {
    const p = edgePoint(at(source), wire)
    children.push(
      jsx('path', { d: `M${p.x} ${p.y} L${wire.x} ${wire.y}`, fill: 'none', stroke: GOLD, strokeDasharray: '6 6', strokeLinecap: 'round', strokeWidth: 2.6 }, 'wire'),
      jsx('circle', { cx: wire.x, cy: wire.y, fill: GOLD, r: 5 }, 'wireend')
    )
  }

  return jsx('svg', { className: 'wb-links', children })
}

/* ─────────────────────────────── item views ──────────────────────────────── */

const stop = (event: any) => event.stopPropagation()

function NoteView({ item, i18n, k, far, onHand, canHand }: any) {
  const tone = TONES[item.tone] || TONES.butter
  const running = item.stage === 'running'
  const owner = item.owner && item.owner !== 'jalon' ? item.owner : null
  const meta = !running && !far
  const handable = canHand && !far && onHand
  const lines = Math.max(1, Math.floor((item.h - 30 - (running || meta ? 26 : 0)) / (14 * k * 1.34)))
  return jsxs('div', {
    className: 'wb-note',
    style: { background: tone.paper, transform: `rotate(${item.tilt || 0}deg)` },
    children: [
      jsx('div', { className: 'wb-tape' }, 'tape'),
      jsx('div', { className: 'wb-note-text', style: { WebkitLineClamp: lines }, children: item.text }, 'text'),
      meta
        ? jsxs('div', {
            className: 'wb-meta',
            children: [
              jsx('span', { className: `wb-chip${item.stage === 'review' || item.stage === 'blocked' ? ' wb-act' : ''}`, children: i18n.wbStages?.[item.stage] || item.stage }, 's'),
              owner ? jsx('span', { className: 'wb-chip', children: owner }, 'o') : null
            ]
          }, 'meta')
        : null,
      running
        ? jsxs('div', {
            className: 'wb-work',
            children: [
              jsx('div', { className: 'wb-work-dot', style: { background: `hsl(${hueOf(owner || '')} 80% 50%)` } }, 'd'),
              jsx('span', { children: item.summary || (owner ? `${i18n.wbStages?.running} · ${owner}` : i18n.wbStages?.running) }, 't')
            ]
          }, 'work')
        : null,
      handable
        ? jsxs('button', {
            className: 'wb-hand',
            type: 'button',
            'data-nodrag': true,
            title: i18n.wbHandHint,
            onPointerDown: stop,
            onClick: (event: any) => { event.stopPropagation(); onHand([item.taskId]) },
            children: [jsx(Line, { name: 'hand' }, 'i'), i18n.wbHand]
          }, 'hand')
        : null
    ]
  })
}

/** A milestone whose phase is done waits for a human: the stop (or frame) offers to pass it. */
function PassButton({ item, i18n, onPass }: any) {
  return jsxs('button', {
    className: 'wb-hand wb-show',
    type: 'button',
    'data-nodrag': true,
    title: i18n.wbPassHint,
    onPointerDown: stop,
    onClick: (event: any) => { event.stopPropagation(); onPass(item.taskId) },
    children: [jsx(Line, { name: 'check' }, 'i'), i18n.wbPass]
  })
}

function WaypointView({ item, i18n, passable, onPass }: any) {
  const label = item.role === 'milestone' ? i18n.wbStep(item.step) : i18n.wbLoose
  return jsxs('div', {
    className: `wb-card${item.done ? ' wb-card-done' : ''}`,
    style: { transform: `rotate(${item.tilt || 0}deg)` },
    children: [
      jsx('div', { className: 'wb-card-stamp', children: jsx(Sticker, { name: item.sticker, size: 96, tilt: -(item.tilt || 0) * 3 }) }, 'stamp'),
      jsxs('div', {
        className: 'wb-card-body',
        children: [
          jsx('span', { className: 'wb-label', children: label }, 'l'),
          jsx('b', { children: item.role === 'milestone' ? item.title : i18n.wbLoose }, 't')
        ]
      }, 'body'),
      passable ? jsx(PassButton, { item, i18n, onPass }, 'pass') : null
    ]
  })
}

function FrameView({ item, i18n, passable, onPass }: any) {
  return jsxs('div', {
    className: 'wb-frame',
    children: [
      jsxs('div', {
        className: 'wb-frame-head',
        children: [
          item.sticker ? jsx('div', { className: 'wb-frame-stamp', children: jsx(Sticker, { name: item.sticker, size: 54, tilt: -6 }) }, 's') : null,
          jsx('b', { children: item.role === 'milestone' ? item.title : i18n.wbLoose }, 't')
        ]
      }, 'head'),
      passable ? jsx(PassButton, { item, i18n, onPass }, 'pass') : null
    ]
  })
}

function HubView({ item }: any) {
  return jsxs('div', {
    className: 'wb-hub',
    children: [jsx(Sticker, { name: item.sticker || 'spark', size: 84, tilt: -8 }, 's'), jsx('b', { children: item.title }, 't')]
  })
}

function TitleView({ item }: any) {
  return jsx('div', { className: 'wb-free', children: jsx('div', { className: 'wb-titletext', children: item.text }) })
}

/** Whiteboard's delivered card: the card's result (or a milestone's brief), postmarked. */
function ResultView({ item, i18n }: any) {
  const Markdown = typeof Streamdown === 'function' || (Streamdown && typeof Streamdown === 'object') ? Streamdown : null
  return jsxs('div', {
    className: `wb-result${item.brief ? ' wb-brief' : ''}`,
    children: [
      jsxs('div', {
        className: 'wb-result-head',
        children: [
          item.brief ? jsx(Sticker, { name: 'sandal', size: 34, tilt: -8 }, 's') : null,
          jsx('b', { children: item.title }, 't'),
          jsx('span', { className: 'wb-postmark', children: item.brief ? i18n.wbBrief : i18n.wbDelivered }, 'p')
        ]
      }, 'head'),
      jsx('div', {
        className: 'wb-result-body',
        'data-nodrag': true,
        onPointerDown: stop,
        onWheel: stop,
        children: Markdown ? jsx(Markdown as any, { controls: false, children: item.text || '' }) : item.text
      }, 'body')
    ]
  })
}

/* ──────────────────────────────── the view ───────────────────────────────── */

const LAYOUTS = ['route', 'columns', 'map'] as const
const MOVABLE = new Set(['note', 'waypoint', 'frame', 'hub', 'text', 'result'])
const LINKABLE = new Set(['note', 'waypoint', 'frame'])
const MAX_UNDO = 60

export function WhiteboardView({
  tasks = [],
  i18n,
  title,
  board,
  selectedId,
  layout = 'route',
  onLayout,
  positions = {},
  onPositions,
  onOpen,
  onCreate,
  onLink,
  onUnlink,
  onHand,
  onPass,
  onCopy
}: {
  tasks?: any[]
  i18n: any
  title?: string
  board?: string
  selectedId?: string | null
  layout?: 'route' | 'columns' | 'map'
  onLayout?: (layout: 'route' | 'columns' | 'map') => void
  positions?: Record<string, { x: number; y: number }>
  onPositions?: (next: Record<string, { x: number; y: number }>) => void
  onOpen?: (id: string) => void
  /** a new card, under that milestone (or none) — the page's own creation dialog */
  onCreate?: (parentId: string | null) => void
  /** parent -> child: the child waits for the parent */
  onLink?: (parentId: string, childId: string) => void
  onUnlink?: (parentId: string, childId: string) => void
  /** hand these cards to Hermes: a profile takes them and they become ready */
  onHand?: (taskIds: string[]) => void
  /** pass a milestone (complete it) — always a human's click */
  onPass?: (taskId: string) => void
  onCopy?: (text: string, kind: 'md' | 'csv') => void
}) {
  useEffect(() => { installStyles() }, [])
  const ref = useRef<HTMLDivElement | null>(null)
  const gesture = useRef<any>(null)
  const undoStack = useRef<any[]>([])
  const redoStack = useRef<any[]>([])
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 })
  const [glide, setGlide] = useState(false)
  const [drag, setDrag] = useState<any>(null)
  const [panning, setPanning] = useState(false)
  const [selection, setSelection] = useState<string[]>([])
  const [marquee, setMarquee] = useState<any>(null)
  const [wire, setWire] = useState<any>(null)
  const [picked, setPicked] = useState<string | null>(null)

  const model = useMemo(
    () => boardFromTasks(tasks || [], { title: title || 'Board', layout, id: board || 'board', looseLabel: i18n.wbLoose }),
    [tasks, title, layout, board, i18n]
  )
  const scene = useMemo(() => applyPositions(layoutBoard(model), positionsFor(positions, layout)), [model, positions, layout])
  const arrows = useMemo(() => arrowsOf(tasks || [], scene.items), [tasks, scene.items])
  const next = useMemo(() => planNext(model), [model])
  const canHand = useMemo(() => handable(model), [model])
  const bounds = useMemo(() => boundsOf(scene.items), [scene.items])
  const byId = useMemo(() => new Map<string, any>(scene.items.map(item => [item.id, item])), [scene.items])

  // Every position change goes through here, so it can be undone.
  const commit = (nextPositions: Record<string, { x: number; y: number }>) => {
    undoStack.current = [...undoStack.current.slice(-MAX_UNDO + 1), positions || {}]
    redoStack.current = []
    onPositions?.(nextPositions)
  }
  const undo = () => {
    const prev = undoStack.current.pop()
    if (!prev) return
    redoStack.current.push(positions || {})
    onPositions?.(prev)
  }
  const redo = () => {
    const again = redoStack.current.pop()
    if (!again) return
    undoStack.current.push(positions || {})
    onPositions?.(again)
  }

  // Whiteboard's `fitView`: the whole plan, centred above the bar at the bottom.
  const fit = (animate: boolean) => {
    const node = ref.current
    const w = node?.clientWidth || 1100
    const h = node?.clientHeight || 720
    const pad = 120
    const zoom = clamp(Math.min((w - pad) / Math.max(bounds.w, 1), (h - pad - 130) / Math.max(bounds.h, 1)), 0.2, 1.1)
    if (animate) {
      setGlide(true)
      setTimeout(() => setGlide(false), 700)
    }
    setView({ x: Math.round(w / 2 - (bounds.x + bounds.w / 2) * zoom), y: Math.round((h - 130) / 2 - (bounds.y + bounds.h / 2) * zoom), zoom })
  }
  const zoomBy = (factor: number) => {
    const node = ref.current
    const point = { x: (node?.clientWidth || 1100) / 2, y: (node?.clientHeight || 720) / 2 }
    setGlide(true)
    setTimeout(() => setGlide(false), 700)
    setView(v => zoomAt(v, point, factor))
  }

  // A new board or a new layout starts framed, never in the previous one's corner.
  useEffect(() => { fit(false) }, [layout, board, scene.items.length])

  // Wheel pans; pinch or a modifier zooms around the pointer. Registered by hand because
  // React's wheel listener is passive and cannot stop the page.
  useEffect(() => {
    const node = ref.current
    if (!node) return undefined
    const onWheel = (event: WheelEvent) => {
      if ((event.target as any)?.closest?.('[data-nodrag]')) return
      event.preventDefault()
      const rect = node.getBoundingClientRect()
      if (event.ctrlKey || event.metaKey) {
        setView(v => zoomAt(v, { x: event.clientX - rect.left, y: event.clientY - rect.top }, Math.exp(-event.deltaY * 0.0105)))
      } else {
        setView(v => ({ ...v, x: v.x - event.deltaX, y: v.y - event.deltaY }))
      }
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [])

  const pointAt = (event: any) => {
    const rect = ref.current?.getBoundingClientRect() || { left: 0, top: 0 }
    return { x: (event.clientX - rect.left - view.x) / view.zoom, y: (event.clientY - rect.top - view.y) / view.zoom }
  }
  // A stop or a frame carries what hangs off it (its notes, their results), as on whiteboard.
  const withChildren = (ids: string[]) => {
    const set = new Set(ids)
    for (const item of scene.items) {
      if ((item.frame && set.has(item.frame)) || (item.for && set.has(item.for))) set.add(item.id)
    }
    for (const item of scene.items) if (item.for && set.has(item.for)) set.add(item.id)
    return [...set]
  }
  const offsets = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>()
    if (drag) for (const id of drag.ids) map.set(id, { x: drag.dx, y: drag.dy })
    return map
  }, [drag])
  const at = (item: any) => {
    const offset = offsets.get(item.id)
    return offset ? { ...item, x: item.x + offset.x, y: item.y + offset.y } : item
  }

  const chrome = (target: any) => target?.closest?.('.wb-zoom, .wb-compose, .wb-unlink')

  const onPointerDown = (event: any) => {
    if (event.button !== 0 || chrome(event.target)) return
    if (event.target.closest?.('[data-nodrag]')) return
    const port = event.target.closest?.('[data-port]')
    if (port) {
      const from = port.getAttribute('data-port')
      gesture.current = { kind: 'connect', from, moved: false, x: event.clientX, y: event.clientY }
      setWire({ from, ...pointAt(event) })
      return
    }
    setPicked(null)
    const hit = event.target.closest?.('[data-item]')
    const id = hit?.getAttribute('data-item')
    const item = id ? byId.get(id) : null
    if (item && MOVABLE.has(item.kind)) {
      const picks = selection.includes(id) ? selection : event.shiftKey ? [...selection, id] : [id]
      gesture.current = { kind: 'drag', item, picks, ids: withChildren(picks), moved: false, shift: event.shiftKey, x: event.clientX, y: event.clientY }
      return
    }
    if (event.shiftKey) {
      const rect = ref.current?.getBoundingClientRect() || { left: 0, top: 0 }
      gesture.current = { kind: 'marquee', start: pointAt(event), moved: false, x: event.clientX, y: event.clientY }
      setMarquee({ x: event.clientX - rect.left, y: event.clientY - rect.top, w: 0, h: 0 })
      return
    }
    gesture.current = { kind: 'pan', moved: false, view, x: event.clientX, y: event.clientY }
  }
  const onPointerMove = (event: any) => {
    const current = gesture.current
    if (!current) return
    const dx = event.clientX - current.x
    const dy = event.clientY - current.y
    if (!current.moved && Math.hypot(dx, dy) < 3) return
    current.moved = true
    if (current.kind === 'drag') setDrag({ ids: current.ids, dx: dx / view.zoom, dy: dy / view.zoom })
    else if (current.kind === 'connect') setWire({ from: current.from, ...pointAt(event) })
    else if (current.kind === 'marquee') {
      const rect = ref.current?.getBoundingClientRect() || { left: 0, top: 0 }
      setMarquee({ x: Math.min(current.x, event.clientX) - rect.left, y: Math.min(current.y, event.clientY) - rect.top, w: Math.abs(dx), h: Math.abs(dy) })
    } else {
      setPanning(true)
      setView({ ...current.view, x: current.view.x + dx, y: current.view.y + dy })
    }
  }
  const onPointerUp = (event: any) => {
    const current = gesture.current
    gesture.current = null
    setPanning(false)
    if (!current) return
    if (current.kind === 'drag' && current.moved) {
      const dx = (event.clientX - current.x) / view.zoom
      const dy = (event.clientY - current.y) / view.zoom
      let nextPositions = { ...(positions || {}) }
      for (const id of current.ids) {
        const item = byId.get(id)
        if (item) nextPositions = withPosition(nextPositions, layout, id, { x: item.x + dx, y: item.y + dy })
      }
      setDrag(null)
      setSelection(current.picks)
      commit(nextPositions)
    } else if (current.kind === 'drag') {
      setDrag(null)
      if (current.shift) {
        const id = current.item.id
        setSelection(sel => (sel.includes(id) ? sel.filter(s => s !== id) : [...sel, id]))
      } else {
        setSelection([current.item.id])
        if (current.item.taskId) onOpen?.(current.item.taskId)
      }
    } else if (current.kind === 'connect') {
      setWire(null)
      const target = typeof document !== 'undefined'
        ? document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-item]')?.getAttribute('data-item')
        : null
      const from = byId.get(current.from)
      const to = target ? byId.get(target) : null
      if (from?.taskId && to?.taskId && from.taskId !== to.taskId) onLink?.(from.taskId, to.taskId)
    } else if (current.kind === 'marquee') {
      const end = pointAt(event)
      const box = { x: Math.min(end.x, current.start.x), y: Math.min(end.y, current.start.y), w: Math.abs(end.x - current.start.x), h: Math.abs(end.y - current.start.y) }
      setSelection(scene.items.filter(item => item.kind !== 'frame' && item.kind !== 'text' && overlaps(box, item)).map(item => item.id))
      setMarquee(null)
    } else if (current.kind === 'pan' && !current.moved) {
      setSelection([])
    }
  }

  // Double-click on the board: a new card, under the milestone of the phase it lands in.
  const onDoubleClick = (event: any) => {
    if (chrome(event.target) || event.target.closest?.('[data-nodrag]')) return
    const point = pointAt(event)
    const hit = event.target.closest?.('[data-item]')
    const item = hit ? byId.get(hit.getAttribute('data-item')) : null
    if (item && item.kind === 'note') return
    const holder = item && (item.kind === 'frame' || item.kind === 'waypoint') ? item
      : scene.items.find(i => i.kind === 'frame' && point.x >= i.x && point.x <= i.x + i.w && point.y >= i.y && point.y <= i.y + i.h)
        || nearestStop(scene.items, point)
    onCreate?.(holder?.role === 'milestone' ? holder.taskId || null : null)
  }

  // Moves and releases are tracked on the window, so a drag that leaves the canvas still ends.
  const handlers = useRef<any>({})
  handlers.current = { move: onPointerMove, up: onPointerUp, undo, redo, picked, arrows, selection }
  useEffect(() => {
    const move = (event: any) => handlers.current.move(event)
    const up = (event: any) => handlers.current.up(event)
    const key = (event: KeyboardEvent) => {
      const target = event.target as any
      if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName || ''))) return
      if (!ref.current || !ref.current.isConnected) return
      const mod = event.ctrlKey || event.metaKey
      if (event.key === 'Escape') {
        setSelection([])
        setPicked(null)
        setWire(null)
        gesture.current = null
      } else if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) handlers.current.redo()
        else handlers.current.undo()
      } else if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        handlers.current.redo()
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      window.removeEventListener('keydown', key)
    }
  }, [])

  const notes = scene.items.filter(item => item.kind === 'note')
  const empty = !(tasks || []).length
  const dots = 24 * view.zoom
  const far = view.zoom < 0.55
  // Text grows as the board shrinks, so a board fitted to the window still reads.
  const k = clamp(0.62 / view.zoom, 1, 1.5)
  const ordered = [...scene.items].sort((a, b) => (a.kind === 'frame' ? 0 : 1) - (b.kind === 'frame' ? 0 : 1))
  const zIndex = (kind: string) => (kind === 'frame' ? 1 : kind === 'text' ? 2 : 5)
  const lit = new Set<string>(next ? scene.items.filter(i => i.taskId && (next.hand.includes(i.taskId) || next.pass === i.taskId) && i.kind !== 'result').map(i => i.id) : [])
  const pickedArrow = picked ? arrows.find(a => a.id === picked) : null

  const itemView = (item: any) => {
    const passable = !!next?.pass && next.pass === item.taskId && !!onPass
    const body = item.kind === 'note' ? jsx(NoteView, { item, i18n, k, far, onHand, canHand: canHand.has(item.taskId) })
      : item.kind === 'waypoint' ? jsx(WaypointView, { item, i18n, passable, onPass })
        : item.kind === 'frame' ? jsx(FrameView, { item, i18n, passable, onPass })
          : item.kind === 'hub' ? jsx(HubView, { item })
            : item.kind === 'result' ? jsx(ResultView, { item, i18n })
              : jsx(TitleView, { item })
    const offset = offsets.get(item.id)
    const selected = selection.includes(item.id) || (!!selectedId && item.taskId === selectedId && item.kind !== 'result')
    return jsxs('div', {
      className: `wb-item${selected ? ' wb-selected' : ''}${lit.has(item.id) ? ' wb-lit' : ''}${offset ? ' wb-dragging' : ''}`,
      'data-item': item.id,
      'data-wb-note': item.kind === 'note' ? item.taskId : undefined,
      'data-wb-frame': item.kind === 'frame' ? item.phase : undefined,
      'data-wb-marker': item.kind === 'waypoint' ? item.phase : undefined,
      'data-wb-result': item.kind === 'result' ? item.taskId : undefined,
      style: {
        left: item.x, top: item.y, width: item.w, height: item.h,
        transform: offset ? `translate(${offset.x}px, ${offset.y}px)` : undefined,
        zIndex: selected ? 20 : zIndex(item.kind)
      },
      children: [
        jsx('div', { style: { height: '100%', position: 'relative' }, children: body }, 'body'),
        item.taskId && LINKABLE.has(item.kind) && onLink && !offset
          ? jsx('div', { className: 'wb-port', 'data-port': item.id, title: i18n.wbLinkHint }, 'port')
          : null
      ]
    }, item.id)
  }

  const Icon = (name: string, codicon: string) => {
    const Glyph = (icons as any)?.[name]
    return typeof Glyph === 'function' || (Glyph && typeof Glyph === 'object')
      ? jsx(Glyph, { size: 15 })
      : jsx(Codicon, { name: codicon, size: '0.85rem' })
  }

  // The agents at work, one cursor per running card, at its top-right corner (screen space).
  const cursors = notes.filter(n => n.stage === 'running').map(n => {
    const c = at(n)
    const label = n.owner && n.owner !== 'jalon' ? n.owner : 'Hermes'
    return { id: n.id, label, hue: hueOf(n.owner || ''), x: (c.x + c.w - 14) * view.zoom + view.x, y: (c.y + 6) * view.zoom + view.y }
  })

  const runPlan = () => {
    if (!next) return
    if (next.hand.length) onHand?.(next.hand)
    else if (next.pass) onPass?.(next.pass)
  }
  const nextPhase = next ? model.phases.find(p => p.id === next.phase) : null
  const nextLabel = !next ? i18n.wbPlanDone
    : next.hand.length ? i18n.wbNextHand(nextPhase?.kind === 'loose' ? i18n.wbLoose : nextPhase?.label || '', next.hand.length)
      : next.pass ? i18n.wbNextPass(nextPhase?.label || '')
        : i18n.wbNextWaiting(nextPhase?.kind === 'loose' ? i18n.wbLoose : nextPhase?.label || '', next.waiting.length)
  const copy = (kind: 'md' | 'csv') => {
    const text = kind === 'md' ? boardMarkdown(model) : toDelimited(boardTable(model, i18n.wbTableHead), ',')
    onCopy?.(text, kind)
  }
  const unlinkAt = pickedArrow ? (() => {
    const a = byId.get(pickedArrow.from)
    const b = byId.get(pickedArrow.to)
    if (!a || !b) return null
    const p = centerOf(at(a))
    const q = centerOf(at(b))
    return { x: ((p.x + q.x) / 2) * view.zoom + view.x, y: ((p.y + q.y) / 2) * view.zoom + view.y }
  })() : null

  return jsxs('div', {
    className: 'wb-page',
    children: [
      jsxs('div', {
        className: `wb-canvas${panning ? ' wb-panning' : ''}`,
        ref,
        onPointerDown,
        onDoubleClick,
        style: { backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${dots}px ${dots}px` },
        children: [
          empty
            ? jsx('div', { className: 'wb-empty', children: jsx('p', { children: i18n.wbEmpty }) }, 'empty')
            : jsxs('div', {
                className: `wb-world${glide ? ' wb-glide' : ''}${far ? ' wb-far' : ''}`,
                style: { '--wb-k': k, '--wb-inv': Math.min(3, 1 / view.zoom), transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` } as any,
                children: [
                  jsx(Links, { items: scene.items, links: scene.links, arrows, at, wire, picked, onPick: setPicked }, 'links'),
                  ...ordered.map(itemView)
                ]
              }, 'world'),
          ...cursors.map(c => jsx(Cursor, { x: c.x, y: c.y, label: c.label, hue: c.hue }, `cursor${c.id}`)),
          marquee ? jsx('div', { className: 'wb-marquee', style: { left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h } }, 'marquee') : null,
          unlinkAt && pickedArrow && onUnlink
            ? jsx('div', {
                className: 'wb-unlink',
                style: { left: unlinkAt.x, top: unlinkAt.y },
                children: jsxs('button', {
                  className: 'wb-btn',
                  type: 'button',
                  onClick: () => { onUnlink(pickedArrow.parent, pickedArrow.child); setPicked(null) },
                  children: [jsx(Line, { name: 'unlink' }, 'i'), i18n.wbUnlink]
                })
              }, 'unlink')
            : null,
          jsxs('div', {
            className: 'wb-compose',
            children: [
              jsxs('div', {
                className: 'wb-compose-row',
                children: [
                  jsxs('button', {
                    className: 'wb-btn wb-go',
                    type: 'button',
                    'data-wb-run': true,
                    disabled: !next || (!next.hand.length && !next.pass) || (!onHand && !onPass),
                    title: i18n.wbRunHint,
                    onClick: runPlan,
                    children: [
                      jsx(Line, { name: next && !next.hand.length && next.pass ? 'check' : 'play' }, 'i'),
                      next && !next.hand.length && next.pass ? i18n.wbPass : i18n.wbRun,
                      next && next.hand.length ? jsx('span', { className: 'wb-badge', children: String(next.hand.length) }, 'n') : null
                    ]
                  }, 'run'),
                  jsx('span', { className: 'wb-next', children: nextLabel }, 'next'),
                  jsx('button', { className: 'wb-btn', type: 'button', onClick: () => copy('md'), title: i18n.wbCopyMd, children: i18n.wbCopyMd }, 'md'),
                  jsx('button', { className: 'wb-btn', type: 'button', onClick: () => copy('csv'), title: i18n.wbCopyCsv, children: i18n.wbCopyCsv }, 'csv')
                ]
              }, 'row'),
              jsxs('div', {
                className: 'wb-layouts',
                children: [
                  ...LAYOUTS.map(mode => jsx('button', {
                    type: 'button',
                    className: layout === mode ? 'wb-on' : undefined,
                    'aria-pressed': layout === mode,
                    onClick: () => onLayout?.(mode),
                    children: mode === 'route' ? i18n.wbRoute : mode === 'columns' ? i18n.wbColumns : i18n.wbMap
                  }, mode)),
                  jsx('span', { className: 'wb-hint', children: i18n.wbHint }, 'hint')
                ]
              }, 'layouts')
            ]
          }, 'compose'),
          jsxs('div', {
            className: 'wb-zoom',
            children: [
              jsx('button', { className: 'wb-btn wb-icon', type: 'button', title: i18n.wbTidy, onClick: () => commit(withoutLayout(positions, layout)), children: jsx(Line, { name: 'wand' }) }, 'tidy'),
              jsx('button', { className: 'wb-btn wb-icon', type: 'button', title: i18n.wbZoomOut, onClick: () => zoomBy(1 / 1.25), children: Icon('ZoomOut', 'zoom-out') }, 'out'),
              jsx('span', { children: `${Math.round(view.zoom * 100)}%` }, 'pct'),
              jsx('button', { className: 'wb-btn wb-icon', type: 'button', title: i18n.wbZoomIn, onClick: () => zoomBy(1.25), children: Icon('ZoomIn', 'zoom-in') }, 'in'),
              jsx('button', { className: 'wb-btn wb-icon', type: 'button', title: i18n.wbFit, onClick: () => fit(true), children: Icon('Maximize', 'screen-full') }, 'fit')
            ]
          }, 'zoom')
        ]
      })
    ]
  })
}

/** On a route the stops hold their phase: a double-click belongs to the nearest one. */
function nearestStop(items: any[], point: { x: number; y: number }) {
  let best: any = null
  let distance = Infinity
  for (const item of items) {
    if (item.kind !== 'waypoint') continue
    const d = Math.abs(item.x + item.w / 2 - point.x)
    if (d < distance) { best = item; distance = d }
  }
  return best
}

function zoomAt(view: { x: number; y: number; zoom: number }, point: { x: number; y: number }, factor: number) {
  const zoom = clamp(view.zoom * factor, 0.15, 2.5)
  const scale = zoom / view.zoom
  return { x: point.x - (point.x - view.x) * scale, y: point.y - (point.y - view.y) * scale, zoom }
}
