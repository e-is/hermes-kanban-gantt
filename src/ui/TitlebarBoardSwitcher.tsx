import { Button, cn, Codicon, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, useQuery, useQueryClient, useValue } from '@hermes/plugin-sdk'
import { useEffect } from 'react'

import { $bandSwitcherPresent, $boardSlug, apiBase, apiFetch, getStorage } from '../state'
import { useGanttI18n } from '../i18n'

/** The band copy carries this marker, so the page can tell whether the host is showing it. */
export const BAND_SWITCHER_ATTR = 'data-kg-band-switcher'

/**
 * Whether the page header band is REALLY rendering our switcher.
 *
 * The switcher is projected into the workspace page header (`WORKSPACE_PAGE_HEADER_AREA`), which
 * only the main pane paints: a page opened in a split tile gets no band, hence issue #20 — the board
 * could not be chosen there, and a board with nothing on `default` looked empty.
 *
 * The answer used to be read from the DOM — a `MutationObserver` on `document.body` looking for the
 * band copy's marker — which reaches outside the plugin's own surface (the catalog's `desktop surface`
 * check fails a plugin that does). The band copy now says so itself: it is our own component, it runs
 * in the same module instance whichever root paints it, so mounting it sets an atom and unmounting
 * clears it. No DOM query, no host reach, and the fact is exactly as reliable.
 */
export function useBandSwitcherPresent(): boolean {
  return useValue($bandSwitcherPresent)
}

/**
 * The board switcher: the plugin's own board picker, offering the "all boards" aggregate mode the
 * official one does not have.
 *
 * Two placements, one component. `inline` draws it in the page's own header (split tiles, and the
 * first paint before the band mounts); the default projection into the desktop band mirrors the
 * official kanban plugin, so both switchers live in the same spot.
 */
export function TitlebarBoardSwitcher({ inline = false }: { inline?: boolean } = {}) {
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

  // The band copy announces itself, and only it: the inline copy is the fallback that READS this, so
  // letting it set the flag would make the page believe the band exists because it drew its own.
  useEffect(() => {
    if (inline) return
    $bandSwitcherPresent.set(true)
    return () => { $bandSwitcherPresent.set(false) }
  }, [inline])

  const switcher = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className={cn(
            'min-w-0 max-w-full gap-1.5 px-2 [-webkit-app-region:no-drag]',
            inline
              ? 'h-7 rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) text-[0.75rem]'
              : 'h-full'
          )}
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
      <DropdownMenuContent align={inline ? 'start' : 'center'}>
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

  // `contents` keeps the band copy's box out of the layout; the inline copy is a real chip.
  return inline
    ? <span className="inline-flex min-w-0" data-kg-inline-switcher="">{switcher}</span>
    : <span className="contents" {...{ [BAND_SWITCHER_ATTR]: '' }}>{switcher}</span>
}
