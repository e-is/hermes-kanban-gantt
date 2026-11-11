// Whiteboard mode — pure core specs.
//
// Ported from Adolanium/hermes-whiteboard `tests/board.test.mjs` (MIT), whose 30 tests
// pinned the geometry, the route planning and the no-overlap invariants of its canvas.
// The model changed (cards instead of free notes, a milestone lane instead of `delivered`),
// so the fixtures are rewritten; the invariants are the ones worth keeping.
//
// Plus the specs whiteboard never had: the role of a parent (milestone vs prerequisite),
// the badge projection, and the phase a card belongs to.

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MILESTONE_LANE, NOTE_H, NOTE_W,
  applyPositions, badgeFor, boardFromTasks, boardMarkdown, boundsOf, boardTable,
  frameSize, frameSlots, fitFrames, layoutBoard, overlaps, pathFractions, positionsFor, withPosition, phaseOf, phasesOf, planStops,
  rectOf, roleOf, stageCounts, stageOf, tiltOf, toDelimited, toneOf
} from '../src/core/whiteboard-core.ts'

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const task = (id, title, extra = {}) => ({
  id, title, status: 'todo', assignee: null, priority: 0,
  created_at: 1000, started_at: null, completed_at: null,
  children: [], parents: [], ...extra
})

// A board shaped like the one the mode is for: two milestones in a chain, work under each,
// one loose card with no milestone above it.
const TASKS = [
  task('m1', 'Kickoff', { assignee: MILESTONE_LANE, status: 'done', completed_at: 1100, children: ['t1', 't2', 'm2'] }),
  task('t1', 'Compare three suppliers', { status: 'done', parents: ['m1'], children: [], assignee: 'default' }),
  task('t2', 'Price the box', { status: 'running', parents: ['m1'], assignee: 'default' }),
  task('m2', 'Ship it', { assignee: MILESTONE_LANE, parents: ['m1'], children: ['t3'] }),
  task('t3', 'Pick the courier', { status: 'ready', parents: ['m2'], assignee: 'default' }),
  task('loose', 'Ask about permits', { status: 'blocked' })
]

/* ── status and role ──────────────────────────────────────────────────────── */

test('a card status maps to the four stages the canvas paints', () => {
  assert.equal(stageOf('triage'), 'queued')
  assert.equal(stageOf('todo'), 'queued')
  assert.equal(stageOf('scheduled'), 'queued')
  assert.equal(stageOf('ready'), 'queued')
  assert.equal(stageOf('running'), 'running')
  assert.equal(stageOf('review'), 'review')
  assert.equal(stageOf('blocked'), 'blocked')
  assert.equal(stageOf('done'), 'done')
  assert.equal(stageOf('archived'), 'done')
  assert.equal(stageOf('something-new'), 'queued')
})

test('the milestone lane wins over the graph, and a gating parent is a prerequisite', () => {
  const m = task('m', 'Kickoff', { assignee: MILESTONE_LANE, children: ['a'] })
  const p = task('p', 'Epic', { assignee: 'default', children: ['a'] })
  const leaf = task('l', 'Leaf')

  assert.equal(roleOf(m), 'milestone')
  assert.equal(roleOf(p), 'prerequisite')
  assert.equal(roleOf(leaf), 'task')
  // The lane is the decision: a milestone with no children is still a milestone.
  assert.equal(roleOf(task('m2', 'Gate', { assignee: MILESTONE_LANE })), 'milestone')
})

test('a badge is a projection: milestone, prerequisite, or nothing', () => {
  assert.deepEqual(badgeFor('milestone'), { label: '◆ Jalon', tone: 'orange' })
  assert.deepEqual(badgeFor('prerequisite'), { label: 'Prérequis', tone: 'neutral' })
  assert.equal(badgeFor('task'), null)
  // The board truncates labels past 24 characters — ours must never need that.
  assert.ok(badgeFor('milestone').label.length <= 24)
})

/* ── phases ───────────────────────────────────────────────────────────────── */

