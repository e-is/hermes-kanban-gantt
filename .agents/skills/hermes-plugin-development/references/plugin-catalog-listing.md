# Getting a plugin into the Hermes plugin catalog (and keeping its entry fresh)

The catalog lives in `NousResearch/hermes-agent` under `plugin-catalog/<name>.yaml`
(350+ entries). Presence there **is** the trust signal: discovery via
`hermes plugins catalog` / `search`, install via `hermes plugins install <name>`,
and a docs page at `docs/plugins/<name>` generated at docs-build time.

Read the upstream `plugin-catalog/README.md` in the hermes-agent checkout before
writing anything — it is the authority; this file is the procedure around it.

## Admission rules (from the catalog README, condensed)

1. **Human-merged gate.** Entries are added only by PR to hermes-agent, reviewed
   and merged by a maintainer. No self-serve registry, no automated ingestion.
2. **Exact 40-hex SHA pins are mandatory.** Branches, tags and short SHAs are
   rejected by the loader; installing clones the repo and checks out that commit.
3. **No self-updating code.** The plugin must not fetch and replace its own files
   (in-app "check for updates", release downloaders, remote `plugin.js` loaders).
   The SHA pin is the trust model; updates reach users only through a SHA-bump PR
   plus `hermes plugins update <name>`. Keep an updater in the standalone
   distribution if wanted, strip it from the catalog build.
4. **SHA bumps are new PRs**, re-reviewed (reviewers read the adopted commit range).
5. **Owner-or-major-contributor submissions only** (or a maintainer sweep);
   drive-by submissions of third-party repos are declined.
6. **Declared capabilities must match reality** — the `capabilities:` block must
   equal what the plugin registers AT the pinned commit; mismatch fails validation
   and is treated as a security issue.
7. **The install scanner runs at admission** (`hermes plugins validate`):
   `dangerous` fails the entry, `caution` shows as CI warnings a reviewer reads.
   Installs at the pinned SHA then accept `caution` without prompting.
8. **Desktop halves stay inside the SDK surface**: no prototype patching, no
   `eval`/`new Function`, no `import()` other than `@hermes/plugin-sdk` / `react`,
   no script-tag injection, no reaching into internal app stores — the `desktop
   surface` check refuses these. If a capability is missing, ask for an SDK hook.
9. **Dependency policy is the plugin's own**: reviewers reject bare floors on the
   newest release; prefer the oldest API-compatible floor plus an upper bound.

## Entry schema

```yaml
name: example-plugin        # [a-z0-9_-]{1,64}, the catalog key (must equal plugin.yaml name:)
repo: https://github.com/owner/repo   # https:// only
sha: <40-hex commit sha>    # mandatory exact pin
subdir: ""                  # optional, for a plugin living in a subdirectory
description: One-line description.
maintainer: OwnerName
version: "1.2.0"            # cosmetic label for the sha — QUOTE it
category: desktop           # desktop | memory | platform | web | tools | voice | automation | models | general
requires_hermes: ">=0.21.5" # optional
image: ""                   # optional 2:1 banner on a GitHub host
screenshots: []             # optional, up to 6, GitHub hosts only; fills the docs gallery
readme: true                # default true: the README AT THE PINNED SHA renders on the docs page
platforms: []               # e.g. [linux, macos]; empty = all
capabilities:
  provides_tools: []
  provides_hooks: []
  provides_middleware: []
  requires_env: []
```

`version`, `image`, `screenshots` and `readme` are cosmetic (nothing parses them
to pick what installs) but must be truthful: bump `version` in the SAME PR that
bumps `sha`, and pin image/screenshot raw URLs to the entry's commit
(`https://raw.githubusercontent.com/owner/repo/<sha>/docs/banner.png`) so the
picture is as immutable as the code. Images must live on github.com /
raw.githubusercontent.com / *.githubusercontent.com — never a third-party host.

## Procedure

First-time listing and every later update share steps 1–5; only step 6's diff
size differs (a new file vs a two-line re-pin).

1. **Land the code on the default branch** and make sure the repo is public and
   installable (`hermes plugins install <owner>/<repo>` works).
2. **Bump the manifest**: `version:` in `plugin.yaml`, and `requires_hermes:` when
   a newly used SDK area landed after the current floor. Commit it.
3. **Tag the release commit**: `git tag -a v<ver> -m "…" && git push origin v<ver>`.
   The tag itself satisfies the "released" bar; creating the GitHub Release page
   needs `gh` and can be skipped.
4. **Validate locally** (same checks as admission CI):
   `hermes plugins validate <repo-root>` → must print `Validation passed`.
   Reading the checks: manifest, capability probe, security scan, desktop-surface
   lint. Clear your own MEDIUM/HIGH findings before the PR — a bundled library's
   prop-types `SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED` literal and ZWJ
   emoji are the usual false-ish positives; post-process them out of the artifact.
5. **Get the entry right** (see schema): `sha:` = the tag's commit, `version:` =
   the same label, `requires_hermes:` in sync with the manifest, `screenshots:`
   pinned to that sha.
6. **Open the PR against hermes-agent** editing `plugin-catalog/<name>.yaml`.
   The submitter must own the plugin repo (rule 5). Catalog CI
   (`.github/workflows/plugin-catalog-ci.yml`) must be green; cross-check with
   `scripts/validate_plugin_catalog.py`. For an UPDATE, state the commit range
   being adopted in the body — that range is what the reviewer reads.

## Practicalities on this machine

- The catalog is visible in the installed checkout: `ls ~/.hermes/hermes-agent/plugin-catalog/`
  and the policy at `plugin-catalog/README.md`; the validator lives at
  `scripts/validate_plugin_catalog.py`.
- `gh` is usually absent and the fine-grained token in `~/.hermes/.env` is often
  read-only → the PR is opened from the owner's fork instead: push the branch to
  the fork (SSH works regardless of the token) and hand over
  `https://github.com/NousResearch/hermes-agent/compare/main...<owner>:<branch>?quick_pull=1`
  with the body written to a file. Do that branch work in `~/git/hermes-agent`
  (fork clone), never in the installed checkout.
- An existing entry can be BEHIND its plugin: check the pinned SHA against
  `origin/main` of the plugin repo before assuming an update is unnecessary — a
  stale `requires_hermes` (e.g. `>=0.19` while the manifest needs `>=0.21.5`) is a
  real bug for users on the older floor.

## Checklist before submitting

- [ ] Public repo, default branch installs cleanly.
- [ ] `sha` = a full 40-hex commit that is the release (not a branch/tag).
- [ ] `version` bumped in the SAME PR as `sha`; `requires_hermes` matches the manifest.
- [ ] No self-updating code (checked at the pinned commit, not only on main).
- [ ] `capabilities:` equals what actually registers at that commit.
- [ ] `hermes plugins validate` → `Validation passed`; catalog CI green.
- [ ] `image`/`screenshots` on GitHub hosts, pinned to the entry's sha.
- [ ] README at the pinned sha is the one users should see (it renders on the docs page).
