# TODO

What is left to do on the plugin. When an item is done, remove it (git keeps the history).

## WebSocket push

Reference: [`spikes/websocket-protocol-design.md`](spikes/websocket-protocol-design.md).

### Hardening

- [ ] **One source for the heartbeat.** `WsConfig.heartbeat_s` (server, env-overridable) and
  `WS_HEARTBEAT_MS` (client, build-time) must stay in a 20 s ↔ 50 s ratio. Have the server announce
  its period (first frame, or `?hb=`) and derive the client's idle window from it.
- [ ] **Observability.** Add counters for live connections per board, frames sent, DB reads,
  handshake rejects by reason, slow-consumer closes (4408) and resyncs. Add a user-visible
  *live / degraded* badge, with i18n keys in `en` + `fr`.
- [ ] **README.** Document `KANBAN_GANTT_WS` (default on, `=0` to disable), the tuning variables
  and the client `ws` storage flag.
- [ ] **Tests.** `tests/ws-core.test.mjs` now runs in `npm test`; still hand-run are
  `tests/ws_mount_gateway.py` and `tests/ws_proof.py`. Also cover, end to end: a failed handshake
  falls back to the poll (never a blank page), a gateway restart is picked up by a connected page,
  and the two heartbeat constants cannot drift.
- [ ] **Measure** the watcher cost on a board with a running dispatcher, and the push on the
  239-task `sumaris` board (frame size, p95).
- [ ] Minor: every new subscriber takes a version from the shared counter, so the other windows
  on that board see a gap at the next change and do one extra REST read.

### Later, only if needed

- [ ] **Multi-process / replay.** Replace the in-process version with a DB-backed cursor, the
  way the official kanban plugin streams `task_events` with `?since=<id>`. This also gives
  `resume` and makes restarts transparent.
- [ ] **Remote and OAuth desktops.** Ticket-based ws auth needs the SDK's `pluginSocket` to
  support tickets; it is an upstream `hermes-agent` change.
- [ ] **`all` over the socket** (multiplexed `?boards=a,b`, per-board version map on the client).

## Backend

- [ ] Split `dashboard/plugin_api.py` (≈ 1 100 lines) by concern: reads, task writes, links.

## Renderer

- [ ] Split `src/main.ts` (≈ 2 300 lines of `jsx()` calls) into components: page shell, task row,
  bars and ruler, drawer, menus. One commit per component; no behaviour change.
- [ ] Core unit tests: DST boundaries, minimum bar width.
- [ ] CI: build, then `git diff --exit-code desktop/` (artifact drift), then `npm test`.