test('a card belongs to its NEAREST milestone ancestor', () => {
  const links = TASKS
  assert.equal(phaseOf('t3', links), 'm2')   // through m2, not straight to m1
  assert.equal(phaseOf('t1', links), 'm1')
  assert.equal(phaseOf('loose', links), null)
  assert.equal(phaseOf('m2', links), 'm1')   // a milestone is a card too: it sits in its parent's phase
})

test('phases run in milestone order, and the loose cards come last', () => {
  const phases = phasesOf(TASKS)

  assert.deepEqual(phases.map(p => p.id), ['m1', 'm2', 'loose'])
  assert.deepEqual(phases.map(p => p.kind), ['milestone', 'milestone', 'loose'])
  assert.deepEqual(phases[0].taskIds, ['t1', 't2'])
  assert.deepEqual(phases[1].taskIds, ['t3'])
  assert.deepEqual(phases[2].taskIds, ['loose'])
  assert.equal(phases[0].label, 'Kickoff')
})

test('a board with no milestone at all is one loose phase', () => {
  const phases = phasesOf([task('a', 'A'), task('b', 'B')])

  assert.equal(phases.length, 1)
  assert.equal(phases[0].kind, 'loose')
  assert.deepEqual(phases[0].taskIds, ['a', 'b'])
})

/* ── board model ──────────────────────────────────────────────────────────── */

test('the model keeps one note per card, with the card id on it', () => {
  const board = boardFromTasks(TASKS, { title: 'Spring bake sale' })
  const notes = board.items.filter(item => item.kind === 'note')

  assert.equal(notes.length, TASKS.length)
  assert.deepEqual(notes.map(n => n.taskId).sort(), TASKS.map(t => t.id).sort())
  assert.equal(new Set(board.items.map(i => i.id)).size, board.items.length, 'item ids are unique')
  assert.equal(board.title, 'Spring bake sale')
  assert.equal(notes.find(n => n.taskId === 'm1').role, 'milestone')
  assert.equal(notes.find(n => n.taskId === 't1').role, 'task')
})

test('a board caps its cards, and says how many it dropped', () => {
  const many = Array.from({ length: 20 }, (_, i) => task(`t${i}`, `Task ${i}`))
  const board = boardFromTasks(many, { max: 5 })

  assert.equal(board.items.filter(i => i.kind === 'note').length, 5)
  assert.equal(board.dropped, 15)
})

/* ── layouts ──────────────────────────────────────────────────────────────── */
//
// The geometry is whiteboard's own `layoutSpec` (route on a sine road, columns of frames, a
// map on an ellipse around a hub), so the mode LOOKS like whiteboard. A section is a phase;
// the milestone card is that section's stop (route) or its frame (columns, map) — it is
// drawn once, as the thing that holds its phase, never as a note inside it.

const noOverlap = (items) => {
  const boxes = items.filter(i => i.kind === 'note' || i.kind === 'waypoint')
  for (let a = 0; a < boxes.length; a += 1) {
    for (let b = a + 1; b < boxes.length; b += 1) {
      assert.equal(overlaps(boxes[a], boxes[b]), false, `${boxes[a].id} overlaps ${boxes[b].id}`)
    }
  }
}

const drawnCards = items => items.filter(i => i.taskId).map(i => i.taskId).sort()

