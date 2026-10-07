"""Integration test for POST /tasks/{id}/move — run standalone."""
import os, sqlite3, sys, tempfile, time
from pathlib import Path

tmp = tempfile.mkdtemp()
os.environ['HERMES_KANBAN_HOME'] = tmp
os.environ['KANBAN_GANTT_BOARDS'] = os.path.join(tmp, 'kanban', 'boards')
os.environ['PYTHONPATH'] = os.path.expanduser('~/.hermes/hermes-agent')

from fastapi.testclient import TestClient
from plugin_api import create_app, _board_db_path, _board_for_task
import hermes_cli.kanban_db as kb

c = TestClient(create_app())
H = 3600
now = int(time.time())

# two boards
c.get('/meta')
kb.create_board('tgt-board', name='Target board')
assert c.post('/tasks?board=src-board', json={'title': 'parent task'}).status_code == 200
parent = c.get('/gantt?board=src-board').json()['tasks'][0]['id']
child = c.post('/tasks?board=src-board', json={'title': 'child task', 'parentId': parent}).json()['task_id']

# history: comment + run + attachment on the parent
c.post(f'/tasks/{parent}/comments?board=src-board', json={'body': 'a comment', 'author': 'tester'})
conn = sqlite3.connect(_board_db_path('src-board'))
conn.execute("INSERT INTO task_runs (task_id, profile, status, started_at, ended_at, outcome, summary) VALUES (?,?,?,?,?,?,?)",
             (parent, 'w', 'done', now - H, now, 'completed', 'a run'))
conn.commit(); conn.close()

att_root = kb.attachments_root('src-board') / parent
att_root.mkdir(parents=True, exist_ok=True)
(att_root / 'notes.txt').write_text('attachment content')

# The metadata row, not just the blob: a moved attachment row has to end up
# pointing at the copy in the TARGET board. Carrying the source's absolute
# stored_path across means pointing at a file the source cleanup deletes.
conn = sqlite3.connect(_board_db_path('src-board'))
kb.add_attachment(conn, parent, filename='notes.txt', stored_path=str((att_root / 'notes.txt').resolve()),
                  content_type='text/plain', size=len('attachment content'), uploaded_by='tester')
conn.commit(); conn.close()

# move parent (+child) to the other board
r = c.post(f'/tasks/{parent}/move?board=src-board', json={'to_board': 'tgt-board'})
print("move:", r.status_code, r.text[:400])
assert r.status_code == 200
assert r.json()['count'] == 2

src_db = sqlite3.connect(f"file:{_board_db_path('src-board')}?mode=ro", uri=True)
tgt_db = sqlite3.connect(_board_db_path('tgt-board'))
# source empty of moved ids
for t in ('tasks', 'task_comments', 'task_events', 'task_runs', 'task_links', 'task_attachments'):
    n = src_db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    assert n == 0, f"source {t} still has {n} rows"
# target holds everything, same ids
assert tgt_db.execute("SELECT COUNT(*) FROM tasks").fetchone()[0] == 2
assert tgt_db.execute("SELECT status FROM tasks WHERE id=?", (parent,)).fetchone()[0] == 'ready'
assert tgt_db.execute("SELECT COUNT(*) FROM task_comments WHERE task_id=?", (parent,)).fetchone()[0] == 1
assert tgt_db.execute("SELECT COUNT(*) FROM task_runs WHERE task_id=?", (parent,)).fetchone()[0] == 1
assert tgt_db.execute("SELECT COUNT(*) FROM task_links WHERE parent_id=?", (parent,)).fetchone()[0] == 1
assert tgt_db.execute("SELECT COUNT(*) FROM task_events WHERE kind='moved_from'").fetchone()[0] == 2
att = kb.attachments_root('tgt-board') / parent / 'notes.txt'
assert att.is_file() and att.read_text() == 'attachment content'
# ...and the ROW has to say so. The file travelling is not enough: a row still
# carrying the source board's absolute path downloads nothing (or worse, reads a
# same-named file that the cleanup has already unlinked).
rows = tgt_db.execute("SELECT task_id, filename, stored_path FROM task_attachments").fetchall()
assert len(rows) == 1, f"expected 1 moved attachment row, got {rows}"
att_task, att_name, att_path = rows[0]
assert att_task == parent and att_name == 'notes.txt', rows
assert Path(att_path).is_absolute(), att_path
assert Path(att_path).is_file(), f"target stored_path is not a file: {att_path}"
assert Path(att_path).read_text() == 'attachment content', att_path
assert Path(att_path) == att.resolve(), f"stored_path {att_path} != the copied blob {att.resolve()}"
src_root, tgt_root = kb.attachments_root('src-board'), kb.attachments_root('tgt-board')
assert str(tgt_root) in att_path and str(src_root) not in att_path, (
    f"stored_path still points into the source board: {att_path}")
# readback through the API on the target board
r2 = c.get(f"/tasks/{parent}?board=tgt-board")
d = r2.json()['task']
assert d['parents'] == [] and len(d['children']) == 1
assert any(cm['body'] == 'a comment' for cm in d.get('comments', [])), d.get('comments')

# guards
assert c.post(f"/tasks/{parent}/move?board=tgt-board", json={"to_board": "tgt-board"}).status_code == 400
assert c.post('/tasks/missing/move?board=tgt-board', json={'to_board': 'src-board'}).status_code == 404
print('ALL MOVE-TESTS OK')