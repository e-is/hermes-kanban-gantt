# Kanban link graph: parent/child semantics for gantt & board plugins

Domain notes for any plugin that reads or MUTATES the kanban task hierarchy
(re-parenting, tree display, dependencies, creating a task under another).
Verified against `hermes_cli`.

## Storage

- `task_links(parent_id, child_id)`, PRIMARY KEY `(parent_id, child_id)` — so the
  model is a DAG: a task MAY have several parents, and the API hands back
  `parents` / `children` as ID lists, never a single parent.
- The store is PER BOARD (each board is its own sqlite file). A link between two
  boards is therefore impossible, not merely invalid — check both ids belong to
  the resolved board and answer 409 with that reason.
- The `/gantt` snapshot decorates every task with `parents`/`children`; the
  drawer detail returns the same plus a `dependencies` list carrying titles
  (`relation: 'parent' | 'child'`). Titles AND statuses are needed to render a
  relation list with status glyphs — statuses only exist on the gantt snapshot,
  so pass that list to the drawer rather than resolving from the detail payload.

## Mutators (own ALL the invariants — never re-implement them)

```
link_tasks(conn, parent_id, child_id, *, expected_child_run_id=None) -> bool
unlink_tasks(conn, parent_id, child_id) -> bool
```

`link_tasks` raises `ValueError` for: self-link, either task missing, a child
whose status is already `running` (unless the owning worker passes its trusted
`expected_child_run_id`), and a link that would create a cycle (`_would_cycle`:
the new parent is already a descendant of the child).

`link_tasks` GATES: when the child was `ready` and the new parent is not
terminal (`done`/`archived`), the child is demoted to `todo` and a
`dependency_wait` event with `reason: parent_not_done` is appended. It returns
`True` in that case so the caller can SURFACE the demotion — an API route that
swallows the flag leaves the user thinking a move was purely visual.

`unlink_tasks` runs `recompute_ready` itself when a row was removed, so a child
freed by the removal is promoted in the same call — no extra recompute needed.

CLI precedent for the vocabulary and the messaging: `hermes kanban link <parent>
<child>` and `unlink <parent> <child>` (the link command prints its own
"was ready and is now todo" notice).

## Gotchas that cost real time

- `create_task(conn, initial_status='running')` does NOT leave a running task: it
  lands as `ready` (no run exists). A test that needs the running-child refusal
  must set the state directly (`UPDATE tasks SET status='running',
  current_run_id=1 WHERE id=?`). The seed gotcha is the same: `create_task` only
  accepts `running`/`blocked` and normalises what it cannot honour.
- A multi-parent task is displayed ONCE: the tree builder walks roots and keeps a
  `visited` set, so a task with two parents is indented under whichever parent it
  meets first. Adding a SECOND parent therefore looks like nothing happened —
  the reason a "drop this under that" gesture should offer *replace* (single
  parent) rather than silently adding one.
- Cycle-only graphs already in the data must not hang the traversal: walk with a
  visited set and assert a cyclic fixture terminates.

## Plugin API surface for re-parenting (agreed shape)

```
POST   /tasks/<id>/parent            { parentId, mode: 'add' | 'replace' }
DELETE /tasks/<id>/parent/<parentId>
```

Both return `parents` (after the change), `status_before` / `status_after`, and
`gated`; the POST also returns the list of `unlinked` parents when it replaced
them. `mode='replace'` unlinks the task's other parents first.

## Creating a task (the write verb a read-only plugin lacks)

```
create_task(conn, *, title, body=None, assignee=None, created_by=None,
            priority=0, parents=(), triage=False,
            idempotency_key=None, initial_status='running', ...) -> task_id
```

- Keyword-only after `conn`, and it returns the new task's ID (a `str`).
- Status is DERIVED, never requested by the caller's UI: `ready`, `todo` when a
  given parent is not terminal (same gating as `link_tasks`), `triage` when
  `triage=True`. Pass NO `initial_status` for the normal path.
