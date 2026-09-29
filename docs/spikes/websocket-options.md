# Websocket options — replacing the kanban-gantt polling loop

Spike task `t_ea6bf991` · board `gantt-demo` · 2026-09-29
Scope: the **kanban-gantt** plugin (`e-is/hermes-kanban-gantt`, this repo) — its FastAPI
backend `dashboard/plugin_api.py`, its Electron/React client `src/`, and the Hermes host it
runs inside (`~/git/hermes-agent`, the gateway process that mounts the plugin router).
Companion note: `docs/spikes/polling-baseline.md` (what the poll does and costs).

Every claim below was read out of the two repos on this workstation; commands to re-verify are
in appendix A.

---

## 1. What is actually being replaced (runtime + language)

| Layer | Runtime / language | Evidence |
| --- | --- | --- |
| Plugin backend (the thing that would serve a socket) | **Python 3.14 + FastAPI on uvicorn**, one `APIRouter()` per plugin, HTTP only today — no websocket route in this repo | `dashboard/plugin_api.py:43` (`router = APIRouter()`), module docstring (two run modes: mounted plugin / standalone uvicorn dev server) |
| Host process | **Long-lived `uvicorn.Server`** inside the `hermes gateway` / `hermes serve` process, one per gateway, never a serverless/FaaS handler | `hermes_cli/web_server.py:1190` (`_build_uvicorn_config` docstring: "`uvicorn.Server` is driven directly (not `uvicorn.run`) so startup is split from the main loop: after startup() the socket is bound and held by uvicorn") |
| Client | **Electron + React + TypeScript**, react-query intervals, plugin SDK door `ctx.rest` / `ctx.socket` | `src/main.ts:1361` (`refetchInterval: 60_000`), `src/main.ts:1342` + `src/ui/TitlebarBoardSwitcher.tsx:19` (boards, 5 min), `src/state.ts:38-57`, `src/sdk.d.ts:21` |
| Board store | **SQLite, one `kanban.db` per board**, single writer, WAL, append-only `task_events` | `dashboard/plugin_api.py:463-481` (`kanban_db.list_events`), baseline §3 |
| Existing socket substrate in the host (not used by this plugin yet) | Core already ships websocket routes (`/api/ws`, `/api/console`, `/api/pty`, `/api/pub`, `/api/events`) with a shared upgrade gate; **one bundled plugin already serves a plugin-namespaced websocket** | `hermes_cli/web_routers/chat_ws.py:277,438,595,634,646`; `plugins/kanban/dashboard/plugin_api.py:1769` (`@router.websocket("/events")`) + `:48-57` (`_ws_upgrade_authorized` reuses core `_ws_auth_ok`) |
| Client socket door already in the SDK | `ctx.socket(path, onMessage) → dispose`, token-auth + full-jitter backoff, documented | `apps/desktop/src/api/plugins.ts:95-147` (`pluginSocket`), `website/docs/developer-guide/desktop-plugin-sdk.md:187-188` |

**Framing that decides the answer:** this is not a greenfield transport choice. The host already
runs a websocket stack in production (same process, same auth gate, same topic of
"kanban board changed"), and the desktop SDK already exposes the client half. The real question is
*which websocket flavour to hang on that existing substrate*, and whether the poll can be deleted.
It cannot (see blockers B3).

---

## 2. Options compared

Dimensions are the ones this spike must judge on: ops cost, scaling/fan-out, auth integration,
reconnect semantics, library maturity. Rows A–C are the credible candidates; D–E are the ones
worth naming so they can be ruled out explicitly.

