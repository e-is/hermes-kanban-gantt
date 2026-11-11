import { Codicon, icons } from '@hermes/plugin-sdk'
import { useEffect, useMemo, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

import {
  applyPositions, boardFromTasks, boundsOf, layoutBoard, pathFractions, positionsFor, withPosition
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
@media (prefers-reduced-motion: reduce) { .wb-item, .wb-world.wb-glide { transition: none; } .wb-work-dot { animation: none; } }
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

function Links({ items, links, at }: { items: any[]; links: any[]; at: (item: any) => any }) {
  const byId = new Map(items.map(item => [item.id, item]))
  const route = items.filter(item => item.kind === 'waypoint').map(at)
  const anchors = route.map(anchorOf)
  const lead = anchors.length > 1
    ? [{ x: anchors[0].x - 140, y: anchors[0].y + 24 }, ...anchors, { x: anchors[anchors.length - 1].x + 140, y: anchors[anchors.length - 1].y - 24 }]
    : anchors
  const road = smoothPath(lead)
  const children: any[] = []
  // The road turns gold up to the last stop passed, in order — a milestone card done.
  const travelled = route.findIndex(stop => !stop.done)
  const doneCount = travelled < 0 ? route.length : travelled
  const fraction = doneCount === 0 || lead.length < 2 ? 0 : doneCount === route.length ? 1 : pathFractions(lead)[doneCount]

  if (road) {
    children.push(
      jsx('path', { d: road, fill: 'none', stroke: `hsl(${HERMES_HUE} 85% 58% / .3)`, strokeLinecap: 'round', strokeWidth: 30 }, 'road'),
      jsx('path', { className: 'wb-travelled', d: road, fill: 'none', pathLength: 1, stroke: GOLD, strokeDasharray: `${fraction} 1`, strokeLinecap: 'round', strokeOpacity: fraction > 0 ? 1 : 0, strokeWidth: 30 }, 'gold'),
      jsx('path', { d: road, fill: 'none', stroke: LINE_INK, strokeDasharray: '2 11', strokeLinecap: 'round', strokeWidth: 2.4 }, 'lane')
    )
  }

  route.forEach((stop, index) => {
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

  return jsx('svg', { className: 'wb-links', children })
}

/* ─────────────────────────────── item views ──────────────────────────────── */

function NoteView({ item, i18n, k, far }: any) {
  const tone = TONES[item.tone] || TONES.butter
  const running = item.stage === 'running'
  const owner = item.owner && item.owner !== 'jalon' ? item.owner : null
  const meta = !running && !far
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
              jsx('div', { className: 'wb-work-dot', style: { background: `hsl(${HERMES_HUE} 80% 50%)` } }, 'd'),
              jsx('span', { children: item.summary || (owner ? `${i18n.wbStages?.running} · ${owner}` : i18n.wbStages?.running) }, 't')
            ]
          }, 'work')
        : null
    ]
  })
}

function WaypointView({ item, i18n }: any) {
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
      }, 'body')
    ]
  })
}

