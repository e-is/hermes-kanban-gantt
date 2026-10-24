# Changelog

## 1.7.1 — scopes you can combine, and a graph that reads straight down

**The quick scope becomes four, and gains a modifier.** It was one combined thing — *Running +
lineage* — which meant a reader with blocked work had no scope for it, and a reader who wanted only
what is running got the whole closure whether they asked for it or not. It is now **Running**,
**Blocked**, **Open** and **All**, each a single status filter, and **+ lineage** sits right after
them as a switch of its own: it widens whichever scope is chosen to everything that leads to the
selection and everything that follows it. The switch disappears on *All*, where the closure of
everything is everything — an off switch that cannot change anything is a lie you only discover by
clicking it. A preference stored before the split is read as *Running* with the modifier on, so an
existing reader keeps the view they chose.

**The lineage widens in all three views, not just in the graph.** The three views were reading the
closure off the set the other filters had already cut down — where the parent the modifier should
reach is gone, and every edge pointing at it has been dropped as dangling. So the closure was empty
and the switch did nothing in the list and the timeline; the graph only *looked* like it worked
because it lights a click's lineage, so its ancestry happened to be on screen. The selection is now
computed once, over the whole board: a scope narrows what the funnel allows, and the lineage
deliberately does not, since the tasks it brings back are exactly the ones the funnel just removed.

**A parent sits over its children.** In the top-down drawing, a parent could land a whole card to
one side of the children it leads to — the sweeps that aim at their mean aim in fractional slots,
and the row's own no-overlap rule then pushed them back into line. A pass after them moves a parent
onto the mean of its children, but only when the spot lies strictly between its two neighbours, so
it can remove a sideways link and can never overlap two cards or cross a row.

**Selecting a card in the graph no longer fails.** The `lineage` prop the plugin hands to the graph
took the name of the core's `lineage` function, which the same component calls to light a
selection — so inside it the name referred to a boolean, and the first click that asked for a
lineage raised *"lineage is not a function"*. The bundle compiled anyway: esbuild does not
typecheck, and nothing exercised a selection. The import is aliased now, and rendering the graph
*with* a selection is asserted, which is the path that failed.

Tests, all measured on this commit: 153 assertions in the Node suites (61 of them in the graph
core, including the new ones for the four scopes, the closure with and without the modifier, and the
refusals of the centring pass), 69 render checks — fifteen of them in the list, the timeline *and*
the graph — 23 hook-order checks, and 57 pytest tests.

## 1.7.0 — a third view: the shape of the work, and links you can draw

**The plugin gains a third view.** List answers *what*, Timeline answers *when*, and **Graph**
answers *what hangs off what*: a card per task, an arrow per parent → child link, laid out by
longest path so a task always sits below its parents. The toggle that traded List and Timeline
now carries three values, with the same persistence — per board, so a board you read as a graph
does not drag the next one with it.

**The drawing is a function, not a drawing routine.** Ranks, the transitive reduction, the
lineage walk and the four arrangements live in `src/core/graph-core.ts`, which knows nothing
about the DOM and is unit-tested in Node like the Gantt core: a diamond's three links draw two
arrows and *count* the implied one in the footer rather than hiding it, a chain ranks without
recursion, and a hand-edited board that closes a loop is drawn at the deepest rank it can reach
instead of hanging the page — every traversal carries a visited set and a depth cap, and the
tests fail on a hang rather than waiting for one. Perf is a budget, not a claim: 500 nodes lay
out in a few milliseconds, 2000 in under 400, measured with `performance.now()` in the tests.

**Four arrangements**, taken from the vocabulary of `kanban-graph` so the two read alike:
`Flow, top down` (the default, a dependency tree), `Flow, left to right`, `Columns by status`,
and `Compact grid`. Each is remembered per board, and tasks nothing depends on — and that
depend on nothing — are packed into a trailing row instead of stretching the layout into a
ribbon, which is what lets the fit keep the cards large.

**The camera is the timeline's.** Ctrl/⌘ + wheel zooms at the cursor, a plain wheel scrolls,
Shift+wheel pans, a drag on the empty canvas pans at any zoom (the old rule only worked at fit
zoom, where empty space happens to sit under the pointer), and `0` / `+` / `−` do what they do
in `kanban-graph`. **Fit** is a mode, not a button press: while it is on the view reframes
itself as the pane resizes — opening the detail pane no longer leaves half the graph outside
the frame — and any gesture of your own hands the camera back to you. A click on the empty
canvas clears the selection, which was previously only possible by closing the drawer.

