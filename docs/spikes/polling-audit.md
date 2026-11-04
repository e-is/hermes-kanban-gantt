# Polling audit — what actually polls today, and what a websocket must preserve

Scope: **e-is/hermes-kanban-gantt** at `c14cbf5` (plugin `1.9.0`, `plugin.yaml:2`), plus the Hermes
desktop host that owns the query client (`apps/desktop/src/lib/query-client.ts`).
Date: 2026-11-04. Method: every claim was re-read in the tree at this commit; the numbers in §6 were
measured on this machine, not copied.

Supersedes `polling-loop-audit.md`'s numbers, which were taken at `3aee9c0` (plugin `1.7.1`). The
§7 "must preserve" list there still holds; the payload grew and one poller appeared (§1, P3).

---

## 1. The active pollers

The plugin has **one** loop that carries data at volume (P1), **one** server-side change-detection
loop introduced by the push path (P3), and a handful of bounded caches.

| # | Poller | Where | Cadence | Request / resource | Consumer |
|---|---|---|---|---|---|
| P1 | **Gantt snapshot** | `src/main.ts:4006-4010` | `60_000`; `300_000` while `wsState === 'live'` (`:4009`) | `GET /gantt?board=<slug>` | whole page: tree, bars, ruler, list, filters, drawer relations |
| P2 | Board list | `src/main.ts:3977-3980`, same `queryKey` in `src/ui/TitlebarBoardSwitcher.tsx:16-19` | `5 * 60_000` | `GET /boards` | titlebar switcher, default-board resolution, "board disappeared" message |
| P3 | **Server change-detection** | `dashboard/plugin_ws.py:381-414` (`BoardStream._loop`), probe at `:241-251` | `250 ms` default, `KANBAN_GANTT_WS_POLL_MS` (floor 25 ms) | `PRAGMA data_version` + `stat(path)` on a long-lived read-only connection, **per watched board** | the `/events` fan-out; a full `_read_gantt` only when the signature moves |
| P4 | Worker log | `src/main.ts:3144-3149` | none — `enabled` on the `log` tab AND `log_exists` | `GET /tasks/<id>/log` | drawer's log tab |
| P5 | Task detail | `src/main.ts:3120-3124` | none — `enabled: Boolean(shownId)` | `GET /tasks/<id>?board=` | drawer |
| P6 | Attachments | `src/main.ts:2895-2900` (list), `:2964-2967` (preview) | none — on hover / on open | `/tasks/<id>/attachments`, `…/content` | paperclip menu, markdown viewer |
| P7 | Projects | `src/main.ts:3984-3988` | `staleTime: 60_000`, **no interval** | `GET /projects` | new-task dialog |
| P8 | Profiles | `src/main.ts:3991-3995` | `staleTime: 60_000`, **no interval** | `GET /profiles` | assignee pickers |
| P9 | "Now" cursor | `src/main.ts:4081-4084` | `setInterval(…, 30_000)`, **only while `live`** | *nothing* — bumps `nowTick` | the now-line and open run arcs |

**Not pollers** (do not count them): `desktop/plugin.js`, `desktop/ws-core.js`, `desktop/gantt-core.js`
are **build outputs** of `src/` (`scripts/build.mjs:1-12`; CI guards drift with `git diff desktop/`).
`docs/spikes/ws-simulator/*`, `docs/spikes/harness/*`, `scripts/shots.py` are measurement/screenshot
harnesses. `src/main.ts:2781` (`revokeObjectURL`) and `:3841` (copy-confirmation) are UI timers.

Only P1, P2 and P3 recur on their own. P4–P8 recur only when a human opens something; they cannot
contribute steady-state load.

---

## 2. One P1 tick, end to end

```
src/main.ts:4008   queryFn: () => apiFetch(`/gantt?board=…`)
src/state.ts:71-91 apiFetch → fetch(`${base}${path}`) when a custom base URL is set
src/state.ts:92-97 else rest(path, {method}) — the SDK's authenticated door into
                   /api/plugins/kanban-gantt/… on the host's own origin
dashboard/plugin_api.py:527-531  @router.get("/gantt") → _resolve_board → _read_gantt
```

- **Request**: `GET`, one optional `board` param, `all`/`*` for the fan-in view
  (`src/core/ws-core.ts:93` `canPush` documents that `all` is a real scope the push cannot serve).
- **Headers**: none set (`src/state.ts:74-81`). No `If-None-Match`, no `ETag` on the response
  (`plugin_api.py:527-531` returns the dict), so every tick is a full `200` with a full body.
- **No abort signal** in `queryFn` (`src/main.ts:4008`) — an in-flight tick is not cancelled when a
  newer one starts. Last response to arrive wins.
