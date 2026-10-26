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
  const topo = queue.slice();
  for (let i = topo.length - 1; i >= 0; i--) {
    const kids = (children.get(topo[i]) || []).filter((c) => settled.has(c));
    if (!kids.length) continue;
    out.set(topo[i], Math.min(...kids.map((c) => out.get(c))) - 1);
  }
  const lo = Math.min(...ids.map((id) => out.get(id)));
  if (lo !== 0) for (const id of ids) out.set(id, out.get(id) - lo);
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
function nearestInHalo(rects, x, y, radius, { exclude = null, allowed = null } = {}) {
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
function layoutGraph(nodes, edges, {
  arrangement = "down",
  sortBy = "status",
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
  const list = (nodes || []).map((n) => typeof n === "string" ? { id: n, title: n } : n);
  const keys = groupBy ? [...new Set(list.map((n) => groupBy(n)))].filter((k) => k != null && k !== "") : [];
  if (keys.length <= 1) {
    return { ...layoutOne(list, edges, arrangement, sortBy, nodeH, nodeW), groups: [] };
  }
  const blocks = keys.map((key) => ({
    key,
    block: layoutOne(list.filter((n) => groupBy(n) === key), edges, arrangement, sortBy, nodeH, nodeW)
  }));
  const inner = Math.max(...blocks.map((b) => b.block.width));
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
    ranks: Math.max(...blocks.map((b) => b.block.ranks)),
    implied: blocks.reduce((n, b) => n + b.block.implied, 0),
    dangling: blocks.reduce((n, b) => n + b.block.dangling, 0),
    cyclic: blocks.some((b) => b.block.cyclic),
    truncated: blocks.some((b) => b.block.truncated)
  };
}
function arrangeRows(list, rankMap, edges, by = "status", { orderSweeps = 4, placeSweeps = 4 } = {}) {
  const cmp = rankComparator(by);
  const buckets = [];
  for (const n of list || []) {
    const r = rankMap.get(n.id) ?? 0;
    (buckets[r] = buckets[r] || []).push(n);
  }
  const rows = buckets.filter(Boolean);
  for (const row of rows) row.sort(cmp);
  const parents = new Map((list || []).map((n) => [n.id, []]));
  const children = new Map((list || []).map((n) => [n.id, []]));
  for (const e of edges || []) {
    if (!parents.has(e.to) || !children.has(e.from)) continue;
    parents.get(e.to).push(e.from);
    children.get(e.from).push(e.to);
  }
  const mean = (xs, f, dflt) => xs.length ? xs.reduce((sum, x) => sum + f(x), 0) / xs.length : dflt;
  const at = /* @__PURE__ */ new Map();
  rows.forEach((row) => row.forEach((n, i) => at.set(n.id, i)));
  for (let s = 0; s < orderSweeps; s++) {
    const nb = s % 2 ? children : parents;
    const sweep = s % 2 ? [...rows].reverse() : rows;
    for (const row of sweep) {
      const key = new Map(row.map((n) => [n.id, mean((nb.get(n.id) || []).map((id) => at.get(id)), (v) => v, at.get(n.id))]));
      row.sort((a, b) => key.get(a.id) - key.get(b.id) || at.get(a.id) - at.get(b.id));
      row.forEach((n, i) => at.set(n.id, i));
    }
  }
  const pos = /* @__PURE__ */ new Map();
  rows.forEach((row) => row.forEach((n, i) => pos.set(n.id, i - (row.length - 1) / 2)));
  for (let s = 0; s < placeSweeps; s++) {
    const sweep = s % 2 ? [...rows].reverse() : rows;
    for (const row of sweep) {
      const wish = row.map((n) => mean(
        [...parents.get(n.id) || [], ...children.get(n.id) || []].map((id) => pos.get(id)).filter((v) => v !== void 0),
        (v) => v,
        pos.get(n.id)
      ));
      const out = [];
      wish.forEach((w, i) => out.push(i ? Math.max(w, out[i - 1] + 1) : w));
      const shift = mean(wish.map((w, i) => w - out[i]), (v) => v, 0);
      row.forEach((n, i) => pos.set(n.id, out[i] + shift));
    }
  }
  const values = [...pos.values()];
  const lo = values.length ? Math.min(...values) : 0;
  return { rows, slots: new Map([...pos].map(([id, v]) => [id, v - lo])) };
}
function centreOverChildren(rows, pos, edges) {
  const kids = /* @__PURE__ */ new Map();
  for (const e of edges || []) {
    if (!kids.has(e.from)) kids.set(e.from, []);
    kids.get(e.from).push(e.to);
  }
  const out = new Map(pos);
  for (const row of rows || []) {
    for (let i = 0; i < row.length; i++) {
      const id = row[i].id;
      const children = (kids.get(id) || []).filter((c) => out.has(c));
      if (!children.length) continue;
      const want = children.reduce((sum, c) => sum + out.get(c), 0) / children.length;
      if (!Number.isFinite(want)) continue;
      const left = i > 0 ? out.get(row[i - 1].id) : -Infinity;
      const right = i < row.length - 1 ? out.get(row[i + 1].id) : Infinity;
      if (!(want > left + 1e-9 && want < right - 1e-9)) continue;
      out.set(id, want);
    }
  }
  return out;
}
function components(nodes, edges) {
  const ids = (nodes || []).map((n) => n.id);
  const root = new Map(ids.map((id) => [id, id]));
  const find = (v) => {
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
  const groups = /* @__PURE__ */ new Map();
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
function rankedOnly(list, rankMap) {
  const out = /* @__PURE__ */ new Map();
  if (!list.length) return out;
  const values = list.map((n) => rankMap.get(n.id) ?? 0);
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
  if (arrangement === "status") {
    const cmp = rankComparator(sortBy);
    const order = ["triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done", "archived"];
    const present = [...new Set((list || []).map((n) => n.status || "todo"))].sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    rows = present.map((st) => (list || []).filter((n) => (n.status || "todo") === st).sort((a, b) => (rankMap.get(a.id) ?? 0) - (rankMap.get(b.id) ?? 0) || cmp(a, b)));
    slots = /* @__PURE__ */ new Map();
    for (const row of rows) row.forEach((n, i) => slots.set(n.id, i));
  } else if (arrangement === "compact") {
    quiet = true;
    const cmp = rankComparator(sortBy);
    const sorted = [...list || []].sort(cmp);
    const cols = Math.max(1, Math.round(Math.sqrt(Math.max(1, sorted.length) * 1.8)));
    rows = [];
    slots = /* @__PURE__ */ new Map();
    sorted.forEach((n, i) => {
      const r = Math.floor(i / cols);
      if (!rows[r]) rows[r] = [];
      rows[r].push(n);
      slots.set(n.id, i % cols);
    });
  } else {
    const { linked, singles } = components(list, es);
    const linkedSet = new Set(linked.flat());
    const layered = (list || []).filter((n) => linkedSet.has(n.id));
    soloIds = singles;
    const arranged = layered.length ? arrangeRows(layered, rankedOnly(layered, rankMap), es, sortBy) : { rows: [], slots: /* @__PURE__ */ new Map() };
    rows = arranged.rows;
    slots = arranged.slots;
  }
  slots = centreOverChildren(rows, slots, es);
  const crossAlongY = arrangement === "flow" || arrangement === "status";
  const rankStep = crossAlongY ? nodeW + RANK_GAP : nodeH + RANK_GAP;
  const crossStep = crossAlongY ? nodeH + NODE_GAP : nodeW + NODE_GAP;
  const boxes = /* @__PURE__ */ new Map();
  const placed = [];
  rows.forEach((row, r) => {
    for (const node of row) {
      const cross = (slots.get(node.id) ?? 0) * crossStep;
      const along = r * rankStep;
      const box = crossAlongY ? { id: node.id, x: along, y: cross, w: nodeW, h: nodeH, rank: r } : { id: node.id, x: cross, y: along, w: nodeW, h: nodeH, rank: r };
      boxes.set(node.id, box);
      placed.push(box);
    }
  });
  if (soloIds.length) {
    const byId = new Map((list || []).map((n) => [n.id, n]));
    const cmp = rankComparator(sortBy);
    const solos = soloIds.filter((id) => byId.has(id)).sort((a, b) => cmp(byId.get(a), byId.get(b)));
    const crossMin = placed.length ? Math.min(...placed.map((b) => crossAlongY ? b.y : b.x)) : 0;
    const crossMax = placed.length ? Math.max(...placed.map((b) => crossAlongY ? b.y + b.h : b.x + b.w)) : 0;
    const alongMax = placed.length ? Math.max(...placed.map((b) => crossAlongY ? b.x + b.w : b.y + b.h)) : -RANK_GAP;
    const SOLO_COLS = 5;
    const fits = Math.round((crossMax - crossMin + NODE_GAP) / crossStep) || 1;
    const cols = Math.max(1, Math.min(solos.length, Math.max(Math.min(SOLO_COLS, solos.length), fits)));
    solos.forEach((id, i) => {
      const line = Math.floor(i / cols);
      const cross = crossMin + i % cols * crossStep;
      const along = alongMax + (crossAlongY ? RANK_GAP : RANK_GAP) + line * crossStep;
      const box = crossAlongY ? { id, x: along, y: cross, w: nodeW, h: nodeH, rank: rows.length + line } : { id, x: cross, y: along, w: nodeW, h: nodeH, rank: rows.length + line };
      boxes.set(id, box);
      placed.push(box);
    });
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
  if (!quiet) {
    for (const e of reduced.edges) {
      const a = boxes.get(e.from), b = boxes.get(e.to);
      if (!a || !b) continue;
      drawn.push(crossAlongY ? { from: e.from, to: e.to, x1: a.x + a.w, y1: a.y + a.h / 2, x2: b.x, y2: b.y + b.h / 2 } : { from: e.from, to: e.to, x1: a.x + a.w / 2, y1: a.y + a.h, x2: b.x + b.w / 2, y2: b.y });
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
function boardScope(tasks, scope, { lineage: lineage2 = false } = {}) {
  const list = tasks || [];
  const ids = scopeIds(graphNodes(list), graphEdges(list), scope, { lineage: lineage2 });
  const active = scope !== "all";
  return { ids, narrows: active, widens: active && Boolean(lineage2) };
}
function scopeCounts(tasks, { lineage: lineage2 = false, only = null } = {}) {
  const list = tasks || [];
  const nodes = graphNodes(list);
  const edges = graphEdges(list);
  const out = {};
  for (const scope of SCOPES) {
    const ids = scopeIds(nodes, edges, scope, { lineage: lineage2 });
    let n = 0;
    for (const t of list) if (ids.has(t.id) && (!only || only.has(t.id))) n++;
    out[scope] = n;
  }
  return out;
}
var SCOPES = ["running", "blocked", "open", "all"];
function scopeIds(nodes, edges, scope, { lineage: withLineage = false } = {}) {
  const list = (nodes || []).map((n) => typeof n === "string" ? { id: n, status: void 0 } : n);
  const ids = new Set(list.map((n) => n.id));
  let keep;
  if (scope === "running") {
    keep = new Set(list.filter((n) => n.status === "running").map((n) => n.id));
  } else if (scope === "blocked") {
    keep = new Set(list.filter((n) => n.status === "blocked").map((n) => n.id));
  } else if (scope === "open") {
    keep = new Set(list.filter((n) => n.status !== "done" && n.status !== "archived").map((n) => n.id));
  } else {
    return ids;
  }
  if (!withLineage) return keep;
  const grown = new Set(keep);
  for (const id of keep) {
    const { upstream, downstream } = lineage(list, (edges || []).filter((e) => ids.has(e.from) && ids.has(e.to)), id);
    for (const u of upstream) grown.add(u);
    for (const d of downstream) grown.add(d);
  }
  return grown;
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
  arrangeRows,
  boardScope,
  centreOverChildren,
  components,
  dedupeEdges,
  edgesWithin,
  graphEdges,
  graphNodes,
  layoutGraph,
  lineage,
  nearestInHalo,
  orderRanks,
  rankComparator,
  ranks,
  reduceEdges,
  scopeCounts,
  scopeIds
};