test('a route lays one stop per phase along a road without overlapping cards', () => {
  const board = boardFromTasks(TASKS, { layout: 'route', title: 'Spring bake sale' })
  const { items, links } = layoutBoard(board)
  const stops = items.filter(i => i.kind === 'waypoint')
  const notes = items.filter(i => i.kind === 'note')

  assert.equal(stops.length, 3, 'two milestones and the loose cards')
  assert.equal(links.length, 2)
  assert.ok(links.every(l => l.kind === 'route'))
  assert.deepEqual(links.map(l => [l.from, l.to]), [[stops[0].id, stops[1].id], [stops[1].id, stops[2].id]])
  assert.deepEqual(stops.map(s => s.step), [1, 2, 3])
  assert.ok(notes.every(note => stops.some(stop => stop.id === note.frame)), 'every note hangs off a stop')
  // The title is whiteboard's display line, above the road.
  assert.equal(items[0].kind, 'text')
  assert.equal(items[0].text, 'Spring bake sale')
  assert.ok(items[0].y < Math.min(...items.slice(1).map(i => i.y)))
  // Stops alternate sides of the road, as on whiteboard.
  assert.deepEqual(stops.map(s => s.side), ['above', 'below', 'above'])
  noOverlap(items)
  assert.ok(stops[0].x < stops[1].x && stops[1].x < stops[2].x)
})

test('the milestone card IS its stop: drawn once, done when the card is done', () => {
  const { items } = layoutBoard(boardFromTasks(TASKS, { layout: 'route' }))
  const stops = items.filter(i => i.kind === 'waypoint')

  assert.equal(stops[0].taskId, 'm1')
  assert.equal(stops[0].done, true)
  assert.equal(stops[1].taskId, 'm2')
  assert.equal(stops[1].done, false)
  assert.equal(stops[2].taskId, undefined, 'the loose stop is no card')
  assert.equal(stops[0].title, 'Kickoff')
  assert.deepEqual(drawnCards(items), TASKS.map(t => t.id).sort(), 'every card is drawn exactly once')
})

test('notes have whiteboard\'s size and a paper tone per stage', () => {
  const { items } = layoutBoard(boardFromTasks(TASKS, { layout: 'route' }))
  const note = id => items.find(i => i.taskId === id)

  for (const n of items.filter(i => i.kind === 'note')) assert.deepEqual([n.w, n.h], [NOTE_W, NOTE_H])
  assert.deepEqual([NOTE_W, NOTE_H], [196, 112])
  assert.equal(note('t1').tone, 'mint')     // done
  assert.equal(note('t2').tone, 'sky')      // running
  assert.equal(note('t3').tone, 'butter')   // ready
  assert.equal(note('loose').tone, 'peach') // blocked
  assert.equal(toneOf('review'), 'lilac')
})

test('columns put each phase in its own frame, left to right, each note inside', () => {
  const { items } = layoutBoard(boardFromTasks(TASKS, { layout: 'columns', title: 'Spring bake sale' }))
  const frames = items.filter(i => i.kind === 'frame')

  assert.equal(frames.length, 3)
  assert.ok(frames[0].x + frames[0].w < frames[1].x && frames[1].x + frames[1].w < frames[2].x)
  assert.equal(frames[0].taskId, 'm1', 'a milestone phase is framed by its card')
  for (const note of items.filter(i => i.kind === 'note')) {
    const frame = frames.find(f => f.id === note.frame)
    assert.ok(frame, `${note.id} has no frame`)
    const c = { x: note.x + note.w / 2, y: note.y + note.h / 2 }
    assert.ok(c.x >= frame.x && c.x <= frame.x + frame.w && c.y >= frame.y && c.y <= frame.y + frame.h, `${note.id} leaves its frame`)
  }
  // Wide enough for the title in the display face (whiteboard's rule).
  for (const f of frames) assert.ok(f.w >= 78 + f.title.length * 10.5 - 1)
  assert.equal(items[0].kind, 'text')
  assert.deepEqual(drawnCards(items), TASKS.map(t => t.id).sort())
  noOverlap(items)
})

test('a map grows around a hub that is the board, with one branch per phase', () => {
  const { items, links } = layoutBoard(boardFromTasks(TASKS, { layout: 'map', title: 'Spring bake sale' }))
  const hub = items.find(i => i.kind === 'hub')

  assert.equal(hub.title, 'Spring bake sale')
  assert.equal(links.length, 3)
  assert.ok(links.every(l => l.kind === 'branch' && l.from === hub.id))
  assert.equal(items.some(i => i.kind === 'text'), false, 'the hub replaces the title')
  for (const frame of items.filter(i => i.kind === 'frame')) assert.equal(overlaps(frame, hub), false)
  noOverlap(items)
})

