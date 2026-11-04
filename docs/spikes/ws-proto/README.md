# ws-proto — throwaway websocket prototype

**SPIKE / THROWAWAY.** Branch `spike/ws-proto-t7927023e`, card `t_7927023e`. Nothing here is
imported by the plugin, no production route or file is touched, and this branch must not be merged.
Delete the directory and the plugin is exactly as it was.

Measured results and the comparison with the 60 s poll: **`RESULTS.md`**. Raw data:
`docs/spikes/results/ws-proto.json`.

| file | what it does |
|---|---|
| `server.py` | Boots a FastAPI app carrying the plugin's **real** `GET /gantt` (`dashboard/plugin_api.py`) against a staging root, plus the prototype `WS /events?board=` — native Starlette websocket, first frame = full snapshot, monotonic per-board version, 4 Hz `PRAGMA data_version` + `stat()` change probe shared per board, drop-and-coalesce per subscriber, data-frame heartbeat, in-handler fail-closed auth. Also exposes `/_stats` (counters) and `/_kick` (force-drop every subscriber). The shipped `/events` is disabled at import (`KANBAN_GANTT_WS=0`) so the app has exactly one websocket route: this one. |
| `client.py` | SDK-door-shaped consumer: token on the handshake, no `onOpen` (first frame is the connect signal), first-frame timeout, idle timeout = 2.5 × heartbeat, full-jitter backoff, dial cap, bounded close + transport abort on a stalled peer. Usable as a CLI. |
| `bench.py` | The harness. Copies the live board with sqlite online backup per section, spawns real server processes, drives out-of-process writes, and measures baseline, setup, latency (two configs), throughput, fan-out, forced disconnect, RST/stall blips, auth, multi-instance, idle-kill proxy. |

## Run

Requires the hermes-agent venv (fastapi, uvicorn, websockets, hermes_cli) and `PYTHONPATH` pointing
at that checkout:

```bash
cd ~/git/hermes-kanban-gantt

# all sections (~110 s), writes docs/spikes/results/ws-proto.json
PYTHONPATH=$HOME/.hermes/hermes-agent \
  ~/.hermes/hermes-agent/venv/bin/python docs/spikes/ws-proto/bench.py

# one section
PYTHONPATH=$HOME/.hermes/hermes-agent \
  ~/.hermes/hermes-agent/venv/bin/python docs/spikes/ws-proto/bench.py --only latency --no-save
# sections: baseline setup latency throughput fanout kick blip auth multi_instance proxy_idle
```

The harness refuses to write to the live board: every section works on a fresh
`/tmp/kg-wsproto/…/kanban/boards/gantt-demo/kanban.db` copy. Do not point `--root` at
`~/.hermes`.

## By hand

```bash
# 1) server on :8891 against a staging root, token required
PYTHONPATH=$HOME/.hermes/hermes-agent \
  ~/.hermes/hermes-agent/venv/bin/python docs/spikes/ws-proto/server.py \
    --root /tmp/kg-wsproto/manual --board gantt-demo --port 8891 --token poc

# 2) client: connect, receive, reconnect on its own
PYTHONPATH=$HOME/.hermes/hermes-agent \
  ~/.hermes/hermes-agent/venv/bin/python docs/spikes/ws-proto/client.py \
    --url 'ws://127.0.0.1:8891/events?board=gantt-demo' --token poc --duration 20

# 3) change the board from a third shell (staging copy!) and watch a frame arrive
```

## Known limits of the prototype

- Query-string token auth (spike only — production uses core's ticket/session gate).
- One process, one loopback bind, no TLS, no proxy in front unless `bench.py`'s relay is used.
- No replay: a missed frame is repaired by the next reconnect's full snapshot, not by a cursor.
- Version counters are per process, so two instances serving one DB can emit the same version —
  the multi-instance section of `RESULTS.md` documents the consequence.
