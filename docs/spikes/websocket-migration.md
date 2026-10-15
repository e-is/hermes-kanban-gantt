# Inventory — the polling loops and their integration points

Scope: **e-is/hermes-kanban-gantt** (plugin 1.6.0) plus the Hermes dashboard/gateway that mounts it.
Snapshot: `e3cd500`, 2026-10-15. Card `t_33c25eb9` (board `gantt-demo`).

Purpose: the earlier research notes (polling audits, load baseline) were deleted when
`websocket-recommendation.md` was written (§1 of that file says so), so the websocket work has no
inventory to point at. This note restores it: every polling loop, its owner module, its consumer,
and the constraints a push design has to respect.

Companions: `websocket-recommendation.md` (go/no-go, measured numbers), `websocket-protocol-design.md`
(wire contract, requirements R1–R20), `../TODO.md` (open hardening items).

## 1. Table of loops

Cadences are the shipped defaults; env knobs are named where they exist.

| # | Loop | Owner module | Cadence / backoff | What it fetches or checks | Consumer | Error / retry | State it mutates |
|---|---|---|---|---|---|---|---|
| L1 | **Gantt snapshot poll** — the loop the spike targets | `src/main.ts` (`KanbanGanttPage`, `useQuery(['kanban-gantt','gantt', apiBase(), board])`, ≈ L2371–2375) | `refetchInterval: 60_000`, demoted to `300_000` while `wsState === 'live'` | `GET /gantt?board=<slug>` → tasks + labels + link graph | the page: tree rows, bars, ruler; `relationsOf()` for the drawer's parent/child chips; label filter counts | react-query default (3 tries, exponential); the last good snapshot stays painted, `isError` only decorates the header | react-query cache entry `['kanban-gantt','gantt',base,board]` only. The push (`src/ws.ts`) writes the *same* key via `setQueryData`, so nothing downstream changes |
| L2 | **Board list poll** — declared twice, one cache entry | `src/main.ts` (≈ L2342–2346) and `src/ui/TitlebarBoardSwitcher.tsx` (L16–20); same `queryKey: ['kanban-gantt','boards',apiBase()]` | `refetchInterval: 5 * 60_000` | `GET /boards` → `list_boards`: walks `<boards_root>/*/`, keeps dirs with `kanban.db`, parses each `board.json` for the label | titlebar board switcher (labels + per-board counts), page's default board resolution | react-query retries; dropdown falls back to `—` and to the stored slug | cache entry only; explicitly invalidated when the user switches board |
| L3 | **Projects list** (cache TTL, no interval) | `src/state.ts::fetchProjects` ← `NewTaskDialog` | `staleTime: 60_000` — refetch on mount when stale | `GET /projects` | project picker in the "new task" dialog | error surfaced in the dialog | cache entry only |
| L4 | **Profile list** (cache TTL, no interval) | `src/state.ts::fetchProfiles` ← `main.ts` (≈ L2356–2360) | `staleTime: 60_000` | `GET /profiles` | assignee choices (drawer, bulk bar, new-task dialog) — the board's own assignee list is empty before the first assignment | error surfaced in the picker | cache entry only |
| L5 | **Open task detail** (no interval) | `src/main.ts` `TaskDrawer` (`useQuery(['kanban-gantt','task', apiBase(), board, shownId])`, ≈ L1641–1645) | none — `enabled: Boolean(shownId)` | `GET /tasks/<id>?board=<slug>` (task + latest summary + parents/children + attachments metadata) | the drawer | explicit `refetch()` after every drawer mutation; no background refresh | cache entry only |
| L5b | **Attachment list + content** (no interval) | `src/main.ts` `AttachmentMenu` (≈ L1416–1420) and `AttachmentPreview` (≈ L1485–1488) | none — fetched on hover/click and per preview | `GET /tasks/<id>/attachments` (names only), `GET /tasks/<id>/attachments/<aid>/content` (the blob) | the per-row paperclip menu, the markdown/PDF preview dialog | react-query retries; the row simply shows no files on error | cache entries `['kanban-gantt','attachments',…]` / `['…','attachment',…]` |
| L6 | **Timeline "now" cursor tick** | `src/main.ts` `KanbanGanttPage` (≈ L2444–2449) | `setInterval(…, 30_000)`, **only while `wsState === 'live'`** | fetches nothing — bumps `nowTick` | bar/ruler "now" line, running-arc advance. Existed because the 60 s poll used to advance it (R6) | n/a (cleared on state change) | React state `nowTick` |
| L7 | **Server change watcher** — the push's own poll | `dashboard/plugin_ws.py::BoardStream._loop` | `poll_s` 0.25 s (`KANBAN_GANTT_WS_POLL_MS`, floor 25 ms) + `debounce_s` 0.3 s (`…_DEBOUNCE_MS`, coalescing window R5); heartbeat frame every 20 s (`…_HEARTBEAT_S`) when idle | `PRAGMA data_version` + `stat().st_mtime_ns` + `st_size` on a long-lived read-only SQLite connection; on change, one `_read_gantt(slug)` and a fan-out to N subscribers | every `/events` subscriber (`src/ws.ts`) | exceptions are logged and the loop continues; a vanished/unreadable board file → signature `None` → tick skipped; a failed snapshot read → no frame, `_last_sig` still advances | `BoardStream.version` (monotonic per board), `_last_sig`, `last_push_at`. The stream outlives its last subscriber by `grace_s` (60 s, `KANBAN_GANTT_WS_GRACE_S`) |
| L8 | **Client socket lifecycle timers** — the scheduler of the *fallback* | `src/ws.ts` + constants in `src/core/ws-core.ts` | first-frame timeout 5 s; idle timeout 50 s (`WS_IDLE_MS` = 2.5 × the server's 20 s heartbeat); retry: full-jitter backoff 0.5–10 s, **exactly one** (`WS_MAX_ATTEMPTS = 1`, R19); re-arm 5 min (`WS_REARM_MS`) | nothing is fetched: silence is the signal (the SDK door has `onMessage` only, no `onOpen`) | the page: `wsState` decides the poll's cadence (L1) and the Refresh button's visibility | after the retry budget it reports `dead` → polling for good, then re-arms itself every 5 min so a gateway restart heals | persisted storage `wsState`, `wsOff` (the *reason* push is off) |
| L9 | **Per-connection liveness probe** | `dashboard/plugin_ws.py::attach` (≈ L576) | `asyncio.wait_for(ws.receive(), timeout=config.poll_s)` — every 0.25 s, per socket | a client message, or a disconnect | the handler's `while not sub.closing` loop; the first `Exception` (or a disconnect message) ends the subscription cleanly | a timeout is the normal path; a real error breaks the loop without logging | `Subscriber.closing` |

### Timers that are *not* production loops (listed so nothing is unaccounted for)

* `docs/spikes/ws-simulator/poller.py`, `bench.py`, `ws_client.py`, `bench_restart.py` — the baseline
  poller and the benchmark's synthetic server; throwaway harness (no DB, no real fan-out).
* `docs/spikes/harness/measure.py`, `pinning_repro.py`, `serve.py` — load harness `time.sleep()` /
  `subprocess.poll()`; measurement code, never shipped.
* `scripts/shots.py` — screenshot automation `asyncio.sleep()`; dev tool.
* `src/main.ts` ≈ L1325 `setTimeout(() => URL.revokeObjectURL(url), 10_000)` — object-URL cleanup, not a fetch loop.
* `desktop/plugin.js`, `desktop/ws-core.js`, `desktop/gantt-core.js` — **build outputs** of `src/`
  (`scripts/build.mjs`); they carry copies of the loops above and must never be counted twice.
* `tests/ws_proof.py` — instruments an HTTP counter to prove *nothing* polls while the push is live (P7).

## 2. Integration points

### Producers (server-side)

* `dashboard/plugin_api.py::get_gantt` → `_read_gantt(slug)` (one board) / `_read_gantt_all()`
  (`all`/`*` fan-in). Read-only SQLite (`mode=ro`) over `tasks`, `task_links`, `task_runs`
  (`_run_windows`), `task_attachments` (counts only), in that order, plus `<board>/board.json`
  is *not* read here — only `list_boards` reads it.
* `plugin_api.py::list_boards` — filesystem scan of the boards root on **every call** (no cache):
  directory listing + `board.json` parse per board.
* `plugin_api.py::list_projects`, `list_hermes_profiles`, `get_task`, `list_task_attachments`,
  `get_attachment_content`.
* **Writers (all REST, unchanged by the spike)** — `bulk`, `status`, `comments`, `assignee`,
  `description`, `create`, `move`, `parent` add/remove. Out-of-process writers (the kanban
  dispatcher, the CLI, other Hermes agents) are the reason `PRAGMA data_version` moves at all, and
  why the watcher's connection must be long-lived (L7).
* Data stores: `$HERMES_HOME/.../boards/<slug>/kanban.db` (+ `board.json`, attachment blobs).
  `HERMES_KANBAN_DB` / `HERMES_KANBAN_BOARD` pin a board for workers — see the pinning trap in
  `websocket-recommendation.md` §4.1.

### Consumers (client-side)

* `KanbanGanttPage` — the gantt cache (L1): `data.tasks` feeds `treeRows`, bars, ruler, filters,
  search, the list view; `data.labels` feeds the label chips.
* `TaskDrawer` — same snapshot for `relationsOf()` (parent/child chips, R1 shape) plus its own
  `GET /tasks/<id>` (L5); the timeline and the drawer share `tasks` from one cache entry, so a push
  frame updates both.
* `TitlebarBoardSwitcher` (titlebar `titleBar.center` slot) — the boards cache (L2).
* `NewTaskDialog` — projects/profiles (L3/L4).
* `MoveTaskDialog`, `ReparentChooser`, bulk-action bar — write paths only; they invalidate
  `['kanban-gantt']` afterwards.
* Doors (SDK): `ctx.rest`, `ctx.storage`, `ctx.socket('/events?board=<slug>', onMessage) → dispose`,
  `host.state.connectionId` (a gateway switch re-subscribes, `$connectionScope`).

### Boundary (not this repo)

The gateway mounts the plugin router under `/api/plugins/kanban-gantt/…` and registers `/events`
only when `KANBAN_GANTT_WS` is not `0`; the desktop SDK owns the socket transport; the plugin owns
the change detection, the version counter and the frame shape.

## 3. Constraints a websocket design must respect

**Auth / session.** Starlette's HTTP middleware does **not** run for the `websocket` scope, so
`/events` authenticates inside the handler (`plugin_ws.authorize`): (1) an explicit
`KANBAN_GANTT_WS_TOKEN`, constant-time compared; (2) otherwise the dashboard's canonical gate
`hermes_cli.web_server_chat._ws_auth_ok` (loopback `?token=`, gated `?ticket=` / `?internal=`) — the
same gate the bundled kanban plugin uses; (3) standalone dev server (no `hermes_cli`) → loopback
clients only; (4) **fail closed** — a gate that raises is a refusal, never a fallback to rule 3,
because behind a loopback reverse proxy every client looks like `127.0.0.1` and anyone would get
task titles and bodies. Consequences for the design: reuse this mechanism, never invent a second
one (R16); a bearer token arrives via `?token=` or an `Authorization: Bearer` header; the presented
credential is never echoed to the log (R15); ticket-based auth for **remote/OAuth** desktops is
*not* available — the SDK's `pluginSocket` would have to support tickets (upstream change).
Coverage: `tests/test_plugin_ws_auth.py`, plus the gateway probe `G1` (unauthenticated upgrade
refused).

**Multi-instance / horizontal scaling.** `HUB` is an in-process `dict[board → BoardStream]` and the
frame version counter lives in that process only: a restart — or a second uvicorn worker, or a
second gateway — numbers from 1 again. There is **no cross-process fan-out** (no redis/NATS/PG
`LISTEN/NOTIFY`), so more than one worker serving `/events` requires sticky sessions *and* still
loses version continuity across a reconnect landing on another worker. A DB-backed cursor (the
official kanban plugin's `?since=<id>` over `task_events`) is the designed-but-unimplemented
replacement (`../TODO.md`, "Multi-process / replay"). One board = one watcher thread-pool read
regardless of subscriber count (R11), so per-process cost scales with **boards watched**, not with
windows open.

**Proxy / timeouts.** uvicorn disables its protocol-level ping on loopback and the SDK door is
receive-only, so there is no ping/pong: liveness is a **data-level** heartbeat frame every 20 s and
a **client-side** idle window of 50 s (R19). Any proxy/ALB in front must therefore tolerate ≥ 50 s
of idle websocket traffic and must not strip `Upgrade`. The HTTP poll is kept forever as the
degradation path — 60 s, demoted to 300 s while the socket is `live` — and a push outage never
blanks the page (R20); the Refresh button appears only while the state is `off`/`dead`. The
client's first-frame timeout is 5 s, which is what distinguishes "connected and idle" from "never
connected" given the missing `onOpen`. Handshake/bearer credentials travel in the query string
(they land in proxy logs — a reason to keep the ticket/token short-lived).

**Reconnect expectations.** The SDK door already reconnects on close, and the plugin adds one
full-jitter retry for the *never-opened* case, then parks on polling and re-arms every 5 min.
A forced network drop must yield a **full snapshot as the first frame** after reconnect (R8; proof
P10). A gateway restart closes every socket with 1012 and resets the version: the client treats a
version *below* the last applied one as a **new stream** and restarts its baseline (fix in
`src/core/ws-core.ts::classifyFrame`; `websocket-recommendation.md` §1 still lists this as an open
defect found at `9b086e4` — the two need reconciling, see open question 8). A gap inside a stream is
not fatal: every frame is a full snapshot, so it is applied and the REST query is re-validated behind
it (R7).

**Environments where websockets are blocked or unavailable** (all must keep working — the poll is
the fallback, never a blank page):

* gateway started with `KANBAN_GANTT_WS=0` → `/events` is never registered (404), R20/P11;
* client opted out with storage `ws = '0'` (accepts `0`, `false`, `'false'` as off);
* a **custom backend base URL** (`$baseUrl` non-empty) → the SDK socket door only speaks to the
  plugin's own namespace, so the page stays on the poll (`src/main.ts` `wsBoard`);
* the **all-boards view** (`all` / `*`) → no single database to watch, the server refuses it and the
  view stays on the poll (R9 covers per-board subscribe only; the multiplexed variant is a TODO);
* a host whose SDK provides no `ctx.socket` (`no-door`) — recorded in storage as `wsOff` so a
  silent degradation is diagnosable from outside the packaged build;
* corporate proxies / clients that cannot do `ws://` → SSE is the documented transport fallback
  (`websocket-recommendation.md` §6), still unimplemented.

## 4. Open questions

1. **Watcher cost on a live board.** The 0.25 s signature poll per subscribed board is unmeasured
   on a board with a running dispatcher; it is the one number that could move the verdict.
2. **Frame size / p95 on a real large board.** The REST body was 441 550 B on the synthetic
   1 000-task board (`results/big.json`), and a frame carries the same shape; the 239-task
   `sumaris` board has never been pushed to.
3. **One source for the heartbeat.** Server `WsConfig.heartbeat_s` (20 s, env-overridable) and
   client `WS_HEARTBEAT_MS` (build-time, in a 20 s : 50 s ratio) can drift; the server should
   announce its period.
4. **Observability.** No counters for live connections per board, frames sent, DB reads, handshake
   rejects by reason, slow-consumer closes (4408) or resyncs; no live/degraded badge in the UI.
5. **Multi-worker deployment.** Sticky sessions + a DB-backed cursor + replay: designed in prose,
   nothing implemented or tested.
6. **Remote/OAuth desktops.** Ticket-based ws auth needs upstream `pluginSocket` support.
7. **`all` over the socket.** `?boards=a,b` with a per-board version map and a client-side merge is
   undesigned; today the fan-in view simply polls.
8. **Reconcile the restart defect.** `websocket-recommendation.md` §1 (annotated at `9b086e4`) lists
   "the client discards the restarted process's snapshots as stale and quietly stays on the 300 s
   poll" as *still open*; `src/core/ws-core.ts` at `e3cd500` implements the opposite rule and
   documents it as fixed. Which is authoritative, and is it verified on the running desktop?
9. **Version taken on subscribe.** Every new subscriber consumes a version from the shared counter,
   so the other windows on that board see a gap at the next change and do one extra REST read.
   Worth a per-board "last version handed out" rule?
10. **Browser timer throttling.** Both remaining client loops (L1's `refetchInterval`, L6's 30 s
    tick) are timers: what happens to a backgrounded window (throttled to ~1/min) when the push is
    `off` or `dead` — is the Refresh affordance reachable in that state?
11. **`list_boards` cost.** It re-scans the boards root and parses `board.json` per board on every
    request, on a 5 min interval per window; on a host with many boards this may deserve the same
    treatment as `/gantt` (or at least an mtime-based cache).