import { Codicon, cn } from '@hermes/plugin-sdk'

import { statusIcon, statusTone } from '../core/gantt-core.ts'

export type RelationTask = {
  id: string
  title: string
  status: string
}

type Props = {
  /** Section heading, already localized by the caller (omit for a bare list). */
  heading?: string
  /** The related tasks, in board order. */
  tasks: RelationTask[]
  /** Shown instead of the list when it is empty (omit to hide the section). */
  emptyLabel?: string
  /** Click on a row: select that task and open its detail. */
  onOpen?: (id: string) => void
  /** When given, each row gets a remove button (localized aria-label). */
  onRemove?: (id: string) => void
  removeLabel?: (title: string) => string
  openLabel?: (title: string) => string
  disabled?: boolean
  /** Rows to render greyed out and inert (with `reasonOf` explaining why). */
  disabledIds?: Set<string>
  reasonOf?: (id: string) => string | null
  className?: string
}

/**
 * One task per row — status Codicon tinted with the status tone, truncated
 * title — used everywhere the plugin lists related tasks: the drawer's parent
 * and child sections, the re-parent chooser, and the "move under…" picker.
 *
 * Row and remove control are SIBLING buttons, never nested (a button inside a
 * button is invalid and the inner one stops receiving clicks in some browsers).
 */
export function TaskRelations({
  heading,
  tasks,
  emptyLabel,
  onOpen,
  onRemove,
  removeLabel,
  openLabel,
  disabled = false,
  disabledIds,
  reasonOf,
  className
}: Props) {
  if (tasks.length === 0 && !emptyLabel) return null

  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      {heading ? (
        <div className="text-[10px] uppercase font-semibold text-(--ui-text-tertiary)">{heading}</div>
      ) : null}
      {tasks.length === 0 ? (
        <div className="text-[10.5px] italic text-(--ui-text-quaternary)">{emptyLabel}</div>
      ) : (
        tasks.map(task => {
          const inert = Boolean(disabledIds && disabledIds.has(task.id))
          const reason = inert && reasonOf ? reasonOf(task.id) : null
          const clickable = Boolean(onOpen) && !disabled && !inert
          return (
            <div key={task.id} className="group flex items-center gap-1 min-w-0" title={reason || undefined}>
              <button
                type="button"
                disabled={!clickable}
                onClick={() => onOpen?.(task.id)}
                aria-label={openLabel ? openLabel(task.title) : undefined}
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors',
                  'bg-transparent border-0 text-[11px] text-(--ui-text-secondary)',
                  inert && 'cursor-default opacity-45 line-through',
                  clickable ? 'cursor-pointer hover:bg-(--ui-row-hover-background)' : !inert && 'cursor-default'
                )}
              >
                <Codicon
                  className="shrink-0"
                  name={statusIcon(task.status)}
                  size="0.8rem"
                  style={{ color: statusTone(task.status) }}
                />
                <span className="min-w-0 flex-1 truncate">{task.title}</span>
              </button>
              {onRemove && !inert && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onRemove(task.id)}
                  aria-label={removeLabel ? removeLabel(task.title) : undefined}
                  className={cn(
                    'shrink-0 inline-flex items-center justify-center rounded border-0 bg-transparent p-0.5',
                    'text-(--ui-text-quaternary) opacity-0 transition-opacity',
                    disabled ? 'cursor-default' : 'cursor-pointer hover:text-(--ui-text-primary) group-hover:opacity-100'
                  )}
                >
                  <Codicon name="close" size="0.75rem" />
                </button>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

/** Type helper so callers can pass the i18n hook's return without importing it. */
export type GanttI18n = ReturnType<typeof import('../i18n').useGanttI18n>
