import { Codicon } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

/**
 * The floating zoom bar, shared by every view that has a canvas.
 *
 * The look is the whiteboard's own, values included: a 12 px container radius, 8 px buttons, 28 px
 * squares, a 6 % hover wash. It is written as real CSS rather than utility classes on purpose — the
 * host's Tailwind build does not compile every utility our markup uses (the graph already learned
 * that with `origin-top-left`), and a dropped `rounded-xl` or `bottom-*` leaves a square box pinned to
 * the top of the canvas instead of a rounded one in its corner.
 *
 * `fitted` is a MODE, not a hover state: the Fit button is lit while the view sits at the scale fit
 * produced — which in the graph also means "auto-fit is armed", i.e. the camera will refit when the
 * pane or the layout changes, and stops being armed the moment the reader takes the camera.
 */
const CSS = `
.kb-zoom { position: absolute; z-index: 10; right: 14px; bottom: 16px; display: flex; align-items: center;
  gap: 2px; padding: 4px; border-radius: 12px; background: var(--ui-surface-background);
  border: 1px solid var(--ui-stroke-secondary); }
.kb-zoom > span { min-width: 42px; text-align: center; font: 500 11px var(--font-sans, system-ui);
  font-variant-numeric: tabular-nums; color: var(--ui-text-secondary); }
.kb-zoom .kb-zbtn { display: inline-flex; align-items: center; justify-content: center; width: 28px;
  height: 28px; padding: 0; border-radius: 8px; border: 1px solid transparent; background: transparent;
  color: var(--ui-text-secondary); cursor: pointer; transition: background .15s, color .15s; }
.kb-zoom .kb-zbtn:hover { background: color-mix(in srgb, var(--ui-text-primary) 6%, transparent);
  color: var(--ui-text-primary); }
.kb-zoom .kb-zbtn svg { width: 15px; height: 15px; flex-shrink: 0; }
.kb-zoom .kb-zbtn[aria-pressed='true'] { color: var(--ui-accent);
  background: color-mix(in srgb, var(--ui-accent) 16%, transparent); }
`

export function ZoomBar({ percent, onIn, onOut, onFit, i18n, fitted = false, leading = null }) {
  const icon = (key, title, name, onClick, active = false) => jsx('button', {
    type: 'button',
    title,
    'aria-label': title,
    'aria-pressed': active ? 'true' : 'false',
    onClick,
    className: 'kb-zbtn',
    children: jsx(Codicon, { name, size: '0.9375rem' })
  }, key)

  return jsxs('div', {
    role: 'group',
    'aria-label': i18n.wbZoomIn,
    className: 'kb-zoom',
    children: [
      jsx('style', { children: CSS }, 'css'),
      leading,
      icon('out', i18n.wbZoomOut, 'zoom-out', onOut),
      jsx('span', { children: `${Math.round(percent)}%` }, 'pct'),
      icon('in', i18n.wbZoomIn, 'zoom-in', onIn),
      icon('fit', fitted ? i18n.graphFitOn : i18n.wbFit, 'screen-full', onFit, fitted)
    ]
  })
}
