"""kanban-gantt — backend for the desktop Gantt view of a Hermes kanban board.

Two run modes:

1. **Plugin backend** (default) — mounted at `/api/plugins/kanban-gantt/` by the
   desktop/dashboard plugin system.
2. **Standalone dev backend** — `python plugin_api.py --host H --port P` starts
   a FastAPI/uvicorn server serving `/boards` and `/gantt` at the root, so a
   Hermes Desktop UI on another machine can point its "backend API" setting at
   a backend that is still in development (CORS enabled by default).

Reads: `/boards` (list), `/gantt?board=<slug>` (snapshot: tasks + labels + link
graph), `/tasks/<id>?board=<slug>` (full task + comments + events + links).
Writes go through the *domain layer* (`hermes_cli.kanban_db`) so every
transition keeps its invariants (parent gating, run closing, event log) —
`PATCH /tasks/<id>/status` supports done/blocked/unblock/review/reopen/archive,
plus comment/assign endpoints. Board paths and the current-board pointer are
resolved by the CORE kanban resolver (`hermes_cli.kanban_db`: HERMES_KANBAN_DB
→ HERMES_KANBAN_BOARD → <root>/kanban/current → default, root from
HERMES_KANBAN_HOME → get_default_hermes_root()) so they can never drift from
the CLI/dispatcher — no hardcoded path; `KANBAN_GANTT_BOARDS` remains an
extra escape hatch for the standalone dev server.

Security: reads open the board sqlite read-only (mode=ro); writes open a normal
connection and delegate to kanban_db mutators only. Board slugs are validated
(no path traversal). As a plugin, backend import is gated by `plugins.enabled`
like every user plugin.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import time
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, FastAPI, HTTPException, Query
from pydantic import BaseModel

router = APIRouter()

_TASK_COLUMNS = ("id", "title", "body", "status", "assignee", "priority",
                 "created_at", "started_at", "completed_at", "result",
                 "block_kind", "current_run_id", "workflow_template_id",
                 "current_step_key")

# Task "label" = the leading bracketed prefix of the title, e.g. `[PROJET #123]`.
_LABEL_RE = re.compile(r"^\s*\[([^\]]+)\]\s*")

VALID_STATUSES = ("triage", "todo", "scheduled", "ready", "running",
                  "blocked", "review", "done", "archived")


# ---------------------------------------------------------------------------
# Board resolution — anchored on the CORE kanban resolver (hermes_cli.kanban_db)
# so path/current-board semantics can never drift from the CLI & dispatcher.
#
# kanban_db resolves, highest precedence first:
#   HERMES_KANBAN_DB (direct path) → HERMES_KANBAN_BOARD (env slug) →
#   <root>/kanban/current file → "default"
# and <root> = HERMES_KANBAN_HOME → get_default_hermes_root() (the profile's
# home, or the container's /opt/data-like root — no hardcoded path).
#
# KANBAN_GANTT_BOARDS keeps working as an extra escape hatch for the standalone
# dev server, and the read-only door needs a plain filesystem path, so we use
# board_dir()/kanban_db_path() directly instead of kanban_db.connect() for
# reads.
# ---------------------------------------------------------------------------

def _kb():
    """Import the core kanban domain layer (available in the gateway process
    and in tests; the bare standalone server falls back to env-only paths)."""
    from hermes_cli import kanban_db
    return kanban_db


def _boards_root() -> Path:
    explicit = os.environ.get("KANBAN_GANTT_BOARDS")
    if explicit:
        return Path(explicit).expanduser()
    try:
        return _kb().boards_root()
    except Exception:
        # standalone server without the hermes codebase: env-only fallback
        home = os.environ.get("HERMES_KANBAN_HOME") or "~/.hermes"
        return (Path(home).expanduser()) / "kanban" / "boards"


def _board_db_path(slug: str) -> Path:
    slug = (slug or "").strip().strip("/")
    if not slug or slug in (".", "..") or "/" in slug or "\\" in slug:
        raise HTTPException(status_code=400, detail="invalid board slug")
    try:
        # core resolver: honors HERMES_KANBAN_DB and the `default` back-compat
        # path (<root>/kanban.db instead of boards/default/kanban.db)
        path = _kb().kanban_db_path(slug)
    except Exception:
        path = _boards_root() / slug / "kanban.db"
    # ASSERT the resolved file belongs to the board that was asked for. A gateway
    # launched from a kanban worker's shell inherits HERMES_KANBAN_DB, and the core
    # resolver then answers EVERY slug with that one pinned file — so
    # `?board=does-not-exist` returned a valid snapshot of the pinned board under
    # the wrong name (reproduced end-to-end in docs/spikes/websocket-recommendation
    # §4.1, and it is what made this plugin look like it was serving `obsfish`).
    # Refusing is the only safe answer: serving another board's data silently is
    # worse than a 404.
    resolved = path.resolve()
    expected = (_boards_root() / slug / "kanban.db").resolve()
    legacy_default = (_boards_root().parent / "kanban.db").resolve()
    if resolved != expected and not (slug == "default" and resolved == legacy_default):
        raise HTTPException(
            status_code=404,
            detail=(f"board '{slug}' resolved to {path} — that is not this board's own "
                    "database, so it is refused (HERMES_KANBAN_DB pinning?)"),
        )
    if not path.is_file():
        raise HTTPException(
            status_code=503,
            detail=f"board '{slug}' database not found at {path}",
        )
    return path


def _resolve_board(board: Optional[str]) -> str:
    if board and board.strip():
        return board.strip().strip("/")
    env = (os.environ.get("HERMES_KANBAN_BOARD") or "").strip()
    if env:
        return env.strip("/")
    try:
        return _kb().get_current_board()
    except Exception:
        return "default"


def _connect(slug: str, *, ro: bool) -> sqlite3.Connection:
    """Open a board connection. Reads use mode=ro; writes go through kanban_db."""
    if ro:
        path = _board_db_path(slug)
        return sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    # Import the domain layer lazily: available in the gateway process (and in
    # tests via sys.path); a bare standalone server without the hermes codebase
    # still serves reads.
    from hermes_cli import kanban_db
    return kanban_db.connect(board=slug)


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------

def _label_of(title: str) -> Optional[str]:
    m = _LABEL_RE.match(title or "")
    return m.group(1).strip() if m else None


def _task_summary(row: sqlite3.Row, board_slug: Optional[str] = None) -> dict[str, Any]:
    title = row["title"] or ""
    return {
        "id": row["id"],
        "title": title,
        "status": row["status"],
        "assignee": row["assignee"],
        "priority": row["priority"],
        "label": _label_of(title),
        "board": board_slug,
        "archived": row["status"] == "archived",
        "created_at": row["created_at"],
        "started_at": row["started_at"],
        "completed_at": row["completed_at"],
        "run_started_at": row["run_started_at"],
        "run_ended_at": row["run_ended_at"],
        "runs": [],
    }


def _run_windows(conn: sqlite3.Connection) -> dict[str, dict[str, Any]]:
    """Real execution windows and full run history per task, from task_runs.

    Returns a dict task_id -> {
        "run_started_at": int | None,
        "run_ended_at": int | None,
        "runs": list[dict]
    }
    """
    out: dict[str, dict[str, Any]] = {}
    for row in conn.execute(
        "SELECT id, task_id, profile, step_key, status, outcome, started_at, ended_at, error, summary "
        "FROM task_runs "
        "WHERE started_at IS NOT NULL "
        "ORDER BY id ASC"
    ):
        tid = row[1] if isinstance(row, tuple) else row["task_id"]
        s = row[6] if isinstance(row, tuple) else row["started_at"]
        e = row[7] if isinstance(row, tuple) else row["ended_at"]
        if e is not None and s >= e:
            # ignore 0-duration synthetic runs
            continue
        if tid not in out:
            out[tid] = {
                "run_started_at": None,
                "run_ended_at": None,
                "runs": [],
            }
        run_dict = {
            "id": row[0] if isinstance(row, tuple) else row["id"],
            "profile": row[2] if isinstance(row, tuple) else row["profile"],
            "step_key": row[3] if isinstance(row, tuple) else row["step_key"],
            "status": row[4] if isinstance(row, tuple) else row["status"],
            "outcome": row[5] if isinstance(row, tuple) else row["outcome"],
            "started_at": s,
            "ended_at": e,
            "error": row[8] if isinstance(row, tuple) else row["error"],
            "summary": row[9] if isinstance(row, tuple) else row["summary"],
        }
        out[tid]["runs"].append(run_dict)
        out[tid]["run_started_at"] = s
        out[tid]["run_ended_at"] = e
    return out


def _task_detail(conn: sqlite3.Connection, task_id: str) -> dict[str, Any]:
    from hermes_cli import kanban_db

    task = kanban_db.get_task(conn, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"task {task_id} not found")
    from dataclasses import asdict
    d = asdict(task)
    d["label"] = _label_of(d.get("title") or "")
    d["latest_summary"] = kanban_db.latest_summary(conn, task_id)
    parents = [r[0] for r in conn.execute(
        "SELECT parent_id FROM task_links WHERE child_id = ? ORDER BY parent_id",
        (task_id,))]
    children = [r[0] for r in conn.execute(
        "SELECT child_id FROM task_links WHERE parent_id = ? ORDER BY child_id",
        (task_id,))]
    d["parents"] = parents
    d["children"] = children
    return d


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

@router.get("/boards")
def list_boards():
    root = _boards_root()
    boards: list[dict] = []
    if root.is_dir():
        for d in sorted(p for p in root.iterdir() if p.is_dir()):
            if not (d / "kanban.db").is_file():
                continue
            label = d.name
            board_file = d / "board.json"
            if board_file.is_file():
                try:
                    data = json.loads(board_file.read_text(encoding="utf-8"))
                    if isinstance(data, dict) and data.get("name"):
                        label = str(data["name"])
                except Exception:
                    pass
            boards.append({"slug": d.name, "label": label})
    return {"boards": boards, "current": _resolve_board(None)}


def _read_gantt(slug: str) -> dict:
    if slug == "all" or slug == "*":
        return _read_gantt_all()
    conn = _connect(slug, ro=True)
    conn.row_factory = sqlite3.Row  # _task_summary indexes by column name
    try:
        runs = _run_windows(conn)
        rows = conn.execute(
            "SELECT id, title, status, assignee, priority, created_at, started_at, completed_at, "
            "NULL AS run_started_at, NULL AS run_ended_at "
            "FROM tasks"
        ).fetchall()

        parents: dict[str, list[str]] = {}
        children: dict[str, list[str]] = {}
        for parent_id, child_id in conn.execute(
            "SELECT parent_id, child_id FROM task_links"
        ):
            children.setdefault(parent_id, []).append(child_id)
            parents.setdefault(child_id, []).append(parent_id)

        tasks: list[dict] = []
        label_counts: dict[str, int] = {}
        for row in rows:
            rec = _task_summary(row, board_slug=slug)
            rec["runs"] = []
            rec.update(runs.get(rec["id"], {}))  # real execution window & runs, if any
            rec["children"] = children.get(rec["id"], [])
            rec["parents"] = parents.get(rec["id"], [])
            tasks.append(rec)
            if rec["label"]:
                label_counts[rec["label"]] = label_counts.get(rec["label"], 0) + 1

        labels = sorted(
            ({"label": k, "count": v} for k, v in label_counts.items()),
            key=lambda item: (-item["count"], item["label"]),
        )

        return {
            "board": slug,
            "generated_at": int(time.time()),
            "tasks": tasks,
            "labels": labels,
        }
    finally:
        conn.close()


def _read_gantt_all() -> dict:
    """Snapshot aggregating tasks, runs and labels from ALL discovered boards."""
    boards_info = list_boards().get("boards", [])
    all_tasks: list[dict] = []
    label_counts: dict[str, int] = {}

    for b in boards_info:
        bslug = b["slug"]
        try:
            conn = _connect(bslug, ro=True)
            conn.row_factory = sqlite3.Row
        except Exception:
            continue
        try:
            runs = _run_windows(conn)
            rows = conn.execute(
                "SELECT id, title, status, assignee, priority, created_at, started_at, completed_at, "
                "NULL AS run_started_at, NULL AS run_ended_at "
                "FROM tasks"
            ).fetchall()

            parents: dict[str, list[str]] = {}
            children: dict[str, list[str]] = {}
            for parent_id, child_id in conn.execute(
                "SELECT parent_id, child_id FROM task_links"
            ):
                children.setdefault(parent_id, []).append(child_id)
                parents.setdefault(child_id, []).append(parent_id)

            for row in rows:
                rec = _task_summary(row, board_slug=bslug)
                rec["runs"] = []
                rec.update(runs.get(rec["id"], {}))
                rec["children"] = children.get(rec["id"], [])
                rec["parents"] = parents.get(rec["id"], [])
                all_tasks.append(rec)
                if rec["label"]:
                    label_counts[rec["label"]] = label_counts.get(rec["label"], 0) + 1
        finally:
            conn.close()

    labels = sorted(
        ({"label": k, "count": v} for k, v in label_counts.items()),
        key=lambda item: (-item["count"], item["label"]),
    )

    return {
        "board": "all",
        "generated_at": int(time.time()),
        "tasks": all_tasks,
        "labels": labels,
    }


@router.get("/gantt")
def get_gantt(board: Optional[str] = Query(None)):
    """Full board snapshot for the Gantt: tasks + labels + link graph."""
    slug = _resolve_board(board)
    return _read_gantt(slug)


# ---------------------------------------------------------------------------
# Bulk operations (MUST be declared before /tasks/{task_id} to avoid matching "bulk" as task_id)
# ---------------------------------------------------------------------------

class BulkStatusBody(BaseModel):
    ids: list[str]
    action: Optional[str] = None
    status: Optional[str] = None
    assignee: Optional[str] = None  # None/'' to assign or unassign in bulk
    archive: bool = False
    result: Optional[str] = None
    summary: Optional[str] = None


@router.post("/tasks/bulk")
def bulk_change_status(payload: BulkStatusBody, board: Optional[str] = Query(None)):
    """Apply an action/status update or mass-assign to multiple task ids in a single batch."""
    from hermes_cli import kanban_db

    slug = _resolve_board(board)
    if slug in ("all", "*"):
        # Map each task to its owning board and group operations
        task_boards = {}
        for tid in payload.ids:
            tb = _find_task_board(tid)
            if tb:
                task_boards.setdefault(tb, []).append(tid)

        results = []
        for bslug, tids in task_boards.items():
            sub_payload = BulkStatusBody(
                ids=tids,
                action=payload.action,
                status=payload.status,
                assignee=payload.assignee,
                archive=payload.archive,
                result=payload.result,
                summary=payload.summary
            )
            sub_res = bulk_change_status(sub_payload, board=bslug)
            results.extend(sub_res.get("results", []))

        # Check if some ids were not found
        processed = {r["id"] for r in results}
        for tid in payload.ids:
            if tid not in processed:
                results.append({"id": tid, "ok": False, "error": f"task {tid} not found on any board"})
        return {"results": results}

    conn = _connect(slug, ro=False)
    results = []
    try:
        if payload.assignee is not None:
            # Mass assignment
            assignee_val = payload.assignee.strip() or None
            for tid in payload.ids:
                try:
                    ok = kanban_db.assign_task(conn, tid, assignee_val)
                    results.append({"id": tid, "ok": bool(ok)})
                except Exception as exc:
                    results.append({"id": tid, "ok": False, "error": str(exc)})
            return {"results": results}

        action = (payload.action or payload.status or "").strip().lower()
        if payload.archive:
            action = "archive"
        if action == "restore":
            action = "done"
        if action not in _ACTIONS:
            raise HTTPException(status_code=400, detail=f"unknown action: {action}")

        dummy_status = StatusBody(action=action, result=payload.result, summary=payload.summary)
        for tid in payload.ids:
            try:
                ok = _apply_action(conn, kanban_db, action, tid, dummy_status)
                results.append({"id": tid, "ok": bool(ok)})
            except Exception as exc:
                results.append({"id": tid, "ok": False, "error": str(exc)})
        return {"results": results}
    finally:
        conn.close()


def _find_task_board(task_id: str) -> Optional[str]:
    """Find which board owns task_id among all discovered boards."""
    for b in list_boards().get("boards", []):
        bslug = b["slug"]
        try:
            conn = _connect(bslug, ro=True)
            row = conn.execute("SELECT 1 FROM tasks WHERE id = ?", (task_id,)).fetchone()
            conn.close()
            if row:
                return bslug
        except Exception:
            pass
    return None


@router.get("/tasks/{task_id}")
def get_task(task_id: str, board: Optional[str] = Query(None)):
    """Task detail: full record + comments + events + links (for the drawer)."""
    slug = _resolve_board(board)
    if slug in ("all", "*"):
        found = _find_task_board(task_id)
        if found:
            slug = found
        else:
            slug = _resolve_board(None)
            if slug in ("all", "*"):
                slug = "default"
    conn = _connect(slug, ro=True)
    conn.row_factory = sqlite3.Row  # kanban_db Task.from_row expects Row rows
    try:
        from hermes_cli import kanban_db
        detail = _task_detail(conn, task_id)
        detail["comments"] = [c.__dict__ if hasattr(c, "__dict__") else c
                              for c in kanban_db.list_comments(conn, task_id)]
        detail["events"] = [e.__dict__ if hasattr(e, "__dict__") else e
                            for e in kanban_db.list_events(conn, task_id)]
        detail["runs"] = [
            {
                "id": r[0],
                "profile": r[1],
                "status": r[2],
                "outcome": r[3],
                "summary": r[4],
                "started_at": r[5],
                "ended_at": r[6],
                "error": r[7],
            }
            for r in conn.execute(
                "SELECT id, profile, status, outcome, summary, started_at, ended_at, error "
                "FROM task_runs WHERE task_id = ? ORDER BY id DESC",
                (task_id,),
            ).fetchall()
        ]
        # dependency titles for the drawer (Blocked by / Blocks)
        detail["dependencies"] = [
            {"id": pid, "title": _short_title(conn, pid), "relation": "parent"}
            for pid in detail["parents"]
        ] + [
            {"id": cid, "title": _short_title(conn, cid), "relation": "child"}
            for cid in detail["children"]
        ]
        return {"task": detail}
    finally:
        conn.close()


def _short_title(conn: sqlite3.Connection, task_id: str) -> str:
    row = conn.execute("SELECT title FROM tasks WHERE id = ?", (task_id,)).fetchone()
    return (row[0] or task_id)[:80] if row else task_id


# ---------------------------------------------------------------------------
# Writes — thin wrappers over the kanban_db domain layer (invariants kept).
# ---------------------------------------------------------------------------

class StatusBody(BaseModel):
    action: str                 # see _ACTIONS below
    result: Optional[str] = None
    summary: Optional[str] = None
    reason: Optional[str] = None
    target: Optional[str] = None   # for 'ready'/'todo' direct writes


# GANTT-6 action matrix — every transition routes through the domain layer.
_ACTIONS = (
    "done", "blocked", "unblock", "review", "reopen", "archive",
    "ready", "todo", "triage", "delete", "restore",
)


def _apply_action(conn, kanban_db, action: str, task_id: str, payload: StatusBody) -> bool:
    if action == "done":
        return kanban_db.complete_task(conn, task_id,
                                       result=payload.result,
                                       summary=payload.summary)
    if action == "blocked":
        return kanban_db.block_task(conn, task_id, reason=payload.reason)
    if action == "unblock":
        return kanban_db.unblock_task(conn, task_id)
    if action == "review":
        return kanban_db.request_review(conn, task_id,
                                        summary=payload.summary or payload.reason,
                                        force=True)
    if action == "reopen":
        return kanban_db.reopen_review_task(conn, task_id)
    if action == "archive":
        return kanban_db.archive_task(conn, task_id)
    if action == "ready":
        # promote / return to ready: unblock if parked, else a direct write
        # (parent gating enforced inside _set_status_direct)
        cur = kanban_db.get_task(conn, task_id)
        if cur is None:
            return False
        if cur.status in ("blocked", "scheduled"):
            return kanban_db.unblock_task(conn, task_id)
        from hermes_cli.kanban_db import _set_status_direct
        return bool(_set_status_direct(conn, task_id, "ready"))
    if action == "todo":
        return bool(kanban_db.reopen_review_task(conn, task_id)) or _direct_status(conn, kanban_db, task_id, "todo")
    if action == "triage":
        return _direct_status(conn, kanban_db, task_id, "triage")
    if action == "delete":
        return bool(kanban_db.delete_task(conn, task_id))
    raise ValueError(action)


def _direct_status(conn, kanban_db, task_id: str, status: str) -> bool:
    """Direct status write for non-standard transitions (triage, ready from
    done…). Mirrors the dashboard's _set_status_direct semantics minimally:
    refuses unknown ids, appends a status event."""
    cur = conn.execute(
        "UPDATE tasks SET status = ? WHERE id = ?", (status, task_id))
    if cur.rowcount != 1:
        return False
    kanban_db.add_comment(conn, task_id, author="gantt",
                          body=f"status set to {status} (gantt)")
    return True


@router.patch("/tasks/{task_id}/status")
def change_status(task_id: str, payload: StatusBody, board: Optional[str] = Query(None)):
    """Transition a task via the domain layer (parent gating, run close, events)."""
    from hermes_cli import kanban_db

    action = (payload.action or "").strip().lower()
    if action == "restore":
        action = "done"  # unarchive: the domain's restore path is complete_task-like
    if action not in _ACTIONS:
        raise HTTPException(status_code=400, detail=f"unknown action: {action}")

    slug = _resolve_board(board)
    if slug in ("all", "*"):
        found = _find_task_board(task_id)
        if found:
            slug = found
        else:
            slug = _resolve_board(None)
            if slug in ("all", "*"):
                slug = "default"
    conn = _connect(slug, ro=False)
    try:
        ok = _apply_action(conn, kanban_db, action, task_id, payload)
        if not ok:
            raise HTTPException(
                status_code=409,
                detail=f"transition '{action}' refused for {task_id} (state/parent gating)",
            )
        return {"ok": True, "task_id": task_id, "action": action}
    finally:
        conn.close()


class CommentBody(BaseModel):
    body: str
    author: Optional[str] = "gantt"


@router.post("/tasks/{task_id}/comments")
def add_comment(task_id: str, payload: CommentBody, board: Optional[str] = Query(None)):
    from hermes_cli import kanban_db

    if not (payload.body or "").strip():
        raise HTTPException(status_code=400, detail="body is required")
    slug = _resolve_board(board)
    if slug in ("all", "*"):
        found = _find_task_board(task_id)
        if found:
            slug = found
        else:
            slug = _resolve_board(None)
            if slug in ("all", "*"):
                slug = "default"
    conn = _connect(slug, ro=False)
    try:
        if kanban_db.get_task(conn, task_id) is None:
            raise HTTPException(status_code=404, detail=f"task {task_id} not found")
        kanban_db.add_comment(conn, task_id,
                              author=payload.author or "gantt",
                              body=payload.body)
        return {"ok": True}
    finally:
        conn.close()


class AssignBody(BaseModel):
    profile: Optional[str] = None   # None/'' = unassign


@router.patch("/tasks/{task_id}/assignee")
def assign(task_id: str, payload: AssignBody, board: Optional[str] = Query(None)):
    from hermes_cli import kanban_db

    slug = _resolve_board(board)
    if slug in ("all", "*"):
        found = _find_task_board(task_id)
        if found:
            slug = found
        else:
            slug = _resolve_board(None)
            if slug in ("all", "*"):
                slug = "default"
    conn = _connect(slug, ro=False)
    try:
        ok = kanban_db.assign_task(conn, task_id, (payload.profile or "").strip() or None)
        if not ok:
            raise HTTPException(status_code=409, detail=f"assign refused for {task_id}")
        return {"ok": True, "task_id": task_id}
    finally:
        conn.close()


class NewTaskBody(BaseModel):
    title: str
    body: Optional[str] = None
    assignee: Optional[str] = None
    priority: Optional[int] = 0
    parentId: Optional[str] = None
    triage: Optional[bool] = False
    # Full parity with the reference kanban creation form: the workspace the
    # worker gets, the project it belongs to, the profile's skills, a model
    # override and goal mode.
    projectId: Optional[str] = None
    workspaceKind: Optional[str] = None       # scratch | worktree | dir
    workspacePath: Optional[str] = None
    skills: Optional[list[str]] = None
    modelOverride: Optional[str] = None
    goalMode: Optional[bool] = False
    # Client-generated, so a double submit returns the SAME task instead of a
    # duplicate (create_task is not idempotent without it).
    idempotencyKey: Optional[str] = None


@router.get("/projects")
def list_projects():
    """Projects a task can be linked to (read-only; empty when none exist).

    Projects live in the profile's own projects.db, so a failure there must not
    take the create dialog down — an empty list just means "no project to pick".
    """
    from hermes_cli import projects_db

    try:
        with projects_db.connect_closing() as conn:
            rows = projects_db.list_projects(conn)
    except Exception:
        return {"projects": []}
    return {
        "projects": [
            {
                "id": p.id,
                "slug": p.slug,
                "name": p.name,
                "path": getattr(p, "primary_path", None),
                "board": getattr(p, "board_slug", None),
            }
            for p in rows
        ]
    }


@router.get("/profiles")
def list_hermes_profiles():
    """Hermes profiles, so the create form can offer them as assignees.

    The board's own assignees only exist once a task has been assigned; before
    that the field would be empty on a fresh board. Degrades to an empty list.
    """
    try:
        from hermes_cli import profiles as profiles_mod

        rows = profiles_mod.list_profiles()
    except Exception:
        return {"profiles": []}
    out = []
    for p in rows:
        if isinstance(p, dict):
            name = p.get("name") or p.get("id")
        else:
            name = getattr(p, "name", None) or getattr(p, "id", None)
        if name:
            out.append(str(name))
    return {"profiles": sorted(set(out), key=lambda n: (n != "default", n))}


@router.post("/tasks")
def create_task(payload: NewTaskBody, board: Optional[str] = Query(None)):
    """Create a task through the domain layer.

    The domain derives the status (`ready`, or `todo` when the given parent is
    not finished yet; `triage` when asked) — no status is forced here, so the
    new task obeys the same parent gating as everything else on the board.
    """
    from hermes_cli import kanban_db

    title = (payload.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")

    workspace_kind = (payload.workspaceKind or "").strip() or None
    if workspace_kind and workspace_kind not in kanban_db.VALID_WORKSPACE_KINDS:
        raise HTTPException(
            status_code=400,
            detail=f"workspaceKind must be one of {sorted(kanban_db.VALID_WORKSPACE_KINDS)}",
        )

    slug = _resolve_board(board)
    if slug in ("all", "*"):
        # No task to find the board from: create on the current board.
        slug = _resolve_board(None)
        if slug in ("all", "*"):
            slug = "default"

    parent_id = (payload.parentId or "").strip() or None
    conn = _connect(slug, ro=False)
    try:
        if parent_id and kanban_db.get_task(conn, parent_id) is None:
            # task_links is per-board, so a parent from another board is not a
            # parent at all here.
            raise HTTPException(
                status_code=409,
                detail=f"parent {parent_id} is not on board {slug}",
            )
        skills = [s.strip() for s in (payload.skills or []) if s and s.strip()]
        try:
            task_id = kanban_db.create_task(
                conn,
                title=title,
                body=(payload.body or "").strip() or None,
                assignee=(payload.assignee or "").strip() or None,
                priority=int(payload.priority or 0),
                parents=[parent_id] if parent_id else (),
                triage=bool(payload.triage),
                project_id=(payload.projectId or "").strip() or None,
                workspace_kind=workspace_kind or "scratch",
                workspace_path=(payload.workspacePath or "").strip() or None,
                skills=skills or None,
                model_override=(payload.modelOverride or "").strip() or None,
                goal_mode=bool(payload.goalMode),
                idempotency_key=(payload.idempotencyKey or "").strip() or None,
                created_by="gantt",
            )
        except ValueError as exc:
            # Domain validation (workspace kind, model/provider pairing, …)
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        task = kanban_db.get_task(conn, task_id)
        return {
            "ok": True,
            "task_id": task_id,
            "board": slug,
            "status": task.status if task else None,
            "parent_id": parent_id,
        }
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Parent links (re-parenting). The DOMAIN owns every invariant: no self-link,
# no cycle, both tasks must exist, a *running* child is refused (that is a
# property of the child, not of the new parent), a `ready` child whose new
# parent is not terminal is GATED back to `todo`, and unlinking runs
# `recompute_ready` so a child freed by the move is promoted in the same call.
# These routes only resolve the board, delegate, and surface both effects.
# ---------------------------------------------------------------------------

def _board_for_task(task_id: str, board: Optional[str]) -> str:
    """Slug owning ``task_id`` — the /all-view resolution the write routes use."""
    slug = _resolve_board(board)
    if slug in ("all", "*"):
        slug = _find_task_board(task_id) or _resolve_board(None)
        if slug in ("all", "*"):
            slug = "default"
    return slug


def _parent_ids(conn: sqlite3.Connection, task_id: str) -> list[str]:
    return [r[0] for r in conn.execute(
        "SELECT parent_id FROM task_links WHERE child_id = ? ORDER BY parent_id",
        (task_id,),
    )]


def _status_of(conn: sqlite3.Connection, task_id: str) -> Optional[str]:
    row = conn.execute("SELECT status FROM tasks WHERE id = ?", (task_id,)).fetchone()
    return row[0] if row else None


class ParentBody(BaseModel):
    parentId: str
    mode: Optional[str] = "add"      # add | replace


@router.post("/tasks/{task_id}/parent")
def add_parent(task_id: str, payload: ParentBody, board: Optional[str] = Query(None)):
    """Link ``payload.parentId -> task_id``, optionally replacing its parents.

    ``mode='replace'`` unlinks the task's other parents first (what "drop this
    task under that one" means when the tree must stay single-parent).
    """
    from hermes_cli import kanban_db

    parent_id = (payload.parentId or "").strip()
    mode = (payload.mode or "add").strip().lower()
    if not parent_id:
        raise HTTPException(status_code=400, detail="parentId is required")
    if mode not in ("add", "replace"):
        raise HTTPException(status_code=400, detail=f"unknown mode: {mode}")
    if parent_id == task_id:
        raise HTTPException(status_code=400, detail="a task cannot be its own parent")

    slug = _board_for_task(task_id, board)
    conn = _connect(slug, ro=False)
    try:
        if kanban_db.get_task(conn, task_id) is None:
            raise HTTPException(status_code=404, detail=f"task {task_id} not found")
        if kanban_db.get_task(conn, parent_id) is None:
            # Almost always a cross-board drop: task_links lives in the board's
            # own sqlite file, so a task from another board cannot be a parent.
            raise HTTPException(
                status_code=409,
                detail=f"parent {parent_id} is not on board {slug}",
            )

        status_before = _status_of(conn, task_id)
        unlinked: list[str] = []
        if mode == "replace":
            for existing in _parent_ids(conn, task_id):
                if existing != parent_id and kanban_db.unlink_tasks(conn, existing, task_id):
                    unlinked.append(existing)

        try:
            gated = kanban_db.link_tasks(conn, parent_id, task_id)
        except ValueError as exc:
            # self-link / cycle / running child / unknown task
            raise HTTPException(status_code=409, detail=str(exc)) from exc

        status_after = _status_of(conn, task_id)
        return {
            "ok": True,
            "task_id": task_id,
            "parent_id": parent_id,
            "mode": mode,
            "gated": bool(gated),
            "unlinked": unlinked,
            "status_before": status_before,
            "status_after": status_after,
            "parents": _parent_ids(conn, task_id),
        }
    finally:
        conn.close()


@router.delete("/tasks/{task_id}/parent/{parent_id}")
def remove_parent(task_id: str, parent_id: str, board: Optional[str] = Query(None)):
    """Drop one parent link (``unlink_tasks`` also re-gates the freed child)."""
    from hermes_cli import kanban_db

    slug = _board_for_task(task_id, board)
    conn = _connect(slug, ro=False)
    try:
        if kanban_db.get_task(conn, task_id) is None:
            raise HTTPException(status_code=404, detail=f"task {task_id} not found")
        status_before = _status_of(conn, task_id)
        if not kanban_db.unlink_tasks(conn, parent_id, task_id):
            raise HTTPException(status_code=404,
                                detail=f"no link {parent_id} -> {task_id}")
        status_after = _status_of(conn, task_id)
        return {
            "ok": True,
            "task_id": task_id,
            "parent_id": parent_id,
            "status_before": status_before,
            "status_after": status_after,
            "parents": _parent_ids(conn, task_id),
        }
    finally:
        conn.close()


@router.get("/meta")
def _meta():
    return {
        "name": "kanban-gantt",
        "board": _resolve_board(None),
        "endpoint": "/gantt",
        "writes": True,
    }


def create_app(allow_cors: bool = True) -> FastAPI:
    """Standalone FastAPI app (dev/remote mode) serving the router at the root."""
    app = FastAPI(title="kanban-gantt backend", version="2.1.0")
    if allow_cors:
        from fastapi.middleware.cors import CORSMiddleware

        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=False,
            allow_methods=["GET", "PATCH", "POST", "OPTIONS"],
            allow_headers=["*"],
        )
    app.include_router(router)
    return app


def load_sibling(name: str):
    """Import a module sitting next to *this* file, whatever load mode we are in.

    Two very different ways this plugin's Python gets imported:

    * **Standalone dev server / tests** — `python plugin_api.py` puts this
      directory on `sys.path`, so a plain `import plugin_ws` works.
    * **Mounted by the gateway** — core loads the `api` file with
      `importlib.util.spec_from_file_location("hermes_dashboard_plugin_<name>", …)`
      (`hermes_cli/web_server_dashboard.py:862`) and never touches `sys.path`, so
      a plain sibling import raises `ImportError` and the feature silently
      degrades (verified: `kanban-gantt: websocket prototype unavailable
      (No module named 'plugin_ws')` in a real `hermes dashboard` log).

    So: reuse an already-loaded module whose file *is* the sibling (never load a
    second copy — the gateway's own instance must be the one wired up), else try
    the plain import, else load it by path with a deterministic module name.
    """
    import importlib
    import importlib.util
    import sys

    here = Path(__file__).resolve().parent / f"{name}.py"

    def _is_sibling(mod: Any) -> bool:
        f = getattr(mod, "__file__", None)
        if not f:
            return False
        try:
            return Path(f).resolve() == here
        except OSError:  # pragma: no cover - unreadable path
            return False

    for mod in list(sys.modules.values()):
        if _is_sibling(mod):
            return mod
    try:
        mod = importlib.import_module(name)
        if _is_sibling(mod):
            return mod
    except Exception:  # noqa: BLE001 - fall through to the by-path load
        pass
    spec = importlib.util.spec_from_file_location(f"kanban_gantt_{name}", here)
    if spec is None or spec.loader is None:  # pragma: no cover - defensive
        raise ImportError(f"cannot load sibling {name} from {here}")
    mod = importlib.util.module_from_spec(spec)
    # Register before exec so `from __future__ import annotations` + pydantic can
    # resolve string annotations by module name (same reason core does it).
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# Prototype: websocket push for the gantt snapshot loop (spike t_64075faf).
# OFF unless KANBAN_GANTT_WS=1 — see dashboard/plugin_ws.py for the contract.
# Registered last so the route set is identical to today's when the flag is off.
# ---------------------------------------------------------------------------
try:  # pragma: no cover - import guard only (bare copies of this file)
    plugin_ws = load_sibling("plugin_ws")
except Exception as _ws_exc:  # noqa: BLE001 - never break the REST backend
    print(f"kanban-gantt: websocket prototype unavailable ({_ws_exc})")
    plugin_ws = None

if plugin_ws is not None:
    try:
        plugin_ws.attach(router)
    except Exception as _ws_exc:  # noqa: BLE001
        print(f"kanban-gantt: websocket prototype failed to register ({_ws_exc})")


def main() -> None:
    import argparse

    import uvicorn

    parser = argparse.ArgumentParser(
        description="Standalone kanban-gantt backend (/boards, /gantt, /tasks/*).",
    )
    parser.add_argument("--host", default=os.environ.get("KANBAN_GANTT_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("KANBAN_GANTT_PORT", "8765")))
    parser.add_argument("--no-cors", action="store_true")
    args = parser.parse_args()

    print(f"kanban-gantt backend on http://{args.host}:{args.port}")
    uvicorn.run(create_app(allow_cors=not args.no_cors), host=args.host, port=args.port)


if __name__ == "__main__":
    main()