/** Pure task-graph logic for the graph view — no DOM, no React, no SDK.
 *
 *  Everything here is a function of the board snapshot the plugin already fetches
 *  (`/gantt` carries `parents` and `children` per task), so the layout can be
 *  asserted in node like `gantt-core.ts` instead of being eyeballed in the desktop.
 *
 *  Two properties drive every design decision below:
 *
 *  1. **A cycle must not hang the page.** The routes refuse to close a loop, but the
 *     database does not: a hand-edited `task_parents` row, a bad merge or a direct
 *     sqlite write can. Every traversal here therefore carries a visited set, and the
 *     rank pass is bounded by an explicit round count rather than by "it will end".
 *  2. **Scale is measured, not claimed.** No recursion anywhere (the rank pass and the
 *     lineage walk are iterative), no per-node closures in the returned layout, and
 *     `layoutGraph` returns plain arrays of numbers/strings so 2000 nodes stay cheap.
 */

// ── node geometry ─────────────────────────────────────────────────────────────

/** Node box, in CSS px. Fixed on purpose: the sparkline lives in the bottom band, so
 *  the height must not depend on how much text a node happens to hold. */
export const NODE_W = 172;
export const NODE_H = 62;
/** The strip along the node's bottom edge — the activity sparkline. It is carved out of
 *  the node's own padding, which is why the node does not get taller for it. */
export const SPARK_BAND = 7;
/** Gaps between siblings and between ranks (px, CSS). */
export const NODE_GAP = 14;
export const RANK_GAP = 52;

// ── nodes and edges ───────────────────────────────────────────────────────────

const idOf = (ref: any) => (ref && typeof ref === 'object' ? ref.id : ref);

/** Project the board snapshot down to what the graph draws. */
export function graphNodes(tasks) {
  return (tasks || []).map(t => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority ?? null,
    assignee: t.assignee || '',
    board: t.board || '',
    attachmentCount: t.attachment_count || 0,
    // Kept whole: the sparkline needs them and a second fetch per node is not a thing.
    events: t.events || [],
    runs: t.runs || [],
    // The backend's own bucketed series (`/gantt` computes it in one aggregate pass), when
    // it is there: the desktop then has nothing to derive, and a 500-task board ships 24
    // small integers per touched task instead of every event.
    activity: Array.isArray(t.activity) && t.activity.length ? t.activity : null,
    startedAt: t.started_at || null,
    completedAt: t.completed_at || null,
    createdAt: t.created_at || null
  }));
}

/** Deduplicate an edge list, dropping malformed and self edges.
 *
 *  Both sides of the snapshot declare the same link (`parents` on the child, `children`
 *  on the parent), and a board that has been written twice can carry the pair twice.
 *  A duplicated edge is not a visible bug — it is an arrow drawn twice, and a rank that
 *  counts the same parent as two. */
export function dedupeEdges(edges, { keepSelf = false } = {}) {
  const seen = new Set();
  const out = [];
  for (const e of edges || []) {
    const from = idOf(e && e.from);
    const to = idOf(e && e.to);
    if (typeof from !== 'string' || typeof to !== 'string' || !from || !to) continue;
    if (from === to && !keepSelf) continue;
    const key = from + '\u0000' + to;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from, to });
  }
  return out;
}

/** Parent→child edges from the snapshot, read from `parents` and cross-checked with
 *  `children` (a board where the two disagree yields the union, deduped). */
export function graphEdges(tasks) {
  const edges = [];
  for (const t of tasks || []) {
    for (const p of t.parents || []) {
      const pid = idOf(p);
      if (pid) edges.push({ from: pid, to: t.id });
    }
    for (const c of t.children || []) {
      const cid = idOf(c);
      if (cid) edges.push({ from: t.id, to: cid });
    }
  }
  return dedupeEdges(edges);
}

/** Every edge whose two ends are both in `ids`. Dangling parent ids (deleted, or
 *  filtered out) are dropped here and counted, never invented. */
export function edgesWithin(nodes, edges) {
  const known = new Set((nodes || []).map(n => (typeof n === 'string' ? n : n.id)));
  const kept = [];
  let dangling = 0;
  for (const e of dedupeEdges(edges)) {
    if (known.has(e.from) && known.has(e.to)) kept.push(e);
    else dangling++;
  }
  return { edges: kept, dangling };
}

