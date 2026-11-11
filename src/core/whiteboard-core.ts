/**
 * Whiteboard mode — pure core.
 *
 * Adapted from Adolanium/hermes-whiteboard (MIT): its canvas vocabulary (frames, notes,
 * waypoints, a road) and its no-overlap layout discipline. The model is NOT whiteboard's:
 * here every card is a kanban task, a phase is a milestone, and the milestone is a lane
 * (`assignee === 'jalon'`), never a tag or a title prefix.
 *
 * No React, no SDK, no DOM: the view imports the built `desktop/whiteboard-core.js`,
 * and `tests/whiteboard-core.test.mjs` imports this file directly.
 */

/* ─────────────────────────────── constants ───────────────────────────────── */

/** The non-profile lane a milestone card is assigned to. The dispatcher only spawns cards
 *  whose assignee names a real profile, so a milestone is never run by a worker — it waits
 *  for a human (or a one-shot summary) to pass it. */
export const MILESTONE_LANE = 'jalon'

// Whiteboard's own sizes (desktop/plugin.js): a note, the gap of a frame's grid, a stop on
// the road, the distance between two stops, and the hub of a map.
export const NOTE_W = 196
export const NOTE_H = 112
export const GAP = 22
export const WAYPOINT_W = 244
export const WAYPOINT_H = 138
export const ROUTE_STEP = 300
export const HUB_W = 320
export const HUB_H = 150
export const STACK = 4 // notes per column hanging off a stop (whiteboard caps a section at 4)
export const RESULT_W = 236 // a delivered card, set beside the card it came out of
export const RESULT_GAP = 14
export const MAX_ITEMS = 600

export type Stage = 'queued' | 'running' | 'review' | 'blocked' | 'done'
export type Role = 'milestone' | 'prerequisite' | 'task'
export type Layout = 'route' | 'columns' | 'map'

export interface Task {
  id: string
  title?: string
  status?: string
  assignee?: string | null
  priority?: number
  label?: string | null
  created_at?: number | null
  started_at?: number | null
  completed_at?: number | null
  children?: string[]
  parents?: string[]
  latest_summary?: string
  result?: string | null
}

export type Tone = 'butter' | 'peach' | 'mint' | 'sky' | 'lilac' | 'paper'

export interface Note {
  id: string
  kind: 'note' | 'frame' | 'waypoint' | 'hub' | 'text' | 'result'
  /** result: the item it was delivered for; brief: it closes a milestone */
  for?: string
  brief?: boolean
  result?: string
  /** a parent card is not done yet: the kanban gate holds this card */
  gated?: boolean
  text: string
  title?: string
  frame?: string
  tone?: Tone
  step?: number
  side?: 'above' | 'below'
  tilt?: number
  sticker?: string
  done?: boolean
  size?: 'title'
  x: number
  y: number
  w: number
  h: number
  taskId?: string
  phase?: string
  role?: Role
  stage?: Stage
  owner?: string | null
  label?: string | null
  summary?: string
}

export interface Edge { id: string; from: string; to: string; kind: 'route' | 'branch' }

export interface Phase {
  id: string
  label: string
  kind: 'milestone' | 'loose'
  taskIds: string[]
}

export interface Board {
  id: string
  title: string
  layout: Layout
  phases: Phase[]
  items: Note[]
  links: Edge[]
  results?: boolean
  dropped: number
}

export interface Layout3 { items: Note[]; links: Edge[] }

/* ──────────────────────────────── statuses ───────────────────────────────── */

const STAGE_OF: Record<string, Stage> = {
  triage: 'queued',
  todo: 'queued',
  scheduled: 'queued',
  ready: 'queued',
  running: 'running',
  review: 'review',
  blocked: 'blocked',
  done: 'done',
  archived: 'done'
}

export function stageOf(status?: string | null): Stage {
  return STAGE_OF[String(status ?? '')] ?? 'queued'
}

/* ───────────────────────────────── roles ─────────────────────────────────── */

