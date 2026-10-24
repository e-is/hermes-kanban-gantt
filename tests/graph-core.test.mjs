/**
 * Unit tests for the PURE graph logic (src/core/graph-core.ts).
 *
 * Imported from the built artifact (desktop/graph-core.js, produced by `npm run build`
 * from src/core/graph-core.ts) — the tested code is exactly the shipped code.
 *
 * Two families of test here are not "does it compute the right number" but "does it
 * come back at all": the loop suite and the scale suite carry a WALL-CLOCK assertion,
 * because a hang is the failure mode being ruled out and a hanging test would block the
 * suite instead of failing it.
 *
 * Run: node --test tests/graph-core.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const core = await import(join(HERE, '..', 'desktop', 'graph-core.js'))

const {
  graphNodes, graphEdges, dedupeEdges, edgesWithin, ranks, orderRanks, rankComparator,
  reduceEdges, lineage, activityBuckets, activityMap, layoutGraph, scopeIds, SCOPES,
  nearestInHalo, arrangeRows, components, NODE_W, NODE_H, SPARK_BAND
} = core

const H = 3600
const NOW = 1_800_000_000

/** A task shaped like the board snapshot's rows (only the fields the core reads). */
const task = (id, extra = {}) => ({
  id,
  title: extra.title || id,
  status: extra.status || 'todo',
  priority: extra.priority ?? null,
  assignee: extra.assignee || '',
  parents: extra.parents || [],
  children: extra.children || [],
  events: extra.events || [],
  runs: extra.runs || [],
  attachment_count: extra.attachment_count || 0,
  ...extra
})

/** Fail fast instead of hanging: the property under test is "it returns". */
function withinMs(ms, fn) {
  const started = performance.now()
  const out = fn()
  const elapsed = performance.now() - started
  assert.ok(elapsed < ms, `took ${elapsed.toFixed(1)} ms, budget ${ms} ms`)
  return out
}

// ── edges ────────────────────────────────────────────────────────────────────

test('edges come from parents and children, and are deduplicated', () => {
  const tasks = [
    task('a', { children: [{ id: 'b' }] }),
    task('b', { parents: [{ id: 'a' }] })
  ]
  const edges = graphEdges(tasks)
  assert.deepEqual(edges, [{ from: 'a', to: 'b' }])
})

test('a self-parent is dropped, not drawn as a loop', () => {
  assert.deepEqual(dedupeEdges([{ from: 'a', to: 'a' }]), [])
})

test('edges with a dangling end are dropped and counted', () => {
  const { edges, dangling } = edgesWithin(['a', 'b'], [
    { from: 'a', to: 'b' },
    { from: 'ghost', to: 'b' },
    { from: 'a', to: 'gone' }
  ])
  assert.deepEqual(edges, [{ from: 'a', to: 'b' }])
  assert.equal(dangling, 2)
})

// ── ranks ────────────────────────────────────────────────────────────────────

test('a chain ranks 0,1,2 and an orphan stays at 0', () => {
  const nodes = ['a', 'b', 'c', 'solo']
  const { ranks: r, cyclic } = ranks(nodes, [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }])
  assert.equal(r.get('a'), 0)
  assert.equal(r.get('b'), 1)
  assert.equal(r.get('c'), 2)
  assert.equal(r.get('solo'), 0)
  assert.deepEqual(cyclic, [])
})

test('a diamond layers the join BELOW its deepest parent', () => {
  const nodes = ['a', 'b', 'c', 'd']
  const edges = [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }, { from: 'c', to: 'd' }]
  const { ranks: r } = ranks(nodes, edges)
  assert.deepEqual([r.get('a'), r.get('b'), r.get('c'), r.get('d')], [0, 1, 1, 2])
})

test('a multi-parent node sits below the DEEPEST parent (longest path, not BFS)', () => {
  // a -> b -> c -> d, and a -> d. BFS would put d at 1; the graph must agree with the
  // chain, so d is at 3.
  const nodes = ['a', 'b', 'c', 'd']
  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }, { from: 'a', to: 'd' }]
  const { ranks: r } = ranks(nodes, edges)
  assert.equal(r.get('d'), 3)
})

