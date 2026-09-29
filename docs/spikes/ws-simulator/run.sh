#!/usr/bin/env bash
# One-shot runner for the websocket spike. Creates the venv next to spike/,
# installs the single dependency, runs the benchmark and the outage test.
set -euo pipefail
cd "$(dirname "$0")/.."        # -> task workspace root

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
./.venv/bin/pip install --quiet --disable-pip-version-check websockets

cd spike
echo "===== bench (both phases) ====="
../.venv/bin/python bench.py "$@"
echo
echo "===== server outage / reconnect ====="
../.venv/bin/python bench_restart.py
