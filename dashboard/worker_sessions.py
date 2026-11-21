"""Worker transcripts, and what they cost — the link kanban does not store.

`task_runs` carries no session id, and `tasks.session_id` is the session that FILED the
task, not the worker's. The link does exist, though, one database over: a kanban worker
runs with its cwd inside ``<hermes_home>/kanban/boards/<board>/workspaces/<task_id>``,
and ``sessions.cwd`` keeps it. So run → session is an exact join on the workspace path —
not the time-window heuristic the design note for #11 settled for, and not a trailer
scraped out of a log that usually has none.

Sessions from before the workspaces convention (cwd = the project checkout) carry no task
id at all. They are reported as unattributed rather than guessed: a cost next to the wrong
card is worse than no cost.
"""

from __future__ import annotations

import os
import re
import sqlite3
from pathlib import Path
from typing import Any, Iterable, Optional

#: ``…/boards/<slug>/workspaces/<task_id>`` — the last segment is the task.
_WORKSPACE_TASK = re.compile(r"[/\\]workspaces[/\\]([^/\\]+)$")

#: The narrowest read that answers the question. `sessions` also carries the system
#: prompt and the whole routing state; `select *` on it is 0.28 ms against 0.02 ms, and
#: most of that weight is text this module never looks at.
_COST_SQL = (
    "SELECT id, cwd, profile_name, title, started_at, ended_at, message_count, "
    "estimated_cost_usd, actual_cost_usd, cost_status "
    "FROM sessions WHERE cwd LIKE ? OR cwd LIKE ?"
)


def state_db_path() -> Path:
    """The state database beside the profile — the one `hermes sessions` reads."""
    home = (os.environ.get("HERMES_HOME") or "").strip()
    if home:
        return Path(home) / "state.db"
    try:
        import hermes_state  # the sanctioned surface toward the state database

        return Path(hermes_state.DEFAULT_DB_PATH)
    except Exception:  # pragma: no cover - only when the module moves
        import hermes_state as _hs  # same module, narrower surface

        return Path(_hs.get_hermes_home()) / "state.db"


def _connect(db: Optional[Path] = None) -> sqlite3.Connection:
    """Read-only, and never created: the state database belongs to another writer.

    ``mode=ro`` means a missing file is an error rather than a fresh empty database —
    which is what a read-only reader wants, and what keeps a sandbox test honest.
    """
    path = Path(db or state_db_path())
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5.0)
    conn.row_factory = sqlite3.Row
    return conn


def task_of_cwd(cwd: Optional[str]) -> Optional[str]:
    if not cwd:
        return None
    match = _WORKSPACE_TASK.search(cwd)
    return match.group(1) if match else None


def cost_of_row(row: sqlite3.Row) -> tuple[Optional[float], str]:
    """(cost, status) for one session.

    An actual figure wins over an estimate, and the two are never added together: a
    session that has been billed is a fact, one that has not is a projection.
    """
    actual = row["actual_cost_usd"]
    if actual is not None:
        return float(actual), "actual"
    estimated = row["estimated_cost_usd"]
    if estimated is not None:
        return float(estimated), "estimated"
    return None, "unknown"


def sessions_under(board_dir: Path, db: Optional[Path] = None) -> list[dict[str, Any]]:
    """Every worker session of one board, with its task id when the path gives one.

    Two LIKEs, one query, no per-task round trip: the caller groups in Python. The cost
    is a property of the session, so reading it board-wide cannot double-count.
    """
    root = Path(board_dir) / "workspaces"
    prefix = str(root)
    try:
        conn = _connect(db)
    except sqlite3.Error:
        return []
    try:
        rows = conn.execute(_COST_SQL, (f"{prefix}/%", f"{prefix}\\%")).fetchall()
    except sqlite3.Error:  # a state database from before the usage columns
        return []
    finally:
        conn.close()
    out = []
    for row in rows:
        cost, status = cost_of_row(row)
        out.append({
            "session_id": row["id"],
            "task_id": task_of_cwd(row["cwd"]),
            "profile": row["profile_name"],
            "title": row["title"],
            "started_at": row["started_at"],
            "ended_at": row["ended_at"],
            "message_count": row["message_count"],
            "cost": cost,
            "cost_status": status,
        })
    return out