// ── ranks (layers) ────────────────────────────────────────────────────────────

/** Longest-path layering, **cycle-tolerant**.
 *
 *  Kahn's pass first (a node sits one rank below its deepest parent, orphans at 0).
 *  Whatever Kahn cannot settle is on — or downstream of — a cycle. Those are split in
 *  two: the nodes that really sit on a loop (they can reach themselves) are put in ONE
 *  band just below the settled graph — a loop has no correct layering, and stacking it
 *  four ranks deep would be a lie dressed as precision; the rest are merely downstream
 *  of a loop and get layered normally, so a tail off a cycle still hangs below it.
 *
 *  Every step is bounded: the reachability walk carries a visited set, the downstream
 *  relaxation is capped by the leftover count, and `depthCap` is the last belt. The
 *  caller is told which ids were cyclic, so the footer can say so instead of pretending.
 */
export function ranks(nodes, edges, { depthCap = 4096 } = {}) {
  const ids = (nodes || []).map(n => (typeof n === 'string' ? n : n.id));
  const out = new Map(ids.map(id => [id, 0]));
  const { edges: es } = edgesWithin(ids, edges);
  const children = new Map(ids.map(id => [id, []]));
  const indegree = new Map(ids.map(id => [id, 0]));
  for (const e of es) {
    children.get(e.from).push(e.to);
    indegree.set(e.to, indegree.get(e.to) + 1);
  }
  // Deterministic order: two runs on the same board must produce the same ranks.
  const queue = ids.filter(id => indegree.get(id) === 0).sort();
  const settled = new Set(queue);
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    for (const child of children.get(id)) {
      if (out.get(id) + 1 > out.get(child)) out.set(child, out.get(id) + 1);
      indegree.set(child, indegree.get(child) - 1);
      if (indegree.get(child) === 0 && !settled.has(child)) {
        settled.add(child);
        queue.push(child);
      }
    }
  }

  // Reverse pass (Sugiyama, as dagre/ELK/kanban-graph do it): a task WITH children moves to
  // sit just before its EARLIEST child. Without it a prerequisite stays at depth 0 while what
  // needs it sits in column 5, the arrow spans the whole graph, and parent and child look
  // unrelated — which is exactly what "we mix parents and children" means to a reader.
  const topo = queue.slice()
  for (let i = topo.length - 1; i >= 0; i--) {
    const kids = (children.get(topo[i]) || []).filter(c => settled.has(c))
    if (!kids.length) continue
    // Unconditional, as upstream does: the point is to place a prerequisite NEXT TO its child,
    // which can mean moving it later (a source whose child is fed by a longer path) as well as
    // earlier. Guarding on "only if earlier" leaves exactly the stranding this pass removes.
    out.set(topo[i], Math.min(...kids.map(c => out.get(c))) - 1)
  }
  // The pass can push a soon-to-be-parent below zero: ranks index arrays, so normalise.
  const lo = Math.min(...ids.map(id => out.get(id)))
  if (lo !== 0) for (const id of ids) out.set(id, out.get(id) - lo)

  const leftover = ids.filter(id => !settled.has(id));
  const cyclic = [];
  let truncated = false;
  if (leftover.length) {
    const inLeftover = new Set(leftover);
    const onLoop = new Set();
    for (const id of leftover) {
      // Reachability inside the leftover set only; a visited set makes a loop end.
      const seen = new Set();
      const stack = (children.get(id) || []).filter(c => inLeftover.has(c));
      while (stack.length) {
        const cur = stack.pop();
        if (cur === id) { onLoop.add(id); break; }
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const next of children.get(cur) || []) if (inLeftover.has(next)) stack.push(next);
      }
    }
    const band = Math.max(0, ...[...settled].map(id => out.get(id))) + 1;
    for (const id of onLoop) out.set(id, Math.min(band, depthCap));
    cyclic.push(...[...onLoop].sort());
    // Downstream of a loop: relax over the leftover subgraph, hard-bounded, so a tail
    // sits below the loop it hangs from and a pure loop still terminates. Only `rest`
    // may be raised — relaxing the loop's own nodes would push the band apart again,
    // which is exactly the staircase the band exists to avoid.
    const rest = leftover.filter(id => !onLoop.has(id));
    const restSet = new Set(rest);
    const rounds = Math.min(rest.length + 1, depthCap);
    for (let round = 0; round < rounds && rest.length; round++) {
      let changed = false;
      for (const e of es) {
        if (!restSet.has(e.to) || !inLeftover.has(e.from)) continue;
        const candidate = Math.min(out.get(e.from) + 1, depthCap);
        if (candidate > out.get(e.to)) {
          out.set(e.to, candidate);
          changed = true;
        }
      }
      if (!changed) break;
      if (round === rounds - 1) truncated = true;
    }
  }
  return { ranks: out, cyclic, truncated };
}

