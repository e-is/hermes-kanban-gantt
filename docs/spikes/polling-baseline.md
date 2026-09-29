# Polling baseline — kanban-gantt desktop view

Audit task: kanban card `t_cb748994` ("Audit the existing polling loop"), parent
`t_bd9cb110` ("Spike: replace the polling loop with websockets").
Scope: the **kanban-gantt** plugin (`e-is/hermes-kanban-gantt`), the Gantt board
view in Hermes Desktop. Client side read from source; server side measured on
this workstation against the plugin's own backend module.

Everything below was re-verified against `main` @ `c7945f2` (plugin.yaml 1.3.0),
working tree of 2026-09-29. Measurement harness and raw results:
[`harness/`](harness/) + [`results/`](results/).

```bash
# reproduce (from the repo root)
export GANTT_PLUGIN_API=$PWD/dashboard/plugin_api.py
export PYTHONPATH=$HOME/.hermes/hermes-agent
V=$HOME/.hermes/hermes-agent/venv/bin/python          # has fastapi/uvicorn/httpx
SYNTH_ROOT=$HOME/.hermes/cache/scratch/gantt-synth $V docs/spikes/harness/make_synthetic.py
PORT=8791 $V docs/spikes/harness/measure.py --label real --home ~/.hermes \
  --requests 200 --endpoints /meta /boards "/gantt?board=gantt-demo" "/gantt?board=all"
```

---

## 1. Where the polling lives

Two halves, one process each.

### Client (desktop renderer) — no timer of its own, all react-query intervals

| What | File:line | Interval / behaviour |
|---|---|---|
| Gantt snapshot (tasks + labels + links) | `src/main.ts:1358-1362` | `refetchInterval: 60_000`, key `['kanban-gantt','gantt',apiBase(),board]` |
| Board list (page) | `src/main.ts:1339-1343` | `refetchInterval: 5 * 60_000`, key `['kanban-gantt','boards',apiBase()]` |
| Board list (titlebar switcher) | `src/ui/TitlebarBoardSwitcher.tsx:16-20` | `refetchInterval: 5 * 60_000` — **same query key**, so react-query dedupes to one timer |
| Projects (creation dialog) | `src/main.ts:1346-1350` | `staleTime: 60_000`, **no interval** |
| Profiles (assignee choices) | `src/main.ts:1353-1357` | `staleTime: 60_000`, **no interval** |
| Task detail (drawer) | `src/main.ts:883-887` | **no interval** — refetch after status/comment/assignee/unlink mutations (`main.ts:915,924,932,943`) |
| Manual Refresh button | `src/main.ts:1794` | `invalidateQueries(['kanban-gantt','gantt'])` |
| Board switch (titlebar) | `src/ui/TitlebarBoardSwitcher.tsx:29` | invalidates the gantt query |
| Bulk actions | `src/main.ts:1435,1472,1483,1577,1590` | invalidate on success |

Implicit behaviour inherited from the desktop's shared client
(`~/.hermes/hermes-agent/apps/desktop/src/lib/query-client.ts:6-13`):
`refetchOnWindowFocus: false`, `staleTime: 60_000`. `refetchIntervalInBackground`
defaults to `false`, so an unfocused window pauses the interval. No retry policy
of its own (react-query default: 3 attempts, exponential backoff).

Door used: `ctx.rest(path, {method, body})` (`src/state.ts:38-57` in the tree;
`apiFetch`/`apiBase` from the same module), which the desktop resolves to
`/api/plugins/kanban-gantt<path>` — or a raw `fetch` when the user sets a custom
"backend API" base URL (`ctx.storage['baseUrl']`).

### Server (FastAPI router, mounted by the gateway)

`dashboard/plugin_api.py` — `router = APIRouter()` (line 43), mounted by
`hermes_cli/web_server_dashboard.py` (`app.include_router(router, prefix=...)`,
gated by `plugins.enabled`).

