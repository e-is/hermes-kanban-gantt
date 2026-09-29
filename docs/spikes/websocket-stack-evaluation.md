# Websocket stack evaluation — kanban-gantt polling → push

Card `t_22c4e5cc` ("Evaluate websocket stack options and migration risks"), child of spike
`t_edf13882` ("replace the polling loop with websockets"), board `gantt-demo`, 2026-09-29.
Deliverable for that card: one recommended stack, explicit rejected alternatives, every
hard part from the polling audit either addressed or deferred, and the falsifiers.

Scope = the plugin **e-is/hermes-kanban-gantt** (FastAPI backend `dashboard/`, Electron/React
client `src/`) and the Hermes host it runs inside (`~/.hermes/hermes-agent`, the gateway that
mounts the plugin router).

**Verified against**

| What | Revision / instance | How |
|---|---|---|
| Plugin tree | `064d7f0` (HEAD, working tree clean) | `git log -1`, `git status` |
| Host tree | `~/.hermes/hermes-agent` @ `8f21606116` | `git log -1` |
| Live gateway | container `sumaris-agent_hermes_1`, `hermes dashboard --port 9119` | `ps`, `podman exec` |
| Runtime versions | CPython **3.13.5**, fastapi **0.133.1**, starlette **1.3.1**, uvicorn **0.41.0**, websockets **15.0.1** | `podman exec … -c "import fastapi,starlette,uvicorn,websockets"` |
| Push proof | `tests/ws_proof.py` **13/13 PASS** (re-run by this card) | appendix A |
| Hard parts input | `docs/spikes/polling-inventory.md` §6 (15 items, card `t_47c1cced`) | read in tree |

Supersedes `docs/spikes/websocket-options.md` (written before the prototype and before the
fresh polling audit; its line references are stale and it never saw a running socket).
Predecessor notes kept for history: `current-state-and-requirements.md` (R1–R20),
`polling-baseline.md` (load benchmarks — cited, not re-run), `ws-push-prototype.md`.

---

## 1. Runtime and deployment — can this platform hold a long-lived connection?

Yes, unconditionally, and that is not a close call in either direction: there is nothing on
the platform side left to buy.

| Layer | Fact | Evidence |
|---|---|---|
| Plugin backend | Python + **FastAPI router**, no socket route of its own before the prototype | `dashboard/plugin_api.py:43` `router = APIRouter()`; docstring: two run modes (mounted plugin / standalone uvicorn) |
| Host process | **Long-lived `uvicorn.Server`**, started once per gateway, never a serverless handler | `hermes_cli/web_server.py:1176-1233` (`uvicorn.Server is driven directly (not uvicorn.run)`), `:1606 await server.shutdown()` |
| Mount point | `app.include_router(router, prefix="/api/plugins/<name>", dependencies=[Depends(_plugin_route_secret_scope)])` — **router-level deps reach websocket routes** in fastapi 0.133.1 | `hermes_cli/web_server_dashboard.py:878-882` |
| Existing ws substrate | Core already serves ws at `/api/console`, `/api/pty`, `/api/ws`, `/api/pub`, `/api/events`; the bundled kanban plugin serves a plugin-namespaced board-event socket | `web_routers/chat_ws.py:277,438,595,634,646`; `plugins/kanban/dashboard/plugin_api.py:1769` + `:48-57` |
| Client door | `ctx.socket(path, onMessage) → dispose`, token in the query string, JSON frames, auto-reconnect | `apps/desktop/src/api/plugins.ts:98-145` |
| Client stack | Electron **40.10.2**, React **19.2.7**, `@tanstack/react-query` **5.101.2** (intervals, no retry policy of its own) | `apps/desktop/package.json:105,139,185` |
| Store | SQLite **WAL**, one `kanban.db` per board, append-only `task_events`; reads are short-lived `mode=ro` connections | `dashboard/plugin_api.py:254-299`; `kanban_db.list_events` |

Platform capacity — the three typical blockers are all already decided:

