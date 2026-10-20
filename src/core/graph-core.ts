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
export function layoutGraph(nodes, edges, { arrangement = 'down', sortBy = 'status' } = {}) {
  const list = (nodes || []).map(n => (typeof n === 'string' ? { id: n, title: n } : n));
  const { edges: es, dangling } = edgesWithin(list, edges);
  const { ranks: rankMap, cyclic, truncated } = ranks(list, es);
  const reduced = reduceEdges(list, es);
  const rows = orderRanks(list, rankMap, sortBy);
  const vertical = arrangement !== 'flow';

  const boxes = new Map();
  const placed = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    // Centre each rank on the longest one, so the graph reads as a tree rather than as
    // a staircase of left-aligned blocks.
    const extent = row.length * (vertical ? NODE_W + NODE_GAP : NODE_H + NODE_GAP) - NODE_GAP;
    let offset = -extent / 2;
    for (const node of row) {
      const box = vertical
        ? { id: node.id, x: offset, y: r * (NODE_H + RANK_GAP), w: NODE_W, h: NODE_H, rank: r }
        : { id: node.id, x: r * (NODE_W + RANK_GAP), y: offset, w: NODE_W, h: NODE_H, rank: r };
      offset += (vertical ? NODE_W + NODE_GAP : NODE_H + NODE_GAP);
      boxes.set(node.id, box);
      placed.push(box);
    }
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
  for (const e of reduced.edges) {
    const a = boxes.get(e.from), b = boxes.get(e.to);
    if (!a || !b) continue;
    drawn.push(vertical
      ? { from: e.from, to: e.to, x1: a.x + a.w / 2, y1: a.y + a.h, x2: b.x + b.w / 2, y2: b.y }
      : { from: e.from, to: e.to, x1: a.x + a.w, y1: a.y + a.h / 2, x2: b.x, y2: b.y + b.h / 2 });
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
    truncated
  };
}

/** The quick scopes, in the order the segmented control shows them — the same order
 *  `kanban-graph` uses (Running + lineage, Open, All), so a reader who knows one plugin
 *  finds the same control in the other. Their DEFAULT is `running`; ours stays `all`,
 *  because a first visit to a board where nothing runs must not open on an empty canvas. */
export const SCOPES = ['running-lineage', 'open', 'all'];

/** Which ids a scope keeps. Pure, so the footer's "N hidden" is assertable. */
export function scopeIds(nodes, edges, scope) {
  const list = (nodes || []).map(n => (typeof n === 'string' ? { id: n, status: undefined } : n));
  if (scope === 'open') {
    return new Set(list.filter(n => n.status !== 'done' && n.status !== 'archived').map(n => n.id));
  }
  if (scope !== 'running-lineage') return new Set(list.map(n => n.id));
  const running = list.filter(n => n.status === 'running').map(n => n.id);
  const keep = new Set(running);
  for (const id of running) {
    const { upstream, downstream } = lineage(list, edges, id);
    for (const u of upstream) keep.add(u);
    for (const d of downstream) keep.add(d);
  }
  return keep;
}
