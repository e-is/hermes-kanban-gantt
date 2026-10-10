# Changelog

## 1.5.0 — the detail as a modal, attachments at last, and two fixes measured rather than guessed

**The task detail opens as a modal.** A switch in the detail header — next to the close
button, where a window-level control belongs — presents the same body either as the panel
beside the gantt (unchanged, still dockable and resizable) or as a centred modal whose
right-hand column carries the facts worth a column: status, assignee, workspace, created,
last activity and the attachments. The body is built once and rendered into whichever
container is asked for, so the two presentations cannot drift apart. The dock control is
hidden in the modal, where there is nothing to dock.

**Attachments are visible.** Every task lists its files under the description, with a
download button on each and a preview button on the markdown ones; a preview opens its own
closable dialog and renders the markdown with the app's own renderer. The plugin REST door
speaks JSON only, so a new backend route answers with decoded text when the file is
text-like and base64 otherwise, and the client rebuilds a Blob from that. The route
resolves the stored path and refuses anything outside the board's own attachments tree with
a 404 — the same answer as a missing file — so a hand-edited row cannot turn it into a file
reader.

**The search finds a task by its id.** Ids are how tasks are referred to outside the board
— a comment, a log line, another task's summary — so `t_fb50c792`, `fb50c792`, `FB50C792`
and `fb50` all find it, while titles and labels keep matching as before.

**Markdown no longer renders oversized.** Measured rather than guessed: the bodies asked
for Tailwind Typography's `prose-sm`, and that variant is not in the desktop's precompiled
stylesheet at all — 0 occurrences, while the base `prose` variant and its heading rules are
compiled — so the base ratios applied (h1 at 2.25em) on a body pinned to 11px. Descriptions,
results, run summaries and comments now render through the SDK's `MessageTextContent`, the
component the chat and the official kanban plugin use, and the hand-written colour mapping
that existed only for the old renderer is gone with it.

**The `default` board is served.** The board-path guard modelled `default`'s back-compat
database as `boards_root().parent` — one directory too deep, `<root>/kanban/kanban.db` —
so on a stock layout it refused the very file the core resolves, and `?board=default`
answered 404 with a message about pinning that was not in play. The path now comes from the
core (`kanban_home()/"kanban.db"`) instead of being re-derived. The refusal also stopped
being reported as "backend unreachable": a board-path refusal names a cause as specific as
a missing database does. Reported by @Helios766 (#10).

Tests: 70 node tests + 11 ESM render checks + 51 pytest, plus the standalone move
integration run.

## 1.4.2 — two rendering defects, one cause each

**A fold could only ever ADD rows.** On a multi-parent board a task legitimately holds
several rows — its primary position, plus one under each later parent that reaches it —
and the renderer keyed every one of them by task id. Handed duplicate keys, React reuses
and abandons nodes, so rows a fold had removed were never unmounted: the count crept up
on each toggle and the strays read as DOM leftovers. Rows now carry the parent they hang
under and the key names the POSITION. Measured before: one click took the rendered rows
from 35 to 37. After: four collapse/expand round-trips leave every counter unchanged, and
the pure core yields 21 rows with 21 distinct keys over the demo board's real 20-task
graph (24 distinct keys with a search, where four positions share one id).

**The profile initials sat in the lower half of their circle.** Two causes, both
measured. `text-[8px]` is an arbitrary Tailwind value and the desktop's stylesheet is
PRECOMPILED, so it was never emitted and the text kept the shell's 11px on a 16.5px line
— a line box taller than a 15px circle, which cannot be centred. And centring a line box
is not centring the ink: the baseline still hung 5.69px below the circle's centre. The
size is now explicit and relative to the circle, the inline box is trimmed to the cap
height (`text-box-trim` + `text-box-edge`), and the initials own a block — without it the
trim does nothing, because a text node that is a direct child of a grid lives in an
anonymous item. Offset after: +0.37px, from -2.69px.

Also: the refactoring snapshot and the demo board's own spike artifacts are gone, and
`docs/TODO.md` keeps the open work with its finished item corrected.

Tests: 69 node tests + 11 ESM render checks + 45 pytest, plus the move integration run.

## 1.4.1 — a moved attachment keeps naming a file

**Cross-board moves rewrote everything about an attachment except the one thing
that matters: where its file is.** `stored_path` is absolute and built as
`<attachments root>/<task id>/<file>`, so copying the row as-is made a moved
attachment name the file in the *source* board, under the source's task id — and
the move's own cleanup then deleted exactly that tree. Every attachment on a moved
task downloaded nothing, deterministically rather than eventually. The target now
rewrites `stored_path` to its own root and the task's new id (the same move
`hermes_cli.kanban_transfer` makes when it rehomes a board), a row whose blob is
already missing is dropped instead of carried across, and the pre-cleanup
verification checks that each moved attachment resolves to a file — a move that
cannot produce the blob now fails while the source is still intact. Reported by
@teknium1 in review of the 1.4.0 catalogue pin.