test('ranks are deterministic regardless of input order', () => {
  const nodes = ['a', 'b', 'c', 'd']
  const edges = [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }, { from: 'c', to: 'd' }]
  const one = ranks(nodes, edges).ranks
  const two = ranks([...nodes].reverse(), [...edges].reverse()).ranks
  for (const id of nodes) assert.equal(one.get(id), two.get(id))
})

// ── cycles: can a loop happen? yes — and it must not hang ────────────────────

test('a two-task loop terminates, is reported, and both nodes are drawn', () => {
  const { ranks: r, cyclic } = withinMs(1000, () => ranks(['a', 'b'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]))
  assert.deepEqual(cyclic, ['a', 'b'])
  // Bounded by the leftover set: a rank may climb to 2, never to infinity.
  assert.ok(r.get('a') <= 2 && r.get('b') <= 2)
})

test('a three-cycle with a tail hangs the tail off the loop, and stops', () => {
  const nodes = ['a', 'b', 'c', 'tail']
  const edges = [
    { from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' },
    { from: 'c', to: 'tail' }
  ]
  const { ranks: r, cyclic } = withinMs(1000, () => ranks(nodes, edges))
  assert.deepEqual(cyclic, ['a', 'b', 'c'])
  assert.ok(r.get('tail') > r.get('c') || r.get('tail') > 0)
})

test('a loop reachable only from an otherwise orphaned component still terminates', () => {
  const nodes = ['x', 'y', 'a', 'b']
  const edges = [{ from: 'x', to: 'y' }, { from: 'y', to: 'x' }]
  const { cyclic } = withinMs(1000, () => ranks(nodes, edges))
  assert.deepEqual(cyclic, ['x', 'y'])
})

test('a self-parent declared in the data cannot create a loop in the ranks', () => {
  const { ranks: r, cyclic } = withinMs(1000, () => ranks(['a'], [{ from: 'a', to: 'a' }]))
  assert.equal(r.get('a'), 0)
  assert.deepEqual(cyclic, [])
})

test('layout of a looped board returns boxes and paths instead of spinning', () => {
  const tasks = [
    task('a', { parents: [{ id: 'b' }], children: [{ id: 'b' }] }),
    task('b', { parents: [{ id: 'a' }], children: [{ id: 'a' }] })
  ]
  const out = withinMs(1000, () => layoutGraph(tasks, graphEdges(tasks)))
  assert.equal(out.nodes.length, 2)
  assert.deepEqual(out.cyclic, ['a', 'b'])
  assert.equal(out.edges.length, 2)
})

// ── transitive reduction ─────────────────────────────────────────────────────

test('a diamond keeps two edges of three and counts the implied one', () => {
  const nodes = ['a', 'b', 'c', 'd']
  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'a', to: 'c' }]
  const { edges: kept, implied } = reduceEdges(nodes, edges)
  assert.equal(implied, 1)
  assert.deepEqual(kept.map(e => `${e.from}>${e.to}`).sort(), ['a>b', 'b>c'])
})

test('reduction keeps a diamond join (both paths are direct, neither is implied)', () => {
  const nodes = ['a', 'b', 'c', 'd']
  const edges = [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }, { from: 'c', to: 'd' }]
  const { implied } = reduceEdges(nodes, edges)
  assert.equal(implied, 0)
})

test('reduction on a cycle implies nothing and keeps every edge', () => {
  const nodes = ['a', 'b', 'c']
  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }]
  const { edges: kept, implied } = withinMs(1000, () => reduceEdges(nodes, edges))
  assert.equal(implied, 0)
  assert.equal(kept.length, 3)
})

// ── lineage ──────────────────────────────────────────────────────────────────

test('lineage is transitive in both directions', () => {
  const nodes = ['a', 'b', 'c', 'z']
  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]
  const { upstream, downstream } = lineage(nodes, edges, 'b')
  assert.deepEqual([...upstream].sort(), ['a'])
  assert.deepEqual([...downstream].sort(), ['c'])
  const all = lineage(nodes, edges, 'c')
  assert.deepEqual([...all.upstream].sort(), ['a', 'b'])
  assert.deepEqual([...all.downstream], [])
})

test('lineage does not loop on a cycle, and never includes the task itself', () => {
  const nodes = ['a', 'b']
  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]
  const { upstream, downstream } = withinMs(1000, () => lineage(nodes, edges, 'a'))
  assert.deepEqual([...upstream], ['b'])
  assert.deepEqual([...downstream], ['b'])
})

