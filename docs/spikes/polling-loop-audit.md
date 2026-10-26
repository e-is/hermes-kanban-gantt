# Polling-loop audit — the contract a websocket must beat

Scope: **e-is/hermes-kanban-gantt** at `3aee9c0` (plugin `1.7.1`, `plugin.yaml:2`), plus the Hermes
desktop host that owns the query client. Date: 2026-10-26.
Audience: someone about to replace the poll with a push. Every claim below carries a `path:line`
reference so it can be checked against the tree, not against this prose.

Companion, older and partly stale: `docs/spikes/websocket-migration.md` (inventory written at
`e3cd500`; its line numbers no longer match and two of its behavioural claims are corrected in
§7 here). This file is the current, verified statement of what runs today.

---

## 1. Which loop is "the" loop

The plugin has **exactly one recurring data fetch that matters**: the Gantt snapshot.
Everything else is a cache TTL, an on-demand read, or a 30 s UI tick that fetches nothing.

| # | Loop | Where | Cadence | Request | Consumed by |
|---|---|---|---|---|---|
| L1 | **Gantt snapshot** | `src/main.ts:3788-3792` (`KanbanGanttPage`) | `refetchInterval: 60_000`; **`300_000` while a push socket is `live`** | `GET /gantt?board=<slug>` | tree rows, bars, ruler, list view, filters, timeline |
| L2 | Board list | `src/main.ts:3759-3763`, duplicated in `src/ui/TitlebarBoardSwitcher.tsx:16-20` (same `queryKey`) | `5 * 60_000` | `GET /boards` | titlebar switcher, default-board resolution |
| L3 | Projects | `src/main.ts:3766-3770` | `staleTime: 60_000`, no interval | `GET /projects` | new-task dialog |
| L4 | Profiles | `src/main.ts:3773-3777` | `staleTime: 60_000`, no interval | `GET /profiles` | assignee pickers |
| L5 | Open task detail | `src/main.ts:2926-2930` | **no interval**, `enabled: Boolean(shownId)` | `GET /tasks/<id>?board=` | drawer |
| L5b | Worker log | `src/main.ts:2950-2954` | no interval, gated on the `log` tab | `GET /tasks/<id>/log` | drawer's log tab |
| L6 | "Now" cursor | `src/main.ts:3861-3864` | `setInterval(…, 30_000)`, **only while `wsState === 'live'`** | *nothing* — bumps `nowTick` | the now-line on the timeline |
| L7 | Attachment list/preview | `src/main.ts:2701-2705`, `2770-2773` | on hover/open | `/tasks/<id>/attachments`, `…/content` | paperclip menu, preview |

Non-production timers (do not count them): `docs/spikes/ws-simulator/poller.py`,
`docs/spikes/harness/measure.py` (measurement harness), `scripts/shots.py` (screenshots),
`src/main.ts:2587` (object-URL cleanup). `desktop/plugin.js` and `desktop/*-core.js` are **build
outputs** of `src/` (`scripts/build.mjs`) — never count the loops twice.

**Fixed or adaptive?** Fixed. The only adaptivity is the two-state demotion of L1 (`60_000` vs
`300_000`, `src/main.ts:3791`) driven by `wsState`, and the fact that react-query pauses interval
refetches while the window is not focused (host default, see §4).

---

## 2. One tick, end to end

### 2.1 Client call

```
src/main.ts:3790  queryFn: () => apiFetch(`/gantt${board ? `?board=${encodeURIComponent(board)}` : ''}`)
src/state.ts:71-98  apiFetch: either `${base}${path}` (custom backend URL) or `rest(path, opts)` (SDK ctx.rest)
src/state.ts:93-94  fetchGantt (same shape; exported for the page)
```

- **Method/params**: `GET`, one optional query parameter `board`. `board` is the board slug, or
  `all` / `*` when the "all boards" scope is selected (`src/core/ws-core.ts:93` `canPush` shows that
  `all` is a real scope the push cannot serve; the same scope is served by polling today).
