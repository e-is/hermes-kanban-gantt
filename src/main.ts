/**
 * kanban-gantt — desktop Gantt view of a Hermes kanban board.
 *
 * Standalone disk plugin (uncompiled ESM): only @hermes/plugin-sdk, react and
 * react/jsx-runtime resolve — the desktop loader rewrites ONLY those bare
 * specifiers, so this file is SELF-CONTAINED (no relative imports). The pure
 * Gantt logic lives in src/core/gantt-core.ts (pure module, unit-tested); the Node test
 * suite (tests/gantt-core.test.mjs) extracts and evaluates THAT EXACT SOURCE,
 * so tests cover the shipped code with zero duplication.
 *
 * Data: the plugin's own backend (/api/plugins/kanban-gantt/*, plugin_api.py):
 * /boards, /gantt?board= (snapshot + parent->child graph), /tasks/<id>
 * (detail for the drawer), and write endpoints that delegate to the kanban
 * domain layer (status transitions, comments, assignee).
 *
 * The Gantt is an ADVANCEMENT-OVER-TIME view (real timestamps), not a
 * forecast: done = full bar (100%), in-progress = open bar to now,
 * not-started = minimal bar (2h) at creation, archived = grey.
 * A search field filters by label or any text; a zoom slider scales the
 * timeline; task names stay sticky on the left while scrolling.
 */

import {
  atom,
  Badge,
  Button,
  cn,
  Codicon,
  ConfirmDialog,
  Contribute,
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  host,
  Loader,
  profileColor,
  profileColorSoft,
  MessageTextContent,
  Switch,
  Textarea,
  useMutation,
  usePluginI18n,
  useQuery,
  useQueryClient,
  useValue,
  PALETTE_AREA,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  TITLEBAR_AREAS,
  WORKSPACE_PAGE_HEADER_AREA
} from '@hermes/plugin-sdk'
import { useMemo, useRef, useEffect, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import {
  setPluginDoors,
  LABEL_W, LABEL_W_MIN, LABEL_W_MAX, DRAWER_W_MIN, DRAWER_W_MAX,
  $baseUrl, $boardSlug, $labelW, $drawerW, $drawerDocked, $detailModal, $titlePrefixTags, $openTaskId,
  $openAttachment,
  $newTask, $moveUnderId, $wsEnabled, $connectionScope, $openBoards,
  apiBase, apiFetch, fetchBoards, fetchGantt, fetchTask,
  createTask, fetchProjects, fetchProfiles,
  setParent, removeParent, applyBase
} from './state'
import { getStorage, getSocket } from './state'
import { GANTT_LOCALES, useGanttI18n } from './i18n'
import { subscribeGantt } from './ws'
import { WS_STATE, canPush } from './core/ws-core'
import { TitlebarBoardSwitcher } from './ui/TitlebarBoardSwitcher'
import { NewTaskDialog } from './ui/NewTaskDialog'
import { MoveTaskDialog } from './ui/MoveTaskDialog'
import { TaskRelations } from './ui/TaskRelations'
import { ReparentChoiceDialog, MoveUnderDialog, reasonLabel } from './ui/ReparentChooser'

const ID = 'kanban-gantt'

const ROW_H = 28                 // px — row height
const BAR_H = 14                 // px — bar height inside a row
const MIN_BAR_SEC = 2 * 3600     // 2h — minimum visible bar length
// The zoom the reader sees and sets: a percentage, 1 = the widest scale, 100 = the closest
// (six hours across the pane). The factor behind it is derived — see the core.
const ZOOM_MIN_FACTOR = 0.2

/* ────────────────────── GANTT-CORE (pure logic, Node-tested) ────────────────
   Evaluated here via new Function(); tests/gantt-core.test.mjs extracts this
   same string from the file source and runs it under node:test. The body is
   plain JS (no imports/exports needed). */


import { graphNodes, graphEdges, layoutGraph, lineage, scopeIds, nearestInHalo, NODE_H, NODE_W } from './core/graph-core.ts'
import { barRange, taskBars, shortId, matchesSearch, buildRows, treeRows, treeMarks, TREE_INSET, computeDomain, ticks, tickUnit, statusTone, statusIcon, relationsOf, dropCandidates, resolveBoardSlug, isMissingBoardError, DAY, MIN_BAR, lastActivity, relativeAge, hourTickPlan, nowOffset, nowLineX, wheelZoomFactor, maxZoom, clampZoom, runTone, splitTitlePrefix, PERIOD_TOLERANCE, periodPxPerSec, periodScrollLeft, visibleWindow, matchPeriod, ZOOM_PCT_MIN, ZOOM_PCT_MAX, clampZoomPct, zoomFactorFromPct, zoomPctFromFactor, previewKind, attachmentMime, wheelIntent, neighbourId, hasAttachments } from './core/gantt-core.ts'

/** Turn a refused re-parent into a sentence. The bridge may only carry the HTTP
 *  status, so the domain's wording is matched when present and a generic
 *  sentence covers the rest (the UI greys refused targets before the call). */
function humanReparentError(error, i18n) {
  const message = String((error && error.message) || error || '')
  if (/cycle/i.test(message)) return i18n.errCycle
  if (/running/i.test(message)) return i18n.errRunning
  if (/not on board/i.test(message)) return i18n.errOtherBoard
  if (/own parent|itself/i.test(message)) return i18n.errSelf
  return i18n.errReparent
}

/** Report through the desktop's own notification stack — it auto-dismisses and
 *  lives outside the page layout, so a stale message can never end up painted
 *  inside the drawer. Falls back to nothing when the bridge is absent (plain
 *  browser / demo). */
function toast(kind, message) {
  try {
    if (host && typeof host.notify === 'function' && message) {
      host.notify({ kind, message })
    }
  } catch {
    /* no desktop bridge: drop it rather than crash the page */
  }
}

// ── the remembered board, scoped per gateway ────────────────────────────────
// The bundled kanban plugin scopes its board preference by connection
// (`boardSlug.<scope>`). Ours kept one global key, so a slug chosen while another
// gateway was active survived the switch: every poll then answered 503 for a
// board that gateway never had, and the page blamed the backend. '' means "the
// gateway's current board", so the fallback is the empty value, not a guess.
const BOARD_KEY = 'board'

function connectionScope() {
  try {
    const id = host && host.state && host.state.connectionId
    const value = id && typeof id.get === 'function' ? id.get() : id
    return typeof value === 'string' ? value : ''
  } catch {
    /* no desktop bridge (standalone server): one scope, one key */
    return ''
  }
}

function boardStorageKey() {
  const scope = connectionScope()
  return scope ? `${BOARD_KEY}.${scope}` : BOARD_KEY
}

function openBoardsKey() {
  const scope = connectionScope()
  return scope ? `openBoards.${scope}` : 'openBoards'
}

function readStoredBoard(storage) {
  if (!storage) return ''
  const scoped = storage.get(boardStorageKey(), '')
  if (scoped) return scoped
  // Written before the keys were scoped: adopt it once. The /boards validation
  // drops it if THIS gateway does not have that board.
  return storage.get(BOARD_KEY, '') || ''
}


/** Apply a new backend base URL and refetch everything. */
const applyBase = value => {
  const next = (value || '').trim().replace(/\/+$/, '')
  $baseUrl.set(next)
  if (getStorage()) getStorage().set('baseUrl', next)
}

/* ──────────────────────────────── rendering bits ──────────────────────────── */

/** The five shortcuts, in order, with the label key each one reads. */
const PERIOD_CHOICES = [
  { span: 6 * 3600, key: 'period6h' },
  { span: 12 * 3600, key: 'period12h' },
  { span: 24 * 3600, key: 'period24h' },
  { span: 3 * DAY, key: 'period3d' },
  { span: 7 * DAY, key: 'period7d' }
]

function PeriodSelector({ value, onChange, disabled }) {
  const i18n = useGanttI18n()
  return jsx('div', {
    role: 'group',
    'aria-label': i18n.periodLabel,
    className: 'inline-flex items-stretch overflow-hidden rounded-md',
    style: { border: '1px solid var(--ui-stroke-tertiary)', opacity: disabled ? 0.45 : 1 },
    children: PERIOD_CHOICES.map(({ span, key }, index) => {
      const active = value === span
      return jsx('button', {
        type: 'button',
        disabled: Boolean(disabled),
        'aria-pressed': active,
        title: `${i18n.periodShow} ${i18n[key]}`,
        onClick: () => onChange(span),
        className: cn(
          'h-5 px-1.5 text-[10px] leading-none tabular-nums border-0 cursor-pointer',
          active ? 'font-semibold' : 'font-normal'
        ),
        style: {
          backgroundColor: active ? 'var(--ui-accent)' : 'transparent',
          color: active ? 'var(--ui-bg-chrome)' : 'var(--ui-text-secondary)',
          borderLeft: index ? '1px solid var(--ui-stroke-tertiary)' : 'none'
        },
        children: i18n[key]
      }, span)
    })
  })
}

/**
 * Hour gridlines, drawn only once the wheel zoom has made an hour wide enough to
 * read (`hourTickPlan` decides, in the pure core). Every hour gets a line; a
 * labelled one every `step` hours, so the labels never sit closer than ~56 px.
 */
function HourLines({ min, max, pxPerSec }) {
  const plan = hourTickPlan(pxPerSec * 3600)
  if (!plan) return null
  const lines = []
  const first = Math.ceil(min / 3600) * 3600
  for (let t = first; t <= max; t += 3600) {
    const hour = new Date(t * 1000).getHours()
    const major = hour % plan.step === 0
    lines.push(jsxs('div', {
      className: 'absolute top-0 bottom-0 border-l',
      style: {
        left: `${Math.round((t - min) * pxPerSec)}px`,
        borderColor: major ? 'var(--ui-stroke-tertiary)' : 'var(--ui-stroke-quaternary)'
      },
      children: major
        ? jsx('span', {
            className: 'absolute top-0.5 left-0.5 text-[9px] tabular-nums text-(--ui-text-tertiary)',
            children: `${String(hour).padStart(2, '0')}:00`
          })
        : null
    }, 'h' + t))
  }
  return jsx('div', { className: 'absolute inset-0 pointer-events-none z-0', children: lines })
}

/**
 * The "now" line — the one landmark this timeline was missing: the bars were all
 * clipped at `now`, but nothing drew where that was. Hidden (not clamped) when
 * now sits outside the domain, so it never lies about the extent.
 *
 * `originX` is the task-name column's width: the timeline starts after it, and
 * forgetting it is what drew the line days early.
 */
function NowLine({ now, min, max, pxPerSec, originX = 0 }) {
  const i18n = useGanttI18n()
  const left = nowLineX(now, min, max, pxPerSec, originX)
  if (left == null) return null
  const label = new Date(Math.round(now) * 1000)
    .toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return jsxs('div', {
    className: 'absolute top-0 bottom-0 z-10 pointer-events-none',
    style: { left: `${left}px` },
    children: [
      jsx('div', {
        style: {
          position: 'absolute', top: 0, bottom: 0, width: '1px',
          backgroundColor: 'var(--ui-accent, #d946ef)'
        }
      }),
      jsx('span', {
        title: `${i18n.nowMarker} — ${label}`,
        className: 'absolute top-0.5 left-1 whitespace-nowrap rounded px-1 text-[9px] font-semibold tabular-nums',
        style: {
          backgroundColor: 'var(--ui-bg-chrome)',
          color: 'var(--ui-accent, #d946ef)'
        },
        children: label
      })
    ]
  })
}

function Ruler({ min, max, pxPerSec, onReset }) {
  const unit = tickUnit(max - min)
  const tickValues = ticks(min, max, unit)
  const dayWidth = pxPerSec * DAY
  const showWeekday = unit === 'day' && dayWidth >= 50

  return jsxs('div', {
    className: 'relative border-b border-(--ui-stroke-secondary) select-none text-[10px]',
    style: { height: showWeekday ? '32px' : '24px' },
    onDoubleClick: onReset ? () => onReset() : undefined,
    children: tickValues.map(t => {
      const left = Math.round((t - min) * pxPerSec)
      const d = new Date(t * 1000)
      const label = unit === 'month'
        ? d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
        : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      const weekday = showWeekday
        ? d.toLocaleDateString(undefined, { weekday: 'short' }).replace(/\./g, '').slice(0, 3).toUpperCase()
        : null

      return jsxs('div', {
        className: 'absolute top-0 flex flex-col',
        style: { left: `${left}px` },
        children: [
          jsx('div', { className: 'h-1.5 w-px bg-(--ui-stroke-tertiary)' }),
          weekday
            ? jsx('div', { className: 'pl-0.5 text-[8.5px] font-semibold text-(--ui-text-tertiary) leading-none pt-0.5', children: weekday })
            : null,
          jsx('div', { className: 'pl-0.5 text-(--ui-text-tertiary) leading-tight', children: label })
        ]
      })
    })
  })
}

function Bar({ task, bar, pxPerSec, min, onOpen }) {
  const i18n = useGanttI18n()
  const left = Math.round((bar.t0 - min) * pxPerSec)
  const top = Math.round((ROW_H - BAR_H) / 2)
  const tone = bar.tone || statusTone(task.status)
  const style = { top: `${top}px`, height: `${BAR_H}px`, left: `${left}px`, cursor: 'pointer' }
  let title = task.title

  // Status tones from the official Kanban plugin (COLUMN_META) — unified style.
  if (bar.kind === 'done') {
    style.background = tone === 'var(--ui-text-tertiary)' ? '#60a5fa' : tone
    style.opacity = '0.85'
    title = i18n.barDoneReal(task.title)
  } else if (bar.kind === 'done-instant') {
    style.background = tone === 'var(--ui-text-tertiary)' ? '#60a5fa' : tone
    style.opacity = '0.55'
    style.width = style.width || '4px'
    style.borderRadius = '999px'
    title = i18n.barDoneUnknown(task.title)
  } else if (bar.kind === 'progress') {
    // Gauge (option a): full track [start->now] with a pale tone + fill that
    // grows over time; running cards get the machine-activity arc animation
    // (same visual vocabulary as the official kanban plugin's kanban-arc).
    style.background = `color-mix(in srgb, ${tone} 22%, transparent)`
    style.border = `1px solid ${tone}`
    title = i18n.barRunning(task.title)
  } else if (bar.kind === 'blocked-wait') {
    // Blocked waiting bar: dashed red outline + light red tint — reads as
    // "waiting for action" (like todo dashes) without looking like a run.
    style.border = `1px dashed ${tone}`
    style.background = `color-mix(in srgb, ${tone} 10%, transparent)`
    title = i18n.barBlockedWaiting(task.title)
  } else {
    // todo/queued: minimal dashed bar bordered in the STATUS tone (blue for
    // ready, etc.) so queued tasks are distinguishable at a glance
    style.border = `1px dashed ${tone}`
    style.background = 'transparent'
    title = i18n.barNotStarted(task.title)
  }

  if (bar.t1 != null) {
    style.width = `${Math.max(Math.round((bar.t1 - bar.t0) * pxPerSec), 2)}px`
  }

  // Fill overlay for running gauges: fill portion = start->now already equals
  // the track (option a), so the "half-full" look comes from the pale track +
  // strong fill child below.
  const children = []
  if (bar.kind === 'progress') {
    children.push(jsx('div', {
      className: 'absolute rounded-sm',
      style: {
        left: 0, top: 0, bottom: 0, width: '100%',
        background: tone, opacity: 0.75
      }
    }))
    if (task.status === 'running') {
      children.push(jsx('div', { className: 'kg-arc', style: { '--kanban-tone': tone } }))
    }
  }
  const onClick = onOpen ? () => onOpen(task.id) : undefined
  if (bar.kind === 'done' || bar.kind === 'done-instant') {
    return jsx('div', { className: 'absolute rounded-sm kg-bar hover:brightness-110 transition-all', style, title, onClick })
  }
  return jsxs('div', { className: 'absolute rounded-sm kg-bar hover:brightness-110 transition-all', style, title, onClick, children })
}

/**
 * The task's title, verbatim.
 *
 * A leading `[EPIC]` is part of what the user typed: stripping it here (which this
 * function used to do) made the same task read differently in the timeline and on
 * the board. The prefix is only *presented* separately when the reader asks for
 * tags — see `$titlePrefixTags` and `splitTitlePrefix`.
 */
function titleText(title) {
  return typeof title === 'string' ? title.trim() : ''
}

/**
 * Drag handle to resize the sticky label column (growDirection='right',
 * dragging right grows) or the drawer (growDirection='left', dragging left
 * grows). Double-click resets to the default width; the final width is persisted.
 */
function ResizeHandle({ get, set, min, max, resetTo, storageKey, growDirection = 'right' }) {
  const drag = useRef(null)
  const elRef = useRef(null)
  const onPointerDown = e => {
    e.preventDefault()
    e.stopPropagation()
    drag.current = { startPointer: e.clientX, startW: get() }
    // Keep the pill lit while dragging: the pointer leaves the 10px strip as
    // soon as the drag starts, so :hover alone would make it vanish mid-drag.
    if (elRef.current) elRef.current.setAttribute('data-dragging', 'true')
    const onMove = ev => {
      const d = drag.current
      if (!d) return
      const delta = growDirection === 'right'
        ? ev.clientX - d.startPointer
        : d.startPointer - ev.clientX
      set(Math.min(max, Math.max(min, Math.round(d.startW + delta))))
    }
    const onUp = () => {
      drag.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (elRef.current) elRef.current.removeAttribute('data-dragging')
      if (getStorage()) getStorage().set(storageKey, String(get()))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  return jsx('div', {
    onPointerDown,
    onDoubleClick: e => {
      e.preventDefault()
      e.stopPropagation()
      set(resetTo)
      if (getStorage()) getStorage().set(storageKey, String(resetTo))
    },
    className: 'kg-resize-handle absolute z-40 touch-none cursor-col-resize',
    style: {
      touchAction: 'none',
      // Inline positioning: negative Tailwind offsets may be missing from the
      // desktop's compiled CSS, which shifts the drawer handle ~16px inward.
      top: 0, bottom: 0,
      ...(growDirection === 'right' ? { right: -5, width: 10 } : { left: -5, width: 10 })
    },
    role: 'separator',
    'aria-orientation': 'vertical',
    // The affordance itself: the shell's own resizers draw a 4px rounded pill
    // inside a 10px hit strip, and it must be the SAME vocabulary here — a
    // Tailwind arbitrary class the desktop never compiled (the old
    // `hover:bg-(--ui-accent)/30`) painted nothing, which is why the handle
    // stopped showing any hover feedback. Drawn from the injected stylesheet.
    children: jsxs('span', { className: 'contents', children: [
      jsx('span', { className: 'kg-resize-rest' }),
      jsx('span', { className: 'kg-resize-pill' })
    ] })
  })
}

function TaskRow({ task, depth, isChild, now, pxPerSec, min, timelineW, onOpen, isSelected, isChecked, onToggleCheck, isEven, showBoardBadge, dragState, onDragStartTask, onDragEndTask, onDropOn, hasChildren, collapsed, secondary, secondaryOnly, continuation = [], lastSibling, hiddenCount = 0, matched, descendantOfSelected, onToggleFold, listMode }) {  const i18n = useGanttI18n()
  const labelW = useValue($labelW)
  const bars = taskBars(task, now)
  const label = task.label ? `[${task.label}]` : ''
  const showPrefixTags = useValue($titlePrefixTags)
  const { prefix, rest } = splitTitlePrefix(task.title)
  const name = rest || titleText(task.title) || i18n.untitled

  // Explorer connectors, in front of the checkbox and left of the fold square.
  // All the geometry comes from the core (`treeMarks`) so it can be unit-tested:
  // every level's vertical runs through the centre of THAT level's square, and a
  // child's elbow hangs under its PARENT's square — not on its own slot, which is
  // what made the icons look shifted left.
  const marks = treeMarks(depth, continuation, lastSibling)
  const line = 'var(--ui-stroke-secondary)'
  const connectors = marks.guides.map(x => jsx('span', {
    key: `g${x}`,
    className: 'absolute pointer-events-none',
    style: { left: `${x}px`, top: 0, width: '1px', height: '100%', backgroundColor: line, opacity: 0.65 }
  }))
  if (marks.elbowX !== null) {
    // This row's own elbow: full height when a sibling follows it, top-half only
    // when it is the last one (the classic `├` / `└`).
    connectors.push(jsx('span', {
      key: 'elbow-v',
      className: 'absolute pointer-events-none',
      style: { left: `${marks.elbowX}px`, top: 0, width: '1px',
               height: marks.elbowHalf ? '50%' : '100%', backgroundColor: line, opacity: 0.65 }
    }))
    connectors.push(jsx('span', {
      key: 'elbow-h',
      className: 'absolute pointer-events-none',
      style: { left: `${marks.elbowX}px`, top: '50%', width: `${marks.elbowW}px`, height: '1px',
               backgroundColor: line, opacity: 0.65 }
    }))
  }

  // The boxed `+` / `−`, the file explorer's affordance. A leaf keeps the space
  // (an empty 13px slot) so titles stay aligned across a sibling group.
  const foldSquare = hasChildren
    ? jsx('span', {
        role: 'button',
        tabIndex: 0,
        'aria-label': collapsed
          ? (hiddenCount ? i18n.expandTaskHidden(name, hiddenCount) : i18n.expandTask(name))
          : i18n.collapseTask(name),
        'aria-expanded': !collapsed,
        title: collapsed
          ? (hiddenCount ? i18n.expandTaskHidden(name, hiddenCount) : i18n.expandTask(name))
          : i18n.collapseTask(name),
        className: cn(
          'shrink-0 inline-flex items-center justify-center cursor-pointer select-none',
          'text-[10px] leading-none font-semibold',
          (secondary || secondaryOnly) ? 'text-(--ui-text-quaternary)' : 'text-(--ui-text-tertiary)',
          'hover:text-(--ui-text-primary)'
        ),
        style: {
          width: '13px', height: '13px',
          border: '1px solid var(--ui-stroke-secondary)',
          borderRadius: '3px',
          borderStyle: (secondary || secondaryOnly) ? 'dashed' : 'solid',
          backgroundColor: (secondary || secondaryOnly) ? 'transparent' : 'var(--ui-bg-tertiary, transparent)'
        },
        onClick: e => {
          e.stopPropagation()               // never opens the drawer nor checks the box
          onToggleFold(task.id, !collapsed)
        },
        onKeyDown: e => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          e.stopPropagation()
          onToggleFold(task.id, !collapsed)
        },
        children: collapsed ? '+' : '−'
      })
    : jsx('span', { className: 'shrink-0', style: { width: '13px', height: '13px' }, 'aria-hidden': 'true' })

  const dotColor = (bars.length > 0 ? bars[bars.length - 1]?.tone : null) || statusTone(task.status)
  // Representative Codicon per status, coloured with the status tone — replaces
  // the tiny status dot (the map lives in the core, shared with every list that
  // renders a task).
  const icon = statusIcon(task.status)
  const statusTitle = i18n.col?.[task.status] || task.status

  // 2-col grid (label | timeline): the label cell is position:sticky left so
  // names stay visible while the timeline scrolls horizontally.
  return jsxs('div', {
    className: cn(
      'group grid items-center border-b border-(--ui-stroke-tertiary)/40 transition-colors cursor-pointer',
      isSelected
        ? 'bg-(--ui-accent)/12 font-semibold'
        : isChecked
          ? 'bg-(--ui-accent)/6'
          : descendantOfSelected
            ? 'bg-(--ui-accent)/7'
            : isEven
              ? 'bg-black/[0.02] dark:bg-white/[0.02]'
              : 'bg-transparent',
      'hover:bg-(--ui-accent)/8'
    ),
    // Addressable and focusable: the row is what the keyboard moves through when the detail
    // is docked, and `focus()` needs both a handle and a `tabIndex`.
    'data-row-id': task.id,
    tabIndex: -1,
    style: { gridTemplateColumns: listMode ? LIST_COLUMNS : `${labelW}px ${timelineW}px`, height: `${ROW_H}px` },
    onClick: e => {
      // If clicking inside the checkbox itself, don't trigger row click handler again
      if (e.target.tagName === 'INPUT' && e.target.type === 'checkbox') return
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        onToggleCheck(task.id, !isChecked, e.nativeEvent)
      } else {
        onOpen(task.id)
      }
    },
    children: [
      jsxs('div', {
        className: cn(
          'relative flex items-center gap-1.5 min-w-0 sticky left-0 z-10 self-stretch',
          isSelected ? 'font-semibold text-(--ui-accent)' : ''
        ),
        'data-glass-opaque': true,
        style: {
          paddingLeft: `${marks.indent}px`,
          paddingRight: '8px',
          width: listMode ? undefined : `${labelW}px`,
          // Opaque fill spanning the full row height, tinted like the row
          // itself so the selection/check highlight stays visible through it.
          backgroundColor: isSelected
            ? 'color-mix(in srgb, var(--ui-accent) 12%, var(--ui-bg-chrome))'
            : isChecked
              ? 'color-mix(in srgb, var(--ui-accent) 6%, var(--ui-bg-chrome))'
              : descendantOfSelected
                ? 'color-mix(in srgb, var(--ui-accent) 7%, var(--ui-bg-chrome))'
                : isEven
                  ? 'color-mix(in srgb, var(--ui-text-primary) 2%, var(--ui-bg-chrome))'
                  : 'var(--ui-bg-chrome)'
        },
        children: [
          ...connectors,
          foldSquare,
          jsx('input', {
            type: 'checkbox',
            checked: Boolean(isChecked),
            onChange: e => onToggleCheck(task.id, e.target.checked, e.nativeEvent),
            onClick: e => e.stopPropagation(),
            className: 'shrink-0 rounded cursor-pointer mr-1',
            'aria-label': i18n.selectTask(name)
          }),
          jsx('span', {
            className: 'inline-flex items-center justify-center shrink-0 self-center',
            style: { color: dotColor },
            title: statusTitle,
            'aria-label': statusTitle,
            children: task.status === 'running'
              ? jsxs('span', {
                  className: 'relative inline-flex items-center justify-center',
                  children: [
                    jsx('div', { className: 'kg-arc', style: { '--kanban-tone': dotColor } }),
                    jsx(Codicon, { name: icon, size: '0.85rem' })
                  ]
                })
              : jsx(Codicon, { name: icon, size: '0.85rem' })
          }),
          showBoardBadge && task.board
            ? jsx(Badge, {
                size: 'xs',
                variant: 'outline',
                className: 'shrink-0 font-mono text-[9px] px-1 py-0 h-3.5 max-w-[80px] truncate leading-tight',
                title: `${i18n.board} ${task.board}`,
                children: task.board
              })
            : null,
          jsxs('span', {
            className: cn(
              'relative inline-flex items-center min-w-0 flex-1 whitespace-nowrap overflow-hidden text-ellipsis text-[11px] text-left select-none px-1 py-0.5 rounded',
              task.status === 'running' && 'font-medium',
              isSelected ? 'font-bold text-(--ui-accent)' : '',
              // Drop feedback while another row is being dragged over this one.
              dragState === 'ok' && 'ring-1 ring-inset ring-(--ui-accent) bg-(--ui-accent)/10',
              dragState === 'no' && 'ring-1 ring-inset ring-red-500/60 bg-red-500/10'
            ),
            title: `${showBoardBadge && task.board ? `[${task.board}] ` : ''}${name} (${task.id}) — ${i18n.clickForDetail}`,
            // Drag handle = the name cell only: the checkbox, the bars and the
            // width handles keep their own gestures, and a plain click still
            // opens the detail (native DnD needs actual movement to start).
            draggable: true,
            onDragStart: event => {
              event.dataTransfer.setData('text/plain', task.id)
              event.dataTransfer.effectAllowed = 'move'
              onDragStartTask(task.id)
            },
            onDragEnd: () => onDragEndTask(),
            onDragOver: event => {
              if (!onDropOn) return
              event.preventDefault()
              event.dataTransfer.dropEffect = dragState === 'ok' ? 'move' : 'none'
            },
            onDrop: event => {
              if (!onDropOn) return
              event.preventDefault()
              event.stopPropagation()
              onDropOn(task.id)
            },
            children: [
              task.status === 'running'
                ? jsx('div', { className: 'kg-arc', style: { '--kanban-tone': dotColor } })
                : null,
              showPrefixTags && prefix
                ? jsx('span', {
                    className: 'shrink-0 mr-1 rounded-sm font-semibold',
                    style: {
                      padding: '0 3px',
                      fontSize: '9px',
                      lineHeight: '1.35',
                      color: 'var(--ui-text-secondary)',
                      backgroundColor: 'var(--ui-bg-tertiary)',
                      border: '1px solid var(--ui-stroke-tertiary)'
                    },
                    children: prefix
                  })
                : null,
              name
            ]
          }),
          // The paperclip sits with the assignee, in the row's right-hand group: inside the
          // truncated label cell, after a long title, it was pushed out of sight. In list view
          // it has its own column instead, hence the guard.
          listMode ? null : jsx(AttachmentMenu, {
            taskId: task.id,
            board: task.board,
            count: task.attachment_count,
            i18n,
            onPreview: (att, siblings) => $openAttachment.set(
              attachmentPreviewState(task.id, task.board, att, siblings)
            )
          }),
          // Assignee at a glance: avatar when assigned, a faint dashed ring when not.
          // (The list view has its own assignee column.)
          listMode ? null : task.assignee
            ? jsx('span', {
                className: 'shrink-0 inline-flex',
                title: `${i18n.assignLabel} ${task.assignee}`,
                children: jsx(ProfileAvatar, { name: task.assignee, size: '0.95rem' })
              })
            : jsx('span', {
                className: 'shrink-0 rounded-full border border-dashed border-(--ui-text-quaternary) opacity-60',
                style: { width: '0.95rem', height: '0.95rem' },
                title: i18n.unassigned,
                'aria-label': i18n.unassigned
              })
        ]
      }),
      listMode ? jsx(ListCells, { task, now, statusTitle, dotColor }) : jsxs('div', {
        className: 'relative overflow-hidden',
        style: { height: `${ROW_H}px` },
        children: bars.length > 0
          ? bars.map((b, idx) => jsx(Bar, { key: b.runId || idx, task, bar: b, pxPerSec, min, onOpen }))
          : [jsx('div', { key: 'empty', className: 'text-(--ui-text-quaternary) text-[10px]', children: '—' })]
      })
    ]
  })
}

/** List view columns: task | assignee | status | last activity | attachments (a paperclip,
 *  or nothing — the column is as narrow as the icon it can hold). */
const LIST_COLUMNS = 'minmax(0, 1fr) 150px 96px 64px 40px'

/** The meta cells a list row shows instead of the timeline bars. */
function ListCells({ task, now, statusTitle, dotColor }) {
  const i18n = useGanttI18n()
  const last = lastActivity(task)
  return [
    jsx('div', {
      key: 'assignee',
      className: 'flex items-center gap-1.5 min-w-0 px-2 text-[11px]',
      children: task.assignee
        ? [jsx(ProfileAvatar, { key: 'a', name: task.assignee, size: '0.95rem' }),
           jsx('span', { key: 'n', className: 'truncate', children: task.assignee })]
        : jsx('span', { className: 'text-(--ui-text-quaternary) italic', children: i18n.unassigned })
    }),
    jsx('div', {
      key: 'status',
      className: 'px-2 text-[11px] truncate',
      style: { color: dotColor },
      children: statusTitle
    }),
    jsx('div', {
      key: 'age',
      className: 'px-2 text-[10px] tabular-nums text-right text-(--ui-text-tertiary)',
      title: last ? new Date(last * 1000).toLocaleString() : '',
      children: relativeAge(last, now, i18n.relativeUnits)
    }),
    jsx('div', {
      key: 'attachments',
      // The dedicated end column asked for: as narrow as the paperclip it can hold, and it
      // has to be the LAST cell, because LIST_COLUMNS ends with its 40 px.
      className: 'flex items-center justify-end pr-2',
      children: jsx(AttachmentMenu, {
        taskId: task.id,
        board: task.board,
        count: task.attachment_count,
        i18n,
        onPreview: (att, siblings) => $openAttachment.set(
          attachmentPreviewState(task.id, task.board, att, siblings)
        )
      })
    })
  ]
}

function ProfileAvatar({ name, size = '1rem' }) {
  const color = profileColor(name)
  const initials = (() => {
    const parts = (name || '?').split(/[\s_\-./]+/).filter(Boolean)
    return `${parts[0]?.[0] ?? '?'}${parts[1]?.[0] ?? ''}`.toUpperCase()
  })()
  return jsx('span', {
    className: 'grid shrink-0 place-items-center rounded-full font-semibold select-none',
    style: {
      backgroundColor: color ? profileColorSoft(color, 22) : 'var(--ui-bg-quaternary, rgba(150,150,150,0.15))',
      color: color ?? 'var(--ui-text-secondary)',
      height: size,
      width: size,
      // The circle inherits the shell's 11px/16.5px text defaults, and a 16.5px line
      // box cannot be centred inside a 15px circle. The previous `text-[8px]` did
      // nothing either — an arbitrary Tailwind value is absent from the desktop's
      // PRECOMPILED stylesheet, so the class was never emitted. Hence an explicit size,
      // relative to the circle so a caller can pass any size.
      fontSize: `calc(${size} * 0.5)`
    },
    title: name,
    children: jsx('span', {
      // The initials get their own block, and that is not decoration: as a direct child
      // of the grid the text lands in an ANONYMOUS grid item, where `text-box-trim`
      // does not apply (setting it on the circle changed nothing — measured). A block
      // of its own owns its line box, so the trim takes effect.
      style: {
        display: 'block',
        lineHeight: 1,
        // Centring the line box is not centring the ink. With `line-height: 1` the box
        // is 7.6px while the glyph's natural line height is ~10px, so the baseline was
        // painted 5.7px BELOW the circle's centre (measured: box centre -0.02px,
        // baseline +5.69px) and the letters sat in the lower half. Trimming the inline
        // box to the cap height makes the centred box the caps themselves, exactly, for
        // any font and any size (measured after: +0.37px). Both properties are needed —
        // `text-box` only sets the EDGE, `text-box-trim` is what removes the leading.
        // Chromium 133+; elsewhere the declarations are ignored and the previous
        // behaviour stands rather than a broken one.
        textBoxTrim: 'trim-both',
        textBoxEdge: 'cap alphabetic'
      },
      children: initials
    })
  })
}

const ALL_STATUS_KEYS = ['ready', 'running', 'review', 'blocked', 'scheduled', 'todo', 'triage', 'done']

function FilterDropdown({
  assignees,
  selectedAssignees,
  onToggleAssignee,
  onClearAssignees,
  disabledStatuses,
  onToggleStatus,
  showArchived,
  onToggleArchived,
  onlyAttachments,
  onToggleOnlyAttachments
}) {
  const i18n = useGanttI18n()
  const active = selectedAssignees.size > 0 || disabledStatuses.size > 0 || showArchived || onlyAttachments
  return jsxs(DropdownMenu, {
    children: [
      jsx(DropdownMenuTrigger, {
        asChild: true,
        children: jsx(Button, {
          size: 'icon-xs',
          variant: 'ghost',
          className: cn(active && 'bg-(--ui-control-active-background) text-(--ui-accent)'),
          'aria-label': i18n.filters,
          children: jsx(Codicon, { name: 'filter', size: '0.85rem' })
        })
      }),
      jsxs(DropdownMenuContent, {
        align: 'start',
        className: 'min-w-[12rem] p-1',
        children: [
          jsx('div', { className: 'px-2 py-1 text-[10px] font-semibold uppercase text-(--ui-text-tertiary)', children: i18n.profiles }),
          jsxs(DropdownMenuItem, {
            onClick: onClearAssignees,
            className: 'flex items-center gap-2 cursor-pointer text-xs py-1.5',
            children: [
              jsx('span', { className: 'flex-1 font-medium', children: i18n.allProfiles }),
              selectedAssignees.size === 0 ? jsx(Codicon, { name: 'check', size: '0.8rem', className: 'ml-auto' }) : null
            ]
          }),
          assignees.map(name => {
            const isChecked = selectedAssignees.has(name)
            return jsxs(DropdownMenuItem, {
              key: name,
              onClick: () => onToggleAssignee(name),
              className: 'flex items-center gap-2 cursor-pointer text-xs py-1.5',
              children: [
                jsx(ProfileAvatar, { name, size: '1rem' }),
                jsx('span', { className: 'flex-1', children: name }),
                isChecked ? jsx(Codicon, { name: 'check', size: '0.8rem', className: 'ml-auto' }) : null
              ]
            })
          }),
          jsx(DropdownMenuSeparator, {}),
          jsx('div', { className: 'px-2 py-1 text-[10px] font-semibold uppercase text-(--ui-text-tertiary)', children: i18n.statuses }),
          ALL_STATUS_KEYS.map(s => {
            const isVisible = !disabledStatuses.has(s)
            const meta = STATUS_META[s] || { tone: 'var(--ui-text-secondary)', label: s }
            const label = i18n.col?.[s] || meta.label
            return jsxs(DropdownMenuItem, {
              key: s,
              onClick: () => onToggleStatus(s),
              className: 'flex items-center gap-2 cursor-pointer text-xs py-1.5',
              children: [
                jsx('span', { className: 'h-2 w-2 rounded-full shrink-0', style: { backgroundColor: meta.tone } }),
                jsx('span', { className: cn('flex-1', !isVisible && 'line-through opacity-50'), children: label }),
                isVisible ? jsx(Codicon, { name: 'check', size: '0.8rem', className: 'ml-auto' }) : null
              ]
            })
          }),
          jsx(DropdownMenuSeparator, {}),
          jsxs(DropdownMenuItem, {
            onClick: () => onToggleArchived(!showArchived),
            className: 'flex items-center gap-2 cursor-pointer text-xs py-1.5',
            children: [
              jsx('span', { className: 'flex-1', children: i18n.showArchived }),
              showArchived ? jsx(Codicon, { name: 'check', size: '0.8rem', className: 'ml-auto' }) : null
            ]
          }),
          jsxs(DropdownMenuItem, {
            // Off by default, like every other filter here: checking it narrows the board.
            onClick: () => onToggleOnlyAttachments(!onlyAttachments),
            className: 'flex items-center gap-2 cursor-pointer text-xs py-1.5',
            children: [
              jsx(Codicon, { name: 'attach', size: '0.8rem', className: 'shrink-0 text-(--ui-text-tertiary)' }),
              jsx('span', { className: 'flex-1', children: i18n.filterWithAttachments }),
              onlyAttachments ? jsx(Codicon, { name: 'check', size: '0.8rem', className: 'ml-auto' }) : null
            ]
          })
        ]
      })
    ]
  })
}

function Legend({ disabledStatuses, onToggleStatus }) {
  const i18n = useGanttI18n()
  const item = (statusKey, color, txt) => {
    const isExcluded = disabledStatuses ? disabledStatuses.has(statusKey) : false
    const label = i18n.col?.[statusKey] || txt
    return jsxs('button', {
      type: 'button',
      onClick: onToggleStatus ? () => onToggleStatus(statusKey) : undefined,
      className: cn(
        'inline-flex items-center gap-1.5 text-[10px] cursor-pointer bg-transparent border-0 p-0 select-none transition-opacity hover:opacity-100',
        isExcluded ? 'opacity-40 line-through text-(--ui-text-quaternary)' : 'text-(--ui-text-tertiary)'
      ),
      title: isExcluded ? i18n.legendShow(label) : i18n.legendHide(label),
      children: [
        jsx('div', {
          className: 'h-2 w-3 rounded-xs shrink-0',
          style: { backgroundColor: color, opacity: isExcluded ? 0.3 : 1 }
        }),
        jsx('span', { children: label })
      ]
    })
  }
  return jsxs('div', {
    className: 'flex flex-wrap items-center gap-3 pt-2 border-t border-(--ui-stroke-tertiary)/50 shrink-0 mt-auto select-none',
    children: [
      item('ready', '#60a5fa', 'Ready'),
      item('running', '#34d399', 'Running'),
      item('review', '#fbbf24', 'Review'),
      item('blocked', '#f87171', 'Blocked'),
      item('scheduled', '#a78bfa', 'Scheduled'),
      item('todo', 'var(--ui-text-secondary)', 'Todo'),
      item('triage', 'var(--ui-text-tertiary)', 'Triage'),
      item('done', 'var(--ui-text-tertiary)', 'Done'),
      item('archived', 'var(--ui-text-quaternary)', 'Archived')
    ]
  })
}
function WeekendBands({ min, max, pxPerSec }) {
  const step = DAY
  const bands = []
  let t = Math.floor(min / step) * step
  while (t <= max) {
    const d = new Date(t * 1000)
    const dayOfWeek = d.getUTCDay() // 0 = Sun, 6 = Sat
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      const left = Math.round((t - min) * pxPerSec)
      const width = Math.round(DAY * pxPerSec)
      bands.push(jsx('div', {
        className: 'absolute top-0 bottom-0 pointer-events-none bg-black/15 dark:bg-black/25',
        style: { left: `${left}px`, width: `${width}px` }
      }, t))
    }
    t += step
  }
  return jsxs('div', { className: 'absolute inset-0 pointer-events-none z-0', children: bands })
}