- `created_by` is recorded; a plugin backend uses its own identity (e.g.
  `'gantt'`), not a profile name.
- **Not idempotent without `idempotency_key`**: the same title twice creates two
  tasks. The UI must send a key generated once per dialog opening, and a test
  should submit twice with the same key and assert one task exists.
- `get_task(conn, id)` returns a `Task` DATACLASS, not a dict — `task.status`,
  never `task.get("status")` (Pyright flags it, and the backend would raise at
  runtime).

### Full form parity: the fields the official dialog collects

Read them out of `apps/desktop/src/plugins/kanban/board.tsx` before writing a
form — the user compares the two dialogs field by field. Beyond
title/description/assignee/priority/parent/triage: project, workspace (kind +
optional path), skills, model override, goal mode. Domain-side facts:

- `kanban_db.VALID_WORKSPACE_KINDS == {'scratch', 'worktree', 'dir'}` — validate
  it in the route (400 on anything else) so a typo cannot reach the domain; a
  `scratch` workspace takes NO path, so the path field is only rendered for the
  other kinds and dropped when they are not selected.
- The project list comes from the profile's own store
  (`hermes_cli.projects_db.list_projects()`): expose it as `GET /projects`
  returning `{ projects: [{ id, slug, name, path, board }] }`, and degrade to an
  empty list on any failure — a profile with no projects.db must still open the
  creation dialog. Pin it with a test asserting the endpoint answers a LIST.
- Skills arrive as a comma-separated string from the UI: split, trim, drop
  blanks. Model override is a plain string (empty = the assignee profile's own
  model) — say so in the field's hint rather than leaving it blank-meaningless.
- Everything else is passed through untouched: the domain owns the validation,
  and its `ValueError` must surface as a 409 with its own message, never a 500.

Tests worth pinning for the extended form: the full field set round-trips onto
the task through the DETAIL route (body, workspace kind + path, trimmed skills,
model override); an unknown `workspaceKind` is a 400; `/projects` always answers
with a list.

Route shape that matches the re-parenting routes: resolve the board (in an
"all boards" view, create on the CURRENT board — there is no task to infer one
from), 400 on an empty title, 409 when `parentId` is not on the resolved board,
then return `{ ok, task_id, board, status, parent_id }` so the renderer can toast
and open the new task. `hermes kanban create` is the CLI precedent for the
derived status.

Test cases worth pinning (they caught real regressions here): a plain create
lands `ready` AND appears in the `/gantt` snapshot; a sub-task of a non-terminal
parent lands `todo` and shows up as that parent's child in the snapshot; all
optional fields round-trip through the detail route; blank title 400; foreign
parent 409; the same idempotency key twice yields one task.

## UX decisions the user settled (reuse for sibling gantt/kanban plugins)

- Dropping a task that ALREADY has parents asks first: "this task already has N
  parent(s). What do you want to do?" with *add a new parent* / *replace with
  this single parent*, listing the current parents (status glyph + title) above
  the buttons, each removable.
- Relations render as one shared list component (status Codicon tinted with the
  status tone + truncated title) used in three places: the drawer's parent and
  child sections, the drop chooser, and the "move under…" picker.
- The drawer shows parents (removable) and children (read-only), and clicking
  either SELECTS that task and opens its detail — the row-selection state is the
  same atom that drives the open drawer, so setting it does both.
- Removing a parent link asks for confirmation (cancellable) — guard against
  mis-clicks, and use the SDK confirm dialog, not an inline two-step button.
- Candidate parents EXCLUDE: the task itself, its descendants (cycle), tasks on
  another board, `done`/`archived` tasks; a task already linked as its parent is
  shown DISABLED rather than hidden, so the user can see why nothing would
  happen. The create dialog applies the same exclusions, except for the parent it
  was opened with.
- Dragging starts from the title cell only, and a plain click on that cell must
  still open the detail: native HTML5 drag fires only after real pointer
  movement, so the click path survives — do not disable it to make dragging work.