/** A parent card has exactly one meaning in the kanban core: its children wait for it.
 *  The LANE decides whether that parent is a milestone (a checkpoint someone must pass)
 *  or a prerequisite (work a worker does). A card that is neither is a plain task. */
export function roleOf(task: Task): Role {
  if ((task.assignee ?? '') === MILESTONE_LANE) return 'milestone'
  if ((task.children ?? []).length > 0) return 'prerequisite'
  return 'task'
}

export interface Badge { label: string; tone: 'neutral' | 'orange' }

/** The projection the official board paints. Text only, <= 24 chars — both fit. */
export function badgeFor(role: Role): Badge | null {
  if (role === 'milestone') return { label: '◆ Jalon', tone: 'orange' }
  if (role === 'prerequisite') return { label: 'Prérequis', tone: 'neutral' }
  return null
}

/* ──────────────────────────────── phases ─────────────────────────────────── */

const isMilestone = (task: Task) => roleOf(task) === 'milestone'

function index(tasks: Task[]) {
  const byId = new Map<string, Task>()
  for (const task of tasks) byId.set(task.id, task)
  return byId
}

/** The nearest milestone above a card, breadth-first, or null. A milestone is a card too,
 *  so its own phase is its parent's. */
export function phaseOf(id: string, tasks: Task[]): string | null {
  const byId = index(tasks)
  const seen = new Set<string>([id])
  let frontier = [...(byId.get(id)?.parents ?? [])]

  while (frontier.length > 0) {
    const next: string[] = []
    for (const parentId of frontier) {
      if (seen.has(parentId)) continue
      seen.add(parentId)
      const parent = byId.get(parentId)
      if (!parent) continue
      if (isMilestone(parent)) return parent.id
      next.push(...(parent.parents ?? []))
    }
    frontier = next
  }
  return null
}

function milestoneOrder(tasks: Task[]): Task[] {
  const milestones = tasks.filter(isMilestone)
  const ids = new Set(milestones.map(t => t.id))
  const done = new Set<string>()
  const out: Task[] = []
  let rest = milestones.slice()

  while (rest.length > 0 && out.length < milestones.length) {
    const ready = rest.filter(t => (t.parents ?? []).every(p => !ids.has(p) || done.has(p)))
    const batch = ready.length > 0 ? ready : rest.slice(0, 1) // an odd cycle still lays out
    batch.sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0) || a.id.localeCompare(b.id))
    for (const task of batch) {
      out.push(task)
      done.add(task.id)
    }
    rest = rest.filter(t => !done.has(t.id))
  }
  return out
}

export function phasesOf(tasks: Task[]): Phase[] {
  const phases: Phase[] = milestoneOrder(tasks).map(task => ({
    id: task.id,
    label: task.title || task.id,
    kind: 'milestone' as const,
    taskIds: [] as string[]
  }))
  const byPhase = new Map(phases.map(p => [p.id, p]))
  const loose: Phase = { id: 'loose', label: 'No milestone', kind: 'loose', taskIds: [] }

  for (const task of tasks) {
    if (isMilestone(task)) continue
    const owner = phaseOf(task.id, tasks)
    const phase = owner ? byPhase.get(owner) : loose
    if (!phase) continue
    task.children = task.children ?? []
    phase.taskIds.push(task.id)
  }

  if (loose.taskIds.length > 0) phases.push(loose)
  return phases
}

/* ───────────────────────────────  model  ─────────────────────────────────── */

