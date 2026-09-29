# Current state of the polling loop + requirements for a websocket replacement

Task: t_b9555592 (parent spike t_63df2244 "replace the polling loop with websockets").
Scope: the desktop plugin **e-is/hermes-kanban-gantt** — the Gantt board view in Hermes
Desktop. Working tree `/home/blavenie/git/hermes-kanban-gantt`, branch `main` @ `c7945f2`
(the only commits ahead of the previously documented `75a31e7` touch `tools/` + `docs/`,
so every source line below was re-checked at `c7945f2`).
Supporting checkouts: hermes-agent @ `/home/blavenie/git/hermes-agent` (`7722068a99`) and the
installed/live copy inside the gateway container (`/opt/data/plugins/kanban-gantt`, plugin.yaml
v1.1.0).

Everything marked *measured* was produced by `measure.py` in this workspace, run against the
plugin's own FastAPI router inside the live gateway container
(`/opt/hermes/.venv/bin/python3`, fastapi 0.133.1 / starlette 1.3.1); raw output in
`measurements.txt`, 200 cold-ish requests per endpoint.

## 1. There is no timer in the plugin

`grep -rn "setInterval|setTimeout|requestAnimationFrame|poll|cron" src/` → **no hits**.
Every periodic refresh is React Query's `refetchInterval`:

| # | Loop | Interval | Code | Notes |
|---|------|----------|------|-------|
| A | Gantt board snapshot | `60_000` (60 s) | `src/main.ts:1358-1362`, built `desktop/plugin.js:2339` | the loop that matters — the only path by which writes made *outside* the UI (dispatcher, CLI, other agents) reach the view |
| B | Board list | `5 * 60_000` (5 min) | `src/main.ts:1339-1343` (`plugin.js:2324`) **and** `src/ui/TitlebarBoardSwitcher.tsx:16-20` (`plugin.js:427`) | identical `queryKey: ['kanban-gantt','boards',apiBase()]` → React Query dedupes the two observers into **one** request per interval |
| C | Task drawer | **none** | `src/main.ts:883-887` | refetch is explicit: mutation `onSuccess` `void refetch()` at `main.ts:915, 924, 932, 943`; status/assignee/unlink also `invalidateQueries(['kanban-gantt','gantt', …])` (`:916, 933, 944`, keyless at 944) |
| D | Projects / profiles | none (`staleTime: 60_000`) | `src/main.ts:1346-1357` | mount-time reads only |
| E | Manual Refresh + board switch | none | `src/main.ts:1794` (Refresh), `TitlebarBoardSwitcher.tsx:29` (switch) | both `invalidateQueries(['kanban-gantt','gantt'])` |

Inherited client defaults (desktop's shared client,
`hermes-agent/apps/desktop/src/lib/query-client.ts:6-13`): `refetchOnWindowFocus: false`,
`staleTime: 60_000`, and `refetchIntervalInBackground` left at its default **false** — so an
unfocused window's 60 s interval is paused.

Two extra client-side clocks that ride on loop A (easy to lose in a migration):
`src/main.ts:1653` computes the timeline "now" cursor with `Date.now()` at render, and
`src/core/gantt-core.ts:228` uses "now" in the domain/window maths. Today the 60 s poll is what
advances "now" and the still-open run arcs; a push-only design needs its own local tick or the
timeline freezes.

### Data door and endpoint

`src/state.ts:38-57` `apiFetch` → `ctx.rest(path, {method, body})` = `/api/plugins/kanban-gantt<path>`;
with a custom "backend API" base URL it is a raw `fetch` with **no auth header at all**
(`src/state.ts:40-49`). `register()` wires only `ctx.rest` + `ctx.storage`
(`src/main.ts:1973-1979`); the SDK's `ctx.socket` is declared in `src/sdk.d.ts:21` but never called
(`grep socket src/` → only that declaration).

Loop A/B hit `dashboard/plugin_api.py`:

| Endpoint | Line | What it does |
|---|---|---|
| `GET /boards` | `:233-251` | lists `<root>/kanban/boards/*/` + `board.json`; returns `{boards:[{slug,label}], current}` |
| `GET /gantt?board=<slug>` | `:356-360` → `_read_gantt` `:254-299` | one `mode=ro` sqlite connection (`_connect :122-131`), rebuilds the whole snapshot: all `tasks` rows, the full `task_links` graph (`:267-283`), per-task run windows/history from `task_runs` (`_run_windows :163-207`), derived `labels` counts |
| `GET /gantt?board=all` | `_read_gantt_all :302-353` | opens **every** board DB in sequence and merges |
| slug validation | `_board_db_path :92-107` | strips `/`, rejects `.`/`..`/slashes → 400; missing file → 503 |

Snapshot shape (the contract a push frame must carry unchanged): `{board, generated_at (unix s),
tasks[], labels[]}`; each task `{id,title,status,assignee,priority,label,board,archived,created_at,
started_at,completed_at,run_started_at,run_ended_at,runs[],children[],parents[]}` — task *bodies*,
comments and events are **not** in it. No ETag / `Cache-Control` / delta / pagination: the entire
snapshot is rebuilt and re-serialized every tick.

### Measured cost of one tick (live board root inside the gateway)

| board | tasks | payload | p50 | p99 | max |
|---|---|---|---|---|---|
| cesium | 2 | 1 776 B | 1.4 ms | 2.4 ms | 2.4 ms |
| obsfish | 2 | 2 241 B | 1.4 ms | 2.5 ms | 4.0 ms |
| obsmer | 10 | 138 795 B | 7.0 ms | 8.2 ms | 8.8 ms |
| obsbio | 11 | 28 512 B | 2.1 ms | 3.1 ms | 3.2 ms |
| obsventes | 24 | 25 736 B | 2.3 ms | 3.8 ms | 4.2 ms |
| sumaris-pod | 56 | 76 225 B | 4.0 ms | 5.1 ms | 34.8 ms |
| sumaris | 239 | 271 583 B | 11.5 ms | 12.6 ms | 41.9 ms |
| **`all`** | **344** | **544 291 B** | **22.4 ms** | **24.0 ms** | 45.8 ms |

`GET /boards` is 307 B / 1.1 ms. So a tick is cheap in CPU but **not** in bytes: the board a user
actually watches here is `sumaris` (272 KB) or `all` (544 KB) — 60×/h per open window, and the
`runs[]` history dominates the size (≈0.8–1.1 KB per task vs ≈300 B before run history existed).
`refetchIntervalInBackground:false` means each window only pays while focused.

### Failure / retry behaviour today

No explicit handling anywhere in the plugin. React Query's defaults apply: 3 retries with
exponential backoff per failed fetch, `refetchInterval` keeps firing regardless, and the page keeps
painting the last good snapshot with no staleness UI (`generated_at` is written by the backend but
read by **no** frontend code — `grep generated_at src/` → 0 hits). A backend that is down = a
silent request loop; a 500 (e.g. schema drift) is absorbed the same way.

## 2. The push plumbing already exists on both sides

This is the single most useful finding for the prototype: the transport and the reconnect loop are
written, tested and unused.

* **Client door** — `@hermes/plugin-sdk` `ctx.socket(path, onMessage) → dispose`, implemented as
  `pluginSocket` (`hermes-agent/apps/desktop/src/api/plugins.ts:95-147`, wired at
  `apps/desktop/src/contrib/plugin.ts:293`, typed at `:116`). It already does: URL
  `ws(s)://<backend>/api/plugins/<id><path>?token=<connection.token>` (`plugins.ts:111-115`),
  JSON-frame parse (`:117-125`), full-jitter exponential backoff 500 ms → 30 s on close
  (`:127-138`), disposal (`:143-146`). It exposes **`onMessage` only** — no `onOpen`/`onError`, so a
  plugin cannot distinguish "connected" from "silently failing".
  Two gates are written into the source: `authMode === 'oauth'` returns early (`:107-109`) and the
  SDK doc-comment says *"treat it as an accelerator over your polling, never a replacement"*
  (`contrib/plugin.ts:112-114`). `authMode` only ever takes `'oauth' | 'token'`.
