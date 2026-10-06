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
  Streamdown,
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
  $baseUrl, $boardSlug, $labelW, $drawerW, $drawerDocked, $openTaskId,
  $newTask, $moveUnderId, $wsEnabled, $connectionScope,
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
const ZOOM_MIN = 0.2
const ZOOM_MAX = 1.8
const ZOOM_STEP = 0.05

/* ────────────────────── GANTT-CORE (pure logic, Node-tested) ────────────────
   Evaluated here via new Function(); tests/gantt-core.test.mjs extracts this
   same string from the file source and runs it under node:test. The body is
   plain JS (no imports/exports needed). */


import { barRange, taskBars, shortId, matchesSearch, buildRows, treeRows, computeDomain, ticks, tickUnit, statusTone, statusIcon, relationsOf, dropCandidates, resolveBoardSlug, isMissingBoardError, DAY, MIN_BAR } from './core/gantt-core.ts'


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

function Ruler({ min, max, pxPerSec }) {
  const unit = tickUnit(max - min)
  const tickValues = ticks(min, max, unit)
  const dayWidth = pxPerSec * DAY
  const showWeekday = unit === 'day' && dayWidth >= 50

  return jsxs('div', {
    className: 'relative border-b border-(--ui-stroke-secondary) select-none text-[10px]',
    style: { height: showWeekday ? '32px' : '24px' },
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

function cleanTitle(title, label) {
  if (!title) return '(sans titre)'
  // Strip leading [TAG] prefix if present (whether matching label or not)
  let t = title.trim()
  if (t.startsWith('[')) {
    const idx = t.indexOf(']')
    if (idx > 0) {
      t = t.slice(idx + 1).trim()
    }
  }
  return t || title
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

function TaskRow({ task, depth, isChild, now, pxPerSec, min, timelineW, onOpen, isSelected, isChecked, onToggleCheck, isEven, showBoardBadge, dragState, onDragStartTask, onDragEndTask, onDropOn, hasChildren, collapsed, secondary, secondaryOnly, continuation = [], lastSibling, hiddenCount = 0, matched, descendantOfSelected, onToggleFold }) {
  const i18n = useGanttI18n()
  const labelW = useValue($labelW)
  const bars = taskBars(task, now)
  const label = task.label ? `[${task.label}]` : ''
  const name = cleanTitle(task.title, task.label)

  // Explorer connectors, in front of the checkbox and left of the fold square.
  // Geometry: the label cell pads by `depth * 12 + 8`, so level `d` owns the
  // slot [d*12, d*12+8] and the square starts at d*12+8 — the elbow's horizontal
  // segment stops exactly there.
  const INDENT = 12
  const line = 'var(--ui-stroke-secondary)'
  const connectors = []
  for (let level = 0; level < continuation.length; level++) {
    if (!continuation[level]) continue      // that ancestor is the last of its group
    connectors.push(jsx('span', {
      key: `lv${level}`,
      className: 'absolute',
      style: { left: `${level * INDENT + 5}px`, top: 0, width: '1px', height: '100%',
               backgroundColor: line, opacity: 0.65 }
    }))
  }
  if (isChild) {
    // The vertical of this row's own elbow: full height when a sibling follows,
    // top-half only when this is the last one (the classic `├` / `└`).
    connectors.push(jsx('span', {
      key: 'elbow-v',
      className: 'absolute pointer-events-none',
      style: { left: `${depth * INDENT + 5}px`, top: 0, width: '1px',
               height: lastSibling ? '50%' : '100%', backgroundColor: line, opacity: 0.65 }
    }))
    connectors.push(jsx('span', {
      key: 'elbow-h',
      className: 'absolute pointer-events-none',
      style: { left: `${depth * INDENT + 5}px`, top: '50%', width: '3px', height: '1px',
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
    style: { gridTemplateColumns: `${labelW}px ${timelineW}px`, height: `${ROW_H}px` },
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
          paddingLeft: `${depth * 12 + 8}px`,
          paddingRight: '8px',
          width: `${labelW}px`,
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
              name
            ]
          })
        ]
      }),
      jsxs('div', {
        className: 'relative overflow-hidden',
        style: { height: `${ROW_H}px` },
        children: bars.length > 0
          ? bars.map((b, idx) => jsx(Bar, { key: b.runId || idx, task, bar: b, pxPerSec, min, onOpen }))
          : [jsx('div', { key: 'empty', className: 'text-(--ui-text-quaternary) text-[10px]', children: '—' })]
      })
    ]
  })
}