- **Base URL**: empty (`$baseUrl`) means the plugin namespace through the host bridge
  (`/api/plugins/kanban-gantt/…`); a non-empty base is an absolute URL used by the standalone dev
  backend and by a desktop pointed at a remote backend (`src/state.ts:71-90`).
- **No headers are set** (`src/state.ts:73-81`): no `If-None-Match`, no `Authorization`, no
  `Cache-Control` hints. The response has no ETag/`Last-Modified` either — the route returns a plain
  JSON object (`dashboard/plugin_api.py:470-473`). Every tick is therefore a full 200 with a full body.
- **No abort**: the plugin sets no `queryFn` `signal` (`src/main.ts:3790`), so an in-flight tick is
  not cancelled when a newer one starts (relevant to ordering, §5).

### 2.2 Server route

```
dashboard/plugin_api.py:470-473   @router.get("/gantt") def get_gantt(board: Optional[str] = Query(None))
dashboard/plugin_api.py:139-149   _resolve_board(board)  → HERMES_KANBAN_DB / HERMES_KANBAN_BOARD / current / 'default'
dashboard/plugin_api.py:353-407   _read_gantt(slug)      → one board
dashboard/plugin_api.py:409-467   _read_gantt_all()      → every discovered board, concatenated
```

Cost per tick, one board (all reads on a read-only SQLite connection, `plugin_api.py:151-181`):

1. `_run_windows(conn)` — every `task_runs` row with `started_at NOT NULL`, ordered by id
   (`plugin_api.py:205-247`).
2. `_attachment_counts(conn)` — one `GROUP BY task_id` over `task_attachments`
   (`plugin_api.py:250-259`).
3. `_activity_series(conn)` — one aggregate pass over `task_events` and one over `task_runs`,
   24 buckets × 24 h, bucketed server-side (`plugin_api.py:311-350`).
4. `SELECT … FROM tasks` — no filter, archived included, `body` deliberately excluded
   (`plugin_api.py:362-366`, columns listed in `_task_summary`, `plugin_api.py:183-202`).
5. `SELECT parent_id, child_id FROM task_links` — whole link table, folded into both directions
   (`plugin_api.py:368-379`).

`all` mode repeats 1–5 per board and concatenates (`plugin_api.py:409-467`); the per-board cost is
therefore multiplied by the number of boards on disk, and `list_boards()` re-scans the boards root
(`plugin_api.py:291-309`, filesystem walk + `board.json` parse, **no cache**).

### 2.3 Payload shape and size

```jsonc
{
  "board": "gantt-demo",            // slug, "all" for the aggregate
  "generated_at": 1793024xxx,       // int(time.time()) — changes every tick, by construction
  "tasks": [ {                      // one object per task, _task_summary + enrichments
      "id","title","status","assignee","priority","label","board","archived",
      "created_at","started_at","completed_at","run_started_at","run_ended_at",
      "runs": [ {"id","profile","step_key","status","outcome","started_at","ended_at","error","summary"} ],
      "attachment_count": 0,        // count only, never file names
      "children": ["t_…"], "parents": ["t_…"],
      "activity": [0,0,3,…]         // 24 ints, ONLY for tasks with activity in the window
  } ],
  "labels": [ {"label": "PROJET #123", "count": 4} ]
}
```

Field-by-field origins: `plugin_api.py:183-202` (`_task_summary`), `:205-247` (`runs`),
`:250-259` (`attachment_count`), `:368-379` (`parents`/`children`), `:311-350` (`activity`),
`:394-403` (`labels`).

Measured sizes (JSON, UTF-8):

| Board | Tasks | Body bytes | How measured |
|---|---|---|---|
| `gantt-demo` (live board, 2026-10-26) | 20 | **12,770** | `plugin_api._read_gantt('gantt-demo')` under `~/git/hermes-agent/.venv`, `len(json.dumps(d).encode())` |
| `all` (same data, 3 boards on disk) | 20 | 12,763 | same call, `_read_gantt('all')` |
| synthetic 2,000-task board | — | **441,550** | `docs/spikes/results/big.json` → `/gantt?board=big` |
| 3 real boards (`gantt-demo`), harness | — | 10,764 | `docs/spikes/results/real.json` → `/gantt?board=gantt-demo` |