export function boardFromTasks(
  tasks: Task[],
  options: { title?: string; layout?: Layout; max?: number; id?: string; results?: boolean; looseLabel?: string } = {}
): Board {
  const max = Math.max(1, options.max ?? MAX_ITEMS)
  const kept = tasks.slice(0, max)
  const phases = phasesOf(kept)
  for (const phase of phases) if (phase.kind === 'loose' && options.looseLabel) phase.label = options.looseLabel
  const phaseByTask = new Map<string, string>()
  for (const phase of phases) for (const id of phase.taskIds) phaseByTask.set(id, phase.id)

  const byKept = index(kept)
  const items: Note[] = kept.map(task => ({
    id: `n:${task.id}`,
    kind: 'note',
    text: task.title || task.id,
    x: 0,
    y: 0,
    w: NOTE_W,
    h: NOTE_H,
    taskId: task.id,
    phase: isMilestone(task) ? phaseOf(task.id, kept) ?? 'loose' : phaseByTask.get(task.id) ?? 'loose',
    role: roleOf(task),
    stage: stageOf(task.status),
    owner: task.assignee ?? null,
    label: task.label ?? null,
    summary: task.latest_summary || '',
    gated: (task.parents ?? []).some(p => stageOf(byKept.get(p)?.status) !== 'done' && byKept.has(p)),
    // What a finished card delivered: its result, else the summary it was closed with.
    result: stageOf(task.status) === 'done' ? String(task.result || task.latest_summary || '').trim() : ''
  }))

  return {
    id: options.id ?? 'board',
    title: options.title || 'Board',
    layout: options.layout ?? 'route',
    phases,
    items,
    links: [],
    results: options.results !== false,
    dropped: Math.max(0, tasks.length - kept.length)
  }
}

/* ─────────────────────────────── geometry ───────────────────────────────── */

export interface Rect { x: number; y: number; w: number; h: number }

export const rectOf = (item: Rect): Rect => ({ x: item.x, y: item.y, w: item.w, h: item.h })

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export function boundsOf(items: Rect[]): Rect {
  if (items.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  const x = Math.min(...items.map(i => i.x))
  const y = Math.min(...items.map(i => i.y))
  const right = Math.max(...items.map(i => i.x + i.w))
  const bottom = Math.max(...items.map(i => i.y + i.h))
  return { x, y, w: right - x, h: bottom - y }
}

/** Grow every frame so it wraps its notes (a note with no `frame` belongs to every frame,
 *  which is what the whiteboard test asked of this helper). */
export function fitFrames(items: Note[]): Note[] {
  const notes = items.filter(i => i.kind === 'note')
  return items.map(item => {
    if (item.kind !== 'frame') return item
    const mine = notes.filter(n => !n.frame || n.frame === item.id)
    if (mine.length === 0) return item
    const box = boundsOf([item, ...mine])
    return { ...item, ...box }
  })
}

/** Notes in a frame sit in a grid under the frame's title — whiteboard's `frameSlots`. */
export function frameSlots(frame: { x: number; y: number }, count: number, cols = 2, cell = NOTE_W): { x: number; y: number }[] {
  return Array.from({ length: count }, (_, i) => ({
    x: frame.x + GAP + (i % cols) * (cell + GAP),
    y: frame.y + 64 + Math.floor(i / cols) * (NOTE_H + GAP)
  }))
}

/** Wide enough for the title in the display face, sticker included — whiteboard's `frameSize`,
 *  with room for the title's zoomed-out growth (`--wb-k` scales it up to 1.4×; whiteboard's 10.5
 *  px per character truncated « Ready for review » on a fitted map). */
export function frameSize(count: number, cols = 2, title = '', cell = NOTE_W): { w: number; h: number } {
  const rows = Math.max(1, Math.ceil(count / cols))
  return {
    h: 64 + rows * (NOTE_H + GAP) + 4,
    w: Math.max(GAP + cols * (cell + GAP), Math.round(78 + String(title).length * 13))
  }
}

/** How far along a path each of its points sits, from 0 to 1, by chord length. */
export function pathFractions(points: { x: number; y: number }[]): number[] {
  const lengths = points.map((p, i) => (i === 0 ? 0 : Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y)))
  const total = lengths.reduce((sum, v) => sum + v, 0) || 1
  let run = 0
  return lengths.map(v => (run += v) / total)
}

/** A small, steady tilt per note, so a board looks set down by hand — whiteboard's `tiltOf`. */
export function tiltOf(id: string): number {
  let hash = 0
  for (const char of String(id)) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return ((Math.abs(hash) % 25) - 12) / 10
}

/* ───────────────────────────────  layouts  ───────────────────────────────── */

