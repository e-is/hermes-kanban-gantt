import { Button, Codicon, useValue } from '@hermes/plugin-sdk'
import { useRef, useState } from 'react'

import { movePin, pinNeighbour, visiblePins } from '../core/pins-core'
import { useGanttI18n } from '../i18n'
import { $connectionScope, $pinnedBoards, savePins } from '../state'

/**
 * One-click tabs for pinned boards, beside the board switcher.
 *
 * Mirrors the desktop's pinned tabs (hermes-agent e032228): a tab click switches
 * board, drag or Alt+Left/Right reorders without switching, and a pin for a
 * board that no longer exists keeps its slot but stays hidden. Pins belong to a
 * gateway, so a drag started on one connection cannot reorder another one's.
 */
export function PinnedBoardTabs({
  boards,
  currentSlug,
  serverCurrent,
  onSwitch
}: {
  boards: Array<{ slug: string; label?: string }>
  currentSlug: string
  serverCurrent: string
  onSwitch: (slug: string) => void
}) {
  const pins = useValue($pinnedBoards)
  const scope = useValue($connectionScope)
  const i18n = useGanttI18n()
  // The connection a drag began on: a drop after a gateway switch must not
  // reorder the other gateway's pins.
  const drag = useRef<{ scope: string; slug: string } | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const visible = visiblePins(pins, boards)

  if (!visible.length) {
    return null
  }

  const canDrop = () => drag.current?.scope === scope

  const endDrag = () => {
    drag.current = null
    setDropTarget(null)
  }

  const reorder = (slug: string, target: string) => {
    const next = movePin($pinnedBoards.get(), slug, target)

    $pinnedBoards.set(next)
    savePins(next)
  }

  return (
    <div
      aria-label={i18n.pinnedBoards}
      className="flex min-w-0 shrink items-center gap-1 overflow-x-auto [-webkit-app-region:no-drag]"
      role="group"
    >
      {visible.map((board, index) => (
        <Button
          aria-pressed={board.slug === currentSlug}
          className="max-w-36 shrink-0 data-[drop-target=true]:bg-(--ui-control-active-background)"
          data-drop-target={dropTarget === board.slug}
          draggable
          key={board.slug}
          onClick={() => onSwitch(board.slug === serverCurrent ? '' : board.slug)}
          onDragEnd={endDrag}
          onDragOver={event => {
            if (canDrop()) {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              setDropTarget(board.slug)
            }
          }}
          onDragStart={event => {
            drag.current = { scope, slug: board.slug }
            event.dataTransfer.effectAllowed = 'move'
          }}
          onDrop={event => {
            if (canDrop() && drag.current) {
              event.preventDefault()
              reorder(drag.current.slug, board.slug)
            }

            endDrag()
          }}
          onKeyDown={event => {
            const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
            const target = pinNeighbour(visible, board.slug, step)

            if (event.altKey && step && target) {
              event.preventDefault()
              reorder(board.slug, target.slug)
            }
          }}
          size="sm"
          title={i18n.pinnedBoardsHint}
          variant={board.slug === currentSlug ? 'secondary' : 'ghost'}
        >
          <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="pin" size="0.75rem" />
          <span className="min-w-0 truncate">{board.label || board.slug}</span>
        </Button>
      ))}
    </div>
  )
}
