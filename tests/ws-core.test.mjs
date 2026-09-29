/**
 * Unit tests for the websocket prototype's PURE client logic (spike t_64075faf).
 *
 * They import the built artifact desktop/ws-core.js — the same code the plugin
 * bundle inlines — so the decisions under test are the shipped ones.
 * Run: node --test tests/ws-core.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  WS_BACKOFF_BASE_MS, WS_BACKOFF_MAX_MS, WS_FIRST_FRAME_MS, WS_HEARTBEAT_MS, WS_IDLE_MS,
  WS_MAX_ATTEMPTS, WS_STATE, classifyFrame, eventsPath, frameToQueryData, nextBackoff
} from '../desktop/ws-core.js'

const snap = (version, extra = {}) => ({
  type: 'snapshot', board: 'sumaris', version, generated_at: 42,
  tasks: [{ id: 't_1' }], labels: [{ label: 'X', count: 1 }], ...extra
})

test('first snapshot is accepted and its shape matches GET /gantt (R1)', () => {
  const verdict = classifyFrame(snap(1), null)
  assert.equal(verdict.kind, 'snapshot')
  assert.equal(verdict.version, 1)
  assert.equal(verdict.gap, false)

  const data = frameToQueryData(snap(1))
  assert.deepEqual(Object.keys(data).sort(), ['board', 'generated_at', 'labels', 'tasks'])
  assert.equal(data.board, 'sumaris')
  assert.equal(data.generated_at, 42)
  assert.deepEqual(data.labels, [{ label: 'X', count: 1 }])
})

test('a same-or-older version is ignored, a gap is flagged for REST resync (R7)', () => {
  assert.equal(classifyFrame(snap(3), 3).kind, 'stale')
  assert.equal(classifyFrame(snap(2), 3).kind, 'stale')
  const gap = classifyFrame(snap(7), 3)
  assert.equal(gap.kind, 'snapshot')
  assert.equal(gap.gap, true)
  assert.equal(classifyFrame(snap(4), 3).gap, false)
})

test('heartbeats keep the socket alive but never touch the cache', () => {
  const hb = classifyFrame({ type: 'heartbeat', board: 'sumaris', version: 5, at: 1 }, 4)
  assert.equal(hb.kind, 'heartbeat')
})

test('malformed frames are ignored rather than applied', () => {
  for (const bad of [null, undefined, 'nope', 42, { type: 'snapshot', version: 'x', tasks: [] },
    { type: 'snapshot', version: 2 }, { type: 'other' }]) {
    assert.equal(classifyFrame(bad, 1).kind, 'ignore')
  }
})

test('backoff is capped, jittered and monotonic in expectation', () => {
  const noJitter = () => 1
  assert.equal(nextBackoff(0, noJitter), WS_BACKOFF_BASE_MS)
  assert.equal(nextBackoff(1, noJitter), WS_BACKOFF_BASE_MS * 2)
  assert.equal(nextBackoff(9, noJitter), WS_BACKOFF_MAX_MS)
  const capped = Math.min(WS_BACKOFF_MAX_MS, WS_BACKOFF_BASE_MS * 2 ** 3)
  assert.equal(nextBackoff(3, () => 0), capped / 2)
  assert.equal(nextBackoff(3, () => 1), capped)
})

test('the prototype retries exactly once, then leaves polling in charge (R19/R20)', () => {
  assert.equal(WS_MAX_ATTEMPTS, 1)
  assert.equal(WS_STATE.dead, 'dead')
  assert.equal(WS_STATE.off, 'off')
})

test('timeouts are ordered: first frame < idle silence > heartbeat', () => {
  assert.equal(WS_FIRST_FRAME_MS, 5_000)
  assert.equal(WS_IDLE_MS, Math.round(WS_HEARTBEAT_MS * 2.5))
  assert.ok(WS_FIRST_FRAME_MS < WS_IDLE_MS)
})

test('the subscribe path pins the board at the handshake (R9/B6)', () => {
  assert.equal(eventsPath('sumaris'), '/events?board=sumaris')
  assert.equal(eventsPath('a/b c'), '/events?board=a%2Fb%20c')
})