/** Whiteboard's paper tones, one per stage: the colour says where the card is. */
const TONE_OF: Record<Stage, Tone> = { queued: 'butter', running: 'sky', review: 'lilac', blocked: 'peach', done: 'mint' }
export const toneOf = (stage?: Stage | null): Tone => TONE_OF[stage ?? 'queued'] ?? 'butter'

/** Whiteboard's stamps, in the order a plan meets them; the loose cards get the pin. */
const MILESTONE_STICKERS = ['flag', 'target', 'rocket', 'calendar', 'trophy', 'star', 'chart', 'gear']
const stickerFor = (phase: Phase, index: number) =>
  phase.kind === 'loose' ? 'pin' : MILESTONE_STICKERS[index % MILESTONE_STICKERS.length]

interface Section { phase: Phase; index: number; head: Note | null; notes: Note[]; done: boolean }

/** A phase as whiteboard's section: its milestone card (the head) and the cards under it. */
function sectionsOfBoard(board: Board): Section[] {
  const byTask = new Map(board.items.filter(i => i.taskId).map(i => [i.taskId as string, i]))
  return board.phases.map((phase, index) => {
    const head = phase.kind === 'milestone' ? byTask.get(phase.id) ?? null : null
    const notes = board.items
      .filter(i => i.kind === 'note' && i !== head && i.phase === phase.id && i.role !== 'milestone')
      .map(n => ({ ...n, tone: toneOf(n.stage), tilt: tiltOf(n.taskId || n.id) }))
    const done = head ? head.stage === 'done' : notes.length > 0 && notes.every(n => n.stage === 'done')
    return { phase, index, head, notes, done }
  })
}

const titleItem = (board: Board, x: number, y: number): Note => ({
  id: 'title', kind: 'text', size: 'title', text: board.title, x, y, w: 900, h: 84
})

/** Whiteboard's delivered card, for a finished card that has something to show. */
function resultFor(owner: Note, x: number, y: number, h: number, w = RESULT_W): Note {
  return {
    id: `r:${owner.taskId}`,
    kind: 'result',
    text: owner.result || '',
    title: owner.text,
    for: owner.id,
    taskId: owner.taskId,
    brief: owner.role === 'milestone',
    stage: 'done',
    x, y, w, h
  }
}

const delivers = (board: Board, note: Note | null | undefined) => Boolean(board.results !== false && note && note.result)

/** The width a section's grid cell needs: a note, plus its delivered card when one shows. */
const cellOf = (board: Board, notes: Note[]) => NOTE_W + (notes.some(n => delivers(board, n)) ? RESULT_GAP + RESULT_W : 0)

function routeLayout(board: Board): Layout3 {
  const items: Note[] = []
  const links: Edge[] = []
  const title = titleItem(board, 0, 0)
  const base = 360
  let x = 40
  let previous: Note | null = null

  items.push(title)
  for (const section of sectionsOfBoard(board)) {
    const { phase, index, head, notes } = section
    const cols = Math.max(1, Math.ceil(notes.length / STACK))
    const cell = cellOf(board, notes)
    const colsW = cols * cell + (cols - 1) * 14
    const brief = delivers(board, head)
    const stopW = WAYPOINT_W + (brief ? RESULT_GAP + RESULT_W : 0)
    const block = Math.max(stopW, colsW)
    const road = base + Math.round(Math.sin(index * 1.15) * 64)
    const above = index % 2 === 0
    const stop: Note = {
      id: `p:${phase.id}`,
      kind: 'waypoint',
      text: phase.label,
      title: phase.label,
      phase: phase.id,
      role: phase.kind === 'milestone' ? 'milestone' : 'task',
      taskId: head?.taskId,
      stage: head?.stage,
      owner: head?.owner,
      result: head?.result,
      step: index + 1,
      side: above ? 'above' : 'below',
      sticker: stickerFor(phase, index),
      tilt: above ? -3 : 3,
      done: section.done,
      w: WAYPOINT_W,
      h: WAYPOINT_H,
      x: x + (block - stopW) / 2,
      y: above ? road - 56 - WAYPOINT_H : road + 56
    }
    items.push(stop)
    if (brief) items.push(resultFor(stop, stop.x + WAYPOINT_W + RESULT_GAP, stop.y, WAYPOINT_H))
    const left = x + (block - colsW) / 2
    notes.forEach((note, n) => {
      const col = Math.floor(n / STACK)
      const row = n % STACK
      const placed = {
        ...note,
        frame: stop.id,
        x: left + col * (cell + 14),
        y: above ? stop.y - 26 - (row + 1) * (NOTE_H + 14) : stop.y + WAYPOINT_H + 14 + row * (NOTE_H + 14)
      }
      items.push(placed)
      if (delivers(board, note)) items.push({ ...resultFor(placed, placed.x + NOTE_W + RESULT_GAP, placed.y, NOTE_H), frame: stop.id })
    })
    if (previous) links.push({ id: `r:${previous.id}>${stop.id}`, from: previous.id, to: stop.id, kind: 'route' })
    previous = stop
    x += Math.max(ROUTE_STEP, block + 56)
  }

  const rest = items.filter(i => i !== title)
  title.y = (rest.length ? Math.min(...rest.map(i => i.y)) : 0) - 160
  return { items, links }
}

