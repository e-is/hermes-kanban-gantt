#!/bin/bash
# Run the kanban-gantt backend tests in an ISOLATED uv venv (pytest not
# installable into the system hermes venv, which is root-owned).
# The venv gets pytest + the same fastapi/httpx stack; hermes_cli comes from
# the hermes-agent checkout via PYTHONPATH.
#
# hermes_cli keeps gaining imports from the wider agent tree (e.g.
# `hermes_cli.worktree_ops` -> `utils` -> ruamel.yaml), so the dependency set
# below is re-checked on every run and topped up when the venv is missing one.
#
# Paths (override via env):
#   HERMES_AGENT_HOME — hermes-agent checkout containing hermes_cli/
#                       (default: try ~/.hermes/hermes-agent, then
#                        /opt/data/git/hermes-agent — the container path)
#   PYTEST_PYTHON     — python to run pytest with (skips the venv entirely)
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for _cand in "${HERMES_AGENT_HOME:-}" "$HOME/.hermes/hermes-agent" /opt/data/git/hermes-agent; do
  if [ -n "$_cand" ] && [ -d "$_cand/hermes_cli" ]; then
    HERMES_AGENT_HOME="$_cand"
    break
  fi
done
if [ ! -d "$HERMES_AGENT_HOME/hermes_cli" ]; then
  echo "ERROR: hermes_cli not found in $HERMES_AGENT_HOME" >&2
  echo "Set HERMES_AGENT_HOME to your hermes-agent checkout." >&2
  exit 1
fi

# Every import the backend test path pulls in. Kept in one place so a new
# hermes_cli import shows up as a missing dep here instead of a stack trace.
# Importable modules to verify (what the tests actually import) and the
# distribution names that provide them (uv resolves the latter).
MODULES="pytest fastapi httpx uvicorn pydantic yaml ruamel.yaml"
PKGS="pytest fastapi httpx uvicorn pydantic pyyaml ruamel.yaml"
missing() {
  "$1" - "$MODULES" <<'PY' >/dev/null 2>&1
import importlib, sys
for mod in sys.argv[1].split():
    importlib.import_module(mod)
PY
}

if [ -n "${PYTEST_PYTHON:-}" ]; then
  PY="$PYTEST_PYTHON"
else
  VENV="${KG_TEST_VENV:-/tmp/kg-test-venv}"
  if [ ! -x "$VENV/bin/python" ]; then
    uv venv "$VENV" --python 3.13
  fi
  PY="$VENV/bin/python"
  if ! missing "$PY"; then
    # --quiet: uv prints a resolution summary per run otherwise.
    uv pip install --quiet --python "$PY" $PKGS || true
  fi
fi

# Last resort when the venv cannot reach the network: borrow the packages the
# hermes-agent venv already has (it ships the agent's runtime deps). Pure-python
# deps (ruamel.yaml) import across interpreter versions; anything compiled will
# fail the check below and be reported instead of faked.
if ! missing "$PY"; then
  _agent_site="$(ls -d "$HERMES_AGENT_HOME"/venv/lib/python*/site-packages 2>/dev/null | head -1)"
  if [ -n "$_agent_site" ]; then
    echo "note: borrowing missing deps from $_agent_site" >&2
    export PYTHONPATH="$HERMES_AGENT_HOME:$_agent_site:${PYTHONPATH:-}"
  fi
fi

if ! missing "$PY"; then
  echo "ERROR: test interpreter $PY is missing some of: $MODULES" >&2
  echo "Retry with network (uv pip install), or set PYTEST_PYTHON to a python that has them." >&2
  exit 1
fi

export PYTHONPATH="${PYTHONPATH:-$HERMES_AGENT_HOME}"
unset HERMES_DELEGATED_CHILD_CONTEXT
unset HERMES_KANBAN_DB
unset HERMES_KANBAN_BOARD
cd "$SCRIPT_DIR"
exec "$PY" -m pytest test_plugin_api.py "$@"
