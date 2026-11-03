/**
 * Unit tests for the pinned-board tab logic (src/core/pins-core.ts).
 *
 * Imported from the built artifact (desktop/pins-core.js) so the tested code is
 * exactly the shipped code.
 *
 * Run: node --test tests/pins-core.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const { movePin, normalizePins, pinNeighbour, togglePin, visiblePins } = await import(
  join(HERE, '..', 'desktop', 'pins-core.js')
)

const boards = [
  { slug: 'sumaris', label: 'Sumaris' },
  { slug: 'hermes-plugins', label: 'Plugins' },
  { slug: 'default', label: 'Default' }
]

test('pinning appends to the end, in order', () => {
  assert.deepEqual(togglePin([], 'sumaris', true), ['sumaris'])
  assert.deepEqual(togglePin(['sumaris'], 'default', true), ['sumaris', 'default'])
})

test('unpinning removes only that slug', () => {
  assert.deepEqual(togglePin(['a', 'b', 'c'], 'b', false), ['a', 'c'])
})

test('toggling to the state it is already in changes nothing', () => {
  assert.deepEqual(togglePin(['a'], 'a', true), ['a'])
  assert.deepEqual(togglePin(['a'], 'b', false), ['a'])
})

test('an empty slug is never pinned', () => {
  assert.deepEqual(togglePin(['a'], '', true), ['a'])
})

test('toggle and move never mutate the input list', () => {
  const pins = ['a', 'b']

  togglePin(pins, 'c', true)
  movePin(pins, 'a', 'b')
  assert.deepEqual(pins, ['a', 'b'])
})

test('moving a pin takes the target slot, not its neighbour', () => {
  assert.deepEqual(movePin(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b'])
  assert.deepEqual(movePin(['a', 'b', 'c'], 'a', 'c'), ['b', 'c', 'a'])
})

test('moving onto itself, or with an unknown slug, is a no-op', () => {
  assert.deepEqual(movePin(['a', 'b'], 'a', 'a'), ['a', 'b'])
  assert.deepEqual(movePin(['a', 'b'], 'zz', 'a'), ['a', 'b'])
  assert.deepEqual(movePin(['a', 'b'], 'a', 'zz'), ['a', 'b'])
})

test('pins for boards that no longer exist are hidden, and keep their slot', () => {
  assert.deepEqual(visiblePins(['gone', 'sumaris'], boards).map(b => b.slug), ['sumaris'])

  // The board comes back: it reappears where it was pinned, not at the end.
  const back = [...boards, { slug: 'gone', label: 'Gone' }]

  assert.deepEqual(visiblePins(['gone', 'sumaris'], back).map(b => b.slug), ['gone', 'sumaris'])
})

test('visible pins follow pin order, not board order', () => {
  assert.deepEqual(visiblePins(['default', 'sumaris'], boards).map(b => b.slug), ['default', 'sumaris'])
})

test('neighbour walks the VISIBLE tabs, so a hidden pin cannot be a drop target', () => {
  const visible = visiblePins(['gone', 'sumaris', 'default'], boards)

  assert.equal(pinNeighbour(visible, 'sumaris', 1)?.slug, 'default')
  assert.equal(pinNeighbour(visible, 'sumaris', -1), null)
  assert.equal(pinNeighbour(visible, 'default', 1), null)
  assert.equal(pinNeighbour(visible, 'gone', 1), null)
  assert.equal(pinNeighbour(visible, 'sumaris', 0), null)
})

test('stored pins are sanitized: strings only, de-duplicated', () => {
  assert.deepEqual(normalizePins(['a', 'a', 3, null, '', 'b']), ['a', 'b'])
  assert.deepEqual(normalizePins('a'), [])
  assert.deepEqual(normalizePins(null), [])
  assert.deepEqual(normalizePins(undefined), [])
})