/** A frame's footprint: its notes, plus one slot for the milestone's brief when it shows. */
function blockSize(board: Board, section: Section, cols: number) {
  const cell = cellOf(board, section.notes)
  const slots = section.notes.length + (delivers(board, section.head) ? 1 : 0)
  return { cell, slots, size: frameSize(Math.max(1, slots), cols, section.phase.label, cell) }
}

function framed(board: Board, section: Section, cols: number, x: number, y: number): Note[] {
  const { phase, index, head, notes } = section
  const { cell, slots, size } = blockSize(board, section, cols)
  const frame: Note = {
    id: `f:${phase.id}`,
    kind: 'frame',
    text: phase.label,
    title: phase.label,
    phase: phase.id,
    role: phase.kind === 'milestone' ? 'milestone' : 'task',
    taskId: head?.taskId,
    stage: head?.stage,
    result: head?.result,
    sticker: stickerFor(phase, index),
    done: section.done,
    ...size,
    x: Math.round(x),
    y: Math.round(y)
  }
  const grid = frameSlots(frame, slots, cols, cell)
  const out: Note[] = [frame]
  notes.forEach((note, n) => {
    const placed = { ...note, frame: frame.id, ...grid[n] }
    out.push(placed)
    if (delivers(board, note)) out.push({ ...resultFor(placed, placed.x + NOTE_W + RESULT_GAP, placed.y, NOTE_H), frame: frame.id })
  })
  if (delivers(board, head)) {
    const spot = grid[notes.length]
    out.push({ ...resultFor(frame, spot.x, spot.y, NOTE_H, cell), frame: frame.id })
  }
  return out
}

function columnsLayout(board: Board): Layout3 {
  const items: Note[] = [titleItem(board, 0, 0)]
  let x = 0

  for (const section of sectionsOfBoard(board)) {
    const cols = section.notes.length > 3 ? 2 : 1
    const block = framed(board, section, cols, x, 120)
    items.push(...block)
    x += block[0].w + 56
  }
  return { items, links: [] }
}