- **Server cost per tick**, on a read-only connection (`plugin_api.py:151-171`), **8 SQL statements**:

  | Step | Statement | Code |
  |---|---|---|
  | 1 | every `task_runs` row with `started_at NOT NULL`, ordered | `:205-247` |
  | 2 | `task_attachments` `GROUP BY task_id` | `:273-286` |
  | 3–4 | `task_runs` summaries (ordered, newest first) + `task_comments` `GROUP BY` | `:250-271` |
  | 5–6 | `task_events` + `task_runs` aggregated into 24 hour-buckets | `:363-403` |
  | 7 | `SELECT … FROM tasks` — unfiltered, archived included, `body` excluded | `:415-419` |
  | 8 | `SELECT parent_id, child_id FROM task_links` — whole table | `:423-427` |

- **`all` mode** repeats 1–8 per board and concatenates (`:464-524`), and `list_boards()` re-walks the
  boards directory and parses each `board.json` on every call — **no cache** (`:313-361`).
- **Auth**: the poll carries no credential of its own. Desktop goes through `rest()` (host session);
  gateway HTTP is gated per request by the dashboard's plugin-API middleware; the standalone dev
  server (`plugin_api.py:1627+`) has no auth at all, CORS `*` with credentials off, bound to
  `127.0.0.1` by default.

### Payload shape (grown since 1.7.1)

```jsonc
{ "board": "gantt-demo", "generated_at": 1793823xxx,   // int(time.time()) — different every tick
  "tasks": [ { "id","title","status","assignee","priority","label","board","archived","block_kind",
               "created_at","started_at","completed_at","run_started_at","run_ended_at",
               "runs": [{ "id","profile","step_key","status","outcome","started_at","ended_at","error","summary" }],
               "attachment_count", "latest_summary", "comment_count",   // ← new since 1.7.1
               "children": ["t_…"], "parents": ["t_…"],
               "activity": [24 ints, only when the task has activity in the window] } ],
  "labels": [ { "label": "PROJET #123", "count": 4 } ] }
```

`latest_summary` and `comment_count` are the two fields the card draws beside its title
(`plugin_api.py:250-271`); both are one aggregate for the whole board, never per-task.

---

## 3. P3 — the server-side poller the push path added

This one is easy to miss and it is the reason "we replaced polling with websockets" is not accurate
for `1.9.0`: **the push still polls, just on the server, at 4 Hz, once per board, shared by all
subscribers.**

- `BoardStream._loop` (`plugin_ws.py:381-414`) runs while the board has subscribers, and also during
  the 60 s grace window after the last one leaves (`:298-318`, no DB reads in that window).
- Each turn: `_db_signature` → `PRAGMA data_version` + `os.stat` (`:241-251`). `data_version` only
  moves for changes made by *other* connections, which is exactly the dispatcher/CLI/agent case —
  hence the long-lived connection.
- Interval `poll_s = 250 ms` (`:143`, `:152-160`), env `KANBAN_GANTT_WS_POLL_MS`.
- On a changed signature: optional `debounce_s = 300 ms` coalescing re-probe (`:392-396`), then one
  `_read_gantt` on a single-thread pool (`:399-407`), then one frame fanned out to every subscriber
  (R11). On no change: a data-level heartbeat every `heartbeat_s = 20 s` (`:408-413`), because the
  SDK socket door has no protocol ping and uvicorn's is disabled on loopback.
- Version counter is per stream and in-process only; it restarts at 1 after a drop past the grace
  window (`:266`, `:376-378`), and the client treats a lower version as a new stream
  (`src/core/ws-core.ts:70-72`).
- Auth runs *inside* the handler (`plugin_ws.py:187-234`) because Starlette HTTP middleware does not
  run for the `websocket` scope; it delegates to `web_server_chat._ws_auth_ok` and **fails closed**.

Measured cost of the probe, 500 iterations on the live board: **p50 2 µs, p99 4 µs**. So P3 is
~240 probes/min/board of 2 µs work — negligible CPU — but it is *unconditional presence detection*,
not a subscription: it wakes 4×/s per watched board even when nothing has changed for hours.

---

## 4. Call-flow sketch

