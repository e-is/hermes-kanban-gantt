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
  Popover,
  PopoverContent,
  PopoverTrigger,
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

/** A Hermes project (`hermes_cli.projects_db`) a task can be linked to. */
export type ProjectLike = {
  id: string
  slug?: string
  name: string
  path?: string | null
  board?: string | null
}

/** `kanban_db.VALID_WORKSPACE_KINDS` — what the worker gets for its files. */
const WORKSPACE_KINDS = ['scratch', 'worktree', 'dir']

export type NewTaskValues = {
  title: string
  body?: string
  assignee?: string
  priority?: number
  parentId?: string
  triage?: boolean
  projectId?: string
  workspaceKind?: string
  workspacePath?: string
  skills?: string[]
  modelOverride?: string
  goalMode?: boolean
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
  /** Projects offered (empty when the profile declares none). */
  projects?: ProjectLike[]
  /** Pre-selected parent (opening from a row's "create sub-task"). */
  defaultParentId?: string
  busy?: boolean
  onSubmit: (values: NewTaskValues) => void
  onClose: () => void
  i18n: GanttI18n
}

/** Label + control pair, so every field shares one rhythm. */
function Field({ label, children }: { label: string; children: any }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[10px] uppercase font-semibold text-(--ui-text-tertiary)">{label}</span>
      {children}
    </div>
  )
}

/** Dropdown trigger shaped like an input, showing the current choice. */
function Picker({ value, children, ariaLabel }: { value: any; children: any; ariaLabel: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className="flex min-w-0 items-center gap-1.5 rounded border border-(--ui-stroke-tertiary) bg-transparent px-1.5 py-0.5 text-left text-[11px] text-(--ui-text-secondary) cursor-pointer"
        >
          <span className="min-w-0 flex-1 truncate">{value}</span>
          <Codicon className="shrink-0 text-(--ui-text-quaternary)" name="chevron-down" size="0.75rem" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[13rem]">{children}</DropdownMenuContent>
    </DropdownMenu>
  )
}

export type SearchOption = {
  id: string
  label: string
  hint?: string
  status?: string
}

/**
 * Picker with a filter field — for lists that get long (tasks of a board,
 * projects). A `DropdownMenu` cannot host a text input reliably (Radix menus
 * manage focus for keyboard navigation), so this is a Popover owning its own
 * input and scroller.
 */
