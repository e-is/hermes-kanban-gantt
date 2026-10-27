/**
 * Unit tests for the PURE Gantt logic (src/core/gantt-core.ts).
 *
 * The core is imported from the built artifact (desktop/gantt-core.js,
 * produced by `npm run build` from src/core/gantt-core.ts) — the tested code
 * is exactly the shipped code (no copy drift).
 *
 * Run: node --test tests/gantt-core.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
// import() (dynamic) so this file also runs when the artifact was built with
// ESM export statements.
const core = await import(join(HERE, '..', 'desktop', 'gantt-core.js'))

const { barRange, taskBars, shortId, matchesSearch, buildRows, treeRows, treeMarks, TREE_SLOT, TREE_AXIS, TREE_INSET,
  computeDomain, ticks, tickUnit, statusTone, DAY, MIN_BAR,
  statusIcon, isTerminal, descendantsOf, isDescendant, relationsOf, dropCandidates,
  resolveBoardSlug, isMissingBoardError } = core
const NOW = 1_800_000_000
const H = 3600

// ── barRange: minimal duration ───────────────────────────────────────────────

test('done bar without a real run is a done-instant minimal bar', () => {
  const b = barRange({ status: 'done', created_at: 1000, started_at: 1000, completed_at: 1000 }, NOW)
  assert.equal(b.kind, 'done-instant')
  assert.equal(b.t1 - b.t0, MIN_BAR)
})

test('done with a REAL run uses the run window (not created/completed)', () => {
  const t0 = NOW - 5 * 3600, t1 = NOW - 2 * 3600
  const b = barRange({ status: 'done', created_at: NOW - 9 * DAY, run_started_at: t0, run_ended_at: t1, completed_at: t1 }, NOW)
  assert.equal(b.kind, 'done')
  assert.equal(b.t0, t0)
  assert.equal(b.t1, t1)
})

test('archived with a real run draws the run window', () => {
  const t0 = NOW - 6 * 3600, t1 = NOW - 4 * 3600
  const b = barRange({ archived: true, status: 'archived', created_at: 5000, run_started_at: t0, run_ended_at: t1, completed_at: t1 }, NOW)
  assert.equal(b.kind, 'done')
  assert.equal(b.t0, t0)
})

test('progress bar runs from real claim start to now', () => {
  const t0 = NOW - 5 * DAY
  const b = barRange({ status: 'running', created_at: t0, run_started_at: t0 }, NOW)
  assert.equal(b.t1, NOW)
  assert.equal(b.kind, 'progress')
})

test('running without claim runs from created_at to now (visible at current time)', () => {
  const b = barRange({ status: 'running', created_at: NOW - 100 }, NOW)
  assert.equal(b.t0, NOW - 100)
  assert.equal(b.t1, NOW - 100 + MIN_BAR) // Math.max(start + MIN_BAR, NOW) -> NOW - 100 + MIN_BAR
})

test('running started days ago extends to now', () => {
  const t0 = NOW - 3 * DAY
  const b = barRange({ status: 'running', created_at: t0 - 10 * DAY, started_at: t0 }, NOW)
  assert.equal(b.t0, t0)
  assert.equal(b.t1, NOW)
  assert.equal(b.kind, 'progress')
})

test('non-started task gets a minimal bar at creation (no invisible dot)', () => {
  const b = barRange({ status: 'ready', created_at: NOW - 100 }, NOW)
  assert.equal(b.t0, NOW - 100)
  assert.equal(b.t1, NOW - 100 + MIN_BAR)
})

test('custom minBarSec is honored', () => {
  const b = barRange({ status: 'done', created_at: 1000, completed_at: 1000 }, NOW, 30)
  assert.equal(b.t1 - b.t0, 30)
})

test('task without timestamps draws nothing', () => {
  assert.equal(barRange({ status: 'ready' }, NOW), null)
})

test('shortId strips t_ prefix and slices to 6 chars', () => {
  assert.equal(shortId('t_8d0f029e'), '8d0f02')
  assert.equal(shortId('t_abc12345'), 'abc123')
  assert.equal(shortId('8d0f029e'), '8d0f02')
  assert.equal(shortId(''), '')
  assert.equal(shortId(null), '')
})

test('taskBars returns single bar when no multiple runs', () => {
  const t = { status: 'running', created_at: NOW - 3600, started_at: NOW - 3600 }
  const bars = taskBars(t, NOW)
  assert.equal(bars.length, 1)
  assert.equal(bars[0].kind, 'progress')
})

test('taskBars returns distinct bars for multiple successive runs', () => {
  const t = {
    id: 't_multi',
    status: 'running',
    runs: [
      { id: 1, profile: 'junior', started_at: NOW - 5 * DAY, ended_at: NOW - 5 * DAY + 2 * H, outcome: 'blocked' },
      { id: 2, profile: 'senior', started_at: NOW - 2 * DAY, ended_at: NOW - 2 * DAY + 4 * H, outcome: 'completed' },
      { id: 3, profile: 'senior', started_at: NOW - 3 * H, ended_at: null, status: 'running' }
    ]
  }
  const bars = taskBars(t, NOW)
  assert.equal(bars.length, 3)
  assert.equal(bars[0].kind, 'done')
  assert.equal(bars[0].outcome, 'blocked')
  assert.equal(bars[1].kind, 'done')
  assert.equal(bars[1].outcome, 'completed')
  assert.equal(bars[2].kind, 'progress')
  assert.equal(bars[2].t1, NOW)
})

// ── blocked tasks: failed run bars + dashed waiting bar ───────────────────────

test('blocked with failed runs: solid run bars then dashed wait to now', () => {
  const t = {
    id: 't_blk',
    status: 'blocked',
    created_at: NOW - 6 * DAY,
    runs: [
      { id: 1, profile: 'w', started_at: NOW - 5 * DAY, ended_at: NOW - 5 * DAY + 2 * H, outcome: 'failed' },
      { id: 2, profile: 'w', started_at: NOW - 2 * DAY, ended_at: NOW - 2 * DAY + 1 * H, outcome: 'timed_out' }
    ]
  }
  const bars = taskBars(t, NOW)
  const { FAIL_TONE, RUN_TONE } = core
  assert.equal(bars.length, 3)
  assert.equal(bars[0].kind, 'done')
  // The run that FAILED keeps the failure tone even though the task is blocked:
  // the bar reports what happened in that window, not the task's current status.
  assert.equal(bars[0].tone, FAIL_TONE)
  assert.equal(bars[1].kind, 'done')
  // ...and one that merely timed out is ordinary progress, not a failure.
  assert.equal(bars[1].tone, RUN_TONE)
  // run ended after 1h but the min-bar floor (2h) extends it
  assert.equal(bars[1].t1, NOW - 2 * DAY + 2 * H)
  // waiting bar starts at the LAST run bar end and extends to now
  assert.equal(bars[2].kind, 'blocked-wait')
  assert.equal(bars[2].t0, NOW - 2 * DAY + 2 * H)
  assert.equal(bars[2].t1, NOW)
  assert.equal(bars[2].tone, statusTone('blocked'))
})

test('blocked with a single run: wait bar starts at that run end', () => {
  const t = {
    id: 't_blk1',
    status: 'blocked',
    created_at: NOW - 4 * DAY,
    runs: [{ id: 1, started_at: NOW - 3 * DAY, ended_at: NOW - 3 * DAY + 30 * 60, outcome: 'failed' }]
  }
  const bars = taskBars(t, NOW)
  assert.equal(bars.length, 2)
  assert.equal(bars[0].kind, 'done')
  assert.equal(bars[1].kind, 'blocked-wait')
  // 30min run extended by the min-bar floor (2h); wait starts there
  assert.equal(bars[1].t0, NOW - 3 * DAY + 2 * H)
  assert.equal(bars[1].t1, NOW)
})

test('blocked without runs: single dashed bar from creation to now', () => {
  const t = { id: 't_blk0', status: 'blocked', created_at: NOW - 30 * H }
  const bars = taskBars(t, NOW)
  assert.equal(bars.length, 1)
  assert.equal(bars[0].kind, 'blocked-wait')
  assert.equal(bars[0].t0, NOW - 30 * H)
  assert.equal(bars[0].t1, NOW)
})

// ── search filter ─────────────────────────────────────────────────────────────

test('search matches label', () => {
  assert.equal(matchesSearch({ label: 'OBSFISH #1952', title: 'some task' }, '1952'), true)
})

test('search matches title text', () => {
  assert.equal(matchesSearch({ label: 'X', title: 'Fix the login page' }, 'login'), true)
})

test('search is case-insensitive and trimmed', () => {
  assert.equal(matchesSearch({ label: 'Mention', title: 'x' }, '  MeNtIoN '), true)
})

test('empty query matches everything; non-matching text excluded', () => {
  assert.equal(matchesSearch({ label: 'a', title: 'b' }, ''), true)
  assert.equal(matchesSearch({ label: 'a', title: 'b' }, 'zzz'), false)
})

// ── tree building ─────────────────────────────────────────────────────────────
test('buildRows covers every task with diamond sharing owned once', () => {
  const tasks = [
    { id: 'r', children: ['c1', 'c2'], parents: [] },
    { id: 'c1', children: ['d'], parents: ['r'] },
    { id: 'c2', children: ['d'], parents: ['r'] },
    { id: 'd', children: [], parents: ['c1', 'c2'] }
  ]
  const rows = buildRows(tasks)
  assert.equal(rows.length, 4)
  const depths = Object.fromEntries(rows.map(r => [r.task.id, r.depth]))
  assert.equal(depths.r, 0)
  assert.equal(depths.c1, 1)
  assert.equal(depths.d, 2)
  assert.ok(rows.find(r => r.task.id === 'c1').isChild)
})

test('buildRows falls back for cycle-only graphs', () => {
  const rows = buildRows([
    { id: 'a', children: ['b'], parents: ['b'] },
    { id: 'b', children: ['a'], parents: ['a'] }
  ])
  assert.equal(rows.length, 2)
})

// ── domain ─────────────────────────────────────────────────────────────────────

test('computeDomain extends to now for unfinished tasks and pads for min bars', () => {
  const t0 = NOW - 3 * DAY
  const dom = computeDomain([{ created_at: t0, status: 'running' }], MIN_BAR)
  assert.ok(dom.max >= Date.now() / 1000)
  assert.equal(dom.max - dom.min >= MIN_BAR, true)
})

test('computeDomain ensures at least 7 days domain', () => {
  const t = { status: 'done', created_at: 10_000, started_at: 10_000, completed_at: 20_000 }
  const dom = computeDomain([t], MIN_BAR)
  assert.ok(dom.max - dom.min >= 7 * DAY)
})

test('computeDomain fallback for empty task list produces 7 days domain', () => {
  const dom = computeDomain([], MIN_BAR)
  assert.ok(dom.max - dom.min >= 7 * DAY)
})

test('computeDomain pads the right edge so end-of-domain bars are visible', () => {
  const t = { status: 'done', created_at: 10_000, started_at: 10_000, completed_at: 2000 }
  const dom = computeDomain([t], MIN_BAR)
  assert.ok(dom.max >= t.completed_at + MIN_BAR)
})

// ── ruler ──────────────────────────────────────────────────────────────────────

test('tickUnit selects day/week/month by span', () => {
  assert.equal(tickUnit(30 * DAY), 'day')
  assert.equal(tickUnit(200 * DAY), 'week')
  assert.equal(tickUnit(800 * DAY), 'month')
})

test('ticks cover the domain', () => {
  const ts = ticks(0, 10 * DAY, 'day')
  assert.ok(ts.length >= 10 && ts[0] <= 0 && ts[ts.length - 1] >= 10 * DAY - DAY)
})

// ── status icons ───────────────────────────────────────────────────────────────

test('statusIcon maps every status and falls back for unknown ones', () => {
  assert.equal(statusIcon('blocked'), 'warning')
  assert.equal(statusIcon('done'), 'check')
  assert.equal(statusIcon('running'), 'pulse')
  assert.equal(statusIcon('nonsense'), 'circle-large-outline')
  assert.equal(statusIcon(undefined), 'circle-large-outline')
})

test('isTerminal only accepts done and archived', () => {
  assert.equal(isTerminal('done'), true)
  assert.equal(isTerminal('archived'), true)
  assert.equal(isTerminal('review'), false)
  assert.equal(isTerminal(undefined), false)
})

// ── hierarchy (re-parenting) ───────────────────────────────────────────────────

// a -> b -> c, plus a  d  that dangles
const GRAPH = [
  { id: 'a', title: 'A', status: 'todo', board: 'one', children: ['b'], parents: [] },
  { id: 'b', title: 'B', status: 'todo', board: 'one', children: ['c'], parents: ['a'] },
  { id: 'c', title: 'C', status: 'todo', board: 'one', children: [], parents: ['b'] },
  { id: 'd', title: 'D', status: 'todo', board: 'two', children: [], parents: [] },
  { id: 'e', title: 'E', status: 'done', board: 'one', children: [], parents: [] }
]

test('descendantsOf walks the whole subtree, excluding the root', () => {
  const below = descendantsOf(GRAPH, 'a')
  assert.deepEqual([...below].sort(), ['b', 'c'])
  assert.equal(below.has('a'), false)
  assert.equal(descendantsOf(GRAPH, 'c').size, 0)
  // a cycle already in the data must not loop forever
  const cyclic = [
    { id: 'x', children: ['y'] },
    { id: 'y', children: ['x'] }
  ]
  assert.equal(descendantsOf(cyclic, 'x').size, 2)
})

test('isDescendant is the cycle guard the drop target uses', () => {
  assert.equal(isDescendant(GRAPH, 'a', 'c'), true)
  assert.equal(isDescendant(GRAPH, 'c', 'a'), false)
  assert.equal(isDescendant(GRAPH, 'a', 'a'), false)
})

test('relationsOf returns full parent and child records', () => {
  const rel = relationsOf(GRAPH, 'b')
  assert.deepEqual(rel.parents.map(t => t.id), ['a'])
  assert.deepEqual(rel.children.map(t => t.id), ['c'])
  assert.deepEqual(relationsOf(GRAPH, 'missing'), { parents: [], children: [] })
})

test('dropCandidates refuses self, descendants, other boards and linked targets', () => {
  const cands = dropCandidates([
    ...GRAPH,
    { id: 'f', title: 'F', status: 'todo', board: 'one', children: [], parents: [] }
  ], 'b', 'one')
  const byId = Object.fromEntries(cands.map(c => [c.task.id, c]))

  assert.equal(byId.b.allowed, false)
  assert.equal(byId.b.reason, 'self')
  assert.equal(byId.c.reason, 'descendant')
  assert.equal(byId.a.reason, 'linked')       // already b's parent -> no-op
  assert.equal(byId.d.reason, 'other-board')
  // A FINISHED task is a valid parent — the domain gates the child only when the
  // parent is not yet terminal, so `done` is the prerequisite-satisfied case.
  assert.equal(byId.e.allowed, true)
  assert.equal(byId.e.reason, null)
  assert.equal(byId.f.allowed, true)
  assert.equal(byId.f.reason, null)
})

test('dropCandidates keeps the board check optional', () => {
  // Single-board view: no boardSlug, so a foreign task is offered unless another
  // rule refuses it.
  const byId = Object.fromEntries(
    dropCandidates(GRAPH, 'b', undefined).map(c => [c.task.id, c]))
  assert.equal(byId.d.allowed, true)
})

// ── the remembered board (the `obsfish` stranding) ──────────────────────────

test('a remembered board this gateway does not have falls back to the current one', () => {
  // Chosen while the remote gateway was active, then the app switched to This
  // device, which never had it: every poll used to answer 503 and the page blamed
  // the backend.
  const r = resolveBoardSlug('obsfish', ['gantt-demo', 'obsventes'], 'gantt-demo')
  assert.equal(r.fallback, true)
  assert.equal(r.slug, '')            // '' = the gateway's current board
  assert.equal(r.suggested, 'gantt-demo')
})

test('a remembered board the gateway lists is kept', () => {
  const r = resolveBoardSlug('obsventes', ['gantt-demo', 'obsventes'], 'gantt-demo')
  assert.equal(r.fallback, false)
  assert.equal(r.slug, 'obsventes')
})

test('nothing remembered adopts the gateway current board', () => {
  const r = resolveBoardSlug('', ['gantt-demo', 'obsventes'], 'obsventes')
  assert.equal(r.fallback, false)
  assert.equal(r.suggested, 'obsventes')
})

test('a current board that is itself missing falls back to a board the gateway has', () => {
  // The real case on This device: /boards reported current='default' while the
  // gateway only had named boards, so following `current` kept the 503 alive.
  const r = resolveBoardSlug('obsfish', ['gantt-demo', 'obsventes'], 'default')
  assert.equal(r.suggested, 'gantt-demo')
})

test('switcher filters are not validated as boards', () => {
  assert.equal(resolveBoardSlug('all', ['gantt-demo'], 'gantt-demo').fallback, false)
  assert.equal(resolveBoardSlug('*', ['gantt-demo'], 'gantt-demo').fallback, false)
})

test('with no board list yet the page is left alone', () => {
  const r = resolveBoardSlug('obsfish', [], '')
  assert.equal(r.fallback, false)
  assert.equal(r.slug, 'obsfish')
  assert.equal(r.suggested, '')
})

test('a board-specific failure is told apart from a dead backend', () => {
  // Verbatim messages from the desktop log and the plugin's own API.
  assert.equal(isMissingBoardError(
    `GET /gantt → HTTP 503: {"detail":"board 'obsfish' database not found at /home/b/.hermes/kanban/boards/obsfish/kanban.db"}`), true)
  assert.equal(isMissingBoardError(
    `404: {"detail":"board 'gantt-demo' does not exist"}`), true)
  assert.equal(isMissingBoardError(
    `404: {"detail":"board 'default' resolved to /home/agent/.hermes/kanban.db — that is not this board's own database, so it is refused (HERMES_KANBAN_DB pinning?)"}`), true)
  assert.equal(isMissingBoardError(new Error('backend not ready')), false)
  assert.equal(isMissingBoardError(new Error('GET /boards → HTTP 500')), false)
  assert.equal(isMissingBoardError(undefined), false)
})

// ── treeRows: the explorer grammar (fold state, connectors, halo) ─────────────
//
// a -> {b -> c, e, f}, and f ALSO under g (the multi-parent case). `a` is f's
// primary parent (it is walked first), `g` is the secondary one.

const TREE = [
  { id: 'a', title: 'A', status: 'todo', children: ['b', 'e', 'f'], parents: [] },
  { id: 'b', title: 'B', status: 'todo', children: ['c'], parents: ['a'] },
  { id: 'c', title: 'C', status: 'todo', children: [], parents: ['b'] },
  { id: 'e', title: 'E', status: 'todo', children: [], parents: ['a'] },
  { id: 'f', title: 'F', status: 'todo', children: [], parents: ['a', 'g'] },
  { id: 'g', title: 'G', status: 'todo', children: ['f'], parents: [] }
]
const ids = rows => rows.map(r => r.task.id)
const byId = rows => Object.fromEntries(rows.map(r => [r.task.id, r]))

test('treeRows keeps the flat projection when nothing is folded', () => {
  assert.deepEqual(ids(treeRows(TREE)), ['a', 'b', 'c', 'e', 'f', 'g'])
  assert.deepEqual(ids(buildRows(TREE)), ['a', 'b', 'c', 'e', 'f', 'g'])
})

test('a collapsed parent hides its whole subtree, not just the first level', () => {
  // a is folded, so b/c/e are hidden. f is NOT hidden: its other parent (g) is
  // still open, and the tree must not lose a task because its first parent is
  // closed — so f stays visible through g.
  const rows = treeRows(TREE, { fold: new Map([['a', true]]) })
  assert.deepEqual(ids(rows), ['a', 'g', 'f'])
  const by = byId(rows)
  assert.equal(by.a.collapsed, true)
  assert.equal(by.a.hasChildren, true)
  assert.equal(by.a.hiddenCount, 3)              // b, c and e — not f, which shows
  assert.equal(by.b, undefined)                  // the folded branch is gone
})

test('a task only reachable through a later parent shows that parent folded', () => {
  // g's only child (f) is already printed under a: g starts COLLAPSED, so the
  // link is visible without printing f twice.
  const rows = treeRows(TREE)
  assert.equal(byId(rows).g.collapsed, true)
  assert.equal(byId(rows).g.secondaryOnly, true)
  // f is printed under a, so nothing is actually hidden here — the count follows
  // what the user cannot see, not the raw subtree size.
  assert.equal(byId(rows).g.hiddenCount, 0)
  assert.equal(rows.filter(r => r.task.id === 'f').length, 1)

  // …and opening it prints f a SECOND time, flagged, without its subtree.
  const open = treeRows(TREE, { fold: new Map([['g', false]]) })
  const fs = open.filter(r => r.task.id === 'f')
  assert.equal(fs.length, 2)
  assert.equal(fs[1].secondary, true)
  assert.equal(fs[1].depth, 1)
})

test('continuation describes the ANCESTOR level, and lastSibling the row', () => {
  const r = byId(treeRows(TREE))
  // Level 0 is the top level: it is not a sibling group, so it never guides.
  assert.deepEqual(r.b.continuation, [false])
  assert.deepEqual(r.e.continuation, [false])
  // Level 1 is b's own level: b IS followed by e, so the guide appears there.
  assert.deepEqual(r.c.continuation, [false, true])
  assert.equal(r.b.lastSibling, false)
  assert.equal(r.e.lastSibling, false)
  assert.equal(r.f.lastSibling, true)            // f is a's last child
  assert.deepEqual(r.a.continuation, [])         // a root draws no guide
})

test('a lone child of a root draws only its elbow, no leading guide', () => {
  // The reported defect: "| |_" instead of "|_". A parent with a single visible
  // child must not prefix it with a vertical — there is no sibling to continue.
  const LONE = [
    { id: 'p', title: 'P', status: 'todo', children: ['c'], parents: [] },
    { id: 'c', title: 'C', status: 'todo', children: [], parents: ['p'] }
  ]
  const only = treeRows(LONE)
  assert.equal(only.length, 2)
  assert.equal(only[1].task.id, 'c')
  assert.equal(only[1].depth, 1)
  assert.equal(only[1].lastSibling, true)                       // a lone child: the elbow is a └
  assert.deepEqual(only[1].continuation, [false])               // no level-0 guide
  assert.equal(only[1].continuation.some(Boolean), false)       // nothing to draw left of it
})

test('a guide appears on an inner level only when that level has a sibling below', () => {
  // p -> {b -> c, e}: c sits two levels down, and its OWN level (1) has a sibling
  // below it (e), so exactly one guide shows — at level 1, not at level 0.
  const NESTED = [
    { id: 'p', title: 'P', status: 'todo', children: ['b', 'e'], parents: [] },
    { id: 'b', title: 'B', status: 'todo', children: ['c'], parents: ['p'] },
    { id: 'c', title: 'C', status: 'todo', children: [], parents: ['b'] },
    { id: 'e', title: 'E', status: 'todo', children: [], parents: ['p'] }
  ]
  const rows = byId(treeRows(NESTED))
  assert.deepEqual(rows.c.continuation, [false, true])
  assert.equal(rows.c.continuation[0], false)                   // root level: never
  assert.equal(rows.c.continuation[1], true)                    // b is followed by e
})

test('a search ignores the fold state and flags what it matched', () => {
  const rows = treeRows(TREE, { fold: new Map([['a', true], ['g', true]]), search: 'c' })
  assert.ok(ids(rows).includes('c'))             // the folded branch opens
  assert.equal(byId(rows).c.matched, true)
  assert.equal(byId(rows).a.matched, false)
})

test('the halo follows the selected task descendants, not its ancestors', () => {
  const rows = byId(treeRows(TREE, { selected: new Set(['a']) }))
  assert.equal(rows.b.descendantOfSelected, true)
  assert.equal(rows.c.descendantOfSelected, true)
  assert.equal(rows.f.descendantOfSelected, true)
  assert.equal(rows.a.descendantOfSelected, false)   // it IS the selection
  assert.equal(rows.g.descendantOfSelected, false)   // unrelated branch
})

test('every row carries a unique render key, multi-parent rows included', () => {
  // The reported defect: toggling a fold only ever ADDED rows, and the strays
  // looked like DOM leftovers. The renderer keyed rows by task id, but a task on
  // a multi-parent board legitimately holds several rows — its primary position
  // plus one under each later parent that reaches it. Duplicate keys make React
  // reuse and abandon nodes, so folded-away rows survive in the DOM and pile up.
  // The key must therefore name the POSITION.
  const key = r => (r.secondary ? `${r.task.id}@${r.parentId}` : r.task.id)
  const keysOf = rows => rows.map(key)

  for (const fold of [new Map(), new Map([['a', true]]), new Map([['g', true]]),
                      new Map([['a', true], ['g', true]])]) {
    const keys = keysOf(treeRows(TREE, { fold }))
    assert.equal(new Set(keys).size, keys.length,
                 `duplicate render keys: ${keys.join(', ')}`)
  }
  // a search prints the same task under every parent that reaches it…
  const searched = treeRows(TREE, { search: 'f' })
  assert.equal(searched.filter(r => r.task.id === 'f').length, 2)
  const searchKeys = keysOf(searched)
  assert.equal(new Set(searchKeys).size, searchKeys.length,
               `duplicate render keys with a search: ${searchKeys.join(', ')}`)

  // …and each of those rows says which parent it hangs under, which is exactly
  // what makes its key unique. Only roots have no parent.
  const rows = byId(treeRows(TREE))
  assert.equal(rows.f.parentId, 'a')                // printed under a, as its child
  assert.equal(rows.g.parentId, null)               // a root
  assert.equal(rows.a.parentId, null)
  assert.equal(rows.b.parentId, 'a')
  const secondary = treeRows(TREE, { fold: new Map([['g', false]]) }).filter(r => r.secondary)
  assert.equal(secondary.length, 1)
  assert.equal(secondary[0].task.id, 'f')
  assert.equal(secondary[0].parentId, 'g')          // the parent it hangs under
  const opened = treeRows(TREE, { fold: new Map([['g', false]]) })
  const fRows = opened.filter(r => r.task.id === 'f')   // primary first, then under g
  assert.equal(fRows.length, 2)
  assert.equal(key(fRows[0]), 'f')                      // the primary position
  assert.equal(key(fRows[1]), 'f@g')                    // the secondary one
  assert.notEqual(key(fRows[0]), key(fRows[1]))         // …that difference IS the key
})

test('a search finds a task by its id, with or without the t_ prefix', () => {
  // Ids are how tasks are referred to outside the board, so pasting one into the
  // search field has to work. This is matchesSearch, NOT treeRows: the row list
  // applies the predicate upstream, treeRows only consumes the fold state.
  const T = [
    { id: 't_fb50c792', title: 'Refactor the importer', label: '', status: 'todo' },
    { id: 't_11223344', title: 'Unrelated card', label: '', status: 'todo' }
  ]
  const hit = (q, id) => core.matchesSearch(T.find(t => t.id === id), q)

  assert.equal(hit('t_fb50c792', 't_fb50c792'), true)   // the id as the UI shows it
  assert.equal(hit('t_fb50c792', 't_11223344'), false)
  assert.equal(hit('fb50c792', 't_fb50c792'), true)     // pasted without the prefix
  assert.equal(hit('FB50C792', 't_fb50c792'), true)     // case does not matter
  assert.equal(hit('fb50', 't_fb50c792'), true)         // a fragment is enough
  assert.equal(hit('11223344', 't_11223344'), true)
  assert.equal(hit('importer', 't_fb50c792'), true)      // titles still match
  assert.equal(hit('unrelated', 't_11223344'), true)
  assert.equal(hit('unrelated', 't_fb50c792'), false)
  assert.equal(hit('nope', 't_fb50c792'), false)
  assert.equal(hit('', 't_11223344'), true)              // an empty query keeps everything
})

// ── treeMarks: the column's geometry, one slot per level ──────────────────────

test('a lone child draws only its elbow, hanging under the PARENT square', () => {
  // The reported defect: the icons looked "too far left" because the elbow was
  // drawn on the CHILD's slot. It must sit under the parent's square centre, and
  // its arm must reach the child's own square exactly.
  const lone = treeMarks(1, [false], true)
  assert.deepEqual(lone.guides, [])                          // nothing to continue
  assert.equal(lone.indent, TREE_INSET + TREE_SLOT)           // the square starts here
  assert.equal(lone.squareX, TREE_INSET + TREE_SLOT)
  assert.equal(lone.elbowX, TREE_INSET + TREE_AXIS)           // level 0's square centre
  assert.equal(lone.elbowW, TREE_SLOT - TREE_AXIS)
  assert.equal(lone.elbowX + lone.elbowW, lone.squareX)       // the arm meets the square
  assert.equal(lone.elbowHalf, true)                         // a lone child draws a `└`
})

test('every guide runs through the centre of its own level square', () => {
  const marks = treeMarks(2, [false, true], false)
  // Only level 1 continues (level 0 is the top level and never guides).
  assert.deepEqual(marks.guides, [TREE_INSET + TREE_SLOT + TREE_AXIS])
  // A depth-2 row's elbow is exactly the guide of its parent's level, continued.
  assert.equal(marks.elbowX, TREE_INSET + TREE_SLOT + TREE_AXIS)
  assert.equal(marks.elbowX + marks.elbowW, marks.squareX)     // TREE_INSET + 2 * TREE_SLOT
  assert.equal(marks.elbowHalf, false)                        // a sibling follows
})

test('a root has no elbow, and a leaf keeps its slot width', () => {
  const root = treeMarks(0, [], true)
  assert.equal(root.elbowX, null)                            // nothing to hang from
  assert.deepEqual(root.guides, [])
  // A root still gets the inset — and it is the exact offset the column header's
  // global toggle uses, so the two affordances line up.
  assert.equal(root.indent, TREE_INSET)
  assert.equal(root.squareX, TREE_INSET)
  const deep = treeMarks(3, [false, true, false], true)
  assert.deepEqual(deep.guides, [TREE_INSET + TREE_SLOT + TREE_AXIS])  // only level 1
  assert.equal(deep.squareX, TREE_INSET + 3 * TREE_SLOT)
  assert.equal(deep.elbowHalf, true)                          // last of its group
})
test('lastActivity is the newest real timestamp on the task, runs included', () => {
  const { lastActivity } = core
  assert.equal(lastActivity({ created_at: NOW - 5 * DAY }), NOW - 5 * DAY)
  assert.equal(lastActivity({ created_at: NOW - 5 * DAY, started_at: NOW - 2 * DAY,
    runs: [{ started_at: NOW - DAY, ended_at: NOW - H }] }), NOW - H)
  assert.equal(lastActivity({}), null)
})

test('relativeAge grows with the gap and is empty without a timestamp', () => {
  const { relativeAge } = core
  assert.equal(relativeAge(null, NOW), '')
  const order = [NOW - 30, NOW - 5 * 60, NOW - 3 * H, NOW - 2 * DAY, NOW - 30 * DAY, NOW - 200 * DAY, NOW - 800 * DAY]
  const out = order.map(t => relativeAge(t, NOW))
  assert.equal(new Set(out).size, out.length)
  assert.equal(relativeAge(NOW + 10, NOW), 'now')
})

test('relativeAge speaks the locale it is given', () => {
  const { relativeAge } = core
  // The suffixes are the only localizable part: the arithmetic is unchanged, so a
  // French stack reads "5 min" where the English one reads "5m".
  assert.equal(relativeAge(NOW - 300, NOW, { m: ' min' }), '5 min')
  assert.equal(relativeAge(NOW - 3 * H, NOW, { h: ' h' }), '3 h')
  assert.equal(relativeAge(NOW - 2, NOW, { now: "à l'instant" }), "à l'instant")
  assert.equal(relativeAge(NOW - 2 * DAY, NOW, { d: ' j' }), '2 j')
  // a partial map keeps the English default for whatever it omits
  assert.equal(relativeAge(NOW - 5 * 60, NOW, { h: ' h' }), '5m')
})

/* ── the palette says what needs a human, and nothing else ──────────────────── */