/* ─────────────────────────── i18n locale bundles ─────────────────────────── */


/* ─────────────────────────── task drawer (read+write) ─────────────────────── */

// Status tone — EXACTLY the official Kanban plugin's COLUMN_META tones
// (apps/desktop/src/plugins/kanban/types.ts) so both plugins read alike.
const STATUS_META = {
  triage:    { tone: 'var(--ui-text-tertiary)', label: 'Triage' },
  todo:      { tone: 'var(--ui-text-secondary)', label: 'Todo' },
  scheduled: { tone: '#a78bfa', label: 'Scheduled' },
  ready:     { tone: '#60a5fa', label: 'Ready' },
  running:   { tone: '#34d399', label: 'Running' },
  blocked:   { tone: statusTone('blocked'), label: 'Blocked' },
  review:    { tone: statusTone('review'), label: 'Review' },
  done:      { tone: 'var(--ui-text-tertiary)', label: 'Done' },
  archived:  { tone: 'var(--ui-text-quaternary)', label: 'Archived' }
}
const STATUS_ORDER = ['triage', 'todo', 'ready', 'blocked', 'running', 'review', 'done']

// Action matrix (validated by the user): primary actions per status, the rest
// behind "...". Every transition routes through the domain layer.
const ACTION_MATRIX = {
  triage:   { primary: ['todo'], more: ['blocked', 'archive'] },
  todo:     { primary: ['ready'], more: ['blocked', 'review', 'archive'] },
  scheduled:{ primary: ['ready'], more: ['blocked', 'archive'] },
  ready:    { primary: ['done', 'blocked'], more: ['review', 'archive'] },
  running:  { primary: ['done', 'review'], more: ['blocked'] },
  blocked:  { primary: ['ready'], more: ['review', 'archive'] },
  review:   { primary: ['done', 'reopen'], more: ['blocked'] },
  done:     { primary: ['archive'], more: ['ready'] },
  archived: { primary: ['done'], more: [] }
}

function AssigneeBadge({ assignee, assignees = [], onAssign, disabled }) {
  const i18n = useGanttI18n()
  const current = assignee || i18n.unassigned
  return jsxs(DropdownMenu, { children: [
    jsx(DropdownMenuTrigger, {
      asChild: true,
      disabled,
      children: jsx('button', {
        type: 'button',
        className: 'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium cursor-pointer border border-(--ui-stroke-secondary) bg-(--ui-bg-subtle, transparent) hover:bg-(--chrome-action-hover)',
        children: [
          assignee ? jsx(ProfileAvatar, { name: assignee, size: '0.9rem' }) : jsx('span', { className: 'text-(--ui-text-tertiary)', children: '👤' }),
          jsx('span', { children: current }),
          jsx('span', { className: 'text-[9px] opacity-60', children: '▾' })
        ]
      })
    }),
    jsxs(DropdownMenuContent, {
      align: 'start',
      className: 'min-w-[10rem] p-1',
      children: [
        jsx(DropdownMenuItem, {
          className: 'flex items-center gap-2 px-2.5 py-1 text-[11px] text-(--ui-text-tertiary)',
          onClick: () => onAssign(''),
          children: [
            jsx('span', { className: 'flex-1', children: i18n.unassignedEmpty }),
            !assignee ? jsx('span', { className: 'opacity-60', children: '✓' }) : null
          ]
        }),
        assignees.map(name => {
          const isCur = name === assignee
          return jsx(DropdownMenuItem, {
            key: name,
            className: 'flex items-center gap-2 px-2.5 py-1 text-[11px]',
            onClick: () => onAssign(name),
            children: [
              jsx(ProfileAvatar, { name, size: '0.9rem' }),
              jsx('span', { className: 'flex-1', children: name }),
              isCur ? jsx('span', { className: 'opacity-60', children: '✓' }) : null
            ]
          }, name)
        })
      ]
    })
  ] })
}

/** One segment of the detail's feed strip.
 *
 *  A button rather than a tab widget: the three panels are siblings and only one is mounted at a
 *  time, so there is nothing for a widget to manage beyond the selection this already carries. The
 *  classes are the view toggle's, which keeps the two segmented controls looking like one idea.
 *
 *  The count is a badge beside the label, not a number inside it: "Comments" then "3" reads at a
 *  glance in a 11 px strip, where "Comments (3)" turns the tab into a sentence to parse. `aria-label`
 *  keeps the full form for a screen reader.
 */
function FeedTab({ label, count, ariaLabel, active, onClick }) {
  return jsx('button', {
    type: 'button',
    role: 'tab',
    'aria-selected': active ? 'true' : 'false',
    'aria-label': ariaLabel,
    onClick,
    className: cn(
      'inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] rounded cursor-pointer border-0',
      active ? 'bg-(--ui-accent)/15 text-(--ui-accent) font-medium' : 'bg-transparent text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover)'
    ),
    children: [
      jsx('span', { className: 'whitespace-nowrap', children: label }),
      jsx('span', {
        className: cn(
          'inline-flex min-w-[1.05rem] items-center justify-center rounded-full px-1 text-[9.5px] font-semibold leading-[1.35] tabular-nums',
          active ? 'bg-(--ui-accent)/22 text-(--ui-accent)' : 'bg-(--ui-bg-tertiary) text-(--ui-text-tertiary)'
        ),
        children: String(count)
      })
    ]
  })
}

function ViewToggle({ value, onChange }) {
  const i18n = useGanttI18n()
  const item = (mode, icon, label) => jsx('button', {
    type: 'button',
    onClick: () => onChange(mode),
    title: label,
    'aria-label': label,
    'aria-pressed': value === mode,
    className: cn(
      'inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded cursor-pointer',
      value === mode ? 'bg-(--ui-accent)/15 text-(--ui-accent) font-medium' : 'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover)'
    ),
    children: [jsx(Codicon, { key: 'i', name: icon, size: '0.8rem' }), jsx('span', { key: 'l', children: label })]
  }, mode)
  return jsxs('span', {
    className: 'inline-flex items-center gap-0.5 rounded-md border border-(--ui-stroke-secondary) p-0.5',
    role: 'group',
    children: [
      item('list', 'list-flat', i18n.viewList),
      item('timeline', 'graph-line', i18n.viewTimeline),
      // Third value, same persistence and same chrome as the other two. The icon is the
      // hierarchy glyph because the view answers "what hangs off what", not "when".
      item('graph', 'type-hierarchy', i18n.viewGraph)
    ]
  })
}

/** Spread and zoom limits of the graph, in multiples of the layout's own size. */
const GRAPH_ZOOM_MIN = 0.35
const GRAPH_ZOOM_MAX = 2.5
/** Breathing room around the layout, so the first and last nodes are not flush with the
 *  canvas edge (and a selected node's ring is not clipped). */
const GRAPH_MARGIN = 28
/**
 * The third view: the dependency structure, not the time.
 *
 * Drawn as HTML nodes over an SVG edge layer, under one shared transform. That is a
 * deliberate departure from "all-SVG": a node carries real components — the Codicon
 * status glyph, the profile avatar with its initials, the paperclip's hover menu — and
 * putting those inside `<foreignObject>` to satisfy a purity argument would cost layout
 * bugs and print fidelity for nothing. Edges are paths, because paths are what SVG is
 * for; the boxes are boxes.
 *
 * Everything the layout needs comes from `graph-core` (pure, unit-tested); this function
 * only places what that returns and reports what the reader does. It deliberately reads
 * NO atoms: the page owns selection, zoom, scope and the drag state, and passes them in,
 * which is also what makes the whole view renderable in the test harness.
 */