* **Serverless / request timeouts:** not applicable. Long-lived process (`web_server.py:1176-1233`).
* **Load balancer idle timeouts, sticky sessions:** none locally (desktop → gateway on loopback).
  Off-loopback the deployment is an SSH-isolated backend or a Cloudflare-style tunnel: the host
  already keeps ping on for exactly that case (see next row), and a tunnel needs `Upgrade`/
  `Connection` passed with a read timeout above the ping (hard part 7 / B7).
* **Keepalive policy:** uvicorn ping is **disabled on loopback** on purpose (a dead local client
  sends a real FIN/RST; the ping only risks dropping healthy sockets under GIL starvation) and
  kept off-loopback at `dashboard.ws_ping_interval` / `ws_ping_timeout`, default **20/20 s**
  (`web_server.py:1191-1211`, `config_defaults.py:1017-1018`). An SSH-isolated desktop backend
  gets **60/600 s** tunnel constants plus client counting at the ASGI boundary and an idle
  watchdog (`web_server_idle_exit.py:37-38,69`; `web_server.py:1221-1232`).
* **Message size ceiling:** `ws_max_size=_DESKTOP_ATTACHMENT_WS_MAX_BYTES` (`web_server.py:1231`) —
  the snapshot is two orders of magnitude below it, so the ceiling is not a design constraint.

**Consequence for the whole evaluation:** the transport is not being chosen here, it is being
inherited. The host runs a production websocket stack in the same process, behind the same
auth gate, for the same topic ("this board changed"), and the desktop SDK already exposes the
client half. The evaluation is therefore *which flavour to hang on that substrate*, plus what
has to be written that does not exist yet (a change watcher and a fan-out).

---

## 2. Options compared

| | **A. Starlette/FastAPI-native ws on the plugin router** (+ a change watcher) | **B. Socket.IO** (`python-socketio` + `socket.io-client`) | **C. SSE** (`sse-starlette` + `EventSource`) | **D. Managed realtime** (Ably / Pusher / Supabase) | **E. Status quo polling** | **F. Reuse core's channel bus** (`/api/pub` → `/api/events`) |
|---|---|---|---|---|---|---|
| **New deps** | **None** — `websockets==15.0.1` is a core pin, uvicorn/fastapi/starlette are core; the route lives in the file already mounted | Two (server+client) in lockstep, plus a second wire protocol (engine.io) nothing else here speaks | One declared pin — `sse-starlette 3.4.8` is resolved in `uv.lock` only transitively (MCP HTTP-SSE) | Vendor account, API keys, per-message billing | None | None |
| **Ops cost** | Zero new process; watcher is one task per *subscribed board*, not per client | Sessions to store; its long-poll fallback reintroduces the exact traffic this spike removes | Plain HTTP, no upgrade; still a second auth path and HTTP/1.1 connection ceiling | Data leaves the machine — violates the plugin's "zero API keys, zero model tokens" premise (`AGENTS.md`) | 72 req/h + 0.61 MB/h per focused window; bytes scale with windows | Cheap to build, but see *Fatal flaw* below |
| **Auth** | Rides the host gate inside the handler (core `_ws_auth_ok`, the bundled-kanban pattern) | A second auth handshake beside the host gate | Cookie/header/query, but the gate is still a second implementation | Third credential system | Already correct | Whatever core already validated |
| **Scaling / fan-out** | Single process, single-writer SQLite → no broker needed; per-board fan-out must be written either way | Redis adapter + sticky sessions buy nothing for one SQLite writer | No stickiness needed; ~6 conns/host caps several boards/tabs | Vendor scales at a price | Worst: N windows = N full snapshots | In-process only |
| **Reconnect semantics** | SDK does token auth + full-jitter backoff (500 ms → 30 s); app-level: first-frame full snapshot + version + resync | Strongest OOTB, i.e. a re-implementation of what the host already ships | `EventSource` auto-reconnect + `Last-Event-ID` — maps 1:1 onto our `task_events` cursor | Vendor | react-query 3 tries, last snapshot stays painted | Manual, same as A |
| **Maturity** | First-class Starlette primitive, already deployed and exercised in-tree | Very mature, widely used, **absent from this codebase** | Standard, lib already in the lock | Mature, but an operational + privacy commitment | Proven, boring, and the reason the board feels stale | Core code, but a raw primitive with no board semantics |
| **Fatal flaw / verdict** | **Recommended** | Differentiating features are irrelevant here or re-implementations | **Right fallback, wrong primary** (one-way, HTTP/1.1 ceiling) | Rejected on the plugin's own premise | Stays as the mandatory fallback | **Rejected: no producer for external writes** |