test('a run is red only when it really failed', () => {
  const { runTone, FAIL_TONE, HARD_FAILURES } = core
  for (const outcome of HARD_FAILURES) {
    assert.equal(runTone(outcome), FAIL_TONE, `${outcome} must be a hard failure`)
  }
  // timed_out and rate_limited are ordinary events on a busy gateway: they end a
  // run, they are not a defect, and colouring them red is what made a healthy
  // board look broken.
  for (const outcome of ['timed_out', 'rate_limited', 'completed', 'done', '']) {
    assert.notEqual(runTone(outcome), FAIL_TONE, `${outcome} must not read as a failure`)
  }
  assert.equal(runTone('unknown-outcome'), core.RUN_TONE)
})

test('a run still in flight is green, whichever way the task went afterwards', () => {
  const { runTone, statusTone } = core
  assert.equal(runTone('crashed', true), statusTone('running'))
  assert.equal(runTone(null, true), statusTone('running'))
})

test('blocked and failure do not share a colour, and neither does review', () => {
  const { statusTone, FAIL_TONE } = core
  // Amber means "waiting on a human", red means "something broke": on an agent
  // board these are the two questions a reader asks, so they cannot be one colour.
  assert.notEqual(statusTone('blocked'), FAIL_TONE)
  assert.notEqual(statusTone('blocked'), statusTone('review'))
  assert.notEqual(statusTone('review'), statusTone('running'))
  assert.equal(statusTone('running'), '#34d399')
})