`tests/move_integration.py` asserts that the target's `stored_path` *is* the copied
file and that it does not point into the source board. It is a standalone script,
so pytest never collected it and nothing ran it: `tests/run_tests.sh` now does, and
those assertions gate the suite.

Tests: 68 node tests + 11 ESM render checks + 45 pytest, plus that integration run.

## 1.4.0 — a collapsible tree, a list view, and a capture pipeline that states its own inputs

**The task column is a tree.** Every task with children carries a boxed `+` / `−`
that folds its **whole** subtree (a leaf keeps the slot, so titles stay aligned),
with the explorer's connectors: a vertical down every level that still has a
sibling below it, plus the `├` / `└` elbow for the row itself. A global toggle sits
in the column header, in front of the master checkbox. The fold state is persisted
**per board**; a search ignores it — everything opens, matches are flagged — without
writing to it, so clearing the query restores exactly the branches you had.
Selecting a task tints its descendants, which is what makes a child not printed
directly beneath its parent visible. On a multi-parent board a task is still printed
once, under its first parent: a later parent shows a **dashed** square, closed by
default, which reprints the child without repeating its subtree — so the link is
always visible and a task never disappears because its first parent happens to be
collapsed. The column's arithmetic lives in one pure, tested function (`treeMarks`)
so the renderer cannot drift from the tests.

**A list view beside the timeline.** A List / Timeline toggle in the header trades
the bars for full-width columns — task, assignee, status, last activity — for boards
where most cards are decisions or approvals and the bars show mostly empty track.
The choice is persisted and the timeline stays the default. Both views share the
task column, so the fold squares, the connectors and the indentation stay.

**Cross-board moves work at all.** Moving a task to another board failed with
`UNIQUE constraint failed: task_events.id`: the copy carried every column, including
the row's own identifier, and comments, events, runs and attachments are numbered
from 1 independently in each board — so any target with history refused the insert.
The target now assigns those ids, the task id still travels when it can (and is
regenerated on a real collision), and `task_events.run_id` is bridged through a map
so a moved event keeps pointing at a run **of its own task**.

**Bulk assign stores.** The selection bar dropped the `assignee` field, so the
backend received a bare `action: 'assign'`, answered 400, and nothing surfaced. The
field travels, per-task failures raise a toast, the assignee choices merge the
board's assignees with the Hermes profiles, and each row shows its assignee.

**The capture pipeline states what it wants.** It forces the timeline before the
first still, fixes the task column's width and the shell's light appearance (and puts
both back afterwards), drops the drag-and-drop capture — it was near-useless, and the
drag it left behind contaminated every later still — and captures the folded tree and
the list view alongside the rest.

**A catalogue card, drawn not generated.** `scripts/card.py` composes the 2:1 banner
in HTML/CSS and rasterises it with the Chromium Hermes ships; `npm run card` renders
it alone and `npm run shots` calls it at the end, so the card cannot drift from the
release it describes.

Tests: 68 node tests + 11 ESM render checks + 45 pytest (124 in total).

## 1.3.4 — the websocket gate fails closed, and a finished task can be a parent again

**The `/events` upgrade gate refuses when the core gate raises.** The `try/except`
around the auth step also wrapped the gate *call*, so an exception inside the gate
fell back to "accept if the client is loopback" — and behind a loopback reverse
proxy every client looks like 127.0.0.1, which would have served board snapshots
(task titles and bodies) without authentication. Raised in review of the catalog
listing. Only the import falls back now; a raising gate is a refusal, the same
shape the bundled kanban plugin uses. Four tests pin it, starting with that exact
regression: a loopback client plus a gate that raises must refuse.

**A finished task can take a parent again.** Dropping a task under a Done task is
the case the hierarchy exists for — a parent is a prerequisite to finish before
its children — but the UI refused it: the candidate helper tagged every
done/archived task with a `terminal` reason, which greyed it out in the
"move under" picker *and* removed the drag-and-drop target, since both read the
same map. The domain never refused it, and it only demotes a child when the parent
is **not** terminal.

**Tests.** `tests/run_tests.sh` now collects the whole tests directory instead of
naming one file, so a new test file is no longer invisible to the suite
(39 → 43 pytest; 54 node).

## 1.3.3 — edit a task's description, and a restart no longer mutes the push