**Why F fails** (worth writing down because it looks attractive): core's `/api/pub` ↔ `/api/events`
is a generic in-process channel bus (`web_routers/chat_ws.py:68,634,646`, `_broadcast_event` on
`app.state`). But the writes this view must react to come from **outside the gateway process** —
the CLI, the kanban dispatcher, other agent containers (`kanban_db` mutators, `dashboard/plugin_api.py:254-299`
reads them back). An in-process broadcaster cannot see them, so a DB-level change detector is
required no matter which transport is chosen. Once that detector exists, the plugin route is
strictly more useful: it is board-scoped, it reuses the plugin's own mount and auth, and it
does not couple the plugin to a core-internal stream that the desktop SDK does not expose.

---

## 3. The non-obvious concerns (the ones that decide whether this is safe)

1. **Auth and token refresh over an upgraded connection.** Starlette's HTTP middleware does not
   run for the `websocket` scope (`web_server_chat.py:168`), so a plugin ws route is **not**
   covered by whatever protects `GET /gantt` and must authenticate itself — the prototype does
   (`authorize()`, delegating to core `_ws_auth_ok`, loopback-only fallback).
   Refresh: there is nothing to refresh — the credential is the desktop *connection token*
   appended by the SDK (`plugins.ts:113-115`), valid for the life of the connection; gated
   remotes use single-use tickets (30 s TTL) and **reject** `?token=`, which is why the SDK
   returns early for OAuth. Two real residual risks, both deferred: `?token=` is a **query
   string** (verify the gateway redacts it in access logs), and the gated/OAuth path needs a
   change in **hermes-agent core**, not here.
2. **Reconnect and resubscribe with backoff.** Already written twice, deliberately kept as two
   layers: the SDK reconnects with full-jitter 500 ms → 30 s on `onclose` (`plugins.ts:127-138`,
   unbounded), and the plugin adds a *policy* on top (first-frame timeout, idle timeout, one
   retry, then polling for good). Resubscribe is free: reconnect ⇒ new handshake ⇒ the server
   sends a **full snapshot as the first frame** (verified: "P10 the first frame after a reconnect
   is a full snapshot — v10 with 17 tasks"). The v1.1 prototype bug the proof caught (board
   stream torn down with the last client, version counter restarting at 1 below what the client
   had rendered) is exactly the failure a grace window exists to prevent — keep it.
3. **Message ordering and delivery.** Deliberately **at-most-once + drop-and-coalesce**: one
   pending frame per subscriber, slow consumers closed (code 4408) rather than queued, and every
   frame a full snapshot, so nothing needs replay. Ordering is enforced client-side by a
   monotonic per-board `version`; `version <= lastVersion` ⇒ ignored, a gap ⇒ REST resync.
   This is why deltas are still out: a lost delta is unrecoverable, a lost snapshot is not.
   Reported numbers for the whole proof: p50 **391 ms**, p95 **409 ms**, largest frame **2 045 B**,
   a 10-write burst coalesced to **1 frame / 1 DB read**, two subscribers ⇒ **1 read**.
4. **Heartbeats, ping-pong and idle detection.** Two mechanisms, no protocol ping on loopback:
   the server emits a **data-level heartbeat every 20 s** while a board is idle, and the client
   treats 5 s without a first frame / 50 s without any frame as dead. Ratio 20 s ↔ 50 s (2.5×) is
   load-bearing: drift silently converts a healthy board into "dead", which (as written today)
   falls back to polling until reload. Residual: make both constants derived from one config
   value, and treat a server-initiated close (below) as reconnectable rather than fatal.
5. **Horizontal scaling and pub/sub fan-out.** Today the deployment is **one process** (one
   uvicorn worker in one container, `ps`), so in-process per-board fan-out is correct and a
   broker would be pure cost. But the design ages badly on purpose: the version counter is only
   monotonic *within* a process, and the grace window only helps inside one process. If a second
   worker or a second gateway ever serves the same board population, the fan-out must move to a
   shared channel (or the client must fall back to cursor replay over `task_events`, which is the
   pattern the bundled kanban socket already implements at `plugins/kanban/dashboard/plugin_api.py:1769-1800`).
   **Falsifier #1.**