// ── activity buckets (the sparkline) ────────────────────────────────────────

test('a node with no events and no runs has NO series (empty axis, not a flat line)', () => {
  assert.equal(activityBuckets(task('a'), NOW, 24 * H, 24), null)
})

test('events land in the bucket their timestamp falls in', () => {
  // Bucket 0 is the OLDEST slice (the axis runs left→right in time), so an event ten
  // minutes after the window opened belongs to bucket 0, and one now to the last.
  const t = task('a', { events: [
    { created_at: NOW - 30 },                 // now -> last bucket
    { created_at: NOW - 24 * H + 600 },       // 10 min in -> first bucket
    { created_at: NOW - 24 * H + 900 }        // same bucket, twice -> volume 2
  ] })
  const { buckets, max } = activityBuckets(t, NOW, 24 * H, 24)
  assert.equal(buckets.length, 24)
  assert.equal(buckets[0], 2)
  assert.equal(buckets[23], 1)
  assert.equal(max, 2)
})

test('"touched then silent" is bars on the left and zeros on the right', () => {
  const t = task('a', { events: [{ created_at: NOW - 23.5 * H }] })
  const { buckets } = activityBuckets(t, NOW, 24 * H, 24)
  assert.ok(buckets[0] > 0)
  assert.deepEqual(buckets.slice(12), new Array(12).fill(0))
})

test('run starts and run ends both count', () => {
  const t = task('a', { runs: [{ started_at: NOW - 2 * H, ended_at: NOW - H }] })
  const { buckets } = activityBuckets(t, NOW, 24 * H, 24)
  assert.equal(buckets.reduce((s, v) => s + v, 0), 2)
})

test('events outside the window are ignored, and clock skew clamps into the last bucket', () => {
  const t = task('a', { events: [
    { created_at: NOW - 48 * H },  // outside
    { created_at: NOW + 5 * H }    // gateway clock ahead of the desktop
  ] })
  const { buckets } = activityBuckets(t, NOW, 24 * H, 24)
  assert.equal(buckets.reduce((s, v) => s + v, 0), 1)
  assert.equal(buckets[23], 1)
})

test('a backend-computed series is used as-is, and wins over a sparse event list', () => {
  // `/gantt` sends 24 pre-bucketed integers for every task it saw activity on; the desktop
  // must not re-derive from an event list that may not have been shipped at all.
  const t = task('a', { activity: [0, 0, 3, 0, 1] })
  const { buckets, max } = activityBuckets(t, NOW, 24 * H, 24)
  assert.equal(max, 3)
  assert.equal(buckets[2], 3)   // the series is kept in order, right-aligned at now
  // An all-zero series is not "activity": it is the absence of it, and the renderer must
  // still draw the empty axis.
  assert.equal(activityBuckets(task('b', { activity: [0, 0, 0] }), NOW, 24 * H, 24), null)
})

test('activityMap omits untouched tasks instead of zeroing them', () => {
  const nodes = [
    { id: 'a', events: [{ created_at: NOW - 10 }] },
    { id: 'b', events: [] }
  ]
  const map = activityMap(nodes, NOW, 24 * H, 24)
  assert.ok(map.has('a'))
  assert.ok(!map.has('b'))
})

// ── layout ───────────────────────────────────────────────────────────────────

test('layout places one box per node, positive origin, edges between real boxes', () => {
  const tasks = [task('a', { children: [{ id: 'b' }] }), task('b', { parents: [{ id: 'a' }] })]
  const out = layoutGraph(tasks, graphEdges(tasks))
  assert.equal(out.nodes.length, 2)
  assert.equal(out.edges.length, 1)
  for (const b of out.nodes) {
    assert.ok(b.x >= 0 && b.y >= 0, `box ${b.id} off the origin`)
    assert.equal(b.w, NODE_W)
    assert.equal(b.h, NODE_H)
  }
  assert.ok(out.width > 0 && out.height > 0)
})

test('the sparkline band fits inside the node height (the node does not grow for it)', () => {
  assert.ok(SPARK_BAND > 0 && SPARK_BAND < NODE_H / 2)
})

test('an empty board renders an empty layout, not a crash or a stray frame', () => {
  const out = layoutGraph([], [])
  assert.deepEqual(out.nodes, [])
  assert.deepEqual(out.edges, [])
  assert.equal(out.width, 0)
  assert.equal(out.height, 0)
})

