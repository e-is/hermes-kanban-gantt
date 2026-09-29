/** Pure client-side logic of the websocket push prototype (spike t_64075faf).
 *
 * No SDK, no React, no timers: everything here is a pure function so it can be
 * unit-tested in node (tests/ws-core.test.mjs) exactly as it ships. The SDK
 * wiring lives in src/ws.ts and only composes these decisions.
 *
 * Contract implemented here (see docs/spikes/websocket-prototype.md):
 *   - R1  a snapshot frame is turned back into the EXACT shape `GET /gantt`
 *         returns, so nothing downstream (filters, drawer, renderer) changes.
 *   - R7  frames carry a monotonic per-board `version`: a same-or-older frame is
 *         ignored, a gap means "resync over REST".
 *   - R19 the SDK's `ctx.socket` exposes `onMessage` only, so a dead socket is
 *         detected as *silence*: no first frame within WS_FIRST_FRAME_MS, or no
 *         message for WS_IDLE_MS — then the client falls back to polling (R20).
 */

/** No first frame within this delay ⇒ treat the socket as dead (R19). */
export const WS_FIRST_FRAME_MS = 5_000
/** Server sends a data-level heartbeat this often (plugin_ws.WsConfig). */
export const WS_HEARTBEAT_MS = 20_000
/** Silence longer than this ⇒ dead socket (2 missed heartbeats + slack). */
export const WS_IDLE_MS = Math.round(WS_HEARTBEAT_MS * 2.5)
/** Full-jitter exponential backoff, capped — the SDK does the same on close. */
export const WS_BACKOFF_BASE_MS = 500
export const WS_BACKOFF_MAX_MS = 10_000
/** The prototype retries ONCE per outage, then leaves polling in charge. */
export const WS_MAX_ATTEMPTS = 1

/** Socket lifecycle as seen by the UI. */
export const WS_STATE = {
  off: 'off',              // not attempted (flag off, oauth/2nd backend, no board)
  connecting: 'connecting',
  live: 'live',            // at least one snapshot applied
  dead: 'dead',            // gave up → polling only
}

/** Full-jitter backoff (same shape as the SDK door's reconnect). */
export function nextBackoff(attempt, rand = Math.random) {
  const capped = Math.min(WS_BACKOFF_MAX_MS, WS_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt))
  return Math.round(capped / 2 + (capped / 2) * rand())
}

/** Classify one frame against the last applied version. */
export function classifyFrame(frame, lastVersion) {
  if (!frame || typeof frame !== 'object') return { kind: 'ignore' }
  if (frame.type === 'heartbeat') {
    return { kind: 'heartbeat', version: Number(frame.version) || 0 }
  }
  if (frame.type !== 'snapshot') return { kind: 'ignore' }
  const version = Number(frame.version)
  if (!Number.isFinite(version) || !Array.isArray(frame.tasks)) return { kind: 'ignore' }
  if (lastVersion != null && version <= lastVersion) return { kind: 'stale', version }
  // A gap (one or more frames missed) is not fatal: the frame we just got is a
  // full snapshot (every frame is), so it is applied immediately and the REST
  // query is re-validated behind it (R7).
  const gap = lastVersion != null && version > lastVersion + 1
  return { kind: 'snapshot', version, gap }
}

/** Snapshot frame → the exact object shape `GET /gantt` returns (R1). */
export function frameToQueryData(frame) {
  return {
    board: frame.board,
    generated_at: frame.generated_at,
    tasks: frame.tasks || [],
    labels: frame.labels || []
  }
}

/** Where the client asks for one board / the fan-in view. */
export function eventsPath(board) {
  return `/events?board=${encodeURIComponent(board || '')}`
}