test('a phase with many cards still never overlaps its neighbours', () => {
  const many = [
    task('m', 'Gate', { assignee: MILESTONE_LANE, children: Array.from({ length: 9 }, (_, i) => `a${i}`) }),
    ...Array.from({ length: 9 }, (_, i) => task(`a${i}`, `Card ${i}`, { parents: ['m'] })),
    task('n', 'Next', { assignee: MILESTONE_LANE, parents: ['m'], children: ['z'] }),
    task('z', 'Last', { parents: ['n'] })
  ]
  for (const layout of ['route', 'columns', 'map']) noOverlap(layoutBoard(boardFromTasks(many, { layout })).items)
})

test('a layout is deterministic — the same board twice is the same picture', () => {
  const a = layoutBoard(boardFromTasks(TASKS, { layout: 'route' }))
  const b = layoutBoard(boardFromTasks(TASKS, { layout: 'route' }))

  assert.deepEqual(a, b)
})

test('the road knows how far along each stop sits', () => {
  assert.deepEqual(pathFractions([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 300 }]), [0, 0.25, 1])
  assert.deepEqual(pathFractions([{ x: 5, y: 5 }]), [0])
})

test('a note keeps a small, steady tilt', () => {
  assert.equal(tiltOf('t_abc'), tiltOf('t_abc'))
  for (const id of ['a', 'b', 't_0cf09efb', 'zz']) assert.ok(Math.abs(tiltOf(id)) <= 1.2)
})

/* ── route planning ───────────────────────────────────────────────────────── */

test('a run visits phases in order, open work only, loose cards last', () => {
  const board = boardFromTasks(TASKS, { layout: 'route' })
  const stops = planStops(board)

  assert.deepEqual(stops.map(s => s.phase.id), ['m1', 'm2', 'loose'])
  assert.deepEqual(stops.map(s => s.notes.length), [1, 1, 1])
  assert.equal(stops[0].notes[0].taskId, 't2')     // t1 is done
  assert.equal(stops.every(s => s.notes.every(n => n.role !== 'milestone')), true)
})

test('a phase with nothing open is skipped; a milestone phase is never skipped', () => {
  const board = boardFromTasks([
    task('m', 'Gate', { assignee: MILESTONE_LANE, status: 'ready', children: ['done1'] }),
    task('done1', 'Finished', { status: 'done', parents: ['m'] })
  ], { layout: 'route' })
  const stops = planStops(board)

  assert.equal(stops.length, 1)
  assert.equal(stops[0].phase.id, 'm')
  assert.equal(stops[0].notes.length, 0)
})

test('the stage counts add up to the cards on the board', () => {
  const board = boardFromTasks(TASKS)
  const counts = stageCounts(board)

  assert.deepEqual(counts, { queued: 2, running: 1, review: 0, blocked: 1, done: 2 })
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), board.items.filter(i => i.kind === 'note').length)
})

/* ── geometry ─────────────────────────────────────────────────────────────── */

test('rectangles know when they overlap and when they only touch', () => {
  const a = { x: 0, y: 0, w: 100, h: 50 }
  const b = { x: 100, y: 0, w: 100, h: 50 }

  assert.equal(overlaps(a, b), false, 'touching edges do not overlap')
  assert.equal(overlaps(a, { x: 99, y: 10, w: 10, h: 10 }), true)
  assert.deepEqual(rectOf({ x: 5, y: 6, w: 7, h: 8 }), { x: 5, y: 6, w: 7, h: 8 })
})