export function GraphView({
  tasks = [],
  i18n,
  now,
  zoom = 1,
  onZoom,
  scope = 'all',
  onScopeChange,
  selectedId = null,
  showBoardBadge = false,
  /** board slug -> its label, for the group frames (only used when grouping) */
  groupLabel = slug => slug,
  board = '',
  dragId = null,
  dropMap = null,
  onOpen,
  onDragStart,
  onDragEnd,
  onDropOn,
  onNewChild,
  /** Called on a click that did NOT drag and did not land on a card: the empty canvas. */
  onClearSelection,
  /**
   * Linking from a card's slot: `parentId` is the card the arrow starts from, `childId` the card
   * the arrow head is released on. It is the INVERSE of the drag gesture, where the dragged card
   * becomes the child of the card it is dropped on.
   */
  onLinkChild,
  /** (parentId) => Set of task ids that may become `parentId`'s child. */
  linkAllowed,
  /** Taller cards: the title wraps onto a second line instead of being cut. */
  tallCards = false,
  /** 'down' | 'flow' | 'status' | 'compact' — see `layoutGraph`. */
  arrangement = 'down',
  sortBy = 'status'
}) {
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(null)
  // Proximity drop: while a card is being dragged, the NEAREST valid card within NEAR_PX is the
  // target, not just the one under the pointer. Releasing anywhere in that halo links the two —
  // aiming at a 172 px box, at 60 % zoom, with the pointer over a gap, was a game of skill.
  const NEAR_PX = 64
  const [nearTarget, setNearTarget] = useState(null)
  const dragRects = useRef(new Map())
  // The LINK slot: a handle on the bottom border of a card, armed when the pointer comes near
  // it, that starts an arrow whose head the pointer drives. Clicking the slot must not start a
  // card drag — the two gestures are inverses (drag = the card becomes the child; arrow = the
  // card the head lands on becomes the child).
  const SLOT_HALO = 26
  const [slotFor, setSlotFor] = useState(null)
  const [slotNear, setSlotNear] = useState(false)
  const [link, setLink] = useState(null)
  const linkRef = useRef(null)
  linkRef.current = link
  const wrapperRef = useRef(null)
  const allowedFor = useMemo(() => (link && linkAllowed ? linkAllowed(link.from) : null), [link, linkAllowed])
  const pressedAt = useRef(null)
  const canvasRef = useRef(null)

  const nodes = useMemo(() => graphNodes(tasks), [tasks])
  const edges = useMemo(() => graphEdges(tasks), [tasks])
  // The scope is a filter ON TOP of the funnel: `tasks` is already what the funnel, the
  // search and the status chips allow, and this narrows it further.
  const shown = useMemo(() => {
    const keep = scopeIds(nodes, edges, scope)
    return nodes.filter(n => keep.has(n.id))
  }, [nodes, edges, scope])
  // Grouping replaces the per-card board badge: in an all-boards graph each board becomes a
  // framed, contiguous block with its name at the top-left — the shape kanban-graph uses, and
  // the only one where "where does this board end?" is answerable at a glance.
  const grouping = showBoardBadge
  // Three wrapped lines need a taller AND wider card; 40 more pixels of width is roughly ten
  // more characters per line, which is what turns "Draft the rollout with screenshot…" into
  // the whole sentence.
  const nodeH = tallCards ? NODE_H + 34 : NODE_H
  const nodeW = tallCards ? NODE_W + 48 : NODE_W
  const layout = useMemo(
    () => layoutGraph(shown, edges, { sortBy, nodeH, nodeW, arrangement, groupBy: grouping ? n => n.board || '' : null }),
    [shown, edges, sortBy, grouping, nodeH, nodeW, arrangement]
  )
  const lin = useMemo(() => {
    if (!selectedId || !shown.some(n => n.id === selectedId)) return null
    const { upstream, downstream } = lineage(shown, edges, selectedId)
    return { up: upstream, down: downstream }
  }, [shown, edges, selectedId])

  const hiddenByScope = nodes.length - shown.length
  // Which board the selected card belongs to: its frame is lit, so a reader in an all-boards
  // graph sees WHERE they are, not just which card.
  // What each frame says under its name: the board's own tally, in the board's own vocabulary
  // ("14 tasks · 5 todo · 1 blocked"), computed from the tasks actually in the graph — a
  // summary of what is DRAWN, not of what the board holds.
  const groupTally = useMemo(() => {
    const out = new Map()
    const ORDER = ['triage', 'todo', 'scheduled', 'ready', 'running', 'blocked', 'review', 'done', 'archived']
    for (const n of shown) {
      const key = n.board || ''
      if (!out.has(key)) out.set(key, { total: 0, counts: new Map() })
      const entry = out.get(key)
      entry.total++
      const st = n.status || 'todo'
      entry.counts.set(st, (entry.counts.get(st) || 0) + 1)
    }
    return new Map([...out].map(([key, e]) => [key, {
      total: e.total,
      parts: ORDER.filter(st => e.counts.has(st)).map(st => `${e.counts.get(st)} ${((i18n.col && i18n.col[st]) || st).toLowerCase()}`)
    }]))
  }, [shown, i18n])

  const selectedBoard = useMemo(() => {
    if (!selectedId) return null
    const n = shown.find(x => x.id === selectedId)
    return n ? (n.board || '') : null
  }, [shown, selectedId])

  // FIT MODE. Fit is not just a button: it is a MODE the view can stay in. While it is on, the
  // view re-fits itself whenever the canvas changes size — which is exactly what opening or
  // collapsing the detail pane does — so the graph never ends up half out of frame because a
  // pane took 400 px. Any camera gesture of the reader's own (wheel, drag, slider, +/-) leaves
  // the mode, and the button stops being lit.
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const [autoFit, setAutoFit] = useState(true)
  const autoFitRef = useRef(true)
  autoFitRef.current = autoFit
  // The scale the last fit produced: a zoom that differs from it came from somewhere else.
  const fitPctRef = useRef(null)
  const fittedSize = useRef('')
  const fitView = (mark = true) => {
    const el = canvasRef.current
    if (!el || !layout.width || !layout.height) return
    const rect = el.getBoundingClientRect()
    const fit = Math.min(
      1,
      (rect.width - GRAPH_MARGIN * 2) / layout.width,
      (rect.height - GRAPH_MARGIN * 2) / layout.height
    )
    const pct = Math.min(GRAPH_ZOOM_MAX, Math.max(GRAPH_ZOOM_MIN, fit))
    fitPctRef.current = pct
    if (mark) {
      setAutoFit(true)
      autoFitRef.current = true
    }
    if (onZoom) onZoom(pct)
    // Centre what is left of the pane: a fitted graph pinned to the top-left corner looks like
    // it forgot to finish the job, and every reading gesture starts from the middle.
    const w = (layout.width + GRAPH_MARGIN * 2) * pct
    const h = (layout.height + GRAPH_MARGIN * 2) * pct
    setPan({
      x: Math.max(GRAPH_MARGIN / 2, (rect.width - w) / 2),
      y: Math.max(GRAPH_MARGIN / 2, (rect.height - h) / 2)
    })
  }
  // A zoom the view did not produce itself means the reader took the camera: leave the mode.
  useEffect(() => {
    if (fitPctRef.current == null) return
    if (Math.abs(zoom - fitPctRef.current) > 0.005) setAutoFit(false)
  }, [zoom])
  useEffect(() => {
    if (!layout.width || !layout.height) return
    // Refit when the layout's SIZE changes (another board, another scope), not on every
    // refresh: a reader who zoomed in keeps their scale while the data moves under it.
    const size = `${Math.round(layout.width / 24)}x${Math.round(layout.height / 24)}`
    if (fittedSize.current === size) return
    fittedSize.current = size
    fitView()
  }, [layout.width, layout.height, onZoom])
  // The pane resizing (a docked detail, the sidebar collapsing, the window) re-fits, but only
  // while the mode is on — a reader who placed the camera keeps it.
  useEffect(() => {
    const el = canvasRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => {
      if (autoFitRef.current) fitView()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [layout.width, layout.height, onZoom])
  // Box lookup by id: a linear find per node turns the render pass quadratic, which on a
  // 500-task board is 250 000 comparisons on every pan.
  const boxes = useMemo(() => new Map(layout.nodes.map(b => [b.id, b])), [layout])

  // ── linking from a card's slot ────────────────────────────────────────────
  // Screen -> layout is exact: the surface is scaled from its top-left corner, so a client
  // point divided by the zoom (minus the surface origin) is a layout coordinate.
  const toLayout = event => {
    const el = wrapperRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: (event.clientX - r.left) / zoom, y: (event.clientY - r.top) / zoom }
  }
  /** The card whose SLOT (bottom border, centred) is under the pointer, within SLOT_HALO. */
  const slotUnder = pt => {
    if (!pt) return null
    let best = null
    let bestD = SLOT_HALO
    for (const b of boxes.values()) {
      const cx = b.x + b.w / 2 + GRAPH_MARGIN
      const cy = b.y + b.h + GRAPH_MARGIN
      if (Math.abs(pt.x - cx) > b.w / 2 + 10) continue
      const d = Math.abs(pt.y - cy)
      if (d < bestD) { bestD = d; best = b.id }
    }
    return best
  }
  /** The card the arrow HEAD is over (or near), which is the one that would become the child. */
  const cardUnder = (pt, exclude) => {
    if (!pt) return null
    let best = null
    let bestD = 34
    for (const b of boxes.values()) {
      if (b.id === exclude) continue
      const dx = Math.max(b.x + GRAPH_MARGIN - pt.x, 0, pt.x - (b.x + b.w + GRAPH_MARGIN))
      const dy = Math.max(b.y + GRAPH_MARGIN - pt.y, 0, pt.y - (b.y + b.h + GRAPH_MARGIN))
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d < bestD) { bestD = d; best = b.id }
    }
    return best
  }
  const onCanvasPointerMove = event => {
    if (dragging || link) return
    const pt = toLayout(event)
    const slot = slotUnder(pt)
    if (slot !== slotFor) setSlotFor(slot)
    if (slot) {
      const b = boxes.get(slot)
      const cx = b.x + b.w / 2 + GRAPH_MARGIN
      const cy = b.y + b.h + GRAPH_MARGIN
      setSlotNear(Math.sqrt((pt.x - cx) ** 2 + (pt.y - cy) ** 2) < 16)
    } else if (slotNear) {
      setSlotNear(false)
    }
  }
  const startLink = (event, id) => {
    // preventDefault stops the browser from starting a card drag under the slot, and the
    // card's own `draggable` is off while a link is in flight: the two gestures are inverses.
    event.preventDefault()
    event.stopPropagation()
    const b = boxes.get(id)
    if (!b) return
    setSlotNear(false)
    setLink({ from: id, x: b.x + b.w / 2 + GRAPH_MARGIN, y: b.y + b.h + GRAPH_MARGIN, target: null })
  }
  const allowedRef = useRef(null)
  allowedRef.current = allowedFor
  const linkFrom = link ? link.from : null
  useEffect(() => {
    if (!linkFrom) return undefined
    const move = event => {
      const pt = toLayout(event)
      if (!pt) return
      const raw = cardUnder(pt, linkFrom)
      const allowed = allowedRef.current
      const target = raw && (!allowed || allowed.has(raw)) ? raw : null
      setLink(current => (current ? { ...current, x: pt.x, y: pt.y, target } : current))
    }
    const up = () => {
      const current = linkRef.current
      setLink(null)
      if (current && current.target && onLinkChild) onLinkChild(current.from, current.target)
    }
    const key = event => {
      if (event.key === 'Escape') setLink(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', key)
    }
  }, [linkFrom, zoom, onLinkChild])

  // Ctrl/⌘+wheel zooms at the cursor (the same gesture as the timeline, so nobody has to
  // learn a second one); plain wheel scrolls, Shift+wheel pans. The listener is native
  // and non-passive because React's wheel listeners are passive and cannot cancel
  // Chromium's page zoom.
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return undefined
    const onWheel = event => {
      const intent = wheelIntent(event)
      event.preventDefault()
      if (intent === 'zoom') {
        const rect = el.getBoundingClientRect()
        const cx = event.clientX - rect.left
        const cy = event.clientY - rect.top
        const next = Math.min(GRAPH_ZOOM_MAX, Math.max(GRAPH_ZOOM_MIN, zoom * wheelZoomFactor(event.deltaY, event.deltaMode)))
        if (next === zoom) return
        // Keep the point under the cursor still: that is the whole difference between
        // zooming and jumping.
        setPan(p => ({ x: cx - (cx - p.x) * (next / zoom), y: cy - (cy - p.y) * (next / zoom) }))
        if (onZoom) onZoom(next)
        return
      }
      if (intent === 'pan') setPan(p => ({ x: p.x - event.deltaY, y: p.y }))
      else setPan(p => ({ x: p.x - (event.deltaX || 0), y: p.y - event.deltaY }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoom, onZoom])

  // Dragging the empty canvas pans: the pointer leaves the surface as soon as the gesture
  // starts, so the move/up listeners live on the window and are removed with it.
  const onCanvasPointerDown = event => {
    if (event.button !== 0) return
    // Panning works at ANY zoom. The old rule — "only the canvas or the svg" — held at fit
    // zoom, where empty space sits under the cursor, and broke the moment you zoomed in: the
    // scaled surface then covers the pane, so every press landed on a card and nothing moved.
    // The rule is what the reader can ACT on: cards drag (HTML5 DnD), buttons and links
    // click. Everything else is the hand.
    const target = event.target
    if (target && target.closest && target.closest('[data-graph-node],button,a,input,select,textarea,[role=button]')) return
    event.preventDefault()
    pressedAt.current = { x: event.clientX, y: event.clientY }
    // Taking the camera by hand ends FIT MODE, even before the pointer has moved: from here on
    // the reader decides where the graph sits, and a resize must not yank it back.
    setAutoFit(false)
    const start = { x: event.clientX - pan.x, y: event.clientY - pan.y }
    setDragging(start)
  }
  useEffect(() => {
    if (!dragging) return undefined
    const onMove = event => setPan({ x: event.clientX - dragging.x, y: event.clientY - dragging.y })
    // A press that never moved is a CLICK on the empty canvas, and it clears the selection:
    // once a card was picked there was no way back except closing the drawer, which left the
    // graph with a highlighted lineage nobody asked for any more.
    const onUp = event => {
      const from = pressedAt.current
      pressedAt.current = null
      if (from && event && Math.hypot(event.clientX - from.x, event.clientY - from.y) < 5 && onClearSelection) {
        onClearSelection()
      }
      setDragging(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragging])

  // Keyboard: the arrow keys walk the nodes in the order they are DRAWN (rank by rank,
  // left to right), which is what the eye does. Enter opens, and the page owns Esc.
  const order = useMemo(() => [...layout.nodes].sort((a, b) => (a.y - b.y) || (a.x - b.x)).map(b => b.id), [layout])
  const onKeyDown = event => {
    if (!order.length) return
    const at = order.indexOf(selectedId)
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0
    if (step) {
      event.preventDefault()
      const next = at < 0 ? (step > 0 ? 0 : order.length - 1) : Math.min(order.length - 1, Math.max(0, at + step))
      if (onOpen) onOpen(order[next])
      return
    }
    if (event.key === 'Enter' && at >= 0 && onOpen) {
      event.preventDefault()
      onOpen(order[at])
      return
    }
    // The camera keys kanban-graph teaches (0 fits, +/- step): the same three, so a reader
    // coming from that plugin does not have to learn a second vocabulary.
    if (event.key === '0') {
      event.preventDefault()
      fitView()
    } else if (event.key === '+' || event.key === '=' || event.key === '-') {
      event.preventDefault()
      const next = zoom * (event.key === '-' ? 0.8 : 1.25)
      if (onZoom) onZoom(Math.min(GRAPH_ZOOM_MAX, Math.max(GRAPH_ZOOM_MIN, next)))
    }
  }

  if (!shown.length) {
    return jsx('div', {
      className: 'py-10 flex flex-col items-center gap-3',
      children: jsx(EmptyState, {
        title: i18n.nothingToDisplay,
        description: hiddenByScope > 0 ? i18n.graphHiddenByScope(hiddenByScope) : i18n.noTasksMatch
      })
    })
  }

  const edgePath = e => {
    const mid = (e.y1 + e.y2) / 2
    return `M ${e.x1} ${e.y1} C ${e.x1} ${mid}, ${e.x2} ${mid}, ${e.x2} ${e.y2}`
  }
  const edgeTone = (from, to) => {
    if (!lin) return 'var(--ui-stroke-secondary)'
    if (lin.down.has(from) && (lin.down.has(to) || to === selectedId)) return statusTone('running')
    if (lin.up.has(to) && (lin.up.has(from) || from === selectedId)) return statusTone('scheduled')
    return 'var(--ui-stroke-secondary)'
  }

  return jsxs('div', {
    className: 'mt-2 border border-(--ui-stroke-tertiary) rounded-md flex-1 min-h-0 relative overflow-hidden',
    children: [
      jsx('div', {
        ref: canvasRef,
        className: cn('absolute inset-0 overflow-hidden', dragging ? 'cursor-grabbing' : 'cursor-grab'),
        tabIndex: 0,
        role: 'application',
        'aria-label': i18n.viewGraph,
        title: i18n.graphHint,
        onKeyDown,
        onPointerDown: onCanvasPointerDown,
        onPointerMove: onCanvasPointerMove,
        // Proximity drop lives on the CANVAS, not on the cards: a release that misses a card by
        // 20 px used to be a release into the void, which read as the feature being broken.
        onDragOver: event => {
          if (!onDropOn || !dragId) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          const pick = nearestInHalo(dragRects.current, event.clientX, event.clientY, NEAR_PX, {
            exclude: dragId,
            allowed: id => !dropMap || (dropMap.get(id) ? dropMap.get(id).allowed : true)
          })
          if (pick !== nearTarget) setNearTarget(pick)
        },
        onDragLeave: event => {
          // Only when the pointer really leaves the canvas, not when it crosses a card.
          if (event.currentTarget.contains(event.relatedTarget)) return
          setNearTarget(null)
        },
        onDrop: event => {
          if (!onDropOn) return
          event.preventDefault()
          const target = nearTarget
          setNearTarget(null)
          dragRects.current = new Map()
          if (target) onDropOn(target)
        },
        style: { cursor: dragging ? 'grabbing' : link ? 'crosshair' : slotFor ? 'crosshair' : 'grab' },
        children: jsxs('div', {
          className: 'absolute origin-top-left',
          ref: wrapperRef,
          style: {
            // `left/top: 0` is not decoration: an absolutely positioned box with no offsets
            // sits at its STATIC position, which depends on what else is in flow. Without it
            // the whole surface drifted right by whatever that position happened to be, and
            // every pan/fit number was off by the same amount.
            left: '0px',
            top: '0px',
            // Inline, not a class: the host's stylesheet does not compile `origin-top-left`
            // for us, and without it the scale grows the surface from its CENTRE — the pan
            // then means something else than what it says, and the fit hangs off the edge.
            transformOrigin: 'top left',
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            width: `${layout.width + GRAPH_MARGIN * 2}px`,
            height: `${layout.height + GRAPH_MARGIN * 2}px`
          },
          children: [
            // One frame per board, behind everything: dashed and rounded, with the name in the
            // top-left corner, so the boundary of a board is visible without a badge on
            // every card. Pointer-events off — a frame is scenery, not a target.
            ...(layout.groups || []).map(g => jsxs('div', {
              key: `frame-${g.key}`,
              className: 'absolute rounded-lg border border-dashed pointer-events-none',
              style: {
                left: `${g.x + GRAPH_MARGIN}px`,
                top: `${g.y + GRAPH_MARGIN}px`,
                width: `${g.w}px`,
                height: `${g.h}px`,
                borderColor: g.key === selectedBoard ? 'var(--ui-accent)' : 'var(--ui-stroke-tertiary)',
                backgroundColor: g.key === selectedBoard
                  ? 'color-mix(in srgb, var(--ui-accent) 7%, transparent)'
                  : 'color-mix(in srgb, var(--ui-bg-elevated) 40%, transparent)'
              },
              children: [
                jsxs('div', {
                  className: 'absolute flex flex-col gap-1 min-w-0',
                  style: { left: '12px', right: '12px', top: '10px' },
                  children: [
                    jsx('span', {
                      className: cn(
                        'truncate text-[12px] font-semibold leading-tight',
                        g.key === selectedBoard ? 'text-(--ui-accent)' : 'text-(--ui-text-primary)'
                      ),
                      // The label as the board is NAMED — no case transform, ever.
                      children: groupLabel(g.key)
                    }),
                    jsx('span', {
                      className: 'truncate text-[10px] leading-tight text-(--ui-text-tertiary)',
                      children: [g.key, i18n.graphTally(groupTally.get(g.key)?.total || 0)]
                        .concat(groupTally.get(g.key)?.parts || [])
                        .join(' · ')
                    })
                  ]
                })
              ]
            })),
            // THE SLOT. A handle on the bottom border of the card the pointer is near; it grows
            // when the pointer is on it, so it reads as something you can take hold of, and
            // pressing it starts the arrow instead of dragging the card.
            slotFor && boxes.get(slotFor)
              ? (() => {
                  const b = boxes.get(slotFor)
                  const size = slotNear ? 18 : 11
                  return jsx('div', {
                    key: 'slot',
                    className: 'absolute rounded-full',
                    role: 'button',
                    'data-graph-slot': slotFor,
                    'aria-label': i18n.graphLink,
                    title: i18n.graphLink,
                    onPointerDown: event => startLink(event, slotFor),
                    style: {
                      left: `${b.x + b.w / 2 + GRAPH_MARGIN}px`,
                      top: `${b.y + b.h + GRAPH_MARGIN}px`,
                      width: `${size}px`,
                      height: `${size}px`,
                      transform: 'translate(-50%, -50%)',
                      background: 'var(--ui-accent)',
                      border: '2px solid var(--ui-bg-elevated)',
                      boxShadow: '0 0 0 1px var(--ui-accent)',
                      cursor: 'crosshair',
                      transition: 'width 120ms ease, height 120ms ease',
                      touchAction: 'none'
                    }
                  })
                })()
              : null,
            jsx('svg', {
              className: 'absolute inset-0 pointer-events-none',
              width: layout.width + GRAPH_MARGIN * 2,
              height: layout.height + GRAPH_MARGIN * 2,
              'aria-hidden': 'true',
              children: [
                jsx('defs', {
                  children: jsx('marker', {
                    id: 'kg-arrow', viewBox: '0 0 8 8', refX: '7', refY: '4',
                    markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse',
                    children: jsx('path', { d: 'M 0 0 L 8 4 L 0 8 z', fill: 'currentColor' })
                  })
                }),
                // The arrow being drawn: its base is the SLOT of the card it started from, and
                // its head follows the pointer. Releasing on a card makes that card the child.
                link
                  ? jsx('path', {
                      key: 'link-arrow',
                      d: (() => {
                        const b = boxes.get(link.from)
                        if (!b) return ''
                        const x1 = b.x + b.w / 2 + GRAPH_MARGIN
                        const y1 = b.y + b.h + GRAPH_MARGIN
                        const x2 = link.x
                        const y2 = link.y
                        return `M ${x1} ${y1} C ${x1} ${y1 + 46}, ${x2} ${y2 - 46}, ${x2} ${y2}`
                      })(),
                      fill: 'none',
                      stroke: 'var(--ui-accent)',
                      strokeWidth: link.target ? 2 : 1.6,
                      strokeDasharray: '6 4',
                      markerEnd: 'url(#kg-arrow)',
                      style: { color: 'var(--ui-accent)' }
                    })
                  : null,
                // The link the release would create, drawn from the source card to the card
                // the pointer is near: the gesture says what it is about to do before it does it.
                nearTarget && dragId && boxes.get(dragId) && boxes.get(nearTarget)
                  ? jsx('path', {
                      d: (() => {
                        const a = boxes.get(dragId), b = boxes.get(nearTarget)
                        const m = GRAPH_MARGIN
                        return `M ${a.x + a.w / 2 + m} ${a.y + a.h / 2 + m} C ${a.x + a.w / 2 + m} ${a.y + a.h + 30 + m}, ${b.x + b.w / 2 + m} ${b.y - 30 + m}, ${b.x + b.w / 2 + m} ${b.y + m}`
                      })(),
                      fill: 'none',
                      stroke: 'var(--ui-accent)',
                      strokeWidth: 1.6,
                      strokeDasharray: '4 3',
                      markerEnd: 'url(#kg-arrow)',
                      style: { color: 'var(--ui-accent)' }
                    })
                  : null,
                ...layout.edges.map(e => jsx('path', {
                  key: `${e.from}>${e.to}`,
                  d: edgePath({ ...e, x1: e.x1 + GRAPH_MARGIN, y1: e.y1 + GRAPH_MARGIN, x2: e.x2 + GRAPH_MARGIN, y2: e.y2 + GRAPH_MARGIN }),
                  fill: 'none',
                  stroke: edgeTone(e.from, e.to),
                  strokeWidth: 1.2,
                  markerEnd: 'url(#kg-arrow)',
                  style: { color: edgeTone(e.from, e.to) }
                }))
              ]
            }),
            ...shown.map(node => {
              const b = boxes.get(node.id)
              if (!b) return null
              const tone = statusTone(node.status)
              const failed = (node.runs || []).some(r => ['crashed', 'failed', 'spawn_failed', 'gave_up'].includes(r.outcome || r.status))
              const isSelected = node.id === selectedId
              const inLineage = lin ? (lin.up.has(node.id) || lin.down.has(node.id)) : false
              const faded = Boolean(lin) && !isSelected && !inLineage
              const prefix = splitTitlePrefix(node.title).prefix
              const drop = dropMap && node.id !== dragId ? dropMap.get(node.id) : null
              return jsxs('div', {
                key: node.id,
                className: cn(
                  'absolute flex flex-col rounded-md border bg-(--ui-bg-elevated) overflow-hidden select-none cursor-pointer',
                  isSelected ? 'border-(--ui-accent)' : 'border-(--ui-stroke-secondary)',
                  drop && drop.allowed ? 'ring-1 ring-(--ui-accent)' : '',
                  drop && !drop.allowed ? 'ring-1 ring-red-500/60' : '',
                  node.id === nearTarget ? 'ring-2 ring-(--ui-accent)' : '',
                  link && link.target === node.id ? 'ring-2 ring-(--ui-accent)' : ''
                ),
                'data-graph-node': node.id,
                style: {
                  left: `${b.x + GRAPH_MARGIN}px`,
                  top: `${b.y + GRAPH_MARGIN}px`,
                  width: `${b.w}px`,
                  height: `${b.h}px`,
                  opacity: faded ? 0.45 : 1,
                  borderColor: isSelected ? 'var(--ui-accent)' : undefined,
                  boxShadow: isSelected ? '0 0 0 1px var(--ui-accent)' : undefined,
                  // A left edge in the status tone: the stripe kanban-graph has, and the
                  // cheapest way to read a board of 60 nodes at a glance. 6 px, plus a 7 % wash
                  // of the same tone across the card: at 3 px the stripe read as a rendering
                  // artefact, and the wash is what makes the STATE legible before the words are.
                  borderLeft: `6px solid ${tone}`,
                  backgroundImage: `linear-gradient(color-mix(in srgb, ${tone} 7%, transparent), color-mix(in srgb, ${tone} 7%, transparent))`
                },
                // No card drag while the arrow is drawn: the slot gesture owns the pointer.
                draggable: Boolean(onDragStart) && !link,
                title: `${node.title} (${node.id})${node.assignee ? ` — ${node.assignee}` : ''}`,
                onClick: () => onOpen && onOpen(node.id),
                onDoubleClick: event => {
                  event.preventDefault()
                  if (onNewChild) onNewChild(node.id)
                },
                onDragStart: event => {
                  if (link) return
                  event.dataTransfer.setData('text/plain', node.id)
                  event.dataTransfer.effectAllowed = 'move'
                  // Snapshot the boxes ONCE: dragover fires continuously and reading a rect per
                  // node per event turns a gesture into a layout storm.
                  const rects = new Map()
                  const el = canvasRef.current
                  if (el) {
                    for (const n of el.querySelectorAll('[data-graph-node]')) {
                      rects.set(n.getAttribute('data-graph-node'), n.getBoundingClientRect())
                    }
                  }
                  dragRects.current = rects
                  if (onDragStart) onDragStart(node.id)
                },
                onDragEnd: () => {
                  setNearTarget(null)
                  dragRects.current = new Map()
                  if (onDragEnd) onDragEnd()
                },
                onDragOver: event => {
                  if (!onDropOn) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = drop && drop.allowed ? 'move' : 'none'
                },
                onDrop: event => {
                  if (!onDropOn) return
                  event.preventDefault()
                  event.stopPropagation()
                  onDropOn(node.id)
                },
                children: [
                  jsxs('div', {
                    className: 'flex items-start gap-1 px-1.5 pt-1 min-w-0',
                    children: [
                      jsx('span', {
                        className: 'shrink-0 inline-flex items-center justify-center mt-[1px]',
                        style: { color: tone },
                        title: node.status,
                        children: node.status === 'running'
                          ? jsxs('span', { className: 'relative inline-flex items-center justify-center', children: [
                              jsx('span', { className: 'kg-arc', style: { '--kanban-tone': tone } }),
                              jsx(Codicon, { name: statusIcon(node.status), size: '0.8rem' })
                            ] })
                          : jsx(Codicon, { name: statusIcon(node.status), size: '0.8rem' })
                      }),
                      jsxs('span', {
                        className: cn(
                          'min-w-0 flex-1 leading-tight text-(--ui-text-primary)',
                          tallCards ? 'text-[13px]' : 'text-[12.5px] truncate'
                        ),

                        // ONE style object, and weights inline: this is the only text in the
                        // card that matters, and a class the host bundle does not compile would
                        // leave it exactly as small as it was. Two `style` keys in the same
                        // literal would silently keep only the last — which is how the first
                        // attempt at bold ended up at 400.
                        style: {
                          fontWeight: 600,
                          ...(tallCards
                            ? {
                                whiteSpace: 'normal',
                                overflowWrap: 'anywhere',
                                display: '-webkit-box',
                                WebkitLineClamp: '3',
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden'
                              }
                            : {})
                        },
                        children: [
                          prefix ? jsx('span', {
                            className: 'mr-1 rounded-sm px-0.5 text-[8.5px] font-semibold text-(--ui-text-secondary)',
                            style: { backgroundColor: 'var(--ui-bg-tertiary)', border: '1px solid var(--ui-stroke-tertiary)' },
                            children: prefix
                          }) : null,
                          node.title || node.id
                        ]
                      }),
                      failed
                        ? jsx(Codicon, { name: 'warning', size: '0.75rem', className: 'shrink-0 text-[#f87171]', title: i18n.runs((node.runs || []).length) })
                        : node.status === 'blocked'
                          ? jsx(Codicon, { name: 'warning', size: '0.75rem', className: 'shrink-0', style: { color: statusTone('blocked') }, title: node.status })
                          : null
                    ]
                  }),
                  jsxs('div', {
                    className: 'mt-auto flex items-center gap-1 px-1.5 pb-0.5 text-[9px] text-(--ui-text-quaternary) min-w-0',
                    children: [
                      node.priority != null
                        ? jsx('span', { className: 'shrink-0 tabular-nums', children: `P${node.priority}` })
                        : null,
                      jsx('span', { className: 'flex-1' }),
                      node.attachmentCount
                        ? jsx(AttachmentMenu, {
                            taskId: node.id,
                            board: node.board || board,
                            count: node.attachmentCount,
                            i18n,
                            onPreview: (att, siblings) => $openAttachment.set(
                              attachmentPreviewState(node.id, node.board || board, att, siblings)
                            )
                          })
                        : null,
                      node.assignee
                        ? jsx('span', { className: 'shrink-0 inline-flex', title: node.assignee, children: jsx(ProfileAvatar, { name: node.assignee, size: '0.85rem' }) })
                        : jsx('span', { className: 'shrink-0 rounded-full border border-dashed border-(--ui-text-quaternary) opacity-60', style: { width: '0.7rem', height: '0.7rem' } })
                    ]
                  }),
                ]
              })
            })
          ]
        })
      }),
      // What the layout had to decide, said out loud instead of left to be noticed:
      // implied edges hidden by the reduction, loops the ranks had to band, links that
      // leave the view (a filtered-out parent), and what the scope is holding back.
      jsxs('div', {
        className: 'pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-3 px-2 py-1 text-[9.5px] text-(--ui-text-quaternary) bg-gradient-to-t from-(--ui-bg-elevated) to-transparent',
        children: [
          layout.implied ? jsx('span', { children: i18n.graphImplied(layout.implied) }) : null,
          layout.cyclic.length ? jsx('span', { className: 'text-[#f87171]', children: i18n.graphCyclic(layout.cyclic.length) }) : null,
          layout.dangling ? jsx('span', { children: i18n.graphDangling(layout.dangling) }) : null,
          hiddenByScope ? jsx('span', { children: i18n.graphHiddenByScope(hiddenByScope) }) : null,
          jsx('span', { className: 'ml-auto tabular-nums', children: `${shown.length}/${nodes.length}` }),
          // The camera, where the counts are: Fit is the one camera action a clipped first
          // view makes necessary, and it is kanban-graph's `0`.
          jsx('button', {
            type: 'button',
            onClick: event => { event.stopPropagation(); fitView() },
            title: autoFit ? i18n.graphFitOn : i18n.graphFit,
            'aria-label': i18n.graphFit,
            'aria-pressed': autoFit ? 'true' : 'false',
            className: cn(
              'pointer-events-auto inline-flex items-center gap-1 rounded px-1 py-0.5 text-[9.5px] cursor-pointer border-0',
              autoFit
                ? 'bg-(--ui-accent)/15 text-(--ui-accent) ring-1 ring-(--ui-accent)/40'
                : 'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) bg-transparent'
            ),
            children: [jsx(Codicon, { key: 'i', name: 'screen-full', size: '0.7rem' }), jsx('span', { key: 'l', children: i18n.graphFit })]
          })
        ]
      })
    ]
  })
}

/** The scopes of the graph, as a segmented control: All / Open / Running + lineage. */
function GraphScopeToggle({ value, onChange }) {
  const i18n = useGanttI18n()
  const item = (id, label) => jsx('button', {
    type: 'button',
    onClick: () => onChange(id),
    'aria-pressed': value === id,
    title: label,
    className: cn(
      'px-2 py-0.5 text-[11px] rounded cursor-pointer border-0 whitespace-nowrap',
      value === id ? 'bg-(--ui-accent)/15 text-(--ui-accent) font-medium' : 'bg-transparent text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover)'
    ),
    children: label
  }, id)
  return jsxs('span', {
    className: 'inline-flex items-center gap-0.5 rounded-md border border-(--ui-stroke-secondary) p-0.5',
    role: 'group',
    'aria-label': i18n.graphScopeAria,
    children: [
      // Same order as kanban-graph's MODES, so the control reads identically in both
      // plugins; the DEFAULT stays `all` (see SCOPES in graph-core).
      item('running-lineage', i18n.graphScopeRunning),
      item('open', i18n.graphScopeOpen),
      item('all', i18n.graphScopeAll)
    ]
  })
}

function SelectionBar({
  selected,
  onClear,
  onStatus,
  onAssign,
  onArchive,
  onDelete,
  assignees = [],
  busy = false
}) {
  const i18n = useGanttI18n()
  const [menu, setMenu] = useState(null) // 'move' | 'assign' | null
  const [customAssignee, setCustomAssignee] = useState('')

  if (selected.size === 0) return null

  return jsx('div', {
    className: 'pointer-events-none absolute inset-x-0 bottom-12 z-40 flex justify-center px-4 animate-in fade-in slide-in-from-bottom-2 duration-150',
    children: jsxs('div', {
      className: 'pointer-events-auto flex items-center gap-1.5 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) py-1.5 pr-1.5 pl-3.5 shadow-xl',
      children: [
        jsx('span', { className: 'mr-1 text-xs tabular-nums font-medium text-(--ui-text-secondary)', children: i18n.nSelected(selected.size) }),

        // Move to dropdown
        jsxs(DropdownMenu, {
          open: menu === 'move',
          onOpenChange: open => setMenu(open ? 'move' : null),
          children: [
            jsx(DropdownMenuTrigger, {
              asChild: true,
              children: jsxs(Button, {
                disabled: busy,
                size: 'xs',
                variant: 'ghost',
                className: 'gap-1 text-xs',
                children: [
                  jsx('span', { children: i18n.moveToShort }),
                  jsx(Codicon, { name: 'chevron-down', size: '0.7rem' })
                ]
              })
            }),
            jsx(DropdownMenuContent, {
              align: 'center',
              className: 'min-w-[9rem] p-1',
              children: STATUS_ORDER.map(s => {
                const meta = STATUS_META[s] || { tone: 'var(--ui-text-secondary)', label: s }
                const label = i18n.col?.[s] || meta.label
                return jsxs(DropdownMenuItem, {
                  key: s,
                  onClick: () => { setMenu(null); onStatus(s) },
                  className: 'flex items-center gap-2 cursor-pointer text-xs py-1.5',
                  children: [
                    jsx('span', { className: 'h-2 w-2 rounded-full shrink-0', style: { backgroundColor: meta.tone } }),
                    jsx('span', { className: 'flex-1', children: label })
                  ]
                })
              })
            })
          ]
        }),

        // Assign dropdown
        jsxs(DropdownMenu, {
          open: menu === 'assign',
          onOpenChange: open => setMenu(open ? 'assign' : null),
          children: [
            jsx(DropdownMenuTrigger, {
              asChild: true,
              children: jsxs(Button, {
                disabled: busy,
                size: 'xs',
                variant: 'ghost',
                className: 'gap-1 text-xs',
                children: [
                  jsx('span', { children: i18n.assignLabel.replace(':', '') }),
                  jsx(Codicon, { name: 'chevron-down', size: '0.7rem' })
                ]
              })
            }),
            jsxs(DropdownMenuContent, {
              align: 'center',
              className: 'min-w-[10rem] p-1',
              children: [
                assignees.map(name => jsx(DropdownMenuItem, {
                  key: name,
                  onClick: () => { setMenu(null); onAssign(name) },
                  className: 'flex items-center gap-2 cursor-pointer text-xs py-1.5',
                  children: [
                    jsx(ProfileAvatar, { name, size: '0.85rem' }),
                    jsx('span', { className: 'flex-1', children: name })
                  ]
                })),
                assignees.length > 0 ? jsx(DropdownMenuSeparator, {}) : null,
                jsx(DropdownMenuItem, {
                  onClick: () => { setMenu(null); onAssign('') },
                  className: 'text-xs py-1.5 cursor-pointer text-(--ui-text-tertiary)',
                  children: i18n.unassignAction
                })
              ]
            })
          ]
        }),

        // Archive button
        jsx(Button, {
          disabled: busy,
          onClick: onArchive,
          size: 'xs',
          variant: 'ghost',
          className: 'text-xs',
          children: i18n.actions.archive
        }),

        // Delete button
        jsx(Button, {
          disabled: busy,
          onClick: onDelete,
          size: 'xs',
          variant: 'ghost',
          className: 'text-destructive text-xs hover:bg-destructive/10',
          children: i18n.delete
        }),

        // Clear button (✕)
        jsx(Button, {
          'aria-label': i18n.clearSelection,
          onClick: onClear,
          size: 'icon-xs',
          variant: 'ghost',
          className: 'ml-1 text-(--ui-text-quaternary) hover:text-(--ui-text-primary)',
          children: jsx(Codicon, { name: 'close', size: '0.8rem' })
        })
      ]
    })
  })
}

function StatusBadge({ status, onPick, disabled }) {
  const i18n = useGanttI18n()
  const meta = STATUS_META[status] || STATUS_META.todo
  const label = i18n.col?.[status] || meta.label
  const isRunning = status === 'running'

  return jsxs(DropdownMenu, { children: [
    jsx(DropdownMenuTrigger, {
      asChild: true,
      disabled,
      children: jsx('button', {
      type: 'button',
      className: 'relative inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium cursor-pointer',
      style: { background: `color-mix(in srgb, ${meta.tone} 18%, transparent)`, color: 'inherit', border: `1px solid color-mix(in srgb, ${meta.tone} 45%, transparent)` },
      children: [
        isRunning ? jsx('div', { className: 'kg-arc', style: { '--kanban-tone': meta.tone } }) : null,
        jsx('span', { className: 'h-2 w-2 rounded-full', style: { backgroundColor: meta.tone } }),
        jsx('span', { children: label }),
        jsx('span', { className: 'text-[9px] opacity-60', children: '▾' })
      ]
      })
    }),
    jsxs(DropdownMenuContent, {
      align: 'start',
      className: 'min-w-[9rem] p-1',
      children: STATUS_ORDER.map(s => {
        const m = STATUS_META[s]
        const current = s === status
        const l = i18n.col?.[s] || m.label
        return jsx(DropdownMenuItem, {
          className: 'flex items-center gap-2 px-2.5 py-1 text-[11px]',
          onClick: () => { if (!current) onPick(s) },
          disabled: current,
          children: [
            jsx('span', { className: 'h-2 w-2 rounded-full shrink-0', style: { backgroundColor: m.tone } }),
            jsx('span', { className: 'flex-1', children: l }),
            current ? jsx('span', { className: 'opacity-60', children: '✓' }) : null
          ]
        }, s)
      })
    })
  ] })
}

/** One attachment's bytes, through the plugin REST door (JSON both ways). */
async function fetchAttachment(taskId, board, attachmentId) {
  return apiFetch(`/tasks/${encodeURIComponent(taskId)}/attachments/${attachmentId}/content`
    + `?board=${encodeURIComponent(board || '')}`)
}

/**
 * One attachment, shown the way its type deserves.
 *
 * Everything the webview renders itself is rebuilt into a Blob (the bytes arrive as text
 * or base64 through the plugin's own route — no path, no proxy), except markdown, which
 * keeps the app's own renderer. HTML goes into a sandboxed frame: it is user-supplied text
 * and must not run scripts.
 */
function AttachmentBody({ att, data, i18n }) {
  const kind = previewKind(att.filename, data?.content_type || att.content_type)
  const url = useMemo(() => {
    if (!data || kind === 'markdown' || kind === 'text') return null
    const bytes = data.encoding === 'base64'
      ? Uint8Array.from(atob(data.text || ''), c => c.charCodeAt(0))
      : new TextEncoder().encode(data.text || '')
    return URL.createObjectURL(new Blob([bytes], {
      type: attachmentMime(att.filename, data.content_type || att.content_type)
    }))
  }, [data, att.filename, att.content_type, kind])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  if (kind === 'markdown') return jsx(MessageTextContent, { media: false, text: data?.text || '' })
  if (kind === 'text') {
    return jsx('pre', {
      className: 'm-0 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed',
      children: data?.text || ''
    })
  }
  if (!url) return jsx('p', { className: 'text-[11px] text-(--ui-text-quaternary)', children: i18n.previewFailed })
  if (kind === 'image') {
    return jsx('img', {
      src: url,
      alt: att.filename,
      // Centred and fitted: a large screenshot should be readable whole, not cropped.
      className: 'mx-auto block max-h-full max-w-full rounded object-contain'
    })
  }
  if (kind === 'pdf') {
    return jsx('iframe', { src: url, title: att.filename, className: 'h-[75vh] w-full border-0 rounded' })
  }
  if (kind === 'html') {
    // `sandbox=""` = no scripts, no same-origin: a page from an attachment stays inert.
    return jsx('iframe', { src: url, title: att.filename, sandbox: '', className: 'h-[75vh] w-full border-0 rounded' })
  }
  return jsx('p', { className: 'text-[11px] text-(--ui-text-quaternary)', children: i18n.previewFailed })
}

/** The files of one task, read when a paperclip is opened — never with the board. */
async function fetchAttachments(taskId, board) {
  const payload = await apiFetch(
    `/tasks/${taskId}/attachments?board=${encodeURIComponent(board || '')}`
  )
  return (payload && payload.attachments) || []
}

/** Save an attachment to disk.
 *
 * The plugin bridge only speaks JSON, so the route hands back text when the file is
 * text-like and base64 otherwise — and the browser turns that back into a real Blob
 * here, which is also what names the file in the save dialog.
 */
async function downloadAttachment(taskId, board, att, i18n) {
  try {
    const data = await fetchAttachment(taskId, board, att.id)
    const bytes = data.encoding === 'base64'
      ? Uint8Array.from(atob(data.text || ''), c => c.charCodeAt(0))
      : new TextEncoder().encode(data.text || '')
    const url = URL.createObjectURL(new Blob([bytes], {
      type: data.content_type || 'application/octet-stream'
    }))
    const link = document.createElement('a')
    link.href = url
    link.download = data.filename || att.filename || 'attachment'
    document.body.appendChild(link)
    link.click()
    link.remove()
    // Revoking immediately cancels the download in Chromium: give it time to start.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch (error) {
    host.notify({ kind: 'error', message: `${i18n.previewFailed} — ${att.filename}` })
  }
}

/** How a priority reads: an upward arrow and the number in amber when it is set, a dash when it is
 *  not. The official plugin draws it exactly this way, and the amber is the tone the palette
 *  already gives "blocked" — a priority IS a warning-level fact about a task. */
function priorityDisplay(priority) {
  const value = Number(priority)
  if (!Number.isFinite(value) || value <= 0) {
    return jsx('span', { className: 'text-(--ui-text-quaternary)', children: '—' })
  }
  return jsxs('span', {
    className: 'inline-flex items-center gap-0.5 font-medium',
    style: { color: '#e0a13a' },
    children: [jsx(Codicon, { name: 'arrow-up', size: '0.65rem' }), String(value)]
  })
}

/** The icon a kind deserves: the same mark in the dialog title as in the list. */
function attachmentIconName(kind) {
  if (kind === 'markdown') return 'markdown'
  if (kind === 'image') return 'file-media'
  return 'file'
}

/** Where an attachment lives, captured the moment it is opened.
 *
 *  Both entry points — a row's paperclip and the detail view — build this the same way, so
 *  the dialog can always walk the task's other attachments. */
function attachmentPreviewState(taskId, board, att, siblings) {
  const list = siblings && siblings.length ? siblings : [att]
  return { taskId, board, att, siblings: list }
}

/** The two things one does with a file, offered identically everywhere: look at it when the
 *  webview can (`previewKind`), save it always. Rendered by the paperclip's menu and by the
 *  detail view, which is why it takes no layout of its own beyond the row it sits in. */
function AttachmentActions({ taskId, board, att, i18n, onPreview, iconSize }) {
  const size = iconSize || '0.7rem'
  return jsxs('div', { className: 'flex shrink-0 items-center gap-0.5', children: [
    previewKind(att.filename, att.content_type)
      ? jsx(Button, {
          size: 'icon-xs', variant: 'ghost',
          'aria-label': i18n.previewMarkdown(att.filename),
          title: i18n.previewMarkdown(att.filename),
          onClick: () => onPreview(att),
          children: jsx(Codicon, { name: 'eye', size })
        })
      : null,
    jsx(Button, {
      size: 'icon-xs', variant: 'ghost',
      'aria-label': i18n.downloadAttachment(att.filename),
      title: i18n.downloadAttachment(att.filename),
      onClick: () => void downloadAttachment(taskId, board, att, i18n),
      children: jsx(Codicon, { name: 'cloud-download', size })
    })
  ] })
}

/** One attachment line — the name, then its actions. One implementation for the paperclip's
 *  menu and for the detail view, so the two can never drift apart. */
function AttachmentLine({ taskId, board, att, i18n, onPreview, iconSize, hoverable }) {
  return jsxs('li', {
    className: cn(
      'flex min-w-0 items-center gap-1.5 text-[11px] text-(--ui-text-secondary)',
      hoverable && 'rounded px-2 py-1 hover:bg-(--chrome-action-hover)'
    ),
    children: [
      // The name IS the gesture: clicked, it opens the preview — when the webview can show the
      // type. Otherwise it stays plain text rather than pretending to be a link.
      previewKind(att.filename, att.content_type)
        ? jsx('button', {
            type: 'button',
            className: cn(
              'min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left cursor-pointer',
              'text-(--ui-text-secondary) hover:text-(--ui-text-primary) hover:underline'
            ),
            title: i18n.previewMarkdown(att.filename),
            'aria-label': i18n.previewMarkdown(att.filename),
            onClick: () => onPreview(att),
            children: att.filename
          })
        : jsx('button', {
            // Not previewable: the name is still a gesture, and the only useful one is the
            // download. The tooltip says so instead of promising a preview that cannot happen.
            type: 'button',
            className: cn(
              'min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left cursor-pointer',
              'text-(--ui-text-secondary) hover:text-(--ui-text-primary) hover:underline'
            ),
            title: i18n.downloadAttachment(att.filename),
            'aria-label': i18n.downloadAttachment(att.filename),
            onClick: () => void downloadAttachment(taskId, board, att, i18n),
            children: att.filename
          }),
      jsx(AttachmentActions, { taskId, board, att, i18n, onPreview, iconSize })
    ]
  }, att.id)
}

/**
 * The paperclip: a task with attachments carries one next to its name, and clicking it
 * lists the files with the two things one does with a file — look at it, or save it.
 *
 * The eye only appears when the webview can actually show the type (`previewKind`), so the
 * affordance never promises something it cannot do; everything else stays downloadable.
 */
function AttachmentMenu({ taskId, board, count, i18n, onPreview, className }) {
  // Hover is the intent signal: the list is fetched then (and on click, for keyboards and
  // touch), so a board's payload never carries a single file name.
  const [wanted, setWanted] = useState(false)
  const query = useQuery({
    queryKey: ['kanban-gantt', 'attachments', taskId, board],
    queryFn: () => fetchAttachments(taskId, board),
    enabled: wanted
  })
  // Only a task that has files carries the affordance, and the test is NUMERIC: the count arrives
  // as a number, but a "0" coming back as a string would be truthy and would show the icon on
  // every fileless row. `Number(count) > 0` is right in both cases, and it is the same predicate
  // the filter uses.
  if (!(Number(count) > 0)) return null
  const attachments = query.data || []
  const countLabel = i18n.attachments(count)
  // The icon alone. A count badge was tried on top of it and removed: it crowded the row for a
  // number the tooltip already spells out ("Attachments (2)"), and the menu lists the files.
  const triggerBody = jsx(Codicon, { name: 'attach', size: '0.8rem' })
  return jsxs(DropdownMenu, { children: [
    jsx(DropdownMenuTrigger, {
      asChild: true,
      children: jsx('button', {
        type: 'button',
        className: cn(
          'shrink-0 inline-flex items-center justify-center rounded p-0.5 border-0 bg-transparent cursor-pointer',
          'text-(--ui-text-tertiary) hover:text-(--ui-text-secondary) hover:bg-(--chrome-action-hover)',
          className
        ),
        title: countLabel,
        'aria-label': countLabel,
        // The name cell is a drag handle and opens the detail on click: the paperclip must
        // not do either.
        onClick: event => { event.stopPropagation(); setWanted(true) },
        onPointerDown: event => event.stopPropagation(),
        onPointerEnter: () => setWanted(true),
        children: triggerBody
      })
    }),
    jsxs(DropdownMenuContent, {
      align: 'end',
      className: 'min-w-[17rem] p-1 text-xs',
      children: [
        jsx('div', {
          className: 'px-2 py-1 text-[10px] uppercase font-semibold text-(--ui-text-tertiary)',
          children: countLabel
        }),
        // The list arrives on demand: say so rather than showing an empty menu.
        query.isLoading
          ? jsx('div', { className: 'grid h-10 place-items-center', children: jsx(Loader, {}) })
          : query.isError
            ? jsx('p', {
                className: 'px-2 py-1 text-[11px] text-(--ui-text-quaternary)',
                children: i18n.previewFailed
              })
            : jsx('ul', {
                className: 'flex flex-col gap-0.5',
                children: attachments.map(att =>
                  jsx(AttachmentLine, {
                    taskId, board, att, i18n, hoverable: true,
                    onPreview: item => onPreview(item, attachments)
                  })
                )
              })
      ]
    })
  ] })
}

/**
 * The markdown viewer: its own dialog, dismissed like every other overlay here.
 */
function AttachmentPreview({ taskId, board, att, siblings, i18n, onClose, onNavigate }) {
  const query = useQuery({
    queryKey: ['kanban-gantt', 'attachment', taskId, att.id],
    queryFn: () => fetchAttachment(taskId, board, att.id)
  })
  const list = siblings && siblings.length ? siblings : [att]
  const index = Math.max(0, list.findIndex(item => item.id === att.id))
  // Arrows walk the same list as the buttons: reading a task's files should not mean aiming
  // at a 1 rem target. Wrapping, so a two-file task toggles with one key.
  useEffect(() => {
    if (list.length < 2) return undefined
    const onKey = event => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
      const tag = (event.target && event.target.tagName) || ''
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (event.target && event.target.isContentEditable)) return
      event.preventDefault()
      const step = event.key === 'ArrowRight' ? 1 : -1
      onNavigate(list[(index + step + list.length) % list.length])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [list, index, onNavigate])
  // Room to read a document in: the same generous width as the detail modal, because a
  // markdown page in a 46 rem box is a keyhole.
  const kind = previewKind(att.filename, att.content_type)
  const titleIcon = attachmentIconName(kind)
  return jsx(Dialog, {
    open: true,
    onOpenChange: next => { if (!next) onClose() },
    children: jsxs(DialogContent, {
      // Room to read in: a wide document, a large image. The old box was a keyhole for both,
      // and a fixed height rather than a viewport one.
      className: 'flex h-[92vh] w-[min(92rem,96vw)] max-w-none flex-col overflow-hidden p-0',
      children: [
        // Header: the file's icon and name, and NOTHING else. Keeping the navigation out of
        // this row is what stops it from colliding with the dialog's own close button.
        jsxs('div', {
          className: 'flex shrink-0 items-center gap-2 border-b border-(--ui-stroke-tertiary) px-4 py-2.5 pr-12',
          children: [
            jsx(Codicon, { name: titleIcon, size: '0.85rem', className: 'shrink-0 text-(--ui-text-tertiary)' }),
            jsx(DialogTitle, {
              className: 'min-w-0 flex-1 truncate text-[12px] font-medium',
              children: i18n.previewTitle(att.filename)
            })
          ]
        }),
        jsx('div', { className: 'min-h-0 flex-1 overflow-auto px-4 py-3', children:
          query.isLoading
            ? jsx('div', { className: 'grid h-24 place-items-center', children: jsx(Loader, {}) })
            : query.isError || !query.data
              ? jsx('p', { className: 'text-[11px] text-(--ui-text-quaternary)', children: i18n.previewFailed })
              : jsx(AttachmentBody, { att, data: query.data, i18n })
        }),
        // The toolbar: navigation on the left, the file's own action on the right. A real bar
        // of its own — the arrows used to float over the header and crowd the close button.
        jsxs('div', {
          className: 'flex shrink-0 items-center gap-1 border-t border-(--ui-stroke-tertiary) px-3 py-1.5',
          children: [
            // Nothing at all when the task has a single file: no empty strip, no dead arrows.
            list.length > 1
              ? jsxs('div', { className: 'flex items-center gap-0.5', children: [
                  jsx(Button, {
                    size: 'icon-xs', variant: 'ghost',
                    'aria-label': i18n.previousAttachment,
                    title: i18n.previousAttachment,
                    disabled: index === 0,
                    onClick: () => onNavigate(list[(index - 1 + list.length) % list.length]),
                    children: jsx(Codicon, { name: 'chevron-left', size: '0.85rem' })
                  }),
                  jsx('span', {
                    className: 'px-1 text-[10px] tabular-nums text-(--ui-text-tertiary)',
                    children: i18n.attachmentPosition(index + 1, list.length)
                  }),
                  jsx(Button, {
                    size: 'icon-xs', variant: 'ghost',
                    'aria-label': i18n.nextAttachment,
                    title: i18n.nextAttachment,
                    disabled: index === list.length - 1,
                    onClick: () => onNavigate(list[(index + 1) % list.length]),
                    children: jsx(Codicon, { name: 'chevron-right', size: '0.85rem' })
                  })
                ] })
              : null,
            jsx('div', { className: 'ml-auto flex items-center gap-0.5', children:
              jsx(Button, {
                size: 'icon-xs', variant: 'ghost',
                'aria-label': i18n.downloadAttachment(att.filename),
                title: i18n.downloadAttachment(att.filename),
                onClick: () => void downloadAttachment(taskId, board, att, i18n),
                children: jsx(Codicon, { name: 'cloud-download', size: '0.8rem' })
              })
            })
          ]
        })
      ]
    })
  })
}

/** The task's attachments: preview the markdown ones, download any of them. */
function AttachmentsSection({ taskId, board, attachments, i18n, onPreview }) {
  if (!attachments || !attachments.length) return null
  return jsxs('div', { className: 'flex flex-col gap-1', children: [
    jsx('div', {
      className: 'text-[10px] uppercase font-semibold text-(--ui-text-tertiary)',
      children: i18n.attachments(attachments.length)
    }),
    jsx('ul', { className: 'flex flex-col gap-0.5', children: attachments.map(att =>
      jsx(AttachmentLine, {
        taskId, board, att, i18n, onPreview, iconSize: '0.75rem'
      })
    ) }, 'attachments')
  ] })
}

function TaskDrawer({ taskId, board, onClose, assignees = [], tasks = [], docked = false, onToggleDock, boards = [] }) {
  const drawerW = useValue($drawerW)
  const detailModal = useValue($detailModal)
  const i18n = useGanttI18n()
  const queryClient = useQueryClient()
  const scrollContainerRef = useRef(null)
  const prevTaskIdRef = useRef(null)

  // Cross-board move: the dialog owns the confirmations; the mutation runs
  // here so the success toast + invalidation live next to the other writes.
  const [moveBoardOpen, setMoveBoardOpen] = useState(false)
  // The attachment being previewed, if any: its dialog is its own overlay.
  const [previewAtt, setPreviewAtt] = useState(null)
  const shownBoard = board
  const moveMutation = useMutation({
    mutationFn: toBoard =>
      apiFetch(`/tasks/${encodeURIComponent(shownId)}/move?board=${encodeURIComponent(board || '')}`, {
        method: 'POST',
        body: { to_board: toBoard }
      }),
    onSuccess: result => {
      setMoveBoardOpen(false)
      toast('success', i18n.movedTo(result?.to || result?.count || ''))
      void queryClient.invalidateQueries({ queryKey: ['kanban-gantt'] })
      onClose()
    }
  })

  // A description draft belongs to the task it was seeded from. The drawer does
  // not remount when the page opens ANOTHER task, so an unsaved draft used to
  // stay in the editor while the rest of the drawer swapped underneath it: the
  // pencil sat open over someone else's body. `descOwner` pins the drawer to the
  // task the draft belongs to (see `shownId`), and the dialog below owns the
  // three ways out of a switch requested while that draft is unsaved.
  const [descOwner, setDescOwner] = useState(null)
  const [descDraft, setDescDraft] = useState('')
  const shownId = descOwner || taskId
  // Set once the draft has been written, so the dialog's own close beat (which
  // calls onClose after a successful confirm) cannot be mistaken for a dismissal
  // and undo the switch the user just approved.
  const switchResolvedRef = useRef(false)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['kanban-gantt', 'task', apiBase(), board, shownId],
    queryFn: () => fetchTask(shownId, board),
    enabled: Boolean(shownId)
  })

  // Reset scroll to top when opening a DIFFERENT task
  useEffect(() => {
    if (shownId && prevTaskIdRef.current !== shownId) {
      prevTaskIdRef.current = shownId
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0
      }
    }
  }, [shownId])

  const [comment, setComment] = useState('')
  const [showAllComments, setShowAllComments] = useState(false)
  // Which panel of the detail's feed is open. Comments first, because a task with none is exactly
  // where the first one gets written; the strip drops Activity and Runs when a task has neither, so
  // a tab never opens on an empty panel.
  const [feedTab, setFeedTab] = useState('comments')
  // The CLI block's copy button confirms itself for a moment, then goes quiet.
  const [cliCopied, setCliCopied] = useState(false)
  // Parent link awaiting confirmation (the click that asked to remove it).
  const [pendingUnlink, setPendingUnlink] = useState(null)

  // Parents/children come from the WHOLE board snapshot, not the filtered rows,
  // so a relation hidden by the current filter still shows up here.
  const relations = useMemo(() => relationsOf(tasks, shownId), [tasks, shownId])

  const statusMutation = useMutation({
    mutationFn: payload => apiFetch(
      `/tasks/${encodeURIComponent(shownId)}/status${board ? `?board=${encodeURIComponent(board)}` : ''}`,
      { method: 'PATCH', body: payload }),
    onSuccess: () => {
      void refetch()
      void queryClient.invalidateQueries({ queryKey: ['kanban-gantt', 'gantt'] })
    },
    onError: error => toast('error', String(error?.message || error))
  })
  const commentMutation = useMutation({
    mutationFn: body => apiFetch(
      `/tasks/${encodeURIComponent(shownId)}/comments${board ? `?board=${encodeURIComponent(board)}` : ''}`,
      { method: 'POST', body }),
    onSuccess: () => { void refetch() },
    onError: error => toast('error', String(error?.message || error))
  })
  const assignMutation = useMutation({
    mutationFn: profile => apiFetch(
      `/tasks/${encodeURIComponent(shownId)}/assignee${board ? `?board=${encodeURIComponent(board)}` : ''}`,
      { method: 'PATCH', body: { profile } }),
    onSuccess: () => {
      void refetch()
      void queryClient.invalidateQueries({ queryKey: ['kanban-gantt', 'gantt'] })
    },
    onError: error => toast('error', String(error?.message || error))
  })

  // The description write: same shape as the reference kanban drawer's
  // DescriptionSection (raw markdown in a textarea, saved explicitly). The
  // refetch + gantt invalidation keep the drawer and the timeline in step; the
  // backend also emits `edited`, which our own push carries to other clients.
  const descriptionMutation = useMutation({
    mutationFn: body => apiFetch(
      `/tasks/${encodeURIComponent(shownId)}/description${board ? `?board=${encodeURIComponent(board)}` : ''}`,
      { method: 'PATCH', body: { body } }),
    onSuccess: () => {
      void refetch()
      void queryClient.invalidateQueries({ queryKey: ['kanban-gantt', 'gantt'] })
      setDescOwner(null)
    },
    onError: error => toast('error', String(error?.message || error))
  })

  // The draft is unsaved when it differs from what the backend holds for the task
  // it belongs to — `data` IS that task's detail, because `shownId` pins it.
  const descDirty = Boolean(descOwner) && descDraft !== (data?.task?.body || '')
  // A switch the page asked for while that draft is unsaved: the dialog decides
  // (save then open, discard, or cancel the switch and keep editing).
  const descSwitchPending = Boolean(descOwner) && descOwner !== taskId && descDirty

  // Nothing typed (or already written): a requested switch just closes the editor
  // and lets the drawer follow the page, no question asked.
  useEffect(() => {
    if (!descOwner || descOwner === taskId || descDirty) return
    setDescOwner(null)
    setDescDraft('')
  }, [taskId, descOwner, descDirty])
  // Dropping one parent link. The domain also re-evaluates the task's gate, so
  // a task freed by the removal can come back to `ready` — hence the refetch.
  const unlinkMutation = useMutation({
    mutationFn: parentId => removeParent(shownId, parentId, board),
    onSuccess: () => {
      void refetch()
      void queryClient.invalidateQueries({ queryKey: ['kanban-gantt'] })
    },
    onError: error => toast('error', String(error?.message || error))
  })

  const st = data?.task?.status || 'todo'
  const matrix = ACTION_MATRIX[st] || { primary: [], more: [] }
  const more = matrix.more || []
  const actionLabel = a => i18n.actions?.[a] || a

  // The title is shown verbatim; its `[PREFIX]` becomes a tag only on request — the
  // same rule the rows follow.
  const drawerTitle = splitTitlePrefix(data?.task?.title)
  const drawerName = drawerTitle.rest || titleText(data?.task?.title) || i18n.untitled
  const showPrefixTags = useValue($titlePrefixTags)

  // The same task, for a reader who would rather stay in a shell. Built from the task's
  // OWN board: the selected board is not necessarily the one this task lives on (the
  // all-boards view), and a command that opens the wrong board is worse than none.
  const cliBoard = data?.task?.board || board || ''
  const cliCommand = cliBoard
    ? `hermes kanban --board ${cliBoard} show ${shownId}`
    : `hermes kanban show ${shownId}`

  const inner = [
    jsx(ResizeHandle, {
        get: () => $drawerW.get(),
        set: w => $drawerW.set(w),
        min: DRAWER_W_MIN,
        max: DRAWER_W_MAX,
        resetTo: 416,
        storageKey: 'drawerW',
        growDirection: 'left'
      }),
      // Pinned top section: header, actions and title with bottom separator
      jsxs('div', {
        className: 'flex flex-col gap-2 pb-3 border-b border-(--ui-stroke-tertiary) shrink-0',
        children: [
          // Top row: status, assignee, task id, [...] menu, close
          jsxs('div', {
            className: 'flex items-center justify-between gap-1.5',
            children: [
              jsxs('div', { className: 'flex flex-wrap items-center gap-1.5 min-w-0', children: [
                // Docking the panel beside the gantt only means something for the
                // panel: in the modal there is nothing to dock or undock.
                detailModal
                  ? null
                  : jsx(Button, { size: 'icon-xs', variant: 'ghost', onClick: onToggleDock, 'aria-label': docked ? i18n.undockDrawer : i18n.dockDrawer, title: docked ? i18n.undockDrawer : i18n.dockDrawer, children: docked ? '»' : '«' }),
                StatusBadge({
                  status: data?.task?.status,
                  disabled: statusMutation.isPending,
                  onPick: next => {
                    const action =
                      next === 'done' ? 'done'
                      : next === 'blocked' ? 'blocked'
                      : next === 'ready' ? 'ready'
                      : next === 'todo' ? 'todo'
                      : next === 'review' ? 'review'
                      : next === 'triage' ? 'triage'
                      : null
                    if (action) statusMutation.mutate({ action })
                  }
                }),
                jsx(AssigneeBadge, {
                  assignee: data?.task?.assignee,
                  assignees,
                  disabled: assignMutation.isPending,
                  onAssign: profile => assignMutation.mutate(profile)
                }),
                jsx('span', {
                  className: 'text-[11px] font-mono text-(--ui-text-quaternary) hover:text-(--ui-text-secondary) cursor-help select-all',
                  title: i18n.copyHint(shownId),
                  children: shortId(shownId)
                })
              ] }),
              jsxs('div', { className: 'flex items-center gap-1 shrink-0', children: [
                jsxs(DropdownMenu, { children: [
                  jsx(DropdownMenuTrigger, {
                    asChild: true,
                    children: jsx('button', {
                      type: 'button',
                      className: 'inline-flex items-center justify-center rounded-md p-1 hover:bg-(--chrome-action-hover) cursor-pointer text-(--ui-text-secondary) border-0 bg-transparent',
                      'aria-label': i18n.actionsMenu,
                      children: jsx(Codicon, { name: 'ellipsis', size: '0.9rem' })
                    })
                  }),
                  jsxs(DropdownMenuContent, {
                    align: 'end',
                    className: 'min-w-[11rem] p-1 text-xs',
                    children: [
                      jsx(DropdownMenuItem, {
                        className: 'flex items-center gap-2 px-3 py-1.5',
                        onClick: () => void navigator.clipboard.writeText(shownId),
                        children: i18n.copyTaskId
                      }),
                      jsx(DropdownMenuItem, {
                        className: 'flex items-center gap-2 px-3 py-1.5',
                        onClick: () => { if (data?.task?.title) void navigator.clipboard.writeText(data.task.title) },
                        children: i18n.copyTitle
                      }),
                      jsx(DropdownMenuSeparator, {}),
                      // Creation verb reachable from a task: the new task starts
                      // as a child of this one.
                      jsx(DropdownMenuItem, {
                        className: 'flex items-center gap-2 px-3 py-1.5',
                        onClick: () => $newTask.set({ parentId: shownId }),
                        children: jsxs('span', { className: 'flex items-center gap-2', children: [
                          jsx(Codicon, { name: 'add', size: '0.85rem' }),
                          i18n.createSubtask
                        ] })
                      }),
                      // Keyboard-reachable twin of the drag & drop: opens the
                      // page's task picker for this task.
                      jsx(DropdownMenuItem, {
                        className: 'flex items-center gap-2 px-3 py-1.5',
                        onClick: () => $moveUnderId.set(shownId),
                        children: jsxs('span', { className: 'flex items-center gap-2', children: [
                          jsx(Codicon, { name: 'move', size: '0.85rem' }),
                          i18n.moveUnder
                        ] })
                      }),
                      // Cross-board move: opens the board-picker dialog (with
                      // its own confirmation chain). Requires another board.
                      jsx(DropdownMenuItem, {
                        className: 'flex items-center gap-2 px-3 py-1.5',
                        onClick: () => {
                          const others = boards.filter(b => b.slug !== shownBoard)
                          if (others.length === 0) {
                            toast('warning', i18n.moveNoOtherBoards)
                            return
                          }
                          setMoveBoardOpen(true)
                        },
                        children: jsxs('span', { className: 'flex items-center gap-2', children: [
                          jsx(Codicon, { name: 'arrow-circle-right', size: '0.85rem' }),
                          i18n.moveToBoard
                        ] })
                      }),
                      more.length ? jsx(DropdownMenuSeparator, {}) : null,
                      more.map(a => jsx(DropdownMenuItem, {
                        key: a,
                        className: 'flex items-center gap-2 px-3 py-1.5',
                        onClick: () => statusMutation.mutate({ action: a }),
                        children: actionLabel(a)
                      })),
                      jsx(DropdownMenuSeparator, {}),
                      jsx(DropdownMenuItem, {
                        className: 'flex items-center gap-2 px-3 py-1.5 text-red-500 hover:bg-red-500/10',
                        onClick: () => {
                          if (confirm(i18n.confirmDelete(shownId))) {
                            statusMutation.mutate({ action: 'delete' })
                            onClose()
                          }
                        },
                        children: i18n.delete
                      })
                    ]
                  })
                ] }),
                // Same detail, two presentations: the panel beside the gantt or a
                // centred modal. The switch sits next to the close button — where a
                // window-level control belongs — and its icon shows which way it goes.
                jsx(Button, {
                  size: 'icon-xs', variant: 'ghost',
                  onClick: () => $detailModal.set(!detailModal),
                  'aria-label': detailModal ? i18n.dockDetail : i18n.openInModal,
                  title: detailModal ? i18n.dockDetail : i18n.openInModal,
                  children: jsx(Codicon, { name: detailModal ? 'screen-normal' : 'screen-full', size: '0.75rem' })
                }),
                jsx(Button, { size: 'icon-xs', variant: 'ghost', onClick: onClose, 'aria-label': i18n.close, children: '✕' })
              ] })
            ]
          }),

          // Primary actions bar placed ABOVE the title
          (matrix.primary || []).length
            ? jsxs('div', { className: 'flex flex-wrap items-center gap-1.5 py-0.5', children: [
                jsx('span', { className: 'text-[10px] uppercase font-semibold text-(--ui-text-tertiary) mr-1', children: i18n.action }),
                (matrix.primary || []).map(a => jsx(Button, {
                  key: a,
                  size: 'xs',
                  disabled: statusMutation.isPending,
                  onClick: () => statusMutation.mutate({ action: a }),
                  children: actionLabel(a)
                }))
              ] })
            : null,

          // Title kept always visible — verbatim, with the prefix as a tag only when
          // the reader asked for tags.
          jsxs('div', {
            className: 'flex flex-wrap items-start gap-1.5 text-base font-semibold leading-snug',
            children: [
              showPrefixTags && drawerTitle.prefix
                ? jsx('span', {
                    className: 'shrink-0 rounded-sm font-semibold',
                    style: {
                      padding: '0 4px', fontSize: '10px', lineHeight: '1.5',
                      color: 'var(--ui-text-secondary)',
                      backgroundColor: 'var(--ui-bg-tertiary)',
                      border: '1px solid var(--ui-stroke-tertiary)'
                    },
                    children: drawerTitle.prefix
                  })
                : null,
              jsx('span', { className: 'min-w-0', children: drawerName })
            ]
          })
        ]
      }),


      // Scrollable content underneath the pinned header + title
      isLoading
        ? jsx('div', { className: 'py-8 flex justify-center', children: jsx(Loader, {}) })
        : isError
          ? jsx(ErrorState, { title: i18n.taskUnreadable, description: i18n.taskUnreadableDesc })
          : jsxs('div', { ref: scrollContainerRef, className: 'flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pt-1', children: [
              // 0. Relations — parents (removable, behind a confirmation) and
              //    children (read-only for now: removing that link means
              //    re-parenting the child itself). Clicking a name opens that
              //    task's detail, which also selects its row in the gantt.
              //    In the modal both belong to the right-hand column, like the priority and the
              //    attachments, so this block yields to it rather than repeating them.
              // Parents only when there are some, like the children below: an empty relation block
              // is noise in every mode.
              detailModal || relations.parents.length === 0 ? null : jsx(TaskRelations, {
                heading: i18n.parents,
                tasks: relations.parents,
                onOpen: id => $openTaskId.set(id),
                onRemove: id => {
                  const parent = relations.parents.find(t => t.id === id)
                  setPendingUnlink({ id, title: parent ? parent.title : id })
                },
                removeLabel: i18n.removeParentLink,
                openLabel: i18n.openTask,
                disabled: unlinkMutation.isPending
              }),
              // Children only when there are some: "no children" on every leaf task is noise, and
              // most tasks are leaves. Parents keep their empty state, which is informative.
              detailModal || relations.children.length === 0 ? null : jsx(TaskRelations, {
                heading: i18n.children,
                tasks: relations.children,
                onOpen: id => $openTaskId.set(id),
                openLabel: i18n.openTask
              }),
              // 1. Description (no max-h clamp). Always rendered, so a task that has
              // no description yet can be given one; the pencil at the right of the
              // label mirrors the reference kanban drawer's DescriptionSection, and
              // the editor shows the raw markdown with an explicit Save.
              jsxs('div', { className: 'flex flex-col gap-1', children: [
                jsxs('div', { className: 'flex items-center justify-between gap-2', children: [
                  jsx('div', { className: 'text-[10px] uppercase font-semibold text-(--ui-text-tertiary)', children: i18n.description }),
                  jsx(Button, {
                    variant: 'ghost',
                    size: 'icon-xs',
                    'aria-label': descOwner ? i18n.cancelEdit : i18n.editDescription,
                    title: descOwner ? i18n.cancelEdit : i18n.editDescription,
                    onClick: () => {
                      if (descOwner) {
                        setDescOwner(null)                  // leave without writing
                        setDescDraft('')
                      } else {
                        setDescOwner(shownId)               // the draft belongs to this task
                        setDescDraft(data?.task?.body || '')
                      }
                    },
                    children: jsx(Codicon, { name: descOwner ? 'close' : 'edit', size: '0.75rem' })
                  })
                ] }),
                descOwner
                  ? jsxs('div', { className: 'flex flex-col gap-1.5', children: [
                      jsx(Textarea, {
                        className: 'min-h-24 text-[11px]',
                        value: descDraft,
                        disabled: descriptionMutation.isPending,
                        onChange: event => setDescDraft(event.target.value)
                      }),
                      jsx(Button, {
                        className: 'self-end',
                        size: 'xs',
                        variant: 'secondary',
                        disabled: descriptionMutation.isPending,
                        onClick: () => descriptionMutation.mutate(descDraft),
                        children: i18n.save
                      })
                    ] })
                  : data?.task?.body
                    ? jsx('div', {
                        className: 'border border-(--ui-stroke-tertiary) rounded p-2 bg-(--ui-bg-subtle, transparent)',
                        children: jsx(MessageTextContent, { media: false, text: data.task.body })
                      })
                    : jsx('p', { className: 'text-[11px] text-(--ui-text-quaternary)', children: i18n.noDescription })
              ] }),

              // 1b. Attachments and the priority line, for the DOCKED detail and its panel: in the
              // modal both belong to the right-hand column instead, so this block yields to it
              // rather than duplicating them in the body.
              detailModal ? null : jsx(AttachmentsSection, {
                taskId: shownId, board, i18n,
                attachments: data?.task?.attachments || [],
                onPreview: att => setPreviewAtt(att)
              }),
              detailModal ? null : jsxs('div', {
                className: 'flex flex-col gap-0.5',
                children: [
                  jsx('div', {
                    className: 'text-[10px] uppercase font-semibold text-(--ui-text-tertiary)',
                    children: i18n.metaPriority
                  }),
                  priorityDisplay(data?.task?.priority)
                ]
              }),
              previewAtt
                ? jsx(AttachmentPreview, {
                    taskId: shownId, board, i18n, att: previewAtt,
                    // Same task, same list: the arrows walk the task's other attachments.
                    siblings: data?.task?.attachments || [previewAtt],
                    onNavigate: att => setPreviewAtt(att),
                    onClose: () => setPreviewAtt(null)
                  })
                : null,

              // 2. Result (no max-h clamp)
              data?.task?.result
                ? jsxs('div', { className: 'flex flex-col gap-1', children: [
                    jsx('div', { className: 'text-[10px] uppercase font-semibold text-(--ui-text-tertiary)', children: i18n.result }),
                    jsx('div', {
                      className: 'border border-(--ui-stroke-tertiary) rounded p-2 bg-(--ui-bg-subtle, transparent)',
                      children: jsx(MessageTextContent, { media: false, text: data.task.result })
                    })
                  ] })
                : null,

              // 3. Latest summary (highlighted when blocked or done/completed)
              data?.task?.latest_summary
                ? jsxs('div', { className: 'flex flex-col gap-1', children: [
                    jsx('div', { className: 'text-[10px] uppercase font-semibold text-(--ui-text-tertiary)', children: i18n.latestSummary }),
                    jsx('div', {
                      className: cn(
                        'rounded p-2.5 transition-colors',
                        data?.task?.status === 'blocked'
                          ? 'border border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
                          : data?.task?.status === 'done' || data?.task?.status === 'archived'
                            ? 'border border-emerald-500/35 bg-emerald-500/10'
                            : 'border border-(--ui-stroke-tertiary) bg-(--ui-bg-subtle, transparent)'
                      ),
                      children: jsx(MessageTextContent, { media: false, text: data.task.latest_summary })
                    })
                  ] })
                : null,

              // 4. Les exécutions ont leur propre onglet dans le flux (plus bas) : le bloc repliable
              //    qui vivait ici faisait doublon avec lui.

              // 5. Commentaires (Collapsible section, open by default, 3 latest by default with button to show previous, no internal scrollbar)
              (() => {
                const commentsList = data?.task?.comments || []
                const totalComments = commentsList.length
                const visibleComments = showAllComments ? commentsList : commentsList.slice(-3)
                const hiddenCount = totalComments - visibleComments.length
                const eventsList = data?.task?.events || []
                const runsList = data?.task?.runs || []
                // A task that loses its last event — or the strip rebuilding after a refresh —
                // must not leave the reader on a tab that is no longer offered.
                const activeTab = feedTab === 'activity' && eventsList.length === 0 ? 'comments'
                  : feedTab === 'runs' && runsList.length === 0 ? 'comments'
                  : feedTab

                return jsxs('div', { className: 'border-t border-(--ui-stroke-tertiary) pt-2 flex flex-col gap-1.5', children: [
                  // The feed strip: same segmented idiom as the view toggle, and each label carries
                  // its count, so the reader knows there is something to see before clicking.
                  jsxs('span', {
                    role: 'group',
                    className: 'inline-flex items-center gap-0.5 rounded-md border border-(--ui-stroke-secondary) p-0.5 self-start',
                    children: [
                      jsx(FeedTab, { label: i18n.tabComments, count: totalComments, ariaLabel: i18n.comments(totalComments), active: activeTab === 'comments', onClick: () => setFeedTab('comments') }),
                      eventsList.length
                        ? jsx(FeedTab, { label: i18n.tabActivity, count: eventsList.length, ariaLabel: i18n.activity(eventsList.length), active: activeTab === 'activity', onClick: () => setFeedTab('activity') })
                        : null,
                      runsList.length
                        ? jsx(FeedTab, { label: i18n.tabRuns, count: runsList.length, ariaLabel: i18n.runs(runsList.length), active: activeTab === 'runs', onClick: () => setFeedTab('runs') })
                        : null
                    ]
                  }),
                  activeTab === 'comments' ? jsxs('div', { className: 'flex flex-col gap-1.5 pt-1', children: [
                    hiddenCount > 0 ? jsx('button', {
                      type: 'button',
                      className: 'text-[10.5px] text-(--ui-accent) hover:underline cursor-pointer border-0 bg-transparent text-left py-0.5 select-none',
                      onClick: () => setShowAllComments(true),
                      children: `↑ ${i18n.showPreviousComments(hiddenCount)}`
                    }) : null,
                    visibleComments.map((c, i) => {
                      const dateStr = c.created_at
                        ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(c.created_at * 1000))
                        : ''
                      return jsxs('div', {
                        key: c.id || i,
                        className: 'text-[11px] border border-(--ui-stroke-tertiary)/60 rounded p-1.5 bg-(--ui-bg-subtle, transparent)',
                        children: [
                          jsxs('div', { className: 'flex items-center gap-1.5 text-[10px] text-(--ui-text-tertiary) mb-0.5', children: [
                            jsx('span', { className: 'font-medium text-(--ui-text-secondary)', children: c.author || '?' }),
                            dateStr ? jsx('span', { className: 'ml-auto text-(--ui-text-quaternary)', children: dateStr }) : null
                          ] }),
                          jsx('div', { className: 'min-w-0', children: jsx(MessageTextContent, { media: false, text: c.body || '' }) })
                        ]
                      })
                    }),
                    jsxs('div', { className: 'flex gap-1.5 mt-1', children: [
                      jsx('input', {
                        type: 'text',
                        value: comment,
                        placeholder: i18n.addCommentPlaceholder,
                        className: 'flex-1 bg-transparent border border-(--ui-stroke-tertiary) rounded px-1.5 py-0.5 text-[11px]',
                        onInput: event => setComment(event.target.value),
                        onKeyDown: event => {
                          if (event.key === 'Enter' && comment.trim()) {
                            commentMutation.mutate({ body: comment.trim() })
                            setComment('')
                          }
                        }
                      }),
                      jsx(Button, {
                        size: 'xs',
                        disabled: !comment.trim() || commentMutation.isPending,
                        onClick: () => { commentMutation.mutate({ body: comment.trim() }); setComment('') },
                        children: i18n.send
                      })
                    ] })
                  ] }) : null,
                  // Les deux autres panneaux du flux : les événements et les runs que la route de
                  // détail renvoie déjà. Chacun n'est monté que si son onglet est actif, et l'onglet
                  // n'est offert que s'il y a de quoi lire.
                  activeTab === 'activity'
                    ? jsx('div', { className: 'flex flex-col gap-0.5 max-h-40 overflow-auto', children: eventsList.slice(-12).reverse().map((e, i) => {
                        const when = e.created_at
                          ? new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(e.created_at * 1000))
                          : ''
                        return jsxs('div', { key: e.id || i, className: 'flex items-baseline gap-1.5 text-[10px] text-(--ui-text-tertiary)', children: [
                          jsx('span', { className: 'text-(--ui-text-secondary)', children: String(e.kind || 'event') }),
                          e.actor ? jsx('span', { children: e.actor }) : null,
                          when ? jsx('span', { className: 'ml-auto text-(--ui-text-quaternary)', children: when }) : null
                        ] })
                      }) })
                    : null,
                  activeTab === 'runs'
                    ? jsx('div', { className: 'flex flex-col gap-2', children: runsList.map((r, i) => {
                        const failed = ['crashed', 'failed', 'timed_out', 'gave_up'].includes(r.outcome || r.status)
                        const isDiffProfile = r.profile && data?.task?.assignee && r.profile !== data.task.assignee
                        const durationStr = (() => {
                          if (!r.started_at) return ''
                          const end = r.ended_at || Math.floor(Date.now() / 1000)
                          const sec = Math.max(0, end - r.started_at)
                          if (sec < 60) return `${sec}s`
                          if (sec < 3600) return `${Math.floor(sec / 60)}m`
                          const h = Math.floor(sec / 3600)
                          const m = Math.floor((sec % 3600) / 60)
                          return m > 0 ? `${h}h ${m}m` : `${h}h`
                        })()
                        const dateStr = r.started_at
                          ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(r.started_at * 1000))
                          : ''

                        return jsxs('div', {
                          key: r.id || i,
                          className: 'flex flex-col gap-1 text-[11px] border border-(--ui-stroke-tertiary) rounded p-2 bg-(--ui-bg-subtle, transparent)',
                          children: [
                            jsxs('div', { className: 'flex flex-wrap items-center gap-1.5 text-[10px]', children: [
                              jsx(Badge, { size: 'xs', variant: failed ? 'destructive' : r.ended_at ? 'muted' : 'secondary', children: r.outcome || r.status || 'run' }),
                              r.profile ? jsxs('span', { className: cn('font-medium', isDiffProfile ? 'text-amber-500 font-semibold' : 'text-(--ui-text-secondary)'), children: [
                                '👤 ', r.profile, isDiffProfile ? jsx('span', { className: 'text-[9px] text-(--ui-text-quaternary) ml-1', children: i18n.reassigned }) : null
                              ] }) : null,
                              durationStr ? jsx('span', { className: 'text-(--ui-text-tertiary)', children: `⏱ ${durationStr}` }) : null,
                              dateStr ? jsx('span', { className: 'text-(--ui-text-quaternary) ml-auto text-[9.5px]', children: dateStr }) : null
                            ] }),
                            r.summary
                              ? jsx('div', { className: 'mt-1 pt-1 border-t border-(--ui-stroke-tertiary)/50', children: jsx(MessageTextContent, { media: false, text: r.summary }) })
                              : null
                          ]
                        })
                      }) })
                    : null
                ] })
              })(),
            ] }),
      // Drops a parent link — behind a confirmation, so a stray click on the
      // row's ✕ never silently rewires the tree.
      jsx(ConfirmDialog, {
        open: Boolean(pendingUnlink),
        onClose: () => setPendingUnlink(null),
        onConfirm: () => unlinkMutation.mutateAsync(pendingUnlink.id),
        title: i18n.removeParentConfirmTitle(pendingUnlink ? pendingUnlink.title : ''),
        description: i18n.removeParentConfirmDesc,
        confirmLabel: i18n.removeParentLink(pendingUnlink ? pendingUnlink.title : ''),
        cancelLabel: i18n.cancel,
        destructive: true
      }),
      // The description draft guard: the page asked for another task while the
      // draft was unsaved. Three ways out — write it and open the task, drop it
      // and open it, or cancel the switch and stay here with the editor as it is.
      jsx(ConfirmDialog, {
        open: descSwitchPending,
        onClose: () => {
          const resolved = switchResolvedRef.current
          switchResolvedRef.current = false
          // Dismissed (Esc, backdrop, Cancel): go back to the task being edited.
          if (!resolved && descOwner) $openTaskId.set(descOwner)
        },
        onConfirm: async () => {
          await descriptionMutation.mutateAsync(descDraft)
          switchResolvedRef.current = true
          setDescOwner(null)
          setDescDraft('')
        },
        title: i18n.unsavedDescTitle,
        description: i18n.unsavedDescBody,
        confirmLabel: i18n.saveAndOpen,
        cancelLabel: i18n.keepEditing,
        secondaryAction: {
          label: i18n.discardChanges,
          onClick: () => {
            setDescOwner(null)
            setDescDraft('')
          }
        }
      }),
      // Cross-board move: board picker + its own confirmation chain (plain
      // move, children-must-travel, parent-loss) and a spinner while moving.
      jsx(MoveTaskDialog, {
        open: moveBoardOpen,
        task: data?.task
          ? {
              id: shownId,
              title: data.task.title || shownId,
              children: data.task.children || [],
              parents: data.task.parents || []
            }
          : null,
        boards,
        currentBoard: board || '',
        i18n,
        onClose: () => setMoveBoardOpen(false),
        onMove: toBoard => moveMutation.mutateAsync(toBoard)
      }),
    // No CLI block in the docked panel: a command has to stay readable, and that panel
    // is narrow by design. The drawer (overlay) and the modal both have the room.
    docked ? null : jsxs('div', { className: 'flex flex-col gap-1', children: [
      jsx('div', {
        className: 'text-[10px] uppercase font-semibold text-(--ui-text-tertiary)',
        children: i18n.cli
      }),
      jsx('div', { className: 'flex items-start gap-1.5', children: [
        // `select-all` because a command is read by selecting it: the copy button is a
        // convenience, not the only way, and a partial selection here is never what
        // anyone wanted.
        jsx('code', {
          className: 'flex-1 min-w-0 select-all break-all rounded border border-(--ui-stroke-tertiary) bg-(--ui-bg-subtle, transparent) px-1.5 py-1 font-mono text-[10.5px] text-(--ui-text-secondary)',
          children: cliCommand
        }),
        jsx('button', {
          type: 'button',
          className: 'shrink-0 rounded border border-(--ui-stroke-tertiary) bg-transparent px-1.5 py-1 text-[10.5px] text-(--ui-text-secondary) cursor-pointer hover:bg-(--chrome-action-hover)',
          title: i18n.copyCommand,
          'aria-label': i18n.copyCommand,
          onClick: () => {
            void navigator.clipboard.writeText(cliCommand)
            setCliCopied(true)
            // Self-disarming label: a "copied" that stays says nothing about the next copy.
            window.setTimeout(() => setCliCopied(false), 2000)
          },
          children: cliCopied ? i18n.copied : '⧉'
        })
      ] })
    ] })
  ]

  // The panel, as it has always been: docked beside the gantt or overlaying it.
  if (!detailModal) {
    return jsxs('div', {
      className: docked
        ? 'relative flex flex-col h-full min-h-0 border-l border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) pt-3.5 px-4'
        : 'absolute inset-y-0 right-0 z-50 max-w-full border-l border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) shadow-xl flex flex-col pt-3.5 px-4',
      'data-glass-opaque': true,
      role: 'dialog',
      'aria-label': i18n.taskDetail,
      style: { width: `${drawerW}px` },
      children: inner
    })
  }

  // The modal: the same body, centred, with the facts that are worth a column of
  // their own on the right — status, assignee, workspace, created, last activity and
  // the attachments, which is the shape the official kanban plugin's sidebar uses.
  const task = data?.task
  const when = ts => (ts ? new Date(Number(ts) * 1000).toLocaleString() : '—')
  const metaRow = (label, value) => jsxs('div', { className: 'flex flex-col gap-0.5', children: [
    jsx('div', {
      className: 'text-[10px] uppercase font-semibold text-(--ui-text-quaternary)',
      children: label
    }),
    jsx('div', { className: 'break-words text-[11px] text-(--ui-text-secondary)', children: value })
  ] })
  return jsx(Dialog, {
    open: true,
    onOpenChange: next => { if (!next) onClose() },
    children: jsx(DialogContent, {
      className: 'flex max-h-[min(84vh,54rem)] w-[min(62rem,94vw)] max-w-none flex-col overflow-hidden',
      children: jsxs('div', { className: 'flex min-h-0 flex-1 gap-4', children: [
        jsx('div', { className: 'min-w-0 flex-1 overflow-y-auto pr-1', children: inner }),
        jsxs('aside', {
          className: 'flex w-56 shrink-0 flex-col gap-2.5 overflow-y-auto border-l border-(--ui-stroke-tertiary) pl-3',
          children: [
            jsx('div', {
              className: 'text-[10px] uppercase font-semibold text-(--ui-text-tertiary)',
              children: i18n.detailMeta
            }),
            metaRow(i18n.metaStatus, task?.status || '—'),
            metaRow(i18n.metaAssignee, task?.assignee || '—'),
            metaRow(i18n.metaPriority, priorityDisplay(task?.priority)),
            task?.workspace_path ? metaRow(i18n.metaWorkspace, task.workspace_path) : null,
            metaRow(i18n.metaCreated, when(task?.created_at)),
            metaRow(i18n.metaLastActivity,
              when(task?.completed_at || task?.started_at || task?.created_at)),
            // The files as a real section, with their eye and their download, rather than a
            // comma-joined list of names: the modal's right column is where the official plugin
            // puts them, and it is the only place here that has the room for the actions.
            task?.attachments?.length
              ? jsx(AttachmentsSection, {
                  taskId: shownId, board, i18n,
                  attachments: task.attachments,
                  onPreview: att => setPreviewAtt(att)
                })
              : null,
            // Relations follow the priority and the files: this column is where the modal keeps
            // the facts about a task, and the body below it is for reading material.
            relations.parents.length === 0 ? null : jsx(TaskRelations, {
              heading: i18n.parents,
              tasks: relations.parents,
              onOpen: id => $openTaskId.set(id),
              onRemove: id => {
                const parent = relations.parents.find(t => t.id === id)
                setPendingUnlink({ id, title: parent ? parent.title : id })
              },
              removeLabel: i18n.removeParentLink,
              openLabel: i18n.openTask,
              disabled: unlinkMutation.isPending
            }),
            relations.children.length === 0 ? null : jsx(TaskRelations, {
              heading: i18n.children,
              tasks: relations.children,
              onOpen: id => $openTaskId.set(id),
              openLabel: i18n.openTask
            })
          ]
        })
      ] })
    })
  })
}

