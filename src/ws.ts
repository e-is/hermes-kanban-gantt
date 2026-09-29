/** Minimal client for the websocket push prototype (spike t_64075faf).
 *
 * Subscribes to `/events?board=<slug>` through the SDK's existing
 * `ctx.socket(path, onMessage) → dispose` door and hands the applied snapshot to
 * the page, which writes it into the same react-query cache the 60 s poll fills.
 *
 * Deliberately done here rather than in the SDK (see the write-up):
 *   - first-frame timeout (the door has no `onOpen`, so a silent failure is
 *     indistinguishable from an idle stream — R19);
 *   - idle timeout on heartbeat silence;
 *   - ONE reconnect with full-jitter backoff, then polling takes over for good
 *     (the door already reconnects on close; this retry exists for the
 *     never-opened case, and stops the prototype from looking "live" forever);
 *   - give up entirely when the board changes, the flag is off, or a custom
 *     backend base URL is set (the socket door only speaks to the plugin's own
 *     namespace — a real gap, see the write-up).
 */

import {
  WS_STATE, WS_FIRST_FRAME_MS, WS_IDLE_MS, WS_MAX_ATTEMPTS, WS_REARM_MS,
  classifyFrame, eventsPath, frameToQueryData, nextBackoff
} from './core/ws-core'

const LOG = '[kanban-gantt ws]'

/**
 * @param socketDoor ctx.socket (or null when the host/SDK does not provide one)
 * @param opts {{ board, onSnapshot, onResync?, onState?, now? }}
 * @returns dispose()
 */
export function subscribeGantt(socketDoor, opts) {
  const { board, onSnapshot, onResync, onState } = opts || {}
  const now = (opts && opts.now) || (() => Date.now())

  if (typeof socketDoor !== 'function' || !board) {
    onState && onState(WS_STATE.off)
    return () => {}
  }

  let disposed = false
  let attempts = 0
  let lastVersion = null
  let disposeSocket = null
  let firstTimer = null
  let idleTimer = null
  let retryTimer = null
  let rearmTimer = null
  let live = false

  const clearTimers = () => {
    if (firstTimer) { clearTimeout(firstTimer); firstTimer = null }
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
    if (rearmTimer) { clearTimeout(rearmTimer); rearmTimer = null }
  }

  const drop = (why) => {
    clearTimers()
    if (disposeSocket) {
      try { disposeSocket() } catch (err) { console.debug(LOG, 'dispose failed', err) }
      disposeSocket = null
    }
    return why
  }

  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => give('silence'), WS_IDLE_MS)
  }

  // Every exit path lands here: one retry with backoff, then polling.
  const give = (why) => {
    if (disposed) return
    drop(why)
    live = false
    console.debug(LOG, 'socket unusable (' + why + ')')
    if (attempts < WS_MAX_ATTEMPTS) {
      const delay = nextBackoff(attempts)
      attempts += 1
      onState && onState(WS_STATE.connecting)
      console.debug(LOG, 'reconnect in ' + delay + 'ms')
      retryTimer = setTimeout(start, delay)
    } else {
      onState && onState(WS_STATE.dead)
      // Re-arm on our own: a gateway restart must not leave the page on polling
      // forever (see WS_REARM_MS). The budget resets so the next outage gets its
      // own retry.
      console.debug(LOG, 're-arming in ' + WS_REARM_MS + 'ms')
      rearmTimer = setTimeout(() => {
        rearmTimer = null
        if (disposed) return
        attempts = 0
        start()
      }, WS_REARM_MS)
    }
  }

  function start() {
    if (disposed) return
    retryTimer = null
    onState && onState(live ? WS_STATE.live : WS_STATE.connecting)
    disposeSocket = socketDoor(eventsPath(board), (frame) => {
      if (disposed) return
      if (firstTimer) { clearTimeout(firstTimer); firstTimer = null }
      const verdict = classifyFrame(frame, lastVersion)
      if (verdict.kind === 'ignore' || verdict.kind === 'stale') return
      armIdle()
      if (verdict.kind === 'heartbeat') return
      lastVersion = verdict.version
      attempts = 0
      live = true
      onState && onState(WS_STATE.live)
      if (verdict.gap) {
        console.debug(LOG, 'version gap at ' + verdict.version + ' → REST resync')
        onResync && onResync(verdict.version)
      }
      onSnapshot && onSnapshot(frameToQueryData(frame), verdict.version)
    })
    // No onOpen in the SDK door: this timer is the only way to tell
    // "connected and idle" from "never connected".
    firstTimer = setTimeout(() => give('no-first-frame'), WS_FIRST_FRAME_MS)
    console.debug(LOG, 'subscribed', eventsPath(board), 'at', now())
  }

  start()

  return function dispose() {
    disposed = true
    drop('dispose')
    onState && onState(WS_STATE.off)
  }
}
