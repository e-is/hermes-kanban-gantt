"""Tests for the kanban-gantt plugin backend (reads + domain writes).

Runs against a REAL temporary kanban board created via hermes_cli.kanban_db
(no mocks for the domain layer): exercises /boards, /gantt, /tasks/<id>, and
every write endpoint, asserting domain invariants (refused transitions,
parent gating) surface as 409.

Isolation contract (defence in depth, in order):
1. PRIMARY SANDBOX — HERMES_HOME/HERMES_KANBAN_HOME are monkeypatched to a
   per-run tmp dir, so kanban_db writes land under <tmp>/kanban/boards/ and
   CANNOT touch the profile's real boards even if a test misbehaves.
2. FIXED SLUG — the test board is always `kanban-gantt-test` (never random):
   recognizable, and any stray leftover is deletable by name.
3. PURGE BEFORE + AFTER — the fixture wipes any leftover of that slug in the
   sandbox at setup and removes the whole sandbox dir at teardown; a session
   killed mid-run is also caught by the next run's purge.

The real shared boards (sumaris, hermes-plugins, …) are never written: their
roots are simply not mounted into the sandbox.
"""

from __future__ import annotations

import base64
import os
import re
import shutil
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Make the plugin backend importable and point it at a temp boards root.
PLUGIN_DIR = Path(__file__).resolve().parent.parent / "dashboard"
sys.path.insert(0, str(PLUGIN_DIR))

# hermes_cli lives in the hermes venv; tests are run with that interpreter.
from hermes_cli import kanban_db  # noqa: E402
# Connection opening moved out of kanban_db upstream (hermes_cli.kanban_db_connect);
# kanban_db no longer exposes connect(), so the sandbox opens through the new module.
from hermes_cli import kanban_db_connect as kbc  # noqa: E402

import plugin_api  # noqa: E402

# The dedicated test board slug — fixed so any stray leftover is identifiable
# and cleanable by name (see purge_board_root()).
TEST_SLUG = "kanban-gantt-test"


@pytest.fixture()
def board(tmp_path, monkeypatch):
    """A real sandboxed board with a small parent->child task graph.

    Every run gets its OWN tmp boards root (HERMES_HOME/HERMES_KANBAN_HOME
    point there), so the profile's shared boards are physically unreachable.
    The `kanban-gantt-test` slug is purged before AND after each test: before,
    to recover from a previous crashed run; after, to leave nothing behind.
    """
    sandbox = tmp_path
    boards_root = sandbox / "kanban" / "boards"
    monkeypatch.setenv("KANBAN_GANTT_BOARDS", str(boards_root))
    monkeypatch.setenv("HERMES_HOME", str(sandbox))
    # kanban_db.connect resolves <HERMES_KANBAN_HOME>/kanban/boards/<slug> —
    # point it at the SAME boards root the plugin reads, so writes and reads
    # hit one sandbox.
    monkeypatch.setenv("HERMES_KANBAN_HOME", str(sandbox))

    # ── purge BEFORE: recover from a killed previous run in this sandbox ────
    # (tmp_path is per-run, so this only fires when a session-level dir is
    # reused; it also wipes a leftover copy in a persistent root if any.)
    for stale in (boards_root / TEST_SLUG, sandbox / "kanban.db"):
        shutil.rmtree(stale, ignore_errors=True) if stale.is_dir() else (
            stale.unlink(missing_ok=True))

    # init_db + create tasks through the domain layer (invariants included)
    conn = kbc.connect(board=TEST_SLUG)
    parent = kanban_db.create_task(conn, title="[TEST] parent task", priority=1,
                                   created_by="test")
    child = kanban_db.create_task(conn, title="[TEST] child task", priority=2,
                                  created_by="test", parents=[parent])
    solo = kanban_db.create_task(conn, title="no prefix task", priority=1,
                                 created_by="test")
    kanban_db.complete_task(conn, parent, result="parent finished")
    kanban_db.add_comment(conn, child, author="test", body="a comment")
    conn.close()

    yield {"slug": TEST_SLUG, "parent": parent, "child": child, "solo": solo}

    # ── cleanup AFTER: remove the whole sandbox (boards + DB + wal) ─────────
    shutil.rmtree(sandbox, ignore_errors=True)


@pytest.fixture()
def client(board):
    app = plugin_api.create_app(allow_cors=False)
    return TestClient(app), board


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

def test_boards_list(client):
    http, board = client
    r = http.get("/boards")
    assert r.status_code == 200
    data = r.json()
    slugs = [b["slug"] for b in data["boards"]]
    assert board["slug"] in slugs
    assert data["current"]