| | **A. Starlette/FastAPI-native WS** (plugin router + SDK `ctx.socket`) | **B. Socket.IO** (`python-socketio` + `socket.io-client`) | **C. SSE** (`sse-starlette` + `EventSource`) | D. Managed realtime (Pusher / Ably / Supabase Realtime) | E. Status quo polling |
| --- | --- | --- | --- | --- | --- |
| **Ops cost** | **Zero new dependencies, zero new process** — FastAPI/Starlette and `websockets==15.0.1` are already core pins; the route lives in the file that is already mounted | Two new deps in lockstep (server + client), heavy engine.io framing on the wire, plus a **built-in HTTP long-poll fallback that reintroduces exactly the traffic this spike removes**; opaque to a generic ws/`wscat` debug session | Lowest transport cost (plain HTTP, no `Upgrade`, no keepalive policy), but still one new dep (`sse-starlette` is not in the `web` extra — see §3) while discarding the host's working ws path | Highest: external vendor, API keys in a plugin that advertises "zero API keys", per-message billing, board data leaves the machine | Zero (already running) but the measured bytes are the problem: 495 KB/poll on a 1000-task board, ~7 GB/30 days per window (baseline §3) |
| **Scaling / fan-out** | Stateless per connection; the store is single-writer SQLite in one process, so a broker is not needed today. A per-board fan-out (one DB read → N sockets) is the missing piece and must be written either way | Its headline feature: `@socket.io/redis-adapter` rooms + sticky sessions — buys nothing for a single-process SQLite gateway, and costs two more moving parts | Plain HTTP; any LB/proxy handles it with no stickiness. Ceiling: HTTP/1.1 browsers cap ~6 connections per host and this stack serves **HTTP/1.1 only**, so several open boards/tabs hit a hard wall | Vendor handles scaling at a per-connection price | Worst: every window re-fetches the whole snapshot; measured 25 concurrent pollers on a 1000-task board = 1.35 s wall / 1.09 s p50 |
| **Auth integration** | Rides the host's single upgrade gate — the exact pattern the bundled kanban plugin uses (delegates to core `_ws_auth_ok`) | A second, parallel auth path (engine.io `auth` handshake payload) beside the host gate — the drifts we already pay for elsewhere | Cookies/headers flow naturally; a token query works too, but the gate is still a second implementation | Third credential system + vendor account per user | Already correct (HTTP auth middleware) |
| **Reconnect semantics** | No app protocol; the SDK door already does token auth + full-jitter backoff (500 ms → 30 s cap) and the host plugin precedent resumes by cursor (`?since=<event_id>` over `task_events`). uvicorn pings on non-loopback (20/20 default) | Strongest OOTB (heartbeat, auto-reconnect, buffered sends, acks) — i.e. a re-implementation of the hand-rolled reconnect+cursor the host already ships | `EventSource` auto-reconnects and sends `Last-Event-ID` — maps 1:1 onto our cursor, needs a server heartbeat against ~100 s tunnel idle | Vendor handles it | react-query retries (3 attempts, backoff), last good snapshot stays painted |
| **Maturity** | First-class Starlette primitive; already deployed, authed and exercised in-tree (`chat_ws.py`, bundled kanban plugin, idle-exit WS accounting) | Very mature, very large install base — but no trace anywhere in this codebase (no `socket.io*` in any manifest; §3) | Standard + `sse-starlette 3.4.8` already resolved in `uv.lock` (via the MCP HTTP-SSE stack), one-way only | Mature, but an operational and privacy commitment this plugin does not need | Proven, boring, and the reason the board is slow to feel live |

---

## 3. Dependencies already in the manifests (checked before proposing anything new)

Read from the authoritative pins, not from memory:

| Need | Already present? | Evidence |
| --- | --- | --- |
| WebSocket protocol impl / client | **Yes** — `websockets==15.0.1` is a **core** dependency (browser CDP supervisor also imports it) | `~/git/hermes-agent/pyproject.toml:129` |
| ASGI server with ws support | **Yes** — `uvicorn>=0.31.0,<1` core; `uvicorn==0.41.0` in the `web` extra (+ `httptools`, `watchfiles`; uvloop behind `[uvloop]`) | `pyproject.toml:143, 497-503` |
| Web framework with native ws routes + router-level deps | **Yes** — `fastapi>=0.104,<1` core (`0.133.1` in `web`), `starlette==1.3.1` (CVE pin) | `pyproject.toml:137, 501-503` |
| SSE server lib | **Present but only transitively** — `sse-starlette 3.4.8` resolves in `uv.lock` via the MCP HTTP-SSE stack, and `starlette` is pinned in that extra for BadHost; it is **not** a declared dep of the `web`/server extra, so option C would add a declared pin | `uv.lock:6485-6494`, `pyproject.toml:388-407` |
| Socket.IO (server or client) | **No** — zero hits in `pyproject.toml`, `uv.lock`, root/desktop `package.json` | appendix A |
| Plugin's own runtime deps | **None** — `package.json` devDeps are `esbuild` + `skills` only; the backend imports nothing beyond the host's FastAPI/stdlib (`sqlite3`, `kanban_db`) | `package.json`, `dashboard/plugin_api.py` imports |