test('one bar per run, each keeping its own outcome', () => {
  const { taskBars, FAIL_TONE, statusTone, RUN_TONE } = core
  const bars = taskBars({
    id: 't_1', status: 'running', created_at: NOW - 4 * H,
    runs: [
      { id: 'r1', started_at: NOW - 3 * H, ended_at: NOW - 2 * H, outcome: 'crashed' },
      { id: 'r2', started_at: NOW - H, ended_at: null, status: 'running' }
    ]
  }, NOW, 60)
  assert.equal(bars.length, 2)
  // The task is back to `running`, but the run that crashed must still say so.
  assert.equal(bars[0].tone, FAIL_TONE)
  assert.equal(bars[0].outcome, 'crashed')
  assert.equal(bars[1].tone, statusTone('running'))
  assert.equal(bars[1].isOngoing, true)
  // and a run that merely timed out keeps the ordinary tone
  const calm = taskBars({
    id: 't_2', status: 'running', created_at: NOW - 4 * H,
    runs: [
      { id: 'r1', started_at: NOW - 3 * H, ended_at: NOW - 2 * H, outcome: 'timed_out' },
      { id: 'r2', started_at: NOW - H, ended_at: null, status: 'running' }
    ]
  }, NOW, 60)
  assert.equal(calm[0].tone, RUN_TONE)
})