/* ───────────────────────────────────── page ───────────────────────────────── */

// Exported for the render harness: opening a task and switching to the modal are STATE, so a test
// can drive them directly instead of hunting for a row node to click — which the stub cannot even
// reach. Without this, the whole detail body is untestable, and it is where a temporal-dead-zone
// crash hid for a full evening while sixteen checks stayed green.
export { $openTaskId, $detailModal } from './state'

/** The modifier this platform uses for a wheel zoom: Hermes prints ⌘ on macOS, Ctrl
 *  elsewhere, so the hint says what the reader's own keyboard shows. */
export function modifierKeyLabel() {
  const platform = typeof navigator === 'undefined'
    ? ''
    : String(navigator.platform || navigator.userAgent || '')
  return /mac/i.test(platform) ? '⌘' : 'Ctrl'
}

/**
 * One mounted page PER BOARD.
 *
 * Switching boards remounts the view, which is what makes the per-board preferences (view
 * mode, both zooms, the period, the graph scope) apply at all: every one of them is read once,
 * in a useState initialiser. It is also the shape two board tabs will need — each tab owns its
 * component instance rather than sharing one through a global atom.
 */
export function KanbanGanttRoute() {
  const board = useValue($boardSlug)
  return jsx(KanbanGanttPage, { key: board || 'none' })
}

