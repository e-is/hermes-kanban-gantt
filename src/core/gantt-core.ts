/** Pure Gantt timeline logic — extracted from the former GANTT_CORE_SRC
 * template string (was eval'd via new Function for tests). No React, no SDK:
 * this module is unit-testable as-is. */


export const DAY = 86_400;
export const MIN_BAR = 2 * 3600;
// Official Kanban plugin status tones (COLUMN_META, types.ts) — unified style
const STATUS_TONE = {
  triage:   'var(--ui-text-tertiary)',
  todo:     'var(--ui-text-secondary)',
  scheduled:'#a78bfa',
  ready:    '#60a5fa',
  running:  '#34d399',
  blocked:  '#f87171',
  review:   '#fbbf24',
  done:     'var(--ui-text-tertiary)',
  archived: 'var(--ui-text-quaternary)'
};
export function statusTone(status) {
  return STATUS_TONE[status] || 'var(--ui-text-secondary)';
}
export function barRange(task, now, minBarSec) {
  const min = minBarSec || MIN_BAR;
  // Real execution window (a worker actually ran the task) — the truth for
  // done durations. Hand-only completions carry run_started_at == null.
  const rs = task.run_started_at;
  const re = task.run_ended_at;
  const realRun = rs != null && re != null && rs < re;

  if (task.status === 'done' || task.status === 'archived') {
    if (realRun) {
      return { t0: rs, t1: Math.max(rs + min, re), kind: 'done', tone: statusTone(task.status) };
    }
    // no real run: unknown duration -> minimal bar anchored on completion
    const anchor = task.completed_at ?? task.created_at;
    if (anchor == null) return null;
    return { t0: anchor, t1: anchor + min, kind: 'done-instant' };
  }
  if (task.status === 'running' || task.status === 'review') {
    const start = task.run_started_at ?? task.started_at ?? task.created_at ?? now;
    // ensure running bar always extends to at least now (and at least minBar)
    return { t0: start, t1: Math.max(start + min, now), kind: 'progress', tone: statusTone(task.status) };
  }
  if (task.started_at) {
    // claimed but unfinished (ready edge case) — run start is real
    return { t0: task.started_at, t1: now, kind: 'progress', tone: statusTone(task.status) };
  }
  const c = task.created_at;
  return c ? { t0: c, t1: c + min, kind: 'todo', tone: statusTone(task.status) } : null;
}
export function taskBars(task, now, minBarSec) {
  const min = minBarSec || MIN_BAR;
  // If the task carries a list of recorded runs with timestamps, create a bar for each real run
  const runs = Array.isArray(task.runs) ? task.runs : [];
  const validRuns = runs.filter(r => r && r.started_at != null);

  // BLOCKED: solid red bars for each FAILED run window only, then a dashed
  // red "waiting for action" bar from the last run end (or creation) to now —
  // same waiting grammar as todo bars, so a blocked task no longer reads as
  // "running today".
  if (task.status === 'blocked') {
    const bars = [];
    for (const r of validRuns) {
      const s = r.started_at;
      const e = r.ended_at;
      if (e == null || e <= s) continue; // unfinished run: no completed window
      bars.push({
        t0: s,
        t1: Math.max(s + min, e),
        kind: 'done',
        tone: statusTone('blocked'),
        runId: r.id,
        profile: r.profile,
        outcome: r.outcome || r.status
      });
    }
    const waitStart = bars.length ? bars[bars.length - 1].t1 : (task.created_at ?? task.started_at ?? now);
    bars.push({
      t0: waitStart,
      t1: Math.max(waitStart + min, now),
      kind: 'blocked-wait',
      tone: statusTone('blocked')
    });
    return bars;
  }

  if (validRuns.length > 1) {
    const bars = [];
    for (const r of validRuns) {
      const s = r.started_at;
      const e = r.ended_at;
      const isOngoing = (e == null || r.status === 'running') && (task.status === 'running' || task.status === 'review');
      const t1 = isOngoing ? Math.max(s + min, now) : (e != null ? Math.max(s + min, e) : s + min);
      const isFailed = ['crashed', 'failed', 'timed_out', 'gave_up', 'blocked'].includes(r.outcome || r.status);
      const tone = isOngoing
        ? statusTone('running')
        : isFailed
          ? statusTone('blocked')
          : statusTone(r.outcome === 'completed' || r.status === 'completed' || r.status === 'done' ? 'done' : 'review');
      bars.push({
        t0: s,
        t1,
        kind: isOngoing ? 'progress' : 'done',
        tone,
        runId: r.id,
        profile: r.profile,
        outcome: r.outcome || r.status,
        isOngoing
      });
    }
    return bars;
  }

  // Fallback to single consolidated bar
  const single = barRange(task, now, min);
  return single ? [single] : [];
}
export function shortId(id) {
  return (id || '').replace(/^t_/, '').slice(0, 6)
}

export function matchesSearch(task, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return true;
  const label = (task.label || '').toLowerCase();
  const title = (task.title || '').toLowerCase();
  return label.includes(q) || title.includes(q);
}
export function buildRows(tasks) {
  const set = new Set(tasks.map(t => t.id));
  const byId = {};
  for (const t of tasks) byId[t.id] = t;
  const adj = new Map();
  for (const t of tasks) adj.set(t.id, (t.children || []).filter(c => set.has(c)));
  const hasParent = new Set();
  for (const t of tasks) {
    for (const p of t.parents || []) if (set.has(p)) hasParent.add(t.id);
  }
  const roots = tasks.filter(t => !hasParent.has(t.id));
  const rows = [];
  const visited = new Set();
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
export function computeDomain(visible, minBarSec) {
  const min = minBarSec || MIN_BAR;
  let lo = Infinity, hi = -Infinity, hasProgress = false;
  const now = Date.now() / 1000;
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
    if (t.status !== 'done' && t.status !== 'archived') hasProgress = true;
  }
  if (hasProgress) hi = Math.max(hi, now);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    // Empty board fallback: show full week centered/ending around today
    lo = now - 6 * DAY;
    hi = now;
  }
  // Ensure the domain spans at least 7 full days (1 week)
  if (hi - lo < 7 * DAY) {
    lo = hi - 7 * DAY;
  }
  hi += min;
  return { min: lo, max: hi };
}
export function tickUnit(span) {
  return (span <= 120 * DAY ? 'day' : span <= 730 * DAY ? 'week' : 'month');
}
export function ticks(min, max, unit) {
  const step = unit === 'week' ? 7 * DAY : unit === 'month' ? 30 * DAY : DAY;
  const out = [];
  let t = Math.floor(min / step) * step;
  while (t <= max) { out.push(t); t += step; }
  return out;
}