Consequence: **options A and E add nothing to any manifest.** Option C adds one declared pin
(already resolved in the lock). Option B adds two and a new wire protocol nothing else here speaks.

---

## 4. Blockers and constraints

**B0 — Are long-lived connections viable in this deployment? YES.** The board backend is served by
a long-lived `uvicorn.Server` inside the gateway process (`web_server.py:1190`), not a serverless
handler, so there is no request timeout to fight. Topology is desktop → gateway either on loopback
or through an SSH tunnel / Cloudflare Tunnel:
`web_server.py:1225-1226` disables uvicorn's ws ping **on loopback** (a dead local client sends a
real FIN/RST; the ping would only risk dropping healthy sockets under GIL starvation) and keeps a
config-driven cadence off-loopback, `dashboard.ws_ping_interval` / `ws_ping_timeout`, default
**20/20 s** (`hermes_cli/config_defaults.py:1021-1022`) because a Cloudflare Tunnel idles around
100 s. The SSH-isolated Desktop backend additionally gets its own ping constants and an idle
watchdog that counts accepted websockets at the ASGI boundary
(`hermes_cli/web_server_idle_exit.py`, `web_server.py:1227-1232`). Net: the transport is supported and
already tuned; the work is in the application contract, not in the platform.

**B1 — Websocket upgrades bypass HTTP auth middleware.** Stated in the host source: "HTTP
middleware does not run for WebSocket routes, so the DNS-rebinding …" (`web_server_chat.py:168`).
A plugin ws route therefore authenticates **inside the handler** by reusing the host's gate
(the bundled kanban plugin does exactly that, `plugins/kanban/dashboard/plugin_api.py:48-57`).
Without this, the route is unauthenticated.

**B2 — Gated-auth remotes cannot use the SDK's socket door as it stands today.** In gated mode
(`app.state.auth_required`) the legacy `?token=` is **rejected** on purpose — the accepted
credentials are `?ticket=` (browser-minted, single-use, 30 s TTL) or `?internal=`
(`web_server_chat.py:220-296`). The desktop's `pluginSocket` builds its URL by hand with
`?token=<connection.token>` and returns early when `authMode === 'oauth'`
(`apps/desktop/src/api/plugins.ts:105-118`), while the app's own sockets mint their URL through
`resolveDesktopGatewayWsUrl` (`apps/desktop/src/lib/gateway-ws-url.ts`), which handles the ticket
path. So a plugin websocket works **today only against token-auth (local/loopback) backends**;
on gated/OAuth remotes the SDK door is a no-op by design. Making it work there is a change in
**hermes-agent core**, not in this repo → follow-up ticket, not a spike deliverable.

**B3 — The polling path cannot be deleted.** The SDK contract says the socket is "an accelerator
over polling, never a replacement. Every consumer needs a polling fallback anyway, since any
socket can drop", and `pluginSocket` deliberately resolves to nothing for OAuth remotes
(`plugins.ts:105-107`, `desktop-plugin-sdk.md:1513-1517`). Success = demoting the intervals
(60 s board, 300 s board list), not removing them.

**B4 — No fan-out exists yet.** Every open window owns its own react-query cache and re-fetches the
full snapshot; measured 25 concurrent pollers on a 1000-task board queue to 1.35 s (baseline §3).
A push design must fan out from **one** board read to N sockets, and decide what a second window on
the same board costs.

**B5 — Half-open sockets are a real gap on the tunneled path.** Loopback intentionally has no ping;
off-loopback relies on uvicorn's 20/20 s ping. An application-level ping (or a client idle timeout)
is still worth having for slept/roamed laptops so the server does not hold connections that will
never return.

**B6 — Board scoping must be pinned at handshake.** The REST surface is per-request
(`/gantt?board=<slug>`, plus a `board=all` aggregate); a socket needs the board fixed when it
opens, and a cursor so a reconnect doesn't replay history — the host precedent is
`?since=<event_id>` over the append-only `task_events` table, with the cursor taken at accept
(`plugins/kanban/dashboard/plugin_api.py:1769-1800`; the gantt backend can read the same table via
`kanban_db.list_events`, `dashboard/plugin_api.py:480`).