* **Server door** — the plugin router is mounted with `include_router(prefix="/api/plugins/<name>",
  dependencies=[Depends(_plugin_route_secret_scope)])` (`hermes_cli/web_server_dashboard.py:878-882`).
  Verified in the live container: `@router.websocket("/events")` mounts as
  `APIWebSocketRoute /api/plugins/<name>/events` **and receives the router-level dependency**
  (fastapi 0.133.1 `add_api_websocket_route(path, endpoint, name=None, *, dependencies=…)`).
  Core already ships WS routes to copy from: `hermes_cli/web_routers/chat_ws.py` (router included at
  `web_server.py:1036`) with `_ws_auth_ok` / `_ws_auth_reason`
  (`hermes_cli/web_server_chat.py:220-300`) — loopback/token backends accept legacy `?token=`
  (constant-time compared), **gated** dashboards reject `?token=` and require `?ticket=` (single-use,
  30 s TTL) or `?internal=`.
* **Auth gate caveat** — every dashboard gate is registered as `@app.middleware("http")`
  (`web_server.py:624-727`), and Starlette's HTTP middleware does not run for the `websocket` scope.
  A `@router.websocket` route is therefore **not** protected by the token/cookie middleware that
  protects `GET /gantt`; the route must authenticate itself (exactly as `chat_ws` does).
* **What must be built new** — the push side: nothing watches the board DB today. Needs a per-board
  change watcher (`PRAGMA data_version` / mtime poll per connection, or a `kanban_db` write hook), a
  debounce, a per-board subscriber registry, and a first-frame contract (initial full snapshot) so a
  client can only drop its 60 s interval *after* a snapshot arrives.

## 3. Requirements the replacement must satisfy

Grounding: today's behaviour is the floor, the measured table above is the budget.

**Payload / parity**
- R1. A push frame must carry the *same* `{board, generated_at, tasks[], labels[]}` shape with the
  same per-task keys, so the renderer, the filter facets and the drawer's
  relations-from-snapshot assumption (`src/main.ts:906-908`) need no change. A delta protocol is
  allowed only if it produces that shape client-side.
- R2. One message = one generation: `tasks`, and each task's `runs`/`parents`/`children`, must come
  from the same read. Never push a link graph or run list that disagrees with its rows.
- R3. Budget per push ≤ 600 KB / ≤ 50 ms of server CPU for the board set measured here (`all` = 544 KB,
  22 ms today). Above that, coalesce or delta — do not push the full snapshot per change.

**Latency / frequency**
- R4. Change-to-render **p95 ≤ 2 s** for writes made outside the UI (dispatcher, CLI, other agents),
  vs. 30 s mean / 60 s worst today. UI mutations keep their sub-second `invalidateQueries` path
  (`main.ts:916,933`) and must not regress.
- R5. Server-side coalescing window 200–500 ms per board, so a burst of worker writes yields one
  frame; at most one pending frame per subscriber (drop-and-coalesce, never queue). Close a client
  whose send buffer stays full.
- R6. The client keeps a local tick (30–60 s) for the "now" cursor and open run arcs even with no
  pushes (`main.ts:1653`, `gantt-core.ts:228`).

**Ordering / consistency**
- R7. Every frame carries a monotonic per-board version (or the existing `generated_at`); the client
  applies strictly-newer frames and treats a gap as "resync" (re-fetch `/gantt`).
- R8. First frame after subscribe/reconnect is a full snapshot, so the client can drop the interval
  only once it has applied one.

**Subscription / fan-out**
- R9. Subscribe per board slug; `all`/`*` subscribes to every board (fan-in). Changing board
  re-subscribes and must not leak the old subscription.
- R10. Slug validation identical to `_board_db_path` (`:92-107`) — the ws must reject `../`, `.`,
  `..`, slashes with the same rule.
- R11. One DB read per board per debounce window, fanned out to N subscribers — never a read per
  client. Unknown/renamed boards on the `all` fan-in must not kill the whole stream.
- R12. Writes stay on REST (`PATCH/POST /tasks/*` via `kanban_db` mutators). The socket is a
  read/notification channel only.

**Auth / deployment**
- R13. Reuse the desktop session credential, no new secret: `pluginSocket` appends
  `?token=<connection.token>`. The server route must validate it (or fail closed) — it is *not*
  covered by the HTTP auth middleware.
