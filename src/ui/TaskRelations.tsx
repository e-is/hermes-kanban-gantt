import { Codicon, cn } from '@hermes/plugin-sdk'

import { statusIcon, statusTone } from '../core/gantt-core.ts'

export type RelationTask = {
  id: string
  title: string
  status: string
}

type Props = {
  /** Section heading, already localized by the caller. */
  heading: string
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
  className
}: Props) {
  if (tasks.length === 0 && !emptyLabel) return null

  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <div className="text-[10px] uppercase font-semibold text-(--ui-text-tertiary)">{heading}</div>
      {tasks.length === 0 ? (
        <div className="text-[10.5px] italic text-(--ui-text-quaternary)">{emptyLabel}</div>
      ) : (
        tasks.map(task => (
          <div key={task.id} className="group flex items-center gap-1 min-w-0">
            <button
              type="button"
              disabled={disabled || !onOpen}
              onClick={() => onOpen?.(task.id)}
              aria-label={openLabel ? openLabel(task.title) : undefined}
              className={cn(
                'flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors',
                'bg-transparent border-0 text-[11px] text-(--ui-text-secondary)',
                onOpen && !disabled ? 'cursor-pointer hover:bg-(--ui-row-hover-background)' : 'cursor-default'
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
            {onRemove && (
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
        ))
      )}
    </div>
  )
}

/** Type helper so callers can pass the i18n hook's return without importing it. */
export type GanttI18n = ReturnType<typeof import('../i18n').useGanttI18n>