export function KanbanGanttPage() {
  const i18n = useGanttI18n()
  const queryClient = useQueryClient()
  const base = useValue($baseUrl)
  const board = useValue($boardSlug)
  const scope = useValue($connectionScope)
  const openTaskId = useValue($openTaskId)
  const openAttachment = useValue($openAttachment)
  const newTask = useValue($newTask)
  const moveUnderId = useValue($moveUnderId)
  const labelW = useValue($labelW)
  const drawerW = useValue($drawerW)
  const drawerDocked = useValue($drawerDocked)

  const { data: boardsData } = useQuery({
    queryKey: ['kanban-gantt', 'boards', apiBase()],
    queryFn: () => apiFetch('/boards'),
    refetchInterval: 5 * 60_000
  })
  // Projects are only needed by the creation dialog; cached for a minute so
  // opening it is instant.
  const { data: projectsData } = useQuery({
    queryKey: ['kanban-gantt', 'projects', apiBase()],
    queryFn: () => fetchProjects(),
    staleTime: 60_000
  })
  // Hermes profiles: assignee choices that exist before any task is assigned
  // (the board's own assignee list is empty until then).
  const { data: profilesData } = useQuery({
    queryKey: ['kanban-gantt', 'profiles', apiBase()],
    queryFn: () => fetchProfiles(),
    staleTime: 60_000
  })
  // ── prototype: websocket push for THIS loop (spike t_64075faf) ────────────
  // With the flag on, `/events` feeds the same cache entry this query fills and
  // the poll is demoted to a 300 s safety net; off (or dead socket, or a custom
  // backend base URL, which the socket door cannot address) it is today's 60 s
  // poll. Nothing else in the page changes — same queryKey, same data shape.
  const wsEnabled = useValue($wsEnabled)
  const [wsState, setWsState] = useState(WS_STATE.off)
  const socketDoor = getSocket()
  const wsBoard = wsEnabled && !base && canPush(board) ? board : null

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['kanban-gantt', 'gantt', apiBase(), board],
    queryFn: () => apiFetch(`/gantt${board ? `?board=${encodeURIComponent(board)}` : ''}`),
    refetchInterval: wsState === WS_STATE.live ? 300_000 : 60_000
  })

  // Tree fold state: a sparse override map (`id -> collapsed`), PER BOARD, so a
  // board that comes back shows the same branches open. It goes through the same
  // storage door as the board preference; a search never writes to it (treeRows
  // simply ignores it while a query is active, and nothing is lost when it ends).
  const foldKey = `fold.${board || 'current'}`
  const [fold, setFold] = useState(() => new Map())
  useEffect(() => {
    let next = new Map()
    try {
      const raw = getStorage() ? getStorage().get(foldKey, null) : null
      const parsed = raw ? JSON.parse(String(raw)) : []
      if (Array.isArray(parsed)) next = new Map(parsed.filter(Array.isArray))
    } catch (err) {
      next = new Map()                      // corrupt entry: start unfolded
    }
    setFold(next)
  }, [foldKey])
  const writeFold = next => {
    setFold(next)
    if (getStorage()) getStorage().set(foldKey, JSON.stringify([...next]))
  }
  const handleToggleFold = (id, collapsed) => {
    const next = new Map(fold)
    next.set(id, collapsed)
    writeFold(next)
  }

  // The socket's state is PERSISTED, not just held in React state: it is the only
  // way a silent push failure is diagnosable from outside — the client talks to
  // console.debug, which nothing captures in a packaged build (so "why is there
  // no live update?" had no answer). `wsOff` names the condition that switched it
  // off; `wsState` is the lifecycle the client reports.
  const recordWsState = state => {
    setWsState(state)
    if (getStorage()) getStorage().set('wsState', state)
  }

  useEffect(() => {
    if (!wsBoard) {
      // Several causes land here, so record which one it is: the flag, a custom
      // backend base (the socket door only speaks to the plugin's own namespace),
      // the all-boards view (nothing single to watch — it stays on the poll), a
      // host without the door, or no board yet.
      const why = !wsEnabled ? 'disabled' : base ? 'custom-base'
        : board && !canPush(board) ? 'all-boards' : !socketDoor ? 'no-door' : 'no-board'
      if (getStorage()) {
        getStorage().set('wsOff', why)
        getStorage().set('wsState', WS_STATE.off)
      }
      setWsState(WS_STATE.off)
      return undefined
    }
    if (getStorage()) getStorage().set('wsOff', '')
    return subscribeGantt(socketDoor, {
      board: wsBoard,
      onState: recordWsState,
      onSnapshot: snapshot => {
        queryClient.setQueryData(['kanban-gantt', 'gantt', apiBase(), wsBoard], snapshot)
      },
      onResync: () => {
        void queryClient.invalidateQueries({ queryKey: ['kanban-gantt', 'gantt', apiBase(), wsBoard] })
      }
    })
  }, [wsBoard, socketDoor, queryClient, scope])

  // R6: the 60 s poll was also what advanced the timeline's "now" cursor; with
  // pushes driving the data, a local 30 s tick keeps open run arcs moving.
  const [nowTick, setNowTick] = useState(0)
  useEffect(() => {
    if (wsState !== WS_STATE.live) return undefined
    const id = setInterval(() => setNowTick(t => t + 1), 30_000)
    return () => clearInterval(id)
  }, [wsState])

  const [showArchived, setShowArchived] = useState(false)
  // ── re-parenting: drag & drop plus the keyboard-reachable picker ───────────
  const [dragId, setDragId] = useState(null)
  const [pendingReparent, setPendingReparent] = useState(null)   // { childId, parentId }
  const allTasks = data?.tasks || []
  const [selectedAssignees, setSelectedAssignees] = useState(() => new Set())
  const [disabledStatuses, setDisabledStatuses] = useState(() => {
    const saved = getStorage() ? getStorage().get('disabledStatuses', null) : null
    return Array.isArray(saved) ? new Set(saved) : new Set()
  })
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [bulkAssignee, setBulkAssignee] = useState('')
  const lastCheckedIdRef = useRef(null)
  // 'timeline' (default) or 'list'. The list drops the bars and gives the
  // width to the columns: task, assignee, status, last activity.
  // Preferences are kept PER BOARD. Two boards open side by side must be able to show a list
  // and a timeline without fighting over one key, and a reader who works board A in graph mode
  // should not find board B in it tomorrow. The unscoped key stays as the fallback, so what an
  // existing reader already chose keeps applying until they touch that setting on that board.
  const prefKey = k => (board ? `${k}@${board}` : k)
  const readPref = (k, fallback = null) => {
    const s = getStorage()
    if (!s) return fallback
    const scoped = s.get(prefKey(k), null)
    return scoped == null ? s.get(k, fallback) : scoped
  }
  const writePref = (k, v) => {
    const s = getStorage()
    if (s) s.set(prefKey(k), v)
  }

  const [viewMode, setViewMode] = useState(() => {
    const saved = readPref('viewMode')
    return saved === 'list' || saved === 'graph' ? saved : 'timeline'
  })
  const graphMode = viewMode === 'graph'

  // The graph's own zoom: the SAME affordances as the timeline (Ctrl+wheel and the
  // slider), a different scale — a graph is sized by its layout, not by a time base. Its
  // percentage is persisted on its own key so switching views never rescales the other.
  const [graphZoomPct, setGraphZoomPct] = useState(() => {
    const s = getStorage()
    const saved = Number(readPref('graphZoomPct'))
    const lo = Math.round(GRAPH_ZOOM_MIN * 100)
    const hi = Math.round(GRAPH_ZOOM_MAX * 100)
    return Number.isFinite(saved) && saved >= lo && saved <= hi ? saved : 100
  })
  const handleGraphZoomPct = next => {
    const lo = Math.round(GRAPH_ZOOM_MIN * 100)
    const hi = Math.round(GRAPH_ZOOM_MAX * 100)
    const clamped = Math.min(hi, Math.max(lo, Math.round(next)))
    setGraphZoomPct(clamped)
    writePref('graphZoomPct', String(clamped))
  }

  // Which tasks the graph shows, on top of every filter: all of them, the open ones, or
  // the running ones with their whole lineage (the question this view exists to answer).
  // Taller cards: the title wraps onto a second line. It is a LAYOUT option, not a CSS one —
  // the node height is a constant the ranks are computed from (see `nodeH` in graph-core), so
  // the graph stays a set of exact equations instead of overlapping boxes.
  // ON by default: a one-line 10 px title was the smallest text on the screen and the only
  // text that matters in the graph, so legibility is the starting point and the compact card
  // is the option, not the other way round.
  const [cardsTall, setCardsTall] = useState(() => readPref('cardsTall') !== '0')
  const handleCardsTall = next => {
    setCardsTall(next)
    writePref('cardsTall', next ? '1' : '0')
  }
  // How the cards are arranged — the four modes upstream has. 'down' by default: a dependency
  // graph reads as a tree falling down the page, and a wide board is easier to scan by rank.
  const [arrange, setArrange] = useState(() => {
    const v = readPref('arrange')
    return ['down', 'flow', 'status', 'compact'].includes(v) ? v : 'down'
  })
  const handleArrange = next => {
    setArrange(next)
    writePref('arrange', next)
  }
  const [graphScope, setGraphScope] = useState(() => {
    const s = readPref('graphScope')
    return ['all', 'open', 'running-lineage'].includes(s) ? s : 'all'
  })
  const handleGraphScope = next => {
    setGraphScope(next)
    writePref('graphScope', next)
  }
  // The selected period shortcut, in seconds (null = the view is the reader's).
  // Decided from storage ALONE, in the initialiser: the stored period is only honoured
  // when the stored zoom is still the one that period last calibrated to, which is
  // exactly the question "did the reader zoom away from it?" — and answering it here
  // avoids a restore effect that would set state on mount.
  const [period, setPeriod] = useState(() => {
    const span = Number(readPref('period'))
    if (!(span > 0)) return null
    const zoom = Number(readPref('zoomPct'))
    const calibrated = Number(readPref('periodZoomPct'))
    if (!(zoom > 0) || !(calibrated > 0)) return null
    return Math.abs(zoom - calibrated) / calibrated <= 0.25 ? span : null
  })
  const listMode = viewMode === 'list'
  const handleViewMode = mode => {
    setViewMode(mode)
    writePref('viewMode', mode)
  }
  const [zoomPct, setZoomPct] = useState(() => {
    const s = getStorage()
    if (!s) return ZOOM_PCT_MIN
    const pct = readPref('zoomPct')
    if (pct != null) return clampZoomPct(pct)
    // Values stored before the scale was a percentage were FACTORS, and a factor and a
    // percentage are indistinguishable over 1..100 (a factor 7 looks like 7 %), so the old
    // key is CONVERTED rather than clamped — through the same pair of functions the display
    // uses. The ceiling here is nominal: the live one depends on the pane width, which is not
    // measured yet, and this only has to be roughly right for a one-off conversion.
    const legacy = Number(s.get('zoom', null))
    if (!Number.isFinite(legacy) || legacy <= 0) return ZOOM_PCT_MIN
    return zoomPctFromFactor(legacy, ZOOM_MIN_FACTOR, 28)
  })
  const containerRef = useRef(null)
  const scrollerRef = useRef(null)
  const [trackW, setTrackW] = useState(0)

  const handleToggleAssignee = name => {
    setSelectedAssignees(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }
  const handleClearAssignees = () => setSelectedAssignees(new Set())

  const handleToggleStatus = status => {
    if (status === 'archived') {
      setShowArchived(v => !v)
      return
    }
    setDisabledStatuses(prev => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      if (getStorage()) getStorage().set('disabledStatuses', [...next])
      return next
    })
  }

  // "Only tasks with attachments" — off by default, persisted like the other preferences, and
  // applied in the same pass as every other filter, so it composes with them.
  const [onlyAttachments, setOnlyAttachments] = useState(() => {
    const saved = getStorage() ? getStorage().get('onlyAttachments', null) : null
    return saved === '1' || saved === true
  })
  const toggleOnlyAttachments = next => {
    setOnlyAttachments(Boolean(next))
    if (getStorage()) getStorage().set('onlyAttachments', next ? '1' : '0')
  }

  const derived = useMemo(() => {
    if (!data || !data.tasks) return null
    let visible = data.tasks
    if (!showArchived) visible = visible.filter(t => !t.archived)
    if (onlyAttachments) visible = visible.filter(hasAttachments)
    if (disabledStatuses.size > 0) {
      visible = visible.filter(t => !disabledStatuses.has(t.status))
    }
    if (selectedAssignees.size > 0) {
      visible = visible.filter(t => t.assignee && selectedAssignees.has(t.assignee))
    }
    visible = visible.filter(t => matchesSearch(t, search))
    // The fold state is applied HERE, after every filter: `buildRows` stays the
    // flat projection the tests know, `treeRows` adds the explorer grammar (which
    // levels continue, who has children, what is collapsed).
    const rows = treeRows(visible, {
      fold,
      search,
      selected: openTaskId ? new Set([openTaskId]) : new Set()
    })
    const domain = computeDomain(visible)
    const allAssignees = Array.from(new Set(data.tasks.map(t => t.assignee).filter(Boolean))).sort()
    return { rows, domain, total: visible.length, tasks: visible, allAssignees }
  }, [data, showArchived, onlyAttachments, disabledStatuses, selectedAssignees, search, fold, openTaskId])

  // The header toggle: if anything the user can collapse is open, collapse it all;
  // otherwise open everything. It walks the rows, so it acts on exactly the set
  // that is on screen (a filtered-out branch is not silently rewritten).
  // `derived` is null until the board's data arrives, hence the guards: reading
  // `derived.rows` unguarded crashed the whole page into the error boundary on
  // the first render (found in the desktop log).
  const handleToggleAll = () => {
    const parents = (derived?.rows || []).filter(r => r.hasChildren)
    if (!parents.length) return
    const anyOpen = parents.some(r => !r.collapsed)
    const next = new Map(fold)
    for (const r of parents) next.set(r.task.id, anyOpen)
    writeFold(next)
  }
  const anyBranchOpen = (derived?.rows || []).some(r => r.hasChildren && !r.collapsed)

  // Creating a task: the domain derives the status (ready, or todo when the
  // chosen parent is not finished), so the dialog only collects what the user
  // types — plus an idempotency key, so a double submit cannot duplicate.
  const createTaskMutation = useMutation({
    mutationFn: values => createTask(values, board),
    onSuccess: (response, values) => {
      $newTask.set(null)
      toast('info', i18n.created(values.title))
      void queryClient.invalidateQueries({ queryKey: ['kanban-gantt'] })
      // Show the new task straight away: that is where its status made sense.
      $openTaskId.set(response.task_id)
    },
    onError: error => {
      const message = String((error && error.message) || error || '')
      toast('error', /title is required/i.test(message) ? i18n.errTitleRequired : i18n.errCreate)
    }
  })

  // ── re-parenting ──────────────────────────────────────────────────────────
  // Candidacy comes from the core (node-tested), so a row only ever paints what
  // the domain would accept: itself, its own subtree, another board, a finished
  // task and an existing parent are all refused up front.
  const boardOf = id => {
    const task = allTasks.find(t => t.id === id)
    if (task && task.board) return task.board
    return board && board !== 'all' && board !== '*' ? board : undefined
  }
  const dropMap = useMemo(
    () => (dragId ? new Map(dropCandidates(allTasks, dragId, boardOf(dragId)).map(c => [c.task.id, c])) : null),
    [dragId, allTasks, board])

  const reparentMutation = useMutation({
    mutationFn: ({ childId, parentId, mode }) => setParent(childId, parentId, mode, board),
    onSuccess: response => {
      setPendingReparent(null)
      const child = allTasks.find(t => t.id === response.task_id)
      const parent = allTasks.find(t => t.id === response.parent_id)
      const childName = child ? child.title : response.task_id
      const parentName = parent ? parent.title : response.parent_id
      // A re-parent can GATE the task (ready -> todo) — say so rather than let
      // the status change appear on its own.
      toast('info', response.gated ? i18n.gatedNotice(childName) : i18n.movedUnder(childName, parentName))
      // Prefix invalidation: the tree (gantt snapshot) AND the open task's
      // detail both refetch, so the moved task's row, its parent's row and the
      // drawer's relations all repaint together.
      void queryClient.invalidateQueries({ queryKey: ['kanban-gantt'] })
    },
    onError: error => {
      setPendingReparent(null)
      toast('error', humanReparentError(error, i18n))
    }
  })

  const unlinkMutation = useMutation({
    mutationFn: ({ childId, parentId }) => removeParent(childId, parentId, board),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kanban-gantt'] })
    },
    onError: error => toast('error', humanReparentError(error, i18n))
  })

  const handleDragStart = id => {
    setDragId(id)
  }

  const handleDropOn = targetId => {
    const childId = dragId
    setDragId(null)
    if (!childId || childId === targetId) return
    const candidate = dropMap ? dropMap.get(targetId) : null
    if (candidate && !candidate.allowed) {
      toast('error', reasonLabel(candidate.reason, i18n))
      return
    }
    const child = allTasks.find(t => t.id === childId)
    const parents = (child && child.parents) || []
    // Already parented: ask (add vs replace) instead of guessing.
    if (parents.length > 0) {
      setPendingReparent({ childId, parentId: targetId })
      return
    }
    reparentMutation.mutate({ childId, parentId: targetId, mode: 'add' })
  }

  // Linking from a card's slot: the arrow starts at the PARENT and lands on the CHILD, which is
  // the inverse of a card drop — there the dragged card is the one that becomes a child. Same
  // refusals, same dialog when the child already has parents: only the roles are swapped.
  const handleLinkChild = (parentId, childId) => {
    if (!parentId || !childId || parentId === childId) return
    const candidate = dropCandidates(allTasks, childId, boardOf(childId)).find(c => c.task.id === parentId)
    if (candidate && !candidate.allowed) {
      toast('error', reasonLabel(candidate.reason, i18n))
      return
    }
    const child = allTasks.find(t => t.id === childId)
    if (((child && child.parents) || []).length > 0) {
      setPendingReparent({ childId, parentId })
      return
    }
    reparentMutation.mutate({ childId, parentId, mode: 'add' })
  }

  // Which cards may become the child of the card the arrow started from. Computed when a link
  // starts, not on every render: the answer only depends on the source.
  const linkAllowed = useMemo(() => {
    return parentId => {
      const out = new Set()
      if (!parentId) return out
      for (const task of allTasks) {
        if (task.id === parentId) continue
        const candidate = dropCandidates(allTasks, task.id, boardOf(task.id)).find(c => c.task.id === parentId)
        if (candidate && candidate.allowed) out.add(task.id)
      }
      return out
    }
  }, [allTasks, board])

  // Same decision path as a drop, reached from the drawer's "move under…" item.
  const handlePickParent = parentId => {
    const childId = moveUnderId
    $moveUnderId.set(null)
    if (!childId || childId === parentId) return
    const candidate = dropCandidates(allTasks, childId, boardOf(childId)).find(c => c.task.id === parentId)
    if (candidate && !candidate.allowed) {
      toast('error', reasonLabel(candidate.reason, i18n))
      return
    }
    const child = allTasks.find(t => t.id === childId)
    if (((child && child.parents) || []).length > 0) {
      setPendingReparent({ childId, parentId })
      return
    }
    reparentMutation.mutate({ childId, parentId, mode: 'add' })
  }

  const handleToggleCheck = (id, checked, nativeEvent) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      const rowsList = derived?.rows || []
      const taskIds = rowsList.map(r => r.task.id)

      if (nativeEvent?.shiftKey && lastCheckedIdRef.current && taskIds.includes(lastCheckedIdRef.current)) {
        const lastIdx = taskIds.indexOf(lastCheckedIdRef.current)
        const curIdx = taskIds.indexOf(id)
        const [start, end] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx]
        for (let i = start; i <= end; i++) {
          if (checked) next.add(taskIds[i])
          else next.delete(taskIds[i])
        }
      } else {
        if (checked) next.add(id)
        else next.delete(id)
      }
      return next
    })
    lastCheckedIdRef.current = id
  }

  // Global keydown: Escape clears the selection. Deliberately no Ctrl+A /
  // Cmd+A: the handler would have to listen on `window` (app-wide capture),
  // which hijacks a shortcut the whole window owns — the header "select all"
  // checkbox already covers bulk selection.
  useEffect(() => {
    const handleKeyDown = e => {
      if (e.key === 'Escape') {
        if (selectedIds.size > 0) {
          setSelectedIds(new Set())
        }
        // The same verb as a click on the empty canvas: Escape drops the selection, which in
        // the graph means the lineage highlight and, if it is the modal form, the detail.
        $openTaskId.set(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedIds, derived])

  const bulkMutation = useMutation({
    // `assignee` must travel: the backend switches to mass-assign on its
    // presence ('' = unassign). Dropping it sent a bare action 'assign', which
    // the backend refused as unknown, so a batch assign never stored anything.
    mutationFn: ({ action, ids, assignee }) =>
      apiFetch(`/tasks/bulk${board ? `?board=${encodeURIComponent(board)}` : ''}`, {
        method: 'POST',
        body: assignee !== undefined ? { ids, assignee } : { ids, action }
      }),
    onSuccess: response => {
      const failed = (response?.results || []).filter(r => !r.ok)
      if (failed.length > 0) {
        toast('error', i18n.bulkFailed(failed.length, failed[0]?.error || failed[0]?.id))
      }
      setSelectedIds(new Set())
      setBulkAssignee('')
      void queryClient.invalidateQueries({ queryKey: ['kanban-gantt'] })
    },
    onError: error => toast('error', String(error?.message || error))
  })

  // Assignee choices = Hermes profiles + anyone already assigned on the board,
  // so a board where nobody is assigned yet still offers every profile.
  const assigneeChoices = useMemo(() => {
    const fromBoard = (derived && derived.allAssignees) || []
    const fromProfiles = (profilesData && profilesData.profiles) || []
    return Array.from(new Set([...fromProfiles, ...fromBoard])).sort()
  }, [derived, profilesData])

  const handleZoomPct = val => {
    const next = clampZoomPct(val)
    setZoomPct(next)
    writePref('zoomPct', next)
    // A zoom is the other way the view stops being the selected period, so the match is
    // re-evaluated at once — nothing fires a scroll when only the scale changes. Our own
    // calibration zooms too, and it must not clear what it is placing.
    if (zoomWatch.current && !calibrating.current) zoomWatch.current(next)
  }

  // View options live in one atom so the rows and the drawer read the same value.
  // The doors are wired at register time, so the atom cannot seed itself at module
  // load — the page hydrates it on mount instead.
  const titlePrefixTags = useValue($titlePrefixTags)
  const handleTitlePrefixTags = next => {
    $titlePrefixTags.set(next)
    if (getStorage()) getStorage().set('titlePrefixTags', next)
  }
  useEffect(() => {
    const s = getStorage()
    if (!s) return
    const saved = s.get('titlePrefixTags', null)
    if (saved != null) $titlePrefixTags.set(saved === true || saved === '1')
  }, [])

  const openTabs = useValue($openBoards)

  const persistTabs = list => {
    $openBoards.set(list)
    const s = getStorage()
    if (s) s.set(openBoardsKey(), JSON.stringify(list))
  }

  /** Add a board to the open set (no-op when it is already there). */
  const openBoardInTabs = slug => {
    const list = $openBoards.get()
    if (!slug || list.includes(slug)) return
    persistTabs([...list, slug])
  }

  /** Close a tab: the neighbour takes over when it was the active one, and the LAST tab is
   *  never closed — a page with no board would have nothing to show. */
  const closeBoardTab = slug => {
    const list = $openBoards.get()
    const next = list.filter(b => b !== slug)
    if (!next.length) return
    persistTabs(next)
    if (slug === board) setBoard(next[next.length - 1])
  }

  // The atom cannot read storage, so the open set is restored once, with the current board
  // appended: a remembered set that lost the active board (a renamed board, another gateway)
  // must not hide it.
  useEffect(() => {
    const s = getStorage()
    let list = []
    if (s) {
      const raw = s.get(openBoardsKey(), null)
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (Array.isArray(parsed)) list = parsed.filter(x => typeof x === 'string' && x)
      } catch {
        list = []
      }
    }
    if (board && !list.includes(board)) list = [...list, board]
    if (list.join('|') !== $openBoards.get().join('|')) $openBoards.set(list)
  }, [])

  const setBoard = slug => {
    $boardSlug.set(slug)
    if (getStorage()) getStorage().set(boardStorageKey(), slug)
    setSearch('')
    void queryClient.invalidateQueries({ queryKey: ['kanban-gantt', 'gantt'] })
    // Whatever opened this board — a tab, the switcher, the "+" — it is now one of the open
    // ones. Deciding that HERE is what keeps the tab strip and the switcher from disagreeing.
    if (slug) openBoardInTabs(slug)
  }

  // Adopt a board when none is remembered, and drop one this gateway does not
  // have. The remembered slug is validated against /boards, never trusted: it may
  // have been chosen while another gateway was active — that is how `obsfish`
  // stranded the page on This device, one 503 per poll, with no way out.
  useEffect(() => {
    const list = boardsData?.boards
    if (!list || !list.length) return
    const known = list.map(b => (typeof b === 'string' ? b : b && b.slug)).filter(Boolean)
    const resolved = resolveBoardSlug(board, known, boardsData.current)
    if (resolved.fallback) {
      toast('warning', `${i18n.boardGoneTitle(board)} — ${i18n.boardGoneDesc(resolved.suggested)}`)
      setBoard(resolved.suggested)
      return
    }
    if (resolved.suggested) setBoard(resolved.suggested)
  }, [boardsData, board])

  // A board-specific failure cannot be fixed by retrying, and renaming it
  // "backend unreachable" hides the only useful fact: forget the slug and let
  // this gateway's current board take over.
  useEffect(() => {
    if (!isError || !board || !isMissingBoardError(error)) return
    toast('warning', `${i18n.boardGoneTitle(board)} — ${i18n.boardGoneDesc(boardsData?.current || '')}`)
    setBoard(boardsData?.current || '')
  }, [isError, error, board, boardsData])

  // Track the pane width so the default Gantt scale derives from real geometry.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observe = () => setTrackW(el.getBoundingClientRect().width)
    observe()
    let ro = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(observe)
      ro.observe(el)
    } else {
      window.addEventListener('resize', observe)
    }
    return () => {
      if (ro) ro.disconnect()
      else window.removeEventListener('resize', observe)
    }
  }, [])

  const boards = boardsData?.boards || []
  const isAllBoards = board === 'all' || board === '*'
  const currentBoardObj = isAllBoards
    ? { slug: 'all', label: i18n.allBoards }
    : boards.find(b => b.slug === (board || boardsData?.current))
  const boardLabel = slug => {
    if (slug === 'all' || slug === '*') return i18n.allBoards
    return boards.find(b => b.slug === slug)?.label || slug || '—'
  }

  // Scroll to the latest / right end once on initial board load
  const hasAutoScrolledBoardRef = useRef(null)
  useEffect(() => {
    const el = scrollerRef.current
    if (el && board && hasAutoScrolledBoardRef.current !== board) {
      hasAutoScrolledBoardRef.current = board
      el.scrollLeft = el.scrollWidth
    }
  }, [board, derived, trackW])

  // The board's data is not always there yet: on a first open, with no board remembered,
  // the list resolves before the gantt does. Nothing here may exit early — no `return`
  // above this line, ever: the wheel anchor, the period refs and every effect below are
  // hooks, so a conditional exit makes the first render run fewer hooks than the second,
  // and React's #310 (\"more hooks than during the previous render\") replaces the page with
  // its error boundary. The loading and error states are therefore rendered at the END,
  // next to the return, once every hook has run.
  void nowTick
  const now = Date.now() / 1000
  const rows = derived?.rows || []
  const domain = derived?.domain || { min: now - 7 * DAY, max: now }
  const visibleWidth = Math.max(trackW - labelW - 24, 300)
  // At zoom = 1 (100%), exactly 1 week (7 days) fills the visible timeline width
  const baseDayWidth = visibleWidth / 7
  const basePerSec = baseDayWidth / DAY
  // The detail ceiling is a WINDOW, not a pixel ratio: zooming past the point where 6 h
  // fills the pane buys nothing but a smeared ruler, so the scale stops there. It is
  // derived from the live width, so a wide window cannot zoom further than a narrow one.
  const zoomCeiling = visibleWidth / 6          // px per hour that "6 h fits" implies
  const zoomMax = maxZoom(basePerSec, zoomCeiling)
  // The factor behind the percentage: 100 always means "6 h fits the pane", whatever the
  // pane's width, because the ceiling is what the top of the scale maps to.
  const zoomUsed = zoomFactorFromPct(zoomPct, ZOOM_MIN_FACTOR, zoomMax)
  const pxPerSec = basePerSec * zoomUsed
  const timelineW = Math.max(1, Math.ceil((domain.max - domain.min) * pxPerSec))

  // Ctrl/⌘+wheel is Chromium's PAGE zoom, and Electron inherits it — which is why the whole
  // desktop used to scale with the timeline. A React `onWheel` cannot stop that: React
  // registers wheel listeners as passive, so `preventDefault()` there is ignored. Hence a
  // native, non-passive listener on the page itself:
  //     over the timeline  → zoom the timeline at the cursor;
  //     elsewhere in the plugin → swallow the gesture, so the desktop keeps its scale;
  //     a bare wheel → left alone, it scrolls the rows;
  //     Shift+wheel → pan.
  // The step follows the DELTA, not the event count, so a mouse notch and a trackpad stream
  // feel the same (see `wheelZoomFactor`).
  const zoomAnchor = useRef(null)
  useEffect(() => {
    const host = containerRef.current
    if (!host) return undefined
    const onWheel = event => {
      // A trackpad's horizontal swipe carries deltaX and no deltaY.
      const pan = event.deltaY !== 0 ? event.deltaY : event.deltaX
      if (!pan) return
      const intent = wheelIntent(event)
      if (intent === 'scroll') return
      const el = scrollerRef.current
      // `preventDefault()` is what cancels Chromium's page zoom, and it only works because this
      // listener is non-passive. `stopPropagation()` is belt and braces: if the app ever grows
      // its own ctrl+wheel handler, the gesture stops here instead of reaching it. Not
      // `stopImmediatePropagation()`: that would also silence sibling listeners on this same
      // node, which have nothing to do with the gesture.
      event.preventDefault()
      event.stopPropagation()
      if (intent === 'pan') {
        if (el) el.scrollLeft += pan
        return
      }
      // Zoom — only where the pointer is actually over the timeline.
      if (!el || !el.contains(event.target)) return
      const factor = wheelZoomFactor(event.deltaY, event.deltaMode)
      const rect = el.getBoundingClientRect()
      const cursorPx = event.clientX - rect.left - labelW
      const at = domain.min + (el.scrollLeft + cursorPx) / pxPerSec
      const next = clampZoomPct(zoomPctFromFactor(zoomUsed * factor, ZOOM_MIN_FACTOR, zoomMax))
      if (next === zoomPct) return
      zoomAnchor.current = { at, cursorPx }
      handleZoomPct(next)
    }
    host.addEventListener('wheel', onWheel, { passive: false })
    return () => host.removeEventListener('wheel', onWheel)
  }, [domain.min, pxPerSec, labelW, zoomPct, zoomUsed, zoomMax, handleZoomPct])

  // ↑/↓ walk the rows while the detail is DOCKED beside the gantt: a reader comparing two tasks
  // should not have to aim at each row in turn. Two deliberate limits — the modal keeps the
  // arrows for the preview's own navigation, and fields keep their caret movement.
  useEffect(() => {
    if (!openTaskId || !drawerDocked) return undefined
    const onArrow = event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      const tag = (event.target && event.target.tagName) || ''
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
          || (event.target && event.target.isContentEditable)) return
      const order = (derived?.rows || []).map(row => row.task.id)
      const next = neighbourId(order, openTaskId, event.key === 'ArrowDown' ? 1 : -1)
      if (!next) return
      event.preventDefault()
      $openTaskId.set(next)
      // Keep the keyboard where it is: the row that just opened takes the focus, so the next
      // press continues from there instead of from the document.
      requestAnimationFrame(() => {
        const element = document.querySelector(`[data-row-id="${next}"]`)
        if (!element) return
        element.focus()
        element.scrollIntoView({ block: 'nearest' })
      })
    }
    window.addEventListener('keydown', onArrow)
    return () => window.removeEventListener('keydown', onArrow)
  }, [openTaskId, drawerDocked, derived])
  const resetView = () => {
    handleZoomPct(ZOOM_PCT_MIN)
    if (scrollerRef.current) scrollerRef.current.scrollLeft = 0
  }
  // Re-apply the wheel anchor once the new scale is on screen: the instant that
  // was under the pointer must stay under it.
  useEffect(() => {
    const el = scrollerRef.current
    const anchor = zoomAnchor.current
    if (!el || !anchor) return
    zoomAnchor.current = null
    el.scrollLeft = Math.max(0, (anchor.at - domain.min) * pxPerSec - anchor.cursorPx)
  }, [zoomPct, pxPerSec, domain.min])

  const periodRef = useRef(null)
  periodRef.current = period
  const lastScrollSave = useRef(0)
  const handleScroll = () => {
    const el = scrollerRef.current
    if (!el) return
    const visible = visibleWindow({
      min: domain.min, pxPerSec, scrollLeft: el.scrollLeft,
      clientWidth: el.clientWidth, labelW
    })
    const matched = matchPeriod(visible, now, PERIOD_TOLERANCE)
    if (matched !== periodRef.current) setPeriod(matched)
  }

  // ── the period shortcuts ────────────────────────────────────────────────────
  // While a period is selected the view is OURS to place: it is re-calibrated whenever
  // the clock, the pane or the label column changes, so the whole slice stays visible
  // even after the column is resized. A gesture by the reader ends that.
  const zoomWatch = useRef(null)
  const calibrating = useRef(false)
  const placingUntil = useRef(0)
  const restoreDone = useRef(false)

  // 1. the scale: px/sec that makes the slice fill the visible timeline area.
  useEffect(() => {
    if (period == null) return
    const el = scrollerRef.current
    if (!el) return
    const target = periodPxPerSec(period, el.clientWidth, labelW)
    if (target == null) return
    const next = clampZoomPct(zoomPctFromFactor(
      clampZoom(target / basePerSec, basePerSec, zoomCeiling), ZOOM_MIN_FACTOR, zoomMax))
    placingUntil.current = performance.now() + 300
    if (next !== zoomPct) {
      calibrating.current = true
      handleZoomPct(next)
      calibrating.current = false
    }
    // Remember the zoom this period calibrates to: that is the mark the next open
    // compares the reader's zoom against.
    writePref('periodZoomPct', next)
  }, [period, labelW, trackW, basePerSec, zoomPct, zoomMax, zoomCeiling])

  // What the view would be at a new scale, with the scroll it has now.
  const evaluateZoom = nextPct => {
    const el = scrollerRef.current
    if (!el || periodRef.current == null) return
    const visible = visibleWindow({
      min: domain.min, pxPerSec: basePerSec * zoomFactorFromPct(nextPct, ZOOM_MIN_FACTOR, zoomMax),
      scrollLeft: el.scrollLeft,
      clientWidth: el.clientWidth, labelW
    })
    const matched = matchPeriod(visible, Date.now() / 1000, PERIOD_TOLERANCE)
    if (matched !== periodRef.current) setPeriod(matched)
  }
  zoomWatch.current = evaluateZoom

  // 2. the position — after the scale is in place, right-align the slice on now. Runs on
  //    every clock tick, which is what makes the window follow.
  useEffect(() => {
    if (period == null) return
    const el = scrollerRef.current
    if (!el) return
    const target = periodScrollLeft({
      from: now - period, to: now, min: domain.min,
      pxPerSec, clientWidth: el.clientWidth, labelW
    })
    if (target == null) return
    placingUntil.current = performance.now() + 300
    if (el.scrollLeft !== target) el.scrollLeft = target
  }, [period, pxPerSec, labelW, trackW, nowTick, domain.min])

  // With no period active, put the scroll back where the reader left it — once, and
  // without touching state (this effect only moves the view).
  const scrollRestored = useRef(false)
  useEffect(() => {
    if (scrollRestored.current || period != null) return
    const el = scrollerRef.current
    if (!el || el.clientWidth <= 0) return
    scrollRestored.current = true
    const s = getStorage()
    const scroll = s ? Number(s.get('scroll', null)) : null
    if (Number.isFinite(scroll) && scroll > 0) el.scrollLeft = scroll
  }, [trackW, labelW, period])

  const handlePeriod = span => {
    // Clicking the active value releases the view; the value stays remembered.
    const next = period === span ? null : span
    setPeriod(next)
    if (next != null) writePref('period', next)
  }

  const grid = rows.map((row, idx) => jsx(TaskRow, {
    ...row,
    now,
    pxPerSec,
    min: domain.min,
    timelineW,
    listMode,
    onOpen: id => $openTaskId.set(id),
    isSelected: openTaskId === row.task.id,
    isChecked: selectedIds.has(row.task.id),
    onToggleCheck: handleToggleCheck,
    isEven: idx % 2 === 0,
    showBoardBadge: isAllBoards,
    // Drop feedback only for rows that are not the dragged one.
    dragState: !dropMap || row.task.id === dragId
      ? null
      : (dropMap.get(row.task.id)?.allowed ? 'ok' : 'no'),
    onDragStartTask: handleDragStart,
    onDragEndTask: () => setDragId(null),
    onDropOn: handleDropOn,
    onToggleFold: handleToggleFold
    // The key must identify the POSITION, not the task: on a multi-parent board a
    // task legitimately holds several rows (its primary position plus one per later
    // parent that reaches it), and keying those by task id alone hands React
    // duplicates. It then reuses and abandons nodes, so folded-away rows survive in
    // the DOM and pile up on every toggle. The primary position keys on the task
    // (stable while re-parenting within the tree); a secondary one adds the parent
    // it hangs under, which is what makes that row unique.
  }, row.secondary ? `${row.task.id}@${row.parentId}` : row.task.id))

  // Determine dominant status priority for the top task count badge:
  // blocked > running > review > ready > scheduled > todo > triage > done > archived
  const STATUS_PRIORITY = ['blocked', 'running', 'review', 'ready', 'scheduled', 'todo', 'triage', 'done', 'archived']
  const blockedCount = (derived?.tasks || []).filter(t => t.status === 'blocked').length
  const dominantStatus = (() => {
    const present = new Set((derived?.tasks || []).map(t => t.status))
    for (const s of STATUS_PRIORITY) {
      if (present.has(s)) return s
    }
    return 'todo'
  })()
  const dominantTone = statusTone(dominantStatus)

  const dockDrawer = Boolean(openTaskId && drawerDocked)

  // The two states that used to return early, now that every hook has run. A conditional
  // exit above any hook is what produces React #310 — see the note at the top of the body.
  if (isLoading && !data) {
    return jsx('div', { className: 'flex h-full items-center justify-center p-8', children: jsx(Loader, {}) })
  }
  if (isError) {
    // Name the real cause. A board this gateway does not have is not a dead backend, and
    // "plugin enabled? gateway restarted?" sent people restarting healthy gateways.
    const gone = isMissingBoardError(error)
    return jsx('div', { className: 'p-6', children: jsx(ErrorState, {
      title: gone ? i18n.boardMissingTitle : i18n.cannotLoadBoard,
      description: gone
        ? i18n.boardMissingDesc(board || boardLabel(board), boardsData?.current || '')
        : i18n.cannotLoadBoardDesc(base)
    }) })
  }

  return jsxs('div', {
    ref: containerRef,
    // No root padding: the desktop shell already insets plugin pages, and the
    // demo adds its own body padding (tests/demo.html).
    className: cn('relative h-full flex', dockDrawer ? 'flex-row gap-3' : 'flex-col'),
    children: [
      // Page-header chrome: exists exactly while this page is mounted — the
      // board switcher is projected into the workspace page-header band (the
      // tab row above the page), like the official kanban plugin's switcher
      // (WORKSPACE_PAGE_HEADER_AREA, NOT titleBar.center).
      jsx(Contribute, { area: WORKSPACE_PAGE_HEADER_AREA, id: 'kanban-gantt:board-switcher', children: jsx(TitlebarBoardSwitcher, {}) }),

      // Main column (header + chart + legend). When the drawer is docked it
      // becomes a flex sibling of this column, so the gantt shrinks to make
      // room instead of being covered. Carries the view padding (the desktop
      // shell already insets contributed pages; the demo adds its own).
      jsxs('div', {
        className: 'flex flex-col flex-1 min-h-0 min-w-0 pl-3 pr-3 py-2',
        children: [

      // Top header row: Left title + task count badge + blocked badge + filter + search, Center board switcher, Right zoom + new task
      jsxs('div', {
        className: 'flex flex-wrap items-center justify-between gap-2 mb-2',
        children: [
          // Left: Title + Task Count Badge + Blocked Badge + Filter + Search Field
          jsxs('div', {
            className: 'inline-flex items-center gap-2 text-sm font-medium',
            children: [
              jsx('span', { className: 'font-semibold', children: i18n.title }),
              jsx('span', {
                className: 'inline-flex items-center justify-center rounded-full px-2 py-0.2 text-[10.5px] font-semibold tracking-tight shadow-xs cursor-help',
                title: i18n.nTasksTotal(derived?.total || 0, dominantStatus),
                style: {
                  backgroundColor: `color-mix(in srgb, ${dominantTone} 18%, transparent)`,
                  borderColor: `color-mix(in srgb, ${dominantTone} 40%, transparent)`,
                  borderWidth: '1px',
                  color: dominantTone
                },
                children: `${derived?.total || 0}`
              }),
              blockedCount > 0
                ? jsxs('span', {
                    className: 'inline-flex items-center gap-1 rounded-full px-2 py-0.2 text-[10.5px] font-semibold tracking-tight shadow-xs text-[#f87171] border border-[#f87171]/40 bg-[#f87171]/18 cursor-help',
                    title: i18n.nBlockedWarning(blockedCount),
                    children: [
                      jsx(Codicon, { name: 'warning', size: '0.8rem' }),
                      jsx('span', { children: `${blockedCount}` })
                    ]
                  })
                : null,
              jsx(FilterDropdown, {
                assignees: derived?.allAssignees || [],
                selectedAssignees,
                onToggleAssignee: handleToggleAssignee,
                onClearAssignees: handleClearAssignees,
                disabledStatuses,
                onToggleStatus: handleToggleStatus,
                showArchived,
                onToggleArchived: setShowArchived,
                onlyAttachments,
                onToggleOnlyAttachments: toggleOnlyAttachments
              }),
              jsxs('div', {
                className: 'inline-flex items-center gap-1.5 border-b border-transparent focus-within:border-(--ui-stroke-secondary) px-1 py-0.5 ml-1',
                children: [
                  jsx(Codicon, { name: 'search', size: '0.85rem', className: 'text-(--ui-text-quaternary)' }),
                  jsx('input', {
                    type: 'search',
                    value: search,
                    placeholder: i18n.filterCards,
                    className: 'bg-transparent border-0 text-xs text-(--ui-text-primary) placeholder:text-(--ui-text-quaternary) focus:outline-none w-48',
                    onInput: event => setSearch(event.target.value)
                  })
                ]
              })
            ]
          }),

          // Board switcher moved to the desktop titlebar band (titleBar.center)
          // — see TitlebarBoardSwitcher above.

          // Right: Refresh button + Zoom control
          jsxs('div', {
            className: 'inline-flex items-center gap-3',
            children: [
              jsx(ViewToggle, { value: viewMode, onChange: handleViewMode }),
              // In graph mode the period selector has nothing to say (there is no time
              // axis), so its slot carries the scopes instead — same width, same place.
              // Scopes in graph mode, the period selector in the timeline: a graph has no time
              // axis to slice, and since the activity band is gone there is nothing left for a
              // window to tune.
              graphMode
                ? jsx(GraphScopeToggle, { value: graphScope, onChange: handleGraphScope })
                : listMode ? null : jsx(PeriodSelector, {
                    value: period,
                    onChange: handlePeriod,
                    disabled: false
                  }),
              listMode ? null : jsxs('span', { className: 'inline-flex items-center gap-1.5', children: [
                jsx('input', {
                  type: 'range',
                  min: String(graphMode ? Math.round(GRAPH_ZOOM_MIN * 100) : ZOOM_PCT_MIN),
                  max: String(graphMode ? Math.round(GRAPH_ZOOM_MAX * 100) : ZOOM_PCT_MAX),
                  step: '1',
                  value: String(graphMode ? graphZoomPct : zoomPct),
                  onInput: event => (graphMode ? handleGraphZoomPct : handleZoomPct)(Number(event.target.value)),
                  className: 'w-24',
                  title: i18n.zoomWheelHint(modifierKeyLabel()),
                  'aria-label': graphMode ? i18n.graphZoom : i18n.zoomTimeline
                }),
                jsx('span', { className: 'text-[10px] tabular-nums text-(--ui-text-tertiary) w-8 text-right shrink-0', children: `${graphMode ? graphZoomPct : zoomPct}%` })
              ] }),
              // The Refresh button is back, but only when the page is KNOWINGLY on
              // the 60 s poll: the push is off (KANBAN_GANTT_WS=0 on the gateway, or
              // this client's `ws` flag) or the socket gave up (it re-arms within
              // WS_REARM_MS). While the push is live — and during the seconds it
              // takes to connect, which resolves itself — the timeline follows on
              // its own, so the button stays out of the way.
              wsState === WS_STATE.off || wsState === WS_STATE.dead
                ? jsx('span', {
                    title: i18n.refreshWhy,
                    children: jsx(Button, {
                      size: 'xs',
                      onClick: () => void queryClient.invalidateQueries({ queryKey: ['kanban-gantt', 'gantt'] }),
                      children: jsxs('span', { className: 'flex items-center gap-1', children: [
                        jsx(Codicon, { name: 'refresh', size: '0.85rem' }),
                        i18n.refresh
                      ] })
                    })
                  })
                : null,
              // Far right: the board's only creation verb.
              jsx(Button, {
                size: 'xs',
                variant: 'default',
                onClick: () => $newTask.set({ parentId: '' }),
                children: jsxs('span', { className: 'flex items-center gap-1', children: [
                  jsx(Codicon, { name: 'add', size: '0.85rem' }),
                  i18n.newTask
                ] })
              }),
              // The view's own menu, rightmost next to the creation verb.
              jsxs(DropdownMenu, { children: [
                jsx(DropdownMenuTrigger, {
                  asChild: true,
                  children: jsx('button', {
                    type: 'button',
                    className: 'inline-flex items-center justify-center rounded-md p-1 hover:bg-(--chrome-action-hover) cursor-pointer text-(--ui-text-secondary) border-0 bg-transparent',
                    'aria-label': i18n.viewOptions,
                    title: i18n.viewOptions,
                    children: jsx(Codicon, { name: 'kebab-vertical', size: '0.9rem' })
                  })
                }),
                jsxs(DropdownMenuContent, {
                  align: 'end',
                  className: 'min-w-[17rem] p-1 text-xs',
                  children: [
                    jsxs(DropdownMenuItem, {
                      className: 'flex items-start gap-2 px-3 py-1.5',
                      onClick: () => handleTitlePrefixTags(!titlePrefixTags),
                      children: [
                        jsx(Codicon, {
                          name: titlePrefixTags ? 'check' : 'blank',
                          size: '0.85rem',
                          className: 'mt-0.5 shrink-0'
                        }),
                        jsxs('span', { className: 'flex flex-col gap-0.5 min-w-0', children: [
                          jsx('span', { children: i18n.titlePrefixTags }),
                          jsx('span', {
                            className: 'text-[10px] text-(--ui-text-tertiary)',
                            children: i18n.titlePrefixTagsHint
                          })
                        ] })
                      ]
                    }),
                    // Only meaningful in the graph, where a card is a fixed box.
                    graphMode
                      ? jsxs(DropdownMenuItem, {
                          className: 'flex items-start gap-2 px-3 py-1.5',
                          onClick: () => handleCardsTall(!cardsTall),
                          children: [
                            jsx(Codicon, {
                              name: cardsTall ? 'check' : 'blank',
                              size: '0.85rem',
                              className: 'mt-0.5 shrink-0'
                            }),
                            jsxs('span', { className: 'flex flex-col gap-0.5 min-w-0', children: [
                              jsx('span', { children: i18n.cardsTall }),
                                jsx('span', {
                                className: 'text-[10px] text-(--ui-text-tertiary)',
                                children: i18n.cardsTallHint
                              })
                            ] })
                          ]
                        })
                      : null,
                    // The four arrangements upstream draws: two layered (flow, down) and two that
                    // are not layered drawings at all (status, grid). Only a graph has ranks.
                    graphMode
                      ? [['down', i18n.arrangeDown], ['flow', i18n.arrangeFlow], ['status', i18n.arrangeStatus], ['compact', i18n.arrangeCompact]]
                          .map(([id, label]) => jsxs(DropdownMenuItem, {
                            key: id,
                            className: 'flex items-center gap-2 px-3 py-1.5',
                            onClick: () => handleArrange(id),
                            children: [
                              jsx(Codicon, { name: arrange === id ? 'check' : 'blank', size: '0.85rem', className: 'shrink-0' }),
                              jsx('span', { children: label })
                            ]
                          }))
                      : null
                  ]
                })
              ] })
            ]
          })
        ]
      }),

      // Board tabs: one per open board, plus the "+" that opens another. Each tab is a full
      // page instance of its own (the route remounts on board change), so a reader can keep
      // board A in graph mode and board B in timeline, at their own zooms — the preferences
      // are stored per board. The strip is always there: with one board it is where the "+"
      // lives, and it names what you are looking at.
      jsxs('div', {
        className: 'mb-2 flex items-center gap-1 overflow-x-auto min-w-0',
        role: 'tablist',
        'aria-label': i18n.boardsTabs,
        children: [
          ...openTabs.map(slug => jsxs('span', {
            key: slug,
            role: 'tab',
            'aria-selected': slug === board ? 'true' : 'false',
            className: cn(
              'inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] whitespace-nowrap',
              slug === board
                ? 'border-(--ui-accent) bg-(--ui-accent)/12 text-(--ui-accent) font-medium'
                : 'border-(--ui-stroke-secondary) text-(--ui-text-tertiary)'
            ),
            children: [
              jsx('button', {
                type: 'button',
                onClick: () => setBoard(slug),
                className: 'cursor-pointer border-0 bg-transparent p-0 text-inherit',
                title: boardLabel(slug),
                children: boardLabel(slug)
              }),
              openTabs.length > 1
                ? jsx('button', {
                    type: 'button',
                    onClick: event => { event.stopPropagation(); closeBoardTab(slug) },
                    title: i18n.closeBoard,
                    'aria-label': `${i18n.closeBoard} — ${boardLabel(slug)}`,
                    className: 'inline-flex cursor-pointer items-center border-0 bg-transparent p-0 text-inherit opacity-60 hover:opacity-100',
                    children: jsx(Codicon, { name: 'close', size: '0.7rem' })
                  })
                : null
            ]
          })),
          jsxs(DropdownMenu, {
            children: [
              jsx(DropdownMenuTrigger, {
                asChild: true,
                children: jsx('button', {
                  type: 'button',
                  title: i18n.openBoard,
                  'aria-label': i18n.openBoard,
                  className: 'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border border-dashed border-(--ui-stroke-secondary) p-0.5 text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover)',
                  children: jsx(Codicon, { name: 'add', size: '0.75rem' })
                })
              }),
              jsxs(DropdownMenuContent, {
                align: 'start',
                className: 'max-h-72 overflow-auto p-1 text-xs',
                children: [
                  ...boards
                    .filter(b => !openTabs.includes(b.slug))
                    .map(b => jsx(DropdownMenuItem, {
                      key: b.slug,
                      className: 'px-3 py-1.5',
                      onClick: () => setBoard(b.slug),
                      children: b.label || b.slug
                    })),
                  boards.every(b => openTabs.includes(b.slug)) || boards.length === 0
                    ? jsx(DropdownMenuItem, { disabled: true, className: 'px-3 py-1.5 text-(--ui-text-quaternary)', children: i18n.noOtherBoards })
                    : null
                ]
              })
            ]
          })
        ]
      }),

      !derived
        ? jsx('div', { className: 'py-10 grid place-items-center', children: jsx(Loader, {}) })
        : graphMode
        ? jsx(GraphView, {
            tasks: derived.tasks || [],
            i18n,
            now,
            zoom: graphZoomPct / 100,
            onZoom: factor => handleGraphZoomPct(factor * 100),
            scope: graphScope,
            onScopeChange: handleGraphScope,
            selectedId: openTaskId,
            // The board name earns its place only when several boards share the view, the
            // same rule the rows follow: with one board selected it is already on the
            // switcher, and repeating it on every node is noise.
            showBoardBadge: isAllBoards,
            groupLabel: boardLabel,
            board,
            dragId,
            dropMap,
            onOpen: id => $openTaskId.set(id),
            onDragStart: handleDragStart,
            onDragEnd: () => setDragId(null),
            onDropOn: handleDropOn,
            // New task FROM a node: the node is the parent, and the existing dialog does
            // the rest (it is the same creation verb, reached from the graph).
            onNewChild: id => $newTask.set({ parentId: id }),
            onClearSelection: () => $openTaskId.set(null),
            onLinkChild: handleLinkChild,
            linkAllowed,
            tallCards: cardsTall,
            arrangement: arrange,
            sortBy: 'status'
          })
        : rows.length === 0
        ? jsxs('div', {
            className: 'py-10 flex flex-col items-center gap-3',
            children: [
              jsx(EmptyState, { title: i18n.nothingToDisplay, description: i18n.noTasksMatch }),
              // Onboarding: the first creation is the hardest step, so offer it right here
              // rather than leaving the reader to find the header button.
              jsx(Button, {
                size: 'sm',
                variant: 'default',
                onClick: () => $newTask.set({ parentId: '' }),
                children: jsxs('span', { className: 'flex items-center gap-1', children: [
                  jsx(Codicon, { name: 'add', size: '0.85rem' }),
                  i18n.newTask
                ] })
              })
            ]
          })
        : jsxs('div', {
            className: 'mt-2 border border-(--ui-stroke-tertiary) rounded-md overflow-hidden flex-1 min-h-0 flex flex-col relative',
            children: [
              jsx(SelectionBar, {
                selected: selectedIds,
                onClear: () => setSelectedIds(new Set()),
                onStatus: status => bulkMutation.mutate({ action: status, ids: [...selectedIds] }),
                onAssign: profile => bulkMutation.mutate({ action: 'assign', ids: [...selectedIds], assignee: profile }),
                onArchive: () => bulkMutation.mutate({ action: 'archive', ids: [...selectedIds] }),
                onDelete: () => {
                  if (confirm(i18n.confirmDelete(`${selectedIds.size} tasks`))) {
                    bulkMutation.mutate({ action: 'delete', ids: [...selectedIds] })
                  }
                },
                assignees: assigneeChoices,
                busy: bulkMutation.isPending
              }),
              jsxs('div', {
                ref: scrollerRef,
                className: 'overflow-auto flex-1 min-h-0 relative',
                // The wheel is handled by a native listener on the page (see above): React's
                // own wheel listeners are passive, and a passive listener cannot stop the
                // desktop from zooming.
                onScroll: handleScroll,
                children: [
                  jsxs('div', {
                    className: cn('grid sticky top-0 z-20 bg-(--ui-bg-chrome)', listMode ? 'w-full' : 'w-max'),
                    'data-glass-opaque': true,
                    style: { gridTemplateColumns: listMode ? LIST_COLUMNS : `${labelW}px ${timelineW}px` },
                    children: [
                      jsxs('div', {
                        className: 'sticky left-0 z-30 bg-(--ui-bg-chrome) border-r border-b border-(--ui-stroke-tertiary) flex items-center pr-2 gap-1.5',
                        'data-glass-opaque': true,
                        style: { height: pxPerSec * DAY >= 50 && tickUnit(domain.max - domain.min) === 'day' ? '32px' : '24px',
                                 paddingLeft: `${TREE_INSET}px` },
                        children: [
                          // The tree's global toggle: at the head of the column and IN
                          // FRONT OF the master checkbox, in the same 13px slot a root's
                          // fold square occupies — so the column reads as one affordance
                          // and the master checkbox lines up with the rows' checkboxes.
                          jsx('span', {
                            role: 'button',
                            tabIndex: 0,
                            'aria-label': anyBranchOpen ? i18n.collapseAll : i18n.expandAll,
                            title: anyBranchOpen ? i18n.collapseAll : i18n.expandAll,
                            className: cn(
                              'shrink-0 inline-flex items-center justify-center cursor-pointer select-none',
                              'text-[10px] leading-none font-semibold',
                              'text-(--ui-text-tertiary) hover:text-(--ui-text-primary)'
                            ),
                            style: {
                              width: '13px', height: '13px',
                              border: '1px solid var(--ui-stroke-secondary)',
                              borderRadius: '3px',
                              backgroundColor: 'var(--ui-bg-tertiary, transparent)'
                            },
                            onClick: handleToggleAll,
                            children: anyBranchOpen ? '−' : '+'
                          }),
                          jsx('input', {
                            type: 'checkbox',
                            checked: Boolean((derived?.rows?.length || 0) > 0 && selectedIds.size === derived.rows.length),
                            ref: el => {
                              if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < (derived?.rows?.length || 0)
                            },
                            onChange: e => {
                              if (e.target.checked) {
                                setSelectedIds(new Set((derived?.rows || []).map(r => r.task.id)))
                              } else {
                                setSelectedIds(new Set())
                              }
                            },
                            className: 'rounded cursor-pointer',
                            'aria-label': i18n.selectAll
                          }),
                          jsx('span', { className: 'text-[10px] text-(--ui-text-tertiary) uppercase font-medium select-none', children: i18n.tasksColumn }),
                          listMode ? null : jsx(ResizeHandle, {
                            get: () => $labelW.get(),
                            set: w => $labelW.set(w),
                            min: LABEL_W_MIN,
                            max: LABEL_W_MAX,
                            resetTo: LABEL_W,
                            storageKey: 'labelW'
                          })
                        ]
                      }),
                      ...(listMode
                        ? [
                            ...[i18n.assigneeColumn, i18n.statusColumn, i18n.lastActivityColumn].map((h, i) => jsx('div', {
                              key: h,
                              className: cn('flex items-center px-2 border-b border-(--ui-stroke-tertiary) text-[10px] text-(--ui-text-tertiary) uppercase font-medium select-none', i === 2 && 'justify-end'),
                              style: { height: '24px' },
                              children: h
                            })),
                            // The attachment column is as narrow as a paperclip, so its header
                            // is the icon rather than a word that would never fit.
                            jsx('div', {
                              key: 'attachments-header',
                              className: 'flex items-center justify-end border-b border-(--ui-stroke-tertiary) pr-2 text-(--ui-text-tertiary)',
                              style: { height: '24px' },
                              // The column is as narrow as a paperclip, so its header is the
                              // icon rather than a word that would never fit.
                              children: jsx(Codicon, { name: 'attach', size: '0.7rem' })
                            })
                          ]
                        : [jsx(Ruler, { key: 'ruler', min: domain.min, max: domain.max, pxPerSec, onReset: resetView })])
                    ]
                  }),
                  jsxs('div', {
                    className: cn('relative flex flex-col', listMode ? 'w-full' : 'w-max'),
                    children: [
                      listMode ? null : jsx('div', {
                        className: 'absolute top-0 bottom-0 pointer-events-none z-0',
                        style: { left: `${labelW}px`, width: `${timelineW}px` },
                        children: [
                          jsx(WeekendBands, { min: domain.min, max: domain.max, pxPerSec }),
                          jsx(HourLines, { min: domain.min, max: domain.max, pxPerSec })
                        ]
                      }),
                      listMode ? null : jsx(NowLine, {
                        now, min: domain.min, max: domain.max, pxPerSec, originX: labelW
                      }),
                      grid
                    ]
                  })
                ]
              })
            ]
          }),

      // The legend describes BAR TONES, so it has nothing to say about a board with no
      // rows — and an empty state reads better with only its message and the creation verb.
      derived && rows.length > 0
        ? jsx('div', {
            children: jsx(Legend, { disabledStatuses, onToggleStatus: handleToggleStatus })
          })
        : null
        ]
      }),

      // An attachment opened from a row's paperclip: its own dialog, like the detail's.
      openAttachment
        ? jsx(AttachmentPreview, {
            taskId: openAttachment.taskId,
            board: openAttachment.board,
            att: openAttachment.att,
            siblings: openAttachment.siblings || [openAttachment.att],
            onNavigate: att => $openAttachment.set({ ...openAttachment, att }),
            i18n,
            onClose: () => $openAttachment.set(null)
          })
        : null,

      openTaskId
        ? jsx(TaskDrawer, {
            taskId: openTaskId,
            board,
            assignees: assigneeChoices,
            // Unfiltered snapshot: a parent hidden by the current filter must
            // still be listed in the drawer's relations.
            tasks: data?.tasks || [],
            // Every known board — the cross-board move dialog filters out the
            // current one itself.
            boards: boardsData?.boards || [],
            onClose: () => $openTaskId.set(null),
            docked: dockDrawer,
            onToggleDock: () => {
              const next = !drawerDocked
              $drawerDocked.set(next)
              if (getStorage()) getStorage().set('drawerDocked', next ? '1' : '0')
            }
          })
        : null,
      // Creation dialog (toolbar button, or "create a sub-task" from a task).
      jsx(NewTaskDialog, {
        open: Boolean(newTask),
        boardSlug: board && board !== 'all' && board !== '*' ? board : undefined,
        assignees: assigneeChoices,
        tasks: (data && data.tasks) || [],
        projects: (projectsData && projectsData.projects) || [],
        defaultParentId: newTask ? newTask.parentId : '',
        busy: createTaskMutation.isPending,
        onSubmit: values => createTaskMutation.mutate(values),
        onClose: () => $newTask.set(null),
        i18n
      }),
      // Asked only when the dropped task already has parents: add vs replace.
      jsx(ReparentChoiceDialog, {
        open: Boolean(pendingReparent),
        targetTitle: (() => {
          if (!pendingReparent) return ''
          const target = allTasks.find(t => t.id === pendingReparent.parentId)
          return target ? target.title : pendingReparent.parentId
        })(),
        parents: pendingReparent ? relationsOf(allTasks, pendingReparent.childId).parents : [],
        busy: reparentMutation.isPending || unlinkMutation.isPending,
        onAdd: () => reparentMutation.mutate({ ...pendingReparent, mode: 'add' }),
        onReplace: () => reparentMutation.mutate({ ...pendingReparent, mode: 'replace' }),
        onRemoveParent: parentId => unlinkMutation.mutate({ childId: pendingReparent.childId, parentId }),
        onClose: () => setPendingReparent(null),
        i18n
      }),
      // "Move under…" picker (drawer action menu): the whole board, refusals
      // greyed with their reason rather than hidden.
      jsx(MoveUnderDialog, {
        open: Boolean(moveUnderId),
        draggedTitle: (() => {
          const task = moveUnderId ? allTasks.find(t => t.id === moveUnderId) : null
          return task ? task.title : (moveUnderId || '')
        })(),
        candidates: moveUnderId ? dropCandidates(allTasks, moveUnderId, boardOf(moveUnderId)) : [],
        busy: reparentMutation.isPending,
        onPick: handlePickParent,
        onClose: () => $moveUnderId.set(null),
        i18n
      })
    ]
  })
}