/* ── the zoom ladder and the "now" line ─────────────────────────────────────── */

test('one wheel event scales by its delta, so a trackpad and a mouse agree', () => {
  const { wheelZoomFactor } = core
  // A mouse notch is a real step...
  const notch = wheelZoomFactor(-100)
  assert.ok(notch > 1.25 && notch < 1.3, `a notch should be ~1.28, got ${notch}`)
  assert.ok(wheelZoomFactor(100) < 1, 'scrolling the other way zooms out')
  // ...while one trackpad sample is barely anything on its own...
  const sample = wheelZoomFactor(-4)
  assert.ok(sample > 1 && sample < 1.02, `one sample must not jump the view, got ${sample}`)
  // ...and 25 of them compound to the same place as one notch of the same total.
  // This is the whole bug: a fixed step per EVENT ran away on a trackpad.
  assert.ok(Math.abs(sample ** 25 - notch) < 1e-9, 'same total delta, same zoom')
  // legacy deltaMode: 3 LINES is one notch, 1 PAGE is a big step but capped
  assert.ok(Math.abs(wheelZoomFactor(-3, 1) - wheelZoomFactor(-48)) < 1e-9)
  assert.equal(wheelZoomFactor(-1000), 1.4)
  assert.equal(wheelZoomFactor(1000), 1 / 1.4)
  assert.equal(wheelZoomFactor(0), 1)
  assert.equal(wheelZoomFactor(NaN), 1)
})