def board_costs(board_dir: Path, task_ids: Iterable[str], db: Optional[Path] = None) -> dict[str, Any]:
    """Own cost per task — the lineage is the client's business (it owns the graph).

    Returns ``{"costs": {task_id: {"own": x, "status": s, "sessions": n}}, "unattributed": n}``,
    where ``unattributed`` counts the sessions of this board's workspaces whose task id the
    board no longer knows (a deleted task): their money is visible as a gap, not folded into
    a neighbour.
    A task with no session at all is absent, never zero: the column must be able to say
    « no data » instead of « free ».
    """
    known = set(task_ids)
    costs: dict[str, dict[str, Any]] = {}
    unattributed = 0
    for row in sessions_under(board_dir, db):
        task_id = row["task_id"]
        if not task_id or task_id not in known:
            unattributed += 1 if row["cost"] is not None else 0
            continue
        bucket = costs.setdefault(task_id, {"own": 0.0, "status": "unknown", "sessions": 0,
                                           "statuses": set()})
        bucket["sessions"] += 1
        if row["cost"] is not None:
            bucket["own"] += row["cost"]
        if row["cost_status"] in ("actual", "estimated"):
            bucket["statuses"].add(row["cost_status"])
    for bucket in costs.values():
        kinds = bucket.pop("statuses")
        # 'mixed' when estimates and actuals meet: the sum is then partly a projection.
        bucket["status"] = "mixed" if len(kinds) > 1 else (kinds.pop() if kinds else "unknown")
    return {"costs": costs, "unattributed": unattributed}


def task_sessions(board_dir: Path, task_id: str, db: Optional[Path] = None) -> list[dict[str, Any]]:
    """Every worker session of one task, newest first.

    A card can be worked more than once (a reclaim, a re-run after a fix), so the answer is
    a list — and the drawer shows each run its own transcript rather than pretending there is
    one. Empty when the workspaces convention predates the card: better no transcript than
    somebody else's.
    """
    rows = [r for r in sessions_under(board_dir, db) if r.get("task_id") == task_id]
    return sorted(rows, key=lambda r: r.get("started_at") or 0, reverse=True)


#: A transcript is a conversation, not a data dump: one message body is capped, and the
#: panel asks for more instead of pulling megabytes.
MESSAGE_CHARS = 8000


def transcript(session_id: str, limit: int = 120, before_id: Optional[int] = None,
               db: Optional[Path] = None) -> dict[str, Any]:
    """The messages of one worker session, oldest first, newest page when it is long.

    Read-only, narrow columns (the transcript is what the reader asked for; the system
    prompt is not), and `before_id` pages backwards so the panel can say « show earlier »
    without counting everything first.
    """
    try:
        conn = _connect(db)
    except sqlite3.Error:
        return {"session_id": session_id, "messages": [], "has_more": False, "error": "state database unavailable"}
    try:
        total = conn.execute("SELECT COUNT(*) FROM messages WHERE session_id = ?", (session_id,)).fetchone()[0]
        sql = ("SELECT id, role, content, tool_name, timestamp FROM messages "
               "WHERE session_id = ?")
        args: list[Any] = [session_id]
        if before_id is not None:
            sql += " AND id < ?"
            args.append(int(before_id))
        sql += " ORDER BY id DESC LIMIT ?"
        args.append(max(1, min(int(limit), 500)))
        rows = conn.execute(sql, args).fetchall()
        oldest = rows[-1]["id"] if rows else None
        has_more = False
        if oldest is not None:
            has_more = conn.execute(
                "SELECT 1 FROM messages WHERE session_id = ? AND id < ? LIMIT 1",
                (session_id, oldest),
            ).fetchone() is not None
    except sqlite3.Error:
        conn.close()
        return {"session_id": session_id, "messages": [], "has_more": False, "error": "messages unavailable"}
    finally:
        try:
            conn.close()
        except Exception:
            pass
    messages = []
    for row in reversed(rows):
        body = row["content"] or ""
        clipped = len(body) > MESSAGE_CHARS
        messages.append({
            "id": row["id"],
            "role": row["role"],
            "tool_name": row["tool_name"],
            "timestamp": row["timestamp"],
            "content": body[:MESSAGE_CHARS],
            "truncated": clipped,
        })
    return {
        "session_id": session_id,
        "messages": messages,
        "total": total,
        "has_more": has_more,
        # The panel pages with this: everything older than the first message it just got.
        "before_id": messages[0]["id"] if messages else None,
    }
