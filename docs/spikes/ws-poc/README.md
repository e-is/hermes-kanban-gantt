# Websocket PoC (throwaway spike) — `docs/spikes/ws-poc/`

**SPIKE / THROWAWAY.** Nothing here is imported by the plugin, no route is added, no
production file is touched. Delete the directory and nothing changes. The server it boots is
the plugin's own `create_app()` with `dashboard/plugin_ws.py`'s real `/events` route, so what
is measured is the shipped transport, not a stand-in.

Three files:

| file | what it does |
|---|---|
| `poc_server.py` | Boots the real FastAPI app on loopback against a throwaway board created through `hermes_cli.kanban_db` (real schema, real payload). `KANBAN_GANTT_WS=1` + `KANBAN_GANTT_WS_TOKEN=<token>`: the same env-only switch the gateway reads. |
| `poc_client.py` | Minimal client that mimics the desktop SDK door: token on the handshake, snapshot-per-connection, data-frame heartbeat, auto-reconnect with full jitter (500 ms → 30 s), gives up after 5 refused dials. |
| `poc_bench.py` | Spawns servers, drives real out-of-process writes into the board DB, and measures latency, throughput, fan-out, memory per connection, RST drop and server restart. |

## Run

Requires the hermes-agent venv (it already has `fastapi`, `uvicorn`, `websockets` and
`hermes_cli`) and `PYTHONPATH` pointing at the hermes-agent checkout:

```bash
cd ~/git/hermes-kanban-gantt

# full suite, ~3 min: auth, latency (2 configs), throughput (3), fan-out,
# memory, RST drop, SIGTERM restart, SIGKILL restart
PYTHONPATH=$HOME/.hermes/hermes-agent \
  ~/.hermes/hermes-agent/venv/bin/python docs/spikes/ws-poc/poc_bench.py

# one section at a time (auth | latency_default | latency_tuned |
# throughput_default | throughput_tuned | frame_ceiling | fanout_20 |
# memory | drop_rst | restart_term | restart_kill)
PYTHONPATH=$HOME/.hermes/hermes-agent \
  ~/.hermes/hermes-agent/venv/bin/python docs/spikes/ws-poc/poc_bench.py --only drop_rst

# print only, do not overwrite the recorded results
… --no-save
```

Results land in `docs/spikes/results/ws-poc.json` (+ `.log`); the same JSON is printed.

## Run it by hand (two terminals)

```bash
# 1) server: 20 seeded tasks, ws on :8791, token "poc-token"
PYTHONPATH=$HOME/.hermes/hermes-agent \
  ~/.hermes/hermes-agent/venv/bin/python docs/spikes/ws-poc/poc_server.py \
    --port 8791 --tasks 20 --token poc-token
# prints {"ready": true, ..., "db": "/tmp/kg-ws-poc-xxx/kanban/boards/ws-poc/kanban.db"}

# 2) client: connect, receive, reconnect on its own
PYTHONPATH=$HOME/.hermes/hermes-agent \
  ~/.hermes/hermes-agent/venv/bin/python docs/spikes/ws-poc/poc_client.py \
    --url 'ws://127.0.0.1:8791/events?board=ws-poc' --token poc-token --duration 20

# 3) make a change from a third shell — the client must show a frame within ~0.5 s.
#    (No sqlite3 CLI needed: this host does not have one.)
DB=/tmp/kg-ws-poc-manual/kanban/boards/ws-poc/kanban.db   # the path the server printed
~/.hermes/hermes-agent/venv/bin/python - "$DB" <<'PY'
import sqlite3, sys, time
conn = sqlite3.connect(sys.argv[1])
conn.execute("INSERT INTO tasks (id,title,status,created_by,priority,created_at) "
             "VALUES (?,?,?,?,?,?)",
             (f"t_manual_{int(time.time())}", "manual write", "ready", "me", 0, int(time.time())))
conn.commit()
print("wrote one task")
PY
```

Measurements and what they mean are in `docs/spikes/websocket-poc.md`.
