# Standalone plugin repo + TSX refactor

Depth for porting a project-repo plugin to a standalone unified repo, and for the later TSX refactor. Reference docs: Desktop Plugin SDK (developer-guide/desktop-plugin-sdk, sections "One package, both SDKs", "Distributing with an install link", "The Python side") and CONTRIBUTING.md's standalone-plugin policy.

## Unified repo layout (what the shell expects)

```
<repo>/
├── plugin.yaml               # name/version/description/author, kind: standalone, requires_hermes
├── __init__.py               # no-op register(ctx): the capability probe requires a register() to exist
├── dashboard/
│   ├── manifest.json         # { "name": "<id>", "label": ..., "api": "plugin_api.py" }
│   └── plugin_api.py         # FastAPI router → /api/plugins/<id>/
├── desktop/
│   └── plugin.js             # plain ESM, loaded uncompiled; the shell copies this to desktop-plugins/<id>/
├── install.sh                # OPTIONAL convenience installer (re-point at desktop/plugin.js)
├── tests/                    # node:test core, pytest backend, optional browser tests, demo server
├── README.md / AGENTS.md / .gitignore / LICENSE
```

The renderer half is app-level: the Electron main process copies `desktop/plugin.js` to `desktop-plugins/<id>/` beside a `.hermes-package.json` marker, refreshed on rescan/update and removed with the package folder. Both enable switches (desktop Capabilities toggle + `plugins.enabled` in config.yaml) default OFF.

## Port checklist (from a project-repo `hermes/plugins/<id>/`)

1. Copy halves into `desktop/` and `dashboard/`; copy `plugin.yaml` (extend to the unified fields: author, kind: standalone, requires_hermes) and write the `__init__.py` no-op register.
2. Fix every `join(HERE, '..', 'plugin.js')` in tests/demos to `join(HERE, '..', 'desktop', 'plugin.js')` (demo servers: `const PLUGIN = join(HERE, '..', 'desktop')`); keep `SCRIPT_DIR` anchoring in the pytest runner.
3. If keeping `install.sh`, re-point it at `desktop/plugin.js`.
4. Write README (features, install-by-clone, layout, architecture, tests) and a short AGENTS.md (architecture map, gotchas, test commands).
5. Run: `node --test tests/gantt-*.test.mjs` (core) and `tests/run_tests.sh` (pytest). Browser-dependent tests must SKIP cleanly when playwright is missing — probe import specs in a loop and `process.exit(0)` with a `SKIP:` warning.
6. Initial commit + push; the catalog listing is a separate PR to hermes-agent (model: the accepted catalog-listing PR that added the newswire entry).

Install-by-clone path for users: `git clone <repo> ~/.hermes/plugins/<id>/` → desktop half lifted automatically; backend enabled via `plugins: enabled: [- <id>]` in config.yaml; verify `Mounted plugin API routes: /api/plugins/<id>/` in agent.log. One-click install links use `hermes://plugin/install?repo=owner/repo`.

## TSX refactor pipeline

Disk plugins load uncompiled — TSX must be BUILT into the committed artifact:

- `src/` layout: `core/` (pure logic, no React/SDK — extracted from the `GANTT_CORE_SRC` template string), `ui/` (components), `state.ts`, `api.ts`, `i18n.ts`.
- Build: `esbuild src/main.tsx --bundle --format=esm --outfile=desktop/plugin.js --external:@hermes/plugin-sdk --external:react --external:react/jsx-runtime --jsx=automatic`.
- CI must rebuild and `git diff --exit-code desktop/plugin.js` to catch artifact drift.
- Commit order: toolchain → pure-core extraction (behavior-identical) → component split one commit each (manual verification checklist after each) → SDK type declarations (`sdk.d.ts`) → tests (core unit tests without stubs; newswire-style ESM stub-loader smoke tests for render; pytest unchanged).
- Start `strict: false`; tighten per module. No behavior changes during the mechanical port.

Gotchas that stay regression-prone after the refactor (keep them in AGENTS.md): Radix `asChild` single-element child; Electron drag regions vs `pointer-events: none`; transform ancestors breaking `position: fixed`; SDK component prop mismatches rendering empty.


---

# Porting to a standalone unified plugin repo

Third-party desktop+backend plugins ship as their own repo (official policy — never merged into hermes-agent). Port shape, matching the accepted-plugin convention (hermes-newswire) and the docs' "One package, both SDKs":

```
plugin.yaml            unified manifest (name/version/description/author, kind: standalone, requires_hermes)
__init__.py            no-op register(ctx) — capability probe requires it to exist
dashboard/             manifest.json + plugin_api.py
desktop/plugin.js      renderer half — the shell "lifts" it to desktop-plugins/<id>/ automatically
tests/                 node:test core, pytest backend, optional browser tests
README.md / AGENTS.md / .gitignore / LICENSE
```