def test_gantt_snapshot(client):
    http, board = client
    r = http.get(f"/gantt?board={board['slug']}")
    assert r.status_code == 200
    data = r.json()
    assert data["board"] == board["slug"]
    by_id = {t["id"]: t for t in data["tasks"]}
    assert len(by_id) == 3

    parent = by_id[board["parent"]]
    child = by_id[board["child"]]
    assert parent["status"] == "done"
    assert parent["archived"] is False
    assert child["parents"] == [board["parent"]]
    assert parent["children"] == [board["child"]]
    assert parent["label"] == "TEST"
    assert by_id[board["solo"]]["label"] is None
    assert "runs" in parent
    assert isinstance(parent["runs"], list)

    assert {"label": "TEST", "count": 2} in data["labels"]


def test_gantt_rejects_traversal(client):
    http, _ = client
    assert http.get("/gantt?board=../").status_code == 400
    assert http.get("/gantt?board=..%2Fetc").status_code in (400, 503)


def test_a_board_resolving_outside_its_own_directory_is_refused(monkeypatch, tmp_path):
    """A pinned HERMES_KANBAN_DB must be REFUSED, not silently obeyed.

    A gateway launched from a kanban worker's shell inherits `HERMES_KANBAN_DB`,
    and the core resolver then answers every slug with that one pinned file — so
    `?board=does-not-exist` used to return a valid snapshot of the pinned board
    under the wrong name (docs/spikes/websocket-recommendation §4.1, reproduced
    live; it is also what made this plugin look like it was serving `obsfish`).
    Serving another board's data silently is worse than a 404.
    """
    import types

    elsewhere = tmp_path / "boards" / "someone-elses-board" / "kanban.db"
    elsewhere.parent.mkdir(parents=True)
    elsewhere.write_bytes(b"")

    monkeypatch.setattr(plugin_api, "_kb", lambda: types.SimpleNamespace(kanban_db_path=lambda slug: elsewhere))

    with pytest.raises(Exception) as exc:
        plugin_api._board_db_path("wanted-board")

    assert "refused" in str(exc.value)


def test_the_default_board_is_served_rather_than_refused(client):
    """`default` does not live under boards/: the core keeps it at <root>/kanban.db.

    The guard modelled that back-compat path as `boards_root().parent` — which is
    <root>/kanban, so it pointed at <root>/kanban/kanban.db, one directory too deep.
    On a stock layout the guard therefore refused the very file the core had just
    resolved for `default`, and the page reported the refusal as "Backend
    kanban-gantt unreachable" (issue #10).
    """
    http, board = client
    home = Path(os.environ["HERMES_KANBAN_HOME"])
    (home / "kanban").mkdir(parents=True, exist_ok=True)
    conn = kbc.connect(board="default")
    kanban_db.create_task(conn, title="[TEST] task on the default board", priority=1,
                          created_by="test")
    conn.close()

    assert (home / "kanban.db").is_file(), "the core keeps the default DB at <root>/kanban.db"
    r = http.get("/gantt?board=default")
    assert r.status_code == 200, r.text
    assert any(t["title"] == "[TEST] task on the default board" for t in r.json()["tasks"])


def test_a_board_in_its_own_directory_is_served(monkeypatch, tmp_path):
    """The assertion must not reject the honest case it exists to protect."""
    import types

    boards = tmp_path / "boards"
    own = boards / "wanted-board" / "kanban.db"
    own.parent.mkdir(parents=True)
    own.write_bytes(b"")

    monkeypatch.setattr(plugin_api, "_boards_root", lambda: boards)
    monkeypatch.setattr(plugin_api, "_kb", lambda: types.SimpleNamespace(kanban_db_path=lambda slug: own))

    assert plugin_api._board_db_path("wanted-board") == own


def test_task_detail(client):
    http, board = client
    r = http.get(f"/tasks/{board['child']}?board={board['slug']}")
    assert r.status_code == 200
    task = r.json()["task"]
    assert task["id"] == board["child"]
    assert task["parents"] == [board["parent"]]
    assert any(c["body"] == "a comment" for c in task["comments"])
    assert task["latest_summary"] is None or isinstance(task["latest_summary"], str)


def test_task_detail_404(client):
    http, board = client
    assert http.get(f"/tasks/t_missing?board={board['slug']}").status_code == 404


# ---------------------------------------------------------------------------
# Attachments — rows in the detail, bytes (text or base64) one at a time
# ---------------------------------------------------------------------------

def _attach(board, task_id, name, data, content_type="text/markdown"):
    """Write a blob and its row exactly as the application does.

    Returns the attachment id. The file lands in the per-task directory the app
    uses, with an ABSOLUTE stored_path, because that is the shape the content route
    has to validate.
    """
    conn = kbc.connect(board=board["slug"])
    dest_dir = kanban_db.task_attachments_dir(task_id, board=board["slug"])
    dest_dir.mkdir(parents=True, exist_ok=True)
    path = dest_dir / name
    path.write_bytes(data)
    aid = kanban_db.add_attachment(conn, task_id, filename=name, stored_path=str(path.resolve()),
                                   content_type=content_type, size=len(data), uploaded_by="test")
    conn.close()
    return aid