/** Status order used by `orderRanks`: the board's own column order, so the graph and
 *  the timeline agree about what "first" means. Unknown statuses sink to the bottom. */
export const STATUS_ORDER = ['triage', 'todo', 'scheduled', 'ready', 'running', 'review', 'blocked', 'done', 'archived'];

const priorityValue = p => (typeof p === 'number' ? p : Number(p) || 0);

/** Sort comparator for one rank. `by` is the view's current sort key; the fallback is
 *  title, then id, so the order is total and deterministic (no ties to shuffle). */
export function rankComparator(by) {
  const title = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { numeric: true });
  return (a, b) => {
    let d = 0;
    if (by === 'status') {
      const sa = STATUS_ORDER.indexOf(a.status), sb = STATUS_ORDER.indexOf(b.status);
      d = (sa < 0 ? 99 : sa) - (sb < 0 ? 99 : sb);
    } else if (by === 'assignee') {
      d = String(a.assignee || '\uffff').localeCompare(String(b.assignee || '\uffff'));
    } else if (by === 'priority') {
      d = priorityValue(a.priority) - priorityValue(b.priority);
    } else if (by === 'updated') {
      d = (b.startedAt || 0) - (a.startedAt || 0);
    }
    if (d !== 0) return d;
    return title(a, b) || String(a.id).localeCompare(String(b.id));
  };
}

/** Bucket the nodes by rank and order each bucket by the current sort.
 *  Returns an array of arrays, index = rank. Empty ranks are removed, so a board whose
 *  ranks jump (an edge removed by a filter) does not render empty columns. */
export function orderRanks(nodes, rankMap, by = 'status') {
  const cmp = rankComparator(by);
  const rows = [];
  for (const n of nodes || []) {
    const r = rankMap.get(n.id) ?? 0;
    (rows[r] = rows[r] || []).push(n);
  }
  return rows.filter(Boolean).map(row => row.sort(cmp));
}

// ── transitive reduction ──────────────────────────────────────────────────────

/** Drop every edge implied by a longer path.
 *
 *  An arrow means "the parent finishes before the child", so `a→b→c` makes `a→c` a
 *  tautology. Not drawn, but **counted** (`implied`) — the footer states it rather than
 *  hiding it, because a reader comparing two graphs must not think an arrow vanished.
 *
 *  Cycle-safe: the walk carries a visited set, so a loop yields "nothing implied" and
 *  the loop's own edges survive.
 */
export function reduceEdges(nodes, edges) {
  const { edges: es } = edgesWithin(nodes, edges);
  const children = new Map();
  for (const e of es) {
    if (!children.has(e.from)) children.set(e.from, []);
    children.get(e.from).push(e.to);
  }
  const kept = [];
  let implied = 0;
  for (const e of es) {
    // Is `e.to` reachable from `e.from` without using `e` itself? The direct hop is
    // left out of the initial frontier; every later step may reach `e.to` — that is
    // the whole point (dropping it there too made this function return "nothing
    // implied" for every diamond).
    const seen = new Set();
    const stack = (children.get(e.from) || []).filter(c => c !== e.to);
    let bypass = false;
    while (stack.length) {
      const cur = stack.pop();
      if (cur === e.to) { bypass = true; break; }
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const next of children.get(cur) || []) stack.push(next);
    }
    if (bypass) implied++;
    else kept.push(e);
  }
  return { edges: kept, implied };
}

// ── lineage ───────────────────────────────────────────────────────────────────

/** Everything upstream and downstream of one task, transitively.
 *
 *  The best idea in `kanban-graph`: selecting a task must answer "what does this wait
 *  on, and what does it unblock?" — not just its direct parents. Iterative, visited-set
 *  guarded, so a cycle simply stops.
 */
