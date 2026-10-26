# Websocket proof-of-concept — results

Card `t_9332b1e2` (board `gantt-demo`), 2026-10-26. Tree: plugin `1.7.2`, `main` @ `4db0f39`.
Companions: `websocket-options.md` (the survey and the pick), `polling-loop-audit.md` (what
the poll does today), `websocket-protocol-design.md` (R1–R20).

**Status: spike.** The code lives in `docs/spikes/ws-poc/` and is not imported by the plugin;
no production route, module or build step changed. It boots the *shipped* transport —
`dashboard/plugin_api.create_app()` with `dashboard/plugin_ws.py`'s `/events` route, behind
`KANBAN_GANTT_WS` — on a throwaway board built through the real domain layer
(`hermes_cli.kanban_db`), so the schema, the payload and the auth path are the production ones.
Raw numbers: `results/ws-poc.json`; the run's log: `results/ws-poc.log`.

## How to run (reproduce)

```bash
cd ~/git/hermes-kanban-gantt
PYTHONPATH=$HOME/.hermes/hermes-agent \
  ~/.hermes/hermes-agent/venv/bin/python docs/spikes/ws-poc/poc_bench.py     # ~3 min
# one section: --only auth|latency_default|latency_tuned|throughput_default|
#              throughput_tuned|frame_ceiling|fanout_20|memory|drop_rst|
#              restart_term|restart_kill
```

Two-terminal manual flow (server / client / a write from a third shell) is in
`ws-poc/README.md`; it was run end-to-end: the client rendered `v1` on connect and `v2`
after an out-of-process `INSERT`.

