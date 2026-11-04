# Spike close-out — replace the polling loop with websockets (2026-11-04)

Card `t_e10ba956` (board `gantt-demo`), decomposed into four children and closed 2026-11-04.
Tree: plugin `1.9.0`, `main` @ `c14cbf5`, spike branch `spike/ws-proto-t7927023e` @ `c009daf`.
This page is the entry point for the cycle; it supersedes the 2026-10-26 close-out
(`websocket-spike-closeout.md`), which described tree `1.7.2` @ `0b486a0`.

## Answer

**GO — adopt the push as the supported default, keep the poll as a permanent fallback, and let a
hardening gate block the word "supported".**

The transport question is closed and did not need a new dependency: native Starlette/FastAPI
WebSocket on the plugin's own router (`/api/plugins/kanban-gantt/events`), which the tree has
shipped default-on since `1.3.2`. The win is not latency, it is the inverted cost model:

| | Poll today | Push |
|---|---|---|
| Server work | 8 SQL + a fresh `sqlite3.connect()` + full body, **per open window per 60 s** | **one read per change per board**, fanned to every subscriber |
| Freshness | 0–60 s (≈30 s average) | **p50 111 ms tuned / 506 ms at shipped knobs** |
| Bandwidth | 15.8 KB × 1,440/day ≈ **22.8 MB/day per window**, linear in windows | ~0.1–0.5 MB/day per idle window (heartbeats), independent of subscriber count |
| Infra | — | **none**: in-process route, no broker, no vendor, no second credential |
| Rollback | — | config flip: `KANBAN_GANTT_WS=0`, poll keeps working |

What is *not* ready is the operating story: the plugin emits no push counters and no logs, so a
broken push is indistinguishable from a quiet board. That is the gate (Phase 1, ~2–3 days).

## Evidence — the four children in this cycle

| Card | Doc / artifact | What it settles |
|---|---|---|
| `t_2967c8d2` | [`polling-audit.md`](polling-audit.md) (`dbd2bfa`) | 9 pollers incl. **P1** `/gantt` at 60 s (300 s while live), **P2** `/boards` at 5 min, **P3** server-side `PRAGMA data_version` probe at 250 ms/board; payload shape, 8-SQL cost, retry/blank-page failure path, metrics table, **12-item must-preserve list**. |
| `t_c8d00627` | Transport note (comment + attachment) | Native WS vs socket.io vs SSE against the verified stack (fastapi 0.133.1 / starlette 1.3.1 / uvicorn 0.41.0 / websockets 15.0.1, SDK door `ctx.socket` only, **no `EventSource`**). Native wins; socket.io runner-up. |
| `t_7927023e` | [`ws-proto/RESULTS.md`](ws-proto/RESULTS.md) + `results/ws-proto.json` (`7c6bccf`) | Standalone prototype measured on a sqlite copy of the live board: handshake p50 **1.87 ms** (vs one `GET /gantt` at **2.15 ms**), write→frame **505.7 / 549.2 ms** shipped and **110.7 / 160.4 ms** tuned, 20 subscribers ⇐ 1 read in **344.9 ms**, idle **1.0 %** CPU for 20 sockets, 1,967 writes → 18 frames at 2.6 % CPU, reconnect **401 ms**, proxy idle-kill 3 s/1 s heartbeat ⇒ **0** unwanted reconnects, 403 on absent/wrong credential, and the multi-instance failure (per-process version counters; N gateways = N reads per change). |
| `t_88a9b93c` | [`websocket-migration-decision.md`](websocket-migration-decision.md) (`c009daf`) | The decision itself: verdict, rejects (socket.io / SSE / managed realtime / status quo), 2-phase rollout with the 7-ticket Phase 1, infra notes (single process needs none; multi-gateway needs a `task_events` cursor), observability, rollback, 8 risks, 4 open questions, no-go triggers. |