**The drawer edits descriptions.** The DESCRIPTION section carries the pencil the
reference kanban drawer has: press it and the body opens as raw markdown in a
textarea with an explicit Save underneath; press it again (now a close) to leave
without writing. The section is always rendered, so a task with no description can
be given one. `PATCH /tasks/{id}/description` writes the body verbatim, records the
`edited` task event and calls `notify_task_updated` — the same write the reference
dashboard performs — so the push carries the change to other clients. An empty
string clears the description; a payload that omits the field is a 400, so no
client can wipe a body by omission.

**A draft is never lost to a stray click.** Clicking another task while a draft was
unsaved used to swap the drawer and leave the editor open on the previous task's
text. The draft now pins the drawer to the task it came from — both what it queries
and what every write targets — and the switch asks first: Save and open, Discard
changes, or Keep editing.

**A gateway restart no longer mutes the push.** The version counter lives in the
gateway process, so a restart numbered frames again from 1; the client discarded
every frame at or below its old baseline while heartbeats kept it looking live,
which turned a live page into a 300 s poll in silence. A lower version is now read
as a new stream (the frame is a full snapshot) and resets the baseline. The
all-boards view — which the server refuses to stream, having no single database to
watch — no longer opens the socket at all: it stays on its 60 s poll, where the
Refresh button is shown.

**On newer hosts.** Hermes moved the board-connection factory out of
`hermes_cli.kanban_db` into `hermes_cli.kanban_db_connect`, which made every write
route raise `AttributeError` while reads kept working. `_connect()` now resolves the
factory from either module, so writes work on both lines.

## 1.3.2 — Refresh stays reachable when the push is off

Removing the Refresh button was right while the push is live, but it left anyone who
turned the push off without a verb: with `KANBAN_GANTT_WS=0` on the gateway — or the
`ws` flag set to `0` in the plugin's storage — the page falls back to the 60 s poll.
The button now renders only for the two states where the page is knowingly on the
poll (`WS_STATE.off` and `WS_STATE.dead`, the latter while the socket waits to
re-arm) and stays hidden while it is connecting, so it does not flicker at load.
Both labels carry a tooltip saying why it is there. Verified on the running desktop
by flipping the storage flag: `wsState live` → no button, `ws='0'` → one button
labelled Refresh, restored → gone again.

`plugin.yaml` declares that switch as `optional_env` (`KANBAN_GANTT_WS`), the
manifest field the setup wizard and `hermes plugins info` read, instead of leaving
it to folklore.

## 1.3.1 — live without a Refresh button, and fewer ways to be stranded

**The page updates itself.** The gantt subscribes to the plugin's `/events`
websocket (a gateway disables the route with `KANBAN_GANTT_WS=0`; storage `ws` =
`'0'` opts a profile out) and applies the pushed snapshot to the same cache the
60 s poll fills. Verified on the running desktop: with the page open, a write made
outside the UI reached the screen in 1.2 s with **zero `/gantt` requests** — so the
Refresh button is gone. The socket re-arms on its own after a gateway restart
(uvicorn closes every socket with 1012) and follows the active connection, so a
gateway switch or an in-place backend restart no longer degrades the page to
polling until someone reloads it. Its lifecycle is persisted (`wsState`, `wsOff`)
so a failure is diagnosable instead of silent.

**Fewer ways to be stranded.** The remembered board is scoped per connection and
validated against `/boards`: a board chosen while another gateway was active — or
one that no longer exists — falls back to the current board with a warning, instead
of answering 503 forever behind a "backend unreachable" message that blamed a
healthy gateway. A board slug that resolves outside its own database is refused
outright: a gateway started from a kanban worker's shell inherits
`HERMES_KANBAN_DB`, which used to make every slug answer with that pinned board's
data under the wrong name.

**UI.** The header row gets its right padding back; the creation dialog takes the
bundled kanban plugin's shell (wider, and it no longer crops the project / parent /
skills popovers born inside it); the resize handles show the shell's own affordance
again — full height, in the accent colour — instead of a Tailwind class the
desktop's precompiled stylesheet never contained.

**Screenshots.** `npm run shots` drives the real desktop over CDP and refreshes
`docs/screenshot-en-01..04.png` plus `docs/animations/kanban-gantt.gif|mp4`. The
board it captures is dispatched by the real gateway, so the harness removes it when
a run ends.

## 1.3.0 — task creation and re-parenting

A full creation form (title, description, project, workspace kind + path, assignee,
priority, skills, model override, goal mode, parent, triage), re-parenting by drag
and drop or from the drawer, dependency tree connectors, and the REST verbs they
need (`POST /tasks`, `GET /projects`, `GET /profiles`, parent linking) — with the
domain deriving statuses so the page never asks for one.