test('hour ticks appear only once an hour is readable, spaced so labels never touch', () => {
  const { hourTickPlan } = core
  assert.equal(hourTickPlan(23), null, 'the day ruler stays below 24 px/h')
  assert.equal(hourTickPlan(24).step, 3, '24 px/h: labels every 3 h (72 px apart)')
  assert.equal(hourTickPlan(30).step, 2)
  assert.equal(hourTickPlan(60).step, 1, 'every hour is labelled once it fits')
  assert.equal(hourTickPlan(240).step, 1)
  // the invariant behind those numbers: labels stay at least 56 px apart
  for (const pxPerHour of [24, 30, 40, 60, 120, 240]) {
    const plan = hourTickPlan(pxPerHour)
    assert.ok(plan.step * pxPerHour >= 56, `${pxPerHour} px/h: ${plan.step} h apart is too tight`)
  }
})

test('the zoom is clamped to the detail ceiling, and cannot go negative', () => {
  const { maxZoom, clampZoom } = core
  const basePerSec = (1000 / 7) / DAY          // 1 week filling a 1000 px pane
  const hi = maxZoom(basePerSec)
  assert.ok(Math.abs(hi - 240 / (basePerSec * 3600)) < 1e-9)
  assert.equal(clampZoom(1e6, basePerSec), hi)
  assert.equal(clampZoom(0, basePerSec), 0.2)
  assert.equal(clampZoom(-3, basePerSec), 0.2)
  assert.equal(clampZoom(2, basePerSec), 2)
  assert.equal(clampZoom(NaN, basePerSec), 1)
  // a pane so narrow that an hour is already wider than the ceiling keeps zoom 1
  assert.equal(maxZoom(1), 1)
})