Latency / server cost, same harness (`docs/spikes/results/real.json`, loopback HTTP, 200 requests):

| Endpoint | p50 | p99 | max | throughput | server CPU/req |
|---|---|---|---|---|---|
| `/gantt?board=gantt-demo` | 1.27 ms | 1.96 ms | 2.33 ms | 705 rps | 0.95 ms |
| `/gantt?board=all` | 2.24 ms | 2.75 ms | 2.95 ms | 459 rps | 1.65 ms |
| `/gantt?board=big` (2k tasks) | 22.9 ms | 41.4 ms | 42.3 ms | 42.5 rps | 22.7 ms |

In-process read cost today: **0.37 ms** median for `gantt-demo`, 0.59 ms for `all` (5 calls,
`time.perf_counter` around `_read_gantt`). So the tick is cheap but **O(tasks + runs + links)** and
unbounded: a 2,000-task board costs ~440 KB and ~23 ms per tick per client.

### 2.4 Auth

The poll carries **no credential of its own**; it inherits the host's session:

- Desktop, plugin bridge: `rest(path, opts)` (`src/state.ts:90-97`) — the SDK's authenticated
  request door to the same-origin gateway; cookies/tickets belong to the host, not the plugin.
- Gateway, HTTP: plugin routes are gated per request by `_plugin_api_request_refused`
  (`hermes_cli/web_server_dashboard.py:895-909`) plus the dashboard's own auth middleware. Observed
  live on the remote gateway: `GET http://127.0.0.1:9119/api/plugins/kanban-gantt/boards` →
  `401 {"error":"unauthenticated","reason":"no_cookie","login_url":"/login"}`.
- Standalone dev backend (`dashboard/plugin_api.py:1569-1583`, `:1657-1671`): **no auth at all**,
  CORS `allow_origins=["*"]` with credentials disabled, bound to `127.0.0.1` by default
  (`KANBAN_GANTT_HOST`). This is the "custom base URL" path in `src/state.ts:71-90`.
- Writes on the same router go through `hermes_cli.kanban_db` mutators (`plugin_api.py:14-25`); the
  reads open SQLite `mode=ro` (`plugin_api.py:23-25`, `:151-181`). The poll is strictly read-only.

Consequence for the replacement: it must reuse this chain and must **not** introduce a second
credential for the frequent path (the push route already does this, `dashboard/plugin_ws.py:187-…`
`authorize`, because HTTP middleware does not run for the `websocket` scope).

---

## 3. What happens on a bad tick

The plugin configures **none** of this; it inherits the host query client:

```
apps/desktop/src/sdk/index.ts:1995        export { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
apps/desktop/src/lib/query-client.ts:7-14 defaultOptions.queries = { refetchOnWindowFocus: false, staleTime: 60_000 }
```

Therefore, for `L1`:

- **Retries**: react-query default — 3 attempts, exponential delay 1 s → 2 s → 4 s (capped 30 s).
  There is no `retry` override on the Gantt query (`src/main.ts:3788-3792`).
- **Backoff**: that is the whole backoff. There is no circuit breaker, no jitter, no cap on how
  often a permanently broken gateway is retried: after the retry budget the **interval keeps
  firing** every 60 s (300 s while live), each cycle burning 3 more requests.
- **Error surface**: a failed refetch is *not* a stale-but-usable page. `isError` is checked without
  a `data` guard:

  ```
  src/main.ts:4722-4735   if (isError) → <ErrorState title={boardMissing?…:cannotLoadBoard} …>
  ```

  So once the retries are exhausted, the timeline is **replaced** by a full-page error state, even
  though the last good snapshot is still in the cache. `isMissingBoardError` gets its own copy
  (`src/main.ts:4422-4425`, `src/main.ts:4725-4731`). This is the current UX contract; a push design
  that blanks the page on disconnect would be no worse, but a design that keeps the stale board
  visible would be a visible behaviour change (arguably an improvement — decide explicitly).