const plugin = {
  id: ID,
  name: 'Kanban Gantt',
  // Read by the host from the module itself (contrib/plugins.ts), before
  // `register` runs and before any locale bundle exists — so this descriptor
  // cannot follow the app locale: it stays in the bundles' fallback language.
  description: 'Gantt view (progress over time) of the kanban board — search, zoom, task detail + actions.',
  register(ctx) {
    setPluginDoors(ctx.rest, ctx.storage, ctx.socket)
    $baseUrl.set((ctx.storage.get('baseUrl', '') || '').replace(/\/+$/, ''))
    $boardSlug.set(readStoredBoard(ctx.storage))
    // Bind the connection scope, and follow it: a gateway switch (or the backend
    // restarting in place) must re-read this connection's remembered board and
    // make the push client re-subscribe, rather than keeping the previous
    // backend's board and a socket to a dead port.
    $connectionScope.set(connectionScope())
    try {
      const conn = host && host.state && host.state.connectionId
      if (conn && typeof conn.listen === 'function' && typeof ctx.onDispose === 'function') {
        ctx.onDispose(conn.listen(() => {
          $connectionScope.set(connectionScope())
          $boardSlug.set(readStoredBoard(ctx.storage))
        }))
      }
    } catch {
      /* no host.state (standalone server): one scope for the life of the page */
    }
    // Push is the page's update path (Refresh only shows while it is off or
    // dead), so the client asks for it unless the user opted out with storage
    // `ws` = '0'. The gateway
    // exposes /events unless it was started with KANBAN_GANTT_WS=0; the poll
    // below stays as the safety net for either case, and for a dead socket.
    //
    // Accept every spelling of "off" and nothing else as off: storage values
    // round-trip through JSON, so a hand-written '1' comes back as the number 1
    // and a strict `=== '1'` silently disabled the push (found live, through the
    // persisted wsOff state below).
    const wsFlag = ctx.storage.get('ws', '1')
    $wsEnabled.set(!(wsFlag === '0' || wsFlag === 0 || wsFlag === false || wsFlag === 'false'))
    $labelW.set(Number(ctx.storage.get('labelW', LABEL_W)) || LABEL_W)
    $drawerW.set(Number(ctx.storage.get('drawerW', 416)) || 416)
    $drawerDocked.set(ctx.storage.get('drawerDocked', '0') === '1')

    if (ctx.i18n && typeof ctx.i18n.register === 'function') {
      ctx.i18n.register(GANTT_LOCALES)
    }

    // Registration-time copy (palette entry, pane title) is read once, before
    // React exists — the SDK's `ctx.i18n.t` is the module-level translator for
    // exactly those places.
    const tNow = key =>
      ctx.i18n && typeof ctx.i18n.t === 'function' ? ctx.i18n.t(key) : GANTT_LOCALES.en[key]

    // Inject the machine-activity arc CSS (same visual vocabulary as the
    // official kanban plugin's kanban-arc) once per page load.
    if (!document.getElementById('kg-handle-style')) {
      const handleStyle = document.createElement('style')
      handleStyle.id = 'kg-handle-style'
      // The desktop's stylesheet is PRECOMPILED: it only carries the utilities the
      // app itself uses, so an arbitrary class here (the old
      // `hover:bg-(--ui-accent)/30`) silently paints nothing. The shell draws its
      // resizers with a plain inline style / own CSS instead, so this plugin does
      // the same — a 4px rounded pill inside the 10px hit strip, lit on hover and
      // kept lit while dragging.
      handleStyle.textContent = `
.kg-resize-handle { display: flex; align-items: stretch; justify-content: center; }
/* Same two layers the shell's own sash draws (measured on the left panel's
   resizer): a 1px line in --ui-stroke-secondary sitting at 10% opacity at rest,
   and a 4px bar in --ui-sash-hover-border — the dedicated sash token, which
   already carries its own alpha — revealed on hover. Both tokens are theme
   values, so the affordance follows the active theme instead of a hard colour. */
.kg-resize-rest, .kg-resize-pill {
  position: absolute; inset-block: 0; left: 50%; transform: translateX(-50%);
  border-radius: 9999px; transition: opacity 120ms ease;
}
.kg-resize-rest { width: 1px; background: var(--ui-stroke-secondary); opacity: 0.1; }
/* Geometry comes from the same variable the shell's own sash reads
   (w-(--vscode-sash-hover-size,0.25rem) on its hover layer), so a style that
   resizes its separators resizes ours too instead of leaving 4px hard-coded. The
   colour chain ends on the app's accent so a renamed token degrades to a visible
   bar rather than to nothing (the plugin has already been bitten once by the
   --ui-background to --ui-base rename). */
.kg-resize-pill {
  width: var(--vscode-sash-hover-size, 0.25rem);
  background: var(--ui-sash-hover-border, var(--ui-accent, var(--accent)));
  opacity: 0;
}
.kg-resize-handle:hover .kg-resize-rest,
.kg-resize-handle:focus-visible .kg-resize-rest,
.kg-resize-handle[data-dragging='true'] .kg-resize-rest { opacity: 1; }
.kg-resize-handle:hover .kg-resize-pill,
.kg-resize-handle:focus-visible .kg-resize-pill,
.kg-resize-handle[data-dragging='true'] .kg-resize-pill { opacity: 1; }
`
      document.head.appendChild(handleStyle)
    }
    if (!document.getElementById('kg-arc-style')) {
      const style = document.createElement('style')
      style.id = 'kg-arc-style'
      style.textContent = `
@property --kg-arc-angle { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
.kg-arc {
  pointer-events: none; position: absolute; inset: -2px; border-radius: 4px;
  padding: 1.5px;
  background: conic-gradient(from var(--kg-arc-angle), transparent 0deg,
    var(--kanban-tone, var(--ui-stroke-primary)) 55deg, transparent 110deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  animation: kg-arc-spin 2.2s linear infinite;
}
@keyframes kg-arc-spin { to { --kg-arc-angle: 360deg; } }
/* Readability: ticket bodies, results, summaries and comments render agent
   Markdown is rendered by the SDK's MessageTextContent — the same renderer chat and
   the official kanban plugin use — so descriptions, run summaries and comments inherit
   the app's own markdown typography instead of a hand-written one. The kg-prose colour
   mapping that used to live here went with it: it existed only to make Tailwind
   Typography readable on the app's surfaces, and the SMALL typography variant
   (prose-sm) is not in the desktop's precompiled stylesheet at all — measured, 0
   occurrences — so the base variant's heading ratios applied and titles rendered far
   too large for an 11px body. */
`
      document.head.appendChild(style)
    }

    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/kanban-gantt' },
        render: () => jsx(KanbanGanttRoute, {})
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        order: 70,
        data: { codicon: 'calendar', label: 'Kanban Gantt', path: '/kanban-gantt' }
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'kanbanGantt.open',
          label: tNow('openCommand'),
          keywords: ['kanban', 'gantt', 'timeline'],
          run: () => host.navigate('/kanban-gantt')
        }
      }
    ])
  }
}

export default plugin