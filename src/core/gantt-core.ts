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
// Representative Codicon per status, tinted with the status tone — this is what
// replaces the tiny colour dot next to a task name (and is reused by every list
// that shows a task, e.g. the parent/child relations).
const STATUS_ICON = {
  triage:    'question',
  todo:      'circle-large-outline',
  scheduled: 'clock',
  ready:     'play-circle',
  running:   'pulse',
  blocked:   'warning',
  review:    'eye',
  done:      'check',
  archived:  'archive'
};
export function statusIcon(status) {
  return STATUS_ICON[status] || 'circle-large-outline';
}
// Terminal statuses: a parent in one of these does not gate its children.
export const TERMINAL_STATUSES = ['done', 'archived'];
export function isTerminal(status) {
  return TERMINAL_STATUSES.indexOf(status) !== -1;
}
/** Every id reachable from ``rootId`` by following ``children`` (excluding it). */
export function descendantsOf(tasks, rootId) {
  const adj = new Map();
  for (const t of tasks) adj.set(t.id, t.children || []);
  const out = new Set();
  const stack = [...(adj.get(rootId) || [])];
  while (stack.length) {
    const id = stack.pop();
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(adj.get(id) || []));
  }
  return out;
}
/** True when ``candidateId`` sits below ``ancestorId`` — the cycle guard the UI
 *  uses to grey a drop target out (the domain still refuses it). */
export function isDescendant(tasks, ancestorId, candidateId) {
  return descendantsOf(tasks, ancestorId).has(candidateId);
}
/** Parent and child tasks of ``taskId``, in board order, as full task records. */
export function relationsOf(tasks, taskId) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const task = byId.get(taskId);
  if (!task) return { parents: [], children: [] };
  const pick = ids => (ids || []).map(id => byId.get(id)).filter(Boolean);
  return { parents: pick(task.parents), children: pick(task.children) };
}
/**
 * Tasks that may become the parent of ``draggedId`` — every candidate comes
 * back with an ``allowed`` flag and, when refused, the reason, so the picker
 * can grey rows out instead of hiding them.
 *
 * Refused: itself, its own descendants (a cycle the domain rejects), a task on
 * another board (task_links is per-board sqlite), and a task already linked as
 * its parent (a no-op the user should see). A FINISHED parent is allowed: the
 * domain refuses to gate a child only when the parent is not yet terminal, so
 * `done`/`archived` is exactly the prerequisite-satisfied case this timeline is
 * built around.
 */