test('layout is deterministic: same snapshot, same coordinates', () => {
  const tasks = [
    task('a', { children: [{ id: 'b' }, { id: 'c' }] }),
    task('b', { parents: [{ id: 'a' }], children: [{ id: 'd' }] }),
    task('c', { parents: [{ id: 'a' }], children: [{ id: 'd' }] }),
    task('d', { parents: [{ id: 'b' }, { id: 'c' }] })
  ]
  const edges = graphEdges(tasks)
  const one = layoutGraph(tasks, edges)
  const two = layoutGraph([...tasks].reverse(), edges)
  const asMap = out => new Map(out.nodes.map(b => [b.id, `${b.x},${b.y}`]))
  assert.deepEqual([...asMap(one)], [...asMap(two)])
})

test('a task hidden by a filter is simply absent; its edges are counted as dangling', () => {
  const tasks = [task('a', { children: [{ id: 'b' }] }), task('b', { parents: [{ id: 'a' }] }),
    task('c', { parents: [{ id: 'b' }] })]
  // 'b' filtered out: a and c remain, connected to nobody.
  const out = layoutGraph([tasks[0], tasks[2]], graphEdges(tasks))
  assert.equal(out.nodes.length, 2)
  assert.equal(out.dangling, 2)
  assert.equal(out.edges.length, 0)
})

test('the FLOW arrangement puts ranks side by side instead of stacked', () => {
  const tasks = [task('a', { children: [{ id: 'b' }] }), task('b', { parents: [{ id: 'a' }] })]
  const down = layoutGraph(tasks, graphEdges(tasks), { arrangement: 'down' })
  const flow = layoutGraph(tasks, graphEdges(tasks), { arrangement: 'flow' })
  const ys = m => new Set(down.nodes.map(n => n.y)).size
  const xs = m => new Set(flow.nodes.map(n => n.x)).size
  assert.equal(ys(down), 2)
  assert.equal(xs(flow), 2)
})

test('orderRanks follows the current sort inside a rank (so the views agree)', () => {
  const nodes = [
    { id: 'a', title: 'Zeta', status: 'running' },
    { id: 'b', title: 'Alpha', status: 'todo' },
    { id: 'c', title: 'Beta', status: 'blocked' }
  ]
  const { ranks: r } = ranks(nodes, [])
  const byTitle = orderRanks(nodes, r, 'title')[0].map(n => n.id)
  const byStatus = orderRanks(nodes, r, 'status')[0].map(n => n.id)
  assert.deepEqual(byTitle, ['b', 'c', 'a'])
  assert.deepEqual(byStatus, ['b', 'a', 'c'])
  assert.equal(typeof rankComparator('assignee'), 'function')
})

// ── scale: measured, with a budget ──────────────────────────────────────────

/** A wide board: `n` tasks in ~40 ranks, each with a couple of children. */
function wideBoard(n) {
  const tasks = []
  for (let i = 0; i < n; i++) tasks.push(task(`t${i}`, { title: `task ${i}`, status: 'todo' }))
  for (let i = 0; i < n - 40; i++) tasks[i].children.push({ id: `t${i + 40}` })
  return tasks
}

test('layoutGraph groups a multi-board graph into framed blocks', () => {
  // Two boards, each with its own chain. The point of grouping is that a reader can see
  // WHERE a board ends: no interleaving, one frame per board, labelled at its top-left.
  const nodes = [
    { id: 'a1', board: 'alpha' }, { id: 'a2', board: 'alpha' }, { id: 'a3', board: 'alpha' },
    { id: 'b1', board: 'beta' }, { id: 'b2', board: 'beta' }
  ]
  const edges = [
    { from: 'a1', to: 'a2' }, { from: 'a2', to: 'a3' }, { from: 'b1', to: 'b2' }
  ]
  const l = layoutGraph(nodes, edges, { groupBy: n => n.board })
  assert.deepEqual(l.groups.map(g => g.key), ['alpha', 'beta'])
  const box = id => l.nodes.find(b => b.id === id)
  for (const g of l.groups) {
    const inside = nodes.filter(n => n.board === g.key).map(n => box(n.id))
    for (const b of inside) {
      assert.ok(b.x >= g.x && b.x + b.w <= g.x + g.w, `${b.id} stays inside its frame (x)`)
      assert.ok(b.y >= g.y && b.y + b.h <= g.y + g.h, `${b.id} stays inside its frame (y)`)
    }
  }
  // Frames are stacked, never overlapping, and all as wide as the widest board.
  assert.ok(l.groups[1].y >= l.groups[0].y + l.groups[0].h, 'the second frame starts below the first')
  assert.equal(new Set(l.groups.map(g => g.w)).size, 1)
  // A link never leaves its board.
  for (const e of l.edges) {
    const from = nodes.find(n => n.id === e.from).board
    const to = nodes.find(n => n.id === e.to).board
    assert.equal(from, to)
  }
  for (const b of l.nodes) assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= l.width && b.y + b.h <= l.height)
})