| Endpoint | Line | Reads |
|---|---|---|
| `GET /boards` | 233 | `<root>/kanban/boards/*/kanban.db` existence + `board.json` (233-251) |
| `GET /gantt?board=<slug>` | 356 → `_read_gantt` 254 | one sqlite `mode=ro` connection (257): `tasks`, `task_links`, `task_runs` (`_run_windows` 163) |
| `GET /gantt?board=all` | 356 → `_read_gantt_all` 302 | opens **every** board DB, one connection per board, sequential |
| `GET /tasks/{id}` | 461 | task + comments + events + links, own connection |
| `GET /profiles` / `GET /projects` / `GET /meta` | 726 / 698 / 945 | profile/project files, no board DB |
| writes | 377, 585, 623, 654, 750, 858, 918 | go through `hermes_cli.kanban_db` mutators, not raw SQL |

Board resolution: `_resolve_board` (110-119) → `HERMES_KANBAN_BOARD` →
`kanban_db.get_current_board()`; DB path via `_board_db_path` (92-107) →
`kanban_db.kanban_db_path(slug)`, with `KANBAN_GANTT_BOARDS` as a standalone
fallback (80-89). Reads are one short-lived `mode=ro` connection per request,
closed in `finally` (298-299); no pooling, no ETag/`If-None-Match`, no
`Cache-Control`.

---

## 2. Data flow

```
desktop renderer                                                                   gateway process
────────────────                                                                   ───────────────
GanttPage mount
  └─ react-query ['kanban-gantt','gantt',base,board]
       queryFn → apiFetch(`/gantt?board=X`)     ── HTTP GET /api/plugins/kanban-gantt/gantt ──▶ auth middleware
       ← snapshot {board, generated_at, tasks[], labels[]}  ◀── _read_gantt: sqlite ro ── tasks ⋈ task_links ⋈ task_runs
       refetchInterval 60s ────┐                                                      (new connection each poll)
  (titlebar switcher) ['…','boards']                        ── GET /boards every 5 min ──▶ list dirs + board.json
  drawer open?  ['…','task',base,board,id]  ── GET /tasks/{id} on mount + after each mutation ──▶ task+comments+events
       mutations ── PATCH/POST ──▶ kanban_db mutators ──▶ sqlite write ──▶ invalidateQueries(['kanban-gantt','gantt'])
                                                                          └─▶ next paint reads a FRESH snapshot (no push)
```

Data contract (the payload the poller consumes — `_read_gantt` 292-297):

```jsonc
{
  "board": "gantt-demo",
  "generated_at": 1790697035,               // epoch seconds, server clock
  "tasks": [{
      "id": "t_cb748994", "title": "...", "status": "running",
      "assignee": "default", "priority": 0, "label": "PROJET #123",
      "board": "gantt-demo", "archived": false,
      "created_at": 0, "started_at": 0, "completed_at": 0,
      "run_started_at": 0, "run_ended_at": 0,
      "runs": [{"profile": "default", "status": "running", "started_at": 0, "ended_at": 0, "outcome": null}],
      "parents": ["t_x"], "children": []
  }],
  "labels": [{"label": "PROJET #123", "count": 4}]   // sorted by count desc, then label
}
```

Ordering assumptions that hold today and must survive a websocket migration:

1. The snapshot is atomic for the client: one `tasks[]` array + the label set
   come from one request, so the row set and the filter facets cannot disagree.
2. The drawer's parents/children come from the page's whole-board snapshot
   (`main.ts:906-908`), **not** from the drawer's own `/tasks/{id}` fetch — so a
   task row and its relation edges always come from the same generation.
3. Every mutation is followed by an `invalidateQueries` → the "truth after write"
   path is a re-read, never the mutation response body.
4. Mutations assume the *next* snapshot already contains their effect; with 60 s
   polling that is only about the interval, since mutations refetch explicitly.
5. A failed poll is silently retried by react-query; the page keeps painting the
   last good snapshot (there is no "stale snapshot" UI).

---

## 3. Baseline metrics (measured, 200 requests/endpoint, loopback, no auth/TLS)