**Links are editable where they are drawn.** Every card carries a **slot** — a dot hanging
under its border, halfway to the card below, tied to its card by a short stem — and dragging
from it draws an arrow that *adds* a parent; it never moves one, never detaches one, and asks
nothing. Releasing over a legal card snaps the head to that card's border, so the gesture says
what it is about to do before it does it. An arrow you point at thickens, a right click offers
to delete it, and each end carries a grab dot that moves that end to another card. What may be
linked is what the domain allows, from the same gate the drag-and-drop already used: no cycles,
no finished parents.

**Scopes are shared by the three views.** `Running + lineage` (what is live, and everything it
blocks or waits for), `Open`, and `All` sit in the toolbar; the scope a reader picks filters
the graph *and* the timeline *and* the list, because all three now narrow through the same pure
function. The funnel menu shows the checks and says when a status is out of the picture because
of the scope, and the legend strikes through what the scope rules out, instead of describing a
view nobody is looking at.

**A card keeps the density of a row**: status icon in its tone, the run's arc while it runs, a
failed-run warning, the title (wrapped onto two lines rather than cut), priority, and the whole
lineage lit when you select one — clicking a node opens the same detail drawer the other views
open, and a click on the canvas closes it.

**The detail reads in three tabs.** Comments, Activity and Runs are now siblings under a
segmented strip, with the count as a badge beside the label, and an empty feed is not offered
as a tab at all. The drawer and the modal also end with the task's own shell command — `hermes
kanban --board <slug> show <id>` — monospace, selectable, with a copy button that says so.

**Shipped but not shown: board tabs.** A tab per open board is implemented and deliberately
hidden behind `SHOW_BOARD_TABS = false`: a tab is a full page instance of its own — own mode,
own zoom, own arrangement — and with the "all boards" pseudo-board, the drawer and the header
switcher in the same room, they still disagree in ways a reader would call bugs. The code
stays, the strip comes back with one word.

Every new string is translated in English, French and Chinese in the same edit, and the
catalogue screenshot of the graph is part of the release: the vertical flow, scope `All`, on
the demo board.

## 1.6.3 — a mislabelled file can no longer run, and "ready" stops answering 500

**A security fix.** The previewer chose its renderer from the file name, but handed the Blob the
type the board *declared* — so a file named `x.pdf` stored as `text/html` reached the PDF frame,
which is not sandboxed, as script-capable HTML on the desktop origin. A model can plant one: the
core's `kanban_attach` takes a content type from its caller, and `kanban_attach_url` copies the
remote server's `Content-Type`. The Blob's MIME is now derived from the kind the previewer picked,
so the unsandboxed frame can only ever receive `application/pdf`; `text/html` is produced only for
the kind that is rendered inside a sandboxed frame, and a file that matches no kind falls back to a
type no renderer acts on.

**Moving a task to "ready" from `todo` or `triage` answered 500.** The route imported
`_set_status_direct` from `hermes_cli.kanban_db`, where it has never existed — it lives in the
bundled kanban plugin — so the import raised and the request failed. It now goes through the public
`kanban_db.promote_task`, which is also what applies the parent gating, with the plugin's own direct
write as the fallback for origins `promote_task` does not accept.

## 1.6.2 — the web dashboard stops offering a tab it cannot load

Installing the plugin and opening the web dashboard gave a broken tab: "Could not load this plugin's
script". A `dashboard/manifest.json` always implies a page — the registry fills in `entry:
dist/index.js` and a tab at `/<name>` when the manifest is silent — and this plugin shipped no page
bundle, so the SPA asked for a script that did not exist.

The page now exists: `dashboard/dist/index.js`, a plain IIFE with no build step (the shape the
bundled kanban plugin uses), which loads cleanly and says where the timeline actually lives — the
desktop page — and which data routes this dashboard does serve. Its strings are translated
(en/fr/zh), and the language follows the dashboard's own active locale through the SDK's `useI18n`
rather than guessing from the browser.

The plugin's `description` says the same thing in one line, so nobody has to open a broken tab to
find out.

## 1.6.1 — attachments on the rows, a filter to find them, and a detail that reads

**A task with files says so on the board.** A paperclip sits beside the assignee on the timeline,
and in a dedicated narrow column at the end of the table in list view, on the tasks that have
attachments and nowhere else. Opening it lists the files with the two things one does with a file —
look at it, or save it. The board's payload carries a count per task, never the filenames: the list
is fetched when the paperclip is opened, so listing a board costs the same whether its tasks hold
three attachments or three thousand.

**The preview reads the file's type.** Markdown through the app's own renderer, plain text as text,
images and PDFs rendered, HTML in a sandboxed frame — an attachment is user-supplied text and must
not run scripts. Anything else stays download-only rather than pretending. The bytes never ride with
the board payload: they come from the plugin's own content route, which runs on the gateway that
owns the board, which is why a remote gateway needs no proxy.

**A filter finds the tasks that have files** — "only tasks with attachments", off by default, in the
funnel menu beside the status and assignee filters, and composed with them.

**The keyboard walks the rows.** With the detail docked, ↑/↓ move the selection one row down or up
in the displayed order and open that task, keeping the focus on the row so the next press continues
from there. Inside the preview, ←/→ walk a task's files, wrapping, and a task with a single file
shows no navigation at all.

**Clicking a file name acts.** A name whose type can be previewed opens the preview; a name that
cannot is a download, with a tooltip that says so instead of promising a preview that cannot happen.

**The detail reads like a document.** In the modal, the right-hand column carries the facts —
status, assignee, **priority**, workspace, dates, the attachments as a real section with their eye
and their download, and the parent and child links. The body is left for reading: description,
result, latest summary, comments. Priority was absent from both views before, and is drawn the way
the official plugin draws it: an upward arrow and the number in amber.

**An empty relation section is not drawn**: "no children" on a leaf task, "no parents" on a root
one, were blocks that had nothing to say.

## 1.6.0 — attachments on the board, a timeline you can steer, three languages

**Attachments reach the board itself.** A task with files carries a paperclip next to its
name, on the timeline and in list view alike. Opening it lists the files with the two things
one does with a file — look at it, or save it — and the eye appears only for the types the
webview can actually render, so the control never promises what it cannot do. The file names
are fetched when the paperclip is opened: the board's payload carries a count only (one
`GROUP BY` per board), so listing a board costs the same whether its tasks hold three
attachments or three thousand.

**The preview reads the file's type.** Markdown keeps the app's own renderer, plain text is
shown as text, and images, PDFs and HTML render in the dialog — HTML in a sandboxed frame,
because an attachment is user-supplied text and must not run scripts. Anything else stays
download-only rather than pretending. The bytes never ride with the board payload: they come
from the plugin's own content route, which runs on the gateway that owns the board, which is
why a remote gateway needs no proxy. The dialog is a reading surface rather than a keyhole,
with previous/next arrows in a toolbar, a position counter, and ←/→ keys that wrap; a task
with a single file shows no navigation at all.

**The timeline is steerable.** Hour gridlines appear once the scale passes a threshold, a
"now" line marks the present moment, and the wheel zooms anchored at the cursor — with
Ctrl/⌘ only, so a bare wheel keeps scrolling the rows as it should, and Shift+wheel pans. The
scale runs from 1 to 100 %, where 100 always means "six hours across the pane", whatever the
pane's width — and it stops there, because zooming further smears the ruler without adding
anything. Five period shortcuts (6 h, 12 h, 24 h, 3 d, 7 d) put a slice of the timeline on
screen in one click, stay calibrated when the pane or the name column is resized, and clear
themselves the moment the scale or the scroll moves: they describe what is on screen, so they
stop claiming it once it is no longer true.

**Titles are shown verbatim.** A leading `[EPIC]` or `[P0]` is the author's text and is
rendered as written. An option in the "…" menu turns that prefix into a tag when it reads
better that way, and only then.

**Chinese joins English and French**, including every string the new period, prefix and
attachment features introduced.

**Tones mean one thing each.** Red is reserved for hard failures — crashed, failed,
spawn_failed — and is taken from the outcome of the run rather than the task's current status,
so a recently failed task no longer looks like a task that is merely blocked. Amber is
blocked, green is live, pink is review.

**An empty board invites the first task.** The empty state keeps its message, drops the
legend, which has nothing to describe there, and offers a "New task" button right under it.
The period selector is hidden in list view, as the zoom slider already was: both are timeline
affordances, and a disabled control in a view that cannot honour it is just noise.

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