```
                     ┌──────────────── desktop renderer (per window) ───────────────┐
                     │                                                             │
  P1  useQuery ──────┤ every 60 s (300 s if wsState==='live')                      │
      gantt          │   apiFetch('/gantt?board=slug') ──► rest() ──┐               │
                     │                                              │               │
  WS push ───────────┤ subscribeGantt (src/ws.ts)                   │               │
      /events        │   ctx.socket('/events?board=slug')           │               │
                     │   ├─ snapshot → queryClient.setQueryData(   │               │
                     │   │     ['kanban-gantt','gantt',base,board]) │               │
                     │   └─ version gap → invalidateQueries(same)   │               │
                     └──────────────────────────────────────────────┼───────────────┘
                                                                    │
                     ┌──────────────── gateway / plugin ────────────┼───────────────┐
                     │  GET /gantt ──► _resolve_board ──► _read_gantt(slug)         │
                     │                    8 SELECTs, ro connection, no cache        │
                     │                                                             │
                     │  WS /events ──► authorize (fail closed) ──► HUB.get(slug)    │
                     │      BoardStream._loop  (P3, 250 ms)                         │
                     │        signature == last ?  ── heartbeat 20 s ──► subscribers│
                     │        signature != last ?  ── debounce 300 ms ── _read_gantt│
                     │                              ── snapshot frame(version++) ─►│
                     └─────────────────────────────────────────────────────────────┘
```

`src/ws.ts:102-124` is the client half: one socket per mounted page, first-frame timeout 5 s
(`ws-core.ts:19`), idle timeout 50 s = 2.5 × heartbeat (`:22-23`), **one** retry with full-jitter
backoff 500 ms → 10 s (`:24-28`), then a 5-minute self re-arm (`:37`). While the socket is not
`live`, P1 stays at 60 s.

---

## 5. Missed, late, or failed ticks

**Client side — inherited, not configured by the plugin** (`apps/desktop/src/lib/query-client.ts:7-14`:
`refetchOnWindowFocus: false`, `staleTime: 60_000`):

- **Retries**: react-query default, 3 attempts with 1 s → 2 s → 4 s exponential delay. No override on
  the Gantt query. Then the interval fires again, burning 3 more requests per cycle, forever.
- **No jitter, no circuit breaker, no cap**. N clients opened together stay in phase.
- **Hard failure is not degraded-but-usable**: `isError` is rendered without a `data` guard
  (`src/main.ts:4930`), so after the retries are spent the timeline is replaced by a full-page
  `ErrorState` even though the last good snapshot is still cached. `isMissingBoardError` gets its own
  copy (`:4640-4643`).
- **First load**: `isLoading && !data` → centered loader.
- **Ordering**: no sequence number on the poll and no abort (`src/main.ts:4008`), so cache content is
  *last response to arrive wins*. It is safe today only because ticks are 60 s apart and a read is
  sub-millisecond — it is not a guarantee, and it was never one.
- **Semantics**: at-most-once per interval, full-snapshot idempotent. A missed tick costs freshness
  only; there is no event stream to replay and nothing to deduplicate.

**Server side**: `get_gantt` lets SQLite errors propagate (`plugin_api.py:527-531`); a missing board
becomes a 404. `plugin_api.py` imports no `logging` — a failing poll leaves **no server-side trace**.
The push half does log (`plugin_ws.py:54`, warnings at `:402`, `:418`, `:601`), which is the only
server-side observability either path has ever had.

---

## 6. Volume at steady state (measured 2026-11-04, this machine)

Board `gantt-demo`: **24 tasks, 15,818 B** JSON, `_read_gantt` **p50 0.29 ms** (20 calls, min 0.28,
max 0.47); `all` mode **15,811 B, p50 0.68 ms**; P3 probe **2 µs**.

| State | Requests/min per open page | Bytes/min per page |
|---|---|---|
| Push off, dead, `all` scope, or custom base (P1 at 60 s) | **1** gantt + 0.2 boards | **~15.8 KB** |
| Push `live` (P1 at 300 s) | 0.2 gantt + 0.2 boards | ~3.2 KB + frames on change |
| Server per watched board | — | — | **240 probes/min** (P3), + 1 `_read_gantt` per change |

Consequences:

- 60 s polling costs **~22.8 MB/day per open page** on this board (15,818 B × 1,440).
- Volume scales **linearly with open pages**: there is no server-side dedupe or fan-in on the REST
  path. Two desktops, two tabs, or a desktop plus a browser each poll independently.
- The push inverts that: P3 is **one** stream and one `_read_gantt` per change per board, regardless
  of subscriber count — that is the actual win, not the latency.
- A minimized window costs nothing on the poll path (react-query's
  `refetchIntervalInBackground` defaults to false, so intervals stop while the window is unfocused —
  the documented default rather than an option this repo sets; see §8). An idle socket at a 20 s
  heartbeat is *more* traffic than a stopped poll.