test('layoutGraph: taller cards are a real height, not a style', () => {
  // The node height feeds the rank spacing, so a caller that asks for two lines of title gets
  // boxes that actually contain them — and a second rank that clears the first.
  const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]
  const tall = layoutGraph(nodes, edges, { nodeH: 82 })
  assert.ok(tall.nodes.every(b => b.h === 82), 'every box is as tall as asked')
  const byRank = [...tall.nodes].sort((x, y) => x.y - y.y)
  assert.ok(byRank[1].y >= 82, 'the next rank starts below a tall card')
  assert.ok(tall.height > layoutGraph(nodes, edges).height, 'and the canvas grows with them')
})

test('layoutGraph: one board (or no grouping) adds no frames', () => {
  const nodes = [{ id: 'a', board: 'x' }, { id: 'b', board: 'x' }]
  const edges = [{ from: 'a', to: 'b' }]
  assert.equal(layoutGraph(nodes, edges, { groupBy: n => n.board }).groups.length, 0, 'a single board needs no frame')
  assert.deepEqual(layoutGraph(nodes, edges).groups, [], 'no groupBy, no frames')
})

test('grouping two full boards stays inside the budget', () => {
  const nodes = []
  const edges = []
  for (const board of ['one', 'two']) {
    for (let i = 0; i < 250; i++) {
      nodes.push({ id: `${board}-${i}`, board })
      if (i) edges.push({ from: `${board}-${i - 1}`, to: `${board}-${i}` })
    }
  }
  const started = performance.now()
  const l = layoutGraph(nodes, edges, { groupBy: n => n.board })
  const elapsed = performance.now() - started
  assert.equal(l.groups.length, 2)
  assert.equal(l.nodes.length, 500)
  assert.ok(elapsed < 120, `500 nodes in two groups took ${elapsed.toFixed(2)} ms`)
})

test('500 nodes lay out in under 50 ms', () => {
  const tasks = wideBoard(500)
  const edges = graphEdges(tasks)
  withinMs(50, () => layoutGraph(tasks, edges))
})

test('2000 nodes lay out in under 400 ms', () => {
  const tasks = wideBoard(2000)
  const edges = graphEdges(tasks)
  withinMs(400, () => layoutGraph(tasks, edges))
})

test('a 500-deep chain does not blow the stack (no recursion anywhere)', () => {
  const tasks = [task('t0')]
  for (let i = 1; i < 500; i++) tasks.push(task(`t${i}`, { parents: [{ id: `t${i - 1}` }] }))
  const out = withinMs(1000, () => layoutGraph(tasks, graphEdges(tasks)))
  assert.equal(out.nodes.length, 500)
  assert.equal(out.ranks, 500)
  // The deepest node really is at the bottom.
  const last = out.nodes.find(n => n.id === 't499')
  assert.ok(last.y > out.nodes.find(n => n.id === 't0').y)
})

test('one node with 200 parents and another with 200 children still lays out', () => {
  const tasks = [task('hub'), task('fan')]
  for (let i = 0; i < 200; i++) {
    tasks.push(task(`p${i}`, { children: [{ id: 'hub' }] }))
    tasks.push(task(`c${i}`, { parents: [{ id: 'fan' }] }))
  }
  const out = withinMs(1000, () => layoutGraph(tasks, graphEdges(tasks)))
  assert.equal(out.nodes.length, 402)
})

// ── quick scopes ────────────────────────────────────────────────────────────