6. **Observability.** Gap, not solved: the plugin logs subscriber attach/detach/rejections
   (`plugin_ws.py:444-499`) but exposes **no counters, no connection gauge, no error rate**, and
   the client has no "live / degraded / dead" surface. The host shows the shape to copy — it
   counts accepted websockets at the ASGI boundary for its idle watchdog
   (`web_server_idle_exit.py:69`). Minimum useful set before rollout: live connections per board,
   frames sent / reads per board, handshake rejects by reason, resync rate, and a degraded badge
   (any user-facing string needs its `en`/`fr` key in `src/i18n.ts` in the same edit).
7. **Graceful deploys that drain connections.** Verified in uvicorn 0.41.0: `Server.shutdown()`
   stops accepting, then calls `connection.shutdown()` on every existing connection — for a
   websocket that is a **close with code 1012 (Service Restart)** — then waits
   `timeout_graceful_shutdown` for running tasks (`protocols/websockets/wsproto_impl.py:184-192`,
   `server.py:271-297`); the host does not configure that timeout, and the gateway's own restart
   drain knob is `agent.restart_drain_timeout` (`config_defaults.py:108`, **0** by default, 60 on
   this workstation). So a restart drains sockets explicitly rather than truncating them — but the
   plugin's client wrapper currently treats *every* close as a failure and gives up after one
   retry, which turns a routine deploy into a permanent fallback to polling until the window is
   reloaded. **Fix before rollout: treat 1012 (and any server-initiated close) as reconnectable.**

---

## 4. Fallback path for clients that cannot hold a socket

Two distinct fallbacks, and neither is optional:

* **Application-level (mandatory, already in the tree).** The 60 s interval is demoted to
  **300 s only while the socket reports live** (`src/main.ts:1406`) and stays 60 s forever
  afterwards. Clients that can never use the socket are a *designed* population, not an edge
  case: OAuth remotes (`plugins.ts:105-109` returns before connecting) and any user with a custom
  "backend API" base URL. The drawer's own query, manual Refresh, board switch and every
  post-mutation `invalidateQueries` remain REST reads — truth-after-write is still a re-read.
* **Transport-level (deferred, with a named trigger).** If a deployment ever sits behind a proxy
  that blocks `ws://`, **SSE via `sse-starlette`** is the fallback to build, because
  `EventSource` reconnects on its own and `Last-Event-ID` maps 1:1 onto the same version/cursor
  contract; it needs a server heartbeat above the tunnel's ~100 s idle. **Long-poll is rejected:**
  engine.io-style long-poll re-introduces the per-window polling traffic this work exists to
  remove, only with worse framing.

---

## 5. Every hard part from the polling audit, addressed or deferred

