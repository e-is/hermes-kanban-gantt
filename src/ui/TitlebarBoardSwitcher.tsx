import { Button, cn, Codicon, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, useQuery, useQueryClient, useValue } from '@hermes/plugin-sdk'

import { $boardSlug, apiBase, apiFetch, getStorage } from '../state'
import { useGanttI18n } from '../i18n'

/**
 * Board switcher projected into the desktop titlebar band (titleBar.center)
 * while the gantt page is mounted — mirrors the official kanban plugin's
 * placement so both switchers live in the same spot. Content differs: this
 * one offers the plugin's own "all boards" aggregate mode.
 */
export function TitlebarBoardSwitcher() {
  const board = useValue($boardSlug)
  const i18n = useGanttI18n()
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ['kanban-gantt', 'boards', apiBase()],
    queryFn: () => apiFetch('/boards'),
    refetchInterval: 5 * 60_000
  })
  const boards = data?.boards || []
  const isAllBoards = board === 'all' || board === '*'
  const current = isAllBoards
    ? { slug: 'all', label: i18n.allBoards }
    : boards.find(b => b.slug === (board || data?.current))
  const setBoard = (slug: string) => {
    $boardSlug.set(slug)
    if (getStorage()) getStorage().set('board', slug)
    void queryClient.invalidateQueries({ queryKey: ['kanban-gantt', 'gantt'] })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="h-full min-w-0 max-w-full gap-1.5 px-2 [-webkit-app-region:no-drag]"
          size="sm"
          variant="ghost"
        >
          {/* Single-element child: Radix `asChild` (Slot) rejects arrays. */}
          <span className="flex min-w-0 items-center gap-1.5">
            {/* Mirror the official kanban switcher look: project icon, board
                label, truncated current board, total, chevron. */}
            <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="project" size="0.8125rem" />
            <span className="shrink-0 text-[0.6875rem] font-medium text-(--ui-text-tertiary)">
              {/* i18n.board carries a trailing colon for inline use ("Board :"); the
                  official switcher chip shows the bare word. */}
              {i18n.board.replace(/[:：]\s*$/, '')}
            </span>
            <span className="min-w-0 flex-1 truncate text-[0.75rem] font-medium leading-none">
              {current?.label || '—'}
            </span>
            {current && !isAllBoards && typeof current.total === 'number' && (
              <span className="text-[0.6875rem] tabular-nums text-(--ui-text-quaternary)">
                {current.total}
              </span>
            )}
            <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="chevron-down" size="0.8125rem" />
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center">
        {/* Plugin-specific aggregate mode, kept on top like the official's own
            special entries; the rest mirrors the official switcher's item style. */}
        <DropdownMenuItem onSelect={() => setBoard('all')}>
          <span className={cn('min-w-0 flex-1 truncate', isAllBoards && 'font-semibold text-(--ui-accent)')}>
            {i18n.allBoards}
          </span>
          {isAllBoards && <Codicon className="ml-auto shrink-0" name="check" size="0.8rem" />}
        </DropdownMenuItem>
        {boards.length > 0 && <DropdownMenuSeparator />}
        {boards.map(b => {
          const isCurrent = !isAllBoards && b.slug === (board || data?.current)
          return (
            <DropdownMenuItem key={b.slug} onSelect={() => setBoard(b.slug)}>
              <span className="min-w-0 flex-1 truncate">{b.label || b.slug}</span>
              {typeof b.total === 'number' && (
                <span className="text-[0.625rem] tabular-nums text-(--ui-text-quaternary)">{b.total}</span>
              )}
              {isCurrent && <Codicon className="ml-auto shrink-0" name="check" size="0.8rem" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
