#!/usr/bin/env bash
# Real-gateway websocket upgrade probe (spike t_01745262).
# Builds a throwaway HERMES_HOME with the kanban-gantt plugin installed, launches a
# REAL `hermes dashboard` process (core mount path: include_router +
# _plugin_route_secret_scope + uvicorn), and lets ws_upgrade_probe.py drive it.
set -euo pipefail

REPO=/home/blavenie/git/hermes-kanban-gantt
SB=${1:-/home/blavenie/.hermes/cache/scratch/ws-gw-probe}
PORT=${2:-47119}

rm -rf "$SB"
mkdir -p "$SB/home/plugins/kanban-gantt/dashboard" "$SB/kh/kanban/boards/wsgw"

# --- plugin as a *user* plugin under the sandbox HERMES_HOME ------------------
cp "$REPO/plugin.yaml" "$SB/home/plugins/kanban-gantt/"
cp "$REPO/dashboard/plugin_api.py" "$REPO/dashboard/plugin_ws.py" "$REPO/dashboard/manifest.json" \
   "$SB/home/plugins/kanban-gantt/dashboard/"

cat > "$SB/home/config.yaml" <<'YAML'
plugins:
  enabled:
    - kanban-gantt
YAML

# --- a board with tasks (copy of the demo board, schema included) -------------
cp /home/blavenie/.hermes/kanban/boards/gantt-demo/kanban.db "$SB/kh/kanban/boards/wsgw/kanban.db"
printf '{"slug":"wsgw","name":"wsgw"}' > "$SB/kh/kanban/boards/wsgw/board.json"
printf 'wsgw\n' > "$SB/kh/kanban/current"

echo "SB=$SB PORT=$PORT"
