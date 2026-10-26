# Go/no-go — migrating the gantt snapshot loop to the websocket push

Card `t_9468d331` (board `gantt-demo`), 2026-10-26. Tree: plugin `1.7.2`, `main` @ `dd3fb48`.
Inputs: `polling-loop-audit.md` (what runs today), `websocket-options.md` (transport survey and
pick), `websocket-poc.md` (measured PoC). Contract: `websocket-protocol-design.md` (R1–R20).
Backlog: `docs/TODO.md` → *WebSocket push*.

> **Read the verdict in context.** The transport is not a candidate any more: the `/events`
> route shipped in `1.3.2` and is **on by default** since then (`KANBAN_GANTT_WS=0` is the
> off-switch, `dashboard/plugin_ws.py:163-172`). So "migrate" below means *finish and own* the
> migration already in the tree — promote it from "default-on prototype" to "supported default" —
> not "start one". The earlier `websocket-recommendation.md` (card `t_01745262`) is the same call
> taken in September; this file re-derives it from the 2026-10-26 measurements and replaces its
> status notes (its open defect "client discards a restarted process's versions" is fixed at
> `dd3fb48`, `src/core/ws-core.ts:70-80`).

## 1. Recommendation — **MIGRATE** (finish it), keep the poll as the permanent fallback

Push stays on by default for loopback/token desktops; `GET /gantt` stays as the safety net at
60 s whenever the socket is not `live`, demoted to 300 s while it is.

**Single strongest reason:** the cost model inverts at zero infrastructure cost. Today every open
window pays a full snapshot plus a fresh SQLite connection every 60 s (12 770 B, `_read_gantt`
per call, `polling-loop-audit.md` §2.3–§4); the push pays **one DB read per change per board**,
broadcast to every window, and delivers it in **~0.5 s** instead of up to 60 s — measured on the
shipped route, with no new process, dependency, vendor or credential (`websocket-poc.md` §1–§4,
`websocket-options.md` §4).

What is *not* ready is the operating story, and that is the whole remaining scope: the plugin
emits no counters and no logs, so a broken push is indistinguishable from a quiet board.

## 2. Evidence

### 2.1 What the poll costs now

| | Value | Source |
|---|---|---|
| Cadence | fixed 60 s; 300 s while the socket is `live` | `src/main.ts:3788-3792` |
| Payload | 12 770 B (20 tasks, live board); **441 KB** on a 2 000-task board | audit §2.3 |
| Volume | 1 440 snapshots/day per open window ≈ 18.4 MB/day (635 MB/day at 2 000 tasks) | audit §4 |
| Server cost | HTTP p50 1.27 ms / p99 1.96 ms (`gantt-demo`); 22.9 ms at 2 000 tasks | audit §2.3 |
| Failure behaviour | react-query 3 tries (1/2/4 s), then the interval keeps firing; a hard failure replaces the board with `ErrorState`; **no server-side log or metric anywhere** | audit §3 |
| Scaling | one request per window per minute, no server-side dedupe or cache; `?board=all` re-walks the boards root | audit §4 |

### 2.2 What the PoC measured (shipped route, loopback, 7 492 B snapshots)

| Dimension | Result |
|---|---|
| Event → client | **p50 499 ms / p95 540 ms** at shipped knobs (250 ms poll + 300 ms debounce); **147 / 153 ms** tuned (50/100) |
| Throughput | 352.6 writes/s ⇒ **2.0 frames/s** (178 writes/frame, 14.9 KB/s); tuned knobs reach 6.6 frames/s but cut writer throughput to 205/s |
| Ceiling | **37.6 frames/s** = one `_read_gantt` per frame; the loop self-limits at ~1/read-cost |
| Fan-out | 20 subscribers, 112.8 client-msgs/s, **one DB read per change**, identical versions everywhere |
| Footprint | **≈207 KB and 1.08 fd per client**; RSS 76.5 → 86.9 MB from 0 to 50 clients; one thread for the stream |
| Recovery | RST: reconnect 46 ms, version continues. 3 s restart: 0.4–1.4 s after the server is back, first frame a full snapshot, version back to 1 |
| Auth | token handshake accepted; missing/wrong token refused with 1008 before `accept()` |

### 2.3 Operational delta

| | Poll today | After the migration |
|---|---|---|
| New infra | — | **none**: in-process Starlette route, host CPython, no broker, no worker, no vendor, no second credential |
| Data leaving the host | — | none (loopback/self-hosted only) |
| Monitoring | HTTP status/duration/bytes are visible to any proxy or access log — but the plugin itself logs nothing | **regression**: one long connection, so connections/frames/drops/reconnects must be counted by the plugin. Not implemented yet (TODO → *Observability*) |
| On-call | a failed poll is a 4xx/5xx or a visible error page | a failed push is **silent**: the poll underneath still answers, so the symptom is "slow", not "down". Reconnect churn is the only signal |
| Blast radius | one request | one board stream + a 0.25 s/watcher per subscribed board (cost not yet measured with a dispatcher running) |

## 3. Migration path (phased, behind the existing flag, dual-run, reversible)

**Phase 0 — done at `dd3fb48`.** Transport shipped and default-on; off-switch `KANBAN_GANTT_WS=0`
and client storage `ws='0'`; poll kept unconditionally; `HERMES_KANBAN_DB` pinning trap closed;
quiet teardown on last disconnect; restarted-process versions accepted as a new baseline
(`src/core/ws-core.ts:70-80`); `all`/`*` scopes excluded from push (`canPush`, `src/core/ws-core.ts:93`).