- **Initial load**: `isLoading && !data` → centered `Loader` (`src/main.ts:4719-4721`).
- **No server-side error handling to speak of**: `get_gantt` lets SQLite/`HTTPException` propagate
  (`plugin_api.py:470-473`); a missing board becomes a 404 via `_connect`/`_resolve_board`
  (`plugin_api.py:139-181`). There is **no logging and no metrics** anywhere in
  `dashboard/plugin_api.py` (no `logging` import), so a failing poll leaves no server-side trace.
- `L2` (`/boards`) behaves the same way, and additionally drives the "board disappeared" message in
  `L1`'s error state (`src/main.ts:4422-4425`).

---

## 4. Concurrency, volume, and what it costs

- **Who runs it**: one timer per mounted Gantt page per client. The page is a route component
  (`src/main.ts:3740-3743` `KanbanGanttRoute`, keyed by board); switching board remounts it,
  which starts a fresh observer on a different `queryKey` and an immediate refetch.
- **No shared cache between clients**: the cache is the renderer's `QueryClient`. Two desktops, two
  dashboard tabs, or a desktop plus a browser each poll independently — there is no server-side
  dedupe or fan-in.
- **Volume**: 1 request/minute per open page while push is off (or dead), 1 per 5 minutes while
  live. For the 20-task board that is **~12.8 KB/min ≈ 18.4 MB/day per open page**; for the
  2,000-task board ~441 KB/min ≈ 635 MB/day per open page. `L2` adds 1 request/5 min (no cache on
  the server: it re-walks the boards directory each time, `plugin_api.py:291-309`).
- **Bursts**: opening the page, switching board, or returning focus fires an immediate tick on top
  of the interval; there is no jitter, so N clients started together stay in phase.
- **Rate limits**: none found in this repo. The only gate is the gateway's per-request auth/consent
  check (`hermes_cli/web_server_dashboard.py:895-909`) — cheap, but it is one DB/plugin-list lookup
  per tick per client.
- **Background behaviour**: interval refetches are paused while the window is unfocused
  (`refetchOnWindowFocus: false` and react-query's focus-aware interval), so a minimized desktop
  stops costing anything. Any replacement must keep that property (an idle socket with a 20 s
  heartbeat is *more* traffic than a paused poll — see `plugin_ws.py` heartbeat).

---

## 5. Diffing, deduplication, ordering

- **Server**: none. No cache, no ETag, no `since` cursor, no change detection in `get_gantt`
  (`plugin_api.py:470-473`). `generated_at` is `int(time.time())` (`plugin_api.py:401`, `:463`), so the
  body differs on every tick even when nothing changed.
- **Client**: react-query replaces the whole cache entry (`src/main.ts:3788-3792`). Identity is
  preserved only by react-query's structural sharing (it walks the two objects and keeps the old
  references for deep-equal subtrees); `tasks` arrays are rebuilt because `generated_at` differs but
  individual unchanged task objects keep their identity. No plugin code diffs anything.
- **Ordering**: there is **no sequence number or version** in the payload, and the in-flight request
  is not aborted (`src/main.ts:3790`). Cache content is therefore *last response to arrive wins*,
  which is only safe because ticks are 60 s apart and the read is ~1 ms — but it is not a guarantee.
  The push path adds a `version` counter for exactly this reason (`dashboard/plugin_ws.py`,
  `BoardStream.version`); a replacement that removes polling must not assume the poll had ordering
  guarantees it never had, and must not regress to *worse*.
- **Semantics**: the poll is **at-most-once per interval, full-snapshot idempotent**. Missing a tick
  costs freshness only; there is no event stream to replay and no per-change delivery to duplicate.

