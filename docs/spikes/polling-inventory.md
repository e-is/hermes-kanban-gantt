# Polling inventory — kanban-gantt (current tree)

Card `t_47c1cced` ("Map the existing polling loop and its data contracts"), child of the
spike `t_edf13882` ("replace the polling loop with websockets"). Deliverable for that
card: the survey below — poller table, data flow, contracts, operational numbers and a
challengeable "hard parts" list.

**Verified against** `2fad386` + the uncommitted websocket prototype in the same tree
(`dashboard/plugin_ws.py`, `docs/spikes/`; `src/ws.ts`, `src/core/ws-core.ts`,
`desktop/ws-core.js`, `tests/ws_proof.py` are committed). Every line reference below was
read from this tree, not from a doc.

> Supersedes `polling-baseline.md` **for line references and for anything push-related**:
> that file was written at `c7945f2`, before the prototype landed, so its `src/main.ts`
> refs are ~46 lines low (e.g. the Gantt poll is now `1403-1407`, not `1358-1362`), and it
> does not know that the poll is already demoted to 300 s under a live socket. Its
> latency/throughput benchmarks are still the only load numbers that exist — do not
> discard, but do re-run before quoting (see §7).

---

## 1. Every polling loop in the tree

Classification key: **P** = production poller, **C** = conditional/secondary production,
**S** = server-internal change-detection poll, **T** = timer of the transport itself,
**N** = non-production (harness/test/generated artifact).

