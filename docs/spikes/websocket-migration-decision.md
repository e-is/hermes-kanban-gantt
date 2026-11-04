# Decision — retire the gantt polling loop in favour of the websocket push

Card `t_88a9b93c` (board `gantt-demo`), 2026-11-04. Tree: plugin `1.9.0`, `main` @ `c14cbf5`,
spike branch `spike/ws-proto-t7927023e` @ `7c6bccf`.

**Verdict: GO — with a hardening gate.** Adopt the native WebSocket push as the supported
default for board snapshots and demote the 60 s poll to a permanent fallback. Do **not** call the
migration finished until Phase 1 (observability, heartbeat single-source, tests, README) ships.

This document is written to be readable without the spike code. Every number below was measured
on this host; sources are listed in §7. It supersedes nothing — the September and 2026-10-26
go/no-go notes (`websocket-recommendation.md`, `websocket-migration-recommendation.md`) reached the
same verdict from smaller measurements; this one adds the prototype numbers and the failure modes
the prototype actually hit. Read those for history, this one for the decision.

---

## 1. The problem, in the audit's numbers

The plugin already ships the push (`/events`, default-on since `1.3.2`, off-switch
`KANBAN_GANTT_WS=0`), but the polling loop is still the load-bearing path. The audit
(`polling-audit.md`, `dbd2bfa`) counted **nine pollers**; three matter:

| # | Poller | Cadence | Cost per tick |
|---|---|---|---|
| **P1** | Gantt snapshot `GET /gantt?board=` | **60 s** per open window; 300 s while the socket is `live` | 8 read-only SQL statements, one fresh `sqlite3.connect()`, full JSON body |
| **P2** | Board list `GET /boards` | **5 min** | re-walks the boards directory and parses every `board.json`, no cache |
| **P3** | Server-side change probe (`BoardStream._loop`) | **250 ms per watched board** | `PRAGMA data_version` + `stat()` on a long-lived connection |

Measured steady state on `gantt-demo` (**25 tasks, 16,420 B** at re-measurement; the note's
write-time figures were 24 tasks / 15,818 B, p50 0.29 ms — the board grows as the demo runs):

* 60 s polling costs **~22.8 MB/day per open page** (15,818 B × 1,440) and scales **linearly with
  open windows** — two desktops, two tabs, or desktop + browser each pay in full. There is no
  server-side dedupe or fan-in on the REST path.
* A change is visible **only up to 60 s later** (uniformly distributed, so ~30 s average); a board
  at 2,000 tasks costs ~440 KB and ~23 ms **per tick, per client**.
* The server pays 8 SQL statements per request, and `list_boards()` re-parses every board file on
  every `/boards` call. The P3 probe adds 240 probes/min per watched board on top.
* Failure behaviour is thin: react-query retries 3× (1/2/4 s) then keeps the interval firing; a hard
  failure replaces the board with `ErrorState`. **No server-side log or metric** records a `/gantt`
  request — the gateway log holds lifecycle lines only. There is no measured throttling or latency
  pain to report, and this document does not invent one: the pain is structural cost and staleness.

**Why now.** The push is already in the tree and default-on. "Migrating" therefore means *finishing
and owning* what shipped — promoting it from "default-on prototype" to "supported default" — not
starting a new project. The decision is not which library; it is whether the team commits to the
operating story (observability, tests, docs) that makes the push safe to rely on.

---

## 2. Recommendation

**Library:** native WebSocket — Starlette/FastAPI's own websocket route on the plugin's router
(`/api/plugins/kanban-gantt/events`), `websockets` 15.0.1 under uvicorn 0.41.0. **No new
dependency**; the stack is already what the gateway runs in production for `/api/ws`, `/api/pty`
and its audio streams.

**Architecture:** in-process hub per board — one long-lived read-only SQLite connection per watched
board polls a change signature (`PRAGMA data_version` + `stat`), performs **one** `_read_gantt` when
the signature moves, and fans the resulting snapshot out to every subscriber with a monotonic
per-board version. Clients consume it through the SDK's single push door (`ctx.socket`, receive-only,
JSON), keep the same React Query cache key and the same `/gantt` object shape, and fall back to the
60 s poll whenever the socket is not `live` (`all` scope, custom base URL, no socket door,
`KANBAN_GANTT_WS=0`, dead handshake). Rollback is a config flip, not a deploy.

**Evidence from the prototype** (measured against a sqlite copy of the live board; the prototype is
a standalone server + client, not the shipped route):

