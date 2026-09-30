# Changelog

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