export function lineage(nodes, edges, id) {
  const { edges: es } = edgesWithin(nodes, edges);
  const up = new Map();   // child -> parents
  const down = new Map(); // parent -> children
  for (const e of es) {
    if (!up.has(e.to)) up.set(e.to, []);
    up.get(e.to).push(e.from);
    if (!down.has(e.from)) down.set(e.from, []);
    down.get(e.from).push(e.to);
  }
  const walk = (start, adjacency) => {
    const seen = new Set();
    const stack = [...(adjacency.get(start) || [])];
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur) || cur === start) continue;
      seen.add(cur);
      for (const next of adjacency.get(cur) || []) stack.push(next);
    }
    return seen;
  };
  return { upstream: walk(id, up), downstream: walk(id, down) };
}

// ── activity sparkline ────────────────────────────────────────────────────────

/** Per-bucket activity for one node — the "cardio graph" along the node's bottom edge.
 *
 *  Volume is events plus run starts and run ends, bucketed over the last `windowSec`.
 *  `now` is a parameter, not `Date.now()`, so the test can pin a clock; timestamps in
 *  the future (clock skew between gateway and desktop) clamp into the last bucket
 *  instead of producing a negative index.
 *
 *  Returns `null` when the node has no activity at all in the window: "never touched"
 *  and "touched then silent" must not look the same — the first draws an empty axis,
 *  the second draws bars on the left and nothing on the right.
 */
export function activityBuckets(node, now, windowSec, count) {
  // A series computed by the backend wins: it saw every event, including the ones the
  // snapshot does not carry, and it is already bucketed over the same window.
  if (Array.isArray(node?.activity) && node.activity.length) {
    const buckets = node.activity.slice(-count).map(v => Number(v) || 0);
    const max = buckets.reduce((m, v) => (v > m ? v : m), 0);
    return max > 0 ? { buckets, max } : null;
  }
  const buckets = new Array(count).fill(0);
  const start = now - windowSec;
  const bucketSec = windowSec / count;
  const stamp = (ts, weight) => {
    const t = Number(ts);
    if (!Number.isFinite(t) || t < start) return false;
    const raw = Math.floor((t - start) / bucketSec);
    const i = Math.max(0, Math.min(count - 1, raw));
    buckets[i] += weight;
    return true;
  };
  let touched = false;
  for (const e of node?.events || []) {
    if (stamp(e.created_at ?? e.ts, 1)) touched = true;
  }
  for (const r of node?.runs || []) {
    if (stamp(r.started_at, 1)) touched = true;
    if (r.ended_at && stamp(r.ended_at, 1)) touched = true;
  }
  if (!touched) return null;
  const max = buckets.reduce((m, v) => (v > m ? v : m), 0);
  return { buckets, max };
}

/** The series for every node, keyed by id, in one pass. Nodes with no activity are
 *  absent from the map (not zeroed): the renderer's `has()` is the "never touched" test. */
export function activityMap(nodes, now, windowSec, count) {
  const out = new Map();
  for (const n of nodes || []) {
    const series = activityBuckets(n, now, windowSec, count);
    if (series) out.set(n.id, series);
  }
  return out;
}

// ── layout ────────────────────────────────────────────────────────────────────

/** Arrange the graph. `arrangement` is `down` (ranks as rows, ancestors on top) or
 *  `flow` (ranks as columns, ancestors on the left) — the two orientations the timeline
 *  can be compared against; `status` arrives with the workflow work.
 *
 *  The layout is returned as flat, plain objects: no closures, no per-node functions,
 *  so 2000 nodes cost a few MB and serialize cheaply in a test.
 */
/**
 * The nearest box to a point, within a halo.
 *
 * Dropping onto a 172 px card at 60 % zoom, with the pointer over the gap between two ranks, is
 * a game of skill — and a release that misses reads as the feature being broken. So the target
 * is the nearest card within `radius` of the pointer, measured to the box EDGES (a point inside
 * a box is at distance 0) rather than to its centre, which would favour small cards.
 *
 * `rects` is an iterable of [id, {left, top, right, bottom}]; `allowed` filters the boxes the
 * drop would refuse (self, descendant, other board, already a parent).
 */