function mapLayout(board: Board): Layout3 {
  const sections = sectionsOfBoard(board)
  const count = Math.max(1, sections.length)
  const colsOf = (s: Section) => (s.notes.length > 2 ? 2 : 1)
  const sizes = sections.map(s => blockSize(board, s, colsOf(s)).size)
  // Whiteboard's ellipse, widened when a cluster is bigger than its sentence-sized sections.
  const reach = Math.max(0, ...sizes.map(s => Math.max(s.w, s.h)))
  const rx = Math.max(300 + count * 70, HUB_W / 2 + reach / 2 + 60)
  const ry = Math.max(220 + count * 40, HUB_H / 2 + reach / 2 + 40)
  const hub: Note = {
    id: 'hub', kind: 'hub', text: board.title, title: board.title, sticker: 'spark',
    w: HUB_W, h: HUB_H, x: rx + 140, y: ry + 150
  }
  const items: Note[] = [hub]
  const links: Edge[] = []

  sections.forEach((section, i) => {
    const angle = -Math.PI / 2 + (i / count) * Math.PI * 2
    const size = sizes[i]
    const cx = hub.x + hub.w / 2 + Math.cos(angle) * rx
    const cy = hub.y + hub.h / 2 + Math.sin(angle) * ry
    const block = framed(board, section, colsOf(section), cx - size.w / 2, cy - size.h / 2)
    items.push(...block)
    links.push({ id: `b:${block[0].id}`, from: hub.id, to: block[0].id, kind: 'branch' })
  })
  return { items, links }
}

/* ───────────────────────────────  arrows  ────────────────────────────────── */

export interface Arrow { id: string; parent: string; child: string; from: string; to: string }

/** The dependencies a phase does NOT already say: a milestone's children are its phase,
 *  milestones chain along the road, so an arrow is only drawn from a non-milestone parent. */
export function arrowsOf(tasks: Task[], items: Note[]): Arrow[] {
  const drawn = new Map<string, string>()
  for (const item of items) if (item.taskId && item.kind !== 'result' && !drawn.has(item.taskId)) drawn.set(item.taskId, item.id)
  const byId = index(tasks)
  const out: Arrow[] = []
  for (const child of tasks) {
    for (const parentId of child.parents ?? []) {
      const parent = byId.get(parentId)
      if (!parent || isMilestone(parent)) continue
      const from = drawn.get(parentId)
      const to = drawn.get(child.id)
      if (!from || !to) continue
      out.push({ id: `a:${parentId}>${child.id}`, parent: parentId, child: child.id, from, to })
    }
  }
  return out
}

/* ─────────────────────────────  the next stop  ───────────────────────────── */

export interface Next { phase: string; hand: string[]; pass: string | null; waiting: string[] }

/** A milestone is the gate INTO its phase: its children wait for it (that is what a kanban
 *  parent means). So a phase is open once its milestone is passed — and the loose cards,
 *  which wait for no milestone, always are. */
const isOpen = (section: Section) => section.phase.kind === 'loose' || section.head?.stage === 'done'

/** The cards « Hand to Hermes » can take: queued, behind an open gate. */
export function handable(board: Board): Set<string> {
  const out = new Set<string>()
  for (const section of sectionsOfBoard(board)) {
    if (!isOpen(section)) continue
    for (const note of section.notes) if (note.stage === 'queued' && !note.gated && note.taskId) out.add(note.taskId)
  }
  return out
}

/** What « Run the plan » does next. Walking the road: an open phase with queued cards hands
 *  them over; one still at work waits; a finished one lets the next gate be passed — always by
 *  a human, never by the dispatcher (the lane is not a profile). */
export function planNext(board: Board): Next | null {
  const sections = sectionsOfBoard(board)
  const milestones = sections.filter(s => s.phase.kind === 'milestone')
  const loose = sections.filter(s => s.phase.kind === 'loose')
  for (const section of [...milestones, ...loose]) {
    const { phase, head, notes } = section
    if (!isOpen(section)) {
      // The gate before this phase: passable once the phases before it are done.
      return { phase: phase.id, hand: [], pass: head?.taskId ?? null, waiting: [] }
    }
    const open = notes.filter(n => n.stage !== 'done')
    const hand = open.filter(n => n.stage === 'queued' && !n.gated).map(n => n.taskId as string)
    const waiting = open.filter(n => n.stage !== 'queued' || n.gated).map(n => n.taskId as string)
    if (hand.length || waiting.length) return { phase: phase.id, hand, pass: null, waiting }
  }
  return null
}

export function layoutBoard(board: Board): Layout3 {
  if (board.layout === 'columns') return columnsLayout(board)
  if (board.layout === 'map') return mapLayout(board)
  return routeLayout(board)
}

