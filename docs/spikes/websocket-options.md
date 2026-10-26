# Transport options for the gantt board stream — survey and candidate pick

Card `t_5f577b45` (board `gantt-demo`), 2026-10-26. Read off the tree at `3aee9c0`
(plugin `1.7.1`); `1.7.2` is a release-only bump on top of it.

Deliverable of the "survey websocket transport options and pick candidates" step: narrow the
transport design space to the 1–2 options worth building, against the constraints this stack
actually has, and record why the others were dropped.

**Read this with a status caveat.** The transport decision below is no longer open: the native
websocket route shipped in plugin `1.3.2` (`KANBAN_GANTT_WS`, off-switch since that release) and
is the live path today, with the 60 s poll kept as the permanent fallback. The earlier spike notes
say their "stack comparison" was deleted when `websocket-recommendation.md` was written. This file
is that missing comparison, rebuilt from the code and from measurements taken now — so it serves
two purposes: the audit trail for the shipped choice (§4), and the constraint list the open
hardening items in `../TODO.md` have to respect (§5).

Companions: `websocket-recommendation.md` (go/no-go and end-to-end numbers),
`websocket-protocol-design.md` (wire contract, R1–R20), `websocket-migration.md` (loop inventory),
`../TODO.md` (hardening backlog).

---

## 1. Stack constraints (inventory)

Everything here is read off the tree at `3aee9c0` / the mounted gateway, with paths for re-checking.