function ProfileAvatar({ name, size = '1rem' }) {
  const color = profileColor(name)
  const initials = (() => {
    const parts = (name || '?').split(/[\s_\-./]+/).filter(Boolean)
    return `${parts[0]?.[0] ?? '?'}${parts[1]?.[0] ?? ''}`.toUpperCase()
  })()
  return jsx('span', {
    className: 'grid shrink-0 place-items-center rounded-full font-semibold select-none text-[8px]',
    style: {
      backgroundColor: color ? profileColorSoft(color, 22) : 'var(--ui-bg-quaternary, rgba(150,150,150,0.15))',
      color: color ?? 'var(--ui-text-secondary)',
      height: size,
      width: size
    },
    title: name,
    children: initials
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
  onToggleArchived
}) {
  const i18n = useGanttI18n()
  const active = selectedAssignees.size > 0 || disabledStatuses.size > 0 || showArchived
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
  blocked:   { tone: '#f87171', label: 'Blocked' },
  review:    { tone: '#fbbf24', label: 'Review' },
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

function TaskDrawer({ taskId, board, onClose, assignees = [], tasks = [], docked = false, onToggleDock, boards = [] }) {
  const drawerW = useValue($drawerW)
  const i18n = useGanttI18n()
  const queryClient = useQueryClient()
  const scrollContainerRef = useRef(null)
  const prevTaskIdRef = useRef(null)

  // Cross-board move: the dialog owns the confirmations; the mutation runs
  // here so the success toast + invalidation live next to the other writes.
  const [moveBoardOpen, setMoveBoardOpen] = useState(false)
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
  const [runsOpen, setRunsOpen] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(true)
  const [showAllComments, setShowAllComments] = useState(false)
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

  return jsxs('div', {
    className: docked
      ? 'relative flex flex-col h-full min-h-0 border-l border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) pt-3.5 px-4'
      : 'absolute inset-y-0 right-0 z-50 max-w-full border-l border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) shadow-xl flex flex-col pt-3.5 px-4',
    'data-glass-opaque': true,
    role: 'dialog',
    'aria-label': i18n.taskDetail,
    style: { width: `${drawerW}px` },
    children: [
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
                jsx(Button, { size: 'icon-xs', variant: 'ghost', onClick: onToggleDock, 'aria-label': docked ? i18n.undockDrawer : i18n.dockDrawer, title: docked ? i18n.undockDrawer : i18n.dockDrawer, children: docked ? '»' : '«' }),
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

          // Title kept always visible
          jsx('div', { className: 'text-base font-semibold leading-snug', children: cleanTitle(data?.task?.title, data?.task?.label) })
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
              jsx(TaskRelations, {
                heading: i18n.parents,
                tasks: relations.parents,
                emptyLabel: relations.parents.length === 0 ? i18n.noParents : undefined,
                onOpen: id => $openTaskId.set(id),
                onRemove: id => {
                  const parent = relations.parents.find(t => t.id === id)
                  setPendingUnlink({ id, title: parent ? parent.title : id })
                },
                removeLabel: i18n.removeParentLink,
                openLabel: i18n.openTask,
                disabled: unlinkMutation.isPending
              }),
              jsx(TaskRelations, {
                heading: i18n.children,
                tasks: relations.children,
                emptyLabel: relations.children.length === 0 ? i18n.noChildren : undefined,
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
                        className: 'text-[11px] prose prose-sm kg-prose max-w-none border border-(--ui-stroke-tertiary) rounded p-2 bg-(--ui-bg-subtle, transparent)',
                        children: jsx(Streamdown, { children: data.task.body })
                      })
                    : jsx('p', { className: 'text-[11px] text-(--ui-text-quaternary)', children: i18n.noDescription })
              ] }),

              // 2. Result (no max-h clamp)
              data?.task?.result
                ? jsxs('div', { className: 'flex flex-col gap-1', children: [
                    jsx('div', { className: 'text-[10px] uppercase font-semibold text-(--ui-text-tertiary)', children: i18n.result }),
                    jsx('div', {
                      className: 'text-[11px] prose prose-sm kg-prose max-w-none border border-(--ui-stroke-tertiary) rounded p-2 bg-(--ui-bg-subtle, transparent)',
                      children: jsx(Streamdown, { children: data.task.result })
                    })
                  ] })
                : null,

              // 3. Latest summary (highlighted when blocked or done/completed)
              data?.task?.latest_summary
                ? jsxs('div', { className: 'flex flex-col gap-1', children: [
                    jsx('div', { className: 'text-[10px] uppercase font-semibold text-(--ui-text-tertiary)', children: i18n.latestSummary }),
                    jsx('div', {
                      className: cn(
                        'text-[11px] prose prose-sm kg-prose max-w-none rounded p-2.5 transition-colors',
                        data?.task?.status === 'blocked'
                          ? 'border border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
                          : data?.task?.status === 'done' || data?.task?.status === 'archived'
                            ? 'border border-emerald-500/35 bg-emerald-500/10'
                            : 'border border-(--ui-stroke-tertiary) bg-(--ui-bg-subtle, transparent)'
                      ),
                      children: jsx(Streamdown, { children: data.task.latest_summary })
                    })
                  ] })
                : null,

              // 4. Run history (Collapsible section, collapsed by default, no internal scrollbar)
              (data?.task?.runs || []).length
                ? jsxs('div', { className: 'border-t border-(--ui-stroke-tertiary) pt-2 flex flex-col gap-1.5', children: [
                    jsxs('button', {
                      type: 'button',
                      className: 'flex items-center justify-between w-full text-left py-1 px-1 -mx-1 rounded hover:bg-(--chrome-action-hover) cursor-pointer border-0 bg-transparent text-(--ui-text-primary)',
                      onClick: () => setRunsOpen(o => !o),
                      children: [
                        jsxs('div', { className: 'flex items-center gap-1.5', children: [
                          jsx('span', { className: 'text-[10px] text-(--ui-text-tertiary) select-none', children: runsOpen ? '▼' : '▶' }),
                          jsx('span', { className: 'text-[10px] uppercase font-semibold text-(--ui-text-tertiary)', children: i18n.runs(data.task.runs.length) })
                        ] }),
                        jsx('span', { className: 'text-[10px] text-(--ui-text-quaternary)', children: runsOpen ? i18n.hide : i18n.show })
                      ]
                    }),
                    runsOpen ? jsx('div', { className: 'flex flex-col gap-2 pt-1', children: data.task.runs.map((r, i) => {
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
                            ? jsx('div', { className: 'prose prose-sm kg-prose max-w-none text-[11px] mt-1 pt-1 border-t border-(--ui-stroke-tertiary)/50', children: jsx(Streamdown, { children: r.summary }) })
                            : null
                        ]
                      })
                    }) }) : null
                  ] })
                : null,

              // 5. Commentaires (Collapsible section, open by default, 3 latest by default with button to show previous, no internal scrollbar)
              (() => {
                const commentsList = data?.task?.comments || []
                const totalComments = commentsList.length
                const visibleComments = showAllComments ? commentsList : commentsList.slice(-3)
                const hiddenCount = totalComments - visibleComments.length

                return jsxs('div', { className: 'border-t border-(--ui-stroke-tertiary) pt-2 flex flex-col gap-1.5', children: [
                  jsxs('button', {
                    type: 'button',
                    className: 'flex items-center justify-between w-full text-left py-1 px-1 -mx-1 rounded hover:bg-(--chrome-action-hover) cursor-pointer border-0 bg-transparent text-(--ui-text-primary)',
                    onClick: () => {
                      setCommentsOpen(o => {
                        if (o) setShowAllComments(false) // reset when collapsing
                        return !o
                      })
                    },
                    children: [
                      jsxs('div', { className: 'flex items-center gap-1.5', children: [
                        jsx('span', { className: 'text-[10px] text-(--ui-text-tertiary) select-none', children: commentsOpen ? '▼' : '▶' }),
                        jsx('span', { className: 'text-[10px] uppercase font-semibold text-(--ui-text-tertiary)', children: i18n.comments(totalComments) })
                      ] }),
                      jsx('span', { className: 'text-[10px] text-(--ui-text-quaternary)', children: commentsOpen ? i18n.hide : i18n.show })
                    ]
                  }),
                  commentsOpen ? jsxs('div', { className: 'flex flex-col gap-1.5 pt-1', children: [
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
                          jsx('div', { className: 'prose prose-sm kg-prose max-w-none text-[11px]', children: jsx(Streamdown, { children: c.body || '' }) })
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
                  ] }) : null
                ] })
              })(),

              // 6. Activité (Derniers événements)
              (data?.task?.events || []).length
                ? jsxs('div', { className: 'border-t border-(--ui-stroke-tertiary) pt-2 flex flex-col gap-1', children: [
                    jsx('div', { className: 'text-[10px] uppercase font-semibold text-(--ui-text-tertiary)', children: i18n.activity(data.task.events.length) }),
                    jsx('div', { className: 'flex flex-col gap-0.5 max-h-32 overflow-auto', children: data.task.events.slice(-12).reverse().map((e, i) => jsx('div', {
                      key: i,
                      className: 'text-[10px] text-(--ui-text-tertiary)',
                      children: String(e.kind || 'event')
                    }, i)) })
                  ] })
                : null
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
      })
    ]
  })
}

