# Refactoring analysis — kanban-gantt toward maintainable sources

State after the initial import (commit 631f28c): the whole renderer lives in a
single self-contained `desktop/plugin.js` (~2.2k lines of hand-written
`jsx()`/`jsxs()` calls, plain JS, with the pure timeline logic embedded in a
`GANTT_CORE_SRC` template string extracted by tests). The backend is a single
`dashboard/plugin_api.py` (~700 lines).

## Constraint that shapes everything

Hermes loads disk plugins **uncompiled** — plain ESM, only `@hermes/plugin-sdk`,
`react`, `react/jsx-runtime` importable. So "rewrite in TSX" cannot mean
"distribute TSX": we need a **build step** that compiles authoring sources into
the single distributable `desktop/plugin.js`, with `@hermes/plugin-sdk`,
`react`, `react/jsx-runtime` kept **external** (imported, not bundled) and
everything else inlined. The docs' "Bundled" tier (in-tree TSX) is not available
to third-party repos, so the pipeline is: author TS → esbuild → commit the
artifact (or attach it to a release and pin the repo to it).

## Proposed target layout

```
src/
  core/                  PURE logic, no React, no SDK (unit-testable directly)
    timeline.ts          domain, bar range, ticks, weekend bands (ex-GANTT_CORE_SRC)
    status.ts            STATUS_META, ACTION_MATRIX, transitions
  ui/
    GanttPage.tsx        page shell, layout, docked/overlay drawer
    TaskRow.tsx          sticky label cell, connector, checkbox, dot
    Bars.tsx             timeline bars, weekend bands, ruler
    Drawer.tsx           task detail drawer (+ dock/resize handles)
    menus.tsx            Radix dropdown wrappers (assignee, status, bulk, "...").
    i18n.ts              locale bundles (en/fr), bindI18n
  state.ts               atoms ($boardSlug, $labelW, $drawerW, $drawerDocked…)
  api.ts                 fetch wrappers over ctx.rest
desktop/plugin.js        BUILD ARTIFACT (esbuild out) — committed
dashboard/plugin_api.py  backend (already clean; see backend notes)
tests/
  core/                  vitest or node:test against src/core (TS, no stubs)
  ui/                    newswire-style: ESM loader stubs + render smoke tests
  api/                   pytest (existing test_plugin_api.py)
```

## Steps, in order

1. [x] **Toolchain** — DONE: `package.json` + `scripts/build.mjs` (esbuild),
   `npm run build` → `desktop/plugin.js` + `desktop/gantt-core.js`, externals
   `@hermes/plugin-sdk` / `react` / `react/jsx-runtime`; `npm run check`
   (syntax), CI drift guard: rebuild + `git diff --exit-code desktop/`.
2. [x] **Extract the pure core** — DONE: `src/core/gantt-core.ts` (real
   exported functions, no template string, no eval). `desktop/gantt-core.js`
   is the built artifact consumed by `tests/gantt-core.test.mjs`.
3. [~] **Split the renderer** — started: the whole renderer lives in
   `src/main.ts` (byte-identical logic to the pre-port plugin.js, imports the
   core module). Remaining: mechanically convert `jsx()` calls to JSX per
   component (`GanttPage`, `TaskRow`, `Bars`, `Drawer`, `menus`), one commit
   per component with the manual checklist after each.
4. [x] **Type the SDK boundary** — DONE: `src/sdk.d.ts` (loose ambient types
   for the SDK subset in use; tighten per module later).
5. [x] **Tests to Hermes expectations** — core tests run against the built
   artifact without any eval, and `tests/ui/esm-render.mjs` imports the built
   plugin as ESM against SDK/react stubs to assert register + page render +
   the page-header switcher contribution without a browser. Remaining: core
   unit tests for DST boundaries, min-bar width, archived filtering.
6. [ ] **Backend notes** — split `plugin_api.py` only if it keeps growing.

## What NOT to do yet

- No behavior changes during the port (commits must be mechanically verifiable).
- No dependency on a React framework/build beyond esbuild.
- No TS strictness war: start `strict: false`, tighten per module.

## Risks

- **Artifact drift** — the committed `desktop/plugin.js` can go stale vs `src/`.
  Mitigation: CI check (rebuild + `git diff --exit-code desktop/plugin.js`).
- **Radix/Slot pitfalls** (`asChild` single child) and Electron drag regions
  are regression-prone — keep the AGENTS.md gotchas and the UI smoke tests.
- The GANTT_CORE_SRC extraction trick is gone: the core is a real module
  (`src/core/gantt-core.ts`) built to `desktop/gantt-core.js`, which the node
  tests import directly.