function SearchPicker({
  value,
  options,
  selectedId,
  onPick,
  ariaLabel,
  searchPlaceholder,
  emptyLabel,
  className
}: {
  value: any
  options: SearchOption[]
  selectedId?: string
  onPick: (id: string) => void
  ariaLabel: string
  searchPlaceholder: string
  emptyLabel: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const visible = needle
    ? options.filter(o => o.label.toLowerCase().includes(needle) || (o.hint || '').toLowerCase().includes(needle))
    : options

  return (
    <Popover open={open} onOpenChange={next => { setOpen(next); if (!next) setQuery('') }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className="flex min-w-0 items-center gap-1.5 rounded border border-(--ui-stroke-tertiary) bg-transparent px-1.5 py-0.5 text-left text-[11px] text-(--ui-text-secondary) cursor-pointer"
        >
          <span className="min-w-0 flex-1 truncate">{value}</span>
          <Codicon className="shrink-0 text-(--ui-text-quaternary)" name="chevron-down" size="0.75rem" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={className || 'w-[16rem] p-1.5'}>
        <Input
          autoFocus
          value={query}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          onChange={event => setQuery(event.target.value)}
        />
        <div className="mt-1 flex max-h-64 flex-col gap-0.5 overflow-y-auto">
          {visible.length === 0 ? (
            <div className="px-1 py-1.5 text-[11px] italic text-(--ui-text-quaternary)">{emptyLabel}</div>
          ) : (
            visible.map(option => (
              <button
                key={option.id}
                type="button"
                onClick={() => { onPick(option.id); setOpen(false); setQuery('') }}
                className="flex min-w-0 items-center gap-1.5 rounded border-0 bg-transparent px-1 py-0.5 text-left text-[11px] text-(--ui-text-secondary) cursor-pointer hover:bg-(--ui-row-hover-background)"
              >
                {option.status ? <StatusDot status={option.status} /> : null}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{option.label}</span>
                  {option.hint
                    ? <span className="truncate font-mono text-[9.5px] text-(--ui-text-quaternary)">{option.hint}</span>
                    : null}
                </span>
                {selectedId === option.id && <Codicon className="ml-auto shrink-0" name="check" size="0.8rem" />}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Creation form with the same coverage as the reference kanban dialog: title,
 * description, project, workspace (kind + optional path), assignee, priority,
 * skills, model override, parent, triage and goal mode.
 *
 * The STATUS is deliberately absent: the domain derives it (`ready`, `todo`
 * while the parent is unfinished, `triage` when asked), so the form never
 * promises a column it will not land in.
 */
export function NewTaskDialog({
  open,
  boardSlug,
  assignees = [],
  tasks,
  projects = [],
  defaultParentId,
  busy = false,
  onSubmit,
  onClose,
  i18n
}: Props) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [assignee, setAssignee] = useState('')
  const [priority, setPriority] = useState('0')
  const [parentId, setParentId] = useState('')
  const [triage, setTriage] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [workspaceKind, setWorkspaceKind] = useState('scratch')
  const [workspacePath, setWorkspacePath] = useState('')
  const [skills, setSkills] = useState('')
  const [modelOverride, setModelOverride] = useState('')
  const [goalMode, setGoalMode] = useState(false)
  const keyRef = useRef('')

  // Fresh fields (and a fresh idempotency key) on each opening, so the previous
  // submit can never satisfy the next one.
  useEffect(() => {
    if (!open) return
    setTitle('')
    setBody('')
    setAssignee('')
    setPriority('0')
    setParentId(defaultParentId || '')
    setTriage(false)
    setProjectId('')
    setWorkspaceKind('scratch')
    setWorkspacePath('')
    setSkills('')
    setModelOverride('')
    setGoalMode(false)
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
  const chosenProject = projects.find(project => project.id === projectId)
  const canSubmit = title.trim().length > 0 && !busy

  const submit = () => {
    if (!canSubmit) return
    onSubmit({
      title: title.trim(),
      body: body.trim() || undefined,
      assignee: assignee.trim() || undefined,
      priority: Number(priority) || 0,
      parentId: parentId || undefined,
      triage,
      projectId: projectId || undefined,
      workspaceKind,
      workspacePath: workspaceKind === 'scratch' ? undefined : (workspacePath.trim() || undefined),
      skills: skills.split(',').map(s => s.trim()).filter(Boolean),
      modelOverride: modelOverride.trim() || undefined,
      goalMode,
      idempotencyKey: keyRef.current
    })
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) onClose() }}>
      {/* Width and the `overflow-visible` override are the bundled kanban
          plugin's (`w-[min(42rem,94vw)] max-w-none overflow-visible`): the shell's
          DialogContent publishes itself as the portal container for popovers born
          inside it and its default scroll box then crops them at the dialog edge —
          which is exactly what the project / parent / skills menus do here. This
          dialog owns a scroller on its body, so the shell's clip is redundant. */}
      <DialogContent className="w-[min(42rem,94vw)] max-w-none overflow-visible">
        <DialogHeader>
          <DialogTitle>{i18n.newTask}</DialogTitle>
        </DialogHeader>

        {/* The form owns its scroller so the dialog stays usable in a short
            window; the footer keeps its two buttons pinned. */}
        <div className="flex max-h-[min(66vh,36rem)] flex-col gap-2.5 overflow-y-auto pr-0.5">
          <Field label={i18n.newTaskTitle}>
            <Input
              autoFocus
              value={title}
              placeholder={i18n.newTaskTitlePlaceholder}
              onChange={event => setTitle(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  submit()
                }
              }}
            />
          </Field>

          <Field label={i18n.description}>
            <textarea
              rows={3}
              value={body}
              placeholder={i18n.newTaskDescriptionPlaceholder}
              onChange={event => setBody(event.target.value)}
              className="w-full resize-y bg-transparent border border-(--ui-stroke-tertiary) rounded px-1.5 py-1 text-[11px]"
            />
          </Field>

          <div className="grid grid-cols-2 gap-2.5">
            <Field label={i18n.newTaskProject}>
              <SearchPicker
                value={chosenProject ? chosenProject.name : i18n.newTaskNoProject}
                selectedId={projectId}
                onPick={setProjectId}
                ariaLabel={i18n.newTaskProject}
                searchPlaceholder={i18n.newTaskProjectSearch}
                emptyLabel={i18n.newTaskNoMatch}
                options={[
                  { id: '', label: i18n.newTaskNoProject },
                  ...projects.map(project => ({
                    id: project.id,
                    label: project.name,
                    hint: project.path || undefined
                  }))
                ]}
              />
            </Field>

            <Field label={i18n.newTaskWorkspace}>
              <Picker value={workspaceKind} ariaLabel={i18n.newTaskWorkspace}>
                {WORKSPACE_KINDS.map(kind => (
                  <DropdownMenuItem key={kind} onSelect={() => setWorkspaceKind(kind)}>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{kind}</span>
                    {workspaceKind === kind && <Codicon className="ml-auto shrink-0" name="check" size="0.8rem" />}
                  </DropdownMenuItem>
                ))}
              </Picker>
            </Field>
          </div>

          {workspaceKind !== 'scratch' && (
            <Field label={i18n.newTaskWorkspacePath}>
              <Input
                value={workspacePath}
                placeholder={i18n.newTaskWorkspaceInherit}
                onChange={event => setWorkspacePath(event.target.value)}
              />
              <span className="text-[10px] text-(--ui-text-quaternary)">{i18n.newTaskWorkspaceInheritHint}</span>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <Field label={i18n.assignLabel}>
              <Picker value={assignee || i18n.unassigned} ariaLabel={i18n.assignLabel}>
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
              </Picker>
            </Field>

            <Field label={i18n.newTaskPriority}>
              <input
                type="number"
                min="0"
                step="1"
                value={priority}
                onChange={event => setPriority(event.target.value)}
                className="bg-transparent border border-(--ui-stroke-tertiary) rounded px-1.5 py-0.5 text-[11px]"
              />
            </Field>
          </div>

          <Field label={i18n.newTaskSkills}>
            <Input
              value={skills}
              placeholder={i18n.newTaskSkillsPlaceholder}
              onChange={event => setSkills(event.target.value)}
            />
          </Field>

          <Field label={i18n.newTaskModel}>
            <Input
              value={modelOverride}
              placeholder={i18n.newTaskModelInherit}
              onChange={event => setModelOverride(event.target.value)}
            />
            <span className="text-[10px] text-(--ui-text-quaternary)">{i18n.newTaskModelHint}</span>
          </Field>

          <Field label={i18n.newTaskParent}>
            <SearchPicker
              value={chosenParent
                ? (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <StatusDot status={chosenParent.status} />
                    <span className="min-w-0 truncate">{chosenParent.title}</span>
                  </span>
                )
                : i18n.newTaskNoParent}
              selectedId={parentId}
              onPick={setParentId}
              ariaLabel={i18n.newTaskParent}
              searchPlaceholder={i18n.newTaskParentSearch}
              emptyLabel={i18n.newTaskNoMatch}
              options={[
                { id: '', label: i18n.newTaskNoParent },
                ...parentOptions.map(task => ({ id: task.id, label: task.title, status: task.status }))
              ]}
            />
          </Field>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-[11px] text-(--ui-text-secondary)">
              <Switch checked={triage} onCheckedChange={value => setTriage(Boolean(value))} />
              {i18n.newTaskTriage}
            </label>
            <label className="flex items-center gap-2 text-[11px] text-(--ui-text-secondary)">
              <Switch checked={goalMode} onCheckedChange={value => setGoalMode(Boolean(value))} />
              {i18n.newTaskGoalMode}
            </label>
          </div>
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