| Metric | Result |
|---|---|
| Handshake → first frame | **p50 2.15 ms** — identical to one poll request, so connect is not the cost |
| Write → frame delivered, shipped knobs (250 ms probe / 300 ms debounce) | **p50 506 ms / p95 549 ms** |
| Write → frame delivered, tuned knobs (50 ms / 100 ms) | **p50 111 ms / p95 160 ms** |
| Fan-out: one change → 20 subscribers | **20/20 delivered in 345 ms**, **1 server DB read** for the change |
| Idle cost, 20 subscribers | **1.0–1.67 % of one core**, ~513–517 KB RSS per connection |
| Storm: 1,967 writes coalesced | **19 frames**, 2.6 % CPU, ~110 writes/frame |
| Reconnect after forced close (`1012 service restart`) | **~401 ms**, snapshot resync, version continuity |
| Network blip / idle stall | 3 reconnects, p50 gap 57 ms, worst 398 ms; snapshots on every reconnect |
| Proxy idle kill (3 s, 1 s heartbeat) | **0 unwanted reconnects**, 7 heartbeats seen |
| Auth | absent or wrong credential → handshake **rejected** (403); valid → snapshot first frame |

Against the poll: freshness goes from 0–60 s to ~0.1–0.5 s, and server reads go from one per client
per tick to **one per change per board**, independent of subscriber count. That inversion — not the
latency — is the structural win. Bandwidth is *not* unconditionally better: a dead-idle board's 20 s
heartbeat is more traffic than a background-stopped poll, which is why the poll stays.

### Rejected alternatives