- `install.sh` is optional (the shell lifts `desktop/plugin.js` itself); keep it only as a convenience installer and re-point it at `desktop/plugin.js`.
- Path fixes to make when porting: every test/demo that reads `join(HERE, '..', 'plugin.js')` becomes `join(HERE, '..', 'desktop', 'plugin.js')` (or serve it from `desktop/` in the demo server), and the pytest runner keeps `SCRIPT_DIR` anchoring.
- Browser-dependent UI tests must skip cleanly when playwright is absent: probe a list of import specs in a loop, `process.exit(0)` with a `SKIP:` warning if none resolve — no hard browser dependency in the default run (hermes-newswire's UI tests use stub loaders, not playwright).
- The catalog listing (making the plugin installable from Hermes' catalog) is a PR to hermes-agent on the model of the accepted catalog-listing PRs; the standalone repo must exist and be installable first.

### Shipping the agent skills with the repo

Instead of vendoring them, a repo can generate its agent skills from the local profile at install time, so every coding agent that clones it gets them: `skills add <dir> -s <skill> -s <skill> -a universal -y` (the `skills` CLI, an npm devDependency; run it as `node node_modules/skills/bin/cli.mjs …` when `npx` is not usable) copies each named skill out of `${HERMES_HOME:-$HOME/.hermes}/skills/<category>` into `.agents/skills/` — `references/` and `scripts/` included — and writes `skills-lock.json` with a per-skill content hash. Wire it as a `skills:sync` script plus a `postinstall` hook, gitignore both artifacts, symlink `.claude/skills → ../.agents/skills`, and let `CLAUDE.md` be a one-line `@AGENTS.md` import so all agents read one instructions file.

- **The CLI REWRITES the set on every call**: a skill whose name is missing from the `skills:sync` command disappears at the next `npm install`. Adding a skill therefore means adding `-s <name>` to that command — running the CLI by hand leaves the generated set larger than what the script reproduces.
- Both artifacts are generated and gitignored, so a clone has NO skills until `npm install` runs and skill CONTENT never passes review. That is a defensible trade-off (no duplication, no drift from the profile) but state it rather than discovering it: if the skills should travel with the repo, they must be committed and removed from `.gitignore`.

A plugin that installs but shows NO nav entry, NO routes and NO error has hit an ENABLE GATE, not a load bug. There are two, both persisted:
1. Backend gate: `plugins.enabled` in `~/.hermes/config.yaml` must list the plugin id, or the gateway never mounts `/api/plugins/<id>/`.

**Plugin ID derivation from repo name**: `hermes plugins install e-is/NAME` installs to `~/.hermes/plugins/<base-name>/` where `base-name` strips a leading `hermes-` prefix if present (e.g. `hermes-model-leaderboard` → `model-leaderboard`). The gateway then serves API routes at `/api/plugins/<base-name>/*`, NOT at the old repo-prefixed path. After install run `hermes plugins enable <base-name>` then `hermes gateway restart` — the backend mounts on restart.

**The gateway mounts the router under the name in `dashboard/manifest.json`, NOT the one in `plugin.yaml` — keep the two identical.** `plugin.yaml`'s `name:` is the plugin id the renderer's `ctx.rest` scopes every call to (`/api/plugins/<plugin.yaml name>/…`), while `dashboard/manifest.json`'s `name:` is the namespace the gateway mounts the backend at. Renaming only one half (the repo was renamed to `model-leaderboard` while the dashboard manifest kept `hermes-model-leaderboard`) makes EVERY route fail while the page still renders headers with an empty table, and the renderer reports it only as `hermes:api … No such API endpoint: /api/plugins/<name>/models`.

Read the two gateway error strings apart — they point at different layers:
- `No such API endpoint: <path>` — that namespace IS mounted, so the mismatch is the mount name versus the calling namespace, or the path inside the router (see the route-path rules above).
- `Plugin not found` — the namespace is not mounted at all (plugin not enabled, not installed on the gateway the desktop is connected to, or a mount that failed at boot).

Sibling plugins are the ground truth for the convention (`kanban-gantt`, `obsfish-gantt` carry the same name in both files). Mounting happens at backend boot, so renaming a half needs the whole desktop app (or the gateway) RESTARTED — a renderer reload keeps the old mount and the 404s persist, which reads as "the fix didn't work".

`hermes plugins enable` also runs a TRUST GATE for non-bundled plugins: it asks whether the plugin may replace built-in tools and persists the answer as `plugins.entries.<id>.allow_tool_override`. The default is NO and a bare Enter denies safely — which is the correct answer for a plugin whose `__init__.py` only exposes a dashboard router and a desktop page (the override check in `hermes_cli/plugins.py` fires on `ctx.tools.register(..., override=True)`, i.e. only for plugins registering tools). Explain this to the user rather than treating it as an error: nothing is broken, the plugin needs no override. Skip the prompt next time with `--no-allow-tool-override`. Declaring a non-empty `capabilities:` list in `plugin.yaml` replaces the legacy prompt with the capability-consent screen (an EMPTY list does not — it falls back to the legacy prompt), so declaring nothing stays on the legacy path. Verify mount with a direct curl to `/api/plugins/<base-name>/models` — a 401 (auth-required) means the route is live; a 404 means the gateway didn't load the plugin.
2. Desktop gate: unified-plugin desktop halves are opt-in; the toggle state lives in localStorage `hermes.desktop.pluginDecisions.v2` — an id ABSENT from that object is treated as disabled (silent). Set it to `true` via CDP (`localStorage.setItem`) then reload, or have the user flip it in Capabilities → Plugins.
Also check `~/.hermes/logs/desktop.log` for the lift: a pre-existing `~/.hermes/desktop-plugins/<id>/` folder makes the lift's `mkdir` throw EEXIST (uncaught promise) and aborts registration for that plugin — delete the lifted folder and restart the app so it is recreated from the package.
The lift is a BOOT-TIME action only: deleting or updating `desktop/plugin.js` and reloading the renderer leaves the runtime reading the stale (or missing) lifted copy — reload after a package edit yields `404 Plugin not found` through `hermes:api`. After redeploying the package, always delete the lifted folder AND restart the whole desktop app; a renderer `location.reload()` is never enough for a plugin-half change.
Route all data calls through the gateway the desktop is actually connected to: when the app's primary backend is a REMOTE gateway, `ctx.rest` resolves there and a locally-installed backend half is invisible (`hermes:api 404 Plugin not found` despite correct local mounting — check the boot log line `Connecting to remote Hermes backend at …` before debugging the plugin). Either point the desktop at the local backend for testing or install the package on the remote host too.

Resolve WHICH backend from files before diagnosing anything: `~/.config/Hermes/connections.json` (`primary`, `lastUsed`, and the `local` vs remote connection entries — the desktop switches between "This device" and a named gateway, so the log line of the PREVIOUS boot proves nothing), `connection.json` (the remote URL + auth), `backend-ownership.json` (pid/port of the local `hermes serve`, its command line carrying `--profile <p> serve --host 127.0.0.1 --port 0`), and `~/.hermes/logs/gui.log`. Never assume a gateway HOSTNAME is another machine: compare `hostname` / `hostname -I` against `getent hosts <name>` — the "remote" name can resolve to this very workstation, in which case the port is a locally published container gateway. When the user says which device he was on, that is the authority.

A team container serves the plugin copy inside ITS OWN `${HERMES_HOME}/plugins/<id>` — a separate git clone that can be months behind your local install, so a route that exists locally still 404s there. Those containers install from a declared manifest (`plugins.yaml`: `name` / `source` / `ref`, e.g. `ref: main`) through `hermes plugins install/update` at container start, so a fix reaches the team only once that ref carries it: check the manifest's ref and the clone's `git log -1` before concluding anything about the code. Updating that clone and restarting ONLY its `dashboard` service (s6: `s6-svc -r /run/service/dashboard`, which serves the API port) does not touch the per-profile agent gateways — but it is shared team infrastructure, so it needs the user's explicit go-ahead.
Kill-order matters in that cleanup: KILL the running desktop FIRST, then `rm -rf` the lifted folder, then relaunch. Deleting the folder while the old instance is still up lets it recreate the copy (or a racy second lift mkdir-throws EEXIST at the next boot), and the next boot then loads the stale half or nothing. After a cold restart, verify the renderer actually runs the NEW artifact by asserting on a marker that only the new build renders (a renamed button, a new icon glyph, a new heading) — a stale module renders 'successfully' with the old layout and full data, so 'page loads with N rows' proves nothing. `window.hermesDesktop.readPluginSource(desktopPluginsRoot + '/<id>/plugin.js')` evaluated in-page is the quick check that the renderer CAN read the new bytes; if it can and the DOM still shows the old build, suspect a second app instance or a non-reloaded window, not the file.

**CDP sidebar nav clicks**: the sidebar renders nav items as `<button>` or `<a>` inside a container class-matching `/[class*=Sidebar]/`. Find with `[...document.querySelectorAll('button,nav a,a,[class*=Sidebar] a')].find(x => x.textContent.trim() === 'Exact Label')`. The sidebar label comes from `register({ route: { label } })` — clicking the wrong text means the nav entry has a stale default label that differs from the expected one (check the page source's `main.tsx` for the actual label string). When the sidebar shows a raw plugin id (e.g. `plugin-llm-leaderboard`) instead of the intended name, the tab was registered by an earlier undistinctive default and `label` was never set.

When a row uses absolutely-positioned decoration to the LEFT of its first in-flow control (tree connectors before the selection checkbox), compute the decoration's width from the paddings so its right edge lands exactly on the control's left edge — with label padding-left `depth*12+8`, a connector at `depth*12+2` must be 6px wide, not 10. "Resize it by eye" overlaps the checkbox by the padding delta; the two numbers share the same offset arithmetic, so derive one from the other.