**Phase 1 — hardening gate (before calling it supported), ~2–3 days.**
1. Observability: counters for live connections/board, frames sent, DB reads, handshake rejects by
   reason, 4408 closes, resyncs — plus a user-visible *live / degraded* badge with `en` + `fr` keys.
2. One source of truth for the heartbeat: server announces its period, client derives the idle
   window (today a 20 s ↔ 50 s ratio kept in two constants by hand).
3. README: `KANBAN_GANTT_WS` (default on), the `KANBAN_GANTT_WS_*` knobs, the client `ws` flag.
4. Tests: gateway restart picked up by a connected page, failed handshake falls back to the poll
   without a blank page, the two heartbeat constants cannot drift — and repair `tests/ws_proof.py`
   (card `t_e11bdd50`: stale fixture schema + unregistered board) so the 13 contract checks run again.

**Phase 2 — dual run (1–2 weeks, team desktops).** Push on, poll kept at 300 s while live. Measure
what the PoC could not, on the real 239-task `sumaris` board **with the dispatcher running**:
frame size, push p95, watcher cost per board, reconnect churn per window per day, writer
throughput against the polling baseline. Exit criteria to keep the default: p95 < 2 s, frame
< 600 KB, writer throughput ≥ 90 % of baseline, no unbounded reconnect loop.

**Phase 3 — close the knobs.** Decide the fallback cadence while `live` (300 s vs 60 s as a
missed-frame net) and the data-heartbeat period on non-loopback binds, from Phase 2 data. Remove
the last "prototype" wording: `plugin_ws.py` still calls itself a prototype and
`plugin_api.py:1640-1642` still says "OFF unless `KANBAN_GANTT_WS=1`", which is the opposite of
`websocket_enabled()`.

**Phase 4 — conditional, not part of this migration.** Multi-process/replay (`task_events` cursor),
ticket auth for OAuth remotes, `all`-boards fan-in over the socket. Each is a separate card and
each is gated on a trigger in §5.

**Rollback.** No schema change, no data migration, nothing to unwind: set `KANBAN_GANTT_WS=0` on
the gateway (route not registered, `/events` 404, REST untouched) or `ws='0'` per client. A
running page returns to the 60 s poll on its own — the client falls back after 5 s without a first
frame or 50 s of silence, and the SDK gives up after 5 consecutive refused dials. Worst case the
window is one poll interval stale; there is no state to reconcile.

## 4. Open questions and residual risks the spike did not settle

1. **No proxy in the path.** Non-loopback gateways sit behind a Cloudflare Tunnel (~100 s idle);
   a proxy stricter than the 20 s ping, or one that buffers frames, appears only as reconnect
   churn. Untested, not reproducible on this host.
2. **Everything is loopback.** No real-network latency, no mobile/sleeping-laptop churn,
   no half-open detection test (needs packet black-holing; the shipped 20 s data heartbeat is the
   only liveness probe on loopback, where uvicorn's ping is disabled).
3. **Backpressure unexercised.** The drop-and-coalesce-then-close-`4408` policy has never been
   driven by a client that stops reading.
4. **Single process only.** Per-process version counters and an in-process hub are correct for one
   gateway and wrong the moment a second one serves the same boards. Also no replay across a gap:
   a restart is indistinguishable from a resync (harmless, because the first frame is a snapshot).
5. **`_read_gantt` cost is not settled.** The audit measures 0.37 ms in-process (5 calls) while the
   survey measures 11.5 ms p50 with 11.3 ms in `sqlite3.connect()` alone, and the 37.6 frames/s
   ceiling rests on that figure. Re-measure before tuning anything; a kept-open read connection may
   be the cheapest remaining win.
6. **Field latency is unobservable as shipped.** `generated_at` is integer seconds, so server-side
   and transport halves cannot be split from a frame. Add `generated_at_ms` or a plugin counter.
7. **Recovery timing has a tail.** Full-jitter overshoot produced a 6.2 s sleep *after* the server
   was back (best run 0.4 s), and the SDK's 5-refused-dial budget turns any outage longer than
   ~10 s into a poll fallback — acceptable, but it means "fix deployed" ≠ "users see it".
8. **Load assumptions.** The win scales with open windows per gateway; the real client count is not
   known. The 239-task board and the watcher-with-dispatcher cost are unmeasured (§3 Phase 2).
9. **Error UX is an unmade decision.** The poll blanks the page on a hard failure; a push that keeps
   the last good board visible is a behaviour change (arguably an improvement) and must be stated.
10. **OAuth remotes get nothing.** `ctx.socket` resolves to a no-op there; that is an upstream SDK
    gap (tickets), with the poll as the mitigation.

## 5. What would change this decision

- A second gateway process serving the same boards → backplane or `task_events` cursor (§4.4).
- Phase 2 showing p95 > 2 s, frames ≥ 600 KB, or watcher cost above the poll's own per-snapshot
  cost → push becomes an accelerator only, and SSE (the runner-up in `websocket-options.md` §4) is
  revisited for its `Last-Event-ID` replay.
- The desktop SDK losing or narrowing `ctx.socket` → the migration has no client door and reverts to
  polling until a core transport exists.
- Boards ceasing to be local SQLite (watcher sees nothing), or replay-exact delivery becoming a hard
  requirement (→ SSE or a DB-backed cursor).
