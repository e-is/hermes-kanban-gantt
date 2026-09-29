"""Standalone kanban-gantt backend for the polling baseline measurements.

Loads the plugin's own router module straight out of the git checkout (no copy),
builds the same FastAPI app the dev/remote mode builds (`create_app`), and serves
it on 127.0.0.1 so the harness measures the real code path.

Env:
  GANTT_PLUGIN_API   path to dashboard/plugin_api.py (required)
  PORT               listen port (default 8791)
  HERMES_KANBAN_HOME boards root override (default: the real profile home)
  KEEP_PIN           if set, do NOT strip HERMES_KANBAN_DB/BOARD (pinning repro)
"""
import importlib.util
import os
import sys

import uvicorn

SRC = os.environ["GANTT_PLUGIN_API"]
spec = importlib.util.spec_from_file_location("gantt_plugin_api", SRC)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

# A worker env pins one board DB (HERMES_KANBAN_DB) for agents; the baseline must
# not inherit it, or every slug resolves to the pinned board (see §5.1 of the doc).
if not os.environ.get("KEEP_PIN"):
    for var in ("HERMES_KANBAN_DB", "HERMES_KANBAN_BOARD"):
        os.environ.pop(var, None)

app = mod.create_app(allow_cors=False)
sys.stderr.write(f"serving {SRC} on 127.0.0.1:{os.environ.get('PORT', '8791')}\n")
uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8791")),
            log_level="warning")
