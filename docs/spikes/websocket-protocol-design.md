# WebSocket push — kanban-gantt

The Gantt page is kept current by a **server push** on the plugin's own websocket route, with
the REST poll as a permanent safety net. This doc is the reference for that mechanism: the
decision and its numbers, the wire contract, the connection lifecycle, and how to operate it.
Open work lives in [`docs/TODO.md`](../TODO.md).

Code: `dashboard/plugin_ws.py` (server), `src/ws.ts` + `src/core/ws-core.ts` (client),
the gantt `useQuery` and its `subscribeGantt` effect in `src/main.ts` (wiring). Requirements
R1–R20, cited by the code comments, are in the [appendix](#appendix--requirements-r1r20);
proofs P1–P11 are the checks of `tests/ws_proof.py`.

## 1. Decision and measured numbers

**Shipped, ON by default.** `GET /gantt` used to be polled every 60 s per open window. It is now
pushed from `/api/plugins/kanban-gantt/events`, a Starlette-native route on the plugin router:
no new dependency, no new process. A per-board SQLite change watcher feeds it, and the desktop
SDK's `ctx.socket` consumes it. The poll stays as the fallback: 60 s, demoted to 300 s while the
socket is live.

| | Polling (60 s) | WebSocket push |
|---|---|---|
| Write → screen | 0–60 s (mean ≈ 30 s) | **≈ 0.55 s** through the real gateway (250 ms watch + 300 ms debounce); p50 393 ms / p95 429 ms in the standalone proof |
| `GET /gantt` requests | 1 440/day/window | 0 while live (P7) |
| Bytes | one full snapshot per window per minute (≈ 0.6 MB/h on the demo board; ≈ 16 MB/h for a 272 KB board) | one full snapshot per change, per board |
| DB reads | one per request per window | one per change per board, however many windows (P5) |
| Largest frame measured | — | 10.5 KB (22-task board); budget 600 KB (R3) |

The gateway run also verified the production mount: `include_router` plus the plugin route
secret scope, and the core auth gate refusing a no-credential upgrade (`core_reject`). No token
appeared in any gateway log. `tests/ws_mount_gateway.py` pins the one real bug that run found: core
imports the plugin's `api` file without putting its directory on `sys.path`, so `plugin_ws` is
loaded as a sibling by path.

**What would change the decision:** a second gateway process serving the same boards (§6.2), a
watcher cost on a dispatcher-busy board above the poll's own ≈ 0.3 ms per read (unmeasured),
frames ≥ 600 KB or p95 > 2 s on a large board (the 239-task `sumaris` board is unmeasured over
the socket), or board writes ceasing to be local SQLite.

## 2. The stack, and what each side can do

| Layer | Fact |
|---|---|
| Server | Python 3.13, FastAPI 0.133.1 / Starlette 1.3.1 / uvicorn 0.41.0 / websockets 15.0.1, all pinned by the host; one long-lived `uvicorn.Server` per gateway |
| Client door | `ctx.socket(path, onMessage) → dispose` (`pluginSocket` in the host's `apps/desktop/src/api/plugins.ts`). **Receive-only:** no `send`, no `onOpen` / `onError`. It reconnects on its own (full-jitter backoff, base 500 ms, cap 30 s, unbounded) and keeps calling the same `onMessage` |
| Client credential | the desktop connection token appended as `?token=`; `authMode === 'oauth'` returns **before** connecting |

Consequence: the protocol is **server → client only**, and a dead socket is detected by
**silence**. Anything the client needs to choose (the board) rides the handshake URL.

**Why this design over the others considered:**
- `python-socketio`: new dependency, and its long-poll fallback reintroduces the traffic.
- SSE: one-way, and the renderer is capped at about 6 HTTP/1.1 connections per host. It remains
  the transport fallback if `ws://` is ever blocked.
- Managed realtime (Ably, Pusher…): a third credential system, data leaving the machine; it breaks
  the plugin's "zero API keys" premise.
- A message bus (Redis, NATS, Postgres `LISTEN`): only worth it once instances stop sharing the
  board directory (§6.2).

## 3. Wire protocol

### 3.1 Handshake and authentication

```
ws(s)://<backend>/api/plugins/kanban-gantt/events?board=<slug>&token=<connection-token>
```

| Aspect | Behaviour (`plugin_ws.stream_events`, `authorize`) |
|---|---|
| Board | `?board=<slug>`, validated by `plugin_api._board_db_path`, the same rule as the REST read: no `/`, `.`, `..`. The resolved file must be the board's own `<root>/<slug>/kanban.db`, so a gateway that inherited `HERMES_KANBAN_DB` refuses the request instead of serving another board's rows. A missing `?board=` resolves through `_resolve_board(None)`. Invalid ⇒ close **1008** before `accept()` |
| Auth, rule 1 | `KANBAN_GANTT_WS_TOKEN` set ⇒ constant-time compare against `?token=` or `Authorization: Bearer`. For the standalone dev server only; never set it in production |
| Auth, rule 2 | otherwise core `web_server_chat._ws_auth_ok` decides: loopback `?token=`; gated remotes `?ticket=` / `?internal=` |
| Auth, rule 3 | core not importable (bare standalone server) ⇒ loopback clients only |
| Middleware | none: Starlette HTTP middleware does not run for the `websocket` scope, hence the in-handler gate |
| Rejection | close **1008**; the log records the reason (`env_token_mismatch`, `core_reject`, `no_gate`), never the credential |

The SDK always sends `?token=`, so OAuth and gated remotes cannot use the push even though core
would accept a ticket; they stay on the poll.

### 3.2 Frames

One JSON object per text frame, with a mandatory `type` discriminator. Unknown types are ignored,
and a frame that fails `JSON.parse` is dropped by the SDK. The protocol evolves **additively
only**. Every data frame is a **full snapshot**; there are no deltas.

```jsonc
{ "type": "snapshot",            // the GET /gantt body + a header
  "board": "gantt-demo",         // resolved slug
  "version": 42,                 // monotonic per board, per process (§3.4)
  "generated_at": 1790700735,
  "tasks": [ /* _read_gantt rows, incl. runs[], parents[], children[] */ ],
  "labels": [ { "label": "PROJET #123", "count": 4 } ] }

{ "type": "heartbeat", "board": "gantt-demo", "version": 42, "at": 1790700755 }
```

The client turns a snapshot back into the exact `GET /gantt` shape (`frameToQueryData`, R1) and
writes it into the same react-query key the poll fills, so nothing downstream changes.

Reserved names, not implemented: `resync`, `error` (server → client); `ping`, `subscribe`, `resume`
(client → server, unusable while the door has no `send`). A future frame type should come with a
handshake version marker (`?v=2`).

### 3.3 Subscription model

**One socket per board.** Opening is subscribing; the client's `dispose()` unsubscribes; a board
switch is dispose plus a new subscription. Server-side, all subscribers of a board share one
`BoardStream`, held in a module-global `Hub`: **one DB read per change, fanned out** (R11).

The fan-in view (`board=all`) is **not pushed**. It has no single database to watch: the REST read
opens every board in turn, and the server refuses the handshake. It stays on the poll. Frames are
not shared between windows: N windows on a board mean N sockets and N sends, but still one read.

### 3.4 Versions, resync and delivery

- The **first frame** after every (re)connect is a full snapshot. The change signature is captured
  *before* that read, so a write landing in between is seen on the next tick (R8).
- The client applies **strictly newer** versions; a repeated version is ignored; a jump of more
  than one is a **gap**, and the query is re-validated over REST behind the applied snapshot (R7).
- **At-most-once, drop-and-coalesce:** one pending frame per subscriber. A client whose buffer is
  still full after 3 consecutive overruns is closed with **4408** rather than queued (R5). A lost
  frame costs latency, never correctness, because the next frame is the whole truth.
- **Grace window:** a board stream, and its version counter, lives on for 60 s after its last
  subscriber leaves, so a quick reconnect continues above what the client already rendered.
- The counter lives **in the process**. A gateway restart, or a stream dropped after its grace
  window, starts again at 1, which is lower than what a connected client last applied. The SDK
  reconnects underneath the same `onMessage`, so the client must treat a lower version as a new
  stream. See `docs/TODO.md` for where this stands.
- **Writes stay on REST** (R12). The socket is a read/notification channel; after a mutation the
  page still re-reads via `invalidateQueries`.

### 3.5 Liveness

| Layer | Mechanism |
|---|---|
| Transport | uvicorn ping: **off on loopback** (a dead local peer sends FIN/RST); 20 s / 20 s otherwise (`dashboard.ws_ping_interval` / `_timeout`); 60 s / 600 s on the desktop's SSH-isolated backend |
| Server | a **data-level heartbeat every 20 s** while nothing changes (`WsConfig.heartbeat_s`); a dead peer is noticed through a 250 ms `receive()` timeout |
| Client | no first frame within **5 s**, or silence for **50 s** (2.5 × heartbeat) ⇒ dead (R19) |

The 20 s ↔ 50 s ratio is load-bearing, and the two values are separate constants
(`WsConfig.heartbeat_s` server-side, `WS_HEARTBEAT_MS` client-side). If they drift, a healthy
board is declared dead and falls back to the poll.

### 3.6 Reconnect policy

Two layers. The **SDK** reconnects on every close, with backoff, forever, invisibly to the
plugin. The **plugin** (`subscribeGantt`) covers the case the SDK cannot see (silence): one retry
with full-jitter backoff (base 500 ms, cap 10 s), then `dead`, then a **re-arm every 5 min**, so
the push comes back on its own after an outage (R18).

Close codes, as the server uses them: **1008** auth or board refused; **4408** slow consumer;
**1012** uvicorn draining on shutdown. The plugin never sees a close code (the door hides them):
it reacts to silence only.

## 4. Connection lifecycle

```
client (renderer)                    gateway (one uvicorn worker)                        sqlite
 1 subscribeGantt(board) ──────────▶ upgrade /api/plugins/kanban-gantt/events?board=X&token=…
 2                                   authorize(): env token → core _ws_auth_ok → loopback-only
                                       reject ⇒ close 1008, never accept
 3                                   _board_db_path(slug): traversal / foreign path ⇒ 1008
 4                                   accept(); HUB.get(slug) → BoardStream (create or reuse)
 5                                   capture SIGNATURE before the read ──────────────▶ data_version+mtime+size
 6 ◀── {type:snapshot, v, …tasks} ── _read_gantt(slug) ─────────────────────────────▶ one ro read
 7                                   stream.attach(sub) ⇒ watcher loop running
 8 ◀── {type:heartbeat} ──────────── every 20 s while nothing changes
 9  apply → setQueryData(same key); gap ⇒ invalidateQueries (REST)
10  poll demoted 60 s → 300 s while live; local 30 s "now" tick (R6)
11 (outside write: dispatcher, CLI, another agent) ──────────────────────────────────▶ commit
12                                   _loop: signature changed ⇒ wait 300 ms (coalesce)
                                       ⇒ ONE _read_gantt ⇒ version+1 ⇒ fan out to N subscribers
13 ◀── {type:snapshot, v+1} ───────── overrun ⇒ drop the pending frame; 3 in a row ⇒ 4408
14 silence 50 s, or no first frame in 5 s ⇒ dead ⇒ one retry ⇒ re-arm every 5 min
15 dispose() on unmount / board switch ⇒ close ⇒ receive() ends ⇒ detach
16                                   last subscriber gone ⇒ 60 s grace ⇒ HUB.drop
```

In the code: 2 `authorize` · 3–7 `stream_events` · 8, 12 `BoardStream._loop` · 13 `Subscriber.offer`
· 9, 14 `src/ws.ts` `subscribeGantt` · 10 the gantt `useQuery` and the `nowTick` effect in
`src/main.ts` · 16 `BoardStream._schedule_drop`.

## 5. What the socket does not replace

- **The REST poll stays forever.** It is the only path for OAuth remotes, custom backend base
  URLs, `board=all`, a host without the door, and every failure.
- The page shows **Refresh** only while it knows it is on the 60 s poll: push `off` (gateway
  `KANBAN_GANTT_WS=0`, client storage `ws = '0'`, `all`, custom base) or `dead`. The storage keys
  `wsState` / `wsOff` record the state and its cause, since `console.debug` is not captured in a
  packaged build.
- **The drawer and the boards list** (`GET /tasks/{id}`, `GET /boards`) are not pushed: one
  socket, one contract.

## 6. Operations

### 6.1 Switches and rollout

| Switch | Effect |
|---|---|
| `KANBAN_GANTT_WS=0` (gateway env) | `/events` is never registered (404); clients fall back after 5 s. Default: **on** |
| storage `ws = '0'` (per client) | the client never opens the socket |
| `KANBAN_GANTT_WS_POLL_MS`, `_DEBOUNCE_MS`, `_HEARTBEAT_S`, `_MAX_OVERRUNS`, `_GRACE_S` | watcher cadence (250 ms), coalescing (300 ms), heartbeat (20 s — keep the client's 50 s idle window in step), overruns (3), grace (60 s) |

A deploy restarts the gateway: uvicorn closes live sockets with 1012 and clients reconnect
through the SDK. Rollback is `KANBAN_GANTT_WS=0` and a restart; REST is untouched (P11).

### 6.2 Process model and scaling

One `hermes dashboard` process, no `--workers`. In-process fan-out is therefore correct and needs
no broker. With a **second process** serving the same boards, each would have its own watcher,
`Hub` and version counter:
- while the board directory is shared, keep watching the file, but make versions comparable across
  processes (an epoch, or a persistent cursor, see below);
- when it is not shared, add a bus (Redis pub/sub `board:<slug>:changed`, NATS, or Postgres
  `LISTEN/NOTIFY`) that replaces the detection step; the wire contract does not change.

Sticky sessions are not an answer: there is no load balancer on loopback, a drain breaks them, and
the resync path is still needed. The host has no redis/nats dependency today.

**Reference design in the host:** the official kanban plugin's `/events` streams `task_events`
rows with a cursor that is the rows' **database id** (`?since=<id>`), and its client invalidates
the affected queries. A DB-backed cursor survives restarts and is shared by every process, which
removes the per-process version problem. It is the natural target if this push ever needs
multi-process or replay (`resume`).

### 6.3 Proxies and tunnels

Any proxy's read or idle timeout must exceed the heartbeat (20 s) and the transport ping; pass
`Upgrade` / `Connection` through. A Cloudflare-style tunnel idles at about 100 s, above the
heartbeat. Treat "heartbeat < tunnel idle" as a constraint. Frame size is not a concern:
`ws_max_size` is orders of magnitude above the largest snapshot.

### 6.4 Two environment facts

- **Two board roots.** The gateway container resolves `/opt/shared/kanban/boards`, while a
  worker resolves `~/.hermes/kanban/boards`. Everything goes through `_boards_root()` /
  `_board_db_path`, never a literal path.
- **A pinned `HERMES_KANBAN_DB`** (a gateway started from a worker's shell) is refused per board
  instead of cross-wiring boards (§3.1); start the gateway with a clean env.

## 7. Verification

| What | How |
|---|---|
| Server contract, end to end (P1–P11: first frame, push latency, coalescing, fan-out, auth, reconnect, flag off) | `env -u HERMES_KANBAN_DB -u HERMES_KANBAN_BOARD ~/.hermes/hermes-agent/venv/bin/python tests/ws_proof.py` |
| The route registers under core's import mode | `tests/ws_mount_gateway.py` |
| Client decisions (versions, backoff, timeouts, re-arm) | `node --test tests/ws-core.test.mjs` (against the built `desktop/ws-core.js`) |
| Through a real gateway | `docs/spikes/harness/gateway/` (sandbox `HERMES_HOME` + probe) |
| Load / payload measurements | `docs/spikes/harness/measure.py` |
| Board pinning refusal | `tests/test_plugin_api.py::test_a_board_resolving_outside_its_own_directory_is_refused`, `docs/spikes/harness/pinning_repro.py` |

## Appendix — requirements R1–R20

The code comments cite these IDs. "Status" is the current code; items not met are tracked in
`docs/TODO.md`.

| ID | Requirement | Status |
|---|---|---|
| **Payload / parity** | | |
| R1 | A push frame carries the same `{board, generated_at, tasks[], labels[]}` shape as `GET /gantt`, same per-task keys, so renderer, filters and drawer need no change. Deltas only if they rebuild that shape client-side. | met |
| R2 | One message = one generation: `tasks` and each task's `runs` / `parents` / `children` come from the same read. | met |
| R3 | Budget per push ≤ 600 KB and ≤ 50 ms server CPU; above it, coalesce or delta. | met on measured boards |
| **Latency / frequency** | | |
| R4 | Change-to-render p95 ≤ 2 s for writes made outside the UI; UI mutations keep their `invalidateQueries` path. | met (≈ 0.55 s) |
| R5 | Server coalescing 200–500 ms per board; at most one pending frame per subscriber; close a client whose buffer stays full. | met |
| R6 | A local 30–60 s tick keeps the "now" cursor and open run arcs moving without pushes. | met |
| **Ordering / consistency** | | |
| R7 | Every frame carries a monotonic per-board version; strictly newer frames apply; a gap means resync. | met within one process (§3.4) |
| R8 | The first frame after subscribe / reconnect is a full snapshot; the interval is demoted only after one is applied. | met |
| **Subscription / fan-out** | | |
| R9 | Subscribe per board slug; a board switch re-subscribes without leaking. `all` / `*` fan-in. | per board met; `all` stays on the poll (§3.3) |
| R10 | Slug validation identical to `_board_db_path`. | met (same function) |
| R11 | One DB read per board per debounce window, fanned out to N subscribers. | met |
| R12 | Writes stay on REST; the socket is read / notification only. | met |
| **Auth / deployment** | | |
| R13 | Reuse the desktop session credential; the route validates it itself (no middleware on ws). | met |
| R14 | Gated / OAuth remotes degrade to the poll; the UI never stalls or blanks. | met |
| R15 | `?token=` in a URL can land in logs: confirm redaction, or prefer a ticket handshake. | no token in local gateway logs; tickets need an SDK change |
| R16 | The standalone dev server must not gain a wider socket than its HTTP surface. | met (loopback only) |
| R17 | Long-lived gateway process; proxy timeouts and `Upgrade` handling to respect behind a remote LB. | met locally; remote unverified |
| **Liveness / failure** | | |
| R18 | Capped full-jitter reconnect, heartbeat, dead-connection detection; full snapshot on connect or after a gap. | met |
| R19 | `onMessage` is the only callback, so the plugin has its own first-frame timeout. | met (5 s) |
| R20 | A failed handshake or a dropped socket falls back to the poll, never to a blank page. | met |
