# WebSocket push for the gantt snapshot loop — prototype (spike)

**Status: throwaway prototype on a local branch. Not pushed, not merged, default OFF.**
Branch: `spike/ws-push-prototype` (local only). Deliverable of the spike card
"Prototype websocket push for one polling loop", which replaced the
`refetchInterval: 60_000` gantt snapshot query (`src/main.ts`, `useQuery(['kanban-gantt','gantt',…])`)
with a push over the plugin's own websocket route.

Read with: `websocket-options.md` (why native FastAPI WS on the plugin router)
and `current-state-and-requirements.md` (the R1–R20 list this is judged against).

---

## What is in the branch

| path | role |
|---|---|
| `dashboard/plugin_ws.py` | the server: `@router.websocket("/events")` on the plugin router, one `BoardStream` per board slug (single-thread sqlite reader, change detection, coalescing, monotonic version, per-subscriber queue), auth, heartbeat |
| `dashboard/plugin_api.py` | 20 lines: `plugin_ws.attach(router)` behind the env flag, registered last so the route set is byte-identical to today's when the flag is off |
| `src/ws.ts` | the client: subscribes over the SDK's existing `ctx.socket`, applies frames into the same react-query cache entry, one reconnect with full-jitter backoff then polling wins, first-frame + idle timeouts, gap → REST resync |
| `src/core/ws-core.ts`, `desktop/ws-core.js` | pure, testable decisions (frame classification, staleness, backoff, path building) |
| `src/main.ts`, `src/state.ts`, `src/i18n.ts` | the wiring behind the flag: `refetchInterval` 60 s → 300 s only while the socket is live, a local 30 s "now" tick (R6), i18n keys for the new states |
| `tests/ws_proof.py` | end-to-end proof, 13 checks (below) |
| `tests/ws-core.test.mjs` | 8 unit checks on the shipped client decisions |
| `docs/spikes/ws-simulator/` | earlier transport-only simulator (`server.py`/`poller.py`/`ws_client.py`/`bench.py`): measures latency/bandwidth/reconnect on a fake payload, no plugin involvement. Its README is `results/ws-simulator-README.md` |

## How to run it

Server half is opt-in per gateway process, client half per browser profile —
either side can be switched off independently.

```bash
# 1. proof (hermetic: temp board db, sandboxed roots, no gateway, no hermes_cli)
/tmp/kg-test-venv/bin/python tests/ws_proof.py        # exit 0 = all checks pass
# raw log of the run kept as evidence: docs/spikes/results/ws-proof.log

# 2. the plugin's own suites (unchanged by the prototype)
npm test                                             # 43 node + 11 ui checks + 35 pytest
node --test tests/ws-core.test.mjs                     # 8 checks
npm run build && npm run check                         # builds desktop/ws-core.js

# 3. run it for real (standalone dev backend on loopback)
KANBAN_GANTT_WS=1 KANBAN_GANTT_WS_TOKEN=devticket python dashboard/plugin_api.py
```

Server env (all default to the "off / conservative" value):

| env | default | meaning |
|---|---|---|
| `KANBAN_GANTT_WS` | unset → **off** | registers `/events` at all. Unset ⇒ `GET /events` is 404 and the plugin behaves exactly as before |
| `KANBAN_GANTT_WS_TOKEN` | unset | shared secret compared in constant time against `?token=`. Unset ⇒ standalone loopback clients only, remote (non-loopback) clients refused |
| `KANBAN_GANTT_WS_POLL_MS` | 250 | server-side change-detection cadence |
| `KANBAN_GANTT_WS_DEBOUNCE_MS` | 300 | coalescing window; a burst of writes inside it yields ONE frame (R5) |
| `KANBAN_GANTT_WS_HEARTBEAT_S` | 20 | data-level heartbeat frame while the board is idle (R18) |
| `KANBAN_GANTT_WS_GRACE_S` | 60 | keep a board stream — and its version counter — alive after the last client leaves, so a reconnect resumes above what the client already rendered |
| `KANBAN_GANTT_WS_MAX_OVERRUNS` | 3 | consecutive dropped frames before a slow subscriber is closed (4408) |

Client flag: storage key `ws` = `'1'` (`ctx.storage`), set in the plugin's own
`register(ctx)`. Off, on a custom backend base URL, or after the socket dies,
the 60 s poll is back and nothing else changes.

### Fall back to polling

* client only: leave `ws` unset → `refetchInterval` stays 60 s, no socket opened.
* server only: unset `KANBAN_GANTT_WS` → route gone; a client that still asks gets a 404 and `give('no-first-frame')` demotes it to polling.
* proven by proof check P11 (`GET /gantt`=200, `GET /events`=404 with the flag off).

## Evidence of the run (13/13, exit 0)

`docs/spikes/results/ws-proof.log`, on this host, sandboxed board db:

```
P1  first frame is a full snapshot with the /gantt shape (R1/R8)   keys=[board,generated_at,labels,tasks,type,version] tasks=1 v1
P2  five writes ⇒ five frames, versions strictly increasing (R4/R7) versions=[2,3,4,5,6]
P3  change→frame p95 ≤ 2000 ms (R4)                                 p50=383 p95=416 max=405 ms
P3  payload within the 600 KB / 50 ms push budget (R3)              largest frame 2045 B
P4  a 10-write burst coalesces into ≤2 frames (R5)                  1 frame, 1 DB read
P6  heartbeats arrive while the board is idle (R18)                 2 in 3 s (interval 2 s)
P5  two subscribers ⇒ ONE board read per change (R11)               reads=1, versions=9/9
P10 the first frame after a reconnect is a full snapshot (R8)       v10 with 17 tasks
P8  wrong/absent token is rejected (R13)                            absent + wrong → handshake refused
P8  standalone fallback is loopback-only (R16)                      loopback=loopback remote=no_gate
P9  path traversal slug refused (R10)
P7  zero HTTP GET /gantt requests for the whole run                 0 requests  ← nothing polls
P11 flag off ⇒ REST works and /events does not exist                GET /gantt=200 GET /events=404
```

Suite state at this commit: `npm test` 43+11+35 pass, `tests/ws-core.test.mjs` 8 pass,
`npm run build` OK (emits `desktop/ws-core.js`).

## What is stubbed or skipped (honest gaps)

1. **Not wired into a live gateway, and never opened by the real desktop app.**
   Every check runs against a sandboxed board db and a loopback `uvicorn`. The
   `ctx.socket` door of the shipped plugin was not exercised end to end, so the
   handshake path (ticket vs `?token=`, see gap 3) is reasoned about, not proven.
2. **No load numbers.** One board, two subscribers, ≤17 tasks, single process.
   No concurrency sweep, no memory/CPU per connection, no 1000-task board frame
   timing (the REST baseline measured 442 B/task / ~442 KB per read at 1000
   tasks, so one full-snapshot frame per change is the thing to coalesce harder
   before this ships).
3. **Auth edge cases.** `/events` self-authorizes (it must: WS upgrades bypass the
   dashboard's HTTP middleware). Consequences: a shared `KANBAN_GANTT_WS_TOKEN`
   is the only option today, and `pluginSocket` in hermes-agent hardcodes
   `?token=` while gated/OAuth remotes only mint tickets — so on those remotes the
   socket door will not authenticate and the client correctly falls back to
   polling. Fixing that is an upstream core change (`websocket-options.md` B2),
   out of scope here. R15 is respected (the presented credential is never logged),
   but a query-string token still lands in proxy logs.
4. **Multi-instance fan-out is not solved.** `BoardStream` + `HUB` are per-process,
   so a write on worker A does not reach a client on worker B. Needs a shared bus
   (redis pub/sub, NATS, `LISTEN/NOTIFY`) or sticky routing.
5. **Writes are still REST** (R12 by design): the socket is read-only, and the
   page still invalidates/refetches after a mutation.
6. **No `?since=` cursor / replay.** Version gaps trigger a full REST resync
   instead of a delta replay; `version` exists for that and is unused server-side.
7. **`/gantt?board=all` is not offered over the socket** — one board per handshake
   (R9 fan-in would need a multiplexed subscribe protocol), so the all-boards view
   stays on polling.
8. **Heartbeat is data-level, not protocol-level**, because the SDK door is
   receive-only: a dead peer is noticed by the server's receive timeout (~250 ms)
   and by the client's idle timer, not by ws ping/pong.
9. **Single-process, single-thread-pool per board** remains the model; the
   change feed is `PRAGMA data_version` + file mtime/size polling inside the
   server (250 ms), not a kanban_db write hook.

## Surprises versus the requirements list

* **R8/R7 bug found by the proof, fixed here.** `WsConfig.grace_s`
  (`KANBAN_GANTT_WS_GRACE_S`) was declared and documented but never used:
  `BoardStream.detach()` dropped the stream the instant the last client left, so
  the version counter restarted at 1 on every reconnect — a reconnecting client
  would read a *lower* version than it had rendered. P10 was the only failing
  check; the grace window is now implemented (and the loop idles without DB reads
  while it waits), which is what makes P10 pass.
* **The 60 s poll was also the timeline's "now" cursor.** Removing it needed R6's
  local 30 s tick; this is easy to miss because the poll doubles as a re-render
  trigger, not just a fetch.
* **Coalescing is not optional.** Raw push-on-change measured 4.2× the poller's
  bandwidth under a 0.5 s change rate (`ws-simulator-README.md`); the debounce
  window plus the "keep at most one pending frame per client" queue is what makes
  the trade-off favourable, not the transport itself.
* **`_board_db_path` pins `HERMES_KANBAN_DB` first** (`polling-baseline.md`
  reproduced it): with that env set — as the dispatcher sets it in every worker —
  a request for `?board=sumaris-pod` returns the pinned board's rows relabelled.
  The socket route inherits the same function, so any real deployment must not
  run the gateway with `HERMES_KANBAN_DB` pointing at one board.

## Also present in this working tree (not part of the spike)

`src/main.ts`/`src/i18n.ts`/`src/core/gantt-core.ts` also carry a board-slug
scoping fix (per-connection `board.<scope>` storage key + "this board is not on
this gateway" copy instead of blaming the backend). It was in the tree when this
prototype was committed and is kept in the same throwaway branch rather than
discarded; it is unrelated to the websocket work and should be reviewed/landed
separately.