| Constraint | What it is | Where |
|---|---|---|
| **Languages / frameworks** | Server: Python, FastAPI `APIRouter` on the gateway's Starlette app (`dashboard/plugin_api.py`, `dashboard/plugin_ws.py`). Client: one TypeScript/JSX bundle built by esbuild (`src/**` → `desktop/plugin.js`), React Query for the cache. No bundler-level code splitting, no separate client transport layer. | `package.json` (`build`, `check`, `test`), `scripts/build.mjs` |
| **Deployment target** | A single long-lived `hermes gateway run` process (uvicorn) with the embedded dashboard on port 9119. The plugin's router is mounted **in-process** at `/api/plugins/kanban-gantt/…`. The other end is the Electron desktop app; there is no browser tab / public web origin. | `sumaris-agent/docker-compose.yaml` (`HERMES_DASHBOARD_PORT: 9119`), `hermes_cli/web_server_dashboard.py` |
| **Serverless vs long-lived** | Long-lived, stateful process. No request-scoped runtime anywhere in the path (no Lambda/Cloud Run), so a process holding sockets open costs nothing extra. | same |
| **Plugin process model** | `plugins.isolation` defaults to `in_process`. The `host` mode forwards `/api/plugins/<name>/…` over HTTP only — *"responses are buffered: streaming and websockets need in-process"*. A plugin socket is therefore only possible when the router runs in the gateway process itself. | `hermes_cli/plugin_isolation.py:28-101`, `hermes_cli/web_server_dashboard.py:953-962` |
| **Proxy / TLS** | No reverse proxy in the compose stack: 9119 is published straight from the container. Non-loopback deployments are documented as sitting behind a Cloudflare Tunnel (~100 s idle). TLS is terminated upstream, not by uvicorn. | `hermes_cli/web_server.py:990-1021` (comment + `proxy_headers`) |
| **Idle / liveness policy** | Core already decides this per bind: **loopback → uvicorn ws ping disabled**; **non-loopback → ping 20 s / timeout 20 s**, configurable via `dashboard.ws_ping_interval` / `_timeout`; **ssh-isolated desktop backend → 60 s / 600 s**. Close reasons are visible to the client, and the plugin must not fight this with its own protocol pings. | `hermes_cli/web_server.py:1014-1021`, `hermes_cli/web_server_idle_exit.py:37-38` |
| **Sticky sessions** | Not available and not needed: one process, one event loop, so a socket always lands on the only hub that exists. This is a constraint on *future* horizontal scaling (see R-risks §3), not on the current design. | — |
| **Frame size ceiling** | `ws_max_size` is 384 MB (the desktop attachment stream's ceiling). Room to spare for a ~11 KB snapshot. | `hermes_cli/web_server_boundary.py:26` |
| **Auth surface** | HTTP middleware **does not run for `websocket` scope** — the route authenticates itself. Core's gate accepts: a native `X-Hermes-Gateway-Ticket` grant (local desktop), a single-use `?ticket=` (gated browser), a `?token=` session token, or loopback `?token=` matching the in-process session token. A plugin can delegate to `_ws_auth_ok` or implement its own. | `hermes_cli/web_server_chat.py:343+` (`_ws_auth_reason`), `dashboard/plugin_ws.py:174-250` |
| **Client door (what the SDK gives a plugin)** | Exactly one: `ctx.socket(path, onMessage) → dispose()` — a JSON `WebSocket` to the plugin's own namespace, **receive-only** (no `send`, **no `onOpen`**), auto-reconnect with full-jitter backoff 500 ms → 30 s, gives up after 5 consecutive refused dials, and **resolves to a no-op on OAuth remotes** ("treat it as an accelerator over your polling, never a replacement"). There is no SSE/`EventSource` door and no plugin-visible `fetch` streaming hook. | `apps/desktop/src/contrib/plugin.ts:155,367`, `apps/desktop/src/api/plugins.ts:91,126-205` |
| **Current polling baseline** (measured today) | `GET /gantt?board=<slug>` returns the whole snapshot: **20 tasks, 0 labels, 11 333 B** on `gantt-demo`. `_read_gantt` **p50 11.5 ms / p95 13.3 ms**, of which **11.3 ms p50 is `sqlite3.connect()` alone** — the query itself is ~0.1 ms. Cadence: `refetchInterval: 60_000`, demoted to `300_000` while the socket is live ⇒ 1 440 full snapshots/day per open window, each paying a fresh connection. | `src/main.ts:3791`, `dashboard/plugin_api.py:353`; measurement commands in §6 |

Three consequences fall straight out, and they drive the whole comparison:

1. **The transport must be reusable, not chosen.** The desktop SDK exposes a websocket door and
   nothing else that is push-shaped. Anything other than a websocket in the plugin namespace means
   new core/SDK surface plus a per-host feature-detection story.
2. **There is no second process to scale to.** A broker-backed fan-out would be new infrastructure
   for a hub that currently serves one gateway's windows.
3. **The fallback is mandatory in every design** — the door can resolve to a no-op (OAuth remote),
   auto-reconnect can exhaust, and the plugin can be hosted out-of-process. The REST poll therefore
   stays, which caps how much complexity a push transport may add: it can only ever be an
   accelerator.

## 2. Options compared

Four options, one row per design question. "Native WS" = what shipped.

| | **A. Native WebSocket** (`ws`/Starlette on the plugin's own router) | **B. socket.io** (`python-socketio` + `socket.io-client`) | **C. Managed realtime** (Ably / Pusher / Supabase Realtime) | **D. SSE** (`text/event-stream` + `EventSource`) |
|---|---|---|---|---|
| **Connection lifecycle** | Route owns it: `accept` → subscribe → loop; liveness from core's uvicorn ping plus a data-frame heartbeat; per-subscriber `Subscriber` object with drop-and-coalesce. | Engine owns it: own handshake, own heartbeat, own transport upgrade from polling → ws. A protocol on top of ours, in a scope where our middleware/auth do not run. | Vendored SDK owns it end-to-end; connection state is opaque to us. | Half-duplex one HTTP response; lifecycle = a response body that never ends, so proxy buffering and idle timeouts decide whether it works at all. |
| **Reconnect / resubscribe** | SDK door reconnects (500 ms→30 s full jitter), plugin adds first-frame timeout, idle timeout, one extra retry, and a 5-min re-arm; every reconnect gets a **full snapshot as first frame**, then a monotonic `version`. | Engine reconnects and replays its buffer — but its resubscribe semantics are *its* semantics, and the snapshot-on-connect contract would have to be rebuilt inside an `io.on('connect')` handler. | SDK reconnects; resubscribe is an SDK call, and catch-up depends on the vendor's history/rewind feature (a paid tier question). | `EventSource` auto-reconnects with `Last-Event-ID`, which is genuinely nice — but it would be a **new SDK door** plus a new server streaming route, since the desktop has no `EventSource` surface for plugins. |
| **Auth on handshake** | In-handler, because middleware never sees the websocket scope: delegate to core's `_ws_auth_ok` (native grant, ticket, session token, loopback token), fall back to own rules on the standalone dev server. Browser-style token-in-query is accepted but never logged. | Engine's handshake runs inside the plugin but its own protocol/namespace layer sits in front of the route; auth becomes socket.io `auth` payload + our check, duplicated per connection, and the engine's own polling fallback endpoints would also need gating. | Third-party auth: key + token minted by us and passed to the vendor. The kanban DB credential model (`HERMES_KANBAN_DB` pinning, per-profile homes) would be re-expressed as vendor "channels", and every frame leaves the host. | Cookies/headers work naturally (it is a plain GET) — the one real advantage — but the SDK door still has to be written and it would need the same server-side gate. |
| **Horizontal scaling / fan-out** | In-process hub per board: one DB read fanned out to N subscribers, drop-and-coalesce per client. **Breaks across processes** (a second gateway instance reaches only its own clients) — acceptable today (single process), noted as the scaling limit in §3. | Needs an adapter (`redis`) for multi-node; we run Redis in the compose stack, so it is reachable — but it is a new runtime dependency and a second source of truth about board state. | The vendor *is* the fan-out; that is the one thing it does better than A. Bought at the price of egress, a second availability domain and a data-processing question for board contents. | Fan-out in-process like A, with the same single-process limit — and, like A, one open response per client, holding a worker/connection slot that uvicorn must keep. |
| **Ordering / delivery guarantees** | TCP order within a connection; snapshot-then-version means a missed frame is repaired by the next reconnect, not by replay. Coalescing can drop *intermediate* states, never the latest (R5/R7/R8). | Same TCP order, plus the engine's at-least-once buffer on reconnect — which we would then have to make idempotent anyway, since applying a snapshot twice must be a no-op. | Vendor guarantees, typically at-least-once with resume — same idempotency requirement, plus a hosted history cursor to reason about. | Ordered on the wire; `Last-Event-ID` gives real replay, the strongest of the four — worth remembering if replay ever becomes a requirement. |
| **Operational cost** | Zero new deps, zero new processes, zero new credentials. Lives and dies with the gateway; the only tuning knobs are env vars (`KANBAN_GANTT_WS_*`). Failure modes are visible in gateway logs. | New Python + JS dependency, a protocol version to keep in sync with the desktop's bundled client, and an adapter decision the day there is a second process. | Per-connection and per-message billing, a vendor in the on-call path, egress of board data, an SDK to audit, and a hard dependency for a *local desktop app* whose whole point is not needing one. | Cheap on the server, but pays in proxy behaviour: needs buffering disabled (`X-Accel-Buffering: no`), needs a heartbeat to survive idle timeouts, and the Cloudflare-Tunnel leg (~100 s) has to be kept fed — the same heartbeat problem as A, without A's existing plumbing. |
| **Maturity / maintenance** | `ws`/Starlette websockets are the same stack the gateway already runs in production for its own `/api/ws`, `/api/pty` and audio streams. Risk is inherited, not introduced. | Mature, but `python-socketio` + a bundled browser client is a second comms stack beside the gateway's own, maintained on a different cadence, for a workload that is one-way JSON. | Mature, rapidly changing pricing/API surface, and unusable offline — which the local desktop is. | `EventSource` is a browser primitive, stable for a decade; the missing piece is ours (the SDK door), not the standard's. |

## 3. Risks this design carries (and how they differ from polling)

* **Proxy / tunnel idle timeout.** Non-loopback gateways sit behind a Cloudflare Tunnel (~100 s idle);
  the uvicorn ping is already configured at 20 s/20 s there precisely for this, and the plugin's own
  data-frame heartbeat is only a liveness smell-test on top. *Residual risk:* an intermediate proxy
  that is stricter than 20 s, or one that buffers websocket frames, will show up as repeated
  reconnects — observable only as reconnect churn, not as an HTTP error.
* **Mobile / background-tab churn.** Electron windows on a sleeping laptop, or a suspended tunnel,
  leave *half-open* sockets: the server sees nothing, the client sees nothing. Core already handles
  the ssh-isolated desktop case with a 60 s/600 s ping; a backgrounded renderer throttles timers, so
  the client-side idle timeout is the only real defence. Not tested on a real device.
* **Backpressure.** Deltas/snapshots are small (11 KB), but a slow consumer at N clients still grows
  the send buffer. The shipped policy is *drop-and-coalesce, then close* (at most one pending frame,
  close `4408` when it stays full) — a deliberate choice of freshness over completeness, safe only
  because the client resyncs from a snapshot on reconnect. Backpressure is genuinely *easier* than in
  polling: polling degrades into server CPU, push degrades into one dropped client.
* **Observability gap vs. polling.** This is the real regression. A poll is an HTTP request: status
  code, duration, bytes, count — every existing dashboard, log line and proxy metric sees it. A
  socket is one long connection: **Live connections per board, frames sent, coalesced/dropped
  frames, DB reads per change, and reconnect churn have to be counted by the plugin itself.** Until
  that exists (`../TODO.md`, "Observability"), "did push break?" is answered by a user complaint.
  The `GET /gantt` poll keeps working underneath, so a push failure looks like *slow*, not *down* —
  which hides failures even better.
* **"Live" is narrower than the UI.** Every frame is a whole snapshot, so a dropped frame costs
  latency and never correctness (a version jump > 1 triggers a REST re-validation). What push does
  *not* cover is everything else on screen: the task drawer's `GET /tasks/<id>`, the board list, the
  project/profile pickers — those keep their own fetches, so users learn to trust the bars and not
  the drawer. The version counter is also per-process: a gateway restart legitimately restarts it
  at 1 and the client must treat that as a new stream (it does), which means a *restart* and a
  *counter reset* are indistinguishable on the client.

## 4. Recommendation

**Prototype/ship A (native WebSocket on the plugin's own Starlette router, consumed via
`ctx.socket`), keep the REST poll as a permanent fallback, keep the `KANBAN_GANTT_WS` off-switch.**
That is exactly what shipped; measured on this stack, it is the only option that adds no new
dependency, no new process, no new vendor and no new auth model, and it inherits the gateway's
production websocket path (including its per-bind ping policy) instead of re-inventing it.

**B — socket.io: rejected.** It buys transport fallback and reconnect buffers, two things the SDK
door already provides (fallback = the REST poll, which must exist anyway; reconnect = full-jitter
backoff in `pluginSocket`), and charges for them with a second protocol stack inside a scope where
the gateway's HTTP middleware and auth gate do not run. Its polling-upgrade endpoints would each
need gating, and its client would be a second bundled client next to the app's own. For a one-way
JSON snapshot at ~2 msg/s, that is complexity with no measured benefit.

**C — managed realtime service: rejected.** Wrong shape for the deployment: the product is a *local*
desktop app over a *local* gateway, and board contents are the user's kanban data — routing them
through a third party to solve multi-process fan-out for a single-process deployment is a cost,
privacy and availability regression in exchange for a problem we do not have. Revisit only if the
gateway ever becomes multi-node *and* the boards become multi-user.

**D — SSE: rejected, but the strongest runner-up.** Ordered stream + native `Last-Event-ID` replay
are better guarantees than A gives, and handshake auth is trivially easier (a plain GET). It loses
on integration, not on design: the desktop SDK has **no** `EventSource` door for plugins, so SSE
means new core surface plus a per-host feature-detection story, and the Cloudflare-Tunnel leg needs
the same heartbeat plumbing A already has. It becomes the right answer if *replay across a dropped
connection* ever becomes a requirement — that is the one thing A cannot do without a DB-backed
cursor (`../TODO.md`, "Multi-process / replay").

**Candidate to prototype next, if one is needed: SSE as the replay-capable fallback**, not socket.io
and not a vendor. Everything else in the space is dominated by A at today's constraints.

## 5. What would flip the decision

* A second gateway process / multi-node fan-out ⇒ A needs a backplane (Redis adapter or a DB-backed
  cursor). At that point B/C get competitive again — but so does A + Redis, and A keeps the auth model.
* OAuth remotes needing push ⇒ today they get the no-op door; that is a *core SDK* gap (new door or
  ticket support in `pluginSocket`), not a reason to change transport.
* Replay-exact delivery becoming a hard requirement ⇒ D, or A with a `task_events` cursor.

## 6. How the constraints were measured

```sh
# snapshot size and per-request cost (the poll's real price: a fresh sqlite connection per call)
cd dashboard && ~/.hermes/hermes-agent/venv/bin/python - <<'PY'
import sys, time, json, statistics; sys.path.insert(0,'.')
import plugin_api as p
p._read_gantt("gantt-demo")
ts=[(lambda a: (p._read_gantt("gantt-demo"), (time.perf_counter()-a)*1000)[1])(time.perf_counter()) for _ in range(60)]
ts.sort(); print("read p50 %.2f ms p95 %.2f ms" % (statistics.median(ts), ts[int(.95*len(ts))]))
d=p._read_gantt("gantt-demo"); print("tasks", len(d["tasks"]), "bytes", len(json.dumps(d,separators=(',',':')).encode()))
PY
# → 20 tasks, 11 333 B, p50 11.5 ms; connect+close alone p50 11.3 ms
```

Gateway bind / ping policy: `hermes_cli/web_server.py:990-1021`, `hermes_cli/web_server_idle_exit.py:37-38`.
Plugin process model: `hermes_cli/plugin_isolation.py:91-101`, `hermes_cli/web_server_dashboard.py:945-962`.
SDK door contract: `apps/desktop/src/contrib/plugin.ts:150-156`, `apps/desktop/src/api/plugins.ts:91,126-205`.
