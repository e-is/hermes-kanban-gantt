# Polling audit — kanban-gantt desktop view (card `t_d4f0de43`)

Scope: the desktop plugin `e-is/hermes-kanban-gantt`, working tree `~/git/hermes-kanban-gantt`,
branch `spike/ws-push-prototype`, HEAD `7a2df25` **plus an uncommitted tree that a sibling card
(`t_38159a28`, the websocket PoC) is editing concurrently** — every `plugin_ws.py` / `src/ws.ts`
line below is a snapshot, and the polling paths themselves are unchanged by that sibling.
Re-checked after the sibling landed its work as commit `48fda64`: the polling line numbers below
(`src/main.ts:1378, 1403-1407, 1447-1452`, `src/ui/TitlebarBoardSwitcher.tsx:16-20`) still hold
unchanged.

This audit was re-run from scratch (grep + live handlers + a sealed latency harness); the four
older docs in `docs/spikes/` (`current-state-and-requirements.md`, `polling-baseline.md`,
`polling-inventory.md`, `polling-audit.md`) were written against earlier revisions
(`c7945f2`, `fc8cc84`) and their `src/main.ts` numbers have drifted (+46 lines for the gantt
query). Where I cite them instead of measuring, the line says so.

---

## 1. Every polling site (verified in this tree)

`P` = must be replaced by push · `C` = conditional/on-demand, keeps working under push.