---

## 6. Hard constraints the replacement must preserve

1. **Freshness budget**: data is at worst 60 s stale (plus one round-trip) while polling; 300 s
   while live. The push is allowed to be *better*; it must not be worse than 60 s in the fallback.
2. **Same cache entry, same shape**: everything downstream reads
   `['kanban-gantt','gantt', apiBase(), board]` and the exact `/gantt` object
   (`src/main.ts:3788-3792`, consumers at `src/main.ts:3872` and following, drawer relations via
   `relationsOf`, `src/main.ts:2960-2962`). A push must write that key with that shape (this is
   R1 in `docs/spikes/websocket-protocol-design.md`), not introduce a parallel store.
3. **Atomic snapshots**: every tick paints a complete board. No incremental patching that can leave
   a half-updated tree, and no partial frame that drops `parents`/`children` (`plugin_api.py:368-379`).
4. **Fallback is mandatory**: `all` boards, a custom backend base URL, a socket that gives up, and a
   gateway with the push compiled out must all keep working through the 60 s poll
   (`src/main.ts:3786`, `src/main.ts:3838`, `src/core/ws-core.ts:93`).
5. **Auth**: reuse the host's session (bridge/`ctx.rest`, gateway cookie/ticket). Never require a
   second login for the frequent path; never widen the standalone dev server's no-auth surface.
6. **Server cost ceiling**: ≤ 5 SQLite queries + 1 filesystem walk per tick per board, read-only,
   no write lock, no long-lived connection held open on the read path. Any watcher must not turn
   "N clients" into "N scans" — today's poll already scales cost with clients, which is the thing
   the push is meant to fix; do not reintroduce it with per-connection queries.
7. **No new failure mode on error**: today a hard failure replaces the page with `ErrorState`
   (`src/main.ts:4722-4735`) and keeps retrying on the interval. A push must define its own
   error/degradation contract explicitly — silently showing stale data forever, or blanking on a
   momentary socket drop, are both regressions against different halves of today's behaviour.
8. **Background pause**: no traffic while the window is unfocused. A heartbeat-based socket must be
   quiet enough not to break this (the existing one is 20 s idle heartbeat + 50 s client idle
   timeout, `docs/spikes/websocket-migration.md` §1 L7/L8).
9. **Observability is currently zero, so it is a floor, not a ceiling**: `plugin_api.py` emits no
   logs or metrics; the only client-side signal is `wsState`/`wsOff` persisted in plugin storage
   (`src/main.ts:3836-3842`). The replacement should *add* counters (ticks, failures, staleness,
   bytes), and must at minimum keep the existing persisted-state breadcrumbs so support can still
   tell "push off, and why".

---

## 7. Corrections to `docs/spikes/websocket-migration.md`

1. Its L1 line reference (`src/main.ts` ≈ L2371–2375) points at unrelated code; the query is at
   `src/main.ts:3788-3792` and the boards query at `:3759-3763` (`:2342-2346` in the old note).
2. It claims "the last good snapshot stays painted, `isError` only decorates the header". At
   `3aee9c0` a failed refetch with cached data still hits `if (isError)` and renders the full-page
   `ErrorState` (`src/main.ts:4722-4735`). Treat the document, not the old claim, as authoritative.
3. It lists `TaskDrawer` as a consumer of the shared snapshot (correct, `src/main.ts:2960-2962`) but
   its L5 line reference has moved to `src/main.ts:2926-2930`; add L5b, the worker-log read at
   `src/main.ts:2950-2954`.

## 8. Open questions a reviewer should answer before the migration

- Is the full-page error state intended? If a push keeps a stale board visible instead, that is a
  deliberate UX change and should be stated in the PR.
- What is the real client count per gateway in production? Volume scales linearly with open pages
  today; the push's win depends on that number being > 1.
- Should the fallback poll stay at 300 s while a socket is `live`, or is 60 s needed as a safety net
  for missed frames (`src/main.ts:3791`)?
