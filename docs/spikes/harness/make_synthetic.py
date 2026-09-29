"""Build a synthetic board with the real kanban schema, for scaling numbers.

Schema is copied verbatim from a real board DB, so the numbers are comparable
with the small real boards. Usage:

  SYNTH_ROOT=$HOME/.hermes/cache/scratch/gantt-synth python make_synthetic.py
  # creates <SYNTH_ROOT>/kanban/boards/<SLUG>/kanban.db
"""
import os
import sqlite3
import sys
import time
from pathlib import Path

REAL = Path(os.environ.get(
    "REAL_BOARD_DB", str(Path.home() / ".hermes/kanban/boards/gantt-demo/kanban.db")))
ROOT = Path(os.environ["SYNTH_ROOT"])          # hermes home: boards live under it
N_TASKS = int(os.environ.get("N_TASKS", "1000"))
N_LINKS = int(os.environ.get("N_LINKS", "1000"))
N_RUNS = int(os.environ.get("N_RUNS", "500"))
SLUG = os.environ.get("SYNTH_SLUG", "big")

src = sqlite3.connect(f"file:{REAL}?mode=ro", uri=True)
ddl = [r[0] for r in src.execute(
    "select sql from sqlite_master where sql is not null and name not like 'sqlite_%'")]
src.close()

out_dir = ROOT / "kanban" / "boards" / SLUG
out_dir.mkdir(parents=True, exist_ok=True)
db = out_dir / "kanban.db"
if db.exists():
    db.unlink()

con = sqlite3.connect(db)
for stmt in ddl:
    try:
        con.execute(stmt)
    except sqlite3.Error as exc:  # pragma: no cover
        print("ddl skipped:", exc, file=sys.stderr)

now = int(time.time())
statuses = ["todo", "ready", "running", "blocked", "done", "review", "triage"]
tasks = []
for i in range(N_TASKS):
    tid = f"t_{i:08d}"
    status = statuses[i % len(statuses)]
    label = f"[PROJET #{i % 12}] " if i % 3 == 0 else ""
    started = now - 3600 if status in ("running", "done", "review") else None
    done = now - 600 if status == "done" else None
    tasks.append((tid, f"{label}task {i} — synthetic card for the baseline spike",
                  status, "default", i % 5, now - 86400 + i, started, done))
con.executemany(
    "insert into tasks (id, title, status, assignee, priority, created_at,"
    " started_at, completed_at, body, created_by, block_kind, goal_mode,"
    " block_recurrences, consecutive_failures, workspace_kind)"
    " values (?,?,?,?,?,?,?,?, 'body text', 'spike', null, 0, 0, 0, 'scratch')",
    tasks)

links = []
for i in range(min(N_LINKS, N_TASKS - 1)):
    child = f"t_{(i + 1):08d}"
    parent = f"t_{i % max(1, N_TASKS // 4):08d}"
    if parent != child:
        links.append((parent, child))
con.executemany("insert or ignore into task_links (parent_id, child_id) values (?,?)", links)

runs = []
for i in range(min(N_RUNS, N_TASKS)):
    runs.append((f"t_{i:08d}", "default", "done", now - 7200 + i, now - 7000 + i,
                 "completed", "run summary", '{"changed_files": []}'))
con.executemany(
    "insert into task_runs (task_id, profile, status, started_at, ended_at,"
    " outcome, summary, metadata) values (?,?,?,?,?,?,?,?)", runs)
con.commit()
n_t = con.execute("select count(*) from tasks").fetchone()[0]
n_l = con.execute("select count(*) from task_links").fetchone()[0]
n_r = con.execute("select count(*) from task_runs").fetchone()[0]
con.close()
print(f"synthetic board {SLUG}: {n_t} tasks, {n_l} links, {n_r} runs -> {db}"
      f" ({db.stat().st_size} bytes)")