| # | Site | file:line | Interval | Talks to | Auth | Retry / failure | Cl. |
|---|------|-----------|----------|----------|------|-----------------|-----|
| 1 | Gantt snapshot — the loop the spike targets | `src/main.ts:1403-1407` (`queryFn` 1405, `refetchInterval` 1407) | `60_000` ms; `300_000` once `wsState === 'live'` | `GET /gantt?board=<slug>` → `dashboard/plugin_api.py:373-374` (`get_gantt`) → `_read_gantt` (`:271`) | plugin REST door (`ctx.rest`), gateway session cookie; **no token sent by the plugin** (`src/state.ts:56-73`) | react-query default 3 attempts + backoff; failure is silent — `isError` is destructured (`:1403`) and never rendered | **P** |
| 2 | Board list (page) | `src/main.ts:1374-1378` (`:1378`) | `5 * 60_000` | `GET /boards` → `plugin_api.py:250-251` (`list_boards`) | same | same | **P** |
| 3 | Board list (titlebar switcher) | `src/ui/TitlebarBoardSwitcher.tsx:16-20` (`:19`) | `5 * 60_000` | same endpoint, **same query key** `['kanban-gantt','boards',apiBase()]` → react-query dedupes it into one timer | same | same | **P** (deduped with #2) |
| 4 | Projects (create dialog) | `src/main.ts:1380-1385` | none — `staleTime: 60_000` | `GET /projects` | same | on-demand | **C** |
| 5 | Profiles (assignee list) | `src/main.ts:1388-1392` | none — `staleTime: 60_000` | `GET /profiles` | same | on-demand | **C** |
| 6 | Task drawer | `src/main.ts:918-922` | **none** | `GET /tasks/{id}` (`plugin_api.py:479`) | same | `refetch()` after every write: `:950, 959, 967, 978` | **C** |
| 7 | Timeline "now" cursor | `src/main.ts:1447-1452` (`:1451`) | `30_000` `setInterval` | nothing — local re-render (`void nowTick`, `:1771`) | — | armed **only** while `wsState === 'live'` (`:1449`) | **C** |
| 8 | Writes → invalidate | `src/main.ts:950-951, 959, 967-968, 978-979, 1441, 1526, 1563, 1574, 1668, 1681, 1913`; `TitlebarBoardSwitcher.tsx:29` | — | `invalidateQueries(['kanban-gantt', …])` — the write path assumes the *next read* is the truth | — | none | **C** |
| 9 | Client socket watchdogs (prototype) | `src/ws.ts:68` (idle), `:82` (retry), `:89` (re-arm), `:121` (first frame) | 5 s first-frame, 50 s idle, 1 retry then `WS_STATE.dead` | `/events?board=<slug>` | `?token=` in the socket URL (SDK door) | every failure → `give()`: **one** retry, then polling owns the data for good | prototype |

**The server polls nothing in production.** `dashboard/plugin_api.py` has no timer, no
background task, no `asyncio.sleep`: it is strictly request-scoped, opening one read-only sqlite
connection per read. `grep -n "setInterval\|asyncio.sleep\|while True" dashboard/*.py` matches
only `plugin_ws.py` (`:372, 378, 399, 442, 471`) — the PoC's own change-detector loop, which is
**not deployed** (§4.1). Nothing else in `src/` polls: the only `setInterval`/`refetchInterval`
hits in the tree are `src/main.ts:1378, 1407, 1451` and `src/ui/TitlebarBoardSwitcher.tsx:19`.

**Payload.** `GET /gantt` = `{board, generated_at, tasks[], labels[]}`; a task carries
`{id,title,status,assignee,priority,label,board,archived,created_at,started_at,completed_at,
run_started_at,run_ended_at,runs[],parents[],children[]}`. No bodies, no comments, no events —
the drawer fetches those separately. No pagination, no delta, no ETag: every tick rebuilds and
re-serialises the whole snapshot.

---

## 2. Baseline (measured in this run, 2026-09-29 ~18:52 CEST)

Method: in-process `plugin_api` calls through the plugin's own handlers, env clean
(`HERMES_KANBAN_DB` / `HERMES_KANBAN_BOARD` unset so nothing is pinned), host board root
`~/.hermes/kanban/boards`, 7 repetitions, median.

| Board | tasks | payload | `_read_gantt` p50 |
|---|---|---|---|
| `gantt-demo` | 16 | 8 544 B | 0.32 ms |
| `sumaris-pod` | 3 | 1 096 B | 0.26 ms |
| `obsventes` | 0 | 77 B | 0.23 ms |
| `all` (fan-in over 3 boards) | 19 | 9 556 B | 0.88 ms |
| `GET /boards` | 3 boards | 178 B | 0.081 ms |
| **one focused window, one tick** (gantt + boards together) | — | — | **0.42 ms** |

≈ 530 B and ~0.02 ms of CPU per task row, rebuilt from scratch every tick.

**Request volume and bytes per focused window** (the loop as configured in this tree, socket off):

| | requests/h | bytes/h |
|---|---|---|
| Gantt snapshot (60 s) | 60 | 512 640 |
| Board list (300 s) | 12 | 2 136 |
| **total** | **72** | **≈ 0.51 MB/h ≈ 12.3 MB/day, continuously** |

With the socket live the same window drops to `12 + 12 = 24 req/h` (−67 % requests, −78 % bytes).
Every window has its own react-query cache and its own timers, and browsers align them on the
same second: 5 windows = 360 req/h and 2.6 MB/h; 25 idle windows = 1 800 req/h, all serving the
same 8.5 KB body. Cost is linear in *rows and open windows*, not in board count.

**Propagation latency for a write that does not come from the UI** (dispatcher, CLI, another
agent, another gateway) is a pure function of where the write lands inside the 60 s window:
uniform over `[0, 60] s` → **mean 30 s, p95 57 s, worst 60 s**, plus one request + render (~ms;
the 0.42 ms handler is not the term that matters). UI-originated writes are sub-second because
they invalidate explicitly (#8).

Empirical confirmation in a sealed sandbox board (copy of a real board DB, `refetchInterval: 60_000`
poller, writes injected at a random phase, n=4, measured 2026-09-29 18:53-18:57 CEST):

| sample | write phase in window | observed latency | polls | handler |
|---|---|---|---|---|
| 1 | 32.98 s | **27.02 s** | 1 | 0.65 ms |
| 2 | 55.14 s | **4.86 s** | 1 | 0.64 ms |
| 3 | 24.08 s | **35.92 s** | 1 | 1.08 ms |
| 4 | 43.66 s | **16.34 s** | 1 | 0.77 ms |
| | | min 4.86 s / mean **21.04 s** / max 35.92 s | | |

Every sample satisfies `latency ≈ 60 s − phase`, i.e. the client always notices on the *next*
tick and never sooner: with n=4 the mean is 21.0 s (small-sample), and the distribution behind it
is uniform on `[0, 60] s` (mean 30 s, p95 57 s). Handler cost is 0.6-1.1 ms — irrelevant to the
latency, which is entirely timer phase. Harness: `propagation_latency.py` (card attachment).

**What is *not* measured here, and why.** An authenticated request through the running gateway is
not available to this worker: `http://127.0.0.1:9119/api/plugins/kanban-gantt/gantt?board=sumaris`
answers `401 {"reason":"no_cookie"}` (basic-auth header included, still 401 — the dashboard gate is
cookie-based), so the transport term below the handler is only bounded by the 401 round trip,
which costs **1.5 ms total** on loopback. That is the honest scale of the network term: two orders
of magnitude below the 60 s interval. Render/parse cost in the Electron renderer was not measured
at all.

---

## 3. Consumers of the polled data, and what each one actually needs

| Consumer | Reads | Needs push? |
|---|---|---|
| Gantt rows/bars (`allTasks`, `src/main.ts:1459`) | the `gantt` query | **yes** — this is the payload the spike exists for; external writes must show up in seconds |
| Filter facets, search, bulk selection (same snapshot) | same | **yes**, but only as a consequence of the rows: one snapshot feeds all of them, so nothing extra to push |
| Drag/drop candidates (`dropCandidates(allTasks, …)`, `:1546-1547, 1607, 2079`) | same | **yes** — must be updated by the *same* writer as the bars, or the drop targets go stale relative to what is painted |
| Drawer relation pills (`relationsOf(tasks, taskId)`, `:943`) | the page's snapshot, **not** the drawer query | **yes** — a drawer opened on a task whose parent was just linked by another agent shows stale relations today |
| Timeline "now" cursor + open run arcs (`nowTick`, `:1447-1452`, `:1771`) | local | **no** — today the 60 s tick is what advances it. Under push this becomes a local timer (the PoC already added a 30 s one); it is a render concern, not a data concern |
| Titlebar board switcher (`TitlebarBoardSwitcher.tsx:16-20`) | `boards` query, shared key with the page | **partially** — board *creation* by another agent is seconds-fresh-worthy but nobody is watching; a 5-minute refresh is defensible. If push is adopted, both observers of this key must move together (one cache key, one writer) |
| Task drawer (`:918-922`, `GET /tasks/{id}`) | its own query | **no** — it is a pull on open + after each of its own writes. Comments/events from other agents would be nice, and are *not* covered by the gantt payload at all |
| Projects cache (`:1380-1385`) | `GET /projects` | **no** — dialog-scoped |
| Profiles cache (`:1388-1392`) | `GET /profiles` | **no** — dialog-scoped |
| Writes + explicit Refresh (`:1526, 1563, 1574, 1668, 1681, 1913`, switcher `:29`) | invalidate-then-read | **no**, but the migration must keep them truthful: with a socket they either race the incoming frame or are redundant |
| External observers (dispatcher, CLI, other agents, other gateways) | nothing in this repo | **no** — they are the *producers*; the whole latency problem is that the view is the only consumer without a channel |

Net: exactly **one** consumer genuinely needs push semantics (the gantt snapshot, which drags its
own facets/bars/drag-targets with it), one is a judgement call (board list), and everything else
is periodic-refresh or on-demand and is fine on polling.

---

## 4. Requirements and constraints for a websocket path

### 4.1 What is actually deployed (measured on this workstation)

- Gateway = podman container `sumaris-agent_hermes_1`, **one** process
  `hermes dashboard --host 0.0.0.0 --port 9119 --no-open` (no `--workers`), port published
  directly (`0.0.0.0:9119->9119/tcp`); no nginx/caddy/haproxy anywhere in the loopback path
  (`ss -ltnp` shows none). A proxy that strips `Upgrade` therefore **cannot be tested locally** —
  it is an open unknown for any remote/tunneled gateway.
- Plugin routers are mounted by
  `/opt/hermes/hermes_cli/web_server_dashboard.py:871`:
  `app.include_router(router, prefix=f"/api/plugins/{plugin['name']}")` — **no `dependencies=`**,
  and `_plugin_route_secret_scope` appears **0** times in the container's copy. Starlette HTTP
  middleware does not run for the `websocket` scope, so a socket route is protected by **nothing
  but its own `authorize()`**. (The `~/git/hermes-agent` checkout *does* wrap the mount with that
  dependency — the deployed gateway is older. Any "the router dependency covers us" claim is false
  today.)
- The installed plugin is `/opt/data/plugins/kanban-gantt`, `plugin.yaml` **v1.1.0**, whose
  `dashboard/` is exactly `manifest.json` + `plugin_api.py`: **the websocket PoC is not
  deployed** — the server half needs a build + `hermes plugins install` + a gateway restart.
- Board root differs per process: the container resolves `_boards_root()` =
  `/opt/shared/kanban/boards` and `_resolve_board(None)` = `sumaris`; this worker's root is
  `~/.hermes/kanban/boards` / `gantt-demo`. A watcher must resolve boards through
  `_boards_root()`, never a hardcoded path.
- Auth on the REST door is the gateway session cookie; the plugin never sees a token
  (`src/state.ts:56-73` → `ctx.rest`). The socket door's only credential is `?token=` in the URL
  (SDK `pluginSocket`), which lands in access logs unless the gateway redacts it.

### 4.2 Hard requirements (in priority order)

1. **Parity of payload.** Push must emit exactly the `GET /gantt` body so no renderer changes;
   `parents`/`children`/`runs` travel inside their task.
2. **Atomicity per frame.** Rows, relations and label facets come from one read of one snapshot;
   a pushing writer must not be able to paint a task whose parents are from another generation
   (today this is guaranteed by the single read).
3. **Monotonic version + explicit resync.** Every frame carries a version; the client applies
   strictly newer ones and treats a gap as "resync from REST" (which is why every frame must stay
   a full snapshot — no deltas until backfill exists).
4. **Reconnect with state reconciliation.** Full snapshot on first frame *and* on reconnect;
   bounded exponential backoff with jitter; heartbeat because clients send nothing (the SDK door
   exposes `onMessage` only, no `onOpen`/`onError`, no protocol ping — "idle" and "dead" are
   distinguishable only by silence).
5. **Fallback that is tested, not assumed.** Polling stays in the tree and must re-engage on:
   socket never opens, dead socket, `authMode === 'oauth'` (SDK returns before connecting),
   and a custom backend base URL (the socket door only speaks to the plugin's own namespace).
   For those clients the 60 s poll is the only path, so it can be *demoted*, never deleted.
6. **Auth on connect, without a new credential.** Reuse the gateway session. Do not widen the
   standalone dev server (`create_app(allow_cors=True)` binds 127.0.0.1 and has no auth today).
7. **Coalescing/backpressure.** Debounce server-side so a burst of writes yields one snapshot per
   client, keep at most one pending frame per client, drop-and-coalesce rather than queue, and
   close a client whose buffers stay full (recoverable only because frames are full snapshots).
8. **Horizontal scaling story.** `Hub`-style in-process state (module-global dict) means: with two
   uvicorn workers or two gateways, versions are monotonic only within a process and a reconnect
   can land on a process whose counter restarted. Either pin one worker, or put the fan-out on
   pub/sub. This must be decided before the socket is on by default, not after.
9. **Change detection is itself a poller.** Nothing watches the board sqlite today; the PoC polls
   `PRAGMA data_version` + mtime/size every 0.25 s **per board** (`plugin_ws.py:366` `_loop`,
   `:226` `_db_signature`, 300 reads/min/board) to replace one 60 s HTTP request. That trade
   (cheap sqlite reads vs 900× more wakeups) has to be justified
   by a measured latency win, or replaced by a write hook / inotify.
10. **Observability.** A silently degraded fleet must be visible: connection count, frame rate,
    per-frame latency, and fallback events. Today a failed poll paints the last good snapshot and
    the error is destructured and discarded (`src/main.ts:1403`), so "broken" and "quiet" look
    identical.
11. **i18n / repo rules.** The transport emits no user-facing strings; en/fr bundles stay in sync.

---

## 5. Spike acceptance criteria

**Migrate** only if all of these are demonstrated on the real gateway, on a real board, with the
polling path still installed:

| # | Criterion | Threshold | Baseline today |
|---|---|---|---|
| A1 | Change→render p95 for a write made outside the UI (dispatcher/CLI/another agent), same board, same payload | **≤ 2 s** | 57 s (uniform phase of the 60 s tick) |
| A2 | Transport load, one focused window, steady state | **≥ 80 % fewer requests and bytes/h** than 72 req/h / 0.51 MB/h | 72 req/h, 0.51 MB/h |
| A3 | No CPU regression at 1 / 5 / 20 simulated clients (server p50 per update ≤ today's 0.42 ms tick, aggregate CPU < 10 % of one core on this box) | pass | 0.42 ms/tick/window |
| A4 | UI-originated writes stay sub-second (no double-render, no stale paint on drag/drop candidates) | pass | pass |
| A5 | Kill the gateway mid-session, restart it: client reconnects and repaints without stale state | **≤ 10 s**, zero duplicate/stale frames | n/a (poll recovers ≤ 60 s) |
| A6 | Fallback proven for oauth-mode and custom-`baseUrl` clients: they keep polling and the UI is not worse than today | pass | they poll today |
| A7 | Upgrade survives the transport in front of the *remote* gateway (or the feature is explicit loopback-only) | documented evidence | unknown — no proxy locally |
| A8 | Change detector cost accounted for: measured CPU/wakeups of the watch loop at the board counts you plan to serve | reported, with the fan-out decision (§4.2-9) | no detector exists |
| A9 | Rollback is one switch per side (server env + client storage key) with no data migration | pass | n/a |

**Stay on polling** if any of these hold — they are the pre-agreed kill signals:

- A1 cannot be met with a full snapshot per change (e.g. the snapshot is too big at real board
  sizes; the container's own board is ~272 KB vs 8.5 KB for `gantt-demo`), so the migration would
  need deltas and a backfill protocol before it is safe;
- the change detector needs more CPU/wakeups than the 72 req/h it replaces, or requires patching
  core `kanban_db`;
- A5/A6 cannot be met without shipping new SDK surface (an `onOpen`/`onError` door and a real
  ping), i.e. the client cannot tell "idle" from "dead" — this is the single largest unknown and
  the reason a false-dead client would silently regress to a 60 s poll *and* hold a socket open;
- a proxy in front of any gateway the user actually uses cannot be shown to pass `Upgrade`;
- nobody needs A1: if every consumer that matters is refreshed by its own writes, the 30 s mean
  latency is invisible in practice (the audit's §3 says that is true for everything *except* the
  gantt rows themselves).

If the verdict is partial, the split falls out of §3: the gantt snapshot moves first (it carries
facets, bars and drag targets), the board list is optional, and the drawer keeps its own read
path (adding a comment/event push is a separate, independent step).

---

## 6. How to re-verify

```bash
cd ~/git/hermes-kanban-gantt

# every timer site in the tree
grep -rn "refetchInterval\|setInterval" src/ dashboard/*.py

# payload + handler cost per board (env MUST be clean, or HERMES_KANBAN_DB pins the answer)
env -u HERMES_KANBAN_DB -u HERMES_KANBAN_BOARD \
  PYTHONPATH=$HOME/.hermes/hermes-agent $HOME/.hermes/hermes-agent/venv/bin/python - <<'PY'
import json, sys, time, statistics
sys.path.insert(0, "dashboard"); import plugin_api as P
for b in ["gantt-demo", "sumaris-pod", "obsventes", "all"]:
    fn = P._read_gantt_all if b == "all" else (lambda s=b: P._read_gantt(s))
    t = []
    for _ in range(7):
        t0 = time.perf_counter(); p = fn(); t.append((time.perf_counter() - t0) * 1000)
    print(b, len(p["tasks"]), len(json.dumps(p).encode()), round(statistics.median(t), 2))
PY

# propagation latency + payload/handler cost, sealed sandbox (no real board touched);
# the harness is attached to card t_d4f0de43 as propagation_latency.py
cp /path/to/propagation_latency.py /tmp/audit/ && cd /tmp/audit
SANDBOX=$HOME/.hermes/cache/scratch/ws-audit SAMPLES=4 OUT=./latency.json \
  env -u HERMES_KANBAN_DB -u HERMES_KANBAN_BOARD \
  PYTHONPATH=$HOME/.hermes/hermes-agent $HOME/.hermes/hermes-agent/venv/bin/python \
  propagation_latency.py

# what the *gateway* serves (different board root than this shell)
podman exec sumaris-agent_hermes_1 /opt/hermes/.venv/bin/python3 -c \
  'import sys;sys.path.insert(0,"/opt/data/plugins/kanban-gantt/dashboard");import plugin_api as P;print(P._boards_root(), P._resolve_board(None))'
```

The latency harness is `propagation_latency.py`: it copies a real board DB into
`$HOME/.hermes/cache/scratch/ws-audit`, points `HERMES_KANBAN_HOME` + `KANBAN_GANTT_BOARDS` at it,
asserts the resolved path, then writes a row at a random phase inside each 60 s window and times
how long the poller takes to see it. It never writes to a real board.

---

## 7. Notes for whoever picks this up

- **Working-tree collision hotspot.** `dashboard/plugin_ws.py`, `dashboard/plugin_api.py`,
  `src/main.ts`, `src/ws.ts`, `desktop/plugin.js` are being edited by the sibling card
  `t_38159a28` *while* this audit ran; line numbers in those files move. This doc's line numbers
  were read at the revision above and re-checked against the dirty tree for the polling paths.
- The four older `docs/spikes/*.md` are not replaced by this file: `polling-inventory.md` is the
  deeper survey, `polling-baseline.md` holds the large-board and thundering-herd numbers
  (cited, not re-run here), `websocket-recommendation.md` holds the PoC verdict.
