# AGENTS.md — Hermes Kanban Gantt

Operating instructions for coding agents (Hermes, Codex, Claude Code, …).

## Project purpose

A Gantt timeline view plugin for Hermes Desktop: full-page `/kanban-gantt`
route rendering any Hermes kanban board as a timeline of real work
timestamps, with task creation, re-parenting, a task detail drawer, filters
and bulk operations. Zero API keys, zero model tokens.

## Where to read

- `.agents/skills/hermes-plugin-development/` — the working procedure for this
  kind of plugin (SDK gotchas, verification loop, PR and catalog rules). It is
  vendored here because it is not published upstream; its `references/` carry
  the topic depth.
- `~/.hermes/hermes-agent/website/docs/developer-guide/plugins/index.md` and
  `…/application-declarations.md` — what a plugin may declare and where it is
  mounted. `…/desktop-plugin-sdk.md` — the renderer SDK. One page per
  capability surface lives beside them (`plugin-llm-access.md`,
  `model-provider-plugin.md`, …).
- `README.md` — install, layout, demo and the feature list users read.

## Architecture map

```
plugin.yaml              unified plugin manifest (name/version/requires_hermes)
__init__.py              no-op register() (capability probe only)
dashboard/manifest.json  dashboard-plugin manifest (api: plugin_api.py)
dashboard/plugin_api.py  BACKEND — FastAPI router: gantt snapshot from the
                         shared kanban SQLite store, task detail, creation,
                         parent links, status/comments/assignee, bulk ops
desktop/plugin.js        RENDERER ARTIFACT — plain ESM, loaded uncompiled
desktop/gantt-core.js    pure-core artifact (tests and the demo import it)
src/                     AUTHORING SOURCES (TypeScript) — bundle with
                         `npm run build`; desktop/*.js are generated
  main.ts                page, rows, bars, drawer, drag & drop
  state.ts               atoms + the REST door (verb always forwarded)
  core/gantt-core.ts     pure timeline/hierarchy logic (no React/SDK)
  ui/                    NewTaskDialog, ReparentChooser, TaskRelations, switcher
install.sh               optional installer (desktop half → desktop-plugins/,
                         backend half → plugins/)
tests/                   node:test (core, REST door, sticky label), pytest
                         backend suite, demo server (demo.html + /plugin.js + API)
```

- **Backend owns** all SQLite/kanban data access. Routes live under
  `/api/plugins/kanban-gantt/` and delegate their invariants to
  `hermes_cli.kanban_db` — a write route surfaces what the domain decided, it
  never re-derives a rule.
- **Renderer owns** the visuals. `desktop/plugin.js` must stay SELF-CONTAINED
  (only `@hermes/plugin-sdk`, `react`, `react/jsx-runtime` imports — rewritten
  by the desktop loader); never edit it by hand, run `npm run build`.
- **Persistence**: plugin prefs (`labelW`, `drawerW`, `drawerDocked`,
  `board`, `zoom`, `disabledStatuses`, `baseUrl`) go through `ctx.storage`
  — never localStorage directly.
- **Desktop placement**: the board switcher is contributed to
  `WORKSPACE_PAGE_HEADER_AREA` (the page's own tab row, like the official
  kanban plugin), NOT `titleBar.center`. Page chrome is mount-scoped.

## Tests

```bash
npm run build && npm run check
node --test tests/gantt-core.test.mjs tests/rest-method.test.mjs
bash tests/run_tests.sh        # pytest backend (isolated venv, HERMES_AGENT_HOME)
```

## Gotchas

- Radix `asChild` slots accept a SINGLE element child — arrays throw
  "Primitive.button failed to slot onto its children".
- Electron drag regions ignore `pointer-events: none`; interactive chrome in
  the titlebar band needs an explicit no-drag on its own subtree.
- `desktop/plugin.js` is loaded uncompiled: `npm run check` + the node:test
  suite are the fastest regression gate before any reinstall.
- New backend routes need a gateway restart (routes mount at boot); the UI
  half only needs a plugin reload.
- Declaring a UI token that does not exist resolves to nothing and paints the
  surface TRANSPARENT — grep the desktop's token definitions before using one.
