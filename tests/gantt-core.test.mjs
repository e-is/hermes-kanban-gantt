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

const { barRange, taskBars, shortId, matchesSearch, buildRows, treeRows, computeDomain, ticks, tickUnit, statusTone, DAY, MIN_BAR,
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
  assert.equal(bars.length, 3)
  assert.equal(bars[0].kind, 'done')
  assert.equal(bars[0].tone, statusTone('blocked'))
  assert.equal(bars[1].kind, 'done')
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
  assert.deepEqual(r.b.continuation, [true])     // level 0: a is followed by g
  assert.deepEqual(r.c.continuation, [true, true])  // level 1: b is followed by e
  assert.equal(r.b.lastSibling, false)
  assert.equal(r.e.lastSibling, false)
  assert.equal(r.f.lastSibling, true)            // f is a's last child
  assert.deepEqual(r.a.continuation, [])         // a root draws no vertical
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