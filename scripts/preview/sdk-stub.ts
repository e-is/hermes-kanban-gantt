/**
 * Preview-only stub for `@hermes/plugin-sdk`.
 *
 * The whiteboard view imports three SDK helpers. A real desktop supplies them (React
 * components and the theme's icon font); a static preview cannot, so this module provides
 * the smallest honest surface: a button, the class joiner, and a Codicon that renders the
 * glyph the view is asking for instead of an empty box.
 */
import { createElement } from 'react'

const GLYPH: Record<string, string> = {
  'columns': '▥',
  'folder': '▤',
  'layout': '▦',
  'milestone': '◆',
  'screen-full': '⛶',
  'symbol-color': '◉',
  'zoom-in': '＋',
  'zoom-out': '－'
}

export function Button({ children, size, variant, ...rest }: any) {
  return createElement('button', { type: 'button', ...rest }, children)
}

export function Codicon({ name, size, className }: any) {
  return createElement('span', {
    className,
    style: { fontSize: size || '0.8rem', lineHeight: 1, display: 'inline-flex' },
    'aria-hidden': true
  }, GLYPH[name] || '•')
}

export const cn = (...parts: any[]) => parts.filter(Boolean).join(' ')