function FrameView({ item, i18n }: any) {
  return jsx('div', {
    className: 'wb-frame',
    children: jsxs('div', {
      className: 'wb-frame-head',
      children: [
        item.sticker ? jsx('div', { className: 'wb-frame-stamp', children: jsx(Sticker, { name: item.sticker, size: 54, tilt: -6 }) }, 's') : null,
        jsx('b', { children: item.role === 'milestone' ? item.title : i18n.wbLoose }, 't')
      ]
    })
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

/* ──────────────────────────────── the view ───────────────────────────────── */

const LAYOUTS = ['route', 'columns', 'map'] as const
const MOVABLE = new Set(['note', 'waypoint', 'frame', 'hub', 'text'])

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
  onOpen
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
}) {
  installStyles()
  const ref = useRef<HTMLDivElement | null>(null)
  const gesture = useRef<any>(null)
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 })
  const [glide, setGlide] = useState(false)
  const [drag, setDrag] = useState<any>(null)
  const [panning, setPanning] = useState(false)

  const model = useMemo(
    () => boardFromTasks(tasks || [], { title: title || 'Board', layout, id: board || 'board' }),
    [tasks, title, layout, board]
  )
  const scene = useMemo(() => applyPositions(layoutBoard(model), positionsFor(positions, layout)), [model, positions, layout])
  const bounds = useMemo(() => boundsOf(scene.items), [scene.items])

  // Whiteboard's `fitView`: the whole plan, centred above the bar at the bottom.
  const fit = (animate: boolean) => {
    const node = ref.current
    const w = node?.clientWidth || 1100
    const h = node?.clientHeight || 720
    const pad = 120
    const zoom = clamp(Math.min((w - pad) / Math.max(bounds.w, 1), (h - pad - 90) / Math.max(bounds.h, 1)), 0.2, 1.1)
    if (animate) {
      setGlide(true)
      setTimeout(() => setGlide(false), 700)
    }
    setView({ x: Math.round(w / 2 - (bounds.x + bounds.w / 2) * zoom), y: Math.round((h - 90) / 2 - (bounds.y + bounds.h / 2) * zoom), zoom })
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

  // A stop or a frame carries the notes that hang off it, as on whiteboard.
  const moving = (id: string) => scene.items.filter(item => item.id === id || item.frame === id).map(item => item.id)
  const offsets = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>()
    if (drag) for (const id of drag.ids) map.set(id, { x: drag.dx, y: drag.dy })
    return map
  }, [drag])
  const at = (item: any) => {
    const offset = offsets.get(item.id)
    return offset ? { ...item, x: item.x + offset.x, y: item.y + offset.y } : item
  }

  const onPointerDown = (event: any) => {
    if (event.button !== 0 || event.target.closest?.('.wb-zoom, .wb-compose')) return
    const hit = event.target.closest?.('[data-item]')
    const id = hit?.getAttribute('data-item')
    const item = id ? scene.items.find(i => i.id === id) : null
    gesture.current = item && MOVABLE.has(item.kind)
      ? { kind: 'drag', item, ids: moving(item.id), moved: false, x: event.clientX, y: event.clientY }
      : { kind: 'pan', moved: false, view, x: event.clientX, y: event.clientY }
  }
  const onPointerMove = (event: any) => {
    const current = gesture.current
    if (!current) return
    const dx = event.clientX - current.x
    const dy = event.clientY - current.y
    if (!current.moved && Math.hypot(dx, dy) < 3) return
    current.moved = true
    if (current.kind === 'drag') setDrag({ ids: current.ids, dx: dx / view.zoom, dy: dy / view.zoom })
    else {
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
      let next = { ...(positions || {}) }
      for (const id of current.ids) {
        const item = scene.items.find(i => i.id === id)
        if (item) next = withPosition(next, layout, id, { x: item.x + dx, y: item.y + dy })
      }
      setDrag(null)
      onPositions?.(next)
    } else if (current.kind === 'drag') {
      setDrag(null)
      if (current.item.taskId) onOpen?.(current.item.taskId)
    }
  }

  // Moves and releases are tracked on the window, so a drag that leaves the canvas still ends.
  const handlers = useRef<any>({})
  handlers.current = { move: onPointerMove, up: onPointerUp }
  useEffect(() => {
    const move = (event: any) => handlers.current.move(event)
    const up = (event: any) => handlers.current.up(event)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [])

  const notes = scene.items.filter(item => item.kind === 'note')
  const empty = scene.items.every(item => item.kind === 'text' || item.kind === 'hub') && notes.length === 0 &&
    !scene.items.some(item => item.taskId)
  const dots = 24 * view.zoom
  const far = view.zoom < 0.55
  // Text grows as the board shrinks, so a board fitted to the window still reads.
  const k = clamp(0.62 / view.zoom, 1, 1.5)
  const ordered = [...scene.items].sort((a, b) => (a.kind === 'frame' ? 0 : 1) - (b.kind === 'frame' ? 0 : 1))
  const zIndex = (kind: string) => (kind === 'frame' ? 1 : kind === 'text' ? 2 : 5)

  const itemView = (item: any) => {
    const body = item.kind === 'note' ? jsx(NoteView, { item, i18n, k, far })
      : item.kind === 'waypoint' ? jsx(WaypointView, { item, i18n })
        : item.kind === 'frame' ? jsx(FrameView, { item, i18n })
          : item.kind === 'hub' ? jsx(HubView, { item })
            : jsx(TitleView, { item })
    const offset = offsets.get(item.id)
    const selected = !!selectedId && item.taskId === selectedId
    return jsx('div', {
      className: `wb-item${selected ? ' wb-selected' : ''}${offset ? ' wb-dragging' : ''}`,
      'data-item': item.id,
      'data-wb-note': item.kind === 'note' ? item.taskId : undefined,
      'data-wb-frame': item.kind === 'frame' ? item.phase : undefined,
      'data-wb-marker': item.kind === 'waypoint' ? item.phase : undefined,
      title: item.taskId ? item.text : undefined,
      style: {
        left: item.x, top: item.y, width: item.w, height: item.h,
        transform: offset ? `translate(${offset.x}px, ${offset.y}px)` : undefined,
        zIndex: selected ? 20 : zIndex(item.kind)
      },
      children: jsx('div', { style: { height: '100%', position: 'relative' }, children: body })
    }, item.id)
  }

  const Icon = (name: string, codicon: string) => {
    const Glyph = (icons as any)?.[name]
    return typeof Glyph === 'function' || (Glyph && typeof Glyph === 'object')
      ? jsx(Glyph, { size: 15 })
      : jsx(Codicon, { name: codicon, size: '0.85rem' })
  }

  return jsxs('div', {
    className: 'wb-page',
    children: [
      jsxs('div', {
        className: `wb-canvas${panning ? ' wb-panning' : ''}`,
        ref,
        onPointerDown,
        style: { backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${dots}px ${dots}px` },
        children: [
          empty
            ? jsx('div', { className: 'wb-empty', children: jsx('p', { children: i18n.wbEmpty }) }, 'empty')
            : jsxs('div', {
                className: `wb-world${glide ? ' wb-glide' : ''}${far ? ' wb-far' : ''}`,
                style: { '--wb-k': k, transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` } as any,
                children: [jsx(Links, { items: scene.items, links: scene.links, at }, 'links'), ...ordered.map(itemView)]
              }, 'world'),
          jsx('div', {
            className: 'wb-compose',
            children: jsxs('div', {
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
            })
          }, 'compose'),
          jsxs('div', {
            className: 'wb-zoom',
            children: [
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

function zoomAt(view: { x: number; y: number; zoom: number }, point: { x: number; y: number }, factor: number) {
  const zoom = clamp(view.zoom * factor, 0.15, 2.5)
  const scale = zoom / view.zoom
  return { x: point.x - (point.x - view.x) * scale, y: point.y - (point.y - view.y) * scale, zoom }
}