test('the now line sits where now is, and is absent when now is out of range', () => {
  const { nowOffset } = core
  assert.equal(nowOffset(NOW, NOW - 100, NOW + 100, 2), 200)
  assert.equal(nowOffset(NOW - 100, NOW - 100, NOW + 100, 2), 0)
  assert.equal(nowOffset(NOW, NOW + 10, NOW + 100, 2), null, 'before the window: no line')
  assert.equal(nowOffset(NOW, NOW - 100, NOW - 10, 2), null, 'after the window: no line')
})

test('the now line is measured from the timeline origin, not the container edge', () => {
  const { nowLineX, nowOffset } = core
  const pxPerSec = (1000 / 7) / DAY          // one week across 1000 px
  const min = NOW - 3 * DAY
  const max = NOW + 4 * DAY
  const labelW = 300                          // the sticky task-name column
  // The regression: drawn from the container edge, the line sat one column-width to
  // the left — on this window that is ~2 days, which is why it named the wrong day.
  assert.notEqual(nowLineX(NOW, min, max, pxPerSec, labelW), nowOffset(NOW, min, max, pxPerSec))
  assert.equal(nowLineX(NOW, min, max, pxPerSec, labelW),
    labelW + nowOffset(NOW, min, max, pxPerSec))
  // It must agree with where a bar for that same instant starts: the bars live in the
  // grid's second column, so their x is the origin plus the offset.
  assert.equal(nowLineX(NOW, min, max, pxPerSec, labelW),
    labelW + Math.round((NOW - min) * pxPerSec))
  // No origin = the old, wrong arithmetic — kept only so the default is explicit.
  assert.equal(nowLineX(NOW, min, max, pxPerSec), nowOffset(NOW, min, max, pxPerSec))
  // Still absent when now is outside the window, whatever the origin.
  assert.equal(nowLineX(NOW, NOW + 1, max, pxPerSec, labelW), null)
  assert.equal(nowLineX(NOW, min, NOW - 1, pxPerSec, labelW), null)
})

/* ── the attachment filter ──────────────────────────────────────────────────── */

test('a task counts as attached from its count alone', () => {
  const { hasAttachments } = core
  assert.equal(hasAttachments({ attachment_count: 2 }), true)
  assert.equal(hasAttachments({ attachment_count: 1 }), true)
  assert.equal(hasAttachments({ attachment_count: 0 }), false)
  assert.equal(hasAttachments({}), false, 'a board that never reported the field')
  assert.equal(hasAttachments({ attachment_count: null }), false)
  assert.equal(hasAttachments(null), false)
  assert.equal(hasAttachments(undefined), false)
  assert.equal(hasAttachments({ attachment_count: '3' }), true, 'a stringified count still counts')
})

/* ── walking the rows with the keyboard ─────────────────────────────────────── */

test('arrow navigation moves one row at a time, and stops at the ends', () => {
  const { neighbourId } = core
  const order = ['t_a', 't_b', 't_c']
  assert.equal(neighbourId(order, 't_a', 1), 't_b')
  assert.equal(neighbourId(order, 't_b', 1), 't_c')
  assert.equal(neighbourId(order, 't_c', -1), 't_b')
  assert.equal(neighbourId(order, 't_a', -1), null, 'no wrap upwards')
  assert.equal(neighbourId(order, 't_c', 1), null, 'no wrap downwards')
  assert.equal(neighbourId(order, 't_unknown', 1), null, 'an id outside the order goes nowhere')
  assert.equal(neighbourId([], 't_a', 1), null)
  assert.equal(neighbourId(order, 't_a', 0), null)
  assert.equal(neighbourId(undefined, 't_a', 1), null, 'a missing order is not a crash')
})

/* ── the wheel belongs to the timeline, not to the desktop ──────────────────── */

test('a wheel is a zoom only with ctrl or meta, a pan with shift, a scroll otherwise', () => {
  const { wheelIntent } = core
  assert.equal(wheelIntent({ ctrlKey: true, metaKey: false, shiftKey: false }), 'zoom')
  assert.equal(wheelIntent({ ctrlKey: false, metaKey: true, shiftKey: false }), 'zoom',
    'the macOS pinch arrives as ctrl+wheel, but ⌘ is the chord a reader tries')
  assert.equal(wheelIntent({ ctrlKey: true, metaKey: false, shiftKey: true }), 'zoom',
    'the zoom wins: shift must not turn a ctrl+wheel into a pan')
  assert.equal(wheelIntent({ ctrlKey: false, metaKey: false, shiftKey: true }), 'pan')
  assert.equal(wheelIntent({ ctrlKey: false, metaKey: false, shiftKey: false }), 'scroll',
    'a bare wheel scrolls the rows: zooming on it made the table unscrollable')
  assert.equal(wheelIntent({}), 'scroll')
})

/* ── attachments: the eye only appears where the browser can show something ──── */