test('bounds and frame fitting wrap every item, and never shrink', () => {
  const items = [
    { id: 'a', kind: 'note', x: 10, y: 20, w: 100, h: 50 },
    { id: 'b', kind: 'note', x: 200, y: 100, w: 100, h: 50 }
  ]
  assert.deepEqual(boundsOf(items), { x: 10, y: 20, w: 290, h: 130 })

  const frame = { id: 'f', kind: 'frame', x: 0, y: 0, w: 50, h: 50, text: 'F' }
  const fitted = fitFrames([...items, frame])
  const f = fitted.find(i => i.id === 'f')
  assert.ok(f.w > 50 && f.h > 50)
  assert.ok(f.x <= 10 && f.y <= 20)
})

test('frame slots are whiteboard\'s grid under the title, and the frame fits them', () => {
  const frame = { x: 0, y: 0 }
  const slots = frameSlots(frame, 5, 2)
  const size = frameSize(5, 2, 'Kickoff')

  assert.equal(slots.length, 5)
  assert.deepEqual(slots[0], { x: 22, y: 64 })
  assert.deepEqual(slots[1], { x: 22 + NOTE_W + 22, y: 64 })
  for (let i = 0; i < slots.length; i += 1) {
    for (let j = i + 1; j < slots.length; j += 1) {
      assert.equal(overlaps({ ...slots[i], w: NOTE_W, h: NOTE_H }, { ...slots[j], w: NOTE_W, h: NOTE_H }), false)
    }
    assert.ok(slots[i].x + NOTE_W <= size.w && slots[i].y + NOTE_H <= size.h)
  }
})

/* ── positions, export, table ─────────────────────────────────────────────── */

test('a drag overrides a position, ignores unknown ids and garbage', () => {
  const board = boardFromTasks(TASKS, { layout: 'route' })
  const before = layoutBoard(board)
  const id = before.items.find(i => i.kind === 'note').id

  const moved = applyPositions(before, { [id]: { x: 12, y: 34 }, ghost: { x: 1, y: 2 }, bad: { x: 'x', y: null } })
  const note = moved.items.find(i => i.id === id)

  assert.deepEqual({ x: note.x, y: note.y }, { x: 12, y: 34 })
  assert.equal(moved.items.length, before.items.length)
  assert.deepEqual(moved.items.filter(i => i.id !== id), before.items.filter(i => i.id !== id))
})

test('a drag belongs to the layout it was made in', () => {
  let stored = {}
  stored = withPosition(stored, 'map', 'n:t1', { x: 10, y: 20 })
  stored = withPosition(stored, 'route', 'n:t1', { x: 1, y: 2 })

  assert.deepEqual(positionsFor(stored, 'map'), { 'n:t1': { x: 10, y: 20 } })
  assert.deepEqual(positionsFor(stored, 'route'), { 'n:t1': { x: 1, y: 2 } })
  assert.deepEqual(positionsFor(stored, 'columns'), {})
  // Keys from before positions were per layout are ignored, not applied to every layout.
  assert.deepEqual(positionsFor({ 'n:t1': { x: 5, y: 5 } }, 'route'), {})
  assert.deepEqual(positionsFor(null, 'route'), {})
})

test('Markdown follows the road and marks milestones and finished cards', () => {
  const board = boardFromTasks(TASKS, { layout: 'route', title: 'Spring bake sale' })
  const md = boardMarkdown(board)

  assert.match(md, /^# Spring bake sale/)
  assert.match(md, /## ◆ Kickoff/)
  assert.ok(md.indexOf('## ◆ Kickoff') < md.indexOf('## ◆ Ship it'))
  assert.match(md, /- \[x\] Compare three suppliers/)
  assert.match(md, /- \[ \] Pick the courier/)
  assert.match(md, /## Sans jalon/)
})

test('a CSV quotes what needs quoting and keeps reading order', () => {
  const board = boardFromTasks([
    task('a', 'Lock the flavour'),
    task('b', 'Ask, then "price" it')
  ], { title: 'Bake sale' })
  const table = boardTable(board)

  assert.equal(table[0][0], 'Phase')
  assert.match(toDelimited(table, ','), /"Ask, then ""price"" it"/)
})

/* ── sizing constants are exported for the view ───────────────────────────── */
