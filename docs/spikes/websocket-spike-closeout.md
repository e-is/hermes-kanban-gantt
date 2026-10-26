# Spike close-out — replace the polling loop with websockets

Card `t_99712c4d` (board `gantt-demo`), closed 2026-10-26. Tree `main` @ `0b486a0`, plugin `1.7.2`.
This page is the entry point; the evidence lives in the four docs below.

## Answer

**MIGRATE — but the migration is mostly done, and what is left is the operating story, not the transport.**
The `/events` websocket route already ships **on by default** since `1.3.2`; `GET /gantt` stays as the
permanent fallback (60 s when the socket is not live, 300 s while it is).

The single strongest reason is the inverted cost model at zero new infrastructure:

| | Poll today | Push |
|---|---|---|
| Server work | full snapshot + a fresh `sqlite3.connect()` per open window per 60 s | **one DB read per change per board**, fanned out to every window |
| Freshness | up to 60 s | **~0.5 s** (p50 499 ms at shipped knobs, 147 ms tuned) |
| Infra | — | none: in-process Starlette route, no broker, no vendor, no second credential |

What is *not* ready: the plugin emits no counters and no logs, so a broken push is indistinguishable
from a quiet board ("slow", not "down"). That — plus README, tests, and the duplicated heartbeat
constants — is Phase 1, ~2–3 days, in `websocket-migration-recommendation.md` §3.

## The evidence

| Doc | What it settles |
|---|---|
| [`polling-loop-audit.md`](polling-loop-audit.md) | What runs today: the 60 s fetch, the five reads behind it, 12 770 B per snapshot (441 KB at 2 000 tasks), 1 440 snapshots/day/window, the react-query retry and blank-page failure mode, and the nine constraints a socket must preserve — with file:line refs. |
| [`websocket-options.md`](websocket-options.md) | Four transports compared (native WS on the plugin's own router / socket.io / managed realtime / SSE) on lifecycle, reconnect, handshake auth, fan-out, delivery, ops cost, maturity; pick + three rejects. SSE is the only serious runner-up. |
| [`websocket-poc.md`](websocket-poc.md) + `ws-poc/`, `results/ws-poc.*` | The shipped route measured on loopback: latency, throughput (352 writes/s ⇒ 2.0 frames/s; 37.6 frames/s ceiling), fan-out (20 subscribers ⇒ 1 read per change), footprint (~207 KB, 1.08 fd per client), recovery (RST 46 ms; 3 s restart 0.4–1.4 s), auth refusals. |
| [`websocket-migration-recommendation.md`](websocket-migration-recommendation.md) | The go/no-go itself: verdict, operational delta, the 5-phase rollout with config-only rollback (`KANBAN_GANTT_WS=0`), ten open questions, and the triggers that would flip the decision. |

Contract: [`websocket-protocol-design.md`](websocket-protocol-design.md) (R1–R20).
Superseded on status: [`websocket-recommendation.md`](websocket-recommendation.md) (September) — same
verdict, but its open defect "a client discards a restarted process's versions" is fixed at `dd3fb48`
(`src/core/ws-core.ts:70-80`).

## Verified at close-out (not inherited from the children)

Run on this host against `main` @ `0b486a0`, after the `tests/ws_proof.py` repair (card `t_e11bdd50`):

- `tests/ws_proof.py` — **13/13 contract checks pass**: full-snapshot first frame, one frame per write
  with strictly increasing versions, p50 402 ms / p95 404 ms change→frame, 10-write burst coalesced to
  1 frame with 1 DB read, two subscribers ⇒ one read, heartbeats idle, reconnect re-snapshots, token
  refusals, slug traversal refused, **zero HTTP `/gantt` requests for the whole run**, and
  `KANBAN_GANTT_WS=0` ⇒ `/events` 404 with REST intact. Log: `results/ws-proof.log`.
- `tests/run_tests.sh` — 60 backend tests pass; `node --test` 154 pass; UI render 81 checks, hook order 23.

That closes the "tests are stale" blocker the PoC reported and re-establishes the reversibility claim
on a live route rather than by reading code.

## What the spike did *not* settle

Carried from the PoC and the recommendation §4, in the order they should be retired:

1. **Observability is absent** — the one item that makes this a migration rather than a tweak (§3 Phase 1).
2. **No proxy in the path** — a Cloudflare-Tunnel-style idle timeout or a buffering proxy shows up only
   as reconnect churn; untested and not reproducible on this host.
3. **Everything is loopback** — no real-network latency, no sleeping-laptop churn, no half-open
   detection (needs packet black-holing).
4. **Backpressure unexercised** — the drop/coalesce-then-`4408` policy has never met a client that stops reading.
5. **Single process only** — per-process versions and an in-process hub are wrong the moment a second
   gateway serves the same boards. No replay across a gap.
6. **`_read_gantt` cost is unresolved** — 0.37 ms in-process (audit) vs 11.5 ms p50 with 11.3 ms in
   `sqlite3.connect()` (survey), and the 37.6 frames/s ceiling rests on that figure. Re-measure before tuning.
7. **Field latency is unobservable as shipped** — `generated_at` is integer seconds, so server and
   transport halves cannot be split from a frame.
8. **The 239-task `sumaris` board with a dispatcher running is unmeasured** — that is Phase 2's job,
   with p95 < 2 s / frame < 600 KB / writer throughput ≥ 90 % of baseline as exit criteria.

## Triggers that would change the answer

Second gateway process on the same boards → backplane or `task_events` cursor. Phase 2 failing its exit
criteria → push becomes an accelerator only and SSE is revisited for `Last-Event-ID` replay. The desktop
SDK losing `ctx.socket` → no client door, revert to polling. Boards ceasing to be local SQLite → the
watcher sees nothing.

## Follow-up cards

- `t_e11bdd50` — repair `tests/ws_proof.py` (closed: fixture built through the domain layer, 13/13 green).
- Phase 1 hardening (observability counters + live/degraded badge with `en`/`fr` keys, single heartbeat
  source of truth, README, the three missing tests) — not yet filed on this board.