- R14. Gated/cookie and OAuth remotes must degrade cleanly: `pluginSocket` no-ops for `oauth`, and
  gated dashboards reject `?token=`. In both cases the 60 s poll must remain, and the UI must never
  stall or blank.
- R15. `?token=` in a URL lands in gateway logs — confirm redaction, or prefer a ticket-style
  handshake.
- R16. Standalone mode (`create_app(allow_cors=True)`, `main()` `plugin_api.py:955-986`, default bind
  `127.0.0.1:8765`, no auth, CORS `*`) must not gain a wider socket: keep the loopback bind or
  require a token before exposing a ws route.
- R17. Deployment shape: the gateway is a **long-lived process** (uvicorn + FastAPI in the
  `sumaris-agent_hermes_1` container, `hermes dashboard --port 9119`), not serverless — long-lived
  connections are viable. No proxy/LB in front locally; a remote/cloud gateway would sit behind one,
  so idle timeouts and `Connection`/`Upgrade` handling are unverified there.

**Liveness / failure**
- R18. Client reconnect: full-jitter exponential backoff with a cap, plus heartbeat ping/pong and
  dead-connection detection (the plugin must add the heartbeat; `pluginSocket` has only the
  reconnect). Resume from the last applied version, full snapshot on first connect or after a gap.
- R19. Because `onMessage` is the only callback, the plugin needs its own "first frame arrived
  within N s" timeout to decide the socket is dead and fall back to polling.
- R20. Failure parity: a 500 / missing DB currently leaves the last snapshot painted. A push design
  must do the same — a failed handshake or a dropped socket falls back to the 60 s interval, never to
  a blank page.

## 4. What can verify a migration

- Backend: `tests/test_plugin_api.py` (35 test functions: `test_gantt_snapshot`, `test_gantt_all_boards`,
  `test_gantt_rejects_traversal`, task CRUD/links/status) via `bash tests/run_tests.sh` (isolated uv
  venv, `HERMES_AGENT_HOME` override). These pin the REST contract the push must mirror.
- Frontend: `npm test` → `tests/gantt-core.test.mjs`, `tests/rest-method.test.mjs`,
  `tests/ui/esm-render.mjs` (renders the page with a stubbed SDK — including a stubbed `useQuery`,
  which is where a socket-driven variant would be injected).
- Desktop side already has socket tests to mirror: `apps/desktop/src/plugin-socket-scope.test.ts`
  (active-gateway scoping, the `oauth` early-return) and
  `apps/desktop/src/api/plugins.test.ts` (the hung-IPC timeout).
- Server-side contract test for the ws: mount the plugin router in a FastAPI app and assert
  (a) `/events` upgrades and (b) the router-level dependency runs — the second is what FastAPI
  0.133.1 supports but nothing in this plugin has ever exercised.
- Metrics to capture before/after: requests/hour per window (today 60 × `/gantt` + 12 × `/boards` =
  72), bytes/hour (272 KB × 60 ≈ 16 MB/h for `sumaris`, 32 MB/h for `all`), change-to-render p95,
  and the server cost per push under the 200–500 ms debounce.

## 5. Two environment facts that will bite

1. **Two board roots.** Inside the gateway container `_boards_root()` resolves to
   `/opt/shared/kanban/boards` (= `~/git/sumaris/sumaris-agent/data/kanban/boards` on the host), which
   holds cesium/obsbio/obsfish/obsmer/obsventes/sumaris/sumaris-pod. The kanban home of *this*
   worker is `/home/blavenie/.hermes/kanban/boards` (gantt-demo, obsventes, sumaris-pod). The root is
   `KANBAN_GANTT_BOARDS` / `hermes_cli.kanban_db.boards_root()`-dependent, so any watcher must resolve
   boards through the same helpers, not hard-code a path.
2. **The deployed artifact lags the repo.** The container has plugin.yaml **v1.1.0** while the
   checkout declares **v1.3.0** (`plugin.yaml:2`; `package.json` says 1.2.0 — the two are already out
   of step in-tree); the installed `plugin.js` (md5 `b6dc9221a2dc470f5b50f83354b048f4`) has the
   same three intervals (`:266`, `:1473`, `:1478`) but not the same line numbers as the repo build.
   Quote source lines, and re-build + `hermes plugins install` before any before/after measurement.