test('the scope list is exactly the four the segmented control offers', () => {
  // Running and blocked are single statuses; lineage is a modifier on top of the chosen scope,
  // which is why it is a separate control rather than a fifth scope.
  assert.deepEqual(SCOPES, ['running', 'blocked', 'open', 'all'])
})

test('Running and Blocked select by status, Open drops done and archived, All keeps everything', () => {
  const nodes = [
    { id: 'run', status: 'running' }, { id: 'blk', status: 'blocked' },
    { id: 'todo', status: 'todo' }, { id: 'done', status: 'done' }
  ]
  const ids = s => [...scopeIds(nodes, [], s)].sort()
  assert.deepEqual(ids('running'), ['run'])
  assert.deepEqual(ids('blocked'), ['blk'])
  assert.deepEqual(ids('open'), ['blk', 'run', 'todo'])
  assert.deepEqual(ids('all'), ['blk', 'done', 'run', 'todo'])
})

test('lineage grows a scope to the upstream and downstream closure, and All ignores it', () => {
  // a -> b -> c, with b running: the closure of {b} is all three.
  const nodes = [{ id: 'a' }, { id: 'b', status: 'running' }, { id: 'c' }]
  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]
  assert.deepEqual([...scopeIds(nodes, edges, 'running')], ['b'])
  assert.deepEqual([...scopeIds(nodes, edges, 'running', { lineage: true })].sort(), ['a', 'b', 'c'])
  // The closure of everything is everything, so the modifier is a no-op on All — which is why the
  // control hides it there instead of offering a switch that cannot do anything.
  assert.deepEqual([...scopeIds(nodes, edges, 'all', { lineage: true })].sort(), ['a', 'b', 'c'])
})

test('lineage never drags in a task the graph does not hold', () => {
  // `b` is in the graph, so the closure legitimately reaches it; `ghost` is not, and an edge
  // pointing at it must not widen the selection to an id that has no card to draw.
  const nodes = [{ id: 'a', status: 'blocked' }, { id: 'b', status: 'todo' }]
  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'ghost' }]
  const kept = scopeIds(nodes, edges, 'blocked', { lineage: true })
  assert.deepEqual([...kept].sort(), ['a', 'b'])
  assert.equal(kept.has('ghost'), false)
})

// ── alignment ───────────────────────────────────────────────────────────────

// Every card of a row shares one top edge and one height. A drawing whose neighbours sit a pixel
// apart reads as sloppy, and the reader cannot tell a rendering artefact from a real ordering — so
// the invariant is asserted where the coordinates are computed, not left to the eye.
test('in a top-down drawing every card of a row shares its top edge and its height', () => {
  const nodes = graphNodes(['a', 'b', 'c', 'd', 'solo'].map(id => ({ id })))
  const edges = graphEdges([
    { id: 'a', parents: [] }, { id: 'b', parents: ['a'] }, { id: 'c', parents: ['a'] },
    { id: 'd', parents: ['b', 'c'] }, { id: 'solo', parents: [] }
  ])
  const { nodes: placed } = layoutGraph(nodes, edges, { arrangement: 'down' })
  const rows = new Map()
  for (const b of placed) {
    if (!rows.has(b.y)) rows.set(b.y, [])
    rows.get(b.y).push(b)
  }
  assert.ok(rows.size > 1, 'the fixture draws more than one row')
  for (const [top, row] of rows) {
    assert.equal(new Set(row.map(b => b.y)).size, 1, `tops differ within the row at y=${top}`)
    assert.equal(new Set(row.map(b => b.h)).size, 1, `heights differ within the row at y=${top}`)
  }
})

test('in a left-to-right drawing every card of a column shares its left edge', () => {
  const nodes = graphNodes(['a', 'b', 'c'].map(id => ({ id })))
  const edges = graphEdges([
    { id: 'a', parents: [] }, { id: 'b', parents: ['a'] }, { id: 'c', parents: ['a'] }
  ])
  const { nodes: placed } = layoutGraph(nodes, edges, { arrangement: 'flow' })
  const cols = new Map()
  for (const b of placed) {
    if (!cols.has(b.x)) cols.set(b.x, [])
    cols.get(b.x).push(b)
  }
  for (const [left, col] of cols) {
    assert.equal(new Set(col.map(b => b.x)).size, 1, `lefts differ within the column at x=${left}`)
  }
})

