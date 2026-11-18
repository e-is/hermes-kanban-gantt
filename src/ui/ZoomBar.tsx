import { Codicon } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

/**
 * The floating zoom bar, shared by every view that has a canvas.
 *
 * The look is the whiteboard's own (its zoom bar, ported as-is): `−`, the percentage, `+`, and
 * `fit`. It is absolute inside a `relative` container, so each view pins it to ITS canvas.
 *
 * `fitted` is a MODE, not a hover state: it is lit while the view sits at the scale fit produced —
 * which in the graph also means "auto-fit is armed", i.e. the camera will refit when the pane or the
 * layout changes, and stops being armed the moment the reader takes the camera themselves.
 *
 * Positioned inline: the host's Tailwind build does not compile every utility our markup uses (the
 * graph learned the same lesson with `origin-top-left`), and a missing `bottom-*` leaves the bar at
 * its static position — pinned to the top of the canvas instead of its corner.
 */
export function ZoomBar({ percent, onIn, onOut, onFit, i18n, fitted = false, leading = null }) {
  const icon = (key, title, name, onClick, active = false) => jsx('button', {
    type: 'button',
    title,
    'aria-label': title,
    'aria-pressed': active ? 'true' : 'false',
    onClick,
    style: active
      ? { color: 'var(--ui-accent)', backgroundColor: 'color-mix(in srgb, var(--ui-accent) 16%, transparent)' }
      : undefined,
    className: 'grid h-7 w-7 place-items-center rounded-md border-0 bg-transparent text-(--ui-text-secondary) cursor-pointer hover:bg-(--ui-bg-tertiary) hover:text-foreground',
    children: jsx(Codicon, { name, size: '0.8rem' })
  }, key)

  return jsxs('div', {
    role: 'group',
    'aria-label': i18n.wbZoomIn,
    style: { position: 'absolute', right: '12px', bottom: '20px', zIndex: 10 },
    className: 'flex items-center gap-0.5 rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-surface-background) p-1 shadow-sm',
    children: [
      leading,
      icon('out', i18n.wbZoomOut, 'zoom-out', onOut),
      jsx('span', {
        className: 'min-w-[42px] text-center text-[11px] font-medium tabular-nums text-(--ui-text-secondary)',
        children: `${Math.round(percent)}%`
      }, 'pct'),
      icon('in', i18n.wbZoomIn, 'zoom-in', onIn),
      icon('fit', fitted ? i18n.graphFitOn : i18n.wbFit, 'screen-full', onFit, fitted)
    ]
  })
}