Input: `docs/spikes/polling-inventory.md` §6 (15 items, of which #1–#12 and #14 are risks, #13
and #15 are consequences). Nothing here is left unclassified.

| # | Hard part (audit §6) | Status | Evidence / what closes it |
|---|---|---|---|
| 1 | The push path contains a poller of its own (0.25 s `PRAGMA data_version` per board) | **Addressed, residual deferred** | Server-side watch exists and is coalesced (0.3 s debounce, one read per change per board); the trade is explicit: 4 signature reads/s/board vs a 10 KB snapshot/min. Residual: its cost on a board with a running dispatcher is **unmeasured** → measure, then consider 0.5–1 s or inotify/`file_control`. |
| 2 | `HERMES_KANBAN_DB` pinning silently cross-wires boards | **Addressed** | Subscribe validates the slug with the same rule as the REST read (`_board_db_path`, traversal refused — P9) and resolves the DB through core helpers. Reproduced again by this card from a worker env (`HERMES_KANBAN_DB=…/gantt-demo/kanban.db` is what a kanban worker gets), which is why the proof must be run env-clean. Residual: an automated test asserting a pinned env **cannot** cross-subscribe. |
| 3 | Every window is its own socket and its own cache; frames are not coalesced | **Partially addressed, deferred** | Server coalesces *reads* per board (two subscribers ⇒ one read, verified); *frames* stay per socket. Trigger to revisit: >3–5 windows on one board, or measured duplicate bytes. |
| 4 | The socket door is receive-only (no `onOpen`/`onError`, no protocol ping) | **Addressed locally, deferred upstream** | Compensated by a 5 s first-frame timeout, a 50 s idle timeout and the 20 s data heartbeat, but that makes false-dead and false-alive both possible. Proper fix = `onOpen`/`onError` (or a ping frame) on `pluginSocket` → **follow-up ticket against hermes-agent**, not this repo. |
| 5 | OAuth / custom-URL remotes cannot use the socket at all | **Addressed by policy, deferred** | Push is refused for both populations by design; polling remains their only path (§4). Enabling it is a **core** change (ticket-based handshake), not a plugin one. |
| 6 | At-most-once, drop-and-coalesce delivery | **Accepted explicitly** | One pending frame, slow consumers closed; recoverable because every frame is a full snapshot. Consequence: **deltas stay out** until a delivery guarantee exists. |
| 7 | The first frame is the only resync primitive | **Addressed** | First frame after subscribe/reconnect is a full snapshot and the change signature is captured *before* the read, so a concurrent write is detected on the next tick instead of absorbed (P1/P10). Rule for future work: never turn the first frame into a delta. |
| 8 | `?board=all` has no single thing to watch | **Deferred** | The client subscribes only with a concrete board selected; `all` keeps its REST interval. Trigger: real use of the aggregate view — then N signatures merged, one watcher per board, unknown boards must not kill the stream. |
| 9 | WS auth is a re-implementation, never exercised against the real gateway | **Addressed — verified through the real gateway (card `t_01745262`)** | A real `hermes dashboard` process (production mount path, `plugins.enabled`, `KANBAN_GANTT_WS=1`) was driven by a real ws client: upgrade accepted with the dashboard token, refused without (`core_reject`), snapshot pushed first, out-of-process writes pushed at 553–555 ms, unknown board refused — `results/gateway-upgrade.log`, `harness/gateway/`. `?token=` redaction closed by measurement (no access log at all; no log line contains the token). **Two findings that gate rollout:** the route did **not** register in gateway mode at all until the sibling-import fix (§3 note below), and the `HERMES_KANBAN_DB` pinning trap is live in the gateway path (an unknown slug served the *pinned* board's snapshot) — see `websocket-recommendation.md` §4/§7. |
| 10 | The heartbeat is a data frame and its period is load-bearing | **Addressed, residual minor** | 20 s server vs 50 s client idle (2.5×), documented on both sides. Residual: derive both from one value so drift cannot make a healthy board "dead". |
| 11 | Stale-window semantics unspecified | **Deferred (decision, not code)** | Today an unfocused window stops polling; with push it should **keep** the socket (a socket is cheaper than the poll it replaces and the server already coalesces reads) with at most one buffered frame — decide once, then state it in the doc. |
| 12 | Failure visibility does not exist | **Deferred** | No metrics, no degraded UI. Closes with §3.6 (counters + i18n badge) and a test that a failed handshake falls back to the interval, never to a blank page. |
| 13 | Registration is boot-time and env-driven | **Addressed** | Flag off ⇒ route never registered, `/events` 404, REST unchanged, `/gantt` still 200 (P11 verified). Consequence accepted: rollout/rollback is per-process and needs a gateway restart. |
| 14 | No cross-process fan-out (module-global hub, per-process versions) | **Deferred, with falsifier** | Correct for today's single-process deployment; wrong the moment a second worker/gateway serves the same boards (§3.5). |
| 15 | `generated_at` changes every read and is displayed nowhere | **Addressed for correctness, deferred for optimisation** | Frames are full snapshots, so no 304/delta logic is needed; the server's change detector is `data_version` + mtime + size. If an ETag is ever wanted, replace `generated_at` with a content hash first. |

Extra risks this card adds, not in the audit list: (i) a routine **gateway restart** currently
degrades clients permanently because every close is treated as fatal — fix the client's handling
of 1012 (§3.7); (ii) the deployed artifact lags the repo (container `plugin.yaml` **v1.1.0** vs
in-tree **1.3.0**), so any before/after measurement must rebuild and reinstall first.

---

## 6. Recommendation

**Adopt option A: a Starlette/FastAPI-native websocket on the plugin's own router, fed by a
per-board SQLite change watcher, consumed through the desktop SDK's existing `ctx.socket`.**

Concretely (this is what the tree now contains, at `064d7f0`):

| Piece | Choice |
|---|---|
| Server route | `@router.websocket("/events")` in `dashboard/plugin_ws.py`, attached from `dashboard/plugin_api.py` only when `KANBAN_GANTT_WS` is set; mounted by core at `/api/plugins/kanban-gantt/events` |
| Server runtime | the host's existing **CPython 3.13.5 + fastapi 0.133.1 + starlette 1.3.1 + uvicorn 0.41.0** — no new dependency, no new process, no new pin |
| Wire format | JSON frames, `{type:'snapshot'|'heartbeat', board, version, generated_at, tasks[], labels[]}` — the REST snapshot shape plus a header, applied to the **same react-query cache key** |
| Change detection | per-board `PRAGMA data_version` + `st_mtime_ns` + `st_size`, 0.25 s signature poll, 0.3 s coalescing, one `_read_gantt` per change per board |
| Client | `ctx.socket('/events?board=<slug>')` (`src/ws.ts` + `src/core/ws-core.ts`), full snapshot on connect/reconnect, version-gap ⇒ REST resync, first-frame/idle timeouts, one retry then polling |
| Auth | handshake-time `authorize()` delegating to core `hermes_cli.web_server_chat._ws_auth_ok`, loopback-only fallback for the standalone dev server |
| Fallback | the 60 s poll (demoted to 300 s only while live), kept forever for OAuth/custom-URL clients; SSE is the documented transport fallback if `ws://` is ever blocked |
| Rollout | flag `KANBAN_GANTT_WS`, default **off**; restart the gateway to flip |

**Hosting prerequisites** (all already true on this workstation, listed so a different host can
be checked in five minutes):

1. A gateway running as a **long-lived process** (`hermes dashboard`/`gateway`, uvicorn) — not a
   serverless handler (`web_server.py:1176-1233`).
2. `websockets`, `uvicorn[standard]`-class ASGI server and `fastapi`/`starlette` at the pinned
   versions — i.e. any standard Hermes install; nothing to add.
3. The plugin **installed and enabled** (`plugins.enabled`) so its router is mounted with
   `_plugin_route_secret_scope` (`web_server_dashboard.py:878-882`).
4. For remotes: the proxy must pass `Upgrade`/`Connection` and keep read timeouts above the ws
   ping (20 s locally-configured default; ~100 s tunnel idle), or the connection will be recycled.
5. Loopback or token-auth desktop connection for the socket to be used at all; gated/OAuth
   remotes stay on polling by design.
6. Repo conventions for the change itself: `npm test` + `bash tests/run_tests.sh` green, no
   hand-edited `desktop/plugin.js` (build it), every user-facing string in `src/i18n.ts` en+fr,
   conventional commit.

---

## 7. Rejected alternatives, with reasons

| Rejected | Reason (one line each) |
|---|---|
| **Socket.IO** (`python-socketio` + `socket.io-client`) | Its valuable parts (rooms, send buffers, ack'd delivery, Redis-adapter scaling) are either re-implementations of the host's own reconnect + cursor semantics or irrelevant to a single-process, single-writer-SQLite gateway — and its built-in long-poll fallback literally reintroduces the traffic this work removes. Zero trace of it in this codebase (`grep socket.io` across `pyproject.toml`, `uv.lock`, `package.json` → nothing). |
| **SSE as the primary** (`sse-starlette 3.4.8`) | One-way, would add a declared pin (today only transitive in `uv.lock`), and this stack serves HTTP/1.1 where browsers cap ~6 connections per host — a real ceiling with several boards/tabs open — while discarding a working, tested websocket path. **Kept as the transport fallback.** |
| **Managed realtime** (Ably/Pusher/Supabase Realtime) | Third credential system, per-message billing, and board data leaving the machine — against a plugin whose stated premise is "zero API keys, zero model tokens". |
| **Core's `/api/pub` ↔ `/api/events` channel bus** | No producer for the writes that matter: the CLI, the dispatcher and other containers write to `kanban.db` outside the gateway process, so an in-process broadcaster never fires (§2). |
| **Long-poll fallback** | Pure regression: same bytes as today's poll, worse framing, extra state. |
| **Status quo polling (as the answer)** | Rejected as the *target*, retained as the *floor*: bytes scale with open windows (N windows ⇒ N full snapshots per minute, ~0.61 MB/h per window on the demo board, 212 MB–6.4 GB over 30 days on the 1 000-task board per the earlier baseline), and it is the only path for clients that cannot use a socket. |
| **Delta frames** | Deferred, not rejected forever: with drop-and-coalesce delivery and no replay, a lost delta is unrecoverable — full snapshots make every frame self-healing. Revisit only with a delivery guarantee. |

---

## 8. Effort tiers

| Tier | Scope | Work items | Estimate |
|---|---|---|---|
| **T0 — done (prototype)** | One flow (the 60 s gantt snapshot) over a socket, flag-gated, polling kept as fallback | `dashboard/plugin_ws.py`, `attach()` wiring, `src/ws.ts` + `src/core/ws-core.ts`, `src/main.ts`/`state.ts`/`i18n.ts` wiring, `tests/ws_proof.py` (13/13), `tests/ws-core.test.mjs` | **already landed at `064d7f0`** |
| **T1 — minimal productionization** | Same single-process design, made safe to turn on for loopback/token desktops | (1) one **real upgrade attempt against the live gateway** (auth path + `?token=` log redaction); (2) client treats a server-initiated close (1012) as reconnectable; (3) single source for heartbeat/idle constants; (4) `KANBAN_GANTT_WS` documented in README; (5) rebuild + `hermes plugins install`, verify visually in the desktop | **2–3 days** |
| **T2 — hardened** | Makes it defensible as the default rather than a flag | (1) observability: live connections/frames/reads/rejects + a degraded badge (i18n en+fr); (2) SSE fallback for ws-hostile networks; (3) `all`-boards fan-in; (4) frame coalescing / cross-window sharing; (5) `task_events` cursor replay instead of first-frame-only resync; (6) watcher cost measured on a busy board, then tuned; (7) multi-worker/multi-gateway fan-out design (broker or DB cursor); (8) tests for the pinning trap, handshake-failure fallback and deploy drain | **5–8 days** |

Cost of *not* hardening: the feature is flag-gated and reversible, so the downside is bounded —
but a fleet of silently degraded clients is invisible today (§5 #12), which is exactly the
failure mode T2's first item removes.

---

## 9. What would falsify this recommendation

Each of these is a *testable* claim, and any one landing differently changes the answer:

1. **The gateway starts serving a board population from more than one process** (a second
   uvicorn worker, or a second gateway sharing boards). Then in-process per-board fan-out and
   per-process version counters are wrong, and the recommendation becomes "same `/events`
   contract, fed by a broker or `task_events` cursor replay" — the client does not change.
   Test: worker/process count of the gateway fleet (`ps`, `web_server.py` config).
2. **The real gateway refuses the plugin websocket upgrade** (router-level dependency, auth gate,
   or origin check) while the standalone app passes. Then option A is not viable as-is and the
   fallback becomes SSE (or a core change). Test: appendix A step 5 — today the highest-risk
   unverified assumption in this document.
3. **Push latency or cost misses the budget on a real board**: p95 > 2 s, frames ≥ 600 KB, or
   server CPU per push above the poll's ~0.3 ms/snapshot at 19 tasks. Then coalescing, delta
   frames or a different change detector become mandatory. Test: the proof's P3/P4 plus a
   measurement on the 239-task `sumaris` board.
4. **The watcher's own cost becomes the problem** (0.25 s × boards on a busy board root, or WAL
   read contention). Then the change detector moves to inotify/`file_control` or a write hook in
   `kanban_db` — transport unchanged. Test: measure signature-poll cost with a dispatcher running.
5. **The desktop SDK changes the ground rules** — gains `onOpen`/`onError`/ticket auth (then the
   OAuth population can use push and hard part 5 disappears), or loses/limits `ctx.socket`
   (then the recommendation reverts to SSE or pure polling).
6. **Board writes stop being local SQLite** (remote store/API, or a board served from another
   host). Then a file/mtime watcher cannot detect changes and a server-side emitter or the
   `task_events` cursor is required.
7. **react-query's background behaviour changes** (`refetchIntervalInBackground` or
   `refetchOnWindowFocus` flipped in the shared client, `apps/desktop/src/lib/query-client.ts:9-10`).
   The demote-to-300 s win is computed on "unfocused windows stop polling"; if they stop pausing,
   the byte argument changes.

---

## Appendix A — how to re-verify (all commands run by this card)

```bash
# 1. runtime + pins (host tree and live container must agree)
podman exec sumaris-agent_hermes_1 /opt/hermes/.venv/bin/python3 -c \
  "import fastapi,starlette,uvicorn,websockets;print(fastapi.__version__,starlette.__version__,uvicorn.__version__,websockets.__version__)"
# → 0.133.1 1.3.1 0.41.0 15.0.1        (CPython 3.13.5: add -c "import sys;print(sys.version)")
grep -nE '"(uvicorn|fastapi|starlette|websockets)' ~/.hermes/hermes-agent/pyproject.toml | head
grep -n 'sse-starlette' -A2 ~/.hermes/hermes-agent/uv.lock | head      # 3.4.8, transitive only
grep -rn 'socket.io\|socketio' ~/.hermes/hermes-agent/pyproject.toml ~/.hermes/hermes-agent/uv.lock   # → nothing

# 2. long-lived server, ping policy, drain semantics
sed -n '1176,1233p' ~/.hermes/hermes-agent/hermes_cli/web_server.py
grep -n 'ws_ping\|restart_drain_timeout' ~/.hermes/hermes-agent/hermes_cli/config_defaults.py
grep -n '1012' ~/.hermes/hermes-agent/venv/lib/python3*/site-packages/uvicorn/protocols/websockets/*.py

# 3. auth gate bypass + the plugin precedent + the mount
sed -n '160,175p'  ~/.hermes/hermes-agent/hermes_cli/web_server_chat.py
sed -n '40,60p;1765,1800p' ~/.hermes/hermes-agent/plugins/kanban/dashboard/plugin_api.py
sed -n '870,890p' ~/.hermes/hermes-agent/hermes_cli/web_server_dashboard.py

# 4. the client door
sed -n '89,147p' ~/.hermes/hermes-agent/apps/desktop/src/api/plugins.ts

# 5. end-to-end proof (env MUST be clean: HERMES_KANBAN_DB pins a board and makes the
#    watcher read the wrong DB — that is hard part 2)
cd ~/git/hermes-kanban-gantt
env -u HERMES_KANBAN_DB -u HERMES_KANBAN_BOARD -u HERMES_KANBAN_HOME \
  ~/.hermes/hermes-agent/venv/bin/python tests/ws_proof.py      # → RESULT: 13/13 checks passed
```

**NOT verified here, do not quote as measured:** the 1 000-task synthetic board and the 25-client
thundering-herd numbers (they live in `polling-baseline.md` §3, written *before* the prototype;
re-run `docs/spikes/harness/` before citing); the production `sumaris` board (239 tasks, in the
container's board root, not on this worker's root); a websocket upgrade through the **real**
gateway (§9.2); and any multi-process behaviour.

## Appendix B — provenance

Measurements in §3 were produced by *this* card (proof run at 18:14, wall clock on the
workstation) against `064d7f0`. Snapshot sizes move with the board: the audit measured
`gantt-demo` at 19 tasks / 10 173 B, this card at 16 tasks / 8 544 B, 0.23 ms p50, `all`
19 tasks / 9 556 B, 0.67 ms p50 — same order, same contract, live data. Two other cards on this
board were writing into the same working tree while this evaluation was written (`t_47c1cced`
produced `polling-inventory.md`; the prototype card landed `064d7f0`), so every claim above is
pinned to a revision and a timestamp rather than to "the tree".