/* ────────────────────────────────  route  ───────────────────────────────── */

export interface Stop { phase: Phase; notes: Note[] }

export function planStops(board: Board): Stop[] {
  const open = (note: Note) => note.role !== 'milestone' && note.stage !== 'done'
  const stops: Stop[] = []

  for (const phase of board.phases) {
    const notes = board.items.filter(n => n.phase === phase.id && open(n))
    if (notes.length === 0 && phase.kind !== 'milestone') continue
    stops.push({ phase, notes })
  }
  return stops
}

export function stageCounts(board: Board): Record<Stage, number> {
  const counts: Record<Stage, number> = { queued: 0, running: 0, review: 0, blocked: 0, done: 0 }
  for (const note of board.items) {
    if (note.kind !== 'note' || !note.stage) continue
    counts[note.stage] += 1
  }
  return counts
}

/* ───────────────────────────────  export  ────────────────────────────────── */

export function boardMarkdown(board: Board): string {
  const lines = [`# ${board.title}`, '']
  for (const phase of board.phases) {
    lines.push(phase.kind === 'milestone' ? `## ◆ ${phase.label}` : `## ${phase.label}`)
    const notes = board.items.filter(i => i.phase === phase.id && i.kind === 'note')
    for (const note of notes) {
      lines.push(`- [${note.stage === 'done' ? 'x' : ' '}] ${note.text}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

export function boardTable(board: Board, header: string[] = ['Phase', 'Card', 'Status', 'Owner', 'Role']): string[][] {
  const rows: string[][] = [header]
  for (const phase of board.phases) {
    for (const note of board.items.filter(i => i.phase === phase.id && i.kind === 'note')) {
      rows.push([phase.label, note.text, note.stage ?? '', note.owner ?? '', note.role ?? ''])
    }
  }
  return rows
}

export function toDelimited(rows: (string | number)[][], delimiter = ','): string {
  const cell = (value: unknown) => {
    const text = String(value ?? '')
    return text.includes(delimiter) || text.includes('"') || text.includes('\n')
      ? `"${text.replace(/"/g, '""')}"`
      : text
  }
  return rows.map(row => row.map(cell).join(delimiter)).join('\n')
}

/* ───────────────────────────────  drag  ──────────────────────────────────── */

/** Positions the reader dragged, keyed by item id. Unknown ids and non-finite values are
 *  ignored: storage is untrusted (an older layout, a board since renamed). */
export function applyPositions(layout: Layout3, positions: Record<string, { x: number; y: number }>): Layout3 {
  const items = layout.items.map(item => {
    const spot = positions?.[item.id]
    if (!spot) return item
    const x = Number(spot.x)
    const y = Number(spot.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return item
    return { ...item, x: Math.round(x), y: Math.round(y) }
  })
  return { items, links: layout.links }
}

type Spot = { x: number; y: number }

/** Where the reader put things is a fact about ONE layout: a frame dragged on the map has
 *  no business moving the same cards on the route. Stored keys are `<layout>|<item id>`;
 *  bare keys (from before positions were per layout) are ignored. */
export function positionsFor(stored: Record<string, Spot> | null | undefined, layout: Layout): Record<string, Spot> {
  const prefix = `${layout}|`
  const out: Record<string, Spot> = {}
  for (const [key, spot] of Object.entries(stored || {})) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = spot
  }
  return out
}

export function withPosition(stored: Record<string, Spot> | null | undefined, layout: Layout, id: string, spot: Spot): Record<string, Spot> {
  return { ...(stored || {}), [`${layout}|${id}`]: { x: Math.round(spot.x), y: Math.round(spot.y) } }
}

/** « Tidy »: forget where the reader put things in ONE layout, keep the others. */
export function withoutLayout(stored: Record<string, Spot> | null | undefined, layout: Layout): Record<string, Spot> {
  const prefix = `${layout}|`
  const out: Record<string, Spot> = {}
  for (const [key, spot] of Object.entries(stored || {})) if (!key.startsWith(prefix)) out[key] = spot
  return out
}
