/**
 * Pin/tab logic for the board quick-switch tabs — pure, no React, so
 * `tests/pins-core.test.mjs` exercises the shipped code (built artifact).
 *
 * Mirrors the desktop's `$pinnedBoards` rules (hermes-agent e032228,
 * "feat(desktop): pin Kanban boards as quick-switch tabs"): pins are slugs in
 * tab order, a pin for a board that no longer exists keeps its slot but is not
 * rendered, and reordering never changes the selection.
 */

/** Ordered board slugs. */
export type PinList = readonly string[]

/** Add or remove `slug`, preserving tab order. No-op when already in that state. */
export function togglePin(pins: PinList, slug: string, pinned: boolean): string[] {
  if (!slug) {
    return [...pins]
  }

  const has = pins.includes(slug)

  if (pinned === has) {
    return [...pins]
  }

  return pinned ? [...pins, slug] : pins.filter(item => item !== slug)
}

/** Move `slug` into `target`'s slot — what a drop and Alt+Left/Right both land on. */
export function movePin(pins: PinList, slug: string, target: string): string[] {
  const next = [...pins]
  const from = next.indexOf(slug)
  const to = next.indexOf(target)

  if (from < 0 || to < 0 || from === to) {
    return next
  }

  next.splice(from, 1)
  next.splice(to, 0, slug)

  return next
}

/** Pins that still resolve to a board, in tab order. */
export function visiblePins<T extends { slug: string }>(pins: PinList, boards: readonly T[]): T[] {
  const bySlug = new Map(boards.map(board => [board.slug, board]))

  return pins.flatMap(slug => {
    const board = bySlug.get(slug)

    return board ? [board] : []
  })
}

/** The tab `slug` swaps with for Alt+Left/Right, or null at either end. */
export function pinNeighbour<T extends { slug: string }>(visible: readonly T[], slug: string, step: number): T | null {
  const index = visible.findIndex(board => board.slug === slug)

  if (index < 0 || !step) {
    return null
  }

  return visible[index + step] || null
}

/** Whatever storage handed back, as a clean slug list (strings, de-duplicated). */
export function normalizePins(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return [...new Set(raw.filter((item): item is string => typeof item === 'string' && item.length > 0))]
}
