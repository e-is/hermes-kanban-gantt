// src/core/graph-core.ts
var NODE_W = 172;
var NODE_H = 62;
var SPARK_BAND = 7;
var NODE_GAP = 14;
var RANK_GAP = 52;
var idOf = (ref) => ref && typeof ref === "object" ? ref.id : ref;
function graphNodes(tasks) {
  return (tasks || []).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority ?? null,
    assignee: t.assignee || "",
    board: t.board || "",
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
function dedupeEdges(edges, { keepSelf = false } = {}) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const e of edges || []) {
    const from = idOf(e && e.from);
    const to = idOf(e && e.to);
    if (typeof from !== "string" || typeof to !== "string" || !from || !to) continue;
    if (from === to && !keepSelf) continue;
    const key = from + "\0" + to;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from, to });
  }
  return out;
}
function graphEdges(tasks) {
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
function edgesWithin(nodes, edges) {
  const known = new Set((nodes || []).map((n) => typeof n === "string" ? n : n.id));
  const kept = [];
  let dangling = 0;
  for (const e of dedupeEdges(edges)) {
    if (known.has(e.from) && known.has(e.to)) kept.push(e);
    else dangling++;
  }
  return { edges: kept, dangling };
}
function ranks(nodes, edges, { depthCap = 4096 } = {}) {
  const ids = (nodes || []).map((n) => typeof n === "string" ? n : n.id);
  const out = new Map(ids.map((id) => [id, 0]));
  const { edges: es } = edgesWithin(ids, edges);
  const children = new Map(ids.map((id) => [id, []]));
  const indegree = new Map(ids.map((id) => [id, 0]));
  for (const e of es) {
    children.get(e.from).push(e.to);
    indegree.set(e.to, indegree.get(e.to) + 1);
  }
  const queue = ids.filter((id) => indegree.get(id) === 0).sort();
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
  const leftover = ids.filter((id) => !settled.has(id));
  const cyclic = [];
  let truncated = false;
  if (leftover.length) {
    const inLeftover = new Set(leftover);
    const onLoop = /* @__PURE__ */ new Set();
    for (const id of leftover) {
      const seen = /* @__PURE__ */ new Set();
      const stack = (children.get(id) || []).filter((c) => inLeftover.has(c));
      while (stack.length) {
        const cur = stack.pop();
        if (cur === id) {
          onLoop.add(id);
          break;
        }
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const next of children.get(cur) || []) if (inLeftover.has(next)) stack.push(next);
      }
    }
    const band = Math.max(0, ...[...settled].map((id) => out.get(id))) + 1;
    for (const id of onLoop) out.set(id, Math.min(band, depthCap));
    cyclic.push(...[...onLoop].sort());
    const rest = leftover.filter((id) => !onLoop.has(id));
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
var STATUS_ORDER = ["triage", "todo", "scheduled", "ready", "running", "review", "blocked", "done", "archived"];
var priorityValue = (p) => typeof p === "number" ? p : Number(p) || 0;
function rankComparator(by) {
  const title = (a, b) => String(a.title || "").localeCompare(String(b.title || ""), void 0, { numeric: true });
  return (a, b) => {
    let d = 0;
    if (by === "status") {
      const sa = STATUS_ORDER.indexOf(a.status), sb = STATUS_ORDER.indexOf(b.status);
      d = (sa < 0 ? 99 : sa) - (sb < 0 ? 99 : sb);
    } else if (by === "assignee") {
      d = String(a.assignee || "￿").localeCompare(String(b.assignee || "￿"));
    } else if (by === "priority") {
      d = priorityValue(a.priority) - priorityValue(b.priority);
    } else if (by === "updated") {
      d = (b.startedAt || 0) - (a.startedAt || 0);
    }
    if (d !== 0) return d;
    return title(a, b) || String(a.id).localeCompare(String(b.id));
  };
}
function orderRanks(nodes, rankMap, by = "status") {
  const cmp = rankComparator(by);
  const rows = [];
  for (const n of nodes || []) {
    const r = rankMap.get(n.id) ?? 0;
    (rows[r] = rows[r] || []).push(n);
  }
  return rows.filter(Boolean).map((row) => row.sort(cmp));
}
function reduceEdges(nodes, edges) {
  const { edges: es } = edgesWithin(nodes, edges);
  const children = /* @__PURE__ */ new Map();
  for (const e of es) {
    if (!children.has(e.from)) children.set(e.from, []);
    children.get(e.from).push(e.to);
  }
  const kept = [];
  let implied = 0;
  for (const e of es) {
    const seen = /* @__PURE__ */ new Set();
    const stack = (children.get(e.from) || []).filter((c) => c !== e.to);
    let bypass = false;
    while (stack.length) {
      const cur = stack.pop();
      if (cur === e.to) {
        bypass = true;
        break;
      }
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const next of children.get(cur) || []) stack.push(next);
    }
    if (bypass) implied++;
    else kept.push(e);
  }
  return { edges: kept, implied };
}
function lineage(nodes, edges, id) {
  const { edges: es } = edgesWithin(nodes, edges);
  const up = /* @__PURE__ */ new Map();
  const down = /* @__PURE__ */ new Map();
  for (const e of es) {
    if (!up.has(e.to)) up.set(e.to, []);
    up.get(e.to).push(e.from);
    if (!down.has(e.from)) down.set(e.from, []);
    down.get(e.from).push(e.to);
  }
  const walk = (start, adjacency) => {
    const seen = /* @__PURE__ */ new Set();
    const stack = [...adjacency.get(start) || []];
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
function activityBuckets(node, now, windowSec, count) {
  if (Array.isArray(node?.activity) && node.activity.length) {
    const buckets2 = node.activity.slice(-count).map((v) => Number(v) || 0);
    const max2 = buckets2.reduce((m, v) => v > m ? v : m, 0);
    return max2 > 0 ? { buckets: buckets2, max: max2 } : null;
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
  const max = buckets.reduce((m, v) => v > m ? v : m, 0);
  return { buckets, max };
}
function activityMap(nodes, now, windowSec, count) {
  const out = /* @__PURE__ */ new Map();
  for (const n of nodes || []) {
    const series = activityBuckets(n, now, windowSec, count);
    if (series) out.set(n.id, series);
  }
  return out;
}
function layoutGraph(nodes, edges, { arrangement = "down", sortBy = "status" } = {}) {
  const list = (nodes || []).map((n) => typeof n === "string" ? { id: n, title: n } : n);
  const { edges: es, dangling } = edgesWithin(list, edges);
  const { ranks: rankMap, cyclic, truncated } = ranks(list, es);
  const reduced = reduceEdges(list, es);
  const rows = orderRanks(list, rankMap, sortBy);
  const vertical = arrangement !== "flow";
  const boxes = /* @__PURE__ */ new Map();
  const placed = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const extent = row.length * (vertical ? NODE_W + NODE_GAP : NODE_H + NODE_GAP) - NODE_GAP;
    let offset = -extent / 2;
    for (const node of row) {
      const box = vertical ? { id: node.id, x: offset, y: r * (NODE_H + RANK_GAP), w: NODE_W, h: NODE_H, rank: r } : { id: node.id, x: r * (NODE_W + RANK_GAP), y: offset, w: NODE_W, h: NODE_H, rank: r };
      offset += vertical ? NODE_W + NODE_GAP : NODE_H + NODE_GAP;
      boxes.set(node.id, box);
      placed.push(box);
    }
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of placed) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  if (!placed.length) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }
  for (const b of placed) {
    b.x -= minX;
    b.y -= minY;
  }
  const drawn = [];
  for (const e of reduced.edges) {
    const a = boxes.get(e.from), b = boxes.get(e.to);
    if (!a || !b) continue;
    drawn.push(vertical ? { from: e.from, to: e.to, x1: a.x + a.w / 2, y1: a.y + a.h, x2: b.x + b.w / 2, y2: b.y } : { from: e.from, to: e.to, x1: a.x + a.w, y1: a.y + a.h / 2, x2: b.x, y2: b.y + b.h / 2 });
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
var SCOPES = ["running-lineage", "open", "all"];
function scopeIds(nodes, edges, scope) {
  const list = (nodes || []).map((n) => typeof n === "string" ? { id: n, status: void 0 } : n);
  if (scope === "open") {
    return new Set(list.filter((n) => n.status !== "done" && n.status !== "archived").map((n) => n.id));
  }
  if (scope !== "running-lineage") return new Set(list.map((n) => n.id));
  const running = list.filter((n) => n.status === "running").map((n) => n.id);
  const keep = new Set(running);
  for (const id of running) {
    const { upstream, downstream } = lineage(list, edges, id);
    for (const u of upstream) keep.add(u);
    for (const d of downstream) keep.add(d);
  }
  return keep;
}
export {
  NODE_GAP,
  NODE_H,
  NODE_W,
  RANK_GAP,
  SCOPES,
  SPARK_BAND,
  STATUS_ORDER,
  activityBuckets,
  activityMap,
  dedupeEdges,
  edgesWithin,
  graphEdges,
  graphNodes,
  layoutGraph,
  lineage,
  orderRanks,
  rankComparator,
  ranks,
  reduceEdges,
  scopeIds
};