Environment of the recorded run: host `fixe13.e-is`, Python 3.11.16, uvicorn 0.41.0,
starlette 1.3.1, websockets 15.0.1, everything on `127.0.0.1` (so latencies are the loopback
floor, not a network figure), 20-task board, **snapshot 7 492 B**, uvicorn ws ping disabled
(the gateway disables it on loopback; the plugin's data heartbeat stands in).

Configurations: **default** = the shipped knobs (`poll 250 ms`, `debounce 300 ms`,
`heartbeat 20 s`); **tuned** = `poll 50 ms`, `debounce 100 ms`, `heartbeat 5 s`.

## 1. Does it work end to end?

| check | result |
|---|---|
| authenticated handshake (token in query) | `ACCEPTED v1 20 tasks` |
| no token / wrong token | **refused**: `InvalidStatus: server rejected WebSocket connection: HTTP 403` (server closes with 1008 before `accept()`) |
| first frame on connect | full `/gantt` snapshot, `type: snapshot`, `version: 1`, 20 tasks, 7 492 B |
| push after an out-of-UI write | frame per write, version strictly increasing |
| coalescing | 3 551 writes in 10 s ⇒ **20 frames** (178 writes/frame) at default |
| fan-out | 20 subscribers, one board read per change, identical versions on all clients |
| auto-reconnect after RST | reconnect in **46 ms**, first frame a snapshot, version continues |
| auto-reconnect after server restart | reconnect **0.4 s** after the server is back, snapshot `v1` (new process ⇒ counter reset) |

## 2. Latency — event → client receipt

Measured from a write committed on a *separate* sqlite connection (what the dispatcher or
another agent does) to the client's `recv` of the frame carrying it; n = 20 writes per
configuration, one at a time.

| config | p50 | p95 | max |
|---|---|---|---|
| default (poll 250 / debounce 300) | **499 ms** | 540 ms | 540 ms |
| tuned (poll 50 / debounce 100) | **147 ms** | 153 ms | 153 ms |

The floor is structural, not network: `poll` (change detection) + `debounce` (coalescing)
are the two waits, and they add up. 147 ms ≈ 50 ms poll + 100 ms debounce, i.e. the transport
itself costs low single-digit ms on loopback. Against the 60 s poll it replaces (mean 30 s,
worst case a full interval) both are three orders of magnitude better — and against the
audit's `_read_gantt` p50 of 11.5 ms, the push removes the repeated read entirely.

**Gap worth noting:** server-side and transport halves cannot be separated from the frame,
because `/gantt`'s `generated_at` is `int(time.time())` — integer seconds. Every "server
age" figure from this payload is quantised to ±1 s (measured p50 432–508 ms, meaningless).
If push latency is ever to be observed in the field, the frame needs a fractional
`generated_at_ms` or the plugin needs its own counter.

## 3. Throughput — how many messages per second

Writers: 4 threads (default/tuned runs) or 1 (ceiling run) doing `UPDATE`s on 40 seeded
tasks — real board traffic shaped so the snapshot size stays constant instead of growing
with every write.

| run | writes/s | frames/s | writes per frame | bytes/s |
|---|---|---|---|---|
| default (poll 250 / debounce 300) | 352.6 | **2.0** | 177.6 | 14.9 KB/s |
| tuned (poll 50 / debounce 100) | 204.6 | **6.6** | 30.8 | 49.8 KB/s |
| ceiling (poll 25 / **debounce 0**, 1 writer) | 373.6 | **37.6** | 9.9 | 282 KB/s |
| fan-out, 20 clients (tuned, 20 writes/s) | 15.3 | 5.7 per client | 2.7 | **112.8 client-msgs/s** |

Readings:

* **The client-visible message rate is decoupled from the write rate by coalescing.** 350
  writes/s reach the page as 2 frames/s; that is the design working, not a bottleneck.
* **37.6 frames/s is the roof** with the coalescing window removed and the change poll at its
  minimum: it is one DB read per frame, and `_read_gantt` measures 11.5 ms. The loop is
  self-limiting at ~1/read-cost, which for this board is ~40 msgs/s.
* **The push competes with the writers for the same sqlite file.** Lowering `poll` from 250 ms
  to 50 ms (4× more reads) cut writer throughput from 353/s to 205/s while frames went 2.0 →
  6.6/s. The default knobs are the better deal under load; the tuned ones trade write
  throughput for freshness. This is the concrete cost behind the "the poll's price is
  connection churn" finding in the survey: either way it is sqlite on the same file.
* 20 subscribers cost **no extra reads** (112.8 client-msgs/s at 5.7 frames/s per client) —
  fan-out is one read broadcast 20 times, as designed.

## 4. Memory / connection overhead

Server RSS and open fds, sampled after every plateau stabilised:

| clients | RSS (KB) | fds | threads |
|---|---|---|---|
| 0 | 76 540 | 15 | 6 |
| 10 | 79 148 | 29 | 7 |
| 25 | 82 124 | 44 | 7 |
| 50 | 86 876 | 69 | 7 |

**≈ 207 KB and 1.08 fd per connected client**, one extra thread for the board stream (not one
per client). Extrapolating (not measured): 500 windows ≈ 100 MB and 540 fds — comfortable for
a single-gateway deployment, and the reason the "no broker needed" pick holds at this scale.
Caveats: single run, 24-core host, no 500-client sweep, and RSS deltas include Python allocator
growth rather than a per-object measurement.

## 5. Dropped connection and server restart

| scenario | reconnect | what the client saw |
|---|---|---|
| RST from the client side (`SO_LINGER 0` + abort — the server sees a reset, no close frame) | **46 ms** (range across runs: 46–502 ms, full jitter) | snapshot on the new connection, version continued `v1 → v2`, next write delivered |
| server `SIGTERM`, down 3 s, restarted on the same port | **4 940 ms** after the kill (`403 ms` after the server was listening again) | snapshot, `version: 1` — a new stream, the counter restarts with the process |
| server `SIGKILL` (crash), down 3 s, restarted | **5 023 ms** after the kill (`1 409 ms` after the server was back) | same: snapshot, `version: 1` |

Retry ladders recorded by the client (full jitter, 500 ms base, 30 s cap):
`[160, 630, 1125, 2943]` ms (SIGTERM run) and `[32, 322, 992, 3611]` ms (SIGKILL run).

Two findings behind those numbers:

1. **Jitter overshoots.** In one recorded run the client slept 6.2 s *after* the server was
   already back (recovery 3.7 s after up); the good runs landed at 0.4 s. Same code, same
   outage — the variance is the ladder, not the transport. A UI that trusts the ladder will
   sometimes re-poll a healthy server for seconds. This is the argument for a "wake up now"
   nudge (`online` event, window focus) or a lower cap, and it is measurable here.
2. **A restart and a resync are indistinguishable to the client** (version goes back to 1),
   exactly as the design doc predicted. Recovery is still correct because the first frame is
   always a full snapshot — no replay needed, no gap to repair.
3. The desktop SDK door **gives up after 5 consecutive refused dials** and falls back to
   polling. On this ladder a 3 s outage stays under that (worst dial count observed: 5 retries
   in the SIGTERM run, no give-up), but a restart longer than ~10 s crosses it. The PoC client
   runs with the cap raised (`--max-refused`) to measure recovery; the shipped door would have
   handed over to the 60 s poll. That is the fallback working as designed, not a bug.

## 6. Blockers hit (with the exact output)

1. **The earlier proof harness in this tree is stale.** `tests/ws_proof.py` (spike
   `t_64075faf`, the file behind `results/ws-proof.log`) fails at HEAD `4db0f39` on its first
   frame:
   ```
   kanban-gantt ws: stream for ws-proof ended: OperationalError: no such table: task_attachments
   websockets.exceptions.ConnectionClosedError: no close frame received or sent
   ```
   Its hand-written fixture schema predates `/gantt`'s attachment count and activity series.
   Adding those tables leads to a second wall — the fixture DB is not registered as a board, so
   `_board_db_path()` refuses it and the upgrade dies before `accept()`:
   ```
   websockets.exceptions.InvalidStatus: server rejected WebSocket connection: HTTP 403
   ```
   This PoC sidesteps both by creating the board through `hermes_cli.kanban_db` +
   `kanban_db_boards.create_board` (real schema, registered slug). Follow-up card filed to fix
   the harness rather than silently deleting its 13 protocol checks.
2. **No proxy or tunnel in the path.** The compose stack publishes 9119 straight from the
   container; non-loopback deployments sit behind a Cloudflare Tunnel (~100 s idle). Nothing
   here exercises a proxy, so the "stricter-than-20 s idle timeout / buffering proxy" risk in
   `websocket-options.md` §3 remains **untested** — it is not reproducible on this host.
3. **OAuth remotes cannot be covered locally**: `ctx.socket` resolves to a no-op there. The
   fallback (REST poll) is the mitigation; nothing to measure in a local PoC.
4. **Half-open links are undetected on purpose.** With no protocol ping, only the data
   heartbeat (5 s here, 20 s shipped) reveals a dead peer; black-holing packets to prove it
   needs iptables-level fault injection, which I did not do.
5. **`sqlite3` CLI is absent on this host**, so the documented "make a change" step uses a
   Python one-liner (`ws-poc/README.md` step 3) — otherwise it fails with
   `sqlite3 : commande introuvable`.
6. **Backpressure / slow-consumer close (`4408`)** was not exercised: it needs a client that
   stops reading while the board changes, which this harness does not simulate.

## 7. What this proves, and what it does not

Proves: the recommended option from the survey works end to end in this stack — authenticated
handshake, snapshot-on-connect, coalesced push from an out-of-process write, fan-out without
extra reads, automatic recovery from a reset and from both graceful and hard restarts, at
~150–500 ms freshness, 2–38 msgs/s per board, ~207 KB and one fd per client.

Does not prove: multi-process fan-out (single process only), proxy/tunnel behaviour, replay
across a gap (a restart resets the version), the slow-consumer path, or anything about a real
network — every number here is loopback.

## Reproduce checklist for the reviewer

```bash
cd ~/git/hermes-kanban-gantt
git status --short                      # only docs/spikes/ws-poc + results/ws-poc.* untracked
PYTHONPATH=$HOME/.hermes/hermes-agent \
  ~/.hermes/hermes-agent/venv/bin/python docs/spikes/ws-poc/poc_bench.py
```

Expect, within ±30 % of the tables above: `latency_default` p50 ≈ 0.5 s, `latency_tuned`
p50 ≈ 0.15 s, `throughput_default` ≈ 2 frames/s, `frame_ceiling` ≈ 35–40 frames/s,
`memory` ≈ 200 KB/client, `drop_rst` reconnect < 600 ms with the version continuing, and both
restart runs reconnecting with `version: 1` after the server is back.