- **No rate limits found** in this repo or in the plugin's own routes, and no `/gantt` request logging
  in `~/.hermes/logs/gateway.log` (only lifecycle lines) — so there is no measured latency or
  throttling pain to report, and no data to invent one from. The pain point is structural: per-client
  full-snapshot cost, and a 2,000-task board at ~440 KB / ~23 ms per tick per client (the figure the
  spike's harness recorded at `3aee9c0`, unchanged in shape here).

---

## 7. What a websocket replacement must preserve

Each item is a behaviour that exists **today**; dropping one is a regression, not a simplification.

1. **Freshness budget.** ≤ 60 s staleness when polling is in charge (300 s while live). The push may
   be better; the fallback must not be worse than today's 60 s.
2. **Same cache entry, same shape.** Everything downstream reads
   `['kanban-gantt','gantt', apiBase(), board]` and the exact `/gantt` object (`src/main.ts:4007`,
   consumers from `:4090` on; drawer relations via `relationsOf` at `:3156`). A push writes that
   key with that shape (`src/main.ts:4069-4071`) — never a parallel store. `frameToQueryData`
   (`ws-core.ts:81-88`) is the whole of that contract.
3. **Initial state sync is a full snapshot, first frame.** `plugin_ws.py:563-571` reads the signature
   *before* the snapshot so a write landing in between is still detected next tick; the client has a
   5 s first-frame timeout because the SDK door has no `onOpen` (`ws.ts:122-124`).
4. **Ordering.** Monotonic per-board version: equal = ignore, gap = apply + REST revalidate, lower =
   new server stream (`ws-core.ts:54-78`). Do not regress to worse than "last wins", which is all the
   poll ever promised.
5. **Atomic snapshots.** Every delivery paints a complete board including `parents`/`children`. No
   incremental patch that can leave a half-updated tree.
6. **Fallback is mandatory, and it is not one case.** `all`/`*` scope (`ws-core.ts:93`), a custom
   backend base URL (`src/main.ts:4004`), a host with no socket door, `KANBAN_GANTT_WS=0`, a dead or
   never-opened socket, and a gateway with the push absent all land on P1 at 60 s.
7. **Reconnect.** One retry per outage with full-jitter backoff, then polling takes over and a
   5-minute self re-arm heals a gateway restart (`ws-core.ts:24-37`, `ws.ts:71-96`). A restart must
   not leave a page on polling forever, and must not spin a failed handshake in a loop.
8. **Auth, without a second credential.** Reuse the host session (`rest()`, gateway cookie/ticket);
   the socket authenticates inside the handler and **fails closed** (`plugin_ws.py:187-234`). Never
   widen the standalone dev server's no-auth surface.
9. **Explicit error contract.** Today a hard failure blanks the page (`src/main.ts:4930`) and keeps
   retrying. Showing stale data forever, and blanking on a momentary socket drop, are both
   regressions against different halves of that behaviour — pick one and write it down.
10. **Background pause.** No traffic while the window is unfocused; a heartbeat-based socket must stay
    quiet enough not to break it.
11. **Server cost ceiling.** ≤ 8 read-only SQL statements + one directory walk per board per change;
    no long-lived write lock. **Do not turn one probe per board into one probe per connection** —
    that would rebuild the per-client cost the push exists to remove.
12. **Observability is a floor, not a ceiling.** `plugin_api.py` emits nothing; the only breadcrumbs
    are the persisted `wsState` / `wsOff` values (`src/main.ts:4047-4062`). Keep them, and add
    counters (ticks, failures, staleness, bytes) rather than replacing them.

---

## 8. Limits of this audit, and one drift note

- **Not verified here**: react-query's `refetchIntervalInBackground` default (the host sets only
  `refetchOnWindowFocus` and `staleTime` at `query-client.ts:7-14`); `@tanstack` is not installed in
  either checkout, so the interval-pause property in §6 rests on the library's documented default,
  not on a line I can point at.
- **Not measured here**: real client counts per gateway. Volume is linear in open pages, so the
  push's benefit depends on that number being > 1, and nothing in this repo records it.
- **Drift, no code changed in this task**: `dashboard/plugin_api.py:1699` still says the push is
  "OFF unless KANBAN_GANTT_WS=1", while `plugin_ws.websocket_enabled()` has defaulted to **on** since
  `1.9.0` (`plugin_ws.py:163-171`, and `plugin.yaml`'s `optional_env` says so). The comment is stale,
  the behaviour is correct. Left alone deliberately — this task is read-only.
- Prior art: `polling-loop-audit.md` (1.7.1 numbers, same §7 list), `websocket-migration-recommendation.md`
  (the go/no-go), `websocket-poc.md` (measured push numbers), `websocket-spike-closeout.md` (verdict).
