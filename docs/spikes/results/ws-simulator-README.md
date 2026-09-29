# WebSocket spike — throwaway prototype

Status: **SPIKE / THROWAWAY. Not production code.** Nothing here is wired into
any production path; it is a self-contained directory you can delete.

Goal: show that the data the polling loop fetches can be *pushed* over a
websocket instead, and measure what that actually buys.

---

## What runs here

```
server.py      one process, two listeners over ONE shared Board:
                 HTTP  GET  /api/tasks   <- the polling contract (baseline)
                 WS    /ws               <- subscribe once, receive pushes
                 HTTP  POST /chaos       <- hang up on every ws client
                 HTTP  POST /mutate      <- make exactly one change
ws_client.py   subscribes, receives pushes, reconnects with exponential
               backoff + jitter; records latency and outage windows
poller.py      the baseline: GET every N seconds, forever, changed or not
bench.py       phase 1: continuous changes + forced disconnect
               phase 2: sparse changes -> "how long until the client sees it?"
bench_restart.py  kills the server mid-session and restarts it 5s later
board.py       toy in-memory data source + the payload contract
```

Payload (byte-identical for both transports — that is the point):

```json
{"revision": 7, "server_time": 1759161234.5, "data_time": 1759161234.2,
 "tasks": [{"id": "t_000", "title": "...", "status": "running",
            "updated_at": 1759161234.1}, "..."]}
```

* `server_time` -> transport latency (when the server produced the payload)
* `data_time` -> **staleness**: how old the data the user is looking at is.
  This is the metric that decides the trade-off, so both clients measure it
  the same way: `receive_time - data_time`.

### Contract caveat

The real poller endpoint has not been wired in yet — the sibling audit task
(`t_cb748994`, reseeded board -> `t_b9555592`) is still mapping it. `payload()`
in `board.py` is a stand-in for the real response body. Swapping it in should
not require touching the transport code, which is the whole reason the shape is
faked rather than guessed at deeply.

---

## How to run

```bash
cd spike
python3 -m venv ../.venv && ../.venv/bin/pip install websockets   # only dep
../.venv/bin/python bench.py                      # both phases, ~45s
../.venv/bin/python bench_restart.py              # server outage test, ~25s
```

Manual start (two terminals):

```bash
../.venv/bin/python server.py              # http :8788 /api/tasks, ws :8787/ws
../.venv/bin/python poller.py --interval 2 --duration 20
../.venv/bin/python ws_client.py --duration 20
```

`results_interval2.json` / `results_interval5.json` are saved runs.
`stdlib venv is needed: Debian marks the system python externally managed, so a
plain `pip install` is refused (PEP 668).`

---

## Observed numbers

Host: fixe13.e-is (Fedora), python 3.13, websockets 17.1, everything on
127.0.0.1 — so absolute latency is the loopback floor, not a network figure.
25 tasks per payload, ~2.4 KB per payload.

### Phase 1 — continuous changes (mutation every 0.5s, 24s, 1 forced disconnect)

| metric                          | polling | websocket |
|---------------------------------|---------|-----------|
| frames received                 |      12 |        50 |
| bytes received                  |  29.5 KB |  123.1 KB |
| connection setup (median)       |  1.1 ms (HTTP round-trip) |  2.1 ms (ws handshake) |
| transport latency (median)      |  0.39 ms |   0.31 ms |
| displayed-data staleness median |   395 ms |   0.32 ms |
| displayed-data staleness p95    |   481 ms |     65 ms |
| errors / drops                  |       0 |         1 |
| outage window after drop        |       - |    230 ms |

Per-change detection delay in this phase was 0.3–0.9 ms for the websocket,
except one 151 ms sample immediately after the forced drop (reconnect window);
the poller ranged 6–490 ms. Read: when changes are constant, the poller is
*never badly stale* (the data is replaced every 0.5 s anyway) but it burns 4.2x
**less** bandwidth — because a naive push-on-every-change sends 50 frames where
the poller sent 12. Pushing raw is only a win once you coalesce.

### Phase 2 — sparse changes (no automatic mutations; one change at t+4/9/14s)

| metric                          | polling   | websocket |
|---------------------------------|-----------|-----------|
| frames received                 |         9 |         5 |
| bytes received                  |   22.1 KB |   12.3 KB |
| displayed-data staleness median |   2047 ms |   0.58 ms |
| displayed-data staleness p95    |   3645 ms |    108 ms |