export function nearestInHalo(rects, x, y, radius, { exclude = null, allowed = null } = {}) {
  let best = null;
  let bestD = Infinity;
  for (const [id, r] of rects) {
    if (id === exclude) continue;
    if (allowed && !allowed(id)) continue;
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return bestD <= radius ? best : null;
}

export function layoutGraph(nodes, edges, {
  arrangement = 'down',
  sortBy = 'status',
  // Grouping is what makes an all-boards graph readable: layout each group on its own and
  // stack the blocks, so a board is a CONTIGUOUS, framed region instead of its members being
  // interleaved with another board's and each card needing a badge to say where it belongs.
  groupBy = null,
  groupGap = 22,
  groupHead = 52,
  groupPad = 12,
  // `nodeH` exists so the reader can ask for taller cards (two lines of title) without the
  // layout lying about it: the height is a CONSTANT the equations use, not a CSS accident, and
  // it has to travel through the rank spacing as well as the boxes.
  nodeH = NODE_H,
  // Same reasoning as `nodeH` for the width: a caller that wants three lines of title needs a
  // wider card, and the equations (rank centring, gaps) have to know it.
  nodeW = NODE_W
} = {}) {
  const list = (nodes || []).map(n => (typeof n === 'string' ? { id: n, title: n } : n));
  const keys = groupBy ? [...new Set(list.map(n => groupBy(n)))].filter(k => k != null && k !== '') : [];
  if (keys.length <= 1) {
    return { ...layoutOne(list, edges, arrangement, sortBy, nodeH, nodeW), groups: [] };
  }

  // Each group is laid out by the same code as a single board, then placed: blocks stacked
  // top to bottom, centred on the widest one, each with its own header strip.
  const blocks = keys.map(key => ({
    key,
    block: layoutOne(list.filter(n => groupBy(n) === key), edges, arrangement, sortBy, nodeH, nodeW)
  }));
  const inner = Math.max(...blocks.map(b => b.block.width));
  const width = inner + groupPad * 2;
  const groups = [];
  const out = [];
  const drawnEdges = [];
  let cursor = 0;
  for (const { key, block } of blocks) {
    const h = block.height + groupHead + groupPad;
    const dx = groupPad + (inner - block.width) / 2;
    const dy = cursor + groupHead;
    for (const b of block.nodes) out.push({ ...b, x: b.x + dx, y: b.y + dy });
    // Every frame is as wide as the widest board, so the frames line up in one column
    // instead of looking like a ragged stack.
    groups.push({ key, x: 0, y: cursor, w: width, h });
    for (const e of block.edges) {
      drawnEdges.push({ ...e, x1: e.x1 + dx, y1: e.y1 + dy, x2: e.x2 + dx, y2: e.y2 + dy });
    }
    cursor += h + groupGap;
  }
  const height = cursor - groupGap;
  return {
    nodes: out,
    edges: drawnEdges,
    groups,
    width,
    height,
    ranks: Math.max(...blocks.map(b => b.block.ranks)),
    implied: blocks.reduce((n, b) => n + b.block.implied, 0),
    dangling: blocks.reduce((n, b) => n + b.block.dangling, 0),
    cyclic: blocks.some(b => b.block.cyclic),
    truncated: blocks.some(b => b.block.truncated)
  };
}

/**
 * Cross-axis ordering and placement — the pass that makes a layered drawing readable.
 *
 * Upstream (`kanban-graph`) uses four barycentre sweeps then four placement sweeps; so does
 * this. Ordering swaps neighbours whose mean position among their parents (then children, in
 * alternating sweeps) disagrees with their own, which is what removes crossings. Placement then
 * slides each task toward the mean of its neighbours, respecting a one-slot minimum and shifting
 * the whole rank so it does not drift. The result is that a parent sits ABOVE the middle of its
 * children instead of wherever its status put it.
 *
 * Returns `rows` (one array per rank, ordered) and `slots` (id -> fractional cross position,
 * already normalised so the lowest is 0).
 */
export function arrangeRows(list, rankMap, edges, by = 'status', { orderSweeps = 4, placeSweeps = 4 } = {}) {
  const cmp = rankComparator(by)
  const buckets = [];
  for (const n of list || []) {
    const r = rankMap.get(n.id) ?? 0;
    (buckets[r] = buckets[r] || []).push(n);
  }
  const rows = buckets.filter(Boolean);
  for (const row of rows) row.sort(cmp);

  const parents = new Map((list || []).map(n => [n.id, []]));
  const children = new Map((list || []).map(n => [n.id, []]));
  for (const e of edges || []) {
    if (!parents.has(e.to) || !children.has(e.from)) continue;
    parents.get(e.to).push(e.from);
    children.get(e.from).push(e.to);
  }
  const mean = (xs, f, dflt) => (xs.length ? xs.reduce((sum, x) => sum + f(x), 0) / xs.length : dflt);
  const at = new Map();
  rows.forEach(row => row.forEach((n, i) => at.set(n.id, i)));

  for (let s = 0; s < orderSweeps; s++) {
    const nb = s % 2 ? children : parents;
    const sweep = s % 2 ? [...rows].reverse() : rows;
    for (const row of sweep) {
      const key = new Map(row.map(n => [n.id, mean((nb.get(n.id) || []).map(id => at.get(id)), v => v, at.get(n.id))]));
      row.sort((a, b) => key.get(a.id) - key.get(b.id) || at.get(a.id) - at.get(b.id));
      row.forEach((n, i) => at.set(n.id, i));
    }
  }

  const pos = new Map();
  rows.forEach(row => row.forEach((n, i) => pos.set(n.id, i - (row.length - 1) / 2)));
  for (let s = 0; s < placeSweeps; s++) {
    const sweep = s % 2 ? [...rows].reverse() : rows;
    for (const row of sweep) {
      const wish = row.map(n => mean(
        [...(parents.get(n.id) || []), ...(children.get(n.id) || [])].map(id => pos.get(id)).filter(v => v !== undefined),
        v => v,
        pos.get(n.id)
      ));
      const out = [];
      wish.forEach((w, i) => out.push(i ? Math.max(w, out[i - 1] + 1) : w));
      const shift = mean(wish.map((w, i) => w - out[i]), v => v, 0);
      row.forEach((n, i) => pos.set(n.id, out[i] + shift));
    }
  }
  const values = [...pos.values()];
  const lo = values.length ? Math.min(...values) : 0;
  return { rows, slots: new Map([...pos].map(([id, v]) => [id, v - lo])) };
}

/**
 * Undirected components over the edges, plus the isolated tasks.
 *
 * A board is rarely one tree: it holds a few trees and a tail of tasks nobody has linked yet.
 * Upstream lays the trees out first and then packs those SOLO tasks into a trailing grid, side
 * by side, instead of letting each of them claim a rank of its own — which is how a board with
 * two dependencies and twenty independents ends up as twenty empty rows.
 */
export function components(nodes, edges) {
  const ids = (nodes || []).map(n => n.id);
  const root = new Map(ids.map(id => [id, id]));
  const find = v => {
    while (root.get(v) !== v) {
      root.set(v, root.get(root.get(v)));
      v = root.get(v);
    }
    return v;
  };
  for (const e of edges || []) {
    if (!root.has(e.from) || !root.has(e.to)) continue;
    root.set(find(e.from), find(e.to));
  }
  const groups = new Map();
  for (const id of ids) {
    const r = find(id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(id);
  }
  const linked = [];
  const singles = [];
  for (const group of groups.values()) {
    if (group.length > 1) linked.push(group);
    else singles.push(group[0]);
  }
  return { linked, singles };
}

/**
 * One board's layout.
 *
 * Four arrangements, the same four upstream draws: `flow` (ranks left to right), `down` (ranks
 * top to bottom), `status` (one column per status, dependency depth then age inside) and
 * `compact` (a grid, where arrows would only be noise).
 *
 * `flow` and `down` share the Sugiyama pass (`arrangeRows`): layering by longest path with the
 * reverse pass, barycentre ordering, monotone placement. `status` and `compact` are not layered
 * drawings at all — they answer "what needs me?" and "what is there?", so they place by index.
 */
function rankedOnly(list, rankMap) {
  const out = new Map();
  if (!list.length) return out;
  const values = list.map(n => rankMap.get(n.id) ?? 0);
  const lo = Math.min(...values);
  for (const n of list) out.set(n.id, (rankMap.get(n.id) ?? 0) - lo);
  return out;
}

function layoutOne(list, edges, arrangement, sortBy, nodeH = NODE_H, nodeW = NODE_W) {
  const { edges: es, dangling } = edgesWithin(list, edges);
  const { ranks: rankMap, cyclic, truncated } = ranks(list, es);
  const reduced = reduceEdges(list, es);

  let rows;
  let slots;
  let quiet = false;
  let soloIds = [];
  if (arrangement === 'status') {
    // One column per status, in workflow order; inside a column, dependency depth then title.
    const cmp = rankComparator(sortBy);
    const order = ['triage', 'todo', 'scheduled', 'ready', 'running', 'blocked', 'review', 'done', 'archived'];
    const present = [...new Set((list || []).map(n => n.status || 'todo'))]
      .sort((a, b) => {
        const ia = order.indexOf(a), ib = order.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
    rows = present.map(st => (list || [])
      .filter(n => (n.status || 'todo') === st)
      .sort((a, b) => (rankMap.get(a.id) ?? 0) - (rankMap.get(b.id) ?? 0) || cmp(a, b)));
    slots = new Map();
    for (const row of rows) row.forEach((n, i) => slots.set(n.id, i));
  } else if (arrangement === 'compact') {
    // A grid: pack by density, and say so, so the caller can hide the arrows.
    quiet = true;
    const cmp = rankComparator(sortBy);
    const sorted = [...(list || [])].sort(cmp);
    const cols = Math.max(1, Math.round(Math.sqrt(Math.max(1, sorted.length) * 1.8)));
    rows = [];
    slots = new Map();
    sorted.forEach((n, i) => {
      const r = Math.floor(i / cols);
      if (!rows[r]) rows[r] = [];
      rows[r].push(n);
      slots.set(n.id, i % cols);
    });
  } else {
    // Trees first, then the SOLO tasks packed into a trailing grid. Letting each unlinked task
    // claim a rank of its own made the whole drawing as wide as the board is long, and since a
    // fit scales the drawing to the pane, every card shrank with it. A trailing row of solos
    // keeps the graph narrow, which is what makes the cards readable.
    const { linked, singles } = components(list, es);
    const linkedSet = new Set(linked.flat());
    const layered = (list || []).filter(n => linkedSet.has(n.id));
    soloIds = singles;
    // No linked task at all: every card is a solo, and the trailing grid below places them.
    const arranged = layered.length
      ? arrangeRows(layered, rankedOnly(layered, rankMap), es, sortBy)
      : { rows: [], slots: new Map() };
    rows = arranged.rows;
    slots = arranged.slots;
  }

  // `flow` and `status` walk the ranks along X and spread a rank along Y; `down` and `compact`
  // do the opposite.
  const crossAlongY = arrangement === 'flow' || arrangement === 'status';
  const rankStep = crossAlongY ? nodeW + RANK_GAP : nodeH + RANK_GAP;
  const crossStep = crossAlongY ? nodeH + NODE_GAP : nodeW + NODE_GAP;

  const boxes = new Map();
  const placed = [];
  rows.forEach((row, r) => {
    for (const node of row) {
      const cross = (slots.get(node.id) ?? 0) * crossStep;
      // Compact is a grid: rows ARE the rank axis, columns the cross axis.
      const along = r * rankStep;
      const box = crossAlongY
        ? { id: node.id, x: along, y: cross, w: nodeW, h: nodeH, rank: r }
        : { id: node.id, x: cross, y: along, w: nodeW, h: nodeH, rank: r };
      boxes.set(node.id, box);
      placed.push(box);
    }
  });

  // The trailing grid of solo tasks: side by side, lines stacked along the rank axis. Packed
  // against the wide side of the drawing, so the graph grows downward (or rightward) instead of
  // sideways — a narrow drawing is a drawing whose cards the fit can afford to keep big.
  if (soloIds.length) {
    const byId = new Map((list || []).map(n => [n.id, n]));
    const cmp = rankComparator(sortBy);
    const solos = soloIds.filter(id => byId.has(id)).sort((a, b) => cmp(byId.get(a), byId.get(b)));
    const crossMin = placed.length ? Math.min(...placed.map(b => (crossAlongY ? b.y : b.x))) : 0;
    const crossMax = placed.length ? Math.max(...placed.map(b => (crossAlongY ? b.y + b.h : b.x + b.w))) : 0;
    const alongMax = placed.length ? Math.max(...placed.map(b => (crossAlongY ? b.x + b.w : b.y + b.h))) : -RANK_GAP;
    // At least SOLO_COLS columns, and never wider than the trees above: upstream uses a minimum
    // of five, and a single-column grid would stack the solos down the page, which is exactly
    // the tall drawing this packing exists to avoid.
    const SOLO_COLS = 5;
    const fits = Math.round((crossMax - crossMin + NODE_GAP) / crossStep) || 1;
    const cols = Math.max(1, Math.min(solos.length, Math.max(Math.min(SOLO_COLS, solos.length), fits)));
    solos.forEach((id, i) => {
      const line = Math.floor(i / cols);
      const cross = crossMin + (i % cols) * crossStep;
      const along = alongMax + (crossAlongY ? RANK_GAP : RANK_GAP) + line * crossStep;
      const box = crossAlongY
        ? { id, x: along, y: cross, w: nodeW, h: nodeH, rank: rows.length + line }
        : { id, x: cross, y: along, w: nodeW, h: nodeH, rank: rows.length + line };
      boxes.set(id, box);
      placed.push(box);
    });
  }

  // Normalise to a positive origin: SVG does not care, but hit tests and scroll maths do.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of placed) {
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  }
  if (!placed.length) { minX = 0; minY = 0; maxX = 0; maxY = 0; }
  for (const b of placed) { b.x -= minX; b.y -= minY; }

  const drawn = [];
  if (!quiet) {
    for (const e of reduced.edges) {
      const a = boxes.get(e.from), b = boxes.get(e.to);
      if (!a || !b) continue;
      drawn.push(crossAlongY
        ? { from: e.from, to: e.to, x1: a.x + a.w, y1: a.y + a.h / 2, x2: b.x, y2: b.y + b.h / 2 }
        : { from: e.from, to: e.to, x1: a.x + a.w / 2, y1: a.y + a.h, x2: b.x + b.w / 2, y2: b.y });
    }
  }

  return {
    nodes: placed,
    edges: drawn,
    width: maxX - minX,
    height: maxY - minY,
    ranks: rows.length,
    implied: reduced.implied,
    dangling,
    cyclic,
    truncated,
    quiet
  };
}

/** The quick scopes, in the order the segmented control shows them. Their DEFAULT is `all`,
 *  because a first visit to a board where nothing runs must not open on an empty canvas.
 *
 *  `running` and `blocked` are single statuses; `lineage` is not a scope but a modifier on top of
 *  whichever scope is chosen (see `scopeIds`), which is why the two are independent controls: a
 *  reader who wants "blocked, and everything that leads to or follows it" was previously stuck
 *  with a scope that only knew about running work. */
export const SCOPES = ['running', 'blocked', 'open', 'all']

/** Which ids a scope keeps. Pure, so the footer's "N hidden" is assertable.
 *
 *  With `lineage`, the kept set grows to the full upstream and downstream closure of what the scope
 *  selected — the same closure a click on a card highlights, applied to the whole selection. `all`
 *  ignores it: the closure of everything is everything. */
export function scopeIds(nodes, edges, scope, { lineage: withLineage = false } = {}) {
  const list = (nodes || []).map(n => (typeof n === 'string' ? { id: n, status: undefined } : n));
  const ids = new Set(list.map(n => n.id));
  let keep;
  if (scope === 'running') {
    keep = new Set(list.filter(n => n.status === 'running').map(n => n.id));
  } else if (scope === 'blocked') {
    keep = new Set(list.filter(n => n.status === 'blocked').map(n => n.id));
  } else if (scope === 'open') {
    keep = new Set(list.filter(n => n.status !== 'done' && n.status !== 'archived').map(n => n.id));
  } else {
    return ids;
  }
  if (!withLineage) return keep;
  const grown = new Set(keep);
  for (const id of keep) {
    const { upstream, downstream } = lineage(list, (edges || []).filter(e => ids.has(e.from) && ids.has(e.to)), id);
    for (const u of upstream) grown.add(u);
    for (const d of downstream) grown.add(d);
  }
  return grown;
}