/* ───────────────────────────────────── page ───────────────────────────────── */

export function KanbanGanttPage() {
  const i18n = useGanttI18n()
  const queryClient = useQueryClient()
  const base = useValue($baseUrl)
  const board = useValue($boardSlug)
  const scope = useValue($connectionScope)
  const openTaskId = useValue($openTaskId)
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
  const [zoom, setZoom] = useState(() => {
    const saved = getStorage() ? getStorage().get('zoom', null) : null
    return saved != null && Number.isFinite(Number(saved)) ? Number(saved) : 1
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

  const derived = useMemo(() => {
    if (!data || !data.tasks) return null
    let visible = data.tasks
    if (!showArchived) visible = visible.filter(t => !t.archived)
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
  }, [data, showArchived, disabledStatuses, selectedAssignees, search, fold, openTaskId])

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
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedIds, derived])

  const bulkMutation = useMutation({
    mutationFn: ({ action, ids }) =>
      apiFetch(`/tasks/bulk${board ? `?board=${encodeURIComponent(board)}` : ''}`, {
        method: 'POST',
        body: { ids, action }
      }),
    onSuccess: () => {
      setSelectedIds(new Set())
      setBulkAssignee('')
      void queryClient.invalidateQueries({ queryKey: ['kanban-gantt'] })
    }
  })

  const handleZoomChange = val => {
    setZoom(val)
    if (getStorage()) getStorage().set('zoom', val)
  }

  const setBoard = slug => {
    $boardSlug.set(slug)
    if (getStorage()) getStorage().set(boardStorageKey(), slug)
    setSearch('')
    void queryClient.invalidateQueries({ queryKey: ['kanban-gantt', 'gantt'] })
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

  if (isLoading && !data) {
    return jsx('div', { className: 'flex h-full items-center justify-center p-8', children: jsx(Loader, {}) })
  }
  if (isError) {
    // Name the real cause. A board this gateway does not have is not a dead
    // backend, and "plugin enabled? gateway restarted?" sent people restarting
    // healthy gateways.
    const gone = isMissingBoardError(error)
    return jsx('div', { className: 'p-6', children: jsx(ErrorState, {
      title: gone ? i18n.boardMissingTitle : i18n.cannotLoadBoard,
      description: gone
        ? i18n.boardMissingDesc(board || boardLabel(board), boardsData?.current || '')
        : i18n.cannotLoadBoardDesc(base)
    }) })
  }
  if (!derived || !derived.domain) {
    return jsx('div', { className: 'p-6', children: jsx(EmptyState, { title: i18n.emptyBoard, description: i18n.emptyBoardDesc(boardLabel(board)) }) })
  }

  // R6: with pushes driving the data there is no poll left to re-render the
  // timeline, so `nowTick` (30 s while the socket is live) is read here — that
  // read is the whole point, it keeps the "now" cursor and open run arcs moving.
  void nowTick
  const now = Date.now() / 1000
  const { rows, domain } = derived
  const visibleWidth = Math.max(trackW - labelW - 24, 300)
  // At zoom = 1 (100%), exactly 1 week (7 days) fills the visible timeline width
  const baseDayWidth = visibleWidth / 7
  const basePerSec = baseDayWidth / DAY
  const pxPerSec = basePerSec * zoom
  const timelineW = Math.max(1, Math.ceil((domain.max - domain.min) * pxPerSec))

  const grid = rows.map((row, idx) => jsx(TaskRow, {
    ...row,
    now,
    pxPerSec,
    min: domain.min,
    timelineW,
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
  }, row.task.id))

  // Determine dominant status priority for the top task count badge:
  // blocked > running > review > ready > scheduled > todo > triage > done > archived
  const STATUS_PRIORITY = ['blocked', 'running', 'review', 'ready', 'scheduled', 'todo', 'triage', 'done', 'archived']
  const blockedCount = derived.tasks.filter(t => t.status === 'blocked').length
  const dominantStatus = (() => {
    const present = new Set(derived.tasks.map(t => t.status))
    for (const s of STATUS_PRIORITY) {
      if (present.has(s)) return s
    }
    return 'todo'
  })()
  const dominantTone = statusTone(dominantStatus)

  const dockDrawer = Boolean(openTaskId && drawerDocked)

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
              // The tree's global toggle, right at the head of the column (before
              // the first task): collapse everything the user can collapse, or
              // open everything, in one click.
              jsx('span', {
                role: 'button',
                tabIndex: 0,
                'aria-label': anyBranchOpen ? i18n.collapseAll : i18n.expandAll,
                title: anyBranchOpen ? i18n.collapseAll : i18n.expandAll,
                className: 'inline-flex items-center justify-center cursor-pointer select-none text-[10px] leading-none font-semibold text-(--ui-text-tertiary) hover:text-(--ui-text-primary) mr-1',
                style: {
                  width: '14px', height: '14px',
                  border: '1px solid var(--ui-stroke-secondary)',
                  borderRadius: '3px',
                  backgroundColor: 'var(--ui-bg-tertiary, transparent)'
                },
                onClick: handleToggleAll,
                children: anyBranchOpen ? '−' : '+'
              }),
              jsx('span', { className: 'font-semibold', children: i18n.title }),
              jsx('span', {
                className: 'inline-flex items-center justify-center rounded-full px-2 py-0.2 text-[10.5px] font-semibold tracking-tight shadow-xs cursor-help',
                title: i18n.nTasksTotal(derived.total, dominantStatus),
                style: {
                  backgroundColor: `color-mix(in srgb, ${dominantTone} 18%, transparent)`,
                  borderColor: `color-mix(in srgb, ${dominantTone} 40%, transparent)`,
                  borderWidth: '1px',
                  color: dominantTone
                },
                children: `${derived.total}`
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
                assignees: derived.allAssignees || [],
                selectedAssignees,
                onToggleAssignee: handleToggleAssignee,
                onClearAssignees: handleClearAssignees,
                disabledStatuses,
                onToggleStatus: handleToggleStatus,
                showArchived,
                onToggleArchived: setShowArchived
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
              jsxs('span', { className: 'inline-flex items-center gap-1.5', children: [
                jsx('input', {
                  type: 'range',
                  min: String(ZOOM_MIN),
                  max: String(ZOOM_MAX),
                  step: String(ZOOM_STEP),
                  value: String(zoom),
                  onInput: event => handleZoomChange(Number(event.target.value)),
                  className: 'w-24',
                  'aria-label': i18n.zoomTimeline
                }),
                jsx('span', { className: 'text-[10px] tabular-nums text-(--ui-text-tertiary) w-8 text-right shrink-0', children: `${Math.round(zoom * 100)}%` })
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
              })
            ]
          })
        ]
      }),

      rows.length === 0
        ? jsx('div', {
            className: 'py-10',
            children: jsx(EmptyState, { title: i18n.nothingToDisplay, description: i18n.noTasksMatch })
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
                assignees: derived.allAssignees || [],
                busy: bulkMutation.isPending
              }),
              jsxs('div', {
                ref: scrollerRef,
                className: 'overflow-auto flex-1 min-h-0 relative',
                children: [
                  jsxs('div', {
                    className: 'grid w-max sticky top-0 z-20 bg-(--ui-bg-chrome)',
                    'data-glass-opaque': true,
                    style: { gridTemplateColumns: `${labelW}px ${timelineW}px` },
                    children: [
                      jsxs('div', {
                        className: 'sticky left-0 z-30 bg-(--ui-bg-chrome) border-r border-b border-(--ui-stroke-tertiary) flex items-center px-2 gap-1.5',
                        'data-glass-opaque': true,
                        style: { height: pxPerSec * DAY >= 50 && tickUnit(domain.max - domain.min) === 'day' ? '32px' : '24px' },
                        children: [
                          jsx('input', {
                            type: 'checkbox',
                            checked: Boolean(derived.rows.length > 0 && selectedIds.size === derived.rows.length),
                            ref: el => {
                              if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < derived.rows.length
                            },
                            onChange: e => {
                              if (e.target.checked) {
                                setSelectedIds(new Set(derived.rows.map(r => r.task.id)))
                              } else {
                                setSelectedIds(new Set())
                              }
                            },
                            className: 'rounded cursor-pointer',
                            'aria-label': i18n.selectAll
                          }),
                          jsx('span', { className: 'text-[10px] text-(--ui-text-tertiary) uppercase font-medium select-none', children: i18n.tasksColumn }),
                          jsx(ResizeHandle, {
                            get: () => $labelW.get(),
                            set: w => $labelW.set(w),
                            min: LABEL_W_MIN,
                            max: LABEL_W_MAX,
                            resetTo: LABEL_W,
                            storageKey: 'labelW'
                          })
                        ]
                      }),
                      jsx(Ruler, { min: domain.min, max: domain.max, pxPerSec })
                    ]
                  }),
                  jsxs('div', {
                    className: 'relative flex flex-col w-max',
                    children: [
                      jsx('div', {
                        className: 'absolute top-0 bottom-0 pointer-events-none z-0',
                        style: { left: `${labelW}px`, width: `${timelineW}px` },
                        children: jsx(WeekendBands, { min: domain.min, max: domain.max, pxPerSec })
                      }),
                      grid
                    ]
                  })
                ]
              })
            ]
          }),

      jsx('div', {
        children: jsx(Legend, { disabledStatuses, onToggleStatus: handleToggleStatus })
      })
        ]
      }),

      openTaskId
        ? jsx(TaskDrawer, {
            taskId: openTaskId,
            board,
            assignees: derived.allAssignees || [],
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
        assignees: (() => {
          const fromBoard = (derived && derived.allAssignees) || []
          const fromProfiles = (profilesData && profilesData.profiles) || []
          return Array.from(new Set([...fromProfiles, ...fromBoard])).sort()
        })(),
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
   markdown through Streamdown into Tailwind typography containers (prose),
   whose palette defaults to light-background ink (#374151) and is illegible
   on the app's dark surfaces. Typography reads every colour from a
   --tw-prose-* custom property, so map those onto the app's own theme tokens
   (which flip with :root.dark) instead of pinning literals: one block that is
   readable in BOTH themes, scoped to .kg-prose so drawer chrome, cards and
   controls are untouched. */
.kg-prose {
  --tw-prose-body: var(--ui-text-primary);
  --tw-prose-headings: var(--ui-text-primary);
  --tw-prose-lead: var(--ui-text-secondary);
  --tw-prose-links: var(--ui-accent);
  --tw-prose-bold: var(--ui-text-primary);
  --tw-prose-counters: var(--ui-text-secondary);
  --tw-prose-bullets: var(--ui-text-tertiary);
  --tw-prose-hr: var(--ui-stroke-tertiary);
  --tw-prose-quotes: var(--ui-text-primary);
  --tw-prose-quote-borders: var(--ui-stroke-tertiary);
  --tw-prose-captions: var(--ui-text-tertiary);
  --tw-prose-code: var(--ui-text-primary);
  --tw-prose-pre-code: var(--ui-text-primary);
  --tw-prose-pre-bg: var(--ui-bg-tertiary);
  --tw-prose-th-borders: var(--ui-stroke-secondary);
  --tw-prose-td-borders: var(--ui-stroke-tertiary);
  color: var(--tw-prose-body);
}
/* Typography paints code/pre from its own dark palette; keep them on the app's
   surfaces. Link decoration and list indent are the two typography choices
   worth keeping explicit at this size. */
.kg-prose :where(code) { background: var(--ui-bg-tertiary); padding: .08em .32em; border-radius: 3px; }
.kg-prose :where(pre) { background: var(--ui-bg-tertiary); padding: .5em .6em; border-radius: 4px; }
.kg-prose :where(pre code) { background: transparent; padding: 0; }
.kg-prose a { text-decoration: underline; }
.kg-prose :where(ul, ol) { padding-left: 1.1em; }
`
      document.head.appendChild(style)
    }

    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/kanban-gantt' },
        render: () => jsx(KanbanGanttPage, {})
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