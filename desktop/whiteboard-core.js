// src/core/whiteboard-core.ts
var MILESTONE_LANE = "jalon";
var NOTE_W = 196;
var NOTE_H = 112;
var GAP = 22;
var WAYPOINT_W = 244;
var WAYPOINT_H = 138;
var ROUTE_STEP = 300;
var HUB_W = 320;
var HUB_H = 150;
var STACK = 4;
var RESULT_W = 236;
var RESULT_GAP = 14;
var MAX_ITEMS = 600;
var STAGE_OF = {
  triage: "queued",
  todo: "queued",
  scheduled: "queued",
  ready: "queued",
  running: "running",
  review: "review",
  blocked: "blocked",
  done: "done",
  archived: "done"
};
function stageOf(status) {
  return STAGE_OF[String(status ?? "")] ?? "queued";
}
function roleOf(task) {
  if ((task.assignee ?? "") === MILESTONE_LANE) return "milestone";
  if ((task.children ?? []).length > 0) return "prerequisite";
  return "task";
}
function badgeFor(role) {
  if (role === "milestone") return { label: "◆ Jalon", tone: "orange" };
  if (role === "prerequisite") return { label: "Prérequis", tone: "neutral" };
  return null;
}
var isMilestone = (task) => roleOf(task) === "milestone";
function index(tasks) {
  const byId = /* @__PURE__ */ new Map();
  for (const task of tasks) byId.set(task.id, task);
  return byId;
}
function phaseOf(id, tasks) {
  const byId = index(tasks);
  const seen = /* @__PURE__ */ new Set([id]);
  let frontier = [...byId.get(id)?.parents ?? []];
  while (frontier.length > 0) {
    const next = [];
    for (const parentId of frontier) {
      if (seen.has(parentId)) continue;
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) continue;
      if (isMilestone(parent)) return parent.id;
      next.push(...parent.parents ?? []);
    }
    frontier = next;
  }
  return null;
}
function milestoneOrder(tasks) {
  const milestones = tasks.filter(isMilestone);
  const ids = new Set(milestones.map((t) => t.id));
  const done = /* @__PURE__ */ new Set();
  const out = [];
  let rest = milestones.slice();
  while (rest.length > 0 && out.length < milestones.length) {
    const ready = rest.filter((t) => (t.parents ?? []).every((p) => !ids.has(p) || done.has(p)));
    const batch = ready.length > 0 ? ready : rest.slice(0, 1);
    batch.sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0) || a.id.localeCompare(b.id));
    for (const task of batch) {
      out.push(task);
      done.add(task.id);
    }
    rest = rest.filter((t) => !done.has(t.id));
  }
  return out;
}
function phasesOf(tasks) {
  const phases = milestoneOrder(tasks).map((task) => ({
    id: task.id,
    label: task.title || task.id,
    kind: "milestone",
    taskIds: []
  }));
  const byPhase = new Map(phases.map((p) => [p.id, p]));
  const loose = { id: "loose", label: "No milestone", kind: "loose", taskIds: [] };
  for (const task of tasks) {
    if (isMilestone(task)) continue;
    const owner = phaseOf(task.id, tasks);
    const phase = owner ? byPhase.get(owner) : loose;
    if (!phase) continue;
    task.children = task.children ?? [];
    phase.taskIds.push(task.id);
  }
  if (loose.taskIds.length > 0) phases.push(loose);
  return phases;
}
function boardFromTasks(tasks, options = {}) {
  const max = Math.max(1, options.max ?? MAX_ITEMS);
  const kept = tasks.slice(0, max);
  const phases = phasesOf(kept);
  for (const phase of phases) if (phase.kind === "loose" && options.looseLabel) phase.label = options.looseLabel;
  const phaseByTask = /* @__PURE__ */ new Map();
  for (const phase of phases) for (const id of phase.taskIds) phaseByTask.set(id, phase.id);
  const byKept = index(kept);
  const items = kept.map((task) => ({
    id: `n:${task.id}`,
    kind: "note",
    text: task.title || task.id,
    x: 0,
    y: 0,
    w: NOTE_W,
    h: NOTE_H,
    taskId: task.id,
    phase: isMilestone(task) ? phaseOf(task.id, kept) ?? "loose" : phaseByTask.get(task.id) ?? "loose",
    role: roleOf(task),
    stage: stageOf(task.status),
    owner: task.assignee ?? null,
    label: task.label ?? null,
    summary: task.latest_summary || "",
    gated: (task.parents ?? []).some((p) => stageOf(byKept.get(p)?.status) !== "done" && byKept.has(p)),
    // What a finished card delivered: its result, else the summary it was closed with.
    result: stageOf(task.status) === "done" ? String(task.result || task.latest_summary || "").trim() : ""
  }));
  return {
    id: options.id ?? "board",
    title: options.title || "Board",
    layout: options.layout ?? "route",
    phases,
    items,
    links: [],
    results: options.results !== false,
    dropped: Math.max(0, tasks.length - kept.length)
  };
}
var rectOf = (item) => ({ x: item.x, y: item.y, w: item.w, h: item.h });
function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
function boundsOf(items) {
  if (items.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...items.map((i) => i.x));
  const y = Math.min(...items.map((i) => i.y));
  const right = Math.max(...items.map((i) => i.x + i.w));
  const bottom = Math.max(...items.map((i) => i.y + i.h));
  return { x, y, w: right - x, h: bottom - y };
}
function fitFrames(items) {
  const notes = items.filter((i) => i.kind === "note");
  return items.map((item) => {
    if (item.kind !== "frame") return item;
    const mine = notes.filter((n) => !n.frame || n.frame === item.id);
    if (mine.length === 0) return item;
    const box = boundsOf([item, ...mine]);
    return { ...item, ...box };
  });
}
function frameSlots(frame, count, cols = 2, cell = NOTE_W) {
  return Array.from({ length: count }, (_, i) => ({
    x: frame.x + GAP + i % cols * (cell + GAP),
    y: frame.y + 64 + Math.floor(i / cols) * (NOTE_H + GAP)
  }));
}
function frameSize(count, cols = 2, title = "", cell = NOTE_W) {
  const rows = Math.max(1, Math.ceil(count / cols));
  return {
    h: 64 + rows * (NOTE_H + GAP) + 4,
    w: Math.max(GAP + cols * (cell + GAP), Math.round(78 + String(title).length * 13))
  };
}
function pathFractions(points) {
  const lengths = points.map((p, i) => i === 0 ? 0 : Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y));
  const total = lengths.reduce((sum, v) => sum + v, 0) || 1;
  let run = 0;
  return lengths.map((v) => (run += v) / total);
}
function tiltOf(id) {
  let hash = 0;
  for (const char of String(id)) hash = hash * 31 + char.charCodeAt(0) | 0;
  return (Math.abs(hash) % 25 - 12) / 10;
}
var TONE_OF = { queued: "butter", running: "sky", review: "lilac", blocked: "peach", done: "mint" };
var toneOf = (stage) => TONE_OF[stage ?? "queued"] ?? "butter";
var MILESTONE_STICKERS = ["flag", "target", "rocket", "calendar", "trophy", "star", "chart", "gear"];
var stickerFor = (phase, index2) => phase.kind === "loose" ? "pin" : MILESTONE_STICKERS[index2 % MILESTONE_STICKERS.length];
function sectionsOfBoard(board) {
  const byTask = new Map(board.items.filter((i) => i.taskId).map((i) => [i.taskId, i]));
  return board.phases.map((phase, index2) => {
    const head = phase.kind === "milestone" ? byTask.get(phase.id) ?? null : null;
    const notes = board.items.filter((i) => i.kind === "note" && i !== head && i.phase === phase.id && i.role !== "milestone").map((n) => ({ ...n, tone: toneOf(n.stage), tilt: tiltOf(n.taskId || n.id) }));
    const done = head ? head.stage === "done" : notes.length > 0 && notes.every((n) => n.stage === "done");
    return { phase, index: index2, head, notes, done };
  });
}
var titleItem = (board, x, y) => ({
  id: "title",
  kind: "text",
  size: "title",
  text: board.title,
  x,
  y,
  w: 900,
  h: 84
});
function resultFor(owner, x, y, h, w = RESULT_W) {
  return {
    id: `r:${owner.taskId}`,
    kind: "result",
    text: owner.result || "",
    title: owner.text,
    for: owner.id,
    taskId: owner.taskId,
    brief: owner.role === "milestone",
    stage: "done",
    x,
    y,
    w,
    h
  };
}
var delivers = (board, note) => Boolean(board.results !== false && note && note.result);
var cellOf = (board, notes) => NOTE_W + (notes.some((n) => delivers(board, n)) ? RESULT_GAP + RESULT_W : 0);
function routeLayout(board) {
  const items = [];
  const links = [];
  const title = titleItem(board, 0, 0);
  const base = 360;
  let x = 40;
  let previous = null;
  items.push(title);
  for (const section of sectionsOfBoard(board)) {
    const { phase, index: index2, head, notes } = section;
    const cols = Math.max(1, Math.ceil(notes.length / STACK));
    const cell = cellOf(board, notes);
    const colsW = cols * cell + (cols - 1) * 14;
    const brief = delivers(board, head);
    const stopW = WAYPOINT_W + (brief ? RESULT_GAP + RESULT_W : 0);
    const block = Math.max(stopW, colsW);
    const road = base + Math.round(Math.sin(index2 * 1.15) * 64);
    const above = index2 % 2 === 0;
    const stop = {
      id: `p:${phase.id}`,
      kind: "waypoint",
      text: phase.label,
      title: phase.label,
      phase: phase.id,
      role: phase.kind === "milestone" ? "milestone" : "task",
      taskId: head?.taskId,
      stage: head?.stage,
      owner: head?.owner,
      result: head?.result,
      step: index2 + 1,
      side: above ? "above" : "below",
      sticker: stickerFor(phase, index2),
      tilt: above ? -3 : 3,
      done: section.done,
      w: WAYPOINT_W,
      h: WAYPOINT_H,
      x: x + (block - stopW) / 2,
      y: above ? road - 56 - WAYPOINT_H : road + 56
    };
    items.push(stop);
    if (brief) items.push(resultFor(stop, stop.x + WAYPOINT_W + RESULT_GAP, stop.y, WAYPOINT_H));
    const left = x + (block - colsW) / 2;
    notes.forEach((note, n) => {
      const col = Math.floor(n / STACK);
      const row = n % STACK;
      const placed = {
        ...note,
        frame: stop.id,
        x: left + col * (cell + 14),
        y: above ? stop.y - 26 - (row + 1) * (NOTE_H + 14) : stop.y + WAYPOINT_H + 14 + row * (NOTE_H + 14)
      };
      items.push(placed);
      if (delivers(board, note)) items.push({ ...resultFor(placed, placed.x + NOTE_W + RESULT_GAP, placed.y, NOTE_H), frame: stop.id });
    });
    if (previous) links.push({ id: `r:${previous.id}>${stop.id}`, from: previous.id, to: stop.id, kind: "route" });
    previous = stop;
    x += Math.max(ROUTE_STEP, block + 56);
  }
  const rest = items.filter((i) => i !== title);
  title.y = (rest.length ? Math.min(...rest.map((i) => i.y)) : 0) - 160;
  return { items, links };
}
function blockSize(board, section, cols) {
  const cell = cellOf(board, section.notes);
  const slots = section.notes.length + (delivers(board, section.head) ? 1 : 0);
  return { cell, slots, size: frameSize(Math.max(1, slots), cols, section.phase.label, cell) };
}
function framed(board, section, cols, x, y) {
  const { phase, index: index2, head, notes } = section;
  const { cell, slots, size } = blockSize(board, section, cols);
  const frame = {
    id: `f:${phase.id}`,
    kind: "frame",
    text: phase.label,
    title: phase.label,
    phase: phase.id,
    role: phase.kind === "milestone" ? "milestone" : "task",
    taskId: head?.taskId,
    stage: head?.stage,
    result: head?.result,
    sticker: stickerFor(phase, index2),
    done: section.done,
    ...size,
    x: Math.round(x),
    y: Math.round(y)
  };
  const grid = frameSlots(frame, slots, cols, cell);
  const out = [frame];
  notes.forEach((note, n) => {
    const placed = { ...note, frame: frame.id, ...grid[n] };
    out.push(placed);
    if (delivers(board, note)) out.push({ ...resultFor(placed, placed.x + NOTE_W + RESULT_GAP, placed.y, NOTE_H), frame: frame.id });
  });
  if (delivers(board, head)) {
    const spot = grid[notes.length];
    out.push({ ...resultFor(frame, spot.x, spot.y, NOTE_H, cell), frame: frame.id });
  }
  return out;
}
function columnsLayout(board) {
  const items = [titleItem(board, 0, 0)];
  let x = 0;
  for (const section of sectionsOfBoard(board)) {
    const cols = section.notes.length > 3 ? 2 : 1;
    const block = framed(board, section, cols, x, 120);
    items.push(...block);
    x += block[0].w + 56;
  }
  return { items, links: [] };
}
function mapLayout(board) {
  const sections = sectionsOfBoard(board);
  const count = Math.max(1, sections.length);
  const colsOf = (s) => s.notes.length > 2 ? 2 : 1;
  const sizes = sections.map((s) => blockSize(board, s, colsOf(s)).size);
  const reach = Math.max(0, ...sizes.map((s) => Math.max(s.w, s.h)));
  const rx = Math.max(300 + count * 70, HUB_W / 2 + reach / 2 + 60);
  const ry = Math.max(220 + count * 40, HUB_H / 2 + reach / 2 + 40);
  const hub = {
    id: "hub",
    kind: "hub",
    text: board.title,
    title: board.title,
    sticker: "spark",
    w: HUB_W,
    h: HUB_H,
    x: rx + 140,
    y: ry + 150
  };
  const items = [hub];
  const links = [];
  sections.forEach((section, i) => {
    const angle = -Math.PI / 2 + i / count * Math.PI * 2;
    const size = sizes[i];
    const cx = hub.x + hub.w / 2 + Math.cos(angle) * rx;
    const cy = hub.y + hub.h / 2 + Math.sin(angle) * ry;
    const block = framed(board, section, colsOf(section), cx - size.w / 2, cy - size.h / 2);
    items.push(...block);
    links.push({ id: `b:${block[0].id}`, from: hub.id, to: block[0].id, kind: "branch" });
  });
  return { items, links };
}
function arrowsOf(tasks, items) {
  const drawn = /* @__PURE__ */ new Map();
  for (const item of items) if (item.taskId && item.kind !== "result" && !drawn.has(item.taskId)) drawn.set(item.taskId, item.id);
  const byId = index(tasks);
  const out = [];
  for (const child of tasks) {
    for (const parentId of child.parents ?? []) {
      const parent = byId.get(parentId);
      if (!parent || isMilestone(parent)) continue;
      const from = drawn.get(parentId);
      const to = drawn.get(child.id);
      if (!from || !to) continue;
      out.push({ id: `a:${parentId}>${child.id}`, parent: parentId, child: child.id, from, to });
    }
  }
  return out;
}
var isOpen = (section) => section.phase.kind === "loose" || section.head?.stage === "done";
function handable(board) {
  const out = /* @__PURE__ */ new Set();
  for (const section of sectionsOfBoard(board)) {
    if (!isOpen(section)) continue;
    for (const note of section.notes) if (note.stage === "queued" && !note.gated && note.taskId) out.add(note.taskId);
  }
  return out;
}
function planNext(board) {
  const sections = sectionsOfBoard(board);
  const milestones = sections.filter((s) => s.phase.kind === "milestone");
  const loose = sections.filter((s) => s.phase.kind === "loose");
  for (const section of [...milestones, ...loose]) {
    const { phase, head, notes } = section;
    if (!isOpen(section)) {
      return { phase: phase.id, hand: [], pass: head?.taskId ?? null, waiting: [] };
    }
    const open = notes.filter((n) => n.stage !== "done");
    const hand = open.filter((n) => n.stage === "queued" && !n.gated).map((n) => n.taskId);
    const waiting = open.filter((n) => n.stage !== "queued" || n.gated).map((n) => n.taskId);
    if (hand.length || waiting.length) return { phase: phase.id, hand, pass: null, waiting };
  }
  return null;
}
function layoutBoard(board) {
  if (board.layout === "columns") return columnsLayout(board);
  if (board.layout === "map") return mapLayout(board);
  return routeLayout(board);
}
function planStops(board) {
  const open = (note) => note.role !== "milestone" && note.stage !== "done";
  const stops = [];
  for (const phase of board.phases) {
    const notes = board.items.filter((n) => n.phase === phase.id && open(n));
    if (notes.length === 0 && phase.kind !== "milestone") continue;
    stops.push({ phase, notes });
  }
  return stops;
}
function stageCounts(board) {
  const counts = { queued: 0, running: 0, review: 0, blocked: 0, done: 0 };
  for (const note of board.items) {
    if (note.kind !== "note" || !note.stage) continue;
    counts[note.stage] += 1;
  }
  return counts;
}
function boardMarkdown(board) {
  const lines = [`# ${board.title}`, ""];
  for (const phase of board.phases) {
    lines.push(phase.kind === "milestone" ? `## ◆ ${phase.label}` : `## ${phase.label}`);
    const notes = board.items.filter((i) => i.phase === phase.id && i.kind === "note");
    for (const note of notes) {
      lines.push(`- [${note.stage === "done" ? "x" : " "}] ${note.text}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
function boardTable(board, header = ["Phase", "Card", "Status", "Owner", "Role"]) {
  const rows = [header];
  for (const phase of board.phases) {
    for (const note of board.items.filter((i) => i.phase === phase.id && i.kind === "note")) {
      rows.push([phase.label, note.text, note.stage ?? "", note.owner ?? "", note.role ?? ""]);
    }
  }
  return rows;
}
function toDelimited(rows, delimiter = ",") {
  const cell = (value) => {
    const text = String(value ?? "");
    return text.includes(delimiter) || text.includes('"') || text.includes("\n") ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map((row) => row.map(cell).join(delimiter)).join("\n");
}
function applyPositions(layout, positions) {
  const items = layout.items.map((item) => {
    const spot = positions?.[item.id];
    if (!spot) return item;
    const x = Number(spot.x);
    const y = Number(spot.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return item;
    return { ...item, x: Math.round(x), y: Math.round(y) };
  });
  return { items, links: layout.links };
}
function positionsFor(stored, layout) {
  const prefix = `${layout}|`;
  const out = {};
  for (const [key, spot] of Object.entries(stored || {})) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = spot;
  }
  return out;
}
function withPosition(stored, layout, id, spot) {
  return { ...stored || {}, [`${layout}|${id}`]: { x: Math.round(spot.x), y: Math.round(spot.y) } };
}
function withoutLayout(stored, layout) {
  const prefix = `${layout}|`;
  const out = {};
  for (const [key, spot] of Object.entries(stored || {})) if (!key.startsWith(prefix)) out[key] = spot;
  return out;
}
export {
  GAP,
  HUB_H,
  HUB_W,
  MAX_ITEMS,
  MILESTONE_LANE,
  NOTE_H,
  NOTE_W,
  RESULT_GAP,
  RESULT_W,
  ROUTE_STEP,
  STACK,
  WAYPOINT_H,
  WAYPOINT_W,
  applyPositions,
  arrowsOf,
  badgeFor,
  boardFromTasks,
  boardMarkdown,
  boardTable,
  boundsOf,
  fitFrames,
  frameSize,
  frameSlots,
  handable,
  layoutBoard,
  overlaps,
  pathFractions,
  phaseOf,
  phasesOf,
  planNext,
  planStops,
  positionsFor,
  rectOf,
  roleOf,
  stageCounts,
  stageOf,
  tiltOf,
  toDelimited,
  toneOf,
  withPosition,
  withoutLayout
};
/*!
 * Whiteboard view — adapted from hermes-whiteboard
 * https://github.com/Adolanium/hermes-whiteboard
 *
 * MIT License
 *
 * Copyright (c) 2026 Adolanium
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
