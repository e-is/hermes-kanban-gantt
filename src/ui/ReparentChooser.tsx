import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input
} from '@hermes/plugin-sdk'

import { matchesSearch } from '../core/gantt-core.ts'
import { TaskRelations } from './TaskRelations'
import type { GanttI18n, RelationTask } from './TaskRelations'

export type Candidate = {
  task: RelationTask & { label?: string | null }
  allowed: boolean
  reason: string | null
}

/**
 * "This task already has N parents" — asked at the moment of a drop, so the
 * user chooses between adding a parent and replacing the existing ones instead
 * of the tree silently picking one. The current parents are listed (and can be
 * detached) above the two actions.
 */
export function ReparentChoiceDialog({
  open,
  targetTitle,
  parents,
  onAdd,
  onReplace,
  onRemoveParent,
  onClose,
  i18n,
  busy = false
}: {
  open: boolean
  targetTitle: string
  parents: RelationTask[]
  onAdd: () => void
  onReplace: () => void
  onRemoveParent: (id: string) => void
  onClose: () => void
  i18n: GanttI18n
  busy?: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={next => { if (!next) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{i18n.reparentTitle(parents.length)}</DialogTitle>
          <DialogDescription>{i18n.reparentTarget(targetTitle)}</DialogDescription>
        </DialogHeader>
        <TaskRelations
          heading={i18n.reparentCurrent}
          tasks={parents}
          onRemove={onRemoveParent}
          removeLabel={i18n.removeParentLink}
          disabled={busy}
        />
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>{i18n.cancel}</Button>
          <Button variant="secondary" onClick={onReplace} disabled={busy}>{i18n.reparentReplace}</Button>
          <Button onClick={onAdd} disabled={busy}>{i18n.reparentAdd}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Reason codes from `dropCandidates` -> the sentence shown on the greyed row. */
export function reasonLabel(reason: string, i18n: GanttI18n): string {
  switch (reason) {
    case 'self': return i18n.errSelf
    case 'descendant': return i18n.errCycle
    case 'other-board': return i18n.errOtherBoard
    case 'terminal': return i18n.errTerminal
    case 'linked': return i18n.reasonLinked
    default: return i18n.errReparent
  }
}

/**
 * The keyboard-reachable twin of the drag & drop: pick the new parent from a
 * searchable list of the board's tasks. Refused targets stay listed (greyed,
 * with the reason) rather than disappearing.
 */
export function MoveUnderDialog({
  open,
  draggedTitle,
  candidates,
  onPick,
  onClose,
  i18n,
  busy = false
}: {
  open: boolean
  draggedTitle: string
  candidates: Candidate[]
  onPick: (id: string) => void
  onClose: () => void
  i18n: GanttI18n
  busy?: boolean
}) {
  const [query, setQuery] = useState('')
  if (!open) return null
  const visible = candidates.filter(c => matchesSearch(c.task, query))
  const disabledIds = new Set(visible.filter(c => !c.allowed).map(c => c.task.id))
  const byId = new Map(candidates.map(c => [c.task.id, c]))

  return (
    <Dialog open onOpenChange={next => { if (!next) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{i18n.moveUnderTitle(draggedTitle)}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={query}
          placeholder={i18n.moveUnderSearch}
          onChange={event => setQuery(event.target.value)}
        />
        <div className="max-h-72 overflow-y-auto">
          {visible.length === 0 ? (
            <div className="px-1 py-2 text-[11px] italic text-(--ui-text-quaternary)">{i18n.moveUnderEmpty}</div>
          ) : (
            <TaskRelations
              heading=""
              tasks={visible.map(c => c.task)}
              disabledIds={disabledIds}
              reasonOf={id => {
                const c = byId.get(id)
                return c && c.reason ? reasonLabel(c.reason, i18n) : null
              }}
              onOpen={id => { if (!disabledIds.has(id)) onPick(id) }}
              openLabel={i18n.openTask}
              disabled={busy}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}