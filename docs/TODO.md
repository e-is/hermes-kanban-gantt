# TODO

What is left to do on the plugin. When an item is done, remove it (git keeps the history).

## WebSocket push

Reference: [`spikes/websocket-protocol-design.md`](spikes/websocket-protocol-design.md).

### Defects

- [ ] **The push is ignored after a gateway restart.** The restarted process numbers versions
  from 1 again (the counter lives in the process, §3.4). The SDK reconnects underneath the same
  `onMessage`, and `classifyFrame` drops any version `<= lastVersion` as stale. Heartbeats keep
  the idle timer armed, so the page stays `live` with the poll demoted to 300 s and Refresh
  hidden, until the new counter overtakes the old one. The same happens when a board's stream is
  dropped after its 60 s grace window. Fix: a snapshot *below* `lastVersion` can only come from a
  new stream (one socket is ordered, the counter only grows), so apply it and reset the baseline.
- [ ] **`board=all` still tries the socket.** `wsBoard` in `src/main.ts` only excludes a custom
  base URL and an empty board. The server refuses `all` (1008), so the client falls back to the
  poll by timing out, then retries every 5 min. Exclude `all` / `*` on the client.

### Hardening

- [ ] **One source for the heartbeat.** `WsConfig.heartbeat_s` (server, env-overridable) and
  `WS_HEARTBEAT_MS` (client, build-time) must stay in a 20 s ↔ 50 s ratio. Have the server announce
  its period (first frame, or `?hb=`) and derive the client's idle window from it.
- [ ] **Observability.** Add counters for live connections per board, frames sent, DB reads,
  handshake rejects by reason, slow-consumer closes (4408) and resyncs. Add a user-visible
  *live / degraded* badge, with i18n keys in `en` + `fr`.
- [ ] **README.** Document `KANBAN_GANTT_WS` (default on, `=0` to disable), the tuning variables
  and the client `ws` storage flag.
- [ ] **Tests.** Add `tests/ws-core.test.mjs` to `npm test` (today it only runs by hand). Also
  cover: a failed handshake falls back to the poll (never a blank page), a restarted stream is
  picked up (lower version), and the two heartbeat constants cannot drift.
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

- [ ] **Newer hosts moved `connect` out of `hermes_cli.kanban_db`** (it lives in
  `hermes_cli.kanban_db_connect`). `plugin_api._connect(ro=False)` still calls
  `kanban_db.connect`, so every write route fails on those hosts, and the pytest suite errors in
  its fixture. Resolve the factory from either module.
- [ ] Split `dashboard/plugin_api.py` (≈ 1 100 lines) by concern: reads, task writes, links.

## Renderer

- [ ] Split `src/main.ts` (≈ 2 300 lines of `jsx()` calls) into components: page shell, task row,
  bars and ruler, drawer, menus. One commit per component; no behaviour change.
- [ ] Core unit tests: DST boundaries, minimum bar width.
- [ ] CI: build, then `git diff --exit-code desktop/` (artifact drift), then `npm test`.