test('Open drops done and archived; All keeps everything', () => {
  const nodes = [
    { id: 'a', status: 'todo' }, { id: 'b', status: 'done' },
    { id: 'c', status: 'archived' }, { id: 'd', status: 'running' }
  ]
  assert.deepEqual([...scopeIds(nodes, [], 'all')].sort(), ['a', 'b', 'c', 'd'])
  assert.deepEqual([...scopeIds(nodes, [], 'open')].sort(), ['a', 'd'])
})

test('Running + lineage keeps the running tasks AND their whole lineage', () => {
  const nodes = [
    { id: 'root', status: 'done' },
    { id: 'mid', status: 'running' },
    { id: 'leaf', status: 'todo' },
    { id: 'other', status: 'todo' }
  ]
  const edges = [{ from: 'root', to: 'mid' }, { from: 'mid', to: 'leaf' }]
  // The scope alone selects the running work; the lineage modifier adds what leads to it and what
  // follows — never the unrelated task.
  assert.deepEqual([...scopeIds(nodes, edges, 'running')].sort(), ['mid'])
  assert.deepEqual([...scopeIds(nodes, edges, 'running', { lineage: true })].sort(), ['leaf', 'mid', 'root'])
})

test('a scope that selects nothing keeps nothing, with or without lineage (an honest empty state)', () => {
  const nodes = [{ id: 'a', status: 'todo' }, { id: 'b', status: 'done' }]
  assert.equal(scopeIds(nodes, [], 'running').size, 0)
  assert.equal(scopeIds(nodes, [], 'running', { lineage: true }).size, 0)
  assert.equal(scopeIds(nodes, [], 'blocked', { lineage: true }).size, 0)
})

test('nearestInHalo: the nearest card within the halo, measured to the edges', () => {
  const rects = new Map([
    ['a', { left: 0, top: 0, right: 100, bottom: 60 }],
    ['b', { left: 300, top: 0, right: 400, bottom: 60 }]
  ])
  // A pointer inside a box is on it, whatever the distance to its centre.
  assert.equal(nearestInHalo(rects, 90, 55, 40), 'a')
  // 20 px past its right edge: still inside the halo.
  assert.equal(nearestInHalo(rects, 120, 30, 40), 'a')
  // Halfway between the two but beyond the halo: nothing, and the drop does nothing.
  assert.equal(nearestInHalo(rects, 200, 30, 40), null)
  // Inside the halo of both: the nearer one wins.
  assert.equal(nearestInHalo(rects, 285, 30, 120), 'b')
})

test('nearestInHalo: the dragged card and the refused cards are not targets', () => {
  const rects = new Map([
    ['a', { left: 0, top: 0, right: 100, bottom: 60 }],
    ['b', { left: 120, top: 0, right: 220, bottom: 60 }],
    ['c', { left: 240, top: 0, right: 340, bottom: 60 }]
  ])
  assert.equal(nearestInHalo(rects, 110, 30, 400, { exclude: 'a' }), 'b')
  assert.equal(nearestInHalo(rects, 110, 30, 400, { allowed: id => id !== 'b' }), 'a')
  assert.equal(nearestInHalo(rects, 110, 30, 5), null)
})

// ── the Sugiyama pass: what makes parents and children line up ────────────────

test('ranks: a prerequisite moves next to its earliest child, not back in column 0', () => {
  // A is a source that also has a child fed by a longer path (P -> Q -> Z). Longest-path
  // layering leaves A at depth 0 with an arrow spanning the whole graph; the reverse pass moves
  // it to sit just before Z, which is what a reader means by "not mixing parents and children".
  const nodes = ['A', 'P', 'Q', 'Z'].map(id => ({ id }))
  const edges = [{ from: 'A', to: 'Z' }, { from: 'P', to: 'Q' }, { from: 'Q', to: 'Z' }]
  const r = ranks(nodes, edges)
  assert.equal(r.ranks.get('Q'), 1)
  assert.equal(r.ranks.get('Z'), 2)
  assert.equal(r.ranks.get('A'), 1, 'A sits beside Q, right before its child')
})

