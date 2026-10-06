// src/core/gantt-core.ts
var DAY = 86400;
var MIN_BAR = 2 * 3600;
var STATUS_TONE = {
  triage: "var(--ui-text-tertiary)",
  todo: "var(--ui-text-secondary)",
  scheduled: "#a78bfa",
  ready: "#60a5fa",
  running: "#34d399",
  blocked: "#f87171",
  review: "#fbbf24",
  done: "var(--ui-text-tertiary)",
  archived: "var(--ui-text-quaternary)"
};
function statusTone(status) {
  return STATUS_TONE[status] || "var(--ui-text-secondary)";
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
        tone: statusTone("blocked"),
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
      const isFailed = ["crashed", "failed", "timed_out", "gave_up", "blocked"].includes(r.outcome || r.status);
      const tone = isOngoing ? statusTone("running") : isFailed ? statusTone("blocked") : statusTone(r.outcome === "completed" || r.status === "completed" || r.status === "done" ? "done" : "review");
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
  return /database not found|does not exist|no such board/i.test(String(message));
}
function shortId(id) {
  return (id || "").replace(/^t_/, "").slice(0, 6);
}
function matchesSearch(task, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return true;
  const label = (task.label || "").toLowerCase();
  const title = (task.title || "").toLowerCase();
  return label.includes(q) || title.includes(q);
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
  MIN_BAR,
  TERMINAL_STATUSES,
  barRange,
  buildRows,
  computeDomain,
  descendantsOf,
  dropCandidates,
  isDescendant,
  isMissingBoardError,
  isTerminal,
  matchesSearch,
  relationsOf,
  resolveBoardSlug,
  shortId,
  statusIcon,
  statusTone,
  taskBars,
  tickUnit,
  ticks
};