Contract: [`websocket-protocol-design.md`](websocket-protocol-design.md) (R1–R20).

## Verified at close-out, on this host, not inherited from the children

Run today against the working tree at `c009daf` (`PYTHONPATH=$HOME/.hermes/hermes-agent`,
hermes-agent venv):

- `tests/ws_proof.py` — **13/13 PASS**. First frame is a full snapshot with the `/gantt` shape;
  5 writes ⇒ 5 frames with strictly increasing versions; change→frame **p50 406 ms / p95 412 ms**;
  a 10-write burst coalesced to **1 frame and 1 DB read**; heartbeats while idle; 2 subscribers ⇒
  **1 read per change**; reconnect re-snapshots; wrong/absent token rejected; loopback-only
  standalone fallback; slug traversal refused; **0 `GET /gantt`** during the socket run; and with
  `KANBAN_GANTT_WS=0`, `/events` is 404 while REST stays 200.
- `tests/ws_mount_gateway.py` — **4/4 PASS**. Gateway-style import registers `/events`; flag off ⇒
  route set identical to REST-only; module still importable with the flag off.
- `websocket_enabled()` with the env unset returns **True** (default-on confirmed at `1.9.0`, not
  just by reading the docstring — see the defect below).

## Defect found while verifying

`dashboard/plugin_api.py:1697-1699` still carries the prototype banner *"OFF unless
`KANBAN_GANTT_WS=1`"*, contradicting `websocket_enabled()` (`_env_flag(WS_ENABLE_ENV, True)`) and
`plugin_ws.py:13-14`. Behaviour is correct (default ON); the comment is stale and is exactly the
kind of thing a maintainer reads instead of the code. One-line fix, filed with Phase 1 rather than
done here.

## What this spike did *not* settle

1. **Observability** — no counters, no logs, no live/degraded badge. The gate.
2. **Multi-gateway** — per-process detection and per-process version counters; needs a DB cursor
   or backplane before a second gateway serves the same boards.
3. **Server-side watcher cost under load** — 250 ms/board probe measured only on `gantt-demo`
   (25 tasks), never with a dispatcher writing to a 239-task board.
4. **Real network and real proxy** — everything is loopback; the tunnel idle-kill was simulated
   with a custom proxy, not the user's actual path; no half-open detection, no sleeping laptop.
5. **Backpressure** — the drop/coalesce-then-`4408` policy has not met a client that stops reading.
6. **Field latency attribution** — `generated_at` is integer seconds, so server vs transport halves
   cannot be split from a frame (`frame_generated_at_age_ms` p50 534 ms vs write→frame 506 ms shows
   how coarse that is).
7. **Client close() on a stalled proxy** — the prototype's unbounded `close()` wedges reconnects;
   unverified whether the shipped `ws-core.ts` path has the same hazard.

## Triggers that flip the answer

A second gateway process on the same boards before the DB cursor exists; the desktop SDK dropping
`ctx.socket`; boards ceasing to be local SQLite; or the Phase 2 canary missing its exit criteria
(p95 < 2 s, frame < 600 KB, ≥ 90 % writer throughput).

## Follow-up work

Phase 1 (blocking "supported"), per `websocket-migration-decision.md` §3:

1. Push counters + user-visible live/degraded badge with `en`/`fr` keys.
2. One heartbeat source of truth (server announces its period; kill the hand-tuned 20 s ↔ 50 s ratio).
3. README for `KANBAN_GANTT_WS` / `KANBAN_GANTT_WS_*` / the client `ws` storage flag.
4. Tests: failed handshake falls back to the poll (never a blank page), gateway restart picked up,
   heartbeat constants cannot drift; fold `ws_proof.py` + `ws_mount_gateway.py` into `npm test`.
5. Measure watcher cost on a dispatcher-driven board and push on the 239-task `sumaris` board.
6. Fix the stale banner at `dashboard/plugin_api.py:1697-1699`.