export function dropCandidates(tasks, draggedId, boardSlug) {
  const dragged = tasks.find(t => t.id === draggedId);
  const below = descendantsOf(tasks, draggedId);
  const alreadyLinked = new Set((dragged && dragged.parents) || []);
  return tasks.map(task => {
    let reason = null;
    if (task.id === draggedId) reason = 'self';
    else if (below.has(task.id)) reason = 'descendant';
    else if (boardSlug && task.board && task.board !== boardSlug) reason = 'other-board';
    else if (alreadyLinked.has(task.id)) reason = 'linked';
    return { task, allowed: reason === null, reason };
  });
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
/**
 * Which board the page must show, given what it remembered and what the gateway
 * has. A remembered slug is never trusted: it may have been chosen while ANOTHER
 * gateway was active, and then every poll answers 503 while the page blames the
 * backend. A slug this gateway does not list is dropped in favour of the
 * current board — '' meaning "the gateway's current board", the convention the
 * bundled kanban plugin uses.
 *
 * `suggested` is what to adopt when nothing is remembered yet (the gateway's
 * current board, else the first one listed).
 */
export function resolveBoardSlug(stored, known, current) {
  const remembered = typeof stored === 'string' ? stored.trim() : '';
  const slugs = (known || [])
    .map(b => (typeof b === 'string' ? b : b && b.slug))
    .filter(Boolean);
  // The gateway's current board only counts as a target if it exists: a gateway
  // whose current board is itself missing (a leftover `default`) must fall back
  // to a board it actually has, or the page stays stuck on a 503.
  const currentSlug = (current || '').trim();
  const wanted = (currentSlug && slugs.includes(currentSlug) ? currentSlug : slugs[0]) || '';
  // No list yet: leave the page alone rather than guessing at a fallback.
  if (!slugs.length) return { slug: remembered, fallback: false, suggested: '' };
  if (!remembered) return { slug: '', fallback: false, suggested: wanted };
  // 'all' / '*' are switcher filters, not boards to validate.
  if (remembered === 'all' || remembered === '*') return { slug: remembered, fallback: false, suggested: '' };
  if (slugs.includes(remembered)) return { slug: remembered, fallback: false, suggested: '' };
  return { slug: '', fallback: true, suggested: wanted };
}

/**
 * True when the answer was "this board does not exist here" rather than "the
 * backend is down". The two used to share one message, which sent people
 * restarting gateways that were perfectly healthy.
 */
export function isMissingBoardError(error) {
  const message = typeof error === 'string'
    ? error
    : (error && (error.message || error.detail || error.error)) || '';
  return /database not found|does not exist|no such board/i.test(String(message));
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
/**
 * Rows for the tree column WITH the fold state — the explorer grammar.
 *
 * `buildRows` stays the flat projection (first visit wins). This adds what the
 * explorer rendering needs, and encodes two rules the hierarchy dictates:
 *
 * - The fold state is a sparse override map (`id -> collapsed`): a node with no
 *   entry keeps its DEFAULT, which depends on how it was reached. A task reached
 *   through its first parent holds the PRIMARY position and defaults OPEN; a
 *   child that already appeared elsewhere shows under a later parent as a
 *   SECONDARY position, defaulting CLOSED — so the link stays visible (that
 *   parent still draws the boxed `+`) without printing the same subtree twice.
 * - A non-empty `search` IGNORES the fold state: everything opens and matches are
 *   flagged, while the overrides the user stored are left untouched.
 *
 * Every row also carries what the renderer needs to draw the connectors
 * (`continuation`: for each ancestor level, whether that ancestor has a sibling
 * below it) and the selection halo (`descendantOfSelected`).
 */
// ── the tree column's geometry ────────────────────────────────────────────────
// One slot per level, and the slot must be wide enough for the 13px fold square:
// with the earlier 12px slot the marks drifted, the continuation guides sat 3px
// left of the squares they belong to, and a child's elbow was drawn on the
// CHILD's slot instead of under its PARENT's square — which is what made the
// icons look shifted to the left.
export const TREE_SLOT = 16
export const TREE_SQUARE = 13
export const TREE_AXIS = TREE_SQUARE / 2   // a level's vertical runs through its square's centre
// Breathing room before the first square, so a root's fold affordance does not
// touch the cell's left edge. Every x below includes it, and the column header's
// global toggle uses the same constant — the two cannot drift apart.
export const TREE_INSET = 6

/**
 * Where a row's branch marks sit, in px from the label cell's left edge:
 * `indent` is the cell's padding (so the square starts exactly there), `guides`
 * the x of each continuation vertical, and the elbow — under the PARENT's square —
 * whose arm is wide enough to reach the child's own square. Pure geometry, so the
 * renderer and the tests agree on it instead of each doing its own arithmetic.
 */
export function treeMarks(depth, continuation = [], lastSibling = false) {
  const guides = []
  for (let level = 0; level < continuation.length; level++) {
    if (continuation[level]) guides.push(TREE_INSET + level * TREE_SLOT + TREE_AXIS)
  }
  const child = depth > 0
  const elbowX = child ? TREE_INSET + (depth - 1) * TREE_SLOT + TREE_AXIS : null
  return {
    indent: TREE_INSET + depth * TREE_SLOT,
    squareX: TREE_INSET + depth * TREE_SLOT,
    guides,
    elbowX,
    elbowW: child ? TREE_SLOT - TREE_AXIS : 0,
    elbowHalf: child && Boolean(lastSibling)
  }
}

export function treeRows(tasks, opts = {}) {
  const fold = opts.fold || new Map()
  const search = opts.search || ''
  const selected = opts.selected || new Set()
  const set = new Set(tasks.map(t => t.id))
  const byId = new Map(tasks.map(t => [t.id, t]))
  const adj = new Map();
  for (const t of tasks) adj.set(t.id, (t.children || []).filter(c => set.has(c)))
  const hasParent = new Set()
  for (const t of tasks) for (const p of t.parents || []) if (set.has(p)) hasParent.add(t.id)

  const halo = new Set()
  for (const id of selected) for (const d of descendantsOf(tasks, id)) halo.add(d)

  const rows = []
  const shown = new Set()          // holds a PRIMARY position
  const covered = new Set()        // has a walked ancestor (it may be hidden)
  // Every descendant of a walked node is "covered": when a fold hides them they
  // must NOT come back as orphans in the catch-all pass below (a grandchild whose
  // parent is hidden would otherwise be re-placed at the root).
  const markCovered = root => {
    const stack = [...(adj.get(root) || [])]
    const seen = new Set()
    while (stack.length) {
      const id = stack.pop()
      if (seen.has(id)) continue
      seen.add(id)
      covered.add(id)
      for (const c of adj.get(id) || []) stack.push(c)
    }
  }

  // `cont[level]` says whether the ancestor AT that level has a sibling below it
  // — that is what the renderer draws as a vertical. A node's children inherit
  // its own array plus one entry for ITS level: whether THIS node is followed by
  // a sibling.
  const walk = (id, depth, isChild, secondary, cont, hasFollowing) => {
    const task = byId.get(id)
    const kids = adj.get(id) || []
    markCovered(id)
    // DEFAULT FOLD, and it depends on the node's role: a parent that owns children
    // of its own opens by default; one whose every child is already printed under
    // an earlier parent (a "secondary" parent — the multi-parent case) starts
    // CLOSED, so the tree shows the boxed `+` — the link is visible — without
    // repeating a subtree the user is already looking at.
    const onlySecondary = kids.length > 0 && kids.every(c => shown.has(c))
    const open = search ? true : (fold.has(id) ? !fold.get(id) : !onlySecondary)
    const collapsed = kids.length > 0 && !open
    rows.push({
      task, depth, isChild, secondary, continuation: cont, lastSibling: !hasFollowing,
      hasChildren: kids.length > 0,
      secondaryOnly: onlySecondary,
      collapsed,
      hiddenCount: 0,
      matched: Boolean(search) && matchesSearch(task, search),
      descendantOfSelected: halo.has(id)
    })
    // A secondary position shows the task itself and nothing else: its subtree is
    // already printed under the primary position, and recursing here would print
    // the same branch under every parent that reaches it.
    if (secondary || !open) return
    // Primary children first (they own the subtree), then the ones already placed
    // through an earlier parent, appended as a secondary position.
    const ordered = [...kids.filter(c => !shown.has(c)), ...kids.filter(c => shown.has(c))]
    ordered.forEach((c, i) => {
      const isSecondary = shown.has(c)
      const isLast = i === ordered.length - 1
      if (!isSecondary) shown.add(c)      // claim the primary position
      walk(c, depth + 1, true, isSecondary, [...cont, hasFollowing], !isLast)
    })
  }

  // The top level is NOT a sibling group: each root starts its own tree, so it
  // never has a "following sibling" and level 0 never draws a guide. Without
  // this, a lone child of a root was prefixed by a spurious `|` at level 0
  // ("| |_") instead of just its own elbow ("|_").
  for (const t of tasks) {
    if (hasParent.has(t.id) || shown.has(t.id)) continue
    shown.add(t.id)
    walk(t.id, 0, false, false, [], false)
  }
  // Anything that has neither been walked nor a walked parent (a cycle, or a task
  // whose parents are filtered out) is placed once, flagged as a child like
  // `buildRows` does. A task HIDDEN BY A FOLD is covered, so it is not re-added
  // here as an orphan — that is the bug this guard exists for.
  for (const t of tasks) {
    if (shown.has(t.id) || covered.has(t.id)) continue
    shown.add(t.id)
    walk(t.id, 0, hasParent.has(t.id), false, [], false)
  }

  // "n hidden" must count what is ACTUALLY hidden: a descendant that ends up
  // printed elsewhere (under another parent) is visible and is not counted.
  const printed = new Set(rows.map(r => r.task.id))
  for (const row of rows) {
    if (!row.collapsed) continue
    let n = 0
    const stack = [...(adj.get(row.task.id) || [])]
    const seen = new Set()
    while (stack.length) {
      const id = stack.pop()
      if (seen.has(id)) continue
      seen.add(id)
      if (!printed.has(id)) n += 1
      for (const c of adj.get(id) || []) stack.push(c)
    }
    row.hiddenCount = n
  }
  return rows
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
/** Most recent real timestamp on a task (seconds), or null when it has none. */
export function lastActivity(task) {
  const stamps = [task.completed_at, task.run_ended_at, task.run_started_at, task.started_at, task.created_at]
  for (const run of task.runs || []) stamps.push(run.ended_at, run.started_at)
  const valid = stamps.filter(s => typeof s === 'number' && s > 0)
  return valid.length ? Math.max(...valid) : null
}
/** Compact age for a list cell: 'now', '5m', '3h', '2d', '6w', '4mo', '2y'.
 *
 * `units` lets a locale translate the suffixes (they are concatenated to the
 * number, so a language that needs a separator puts it in the string itself);
 * the defaults are the English abbreviations. The arithmetic stays here, in the
 * pure core, so it can still be unit-tested without a renderer.
 */
export function relativeAge(ts, now, units = {}) {
  const u = { now: 'now', m: 'm', h: 'h', d: 'd', w: 'w', mo: 'mo', y: 'y', ...units }
  if (ts == null) return ''
  const s = Math.max(0, now - ts)
  if (s < 60) return u.now
  if (s < 3600) return `${Math.floor(s / 60)}${u.m}`
  if (s < DAY) return `${Math.floor(s / 3600)}${u.h}`
  if (s < 14 * DAY) return `${Math.floor(s / DAY)}${u.d}`
  if (s < 60 * DAY) return `${Math.floor(s / (7 * DAY))}${u.w}`
  if (s < 365 * DAY) return `${Math.floor(s / (30 * DAY))}${u.mo}`
  return `${Math.floor(s / (365 * DAY))}${u.y}`
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
