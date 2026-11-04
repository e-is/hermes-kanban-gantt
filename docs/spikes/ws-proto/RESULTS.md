# WebSocket prototype — measured results vs the polling baseline

**THROWAWAY SPIKE**, branch `spike/ws-proto-t7927023e`, card `t_7927023e` (board `gantt-demo`),
2026-11-04. Not merged, never to be merged: production code is untouched (the whole diff is
`docs/spikes/ws-proto/` + this results file + the JSON it produced).

What was built: `docs/spikes/ws-proto/server.py` (native Starlette websocket `/events` next to the
plugin's real `GET /gantt`, both driven by `dashboard/plugin_api.py::_read_gantt`), `client.py`
(SDK-door-shaped consumer: token on handshake, first-frame timeout, idle timeout, full-jitter
reconnect, no `onOpen`), `bench.py` (the harness that produced every number below). Each section
runs against a **fresh sqlite-backup copy of the live board** (`gantt-demo`, 25 tasks,
16,823 B) served by the real reader; writes are out-of-process sqlite commits, i.e. the
dispatcher/CLI/agent case that moves `PRAGMA data_version`.

Raw data: `docs/spikes/results/ws-proto.json` (produced by `bench.py`, all 10 sections in one run).

Host: `fixe13.e-is`, 24 cores, Python 3.11.16, fastapi 0.133.1 / starlette 1.3.1 /
uvicorn 0.41.0 / websockets 15.0.1 — the same versions as the gateway venv.

---

## 1. Headline: side by side

| Metric | Polling (`GET /gantt` @60 s) | WebSocket prototype (default 250/300 ms) | WebSocket tuned (50/100 ms) |
|---|---|---|---|
| Time to see a change, **p50** | ~30 s (uniform over the 60 s interval) | **505.7 ms** | **110.7 ms** |
| Time to see a change, **p95 / worst** | 60 s | 549.2 ms | 160.4 ms |
| Connection setup → first data, p50 | 2.15 ms per request (new connection each tick) | **2.15 ms** handshake→first snapshot | 2.15 ms |
| Server DB reads per change, per **board** | 1 per client per tick (1,440/day/window) | **1 per change** (shared by all subscribers) | 1 per change |
| Server DB reads per change, per **client** | 1 | **0** | 0 |
| Bytes/day per open window | **24.2 MB** (16,823 B × 1,440) | 0 idle; ~17.2 KB per change | ~17.6 KB per change |
| Frames/s per subscriber (idle board) | 0.017 requests/s | 1.9 (only under a 200 writes/s storm); heartbeats 1/20 s | 3–4 |
| Total messages/s at 20 subscribers | 0.33 requests/s (20 pages) | **40 msg/s** under a change storm (~0.7 MB/s egress) | — |
| Server CPU, 20 idle subscribers | n/a (no connection) | **1.67 %** of one core (4 Hz probe shared per board) | — |
| Server CPU, 20 pages hammering | **2.33 cores** (336.8 req/s ceiling, 11.65 CPU-s / 5 s) | — | — |
| RSS per subscriber | n/a (stateless request) | **~517 KB/connection** | — |
| Recovery after forced disconnect | next tick, up to 60 s | **358 ms** (reconnect + full resync) | — |

The two rows that matter are *reads per change* and *latency*: the push is ~60–500× fresher and
turns per-client DB work into per-board work. Bytes are **not** unconditionally better — see §5.

---

## 2. Connection setup and delivery

**Handshake → first frame** (`setup`, 20 fresh connections, token off):

| n | p50 | p95 | max |
|---|---|---|---|
| 20 | 2.15 ms | 11.66 ms | 11.66 ms |

Identical to one polling request (`GET /gantt` p50 2.15 ms, p95 3.31 ms, n=30). The push costs
*nothing* on connection setup because the first frame **is** the snapshot: one read, one send.

**Write → frame on the wire** (20 writes 300 ms apart, measured at the client):

| Config | p50 | p95 | min | floor (poll+debounce) |
|---|---|---|---|---|
| 250 ms poll / 300 ms debounce (shipped defaults) | **505.7 ms** | 549.2 ms | 497.6 ms | 550 ms |
| 50 ms poll / 100 ms debounce | **110.7 ms** | 160.4 ms | 103.4 ms | 150 ms |

The whole latency budget is the *detection+debounce* window, not the transport: the read+serialise+
send after the signature moves is under 2 ms (first frame = 17,222 B at 26 tasks). Nothing measured
here argues for tuning the shipped 250/300 ms defaults — 505 ms is already 60–120× better than the
poll, and halving the debounce is the only way to go faster.

`frame_generated_at_age_ms` is reported in the JSON but is **not** a latency metric: `generated_at`
is `int(time.time())`, so it is quantised to 1 s (p50 534 ms / p95 995 ms is that quantisation, not
jitter). Keep using the write-timestamp correlation.

---

## 3. Throughput, coalescing, fan-out

**Write storm** (`throughput`: 4 out-of-process writers, 50 writes/s each, 10 s, capped at 2,000):

| writes | writes/s | frames | frames/s | writes per frame | server DB reads | server CPU |
|---|---|---|---|---|---|---|
| 1,967 | 196.5 | 19 | 1.9 | **103.4** | **19** | 0.26 s / 10 s (2.6 % of a core) |

Coalescing works exactly as designed: ~100 writes collapse into one snapshot frame, and the server
does **one read per frame, not per write** (19 reads for 1,967 writes). A real dispatcher produces a
handful of changes per minute, so this is already 100× beyond steady state.

**Fan-out** (`fanout`, 20 subscribers on one board, one write):

| subscribers | delivered | one write → all clients p50 | DB reads for that change | RSS delta/conn | idle CPU (20 subs) |
|---|---|---|---|---|---|
| 20 | 20/20 | **329.1 ms** | **1** (+20 initial-connect reads) | ~517 KB | 1.67 % of one core |

- Fan-out is genuinely one read → 20 frames. The 21st read in the JSON is the 20 per-connection
  initial snapshots, which is the honest cost of a **connection storm**: each reconnect is one full
  `_read_gantt`. Twenty windows reconnecting together = twenty reads, ~340 KB egress.
- 20 idle subscribers cost 1.67 % of a core — that is the 4 Hz `data_version` probe running **once
  per board**, not per connection. This is the constraint from the audit (§7 item 11) holding up.
- ~517 KB/connection is Python + uvicorn + websockets buffer overhead, not our 17 KB frame. At
  100 windows that is ~50 MB, which is acceptable but should be stated rather than assumed.

Messages/s: 1.9 msg/s per subscriber under the storm, so **40 msg/s aggregate at 20 subscribers**
(~0.7 MB/s of egress). At rest it is one 200-byte heartbeat per subscriber every 20 s.

---

## 4. Forced disconnect and network blips

**Server-forced close** (`kick`: server closes every subscriber with code 1012, the gateway-restart
case): client reconnected after **358 ms**, got a full snapshot as first frame, resynced to version 2.
One retry, no stale data, no error surfaced to the UI.

**Abrupt RST mid-stream** (`blip/cut`: a TCP relay resets the connection every 2 s, 9 s window):

| connects | reconnect gap p50 | p95 | snapshots | version sequence |
|---|---|---|---|---|
| 4 | 935 ms | 1,394 ms | 4 | 2,2,3,3,4,4 |

Every drop recovers with a fresh snapshot; no gap is ever silently applied. The gap is the
full-jitter backoff (0.5–2 s in this run), not the server.

**Silent stall** (`blip/stall`: proxy stops forwarding but keeps sockets open): only detectable by the
client idle timer. With the timer scaled to 3 s the client resynced after **178 ms** past the
timeout — and that test found a real client bug worth carrying into the desktop client: on a stalled
peer the websocket `close()` handshake never completes, so `await ws.close()` **wedges the reconnect
loop forever**. The fix is to bound the close (`wait_for(..., 2 s)`) and `transport.abort()` on
timeout. A client that only relies on TCP FIN will spin a dead socket indefinitely.

---

## 5. The three failure modes from the audit's constraints

### Auth (audit §7.8)

| Case | Result |
|---|---|
| No token | handshake **rejected, HTTP 403**, no `accept()` |
| Wrong token | handshake **rejected, HTTP 403** |
| Correct token | accepted, first frame = full snapshot (25 tasks) |
| Live gateway, same route over HTTP | `401` (gateway middleware) |

Auth happens **inside the handler** and fails closed before `accept()`, so no frame is ever produced
for an unauthenticated peer. The prototype's credential is a query-string token — acceptable for a
spike, **not** for production: query strings land in proxy logs. The shipped plugin already has the
right model (native ticket grant / single-use `?ticket=` / session token via `_ws_auth_ok`); the
prototype must not be read as endorsing `?token=`. The standalone dev server, as the audit says, has
no auth at all — the websocket route inherits that and must never be given a wider bind.

### Multi-instance (audit §7.11, §7.4)

Two real server processes, one shared database, one client each, one write:

| Instance | delivered | latency | DB reads |
|---|---|---|---|
| A | yes | 552.7 ms | 2 (1 connect + 1 change) |
| B | yes | 552.3 ms | 2 (1 connect + 1 change) |

**Surprise: correctness survives.** Because change detection is a DB signature, not an in-memory
broadcast, both processes notice the write and serve it. What does *not* survive is cost and
ordering: N gateways = N reads per change (no shared fan-out), and each process keeps its **own**
version counter — here both emitted version 2 for the same change, so a client that hops between
gateways sees an equal version and silently applies a different stream as if it were the same one.
The "lower version = new stream" rule cannot detect a switch when the counters agree. Horizontal
scaling therefore needs a shared counter/backplane (Redis, or a DB-backed cursor) or an explicit
single-instance assumption — the audit's item 11 is a real ceiling, not a theoretical one.

### Proxy / tunnel (audit §7.10, §3 risk list)

A relay that kills connections idle for 3 s, with a 1 s data heartbeat:

| server heartbeat | proxy idle kill | connects in 8.5 s | reconnects | heartbeats seen |
|---|---|---|---|---|
| 1 s | 3 s | **1** | 0 | 7 |

The heartbeat does its job: the socket survives an idle-kill proxy as long as **heartbeat interval <
proxy idle timeout**. This is the whole argument for keeping the data-frame heartbeat on loopback
(where core disables uvicorn's protocol ping). The risk inverts with the shipped 20 s heartbeat: a
proxy stricter than 20 s (a Cloudflare Tunnel is ~100 s, so OK today) would churn — and churn is
invisible in the UI, because the 60 s poll keeps painting.

Background/minimized-window behaviour is **not** measured here (no Electron device in this run); the
audit's claim that a stopped poll beats an idle socket only holds if the renderer's timers are
throttled, so the client idle timeout is the only defence. Left as a follow-up.

---

## 6. Blockers found (what must be fixed before this is shippable)

1. **Multi-instance version collision** — per-process version counters can agree across gateways, so
   a client cannot tell it switched streams. Needs a shared counter/backplane or a hard
   single-instance statement. *(blocking for any multi-gateway deployment, not for today's one)*
2. **Connection-storm cost** — every subscribe/reconnect = one full `_read_gantt` + one 17 KB frame.
   20 simultaneous reconnects = 20 reads; at 2,000 tasks (~440 KB) that is ~9 MB of egress in one
   burst. The shipped drop-and-coalesce policy does nothing about connect cost.
3. **Observability** — a socket carries no request log; my prototype needed `/_stats` to say how many
   frames/reads/coalesces happened. The plugin still ships none of these counters. *(tracked in the
   audit as the "Observability" TODO; this run confirms it is load-bearing, not cosmetic)*.
4. **Client close-on-stalled-peer** — measured wedge in the reconnect loop (§4). Any client that
   awaits `close()` unbounded will stop reconnecting on a silently dropped proxy path.
5. **Heartbeat vs proxy idle timeout is a tuning contract nobody enforces** — 20 s default is safe
   against the ~100 s tunnel, unsafe against anything under 20 s, and the failure mode is reconnect
   churn with no UI signal.
6. **`all`/`*` scope is still polled** — unchanged by this prototype; a user on the fan-in view keeps
   the 60 s cadence and 24 MB/day.

Non-blocking, but recorded: query-string credentials (§5 auth); ~517 KB RSS/connection; frame size
grows linearly with task count (17.2 KB at 26 tasks, ~440 KB at 2,000 tasks per the earlier harness).

---

## 7. What this run did *not* prove

- Not the shipped route. `dashboard/plugin_ws.py`'s `/events` is disabled in the prototype server
  (`KANBAN_GANTT_WS=0`) so the measurement is of *this* minimal implementation; the shipped route
  was measured separately in `docs/spikes/websocket-poc.md` (p50 ~499 ms at shipped defaults).
- Not real Electron/`ctx.socket` behaviour: reconnect, `onOpen` absence and OAuth-remote no-op are
  mimicked, not exercised. First-frame timeout of 5 s is enormously generous against a measured
  p95 of 11.7 ms, but the no-op door is untested here.
- Not a multi-user or multi-gateway environment (single process, local loopback, one DB).
- Not the real gateway auth path: the live gateway returns 401 to an unauthenticated REST call, and
  a real desktop session's ticket was not available to this worker.

---

## 8. Reproduce

```bash
cd ~/git/hermes-kanban-gantt            # branch spike/ws-proto-t7927023e
PYTHONPATH=$HOME/.hermes/hermes-agent \
  ~/.hermes/hermes-agent/venv/bin/python docs/spikes/ws-proto/bench.py
# one section at a time: --only baseline|setup|latency|throughput|fanout|kick|blip|auth|multi_instance|proxy_idle
# print only: --no-save     results: docs/spikes/results/ws-proto.json
```

The harness copies `~/.hermes/kanban/boards/gantt-demo/kanban.db` via sqlite online backup, so the
live board is never written to. Delete `docs/spikes/ws-proto/` and the branch and nothing else moves.
