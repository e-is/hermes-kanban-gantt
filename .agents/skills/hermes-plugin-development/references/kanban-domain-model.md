# Kanban domain model (what to respect, what not to re-derive)

Facts verified against `hermes_cli` (domain, dispatcher prompts) and the core kanban plugin.

## Links are prerequisites, not containment

`task_links(parent_id, child_id)` is a **Finish-to-Start dependency**: the parent must reach a
terminal state (`done`/`archived`) before the child becomes runnable. `link_tasks()` gates a
`ready` child back to `todo` (event `dependency_wait`, reason `parent_not_done`, returns True so
the caller can warn); `unlink_tasks()` recomputes and promotes the unblocked children. So:

- the parent is a **predecessor**, never a container/summary task;
- draw the connector parent -> child; inverting it would show the opposite of what the domain does;
- never add a rollup bar spanning children — a parent has its own run window like any task;
- in UI copy prefer "blocks / blocked by" over "parent / child" when speaking of execution order.
This differs from classic Gantt/WBS, where a "parent" is a summary whose finish is the max of its
children — that notion is NOT what this field means. A cross-board parent is invalid: `task_links`
lives in the board's own sqlite file, so reject it with a dedicated 409.

## Epics are a task kind, grouping is the project

- `task_kind: epic` (`hermes kanban create --kind epic`) = a planning/decomposition task: it breaks
  the work down and creates follow-up tasks; the dispatcher explicitly says not to build the epic's
  body of work in it.
- `project_id` is the grouping field and is **required** for an epic (and for its follow-up tasks).
  Grouping never uses `parents` — the upstream skill states it plainly: `parents` gates readiness,
  it is not a bulk import group.
- An epic runs the normal lifecycle (`todo` -> `ready` -> `running` = planning -> `review`) and lands
  in `todo` without a session. Never mark an epic `done` yourself when it has no children: `done`
  is meant for the task whose children all finished; report back instead. Group closure is signalled
  with `hierarchy_closed` (optional `group_id` when an epic owns the group).

## Practical consequences for a plugin

- Always let the domain decide and only surface its verdict: create statuses are derived
  (`ready`, or `todo` while a parent is unfinished, `triage` when asked) — never offer a status picker.
- Creating a task is not idempotent without `idempotency_key`: send one per dialog opening so a double
  click cannot create two tasks.
- A read-only view of a board (timeline/gantt) needs three verbs to become an editor: create a task,
  link a parent, unlink a parent — each a thin route over `hermes_cli.kanban_db`, guarded by its own
  tests.