Harness = the plugin's own `create_app()` (`plugin_api.py:955`) on 127.0.0.1,
serving the real profile root — i.e. the same router module the gateway mounts,
without the gateway's auth middleware or TLS. Raw JSON in `results/`.

### Real boards (`~/.hermes/kanban/boards`; gantt-demo = 20 tasks / 14 links / 14 runs, sumaris-pod 3, obsventes 0 at measurement time)

| Endpoint | p50 | p90 | p99 | max | body | rps | server CPU |
|---|---|---|---|---|---|---|---|
| `GET /meta` | 0.45 ms | 0.85 ms | 1.05 ms | 1.27 ms | 78 B | 2685 | 0.15 ms/req |
| `GET /boards` | 0.42 ms | 0.55 ms | 0.79 ms | 0.94 ms | 164 B | 2052 | 0.20 ms/req |
| `GET /gantt?board=gantt-demo` | 1.27 ms | 1.48 ms | 1.96 ms | 2.33 ms | **10 764 B** | 706 | 0.95 ms/req |
| `GET /gantt?board=all` | 2.24 ms | 2.45 ms | 2.75 ms | 2.95 ms | 11 668 B | 459 | 1.65 ms/req |
| `GET /tasks/{id}?board=gantt-demo` | 1.05 ms | 1.36 ms | 1.79 ms | 2.34 ms | 1 529 B | 859 | 0.70 ms/req |
| `GET /profiles` | 1.19 ms | 1.48 ms | 1.99 ms | 93.67 ms | 24 B | 865 | 0.80 ms/req |

(`/profiles` max is a one-off filesystem hiccup on the first request, not a
steady-state outlier: p99 1.99 ms.)

Cold path (a brand-new TCP connection per request, no keep-alive): `/boards`
p50 0.86 ms (max 6.3 ms), `/gantt?board=gantt-demo` p50 1.67 ms (8.5 ms),
`/gantt?board=all` p50 2.24 ms (8.9 ms), `/tasks/{id}` p50 1.39 ms (8.6 ms) — the
~6-9 ms tail is the connection setup itself.

`?board=all` on this root costs about one board more than a single board
(2.24 ms vs 1.27 ms) because the other two boards are tiny (sumaris-pod 3 tasks,
obsventes 0) — it opens three DBs and merges, so it is *not* cheaper in general.

### Scaling — synthetic 1000-task board (real schema, 999 links, 500 runs)

| Endpoint | p50 | p90 | p99 | max | body | rps | server CPU |
|---|---|---|---|---|---|---|---|
| `GET /gantt?board=big` | 22.91 ms | 30.61 ms | 41.38 ms | 42.34 ms | **441 550 B** | 42.5 | 22.65 ms/req |
| `GET /gantt?board=big` (cold) | 29.51 ms | — | 43.18 ms | 43.18 ms | 441 550 B | — | — |

≈ **442 B per task** and **22.7 ms of server CPU per snapshot** at 1000 tasks
(vs 0.85 ms / 7.8 KB for the 20-task real board). Cost is linear in rows and the
whole snapshot is rebuilt and re-serialized on every poll.

### Thundering herd (N concurrent windows, same endpoint, loopback)

Each client issues 5 requests back-to-back, so `wall` covers 5 rounds; the p50/p99
are per-request.

| Endpoint | clients | wall | p50 | p99 |
|---|---|---|---|---|
| `/gantt?board=gantt-demo` (20 tasks) | 5 | 34.3 ms | 5.52 ms | 8.37 ms |
| | 10 | 77.0 ms | 13.47 ms | 17.70 ms |
| | 25 | 232.7 ms | 35.28 ms | 95.93 ms |
| `/gantt?board=big` (1000 tasks) | 5 | 1 266 ms | 255.20 ms | 342.74 ms |
| | 10 | 2 970 ms | 592.77 ms | 782.12 ms |
| | 25 | 7 444 ms | **1 473.55 ms** | 1 834.77 ms |