test('arrangeRows: a parent is centred over its children', () => {
  const nodes = [{ id: 'p', status: 'todo' }, { id: 'a', status: 'todo' }, { id: 'b', status: 'todo' }]
  const edges = [{ from: 'p', to: 'a' }, { from: 'p', to: 'b' }]
  const r = ranks(nodes, edges)
  const { rows, slots } = arrangeRows(nodes, r.ranks, edges)
  assert.equal(rows.length, 2)
  const [sa, sb] = [slots.get('a'), slots.get('b')].sort((x, y) => x - y)
  assert.equal(slots.get('p'), (sa + sb) / 2, 'the parent sits between its two children')
})

test('arrangeRows: neighbouring ranks stay in order (no slot collisions)', () => {
  const nodes = Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, status: 'todo' }))
  const edges = [
    { from: 'n0', to: 'n4' }, { from: 'n1', to: 'n5' },
    { from: 'n2', to: 'n6' }, { from: 'n3', to: 'n7' }
  ]
  const { rows, slots } = arrangeRows(nodes, ranks(nodes, edges).ranks, edges)
  for (const row of rows) {
    // Within a rank the slots are strictly increasing in array order: the placement pass
    // enforces a one-slot minimum, and a violation would draw two cards on top of each other.
    const values = row.map(n => slots.get(n.id))
    for (let i = 1; i < values.length; i++) assert.ok(values[i] > values[i - 1])
  }
})

test('layout: the four arrangements put the ranks on the axis they claim', () => {
  const nodes = [
    { id: 'a', status: 'todo', title: 'A' },
    { id: 'b', status: 'ready', title: 'B' },
    { id: 'c', status: 'done', title: 'C' }
  ]
  const edges = [{ from: 'a', to: 'b' }]
  const down = layoutGraph(nodes, edges, { arrangement: 'down' })
  assert.ok(down.nodes.find(n => n.id === 'b').y > down.nodes.find(n => n.id === 'a').y,
    'down: a child is lower than its parent')
  const flow = layoutGraph(nodes, edges, { arrangement: 'flow' })
  assert.ok(flow.nodes.find(n => n.id === 'b').x > flow.nodes.find(n => n.id === 'a').x,
    'flow: a child is to the right of its parent')
  const status = layoutGraph(nodes, edges, { arrangement: 'status' })
  const xs = ['a', 'b', 'c'].map(id => status.nodes.find(n => n.id === id).x)
  assert.equal(new Set(xs).size, xs.length, 'status: one column per status, so three distinct x')
  const compact = layoutGraph(nodes, edges, { arrangement: 'compact' })
  assert.equal(compact.quiet, true, 'compact: a grid, so the caller hides the arrows')
  assert.equal(compact.edges.length, 0)
  assert.ok(compact.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)))
})

test('solo tasks are packed into a trailing row instead of claiming ranks of their own', () => {
  // Two linked tasks and three independents: without packing, each independent seeds a rank and
  // the drawing becomes as wide as the board is long — and a fit then shrinks every card.
  const tasks = [
    { id: 'a', status: 'todo', title: 'a' }, { id: 'b', status: 'todo', title: 'b' },
    { id: 's1', status: 'todo', title: 's1' }, { id: 's2', status: 'todo', title: 's2' },
    { id: 's3', status: 'todo', title: 's3' }
  ]
  const edges = [{ from: 'a', to: 'b' }]
  const out = layoutGraph(tasks, edges, { arrangement: 'down' })
  const box = id => out.nodes.find(n => n.id === id)
  const solos = ['s1', 's2', 's3'].map(box)
  const linked = box('b')
  assert.ok(solos.every(s => s.y >= linked.y + linked.h), 'the solos sit under the trees')
  assert.equal(new Set(solos.map(s => s.y)).size, 1, 'all of them on one line')
  assert.equal(new Set(solos.map(s => s.x)).size, 3, 'side by side, not stacked')
  // The width stays the drawing's own width: three solos do not widen it further than the tree.
  assert.ok(out.width <= 3 * 172 + 2 * 14 + 1, 'the graph did not grow a column per solo task')
})

test('components: linked groups and solos, whatever order the edges arrive in', () => {
  const nodes = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id }))
  const { linked, singles } = components(nodes, [{ from: 'c', to: 'a' }, { from: 'a', to: 'b' }])
  assert.deepEqual([...linked].map(g => [...g].sort()).sort(), [['a', 'b', 'c']])
  assert.deepEqual([...singles].sort(), ['d', 'e'])
})
