# Spike result — replace the kanban-gantt polling loop with WebSockets

Card `t_01745262` (board `gantt-demo`), 2026-09-29. Scope: the plugin
**e-is/hermes-kanban-gantt** and the Hermes gateway that mounts it.
Deliverable asked for: go/no-go, architecture, effort, measured numbers, top risks.
Supporting work: `polling-inventory.md` (the poll audit),
`websocket-stack-evaluation.md` (stack comparison + the 15 hard parts),
`ws-push-prototype.md` (prototype), `polling-baseline.md` (pre-prototype load harness).

## 1. Verdict — **GO**, behind the flag, for loopback/token desktops only

Replace the 60 s `refetchInterval` on `GET /gantt` with a push on the plugin's **own**
websocket route (Starlette/FastAPI-native, no new dependency, no new process), fed by a
per-board SQLite change watcher, consumed through the desktop SDK's existing `ctx.socket`.
Keep the REST poll as the permanent fallback and keep the feature behind `KANBAN_GANTT_WS`
(default off).

Two reasons it is a go, and they are the two things a spike is supposed to settle:

* the transport is **inherited, not chosen** — the gateway already runs a production
  websocket stack in the same process behind the same auth gate, and the desktop SDK already
  exposes the client half;
* the route **survives the real gateway**, which was the single highest-risk unverified
  assumption in every earlier note. It has now been measured, not argued (§4).

Not a go for the whole fleet yet: the flag is off by default and the hardening list in §6 is
what would make it defensible as a default.

## 2. The polling loop as it exists (concrete numbers)

| | Value | Source |
|---|---|---|
| Where | `src/main.ts`, `useQuery(['kanban-gantt','gantt', …])` — `refetchInterval: 60_000`, demoted to `300_000` only while the socket reports live | `polling-inventory.md` §1 |
| What it fetches | the whole Gantt snapshot: tasks + labels + link graph, `GET /gantt?board=<slug>` | `dashboard/plugin_api.py::_read_gantt` |
| Payload | 19-task demo board **10 173 B**; 16 tasks / 8 544 B in this run; `?board=all` 9 556 B | measured, `polling-baseline.md` §2, `ws_proof.py` P1 |
| Request rate | **1 req/min per open window** — 1 440/day; N windows ⇒ N full snapshots/min | by construction |
| Bytes | **≈0.61 MB/h per window**; 212 MB–6.4 GB over 30 days on the earlier 1 000-task synthetic board | `polling-baseline.md` §3 (cited, not re-run) |
| Server cost | one `mode=ro` SQLite read per request: **0.23 ms p50** (demo board), 0.67 ms (`all`) | `polling-baseline.md` |
| Errors/retries | react-query: 3 tries, last snapshot stays painted; nothing on screen says "stale" | `polling-inventory.md` |

## 3. Polling vs. WebSocket, side by side

WS numbers are the two real harnesses, both re-run while writing this: `tests/ws_proof.py`
(standalone plugin app) and the **gateway probe** (§4, a real `hermes dashboard` process).

| | **Polling (60 s)** | **WS, standalone proof** | **WS, through the real gateway** |
|---|---|---|---|
| Write → UI latency | 0–60 s (mean ≈30 s) | **p50 393 ms, p95 429 ms, max 1 612 ms** (poll 100 ms/debounce 300 ms in the harness) | **553 / 554 / 555 ms** (production defaults: 250 ms poll + 300 ms debounce) |
| HTTP requests for updates | 1 440/day/window | **0 `GET /gantt`** for the whole run (P7) | 0 (socket only) |
| Bytes per update | one full snapshot per window per minute | one full snapshot **per change, per board** — a 10-write burst coalesced to 1 frame / 1 DB read | same, one snapshot per change |
| DB reads | one per request per window | **2 subscribers ⇒ 1 read** (P5) | 2 subscribers accepted on one board, one hub (G4) |
| Largest frame | — | **2 045 B** mid-proof (budget 600 KB) | **10 494 B** for the 22-task board (REST shape) |
| Reconnect | n/a | first frame after reconnect is a full snapshot (P10) | V1 continuity observed (version 1→2→3→4→5 across 2 sockets) |
| Auth | cookie/HTTP middleware | loopback fallback | **dashboard token gate, no-credential upgrade refused** (G1) |
| Flag off | — | `/events` 404, `GET /gantt` 200 (P11) | not exercised (same code path) |

**Numbers that matter for the decision:** worst case the UI learns about a change in
**~0.55 s** instead of **up to 60 s**, while the per-window traffic drops from 1 440
snapshot downloads per day to "one per change", and the server does *one* read per change per
board no matter how many windows are open. The cost is a 0.25 s signature poll per subscribed
board (`PRAGMA data_version` + mtime + size) — still unmeasured on a board with a running
dispatcher, and the one number that could move the verdict (§8).

## 4. Does it survive the real gateway? Yes — after one real bug