**B7 — Proxies.** Off-loopback, whatever fronts the gateway must pass `Upgrade`/`Connection` and
keep its read timeout above the 20 s ping (a Cloudflare Tunnel idles ~100 s). On loopback there is
nothing to configure. `forwarded_allow_ips` trust is already pinned in the host's manifest.

**B8 — Plugin trust gates apply.** A websocket route only exists when the plugin is installed and
enabled (`plugins.enabled` allow-list) and its source is `bundled`/`user`; project-source plugin
Python is never auto-imported (`hermes_cli/web_server_dashboard.py:805-885`). Unchanged by this
spike, but it bounds any prototype.

---

## 5. Recommendation

**Primary: option A — a Starlette/FastAPI-native websocket on the plugin's own router**
(`@router.websocket("/events")` in `dashboard/plugin_api.py`, mounted automatically at
`/api/plugins/kanban-gantt/`), consumed through the SDK's existing `ctx.socket('/events', …)`, with
the board pinned at handshake and `?since=<event_id>` cursor replay over `task_events`.
**Fallback: option C — SSE via `sse-starlette`**, kept as the documented alternative for networks
that block `ws://` but allow HTTPS.

Reasoning, in four sentences. The transport decision is already made and paid for: the host runs a
long-lived uvicorn with a websocket stack, a shared upgrade gate and ping policy tuned for exactly
these two topologies, and a bundled plugin already serves a board-event socket that this plugin can
copy line for line — so option A is the only candidate with **zero new dependencies, zero new auth
path and zero new failure mode**, and the measured problem (bytes and herd, not CPU) is solved by
push regardless of flavour. Socket.IO is rejected because its differentiating features (rooms,
send-buffers, multi-instance scaling via a Redis adapter) are either re-implementations of the
host's own reconnect+cursor semantics or irrelevant to a single-process, single-writer-SQLite
gateway — while its engine.io long-poll fallback would literally reintroduce the polling traffic
this spike exists to remove. SSE is the right *fallback* and not the primary: it maps cleanly onto
our event cursor and survives ws-hostile proxies, but it is one-way and this stack serves HTTP/1.1,
where browsers cap ~6 connections per host — a real ceiling with several boards open, and it would
add a declared dependency while discarding a working, tested websocket path. Managed realtime is
ruled out on the plugin's own "zero API keys" premise (board data would leave the machine), and the
status quo stays only as the permanently required fallback (B3): the concrete prototype should keep
the 60 s board interval as a safety net, add the server ping/idle-timeout from B5, and land the
per-board fan-out from B4 behind a flag. Revisit the library question only if a multi-gateway/HA
topology appears — then the same `/events` contract can be fed by a broker fan-out with **no client
change**.

---

## Appendix A — how to re-verify

```bash
R=~/git/hermes-agent
# stack + pins
sed -n '120,150p;490,510p' $R/pyproject.toml
grep -n 'sse-starlette\|sse_starlette' $R/uv.lock | head
grep -rn 'socket.io\|socketio' $R/pyproject.toml $R/uv.lock $R/package.json   # → nothing
# long-lived server + ws ping policy
sed -n '1190,1235p' $R/hermes_cli/web_server.py
grep -n 'ws_ping' $R/hermes_cli/config_defaults.py
# ws auth gate (+ middleware bypass note) and the plugin precedent
sed -n '160,175p;220,300p' $R/hermes_cli/web_server_chat.py
sed -n '1765,1805p' $R/plugins/kanban/dashboard/plugin_api.py
sed -n '805,885p' $R/hermes_cli/web_server_dashboard.py
# client door
sed -n '89,150p' $R/apps/desktop/src/api/plugins.ts
sed -n '1513,1520p' $R/website/docs/developer-guide/desktop-plugin-sdk.md
# this plugin's side
grep -n 'refetchInterval' ~/git/hermes-kanban-gantt/src/main.ts
grep -n 'socket' ~/git/hermes-kanban-gantt/src/sdk.d.ts
```

Not done here (belongs to the prototype task): no socket was opened, no code changed.