Delay from the change to it being visible client-side:

| poll cadence | change 1 | change 2 | change 3 | median | worst case |
|--------------|----------|----------|----------|--------|------------|
| 2 s          |  44.3 ms | 1038.8 ms |  50.5 ms |  50.5 ms | 2000 ms |
| 5 s          | 1038.2 ms | 1033.6 ms | 1045.6 ms | 1038 ms | 5000 ms |

Read: this is the real argument. The poller's delay is *luck* — it depends on
where the change falls inside the interval (44 ms vs 1039 ms for the same
2 s cadence), with a hard worst case of one full interval. The websocket is
0.3–0.6 ms, every time, and costs fewer bytes when changes are sparse.
Sparse changes + users watching is exactly the gantt/dashboard case.

### Dropped connection (websocket)

* Server closes all connections (`POST /chaos`): client notices in
  ~230 ms total (backoff attempt 1 = 250 ms ± 20 % jitter), resyncs, and the
  only visible effect is a slightly larger staleness sample (p95 65 ms).
* Server process killed for 5 s, then restarted (`bench_restart.py`):
  ```
  retry delays (ms)   [290, 405, 1043, 2166, 3936]
  drops detected      5
  outage window       7854 ms  (real outage ~5000 ms)
  ```
  It recovers with no duplicate/missed revisions — but it **overshoots the real
  outage by ~2.8 s** because backoff had already climbed to ~4 s. A UI wants
  either a lower cap (~2 s) or a "wake up now" nudge (window `online` event,
  desktop app focus) instead of trusting the backoff ladder.
* Nothing detects a *half-open* connection here except ping/pong
  (`ping_interval=5s`, `ping_timeout=5s`), i.e. up to 10 s to notice a silently
  dead link. Fine on a LAN, too slow for anything user-facing.

---

## What is hacky / not production-ready

1. **No authentication, no origin check, no TLS.** `/ws` accepts anyone.
   Production needs the same authz as `/api/tasks` (token on the handshake,
   verified before subscribe) and `wss://`.
2. **The payload contract is a stand-in** (see caveat above), not the real one.
3. **Naive push-on-every-change, no coalescing.** Measured 4.2x the poller's
   bandwidth under a 0.5 s change rate. Real implementation needs a debounce /
   per-client coalescing window (~100 ms) and ideally revision-based deltas
   instead of full snapshots.
4. **`Hub.broadcast` awaits every client sequentially, with no per-client
   queue and no backpressure.** One slow client stalls the fan-out for
   everyone; the "dead client" path is a bare `except Exception`. Needs a
   bounded per-connection queue + drop/close policy.
5. **The change feed is a simulator** (`Board.mutate()` on a timer, or
   `POST /mutate`). No DB, no real event bus, no multi-worker fanout.
6. **Single-process only.** With more than one API instance you need a shared
   bus (redis pub/sub, NATS, postgres LISTEN/NOTIFY) so a change on worker A
   reaches a client connected to worker B. Untested here.
7. **No state reconciliation.** On reconnect the client takes the next push as
   truth and ignores that it may have missed revisions; no `since=revision`
   replay, no gap detection. `revision` exists in the payload for exactly this
   and is unused.
8. **`POST /chaos` and `POST /mutate` have no auth** and are test-only
   endpoints living on the same HTTP server; a real deployment must not ship
   them.
9. **Threading model is a spike shortcut**: a stdlib `ThreadingHTTPServer` in a
   thread next to the asyncio loop, with cross-thread `threading.Event` flags.
   Production should run one async server (or the existing framework) and
   nothing else.
10. **No proxy/firewall validation.** Corporate proxies, HTTP/2-terminating
    LBs and idle-timeout policies are the classic websocket killers; nothing
    here was exercised behind one.
11. **Metrics are single-run, loopback, 25 tasks.** Not a load test: no
    concurrency sweep, no connection-count scaling, no memory numbers.

## What the next step would need (out of scope here)

* coalescing + delta payloads (kills the bandwidth regression in phase 1)
* auth on handshake, `wss://`, proxy/idle-timeout validation
* resync semantics: `{"op":"subscribe","since":<revision>}` with replay
* per-connection queue + backpressure limits, connection-count load test
* fallback path when websockets are blocked (polling must stay supported)