This was the open item every earlier note flagged as *not verified*. A real
`hermes dashboard` process was started against a throwaway `HERMES_HOME` with the plugin
installed as a user plugin (`plugins.enabled`), `KANBAN_GANTT_WS=1`, and driven by a real
websocket client. Harness + raw output: `harness/gateway/` and
`results/gateway-upgrade.log`.

**Run 1 (before the fix) — the feature silently did not exist in the gateway:**

```
kanban-gantt: websocket prototype unavailable (No module named 'plugin_ws')
```

Core imports a plugin's `api` file with
`importlib.util.spec_from_file_location("hermes_dashboard_plugin_<name>", …)` and **never adds
the plugin directory to `sys.path`** (`hermes_cli/web_server_dashboard.py:855-882`). The
prototype's `import plugin_ws` therefore raised `ImportError`, was swallowed by the
"never break the REST backend" guard, and `/events` was never registered — the client would
have fallen back to polling forever, with one stdout line as the only trace.
**Fixed** (`load_sibling()` in `plugin_api.py`, `_plugin_api()` in `plugin_ws.py`: reuse the
instance core already loaded, else load the sibling by path) and pinned by
`tests/ws_mount_gateway.py`, which imports the plugin exactly the way core does, with the
dashboard directory deliberately off `sys.path`:

```
PASS M1 gateway-style import registers /events when KANBAN_GANTT_WS=1
PASS M2 the websocket module is the one the plugin router uses — loaded|same-instance
PASS M3 flag off ⇒ no /events route, REST route set unchanged
PASS M4 flag off ⇒ the websocket module is still importable (no crash)
RESULT: 4/4 checks passed
```

**Run 2 (after the fix) — the real gateway, 5/5:**

```
PASS G1 unauthenticated upgrade refused — InvalidStatus
PASS G2 gateway accepts the upgrade and pushes a snapshot first — type=snapshot version=1 tasks=22 bytes=10494
PASS G3 out-of-process writes are pushed over the gateway socket — latencies_ms=[553, 554, 555] versions=[2, 3, 4]
PASS G4 a second subscriber is accepted on the same board — version=5
PASS G5 unknown board refused (no crash, no frame) — InvalidStatus
GATEWAY RESULT: 5/5 checks passed
```

and the gateway's own log, which is the part that settles the auth question:

```
INFO hermes_cli.web_server: Mounted plugin API routes: /api/plugins/kanban-gantt/
INFO kanban_gantt_plugin_ws: kanban-gantt ws: rejected upgrade (core_reject)
```

* the mount is the production one (`include_router` + `_plugin_route_secret_scope`), not
  `create_app()`;
* the plugin's `authorize()` correctly delegates to core `_ws_auth_ok` — a wrong/absent
  credential is a **`core_reject`**, and the log line records the *reason*, never the
  credential;
