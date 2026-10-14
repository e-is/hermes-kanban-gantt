// src/core/gantt-core.ts
var DAY = 86400;
var MIN_BAR = 2 * 3600;
var STATUS_TONE = {
  triage: "var(--ui-text-tertiary)",
  todo: "var(--ui-text-secondary)",
  scheduled: "#a78bfa",
  ready: "#60a5fa",
  running: "#34d399",
  blocked: "#e0a13a",
  review: "#f472b6",
  done: "var(--ui-text-tertiary)",
  archived: "var(--ui-text-quaternary)"
};
function statusTone(status) {
  return STATUS_TONE[status] || "var(--ui-text-secondary)";
}
var HARD_FAILURES = ["crashed", "failed", "spawn_failed", "gave_up"];
var FAIL_TONE = "#ef5350";
var RUN_TONE = "#5b8def";
function runTone(outcome, ongoing) {
  if (ongoing) return statusTone("running");
  const o = String(outcome || "").toLowerCase();
  if (HARD_FAILURES.includes(o)) return FAIL_TONE;
  if (o === "blocked") return statusTone("blocked");
  if (o === "completed" || o === "done") return statusTone("done");
  return RUN_TONE;
}
function hourTickPlan(pxPerHour, minLabelPx = 56) {
  if (!(pxPerHour >= 24)) return null;
  const step = [1, 2, 3, 6, 12].find((s) => s * pxPerHour >= minLabelPx) || 12;
  return { step };
}
function maxZoom(basePerSec, maxPxPerHour = 240) {
  const perHour = basePerSec * 3600;
  if (!(perHour > 0)) return 1;
  return Math.max(1, maxPxPerHour / perHour);
}
function clampZoom(zoom, basePerSec, maxPxPerHour = 240) {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(maxZoom(basePerSec, maxPxPerHour), Math.max(0.2, zoom));
}
var ZOOM_PCT_MIN = 1;
var ZOOM_PCT_MAX = 100;
function clampZoomPct(pct) {
  const p = Number(pct);
  if (!Number.isFinite(p)) return ZOOM_PCT_MIN;
  return Math.min(ZOOM_PCT_MAX, Math.max(ZOOM_PCT_MIN, Math.round(p)));
}
function zoomFactorFromPct(pct, minFactor, maxFactor) {
  const lo = Math.max(1e-9, minFactor);
  const hi = Math.max(lo, maxFactor);
  const span = ZOOM_PCT_MAX - ZOOM_PCT_MIN;
  return lo * Math.pow(hi / lo, (clampZoomPct(pct) - ZOOM_PCT_MIN) / span);
}
function zoomPctFromFactor(factor, minFactor, maxFactor) {
  const lo = Math.max(1e-9, minFactor);
  const hi = Math.max(lo, maxFactor);
  const step = Math.log(hi / lo);
  if (!(step > 0)) return ZOOM_PCT_MIN;
  const read = Math.log(Math.max(1e-9, factor) / lo) / step;
  return clampZoomPct(ZOOM_PCT_MIN + read * (ZOOM_PCT_MAX - ZOOM_PCT_MIN));
}
function nowOffset(now, min, max, pxPerSec) {
  if (!(now >= min && now <= max)) return null;
  return Math.round((now - min) * pxPerSec);
}
function wheelZoomFactor(deltaY, deltaMode = 0) {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? 100 : 1;
  const factor = Math.exp(-(deltaY * unit) / 400);
  return Math.min(1.4, Math.max(1 / 1.4, factor));
}
var PERIODS = [6 * 3600, 12 * 3600, 24 * 3600, 3 * DAY, 7 * DAY];
var PERIOD_TOLERANCE = 6 * 3600;
function periodPxPerSec(span, clientWidth, labelW) {
  const width = clientWidth - labelW;
  if (!(span > 0) || !(width > 0)) return null;
  return width / span;
}
function periodScrollLeft({ from, to, min, pxPerSec, clientWidth, labelW }) {
  if (!(pxPerSec > 0) || !(clientWidth > 0)) return null;
  return Math.max(0, Math.round(labelW + (to - min) * pxPerSec - clientWidth));
}
function visibleWindow({ min, pxPerSec, scrollLeft, clientWidth, labelW }) {
  if (!(pxPerSec > 0)) return null;
  return {
    from: min + scrollLeft / pxPerSec,
    to: min + (scrollLeft + clientWidth - labelW) / pxPerSec
  };
}
function matchPeriod(visible, now, tolerance = PERIOD_TOLERANCE, periods = PERIODS) {
  if (!visible || !Number.isFinite(visible.from) || !Number.isFinite(visible.to)) return null;
  let best = null;
  let bestGap = Infinity;
  for (const span of periods) {
    const sizeGap = Math.abs(visible.to - visible.from - span);
    const edgeGap = Math.abs(now - visible.to);
    if (sizeGap > tolerance || edgeGap > tolerance) continue;
    const gap = sizeGap + edgeGap;
    if (gap < bestGap) {
      bestGap = gap;
      best = span;
    }
  }
  return best;
}
function nowLineX(now, min, max, pxPerSec, originX = 0) {
  const offset = nowOffset(now, min, max, pxPerSec);
  return offset == null ? null : originX + offset;
}
var STATUS_ICON = {
  triage: "question",
  todo: "circle-large-outline",
  scheduled: "clock",
  ready: "play-circle",
  running: "pulse",
  blocked: "warning",
  review: "eye",
  done: "check",
  archived: "archive"
};
function statusIcon(status) {
  return STATUS_ICON[status] || "circle-large-outline";
}
var TERMINAL_STATUSES = ["done", "archived"];
function isTerminal(status) {
  return TERMINAL_STATUSES.indexOf(status) !== -1;
}
function descendantsOf(tasks, rootId) {
  const adj = /* @__PURE__ */ new Map();
  for (const t of tasks) adj.set(t.id, t.children || []);
  const out = /* @__PURE__ */ new Set();
  const stack = [...adj.get(rootId) || []];
  while (stack.length) {
    const id = stack.pop();
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...adj.get(id) || []);
  }
  return out;
}
function isDescendant(tasks, ancestorId, candidateId) {
  return descendantsOf(tasks, ancestorId).has(candidateId);
}
function relationsOf(tasks, taskId) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const task = byId.get(taskId);
  if (!task) return { parents: [], children: [] };
  const pick = (ids) => (ids || []).map((id) => byId.get(id)).filter(Boolean);
  return { parents: pick(task.parents), children: pick(task.children) };
}
function dropCandidates(tasks, draggedId, boardSlug) {
  const dragged = tasks.find((t) => t.id === draggedId);
  const below = descendantsOf(tasks, draggedId);
  const alreadyLinked = new Set(dragged && dragged.parents || []);
  return tasks.map((task) => {
    let reason = null;
    if (task.id === draggedId) reason = "self";
    else if (below.has(task.id)) reason = "descendant";
    else if (boardSlug && task.board && task.board !== boardSlug) reason = "other-board";
    else if (alreadyLinked.has(task.id)) reason = "linked";
    return { task, allowed: reason === null, reason };
  });
}
function barRange(task, now, minBarSec) {
  const min = minBarSec || MIN_BAR;
  const rs = task.run_started_at;
  const re = task.run_ended_at;
  const realRun = rs != null && re != null && rs < re;
  if (task.status === "done" || task.status === "archived") {
    if (realRun) {
      return { t0: rs, t1: Math.max(rs + min, re), kind: "done", tone: statusTone(task.status) };
    }
    const anchor = task.completed_at ?? task.created_at;
    if (anchor == null) return null;
    return { t0: anchor, t1: anchor + min, kind: "done-instant" };
  }
  if (task.status === "running" || task.status === "review") {
    const start = task.run_started_at ?? task.started_at ?? task.created_at ?? now;
    return { t0: start, t1: Math.max(start + min, now), kind: "progress", tone: statusTone(task.status) };
  }
  if (task.started_at) {
    return { t0: task.started_at, t1: now, kind: "progress", tone: statusTone(task.status) };
  }
  const c = task.created_at;
  return c ? { t0: c, t1: c + min, kind: "todo", tone: statusTone(task.status) } : null;
}
function taskBars(task, now, minBarSec) {
  const min = minBarSec || MIN_BAR;
  const runs = Array.isArray(task.runs) ? task.runs : [];
  const validRuns = runs.filter((r) => r && r.started_at != null);
  if (task.status === "blocked") {
    const bars = [];
    for (const r of validRuns) {
      const s = r.started_at;
      const e = r.ended_at;
      if (e == null || e <= s) continue;
      bars.push({
        t0: s,
        t1: Math.max(s + min, e),
        kind: "done",
        tone: runTone(r.outcome || r.status),
        runId: r.id,
        profile: r.profile,
        outcome: r.outcome || r.status
      });
    }
    const waitStart = bars.length ? bars[bars.length - 1].t1 : task.created_at ?? task.started_at ?? now;
    bars.push({
      t0: waitStart,
      t1: Math.max(waitStart + min, now),
      kind: "blocked-wait",
      tone: statusTone("blocked")
    });
    return bars;
  }
  if (validRuns.length > 1) {
    const bars = [];
    for (const r of validRuns) {
      const s = r.started_at;
      const e = r.ended_at;
      const isOngoing = (e == null || r.status === "running") && (task.status === "running" || task.status === "review");
      const t1 = isOngoing ? Math.max(s + min, now) : e != null ? Math.max(s + min, e) : s + min;
      const tone = runTone(r.outcome || r.status, isOngoing);
      bars.push({
        t0: s,
        t1,
        kind: isOngoing ? "progress" : "done",
        tone,
        runId: r.id,
        profile: r.profile,
        outcome: r.outcome || r.status,
        isOngoing
      });
    }
    return bars;
  }
  const single = barRange(task, now, min);
  return single ? [single] : [];
}
function resolveBoardSlug(stored, known, current) {
  const remembered = typeof stored === "string" ? stored.trim() : "";
  const slugs = (known || []).map((b) => typeof b === "string" ? b : b && b.slug).filter(Boolean);
  const currentSlug = (current || "").trim();
  const wanted = (currentSlug && slugs.includes(currentSlug) ? currentSlug : slugs[0]) || "";
  if (!slugs.length) return { slug: remembered, fallback: false, suggested: "" };
  if (!remembered) return { slug: "", fallback: false, suggested: wanted };
  if (remembered === "all" || remembered === "*") return { slug: remembered, fallback: false, suggested: "" };
  if (slugs.includes(remembered)) return { slug: remembered, fallback: false, suggested: "" };
  return { slug: "", fallback: true, suggested: wanted };
}
function isMissingBoardError(error) {
  const message = typeof error === "string" ? error : error && (error.message || error.detail || error.error) || "";
  return /database not found|does not exist|no such board|is not this board's own database/i.test(String(message));
}
function shortId(id) {
  return (id || "").replace(/^t_/, "").slice(0, 6);
}
function splitTitlePrefix(title) {
  const text = typeof title === "string" ? title.trim() : "";
  if (!text.startsWith("[")) return { prefix: null, rest: text };
  const end = text.indexOf("]");
  if (end < 2) return { prefix: null, rest: text };
  const prefix = text.slice(1, end).trim();
  if (!prefix) return { prefix: null, rest: text };
  return { prefix, rest: text.slice(end + 1).trim() };
}
function matchesSearch(task, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return true;
  const label = (task.label || "").toLowerCase();
  const title = (task.title || "").toLowerCase();
  const id = (task.id || "").toLowerCase();
  return label.includes(q) || title.includes(q) || id.includes(q) || q.startsWith("t_") && id.startsWith(q) || id.startsWith(`t_${q}`);
}
function buildRows(tasks) {
  const set = new Set(tasks.map((t) => t.id));
  const byId = {};
  for (const t of tasks) byId[t.id] = t;
  const adj = /* @__PURE__ */ new Map();
  for (const t of tasks) adj.set(t.id, (t.children || []).filter((c) => set.has(c)));
  const hasParent = /* @__PURE__ */ new Set();
  for (const t of tasks) {
    for (const p of t.parents || []) if (set.has(p)) hasParent.add(t.id);
  }
  const roots = tasks.filter((t) => !hasParent.has(t.id));
  const rows = [];
  const visited = /* @__PURE__ */ new Set();
  const walk = (id, depth, isChild) => {
    if (visited.has(id)) return;
    visited.add(id);
    rows.push({ task: byId[id], depth, isChild });
    for (const c of adj.get(id) || []) walk(c, depth + 1, true);
  };
  for (const r of roots) walk(r.id, 0, false);
  for (const t of tasks) walk(t.id, 0, Boolean(hasParent.has(t.id)));
  return rows;
}
var TREE_SLOT = 16;
var TREE_SQUARE = 13;
var TREE_AXIS = TREE_SQUARE / 2;
var TREE_INSET = 6;
function treeMarks(depth, continuation = [], lastSibling = false) {
  const guides = [];
  for (let level = 0; level < continuation.length; level++) {
    if (continuation[level]) guides.push(TREE_INSET + level * TREE_SLOT + TREE_AXIS);
  }
  const child = depth > 0;
  const elbowX = child ? TREE_INSET + (depth - 1) * TREE_SLOT + TREE_AXIS : null;
  return {
    indent: TREE_INSET + depth * TREE_SLOT,
    squareX: TREE_INSET + depth * TREE_SLOT,
    guides,
    elbowX,
    elbowW: child ? TREE_SLOT - TREE_AXIS : 0,
    elbowHalf: child && Boolean(lastSibling)
  };
}
function treeRows(tasks, opts = {}) {
  const fold = opts.fold || /* @__PURE__ */ new Map();
  const search = opts.search || "";
  const selected = opts.selected || /* @__PURE__ */ new Set();
  const set = new Set(tasks.map((t) => t.id));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const adj = /* @__PURE__ */ new Map();
  for (const t of tasks) adj.set(t.id, (t.children || []).filter((c) => set.has(c)));
  const hasParent = /* @__PURE__ */ new Set();
  for (const t of tasks) for (const p of t.parents || []) if (set.has(p)) hasParent.add(t.id);
  const halo = /* @__PURE__ */ new Set();
  for (const id of selected) for (const d of descendantsOf(tasks, id)) halo.add(d);
  const rows = [];
  const shown = /* @__PURE__ */ new Set();
  const covered = /* @__PURE__ */ new Set();
  const markCovered = (root) => {
    const stack = [...adj.get(root) || []];
    const seen = /* @__PURE__ */ new Set();
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      covered.add(id);
      for (const c of adj.get(id) || []) stack.push(c);
    }
  };
  const walk = (id, depth, isChild, secondary, cont, hasFollowing, parent) => {
    const task = byId.get(id);
    const kids = adj.get(id) || [];
    markCovered(id);
    const onlySecondary = kids.length > 0 && kids.every((c) => shown.has(c));
    const open = search ? true : fold.has(id) ? !fold.get(id) : !onlySecondary;
    const collapsed = kids.length > 0 && !open;
    rows.push({
      task,
      depth,
      isChild,
      secondary,
      parentId: parent || null,
      continuation: cont,
      lastSibling: !hasFollowing,
      hasChildren: kids.length > 0,
      secondaryOnly: onlySecondary,
      collapsed,
      hiddenCount: 0,
      matched: Boolean(search) && matchesSearch(task, search),
      descendantOfSelected: halo.has(id)
    });
    if (secondary || !open) return;
    const ordered = [...kids.filter((c) => !shown.has(c)), ...kids.filter((c) => shown.has(c))];
    ordered.forEach((c, i) => {
      const isSecondary = shown.has(c);
      const isLast = i === ordered.length - 1;
      if (!isSecondary) shown.add(c);
      walk(c, depth + 1, true, isSecondary, [...cont, hasFollowing], !isLast, id);
    });
  };
  for (const t of tasks) {
    if (hasParent.has(t.id) || shown.has(t.id)) continue;
    shown.add(t.id);
    walk(t.id, 0, false, false, [], false, null);
  }
  for (const t of tasks) {
    if (shown.has(t.id) || covered.has(t.id)) continue;
    shown.add(t.id);
    walk(t.id, 0, hasParent.has(t.id), false, [], false, null);
  }
  const printed = new Set(rows.map((r) => r.task.id));
  for (const row of rows) {
    if (!row.collapsed) continue;
    let n = 0;
    const stack = [...adj.get(row.task.id) || []];
    const seen = /* @__PURE__ */ new Set();
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      if (!printed.has(id)) n += 1;
      for (const c of adj.get(id) || []) stack.push(c);
    }
    row.hiddenCount = n;
  }
  return rows;
}
function computeDomain(visible, minBarSec) {
  const min = minBarSec || MIN_BAR;
  let lo = Infinity, hi = -Infinity, hasProgress = false;
  const now = Date.now() / 1e3;
  for (const t of visible) {
    for (const ts of [t.created_at, t.started_at, t.run_started_at, t.run_ended_at, t.completed_at]) {
      if (ts != null && Number.isFinite(ts)) {
        if (ts < lo) lo = ts;
        if (ts > hi) hi = ts;
      }
    }
    if (Array.isArray(t.runs)) {
      for (const r of t.runs) {
        if (r && r.started_at != null && Number.isFinite(r.started_at)) {
          if (r.started_at < lo) lo = r.started_at;
          if (r.started_at > hi) hi = r.started_at;
        }
        if (r && r.ended_at != null && Number.isFinite(r.ended_at)) {
          if (r.ended_at < lo) lo = r.ended_at;
          if (r.ended_at > hi) hi = r.ended_at;
        }
      }
    }
    if (t.status !== "done" && t.status !== "archived") hasProgress = true;
  }
  if (hasProgress) hi = Math.max(hi, now);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = now - 6 * DAY;
    hi = now;
  }
  if (hi - lo < 7 * DAY) {
    lo = hi - 7 * DAY;
  }
  hi += min;
  return { min: lo, max: hi };
}
function lastActivity(task) {
  const stamps = [task.completed_at, task.run_ended_at, task.run_started_at, task.started_at, task.created_at];
  for (const run of task.runs || []) stamps.push(run.ended_at, run.started_at);
  const valid = stamps.filter((s) => typeof s === "number" && s > 0);
  return valid.length ? Math.max(...valid) : null;
}
function relativeAge(ts, now, units = {}) {
  const u = { now: "now", m: "m", h: "h", d: "d", w: "w", mo: "mo", y: "y", ...units };
  if (ts == null) return "";
  const s = Math.max(0, now - ts);
  if (s < 60) return u.now;
  if (s < 3600) return `${Math.floor(s / 60)}${u.m}`;
  if (s < DAY) return `${Math.floor(s / 3600)}${u.h}`;
  if (s < 14 * DAY) return `${Math.floor(s / DAY)}${u.d}`;
  if (s < 60 * DAY) return `${Math.floor(s / (7 * DAY))}${u.w}`;
  if (s < 365 * DAY) return `${Math.floor(s / (30 * DAY))}${u.mo}`;
  return `${Math.floor(s / (365 * DAY))}${u.y}`;
}
function tickUnit(span) {
  return span <= 120 * DAY ? "day" : span <= 730 * DAY ? "week" : "month";
}
function ticks(min, max, unit) {
  const step = unit === "week" ? 7 * DAY : unit === "month" ? 30 * DAY : DAY;
  const out = [];
  let t = Math.floor(min / step) * step;
  while (t <= max) {
    out.push(t);
    t += step;
  }
  return out;
}
export {
  DAY,
  FAIL_TONE,
  HARD_FAILURES,
  MIN_BAR,
  PERIODS,
  PERIOD_TOLERANCE,
  RUN_TONE,
  TERMINAL_STATUSES,
  TREE_AXIS,
  TREE_INSET,
  TREE_SLOT,
  TREE_SQUARE,
  ZOOM_PCT_MAX,
  ZOOM_PCT_MIN,
  barRange,
  buildRows,
  clampZoom,
  clampZoomPct,
  computeDomain,
  descendantsOf,
  dropCandidates,
  hourTickPlan,
  isDescendant,
  isMissingBoardError,
  isTerminal,
  lastActivity,
  matchPeriod,
  matchesSearch,
  maxZoom,
  nowLineX,
  nowOffset,
  periodPxPerSec,
  periodScrollLeft,
  relationsOf,
  relativeAge,
  resolveBoardSlug,
  runTone,
  shortId,
  splitTitlePrefix,
  statusIcon,
  statusTone,
  taskBars,
  tickUnit,
  ticks,
  treeMarks,
  treeRows,
  visibleWindow,
  wheelZoomFactor,
  zoomFactorFromPct,
  zoomPctFromFactor
};