test('an attachment is previewable by its extension, and by its declared type', () => {
  const { previewKind } = core
  // what the reader can actually look at
  assert.equal(previewKind('notes.md', ''), 'markdown')
  assert.equal(previewKind('NOTES.MARKDOWN', ''), 'markdown')
  assert.equal(previewKind('build.log', ''), 'text')
  assert.equal(previewKind('data.json', ''), 'text')
  assert.equal(previewKind('script.py', ''), 'text')
  assert.equal(previewKind('shot.png', ''), 'image')
  assert.equal(previewKind('logo.svg', ''), 'image')
  assert.equal(previewKind('report.pdf', ''), 'pdf')
  assert.equal(previewKind('page.html', ''), 'html')
  // everything else offers a download and nothing more
  assert.equal(previewKind('archive.zip', ''), null)
  assert.equal(previewKind('firmware.bin', ''), null)
  assert.equal(previewKind('no-extension', ''), null)
  assert.equal(previewKind('', ''), null)
  assert.equal(previewKind(null, null), null)
  // a missing or misleading extension falls back to the declared MIME
  assert.equal(previewKind('blob', 'image/png'), 'image')
  assert.equal(previewKind('blob', 'application/pdf; charset=binary'), 'pdf')
  assert.equal(previewKind('blob', 'text/html'), 'html')
  assert.equal(previewKind('blob', 'text/plain'), 'text')
  assert.equal(previewKind('blob', 'application/zip'), null)
  // the extension wins over a wrong declaration: it is what the user sees
  assert.equal(previewKind('notes.md', 'application/octet-stream'), 'markdown')
})

test('the MIME handed to the Blob comes from the kind, never from the declaration', () => {
  const { attachmentMime } = core
  assert.equal(attachmentMime('a.pdf', 'application/pdf'), 'application/pdf')
  assert.equal(attachmentMime('a.txt', 'text/plain; charset=utf-8'), 'text/plain',
    'the declared type is only consulted for its parameters, never to override the kind')
  assert.equal(attachmentMime('a.png', ''), 'image/png')
  assert.equal(attachmentMime('a.jpg', ''), 'image/jpeg')
  assert.equal(attachmentMime('a.svg', ''), 'image/svg+xml')
  assert.equal(attachmentMime('a.md', ''), 'text/markdown')
  assert.equal(attachmentMime('a.html', ''), 'text/html')
  assert.equal(attachmentMime('a.zip', ''), 'application/octet-stream')

  // The kind decides, never the declaration: the extension picks the renderer, and the frame the
  // renderer lives in is what makes the result safe.
  assert.equal(core.previewKind('x.pdf', 'text/html'), 'pdf',
    'the extension still picks the renderer')
  assert.equal(attachmentMime('x.pdf', 'text/html'), 'application/pdf',
    'the pdf frame can only ever be handed a pdf blob, whatever the board declared')
  assert.equal(attachmentMime('x.png', 'text/html'), 'image/png',
    'an image stays an image when the declaration disagrees')
  assert.equal(attachmentMime('x.bin', 'text/html'), 'text/html',
    'no extension to contradict the declaration means the html KIND — which the only caller renders inside a sandboxed frame')
  assert.equal(attachmentMime('x.bin', 'application/x-msdownload'), 'application/octet-stream',
    'a type that matches no kind we render falls back to one no renderer acts on')
})

/* ── the period shortcuts ───────────────────────────────────────────────────── */

test('a period calibrates the scale, and the slice lands entirely on screen', () => {
  const { periodPxPerSec, periodScrollLeft, visibleWindow, matchPeriod } = core
  const labelW = 300
  const clientWidth = 1000               // the scroller (scrollbar and column excluded)
  const span = 24 * 3600
  const pxPerSec = periodPxPerSec(span, clientWidth, labelW)
  assert.equal(pxPerSec, (clientWidth - labelW) / span)
  // nothing to calibrate against yet -> null, never a guessed scale
  assert.equal(periodPxPerSec(span, labelW, labelW), null)
  assert.equal(periodPxPerSec(0, clientWidth, labelW), null)

  const min = NOW - 10 * DAY
  const scrollLeft = periodScrollLeft({ from: NOW - span, to: NOW, min, pxPerSec, clientWidth, labelW })
  const visible = visibleWindow({ min, pxPerSec, scrollLeft, clientWidth, labelW })
  // right-aligned on now — that is what makes it read as "the last 24 h"
  assert.ok(Math.abs(visible.to - NOW) < 0.5, `right edge on now, got ${visible.to - NOW}`)
  // and the slice exactly fills the visible timeline area
  assert.ok(Math.abs((visible.to - visible.from) - span) < 1, 'the slice fills the pane')
  assert.ok(visible.from <= NOW - span + 1 && visible.to >= NOW - 0.5,
    'the WHOLE period is visible, not just its end')
  assert.equal(matchPeriod(visible, NOW), span, 'and it is recognised as the 24 h shortcut')
  // clamped at the left edge of the domain rather than scrolling into nothing
  assert.equal(periodScrollLeft({ from: NOW - span, to: NOW, min: NOW, pxPerSec, clientWidth, labelW }), 0)
})

test('the shortcut stops matching once the reader moves away from it (+/- 6 h)', () => {
  const { periodPxPerSec, periodScrollLeft, visibleWindow, matchPeriod, PERIOD_TOLERANCE } = core
  const span = 24 * 3600
  const labelW = 300, clientWidth = 1000
  const pxPerSec = periodPxPerSec(span, clientWidth, labelW)
  const min = NOW - 10 * DAY
  const base = periodScrollLeft({ from: NOW - span, to: NOW, min, pxPerSec, clientWidth, labelW })
  const at = shiftHours => visibleWindow({
    min, pxPerSec, scrollLeft: base - shiftHours * 3600 * pxPerSec, clientWidth, labelW
  })
  assert.equal(PERIOD_TOLERANCE, 6 * 3600)
  assert.equal(matchPeriod(at(0), NOW), span)
  assert.equal(matchPeriod(at(5), NOW), span, 'a small nudge is still the same view')
  assert.equal(matchPeriod(at(-5), NOW), span)
  assert.equal(matchPeriod(at(8), NOW), null, 'scrolled a workday back, it is no longer "24 h"')
  assert.equal(matchPeriod(at(-8), NOW), null)
  assert.equal(matchPeriod(null, NOW), null)
  assert.equal(matchPeriod({ from: NaN, to: NOW }, NOW), null)
})

test('the closest shortcut wins when several fit inside the tolerance', () => {
  const { matchPeriod, visibleWindow, periodPxPerSec } = core
  const labelW = 300, clientWidth = 1000
  const min = NOW - 30 * DAY
  const windowOf = hours => {
    const span = hours * 3600
    const pxPerSec = periodPxPerSec(span, clientWidth, labelW)
    return visibleWindow({
      min, pxPerSec, scrollLeft: (NOW - span - min) * pxPerSec, clientWidth, labelW
    })
  }
  assert.equal(matchPeriod(windowOf(6), NOW), 6 * 3600)
  assert.equal(matchPeriod(windowOf(7), NOW), 6 * 3600, '7 h is nearer 6 h than 12 h')
  assert.equal(matchPeriod(windowOf(11), NOW), 12 * 3600, '11 h is nearer 12 h')
  assert.equal(matchPeriod(windowOf(24), NOW), 24 * 3600)
  assert.equal(matchPeriod(windowOf(72), NOW), 3 * DAY)
  assert.equal(matchPeriod(windowOf(168), NOW), 7 * DAY)
  // a length nobody offers lights nothing up
  assert.equal(matchPeriod(windowOf(40), NOW), null)
})