* **`?token=` log redaction is a non-issue**: grepping every gateway log for the token
  string returns nothing, and this deployment writes **no uvicorn access log at all**
  (only the plugin's own line). The earlier "verify the gateway redacts it" item is closed
  by measurement, not by assumption.

**Two things the gateway run exposed that no doc had:**

1. **The `HERMES_KANBAN_DB` pinning trap is live in the gateway path** (hard part #2, now
   reproduced end-to-end). Started from a kanban worker's shell — which is exactly what a
   supervisor or a `hermes dashboard` launched from a worker gets — the gateway inherited
   `HERMES_KANBAN_DB=<board>/kanban.db`, and then every subscription resolved to *that*
   board: `?board=does-not-exist` returned a **valid snapshot of the pinned board** instead of
   refusing. Mitigation for today: start the gateway env-clean, and treat
   `KANBAN_GANTT_BOARDS`/`HERMES_KANBAN_HOME` as the only board root the socket trusts.
   Proper fix: after resolving a slug, assert the path is `<boards_root>/<slug>/kanban.db`
   and refuse anything else. This is a T1 item, not a T2 one.
2. **The stream loop dies noisily when the last subscriber leaves**:
   `kanban-gantt ws: stream for wsgw ended: RuntimeError` on every disconnect (the loop's
   `run_in_executor` / reader path after the socket closed). Harmless so far — the next
   subscriber recreates the stream — but it is the code path that also carries the
   grace-window version continuity, so it needs a clean teardown before the flag is default.

## 5. Proposed architecture (what is in the tree)

| Piece | Choice |
|---|---|
| Server route | `@router.websocket("/events")` in `dashboard/plugin_ws.py`, attached only when `KANBAN_GANTT_WS` is set, mounted at `/api/plugins/kanban-gantt/events` |
| Runtime | the host's own CPython + fastapi 0.133.1 / starlette 1.3.1 / uvicorn 0.41.0 / websockets 15.0.1 — no new pin, no new process |
| Wire format | JSON, `{type:'snapshot'|'heartbeat', board, version, generated_at, tasks[], labels[]}` — the REST shape plus a header, applied to the same react-query cache key |
| Change detection | per-board `PRAGMA data_version` + `st_mtime_ns` + `st_size`, 250 ms cadence, 300 ms coalescing, one `_read_gantt` per change per board |
| Client | `ctx.socket('/events?board=<slug>')`, full snapshot first, version-gap ⇒ REST resync, first-frame/idle timeouts, one retry then polling |
| Auth | handshake-time delegation to core `_ws_auth_ok`, loopback-only fallback for the standalone dev server |
| Fallback | the 60 s poll, kept forever for OAuth/custom-URL clients; SSE documented as the transport fallback if `ws://` is blocked |
| Rollout | `KANBAN_GANTT_WS` (default off) — flag off ⇒ route not registered, `/events` 404, REST untouched |

## 6. Effort

| Tier | Scope | Estimate |
|---|---|---|
| **T0 — done** | flag-gated prototype for the one loop + proof + gateway probe + mount regression test | landed on `spike/ws-push-prototype` |
| **T1 — minimal productionization** | (1) board-path assertion against the pinning trap; (2) treat a server-initiated close (1012) as reconnectable instead of fatal; (3) one source of truth for heartbeat/idle constants; (4) clean stream teardown on last disconnect; (5) `KANBAN_GANTT_WS` in README; (6) rebuild + `hermes plugins install` + visual check | **2–3 days** (the gateway-upgrade item that used to be first here is now **done**) |
| **T2 — hardened** | observability (connections/frames/reads/rejects + a degraded badge, i18n en+fr), SSE fallback, `all`-boards fan-in, frame coalescing across windows, `task_events` cursor replay, watcher cost on a busy board, multi-worker fan-out design, tests for deploy drain and handshake-failure fallback | **5–8 days** |

## 7. Top risks and mitigations

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| **Board data cross-wiring via `HERMES_KANBAN_DB`** — reproduced live (§4.1): an unknown slug served the pinned board | certain if the gateway inherits a worker env; **wrong data on screen** | assert the resolved path is under `<boards_root>/<slug>/`; refuse otherwise; start the gateway env-clean; T1 |
| Silent degradation — the route not registering (the bug this spike found) would just look like "still polling" | was certain in gateway mode, now fixed and covered by `ws_mount_gateway.py` | keep the guard *and* the test; consider logging at WARNING, not stdout |
| **Routine gateway restart degrades clients permanently** — uvicorn closes sockets with **1012** on shutdown; the client treats every close as fatal (`WS_MAX_ATTEMPTS = 1`) | medium / high (invisible, sticky until reload) | treat 1012 (any server-initiated close) as reconnectable; T1 |
| Auth is a re-implementation on a route HTTP middleware never touches | low now (delegates to core, verified through the gateway) | keep the delegation; never set `KANBAN_GANTT_WS_TOKEN` in production (it is a bypass for the standalone server) |
| Watcher cost on a busy board (0.25 s × boards, WAL contention) | unmeasured | **measure with a dispatcher running**; if it bites, move to inotify/`file_control` — transport unchanged |
| At-most-once, drop-and-coalesce delivery; no replay | accepted by design | every frame is a full snapshot, so a lost frame self-heals; deltas stay out until a delivery guarantee exists |
| Horizontal scaling (second worker/gateway) | not today (one uvicorn worker, one SQLite writer) | per-process versions + in-process hub are wrong the moment that changes → broker or `task_events` cursor; falsifier #1 in the stack evaluation |
| No observability at all | certain today | T2 first item; a silently degraded client fleet is the failure mode this removes |

## 8. What would still flip the verdict

1. A second gateway process serving the same boards (then in-process fan-out/versions are wrong).
2. Watcher cost on a dispatcher-busy board above the poll's own ~0.3 ms/snapshot cost.
3. p95 > 2 s or frames ≥ 600 KB on a real board (the 239-task `sumaris` board has not been measured — it lives in the container's board root, not on this workstation).
4. The desktop SDK losing/limiting `ctx.socket`, or gaining `onOpen`/`onError` + ticket auth (which would also let the OAuth/custom-URL population use push, and retire hard part #5).
5. Board writes ceasing to be local SQLite (then a file/mtime watcher detects nothing).

## 9. Prototype, harnesses and raw evidence

* Prototype: `dashboard/plugin_ws.py` + `dashboard/plugin_api.py` wiring, client `src/ws.ts`,
  `src/core/ws-core.ts` — branch `spike/ws-push-prototype`, flag off by default.
* `tests/ws_proof.py` — 13/13 PASS, standalone plugin app (re-run: p50 393 ms, p95 429 ms).
* `tests/ws_mount_gateway.py` — 4/4 PASS, core's import mode (new: pins the bug from §4).
* `docs/spikes/harness/gateway/` — the real-gateway harness (sandbox `HERMES_HOME`, launcher,
  ws probe) and `docs/spikes/results/gateway-upgrade.log` — the raw run above.