| Option | Why rejected |
|---|---|
| **socket.io** (`python-socketio` + `socket.io-client`) | Buys transport fallback and reconnect buffers the SDK door already provides (fallback = the poll, which must exist anyway; reconnect = the door's full-jitter backoff), and charges a second protocol stack inside a scope where the gateway's HTTP middleware and auth gate never run. Its polling-upgrade endpoints would each need gating. For a one-way JSON snapshot at ~2 msg/s, complexity with no measured benefit. |
| **SSE** (`text/event-stream`) | The strongest runner-up on design — ordered stream and real `Last-Event-ID` replay — but the desktop SDK exposes **no `EventSource` door** for plugins. It means new core/SDK surface plus a per-host feature-detection story, and the tunnel leg needs the same heartbeat plumbing. Revisit only if replay across a dropped connection becomes a hard requirement. |
| **Managed realtime** (Ably/Pusher/Supabase) | Wrong shape: a local desktop app over a local gateway, with the user's kanban data. Routing board contents through a third party to solve multi-process fan-out for a single-process deployment is a cost, privacy and availability regression for a problem we do not have. |
| **Status quo (polling only)** | 22.8 MB/day per open window, 8 SQL statements per tick, per-client cost that scales linearly, up to 60 s staleness. Kept as the fallback, not as the primary. |

---

## 3. Migration plan

### Phase 0 — already done at `dd3fb48` / `1.3.2`

Route shipped and default-on; `KANBAN_GANTT_WS=0` and the client `ws='0'` storage flag as
off-switches; poll kept unconditionally; `HERMES_KANBAN_DB` pinning trap closed.

### Phase 1 — hardening gate (~2–3 days, blocking "supported" status)

1. **Observability.** Counters for live connections per board, frames sent, DB reads, handshake
   rejects by reason, slow-consumer `4408` closes and resyncs. A user-visible **live / degraded**
   badge with `en` + `fr` keys. This is the item that makes it a migration rather than a tweak.
2. **One heartbeat source of truth.** Server announces its period (first frame or `?hb=`); client
   derives its idle window from it. Today `WsConfig.heartbeat_s` and the build-time
   `WS_HEARTBEAT_MS` must be kept in a 20 s ↔ 50 s ratio by hand.
3. **README.** `KANBAN_GANTT_WS` (default on, `=0` disables), the `KANBAN_GANTT_WS_*` knobs, the
   client `ws` storage flag.
4. **Tests.** End-to-end: failed handshake falls back to the poll (never a blank page), gateway
   restart picked up by a connected page, heartbeat constants cannot drift. Fold the hand-run
   `tests/ws_mount_gateway.py` and `tests/ws_proof.py` into `npm test`.
5. **Measure** the watcher cost on a board with a running dispatcher, and push on the 239-task
   `sumaris` board (frame size, p95).

### Phase 2 — canary on real boards (~1 week, after Phase 1)

Dual-run behind the flag on the busiest real board (the dispatcher-driven `sumaris` board), with the
poll demoted to 300 s and the badge visible. Exit criteria: p95 write→frame **< 2 s**, frame **<
600 KB**, writer throughput **≥ 90 % of baseline**, zero blank pages on socket failure. Run a
simulated gateway restart and a forced proxy idle-kill during the canary. Only then flip the flag
default for the wider install base (it is already default-on for loopback, so "flip" here means
removing the remaining caveats and advertising it as supported).

### Infrastructure changes

* **None required for the current single-process deployment.** In-process route, host CPython, no
  broker, no worker, no vendor, no second credential. That is the point of choosing native.
* **Multi-gateway (the one real infra gap).** The prototype's `multi_instance` run showed that two
  gateway processes on the same SQLite file each notify only their own subscribers — a change through
  instance A never reached B's clients, and each process read once per change. Per-process version
  counters also collide (both start at 1), so a client switching gateways sees a lower version and
  classifies it as a restart: benign for correctness (it gets a full snapshot) but noisy. If a second
  gateway ever serves the same boards, add a DB-backed version/cursor (`task_events` style) or a
  Redis backplane. Not needed today; do not build it early.
* **Proxy/TLS.** No reverse proxy in the compose stack; 9119 is published directly. Non-loopback
  deployments sit behind a Cloudflare Tunnel (~100 s idle) and uvicorn's ping is already 20 s/20 s
  there. An intermediate proxy stricter than 20 s, or one that buffers frames, would show up only as
  reconnect churn — untested and not reproducible on this host. Heartbeat must stay on for any
  non-loopback bind.

### Observability to add (beyond Phase 1's counters)

Per-board gauges (subscribers, last frame age, last change detected), counters (handshakes
accepted/rejected by reason, frames sent/coalesced/dropped, DB reads, `4408` closes, resyncs), and a
log line per stream lifecycle event (start/stop/error) at INFO. Keep the persisted `wsState`/`wsOff`
client values and add to them rather than replacing them. Note the structural regression: a poll is
an HTTP request visible to every access log and proxy metric; a socket is one long connection, so
"did push break?" is answered by these counters or by a user complaint.

### Rollback plan

* **Instant, config-only:** set `KANBAN_GANTT_WS=0` (server) and/or client storage `ws='0'`. The 60 s
  poll is unconditional and never removed, so rollback needs no deploy and no data migration.
* **Per-board:** the off-switch is global today; Phase 1's badge makes a per-board kill switch cheap
  if a single board misbehaves. Not required for the first cutover.
* **Data safety:** the socket only ever delivers full snapshots read from the same `_read_gantt` the
  poll uses. Rollback cannot lose a write and cannot leave the cache in a shape the poll cannot read
  (same cache key, same object shape).

---

## 4. Risks and open questions

**Risks**

1. **Observability is absent** (highest). A broken push still answers the poll underneath, so the
   symptom is "slow", not "down". Until Phase 1 lands, failures are invisible.
2. **Single process only.** Per-process versions and an in-process hub are wrong the moment a second
   gateway serves the same boards; no replay across a gap. Acceptable today, documented as the
   scaling limit.
3. **No proxy in the path.** Tunnel idle timeouts and frame buffering are untested here; they surface
   as reconnect churn only.
4. **Everything is loopback.** No real-network latency, no sleeping-laptop churn, no half-open socket
   detection (needs packet black-holing).
5. **Backpressure unexercised.** The drop-and-coalesce-then-`4408` policy has never met a client that
   stops reading. The prototype's client `close()` wedged reconnects against a stalled proxy, so the
   client-side close path needs a bounded timeout before canary.
6. **`_read_gantt` cost is unresolved.** 0.29–0.57 ms in-process today vs 11.5 ms p50 in the earlier
   survey where 11.3 ms was `sqlite3.connect()` alone. Re-measure before tuning the probe interval;
   the 37.6 frames/s ceiling rests on this figure.
7. **Field latency is unobservable as shipped.** `generated_at` is integer seconds, so server and
   transport halves cannot be split from a frame. Add ms precision in Phase 1 if latency SLOs matter.
8. **Background tabs.** A backgrounded Electron renderer throttles timers; the client idle timeout is
   the only real defence against a half-open socket. Not tested on a real device.

**Open questions**

* Does the multi-gateway case matter within the next two quarters? If yes, the DB-backed cursor moves
  from "later" to Phase 2 scope.
* Is replay across a dropped connection ever a requirement? If yes, SSE returns as the candidate (or
  a `task_events` cursor on native WS).
* Who owns the "degraded" badge copy and the alert threshold for reconnect churn? Phase 1 needs both.
* Do we keep `generated_at` at second precision? It caps field-latency observability.

**Estimated effort** (follow-up tickets; estimates assume the person knows the tree)

| Ticket | Scope | Estimate |
|---|---|---|
| T1 | Observability counters + per-board gauges + stream lifecycle logs | 1–1.5 d |
| T2 | Live/degraded badge with `en`/`fr` i18n keys | 0.5–1 d |
| T3 | Heartbeat single source of truth (server announces period) | 0.5 d |
| T4 | README + knob documentation | 0.25 d |
| T5 | Three end-to-end tests (fallback, restart, constant drift); fold hand-run scripts into `npm test` | 1–1.5 d |
| T6 | Bounded client `close()` timeout (prototype wedge) | 0.5 d |
| T7 | Canary measurement on `sumaris` (239 tasks, dispatcher running) | 1 d |
| T8 | *(conditional)* DB-backed version cursor / multi-gateway backplane | 2–3 d |

**Total to "supported" status: ~4.75–6.25 person-days**, plus T8 only if multi-gateway is in scope.

---

## 5. Go / no-go

**GO.** The transport question is closed: native WebSocket on the plugin's own router is the only
option that adds no dependency, no process, no vendor and no auth model, and the prototype shows it
delivers ~0.1–0.5 s freshness against 0–60 s, with one DB read per change fanned to 20 subscribers
at ~1 % idle CPU. The cost model inverts at zero infrastructure cost.

The condition is honest: **the operating story is not ready.** Ship Phase 1 before advertising the
push as supported. Until observability exists, a broken push looks like a slow board, and no one can
tell the difference without a user complaint. That is the only reason this is a gate rather than an
unconditional yes.

**Triggers that would flip the decision to no-go:** a second gateway process on the same boards
before the DB cursor exists; the desktop SDK dropping `ctx.socket`; boards ceasing to be local
SQLite; or Phase 2 missing its exit criteria (p95 < 2 s, frame < 600 KB, ≥ 90 % writer throughput).

---

## 6. What this decision does *not* change

Everything on screen outside the board snapshot keeps its own fetch: the task drawer
(`GET /tasks/<id>`), the board list, project/profile pickers, attachments, worker logs. "Live" is
narrower than the UI, and users should learn to trust the bars, not the drawer. The 12-item
must-preserve list in `polling-audit.md` §7 stands as the regression contract for the push.

---

## 7. Sources and how to re-check

| Claim | Source |
|---|---|
| Poller inventory, 8-SQL cost, volume, retry path, 12 must-preserve items | `polling-audit.md` (`dbd2bfa`), re-measured today (25 tasks / 16,420 B / p50 0.57 ms) |
| Transport comparison and rejects | `websocket-options.md` §2–§5 |
| Prototype measurements, failure modes | `ws-proto/RESULTS.md`, `results/ws-proto.json` (`7c6bccf`) |
| Shipped route and protocol (R1–R20) | `websocket-protocol-design.md`, `dashboard/plugin_ws.py`, `src/core/ws-core.ts` |
| Transport comparison against this stack (fastapi 0.133.1 / starlette 1.3.1 / uvicorn 0.41.0) | `t_c8d00627` note |
| Hardening backlog and "later, only if needed" | `../TODO.md`, "WebSocket push" |

Re-measure commands (the poll's real price is the fresh sqlite connection per call):

```sh
cd dashboard && ~/.hermes/hermes-agent/venv/bin/python - <<'PY'
import sys, time, json, statistics; sys.path.insert(0,'.')
import plugin_api as p
p._read_gantt("gantt-demo")
ts=[(lambda a: (p._read_gantt("gantt-demo"), (time.perf_counter()-a)*1000)[1])(time.perf_counter()) for _ in range(60)]
ts.sort(); print("read p50 %.2f ms p95 %.2f ms" % (statistics.median(ts), ts[int(.95*len(ts))]))
d=p._read_gantt("gantt-demo"); print("tasks", len(d["tasks"]), "bytes", len(json.dumps(d,separators=(',',':')).encode()))
PY
```