| # | Poller | file:line | Interval | What is polled | Auth | Error / retry | Class |
|---|---|---|---|---|---|---|---|
| 1 | Gantt snapshot (the loop the spike targets) | `src/main.ts:1403-1407` (queryFn `1405`) | `60_000` ms — **`300_000` when `wsState === 'live'`** (`1406`) | `GET /api/plugins/kanban-gantt/gantt?board=<slug>` → `dashboard/plugin_api.py:356-357` → `_read_gantt` `254-299` | `ctx.rest` → `pluginRest` (main-process `hermesApi`, profile/connection-scoped; `apps/desktop/src/api/plugins.ts:71-88`) | react-query default: 3 attempts, exponential backoff; failure is **silent** — the page keeps the last snapshot (`isError` read at `1403`, never rendered as a stale state) | **P** |
| 2 | Board list (page) | `src/main.ts:1374-1378` | `5 * 60_000` | `GET /boards` → `plugin_api.py:233-251` (dir listing + `board.json`) | same | same | **P** |
| 3 | Board list (titlebar switcher) | `src/ui/TitlebarBoardSwitcher.tsx:16-20` | `5 * 60_000` | same endpoint, **same queryKey** `['kanban-gantt','boards',apiBase()]` → react-query dedupes to **one** timer for both components | same | same | **P** (deduped with #2) |
| 4 | Projects (creation dialog only) | `src/main.ts:1381-1385` | none — `staleTime: 60_000` | `GET /projects` (`plugin_api.py:698`) | same | on-demand refetch | **C** |
| 5 | Profiles (assignee choices) | `src/main.ts:1388-1392` | none — `staleTime: 60_000` | `GET /profiles` (`plugin_api.py:726`) | same | on-demand refetch | **C** |
| 6 | Task drawer detail | `src/main.ts:918-922`, key `919` | none | `GET /tasks/{id}` (`plugin_api.py:461`) | same | `refetch()` after each mutation: `951`, `959`, `968`, `979` | **C** |
| 7 | Timeline "now" cursor | `src/main.ts:1429-1433` | `30_000` ms `setInterval` | nothing — local re-render tick | — | only armed while `wsState === WS_STATE.live` (R6: with push there is no poll left to advance "now") | **C** |
| 8 | Client socket watchdogs | `src/ws.ts:109` (first frame `WS_FIRST_FRAME_MS = 5_000`), `:66` (idle `WS_IDLE_MS` = 2.5 × 20 s = 50 s), `:80` (one retry, full-jitter 500→10 000 ms) | see left | `/events?board=<slug>` (own handler, `plugin_ws.py:453-504`) | `?token=` query param (SDK door) | every exit path → `give()`: **one** retry, then `WS_STATE.dead` and polling takes over for good (`src/core/ws-core.ts:26`, `WS_MAX_ATTEMPTS = 1`) | **T** |
| 9 | SDK auto-reconnect | host: `apps/desktop/src/api/plugins.ts:113-138` | full-jitter, base 500 ms, cap **30 s**, unbounded | the same plugin socket (token in the URL, `113-115`) | connection token | `onclose` → `setTimeout(connect)` (`127-138`); **no `onOpen`/`onError` exposed** — the plugin only gets `onMessage` | **T** |
| 10 | **Server change-detection loop** | `dashboard/plugin_ws.py:307-340` | `poll_s` = **0.25 s** default (`87`, env `KANBAN_GANTT_WS_POLL_MS`, floor 25 ms) | `PRAGMA data_version` + `st_mtime_ns` + `st_size` of the board DB (`167-177`), then a debounce `0.3 s` (`88`, `318-322`) and one `_read_gantt` per change per board (`326`) | `authorize()` `125-160` at handshake only | loop swallows exceptions (never kills the dashboard worker, `343-344`); a failed read logs and keeps the last signature | **S** |
| 11 | Idle heartbeat (server) | `dashboard/plugin_ws.py:334-339` | 20 s (`heartbeat_s`, `89`) | data-level frame, not protocol ping | — | none | **T** |
| 12 | Dead-peer probe (server) | `dashboard/plugin_ws.py:487-493` | `wait_for(ws.receive(), timeout=poll_s)` = 0.25 s | the socket itself (client sends nothing today) | — | timeout is the normal path | **T** |
| 13 | Event-driven refreshes (not timers) | `src/main.ts:1506,1543,1554,1648,1661,1893`; `TitlebarBoardSwitcher.tsx:29` | — | `invalidateQueries(['kanban-gantt',…])` after every write, board switch, manual Refresh | — | none | **C** |

**Nothing else exists.** `dashboard/plugin_api.py` contains no timer, no background task,
no `asyncio.sleep` — it is strictly request-scoped (one `mode=ro` connection per read,
closed in `finally`, `298-299`). No cron, no file watcher, no `fs.watch`/`chokidar`, no
`while`+sleep loop anywhere in `src/`, `dashboard/`, `desktop/`. The only remaining
`while` loops are pure functions (`src/core/gantt-core.ts:51,312`).

Non-production timers found and **classified as not pollers of production data**:
`scripts/shots.py:429` (`setTimeout` inside JS injected into the real desktop for
screenshots) and its `asyncio.sleep` calls (`157-398`); `tests/ui/esm-render.mjs:275-278`
(`requestAnimationFrame` stub + a 20 ms flush); `tests/ws_proof.py:198,220` (test client);
`docs/spikes/harness/{measure,pinning_repro,serve}.py` and `docs/spikes/harness/measure.py`
(poll `subprocess.poll()`, not a data poll); `desktop/plugin.js` — **generated** mirror of
`src/` (`2553` duplicates the 30 s tick, `2532` the demoted interval); never edit by hand.

---

## 2. Data flow

```
desktop renderer (per window, own react-query cache)                    gateway process
──────────────────────────────────────────────────                     ───────────────
GanttPage mount  (§1.1)
  ['kanban-gantt','gantt',base,board]
     queryFn ── GET /gantt?board=X ─────────────────────────────────▶ _read_gantt (254)
     ◀── {board, generated_at, tasks[], labels[]}  (10 173 B / 19 tasks)  one ro sqlite conn
                                                                        tasks ⋈ task_links ⋈ task_runs
     refetchInterval 60 s ────┐  (300 s while the socket is 'live')
                              └─▶ every poll: full rebuild + full re-serialise
Titlebar + page  ['…','boards']  ── GET /boards every 5 min ─────────▶ dir listing + board.json
Drawer           ['…','task',…]  ── GET /tasks/{id} on mount/after a write ─▶ task + comments + events
writes ── PATCH/POST ─▶ kanban_db mutators ─▶ sqlite commit ─▶ invalidateQueries(['kanban-gantt',…])
                                                            └─▶ next paint = fresh REST read (no push)

push path (prototype, KANBAN_GANTT_WS=1)
  subscribeGantt (src/ws.ts:86-111) ── ctx.socket('/events?board=X') ──▶ ws.accept (plugin_ws 473)
       ▲                                     first frame = FULL snapshot (481-485)
       │                                     BoardStream (180-346):
       │                                        0.25 s signature poll ─▶ change ─▶ 0.3 s coalesce
       │                                        ─▶ ONE _read_gantt ─▶ version++ ─▶ fan out (298-300)
       │                                        idle ─▶ heartbeat frame every 20 s (334-339)
       └─ onMessage frame ─▶ classifyFrame (src/core/ws-core.ts) ─▶ setQueryData(same key)
                            gap → invalidateQueries (REST resync) · stale → ignore
                            silence 5 s / 50 s → one retry, then 60 s poll forever
```

---

## 3. Data contracts

`GET /gantt?board=<slug>` (`_read_gantt` `292-297`) — **the contract that everything
downstream reads**:

```jsonc
{
  "board": "gantt-demo",
  "generated_at": 1790697035,          // server epoch seconds — refreshed every poll, displayed nowhere
  "tasks": [{
    "id": "t_47c1cced", "title": "…", "status": "running", "assignee": "default",
    "priority": 0, "label": "PROJET #123", "board": "gantt-demo", "archived": false,
    "created_at": 0, "started_at": 0, "completed_at": 0,
    "run_started_at": 0, "run_ended_at": 0,          // from _run_windows (163-205)
    "runs": [{ "profile": "default", "status": "running", "started_at": 0, "ended_at": 0, "outcome": null }],
    "parents": ["t_x"], "children": []
  }],
  "labels": [{ "label": "PROJET #123", "count": 4 }]   // count desc, then label (287-290)
}
```

- `GET /boards` → `{ "boards": [{ "slug", "label" }], "current": "<slug>" }` (`251`).
- `GET /tasks/{id}` → `{ task: {…, label, latest_summary, parents[], children[]}, … }`
  (`_task_detail` `208-226`), consumed as `data.task.status|events|…` in the drawer.
- Push frames repeat the Gantt shape plus a header (`snapshot_frame` `416-425`):
  `{type:'snapshot', board, version, generated_at, tasks, labels}` is exactly
  `frameToQueryData()` (`src/core/ws-core.ts`) → same query cache entry, so no consumer
  changes. `{type:'heartbeat', board, version, at}` (`428-430`) carries no data.

**Invariants a replacement transport must not break** (each is relied on today):

1. **Atomicity** — rows, label facets and relation edges arrive in *one* payload from
   *one* read; a row and its parents can never come from different generations.
2. **Relations come from the page snapshot, not the drawer fetch** — `main.ts:941-943`
   computes parents/children from `tasks` (the whole board), so a relation hidden by a
   filter still renders.
3. **Truth-after-write is a re-read** — every mutation invalidates and re-reads; the
   mutation response body is never treated as state (§1.13).
4. **Ordering** — the client only ever applies a *newer* version (`classifyFrame`:
   `version <= lastVersion` → `stale`, ignored); a gap is not fatal because **every**
   frame is a full snapshot, it just triggers a REST resync.
5. **Absence of updates is not an error state** — a failed poll leaves the last good
   snapshot painted; there is no stale/offline UI today (`isError` at `1403` unused).

---

## 4. Consumers and their reaction

| Consumer | Reads | On update | On absence of update |
|---|---|---|---|
| Gantt rows/bars, filter facets, search, bulk selection | `data.tasks`, `data.labels` (`main.ts:1439`) | re-render from the snapshot | silently keeps painting the cached one |
| `TaskDrawer` relations | page snapshot (`941-943`) | follows the page | unchanged |
| `TaskDrawer` detail | its own `['…','task',…]` query | `refetch()` on mutation only | never polls → **must not be starved** by a push-only model |
| `TitlebarBoardSwitcher` labels + board list | `['…','boards']` | same queryKey as the page → one invalidate serves both | stale labels up to 5 min |
| Push path (flag on) | `onSnapshot` → `setQueryData` (`1417-1419`) | same consumers, unchanged | `onResync` → `invalidateQueries` (`1420-1422`); after `WS_STATE.dead` the 60 s poll is the only source |
| "now" cursor + run arcs | local `nowTick` (`1428-1433`) | 30 s tick, socket-path only | arcs freeze if the tick is missing |

---

## 5. Operational constraints (measured today on this workstation)

Payload/read cost of the live boards — `_read_gantt` called in-process, `HERMES_KANBAN_DB`
and `HERMES_KANBAN_BOARD` **unset**, p50 of 5 runs:

| Board | tasks | payload | `_read_gantt` p50 | MB/h per window @60 s |
|---|---|---|---|---|
| `gantt-demo` | 19 | 10 173 B | 0.30 ms | 0.61 |
| `sumaris-pod` | 3 | 1 096 B | 0.24 ms | 0.07 |
| `obsventes` | 0 | 77 B | 0.23 ms | 0.00 |
| `all` (fan-in) | 22 | 11 185 B | 0.89 ms | 0.67 |

≈ **535 B/task, ~0.3 ms of CPU per snapshot at 19 tasks**, and the whole snapshot is
rebuilt and re-serialised on every poll (no ETag/`If-None-Match`, no `Cache-Control`,
no delta).

Request volume, one mounted page in one focused window:

| Query | Interval | req/h | with socket live |
|---|---|---|---|
| `['…','gantt',…]` | 60 s | 60 | 12 (300 s) |
| `['…','boards',…]` | 300 s | 12 | 12 |
| **total** | | **72** | **24** |

Peak rate is not a rate but an **alignment event**: every window has its own cache and its
own timer, so N windows on one board issue N snapshots inside the same second — 25 windows
= 1 800 req/h and ~15 MB/h on the 19-task board (extrapolated from the measured payload;
the pre-prototype `polling-baseline.md` §3 measured the same shape under load: 25 aligned
pollers on a synthetic 1000-task board waited ~1.5 s each for a 23 ms read). Cost is
linear in rows *and* in open windows; CPU is trivial, **bytes are not**.

Concurrency expectation: the plugin has no telemetry — no client count is recorded
anywhere. Realistic shape: a few windows per desktop, one desktop (this workstation);
`fixe13.e-is` is this same host, so the two "gateways" are not two populations.

Rate limits / third-party quotas: **none** — every read is a local SQLite file, no
external API, and `GET /gantt` is served without throttling. The only ceilings are
gateway auth and the plugin's own request concurrency.

---

## 6. Hard parts (each one challengeable)

1. **The push path contains a poller of its own.** `plugin_ws.py:307-340` polls
   `PRAGMA data_version` (plus mtime/size) every 0.25 s per board, because nothing watches
   the board DB. A reviewer should ask: what is that worth versus the 60 s it replaces
   (300 signature reads/min/board), and is a sqlite update hook / `file_control` /
   inotify acceptable on Fedora + WAL?
2. **`HERMES_KANBAN_DB` pinning silently cross-wires boards.** Reproduced today: with
   `HERMES_KANBAN_DB=…/gantt-demo/kanban.db`, `_read_gantt("sumaris-pod")` returned
   **19 gantt-demo tasks relabelled `sumaris-pod`**; the same leak made `tests/ws_proof.py`
   run 1/13 (watcher read the pinned board while the writes went to the sandbox), and
   12/13 with the env cleared. Any fan-out keyed on the client's requested slug without
   re-validating the resolved path pushes another board's rows.
3. **Every window is its own socket and its own cache.** The server coalesces *reads* per
   board (`BoardStream`, one hook per board, `180-186`), but not *frames*; the 25-window
   case becomes 25 sockets and 25 full snapshots per change. Cross-window fan-out in the
   renderer does not exist.
4. **The socket door is receive-only.** `pluginSocket` exposes `onMessage` alone
   (`apps/desktop/src/api/plugins.ts:98-145`) — no `onOpen`, no `onError`, no protocol
   ping (uvicorn ping disabled on loopback). "Connected and idle" is therefore
   indistinguishable from "dead" except by silence: a 5 s first-frame timeout and a 50 s
   idle timeout are the plugin's own invention (`src/ws.ts:107-109`, `src/core/ws-core.ts`).
   This is the single biggest client-side unknown; it makes both false-dead and
   false-alive failure modes possible.
5. **OAuth and custom-URL remotes cannot use the socket at all.** `connection.authMode ===
   'oauth'` returns before connecting (`plugins.ts:105-109`), and the plugin refuses push
   when a custom backend base URL is set (`main.ts:1401`, `src/ws.ts:14-16`). The 60 s
   poll is not optional — it is the only path for those users.
6. **At-most-once, drop-and-coalesce delivery is a deliberate policy, not an accident.**
   `Subscriber` keeps at most one pending frame and closes a client after 3 overruns
   (`371-409`, `4408`); stages that lose frames must be recoverable by a *full* snapshot
   (they are — but that is why every frame is a full snapshot and deltas are still out).
7. **The first frame is the only resync primitive.** Reconnect correctness rests on
   "first frame after subscribe = full snapshot, signature captured *before* the read so a
   concurrent write is not absorbed" (`481-486`). Anything that makes the first frame a
   delta breaks reconnect.
8. **`?board=all` has no single thing to watch.** `_read_gantt_all` (`302-355`) opens
   **every** board DB sequentially per read; a push would need N signatures merged, and the
   client currently only subscribes when a concrete board is selected (`main.ts:1401`).
9. **WS auth is a re-implementation.** Starlette's HTTP middleware does not run for the
   `websocket` scope, so `authorize()` (`125-160`) re-uses
   `hermes_cli.web_server_chat._ws_auth_ok` or falls back to loopback-only. It has never
   been exercised against the **real gateway** upgrade path (only the standalone dev
   server, where the core gate is importable — and that import is what makes the
   loopback-only sub-check of P8 unreachable in this environment). The desktop door's only
   credential is `?token=` in the URL (`plugins.ts:113-115`) — a query string, i.e. it
   lands in access logs unless the gateway redacts it.
10. **The heartbeat is a data frame, and its period is load-bearing.** 20 s server-side vs
    a 50 s client idle window (2.5×) — no protocol ping exists. Drift between the two
    constants silently converts a healthy board into "dead", which permanently falls back
    to polling until reload.
11. **Stale-window semantics are unspecified.** Today `refetchIntervalInBackground`
    defaults to false and `refetchOnWindowFocus: false` (`apps/desktop/src/lib/query-client.ts:9-10`),
    so an unfocused window simply stops polling. A socket has no such policy: keep it,
    buffer, or drop? Undecided.
12. **Failure visibility does not exist yet.** A 500 (schema drift raises through
    `_run_windows`, §3 of the old baseline) or a dead DB is absorbed by "keep the last
    snapshot". A handshake that fails must degrade to the interval — and there is no UI to
    distinguish them, so a silently-degraded fleet is unobservable.
13. **Registration is boot-time and env-driven.** `attach()` (`437-446`) decides at import
    whether `/events` exists; flipping `KANBAN_GANTT_WS` needs a gateway restart (routes
    mount at boot — `AGENTS.md`). Rollout/rollback is therefore per-process, not per-client.
14. **No cross-process fan-out.** `HUB` is a module-global dict (`349-368`); with more than
    one uvicorn worker (or several gateways), each process owns its own watcher and its own
    version counter — versions are only monotonic *within* a process, and a reconnect that
    lands on another worker restarts at 1 (the 60 s grace window, `92`, only helps within
    one process).
15. **`generated_at` changes on every read and is displayed nowhere** — it defeats the
    obvious "nothing changed → 304" optimisation and makes frame equality tests impossible
    as written.

---

## 7. Evidence and how to re-verify

```bash
# payload size + read cost per board (env must be clean: see hard part 2)
unset HERMES_KANBAN_DB HERMES_KANBAN_BOARD
PYTHONPATH=$HOME/.hermes/hermes-agent $HOME/.hermes/hermes-agent/venv/bin/python - <<'PY'
import json,os,sys,time,statistics; sys.path.insert(0,"dashboard")
import plugin_api as P
for b in ["gantt-demo","sumaris-pod","obsventes","all"]:
    fn=(lambda: P._read_gantt_all()) if b=="all" else (lambda s=b: P._read_gantt(s))
    p=fn(); t=[]
    for _ in range(5):
        t0=time.perf_counter(); p=fn(); t.append((time.perf_counter()-t0)*1000)
    print(b, len(p["tasks"]), len(json.dumps(p).encode()), round(statistics.median(t),2))
PY

# push prototype end-to-end (13 assertions P1-P11, hermetic sandbox board)
env -u HERMES_KANBAN_DB -u HERMES_KANBAN_BOARD -u HERMES_KANBAN_HOME \
  $HOME/.hermes/hermes-agent/venv/bin/python tests/ws_proof.py

# the pinning trap
HERMES_KANBAN_DB=~/.hermes/kanban/boards/gantt-demo/kanban.db … _read_gantt("sumaris-pod")
# → board='sumaris-pod', 19 tasks, ids from gantt-demo
```

Results of the runs behind this document (2026-09-29, this workstation):

- payload/read table in §5 — measured, above.
- `tests/ws_proof.py` with a clean env: **12/13** (P1 first frame; P2 5 writes ⇒ 5 frames
  versions 2…6; P3 p50 385 ms / p95 412 ms, largest frame 2 045 B; P4 10-write burst ⇒ 1
  frame, 1 read; P5 two subscribers ⇒ 1 read; P6 heartbeats; P7 **0 HTTP `/gantt`
  requests**; P9 traversal refused; P10 reconnect = full snapshot; P11 flag off ⇒
  `/events` 404). Only failure: P8's loopback-fallback sub-check, which is unreachable
  here because `hermes_cli` *is* importable so the core gate answers instead
  (`loopback=core_reject remote=core_reject`) — a test-environment artefact, but it does
  mean the standalone fallback branch is untested in this environment.
  Full log: `~/.hermes/cache/scratch/ws_proof_clean.log`.
- The same proof run with the worker's env inherited (as a kanban worker gets it):
  **1/13** — the watcher read the pinned `gantt-demo` board while writes went to the
  sandbox, so no change was ever detected. Evidence for hard part 2 and for the rule
  "clear `HERMES_KANBAN_DB` before measuring".
- **Not re-run today** and therefore *cited, not verified*: the pre-prototype latency
  benchmarks, the 1000-task synthetic board and the 25-client thundering-herd numbers in
  `polling-baseline.md` §3 (harness still present at `docs/spikes/harness/`, raw results in
  `docs/spikes/results/`). Anyone quoting them should re-run them first.
