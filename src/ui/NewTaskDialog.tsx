import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Codicon,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Switch
} from '@hermes/plugin-sdk'

import { statusTone } from '../core/gantt-core.ts'

/** Small status marker — the same tone the timeline bars and legend use. */
function StatusDot({ status }: { status: string }) {
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: statusTone(status) }}
      aria-hidden="true"
    />
  )
}

/** The i18n hook's return, without importing the hook itself. */
type GanttI18n = ReturnType<typeof import('../i18n').useGanttI18n>

/** What this dialog needs to show about a task (same shape as the rows). */
export type TaskLike = {
  id: string
  title: string
  status: string
  board?: string
}

export type NewTaskValues = {
  title: string
  assignee?: string
  priority?: number
  parentId?: string
  triage?: boolean
  /** One per dialog opening: a double submit then returns the SAME task. */
  idempotencyKey: string
}

type Props = {
  open: boolean
  /** Board the task will be created on (the current one). */
  boardSlug?: string
  /** Profiles offered as assignee. */
  assignees?: string[]
  /** Every task of the board, for the optional parent picker. */
  tasks: TaskLike[]
  /** Pre-selected parent (opening from a row's "create sub-task"). */
  defaultParentId?: string
  busy?: boolean
  onSubmit: (values: NewTaskValues) => void
  onClose: () => void
  i18n: GanttI18n
}

/**
 * The board's first write that creates something rather than changing it: the
 * domain derives the status (gated to `todo` when the parent is not finished,
 * `triage` when asked), so this only collects what the user actually types.
 */
export function NewTaskDialog({
  open,
  boardSlug,
  assignees = [],
  tasks,
  defaultParentId,
  busy = false,
  onSubmit,
  onClose,
  i18n
}: Props) {
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState('')
  const [priority, setPriority] = useState('0')
  const [parentId, setParentId] = useState('')
  const [triage, setTriage] = useState(false)
  const keyRef = useRef('')

  // Fresh fields (and a fresh idempotency key) on each opening, so the previous
  // submit can never satisfy the next one.
  useEffect(() => {
    if (!open) return
    setTitle('')
    setAssignee('')
    setPriority('0')
    setParentId(defaultParentId || '')
    setTriage(false)
    keyRef.current = `kg-new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }, [open, defaultParentId])

  // A parent that would be nonsense (finished task, another board) is not
  // offered — the backend accepts it anyway, this keeps the list short. The one
  // exception is the parent the dialog was OPENED with ("create a sub-task" on a
  // finished task): it must stay visible, or the field would read "no parent"
  // while a parent is set.
  const parentOptions = tasks.filter(task =>
    task.id === defaultParentId ||
    (task.status !== 'done' && task.status !== 'archived' &&
      (!boardSlug || !task.board || task.board === boardSlug)))
  const chosenParent = parentOptions.find(task => task.id === parentId)
  const canSubmit = title.trim().length > 0 && !busy

  const submit = () => {
    if (!canSubmit) return
    onSubmit({
      title: title.trim(),
      assignee: assignee.trim() || undefined,
      priority: Number(priority) || 0,
      parentId: parentId || undefined,
      triage,
      idempotencyKey: keyRef.current
    })
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{i18n.newTask}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Input
            autoFocus
            value={title}
            placeholder={i18n.newTaskTitlePlaceholder}
            aria-label={i18n.newTaskTitle}
            onChange={event => setTitle(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
            }}
          />

          <div className="flex items-center gap-2">
            {/* Assignee: the same profile chips the row badge uses. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="xs" variant="secondary">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Codicon className="shrink-0" name="account" size="0.8rem" />
                    <span className="min-w-0 truncate">{assignee || i18n.unassigned}</span>
                    <Codicon className="shrink-0" name="chevron-down" size="0.75rem" />
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => setAssignee('')}>
                  <span className="min-w-0 flex-1 truncate">{i18n.unassigned}</span>
                  {!assignee && <Codicon className="ml-auto shrink-0" name="check" size="0.8rem" />}
                </DropdownMenuItem>
                {assignees.length > 0 && <DropdownMenuSeparator />}
                {assignees.map(name => (
                  <DropdownMenuItem key={name} onSelect={() => setAssignee(name)}>
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    {assignee === name && <Codicon className="ml-auto shrink-0" name="check" size="0.8rem" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Priority: the domain's integer (higher = sooner). */}
            <label className="flex items-center gap-1.5 text-[11px] text-(--ui-text-tertiary)">
              {i18n.newTaskPriority}
              <input
                type="number"
                min="0"
                step="1"
                value={priority}
                aria-label={i18n.newTaskPriority}
                onChange={event => setPriority(event.target.value)}
                className="w-16 bg-transparent border border-(--ui-stroke-tertiary) rounded px-1.5 py-0.5 text-[11px]"
              />
            </label>
          </div>

          {/* Optional parent: creating a sub-task without touching the tree. */}
          <div className="flex items-center gap-2 text-[11px] text-(--ui-text-tertiary)">
            <span className="shrink-0">{i18n.newTaskParent}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="xs" variant="ghost">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {chosenParent ? <StatusDot status={chosenParent.status} /> : null}
                    <span className="min-w-0 truncate text-(--ui-text-secondary)">
                      {chosenParent ? chosenParent.title : i18n.newTaskNoParent}
                    </span>
                    <Codicon className="shrink-0" name="chevron-down" size="0.75rem" />
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => setParentId('')}>
                  <span className="min-w-0 flex-1 truncate">{i18n.newTaskNoParent}</span>
                  {!parentId && <Codicon className="ml-auto shrink-0" name="check" size="0.8rem" />}
                </DropdownMenuItem>
                {parentOptions.length > 0 && <DropdownMenuSeparator />}
                {parentOptions.map(task => (
                  <DropdownMenuItem key={task.id} onSelect={() => setParentId(task.id)}>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <StatusDot status={task.status} />
                      <span className="min-w-0 flex-1 truncate">{task.title}</span>
                    </span>
                    {parentId === task.id && <Codicon className="ml-auto shrink-0" name="check" size="0.8rem" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <label className="flex items-center gap-2 text-[11px] text-(--ui-text-secondary)">
            <Switch checked={triage} onCheckedChange={value => setTriage(Boolean(value))} />
            {i18n.newTaskTriage}
          </label>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>{i18n.cancel}</Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {busy ? i18n.creating : i18n.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