No errors at any level (uvicorn's thread pool absorbs it), but latency queues
linearly in the number of windows: on a 1000-task board, 25 aligned pollers wait
~1.5 s for a snapshot that takes 23 ms alone — a stalled-UI case, and this is
loopback, before TLS and gateway auth.

### Request volume model (one mounted page, one focused window)

React-query dedupes the two `/boards` queries to one timer, so a mounted page is:

| Query | Interval | Requests/hour |
|---|---|---|
| `['kanban-gantt','gantt',…]` | 60 s | 60 |
| `['kanban-gantt','boards',…]` | 300 s | 12 |
| **total** | | **72** |

| Board size | payload/poll | per hour | 8 h session | 30 days @ 8 h/day |
|---|---|---|---|---|
| 3 tasks (sumaris-pod, 982 B) | ~1 KB | ~59 KB | 0.5 MB | 14 MB |
| 20 tasks (gantt-demo, 10.8 KB) | 10.8 KB | ~648 KB | 5.2 MB | 155 MB |
| 1000 tasks (441.6 KB) | 441.6 KB | ~26.5 MB | 212 MB | 6.4 GB |

CPU is not the problem (20-task board ≈ 58 ms of server CPU per hour; 1000-task
board ≈ 1.4 s). **Bytes are**, and they multiply by the number of open windows,
because each renderer has its own react-query cache — nothing is shared. An
unfocused window stops polling (`refetchIntervalInBackground` default false),
which is the only thing limiting the cost today.

### Wasted / duplicate work observed

1. **Every window is its own poller.** No cross-window sharing, no server push:
   N windows on one board = N full snapshots per minute.
2. **`generated_at` is refreshed and never displayed** — the 60 s poll always
   changes the payload even when nothing changed, so the "did anything change?"
   optimisation (ETag / 304 / delta) is not implemented.
3. **`/gantt?board=all` re-reads every board DB per poll** instead of watching
   them.
4. **The whole snapshot is rebuilt per poll** (`_read_gantt` 254-299): a fresh
   ro connection, `task_runs` scanned for run windows, all links grouped, all
   labels counted — regardless of what changed since the last read.
5. **Failures are invisible to the user**: react-query's 3 retries then silence,
   last snapshot stays painted (no error state for the page: `isError` is read
   at `main.ts:1358` but the page paints the cached data regardless).

### Failure modes observed

| Condition | Result |
|---|---|
| slug with traversal (`../../etc`, `a/b`) | 400, 31 B — correct (`_board_db_path` 92-95) |
| unknown board, clean env | 503, 99 B, `board '<x>' database not found at <path>` |
| unknown board, **`HERMES_KANBAN_DB` set** (worker env) | **200 with the pinned board's data, relabelled with the requested slug** — measured: `GET /gantt?board=sumaris-pod` → 200, `board: "sumaris-pod"`, but the 20 tasks returned are gantt-demo's ids (`results/pinning-repro.txt`) |
| `?board=all` with `HERMES_KANBAN_DB` set | the aggregate triples: 20 tasks labelled `gantt-demo` + 20 labelled `obsventes` + 20 labelled `sumaris-pod`, all the same pinned rows, 32 145 B |
| unknown route / wrong method | 404 / 405 |
| backend down | `Connection refused`; react-query surfaces it only after 3 retries, UI keeps the last snapshot |
| open write transaction on the board | read still 200 (WAL, `busy_timeout` 5000 ms) — reads never block on writers |
| schema drift on a board | **500 on every poll** (no degraded mode): `_run_windows` raises through the request |

---

## 4. Integration points that must be replaced for a transport swap

Explicit list — a websocket spike replaces 1-3, keeps 4-7 as fallbacks.

| # | Integration point | File:line | What changes |
|---|---|---|---|
| 1 | Gantt snapshot poll timer | `src/main.ts:1358-1362` | drop `refetchInterval: 60_000` on `['kanban-gantt','gantt',…]`; keep the query as the cache (push writes it via `queryClient.setQueryData`, or `invalidateQueries` on each frame) |
| 2 | Board-list poll timer | `src/main.ts:1339-1343` + `src/ui/TitlebarBoardSwitcher.tsx:16-20` | same key from two components — one timer today; a push must invalidate it once, for both |
| 3 | Transport door | `src/state.ts` (`apiFetch`/`apiBase`) + `src/main.ts:1974` | add `ctx.socket('/events', …)` next to `ctx.rest`; SDK already exposes it (`src/sdk.d.ts:21`) |
| 4 | Manual Refresh + board switch | `src/main.ts:1794`, `TitlebarBoardSwitcher.tsx:29` | keep as explicit re-read (must still work when the socket is down) |
| 5 | Mutation → refetch | `src/main.ts:916,933,944,1435,1472,1483,1577,1590` | keep `invalidateQueries` (truth-after-write stays a re-read until frames prove otherwise) |
| 6 | Drawer data | `src/main.ts:883-887` | out of scope for the push, but it must not be starved: it refreshes only on mount/mutation |
| 7 | Server side | `dashboard/plugin_api.py` (`router`, 43; `_read_gantt` 254) | add `@router.websocket("/events")` on the same router; the read functions are reusable as the initial frame |

Server plumbing to write new: a per-board watcher (`PRAGMA data_version` /
mtime poll or a sqlite update hook) + debounce, a per-board fan-out so N windows
on one board cost one DB read, and a first-frame contract (initial snapshot)
before the client may drop its interval.

Client door already available: `@hermes/plugin-sdk` `ctx.socket(path, onMessage)
→ dispose` (`src/sdk.d.ts:21`; desktop side
`apps/desktop/src/api/plugins.ts:95-147` — token from query param at 111-115,
full-jitter backoff 500 ms→30 s on close at 127-138, JSON-frame parsing).
Caveat: `connection.authMode === 'oauth'` returns early (line 107), so OAuth
remotes stay on the polling fallback **by design** — a poll path must remain.

---

## 5. Migration risks / unknowns

1. **`HERMES_KANBAN_DB` pinning** (measured, `results/pinning-repro.txt`) — in a
   worker/agent env a board-scoped request silently serves the pinned DB
   relabelled with the requested slug (`?board=sumaris-pod` → gantt-demo's 20
   tasks tagged `sumaris-pod`; `?board=all` → three copies of the pinned rows).
   A websocket must not key its fan-out on the client's requested slug without
   validating it against the resolved path, or pushes will cross boards. Same
   trap in the harness: `HERMES_KANBAN_DB` must be unset before measuring (see
   `harness/serve.py`); it also bit this audit's first synthetic run, which was
   set up under a worker env and measured the pinned board instead.
2. **No cross-window sharing today** — one socket per window still means N
   pushes; dedupe server-side or the 25-client measurement becomes the steady state.
3. **`?board=all`** needs a watcher per board and a merge strategy (today it
   re-reads everything).
4. **Snapshot shape is the contract** — `{board, generated_at, tasks[], labels[]}`
   with per-task `runs`, `parents`, `children`; any push frame must carry the same
   shape (or a delta the client applies to that shape) or the drawer's
   relations-from-snapshot assumption (§2.2) breaks.
5. **Stale-window behaviour is unspecified** — polling pauses on blur; with push,
   decide whether an unfocused window keeps its socket and how much it buffers.
6. **Failure modes get worse before better** — a 500 (schema drift) or a dead DB
   is absorbed today by "keep the last snapshot". A socket that fails its
   handshake must fall back to the 60 s interval, not to a blank page.
7. **Unknowns to resolve before implementing:** whether the gateway's auth
   middleware lets a WS upgrade through for a plugin namespace (needs a real
   upgrade attempt, not a code read); whether `pluginSocket` exposes
   connect/error state to the plugin (today the callback is `onMessage` only, so
   the plugin cannot tell "connected" from "silently failing"); and the sqlite
   watch cost on a busy board (the dispatcher writes task rows constantly while
   workers run).
8. **Non-goals measured, not fixed:** `generated_at` is fetched every minute and
   used for nothing; the 5 min `/boards` poll mainly serves the switcher's labels.