test('the zoom is a 1..100 percentage, and the factor behind it is derived', () => {
  const { zoomFactorFromPct, zoomPctFromFactor, clampZoomPct, ZOOM_PCT_MIN, ZOOM_PCT_MAX } = core
  const lo = 0.2
  const hi = 28
  // the two ends of the visible scale
  assert.equal(zoomFactorFromPct(ZOOM_PCT_MIN, lo, hi), lo, '1 is the widest scale')
  assert.ok(Math.abs(zoomFactorFromPct(ZOOM_PCT_MAX, lo, hi) - hi) < 1e-9, '100 is the closest')
  // every point survives being derived and read back — one representation, no drift
  for (const pct of [1, 7, 25, 50, 73, 99, 100]) {
    assert.equal(zoomPctFromFactor(zoomFactorFromPct(pct, lo, hi), lo, hi), pct)
  }
  // exponential: one point is one PROPORTIONAL step, not a fixed offset
  const r1 = zoomFactorFromPct(51, lo, hi) / zoomFactorFromPct(50, lo, hi)
  const r2 = zoomFactorFromPct(61, lo, hi) / zoomFactorFromPct(60, lo, hi)
  assert.ok(Math.abs(r1 - r2) < 1e-9, 'a point is the same ratio everywhere on the scale')
  // clamping, and the legacy factors converted through this same pair
  assert.equal(clampZoomPct(0), 1)
  assert.equal(clampZoomPct(101), 100)
  assert.equal(clampZoomPct(NaN), 1)
  assert.equal(clampZoomPct(-5), 1)
  assert.equal(clampZoomPct(42.6), 43)
  assert.equal(zoomPctFromFactor(500, lo, hi), 100, 'an old zoom past the ceiling reads as 100')
  assert.equal(zoomPctFromFactor(0.01, lo, hi), 1, 'and one below the floor reads as 1')
  const legacy = zoomPctFromFactor(7, lo, hi)
  assert.ok(legacy > 1 && legacy < 100, `a stored factor lands inside the scale, got ${legacy}`)
  // a degenerate range cannot divide by zero
  assert.equal(clampZoomPct(zoomFactorFromPct(50, 1, 1)), 1)
})

test('the default ceiling is exactly "6 h fills the pane"', () => {
  const { maxZoom, periodPxPerSec } = core
  const labelW = 300
  const clientWidth = 1000
  const basePerSec = (1000 / 7) / DAY
  // the ceiling the renderer derives: visible px per hour that a 6 h span implies
  const ceiling = maxZoom(basePerSec, (clientWidth - labelW) / 6)
  // ...must be the very zoom a 6 h period calibrates to, so the wheel, the slider and the
  // period shortcut stop at the same place
  assert.ok(Math.abs(ceiling - periodPxPerSec(6 * 3600, clientWidth, labelW) / basePerSec) < 1e-9,
    'the ceiling and the 6 h calibration are the same number')
  // a wider pane does not zoom further in absolute terms: it is still "6 h fits"
  const wide = maxZoom(basePerSec, (2000 - labelW) / 6)
  assert.ok(Math.abs(wide * basePerSec * 3600 - (2000 - labelW) / 6) < 1e-9)
  // and a value restored from a build without a ceiling is truncated to it
  const { clampZoom } = core
  assert.equal(clampZoom(50, basePerSec, (clientWidth - labelW) / 6), ceiling)
})

test('a 6 h slice in a huge pane hits the detail ceiling instead of lying', () => {
  const { periodPxPerSec, clampZoom, maxZoom } = core
  const basePerSec = (1000 / 7) / DAY
  const pxPerSec = periodPxPerSec(6 * 3600, 20000, 300)
  const wanted = pxPerSec / basePerSec
  assert.ok(pxPerSec * 3600 > 240, 'a 6 h slice across 20 000 px needs more than 240 px/h')
  assert.equal(clampZoom(wanted, basePerSec), maxZoom(basePerSec))
  assert.ok(clampZoom(wanted, basePerSec) < wanted, 'the clamp pulls the scale back')
})

/* ── a title is the user's text ─────────────────────────────────────────────── */

test('a bracketed prefix is split out, never dropped', () => {
  const { splitTitlePrefix } = core
  assert.deepEqual(splitTitlePrefix('[EPIC] Ship the thing'),
    { prefix: 'EPIC', rest: 'Ship the thing' })
  // no space after the bracket, and lower case: still a prefix
  assert.deepEqual(splitTitlePrefix('[wip]Fix it'), { prefix: 'wip', rest: 'Fix it' })
  // an inner space is part of the tag
  assert.deepEqual(splitTitlePrefix('[P0 urgent] Do it'), { prefix: 'P0 urgent', rest: 'Do it' })
  // only the FIRST group is a prefix; the rest is the title
  assert.deepEqual(splitTitlePrefix('[A] [B] rest'), { prefix: 'A', rest: '[B] rest' })
})

test('a title with no prefix comes back whole — this is the regression that mattered', () => {
  const { splitTitlePrefix } = core
  // The timeline used to strip the leading group whatever it was, so a title that
  // merely STARTED with a bracket lost its first word.
  assert.deepEqual(splitTitlePrefix('[WIP] not closed'), { prefix: 'WIP', rest: 'not closed' })
  assert.deepEqual(splitTitlePrefix('Ship [EPIC] the thing'),
    { prefix: null, rest: 'Ship [EPIC] the thing' }, 'a prefix is only a prefix at the start')
  assert.deepEqual(splitTitlePrefix('no brackets at all'),
    { prefix: null, rest: 'no brackets at all' })
  // degenerate brackets are text, not tags
  assert.deepEqual(splitTitlePrefix('[unclosed'), { prefix: null, rest: '[unclosed' })
  assert.deepEqual(splitTitlePrefix('[]'), { prefix: null, rest: '[]' })
  assert.deepEqual(splitTitlePrefix('[   ]'), { prefix: null, rest: '[   ]' })
  assert.deepEqual(splitTitlePrefix(''), { prefix: null, rest: '' })
  assert.deepEqual(splitTitlePrefix(null), { prefix: null, rest: '' })
  // surrounding whitespace is trimmed, but nothing else is touched
  assert.deepEqual(splitTitlePrefix('  [EPIC]  padded  '), { prefix: 'EPIC', rest: 'padded' })
  assert.deepEqual(splitTitlePrefix('[EPIC]'), { prefix: 'EPIC', rest: '' })
})

/* ── how a title is shown, and who decides ──────────────────────────────────── */

test('titleParts styles the prefix or shows it plainly — it never subtracts it', () => {
  const { titleParts } = core
  // Tags OFF: the title is exactly what the reader typed. This is the reported bug — unchecking
  // "show prefixes as tags" DELETED the `[EPIC]` from the title instead of un-styling it.
  assert.deepEqual(titleParts('[EPIC] Ship the thing', false),
    { prefix: null, text: '[EPIC] Ship the thing' })
  // Tags ON: the chip carries the prefix and the text drops it, so it is not said twice.
  assert.deepEqual(titleParts('[EPIC] Ship the thing', true),
    { prefix: 'EPIC', text: 'Ship the thing' })
  // Nothing to chip: the text is untouched in both modes, and a missing title stays empty.
  for (const asTags of [true, false]) {
    assert.deepEqual(titleParts('Ship [EPIC] the thing', asTags),
      { prefix: null, text: 'Ship [EPIC] the thing' }, 'a prefix is only a prefix at the start')
    assert.deepEqual(titleParts('[unclosed', asTags), { prefix: null, text: '[unclosed' })
    assert.deepEqual(titleParts(null, asTags), { prefix: null, text: '' })
    assert.deepEqual(titleParts('  padded  ', asTags), { prefix: null, text: 'padded' })
  }
})