def test_task_detail_lists_attachments(client):
    http, board = client
    _attach(board, board["child"], "notes.md", b"# Notes\n\nbody\n")
    task = http.get(f"/tasks/{board['child']}?board={board['slug']}").json()["task"]
    assert len(task["attachments"]) == 1
    att = task["attachments"][0]
    assert att["filename"] == "notes.md"
    assert att["size"] == len(b"# Notes\n\nbody\n")
    assert att["uploaded_by"] == "test"
    assert att["stored_path"].endswith("notes.md")
    # the row carries no content: the drawer must not pull every blob to list them
    assert "text" not in att and "content" not in att


def test_attachment_content_returns_markdown_as_text(client):
    http, board = client
    body = b"# Notes\n\n**bold**\n\n- one\n"
    aid = _attach(board, board["child"], "notes.md", body)
    r = http.get(f"/tasks/{board['child']}/attachments/{aid}/content?board={board['slug']}")
    assert r.status_code == 200
    data = r.json()
    assert data["encoding"] == "utf-8"
    assert data["text"] == body.decode()
    assert data["is_markdown"] is True
    assert data["filename"] == "notes.md"


def test_attachment_content_returns_binary_as_base64(client):
    http, board = client
    blob = bytes(range(256))          # not valid UTF-8, so it must not be decoded
    aid = _attach(board, board["child"], "frame.png", blob, content_type="image/png")
    r = http.get(f"/tasks/{board['child']}/attachments/{aid}/content?board={board['slug']}")
    assert r.status_code == 200
    data = r.json()
    assert data["encoding"] == "base64"
    assert base64.b64decode(data["text"]) == blob
    assert data["is_markdown"] is False


def test_attachment_content_404_for_an_unknown_id(client):
    http, board = client
    assert http.get(f"/tasks/{board['child']}/attachments/9999/content"
                    f"?board={board['slug']}").status_code == 404


def test_attachment_content_refuses_a_path_outside_the_board(client):
    """A hand-edited row must not turn the route into a file reader."""
    http, board = client
    outside = Path(os.environ["HERMES_HOME"]) / "outside.md"
    outside.write_text("secret")
    conn = kbc.connect(board=board["slug"])
    aid = kanban_db.add_attachment(conn, board["child"], filename="outside.md",
                                   stored_path=str(outside.resolve()),
                                   content_type="text/markdown", size=6, uploaded_by="test")
    conn.close()
    r = http.get(f"/tasks/{board['child']}/attachments/{aid}/content?board={board['slug']}")
    assert r.status_code == 404
    assert "secret" not in r.text

    # …and a traversal written into the column is refused for the same reason
    conn = kbc.connect(board=board["slug"])
    root = kanban_db.attachments_root(board["slug"])
    traversal = str((root / ".." / ".." / "outside.md"))
    aid2 = kanban_db.add_attachment(conn, board["child"], filename="passwd",
                                    stored_path=traversal, content_type="text/plain",
                                    size=6, uploaded_by="test")
    conn.close()
    assert http.get(f"/tasks/{board['child']}/attachments/{aid2}/content"
                    f"?board={board['slug']}").status_code == 404


def test_description_is_editable_and_recorded_as_an_edit(client):
    """The drawer's pencil writes through PATCH /tasks/{id}/description.

    The body is replaced verbatim (it is raw markdown — no trimming, no
    escaping), the write leaves an `edited` event like the reference kanban
    dashboard's field editor, an empty string clears the description, and a
    payload that OMITS the field is refused so a malformed client cannot wipe a
    body by accident.
    """
    http, board = client
    tid = board["child"]
    original = http.get(f"/tasks/{tid}?board={board['slug']}").json()["task"]["body"]
    new_body = "=== Mission ===\n1. Rebase `features/tu-coverage` sur develop.\n2. Review finale architecte.\n"

    r = http.patch(f"/tasks/{tid}/description?board={board['slug']}", json={"body": new_body})
    assert r.status_code == 200 and r.json()["ok"] is True
    assert http.get(f"/tasks/{tid}?board={board['slug']}").json()["task"]["body"] == new_body

    conn = kbc.connect(board=TEST_SLUG)
    try:
        kind = conn.execute(
            "SELECT kind FROM task_events WHERE task_id = ? ORDER BY rowid DESC LIMIT 1", (tid,)
        ).fetchone()[0]
    finally:
        conn.close()
    assert kind == "edited"

    # An empty description is a valid value (clears it)…
    assert http.patch(f"/tasks/{tid}/description?board={board['slug']}", json={"body": ""}).status_code == 200
    assert http.get(f"/tasks/{tid}?board={board['slug']}").json()["task"]["body"] in ("", None)

    # …but omitting the field is refused, and the cleared value stays cleared.
    assert http.patch(f"/tasks/{tid}/description?board={board['slug']}", json={}).status_code == 400

    # Unknown task → 404, never a silent upsert.
    assert http.patch(f"/tasks/t_missing/description?board={board['slug']}", json={"body": "x"}).status_code == 404

    # Restore, so a later test in this file sees the fixture's body again.
    http.patch(f"/tasks/{tid}/description?board={board['slug']}", json={"body": original})


def test_a_finished_parent_is_accepted_and_does_not_gate_the_child(client):
    """Dropping a task under a DONE task is the normal case, not an error.

    A parent is a prerequisite that must be finished before its children, so a
    terminal parent means the prerequisite is already satisfied: the domain links
    it and does NOT demote the child. The UI used to refuse the drop outright (a
    `terminal` reason in dropCandidates), which made the one useful case
    impossible — reported from the running app.
    """
    http, board = client
    done_id = board["parent"]
    assert http.get(f"/tasks/{done_id}?board={board['slug']}").json()["task"]["status"] in ("done", "archived")

    fresh = _mk(board["slug"], "[TEST] task dropped under a finished one")
    conn = kbc.connect(board=TEST_SLUG)
    try:                                   # ready, so a demotion would be visible
        conn.execute("UPDATE tasks SET status = 'ready' WHERE id = ?", (fresh,))
        conn.commit()
    finally:
        conn.close()

    r = http.post(f"/tasks/{fresh}/parent?board={board['slug']}",
                  json={"parentId": done_id, "mode": "add"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["gated"] is False          # the prerequisite was already satisfied
    assert body["status_after"] == "ready"  # …so the child keeps its status
    assert done_id in body["parents"]


def test_bulk_status_update(client):
    http, board = client
    # child and solo are unblocked / ready -> move both to blocked in bulk
    r = http.post(
        f"/tasks/bulk?board={board['slug']}",
        json={"ids": [board["child"], board["solo"]], "action": "blocked"}
    )
    assert r.status_code == 200
    res = r.json()["results"]
    assert len(res) == 2
    assert all(item["ok"] for item in res)

    # Mass assign
    r = http.post(
        f"/tasks/bulk?board={board['slug']}",
        json={"ids": [board["child"], board["solo"]], "assignee": "senior-coder"}
    )
    assert r.status_code == 200
    res = r.json()["results"]
    assert len(res) == 2
    assert all(item["ok"] for item in res)
    by_id = {t["id"]: t for t in http.get(f"/gantt?board={board['slug']}").json()["tasks"]}
    assert by_id[board["child"]]["assignee"] == by_id[board["solo"]]["assignee"] == "senior-coder"

    # Mass unassign: an empty assignee clears every selected task.
    r = http.post(
        f"/tasks/bulk?board={board['slug']}",
        json={"ids": [board["child"], board["solo"]], "assignee": ""}
    )
    assert all(item["ok"] for item in r.json()["results"])
    by_id = {t["id"]: t for t in http.get(f"/gantt?board={board['slug']}").json()["tasks"]}
    assert by_id[board["child"]]["assignee"] is None and by_id[board["solo"]]["assignee"] is None

    # The action name alone is not an assign: without `assignee` it is refused,
    # which is how the renderer's dropped field failed silently before.
    r = http.post(f"/tasks/bulk?board={board['slug']}",
                  json={"ids": [board["solo"]], "action": "assign"})
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# Writes (domain layer, real invariants)
# ---------------------------------------------------------------------------

def test_status_done_and_archive(client):
    http, board = client
    # child's parent is done -> unblocked path works
    r = http.patch(f"/tasks/{board['child']}/status?board={board['slug']}",
                   json={"action": "done", "result": "child finished"})
    assert r.status_code == 200
    assert r.json()["ok"] is True

    r = http.patch(f"/tasks/{board['solo']}/status?board={board['slug']}",
                   json={"action": "archive"})
    assert r.status_code == 200

    data = http.get(f"/gantt?board={board['slug']}").json()
    by_id = {t["id"]: t for t in data["tasks"]}
    assert by_id[board["child"]]["status"] == "done"
    assert by_id[board["solo"]]["archived"] is True


def test_status_unblock_refused_when_not_blocked(client):
    http, board = client
    r = http.patch(f"/tasks/{board['child']}/status?board={board['slug']}",
                   json={"action": "unblock"})
    assert r.status_code == 409  # not blocked/scheduled -> domain refuses


def test_status_block_then_unblock(client):
    http, board = client
    r = http.patch(f"/tasks/{board['child']}/status?board={board['slug']}",
                   json={"action": "blocked", "reason": "waiting on data"})
    assert r.status_code == 200
    r = http.patch(f"/tasks/{board['child']}/status?board={board['slug']}",
                   json={"action": "unblock"})
    assert r.status_code == 200
    data = http.get(f"/gantt?board={board['slug']}").json()
    by_id = {t["id"]: t for t in data["tasks"]}
    assert by_id[board["child"]]["status"] == "ready"


def test_status_unknown_action(client):
    http, board = client
    r = http.patch(f"/tasks/{board['child']}/status?board={board['slug']}",
                   json={"action": "explode"})
    assert r.status_code == 400


def test_add_comment(client):
    http, board = client
    r = http.post(f"/tasks/{board['solo']}/comments?board={board['slug']}",
                  json={"body": "from the gantt", "author": "test"})
    assert r.status_code == 200
    detail = http.get(f"/tasks/{board['solo']}?board={board['slug']}").json()["task"]
    assert any(c["body"] == "from the gantt" for c in detail["comments"])


def test_assign_and_unassign(client):
    http, board = client
    r = http.patch(f"/tasks/{board['solo']}/assignee?board={board['slug']}",
                   json={"profile": "architect"})
    assert r.status_code == 200
    data = http.get(f"/gantt?board={board['slug']}").json()
    by_id = {t["id"]: t for t in data["tasks"]}
    assert by_id[board["solo"]]["assignee"] == "architect"

    r = http.patch(f"/tasks/{board['solo']}/assignee?board={board['slug']}",
                   json={"profile": ""})
    assert r.status_code == 200
    data = http.get(f"/gantt?board={board['slug']}").json()
    by_id = {t["id"]: t for t in data["tasks"]}
    assert by_id[board["solo"]]["assignee"] is None


def test_meta(client):
    http, _ = client
    r = http.get("/meta")
    assert r.status_code == 200
    assert r.json()["writes"] is True


def test_gantt_all_boards(client):
    http, board = client
    # /gantt?board=all aggregates all boards
    r = http.get("/gantt?board=all")
    assert r.status_code == 200
    data = r.json()
    assert data["board"] == "all"
    by_id = {t["id"]: t for t in data["tasks"]}
    assert board["parent"] in by_id
    assert board["child"] in by_id
    assert board["solo"] in by_id
    assert by_id[board["parent"]]["board"] == board["slug"]

    # Detail view of a task when board=all finds owning board
    r_detail = http.get(f"/tasks/{board['child']}?board=all")
    assert r_detail.status_code == 200
    assert r_detail.json()["task"]["id"] == board["child"]

    # Comment when board=all finds owning board
    r_comment = http.post(f"/tasks/{board['solo']}/comments?board=all", json={"body": "all boards comment"})
    assert r_comment.status_code == 200

    # Bulk when board=all routes correctly
    r_bulk = http.post("/tasks/bulk?board=all", json={"ids": [board["solo"]], "action": "blocked", "reason": "all block"})
    assert r_bulk.status_code == 200
    assert r_bulk.json()["results"][0]["ok"] is True


# ---------------------------------------------------------------------------
# Task creation
# ---------------------------------------------------------------------------

def _gantt(http, slug):
    """The snapshot the page re-renders, keyed by task id."""
    data = http.get(f"/gantt?board={slug}").json()
    return {t["id"]: t for t in data["tasks"]}


def test_create_task(client):
    http, board = client
    r = http.post(f"/tasks?board={board['slug']}", json={"title": "[TEST] created"})
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data["board"] == board["slug"]
    # No parent -> the domain settles it on ready (dispatcher's queue).
    assert data["status"] == "ready"

    snap = _gantt(http, board["slug"])
    assert data["task_id"] in snap
    assert snap[data["task_id"]]["title"] == "[TEST] created"


def test_create_task_with_fields(client):
    http, board = client
    r = http.post(f"/tasks?board={board['slug']}", json={
        "title": "[TEST] with fields",
        "body": "some body",
        "assignee": "someone",
        "priority": 3,
    })
    assert r.status_code == 200
    detail = http.get(f"/tasks/{r.json()['task_id']}?board={board['slug']}").json()["task"]
    assert detail["title"] == "[TEST] with fields"
    assert detail["body"] == "some body"
    assert detail["assignee"] == "someone"
    assert detail["priority"] == 3


def test_create_subtask_is_gated_by_its_parent(client):
    """A new task under a not-yet-done parent lands in todo, not ready."""
    http, board = client
    r = http.post(f"/tasks?board={board['slug']}",
                  json={"title": "[TEST] child of solo", "parentId": board["solo"]})
    assert r.status_code == 200
    data = r.json()
    assert data["parent_id"] == board["solo"]
    # `solo` is a fresh todo task -> non-terminal -> the child is gated.
    assert data["status"] == "todo"
    snap = _gantt(http, board["slug"])
    assert snap[data["task_id"]]["parents"] == [board["solo"]]
    assert data["task_id"] in snap[board["solo"]]["children"]


def test_create_task_triage(client):
    http, board = client
    r = http.post(f"/tasks?board={board['slug']}",
                  json={"title": "[TEST] to triage", "triage": True})
    assert r.status_code == 200
    assert r.json()["status"] == "triage"


def test_create_task_rejects_empty_title(client):
    http, board = client
    assert http.post(f"/tasks?board={board['slug']}", json={"title": "   "}).status_code == 400
    assert http.post(f"/tasks?board={board['slug']}", json={"title": ""}).status_code == 400


def test_create_task_rejects_foreign_parent(client):
    http, board = client
    other = kbc.connect(board="kanban-gantt-test-other")
    try:
        foreign = kanban_db.create_task(other, title="[TEST] other board", created_by="test")
    finally:
        other.close()
    r = http.post(f"/tasks?board={board['slug']}",
                  json={"title": "[TEST] cross-board child", "parentId": foreign})
# Parent links (re-parenting)
#
# The domain owns the invariants; these tests pin that the ROUTES surface them
# (status codes + payload) instead of swallowing or re-deriving them.
# ---------------------------------------------------------------------------

def _mk(slug, title, **kw):
    conn = kbc.connect(board=slug)
    try:
        return kanban_db.create_task(conn, title=title, created_by="test", **kw)
    finally:
        conn.close()


def _parents(http, task_id, slug):
    return http.get(f"/tasks/{task_id}?board={slug}").json()["task"]["parents"]


def test_parent_link_add(client):
    http, board = client
    parent = _mk(board["slug"], "[TEST] new parent")
    r = http.post(f"/tasks/{board['solo']}/parent?board={board['slug']}",
                  json={"parentId": parent})
    assert r.status_code == 200
    data = r.json()
    assert data["parents"] == [parent]
    assert data["mode"] == "add"
    assert _parents(http, board["solo"], board["slug"]) == [parent]


def test_parent_link_replace_swaps_parents(client):
    http, board = client
    # `child` starts linked to `parent`; re-parent it onto `solo` and expect the
    # old link (and only it) to be dropped.
    r = http.post(f"/tasks/{board['child']}/parent?board={board['slug']}",
                  json={"parentId": board["solo"], "mode": "replace"})
    assert r.status_code == 200
    data = r.json()
    assert data["parents"] == [board["solo"]]
    assert data["unlinked"] == [board["parent"]]
    assert _parents(http, board["child"], board["slug"]) == [board["solo"]]


def test_parent_link_gates_ready_child(client):
    """A `ready` child re-parented under a non-terminal parent goes back to todo."""
    http, board = client
    # `solo` is a fresh todo task -> non-terminal, so linking must gate.
    conn = kbc.connect(board=board["slug"])
    conn.execute("UPDATE tasks SET status = 'ready' WHERE id = ?", (board["child"],))
    conn.commit()
    conn.close()

    r = http.post(f"/tasks/{board['child']}/parent?board={board['slug']}",
                  json={"parentId": board["solo"], "mode": "replace"})
    assert r.status_code == 200
    data = r.json()
    assert data["gated"] is True
    assert data["status_before"] == "ready"
    assert data["status_after"] == "todo"


def test_parent_link_self_refused(client):
    http, board = client
    r = http.post(f"/tasks/{board['solo']}/parent?board={board['slug']}",
                  json={"parentId": board["solo"]})
    assert r.status_code == 400


def test_parent_link_cycle_refused(client):
    http, board = client
    # child is already a descendant of parent -> linking parent under child cycles
    r = http.post(f"/tasks/{board['parent']}/parent?board={board['slug']}",
                  json={"parentId": board["child"]})
    assert r.status_code == 409
    assert "cycle" in r.json()["detail"]


def test_parent_link_running_child_refused(client):
    http, board = client
    # create_task refuses to leave a task 'running' without a run, so force the
    # state the domain's guard is about: status + a current run.
    running = _mk(board["slug"], "[TEST] running task")
    conn = kbc.connect(board=board["slug"])
    conn.execute("UPDATE tasks SET status = 'running', current_run_id = 1 WHERE id = ?",
                 (running,))
    conn.commit()
    conn.close()
    r = http.post(f"/tasks/{running}/parent?board={board['slug']}",
                  json={"parentId": board["solo"]})
    assert r.status_code == 409
    assert "running" in r.json()["detail"]


def test_parent_link_cross_board_refused(client):
    http, board = client
    other = _mk("kanban-gantt-test-other", "[TEST] other-board task")
    r = http.post(f"/tasks/{board['solo']}/parent?board={board['slug']}",
                  json={"parentId": other})
    assert r.status_code == 409
    assert "not on board" in r.json()["detail"]


def test_create_task_idempotency_key_prevents_duplicates(client):
    """The UI sends one key per submit, so a double click cannot create two."""
    http, board = client
    payload = {"title": "[TEST] once only", "idempotencyKey": "kg-test-key-1"}
    first = http.post(f"/tasks?board={board['slug']}", json=payload)
    second = http.post(f"/tasks?board={board['slug']}", json=payload)
    assert first.status_code == second.status_code == 200
    assert first.json()["task_id"] == second.json()["task_id"]
    snap = _gantt(http, board["slug"])
    assert len([t for t in snap.values() if t["title"] == "[TEST] once only"]) == 1


def test_create_task_accepts_the_reference_form_fields(client):
    """Workspace, skills, model override and goal mode reach the domain."""
    http, board = client
    r = http.post(f"/tasks?board={board['slug']}", json={
        "title": "[TEST] full form",
        "body": "described",
        "workspaceKind": "worktree",
        "workspacePath": "/tmp/kg-ws",
        "skills": ["alpha", " beta ", ""],
        "modelOverride": "openrouter/test-model",
        "goalMode": True,
    })
    assert r.status_code == 200
    detail = http.get(f"/tasks/{r.json()['task_id']}?board={board['slug']}").json()["task"]
    assert detail["body"] == "described"
    assert detail["workspace_kind"] == "worktree"
    assert detail["workspace_path"] == "/tmp/kg-ws"
    # blank entries are dropped, the rest trimmed
    assert [s.strip() for s in (detail.get("skills") or []) if s.strip()] == ["alpha", "beta"]
    assert detail["model_override"] == "openrouter/test-model"


def test_create_task_rejects_an_unknown_workspace_kind(client):
    http, board = client
    r = http.post(f"/tasks?board={board['slug']}",
                  json={"title": "[TEST] bad ws", "workspaceKind": "nonsense"})
    assert r.status_code == 400
    assert "workspaceKind" in r.json()["detail"]


def test_projects_endpoint_never_breaks_the_dialog(client):
    """Projects come from the profile's own projects.db; absent -> empty list."""
    http, _ = client
    r = http.get("/projects")
    assert r.status_code == 200
    assert isinstance(r.json()["projects"], list)
def test_parent_link_unknown_task(client):
    http, board = client
    r = http.post(f"/tasks/t_missing/parent?board={board['slug']}",
                  json={"parentId": board["solo"]})
    assert r.status_code == 404
    r2 = http.post(f"/tasks/{board['solo']}/parent?board={board['slug']}",
                   json={"parentId": ""})
    assert r2.status_code == 400
    r3 = http.post(f"/tasks/{board['solo']}/parent?board={board['slug']}",
                   json={"parentId": board["parent"], "mode": "nonsense"})
    assert r3.status_code == 400


def test_parent_unlink(client):
    http, board = client
    r = http.delete(f"/tasks/{board['child']}/parent/{board['parent']}?board={board['slug']}")
    assert r.status_code == 200
    assert r.json()["parents"] == []
    assert _parents(http, board["child"], board["slug"]) == []


def test_parent_unlink_missing_link(client):
    http, board = client
    r = http.delete(f"/tasks/{board['child']}/parent/t_missing?board={board['slug']}")
    assert r.status_code == 404


def test_reparent_is_visible_in_the_gantt_snapshot(client):
    """What the page re-renders must already carry the new hierarchy.

    The UI refreshes by re-reading /gantt (the query invalidation target), so the
    moved task, its new parent AND its old parent all have to come back with the
    updated links and status in THAT payload — not only in /tasks/<id>.
    """
    http, board = client
    before = _gantt(http, board["slug"])
    assert before[board["child"]]["parents"] == [board["parent"]]
    assert before[board["parent"]]["children"] == [board["child"]]

    r = http.post(f"/tasks/{board['child']}/parent?board={board['slug']}",
                  json={"parentId": board["solo"], "mode": "replace"})
    assert r.status_code == 200

    after = _gantt(http, board["slug"])
    assert after[board["child"]]["parents"] == [board["solo"]]
    assert after[board["solo"]]["children"] == [board["child"]]
    # the link removed on the other side must be gone too (no ghost connector)
    assert after[board["parent"]]["children"] == []
    # and the gated status is what the row/badge will paint
    assert after[board["child"]]["status"] == "todo"

    # unlink from the parent list -> the snapshot drops the edge and re-gates
    d = http.delete(f"/tasks/{board['child']}/parent/{board['solo']}?board={board['slug']}")
    assert d.status_code == 200
    freed = _gantt(http, board["slug"])
    assert freed[board["child"]]["parents"] == []
    assert freed[board["solo"]]["children"] == []


def test_move_to_a_board_that_already_has_history(client):
    """Reproduction: the target already owns rows whose ids the source reuses.

    ``task_comments`` / ``task_events`` / ``task_runs`` / ``task_attachments`` all
    key on ``INTEGER PRIMARY KEY AUTOINCREMENT``, and every board numbers them from
    1 — so carrying the source row's OWN id into the target collides with whatever
    the target already holds ("UNIQUE constraint failed: task_events.id"). The move
    then aborted before the source cleanup, which is the failure the drawer showed.

    The moved task is the finished parent WITH its child: that closure carries
    events, a run and an intra-move link, so the test also proves the history keeps
    its internal references after the ids are renumbered.
    """
    http, board = client
    target = "kanban-gantt-move-target"
    tconn = kbc.connect(board=target)
    # Two residents make the target's event ids overlap the source's.
    kanban_db.create_task(tconn, title="[TEST] target resident", created_by="test")
    resident2 = kanban_db.create_task(tconn, title="[TEST] target resident 2", created_by="test")
    kanban_db.add_comment(tconn, resident2, author="test", body="resident comment")
    tconn.close()

    # what the source holds right now, so the target can be compared row for row
    sconn = kbc.connect(board=board["slug"])
    moved_ids = (board["parent"], board["child"])
    want = {
        table: sconn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE task_id IN (?, ?)", moved_ids
        ).fetchone()[0]
        for table in ("task_events", "task_runs", "task_comments", "task_attachments")
    }
    sconn.close()
    assert want["task_events"] > 0, "the fixture must produce history to carry"

    r = http.post(f"/tasks/{board['parent']}/move?board={board['slug']}",
                  json={"to_board": target})
    assert r.status_code == 200, r.text          # before the fix: 500, UNIQUE on event id
    assert r.json()["to"] == target
    assert r.json()["count"] == 2                # the parent and its child closure

    # the source is cleaned up, both tasks are gone from it
    src = kbc.connect(board=board["slug"])
    for tid in moved_ids:
        assert src.execute("SELECT COUNT(*) FROM tasks WHERE id = ?", (tid,)).fetchone()[0] == 0
    src.close()

    tgt = kbc.connect(board=target)
    for tid in moved_ids:
        assert tgt.execute("SELECT COUNT(*) FROM tasks WHERE id = ?", (tid,)).fetchone()[0] == 1
    # every row of the moved set arrived, in the same amount
    for table, expected in want.items():
        got = tgt.execute(
            f"SELECT COUNT(*) FROM {table} WHERE task_id IN (?, ?)", moved_ids
        ).fetchone()[0]
        # task_events also gains the route's OWN trail event ("moved_from", one per
        # moved task, see the tail of the move route); every other table must arrive
        # in exactly the amount that left the source.
        extra = len(moved_ids) if table == "task_events" else 0
        assert got == expected + extra, f"{table}: {got} rows arrived, {expected} left the source"
    assert tgt.execute(
        "SELECT COUNT(*) FROM task_events WHERE task_id IN (?, ?) AND kind = 'moved_from'",
        moved_ids,
    ).fetchone()[0] == len(moved_ids)
    # the parent -> child link travelled with them
    assert tgt.execute(
        "SELECT COUNT(*) FROM task_links WHERE parent_id = ? AND child_id = ?",
        (board["parent"], board["child"]),
    ).fetchone()[0] == 1
    # and the events still point at the runs of THEIR OWN task: the ids were
    # renumbered independently by the target, so a stale run_id would silently
    # attach a moved event to an unrelated run of another task.
    dangling = tgt.execute(
        "SELECT COUNT(*) FROM task_events e WHERE e.task_id IN (?, ?) "
        "AND e.run_id IS NOT NULL AND NOT EXISTS ("
        "  SELECT 1 FROM task_runs r WHERE r.id = e.run_id AND r.task_id = e.task_id)",
        moved_ids,
    ).fetchone()[0]
    assert dangling == 0
    tgt.close()


def test_move_keeps_the_task_id_unless_the_target_already_uses_it(client):
    """The task's `t_…` id travels with it; only a REAL collision forces a new one.

    The id is the handle the desktop carries (drawer, query keys, notification
    subscriptions), so it must be preserved across boards whenever the target is
    free — and when it is not, the moved task gets a freshly generated `t_…` id
    while the target's own row keeps its id untouched.
    """
    http, board = client
    target = "kanban-gantt-move-idclash"
    tconn = kbc.connect(board=target)
    # A resident that squats the id we are about to move.
    tconn.execute(
        "INSERT INTO tasks (id, title, status, created_at) VALUES (?, ?, 'ready', ?)",
        (board["solo"], "[TEST] id squatter", 1_800_000_000),
    )
    tconn.commit()
    tconn.close()

    r = http.post(f"/tasks/{board['solo']}/move?board={board['slug']}",
                  json={"to_board": target})
    assert r.status_code == 200, r.text
    new_id = r.json()["moved"][0]
    assert new_id != board["solo"], "the squatted id must not be reused"
    assert new_id.startswith("t_"), "a fresh id keeps the kanban task-id shape"
    assert re.fullmatch(r"t_[0-9a-f]+", new_id), "prefix + hex, like every other task id"

    tgt = kbc.connect(board=target)
    # the squatter is still there, under its own id and title
    assert tgt.execute("SELECT title FROM tasks WHERE id = ?", (board["solo"],)).fetchone()[0] \
        == "[TEST] id squatter"
    # and the moved task arrived under the new handle, with its own title
    assert tgt.execute("SELECT title FROM tasks WHERE id = ?", (new_id,)).fetchone()[0] \
        == "no prefix task"
    tgt.close()

    src = kbc.connect(board=board["slug"])
    assert src.execute("SELECT COUNT(*) FROM tasks WHERE id = ?", (board["solo"],)).fetchone()[0] == 0
    src.close()
