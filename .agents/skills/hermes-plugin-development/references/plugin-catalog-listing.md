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
   The tag itself satisfies the "released" bar. The Release page is optional but
   cheap and it is what users read: `POST /repos/<owner>/<repo>/releases` with
   `tag_name`, `name` and an English `body` (what's new by feature, then the fixes,
   then the under-the-hood notes, ending with the install/update commands). It needs
   `Contents: write`, a DIFFERENT scope from opening a PR (`Pull requests: write`),
   so probe the releases endpoint separately — a token that opens PRs on the repo
   can still 403 there, and vice versa; `gh` is not required for either.
   - **Moving a tag** already pushed (the release commit gained review-worthy
     commits after tagging): `git tag -d v<ver>` → `git push origin :refs/tags/v<ver>`
     → re-create on the new commit → push, then re-point EVERY sha-pinned URL in
     the entry (screenshots included) at the new commit. A screenshot URL left on
     the old sha renders a different revision than the one users install, and no
     CI check catches it.
4. **Validate locally** (same checks as admission CI):
   `hermes plugins validate <repo-root>` → the check list must end in
   `Validation passed`. `--json` prints the machine-readable per-check report
   (`checks[]` with `name` / `ok` / `detail`), which is how you read WHICH check
   failed without parsing the wrapped text. Clear your own MEDIUM/HIGH findings
   before the PR — a bundled library's prop-types
   `SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED` literal and ZWJ emoji are the
   usual false-ish positives; post-process them out of the artifact.
5. **Get the entry right** (see schema): `sha:` = the tag's commit, `version:` =
   the same label, `requires_hermes:` in sync with the manifest, `screenshots:`
   pinned to that sha.
6. **Open the PR against hermes-agent** editing `plugin-catalog/<name>.yaml`.
   The submitter must own the plugin repo (rule 5). For an UPDATE, state the
   commit range being adopted in the body — that range is what the reviewer reads.

## Re-pinning an existing entry is an EDIT, and it is the common case

`plugin-catalog/<name>.yaml` already exists once the plugin was listed, and the
catalog allows exactly one file per plugin `name:` (the structural validator
rejects a duplicate). So a version bump is a **modification of that file** —
`sha`, `version`, `requires_hermes`, and the re-pinned `screenshots`/`image` URLs —
never a second file, and never a rename. Model the PR on the listing PR that
added the entry: title `plugin catalog: … kanban-gantt …`, body opening with
`## What does this PR do?`, the repo link, what the adopted commit range brings,
and a `## Screenshots` section when the gallery changes.

The listing PR also carried one extra file, `contributors/emails/<email>`, which
is a ONE-TIME addition: check it with
`GET /repos/NousResearch/hermes-agent/contents/contributors/emails/<email>` and
do not re-add it on a re-pin.

## What the catalog CI actually runs

`.github/workflows/plugin-catalog-ci.yml` fires only on PRs touching
`plugin-catalog/**` and has two jobs:

- **structural** — `pip install ruamel.yaml` then
  `python3 scripts/validate_plugin_catalog.py plugin-catalog/` over the WHOLE
  directory (so an unrelated malformed entry shows up in your PR).
- **pinned-source-validate** — finds the changed entry files, then clones the
  entry's repo and **checks out the pinned sha** and runs
  `hermes plugins validate` THERE. Two consequences that decide whether a local
  failure is real:
  - It validates the CLONE at that commit, **with no package install** —
    generated/gitignored trees (`.agents/skills/*` from a skills sync,
    `node_modules`, build caches) do not exist there. A `security scan` finding
    from such a file does not fail admission; one from a TRACKED file does. Prove
    the split locally by checking each finding's path with
    `git ls-files --error-unmatch`.
  - The pinned sha must be reachable in the repo (`GET /repos/<owner>/<repo>/commits/<sha>`
    answers 200) — verify that BEFORE opening the PR, since an unpushed tag or a
    local-only commit fails this gate with no useful message.

Reproduce both jobs locally before opening the PR, and report their results per
job in the PR body instead of asserting the CI will be green:

```bash
# structural — the CI installs ruamel.yaml; a throwaway pytest venv already has it
/tmp/<name>-venv/bin/python scripts/validate_plugin_catalog.py plugin-catalog/   # "OK: N file(s) valid"

# pinned-source — validate the CLONE's view: a detached worktree at the sha
git worktree add --detach /tmp/<name>-pin <sha>
(cd /tmp/<name>-pin && hermes plugins validate .)      # must end in "Validation passed"
git worktree remove /tmp/<name>-pin --force            # always clean it up
```

Validating the WORKING tree proves less than it looks: any gitignored file there
(a synced skill set, a build cache) is scanned locally and absent at the pinned
commit, so a red local run can be a false alarm and a green one can be luck.

## Practicalities on this machine

- The catalog is visible in the installed checkout: `ls ~/.hermes/hermes-agent/plugin-catalog/`
  and the policy at `plugin-catalog/README.md`; the validator lives at
  `scripts/validate_plugin_catalog.py`.
- Wire the fork clone before editing anything:
  `git remote set-url origin git@github.com:<fork-owner>/hermes-agent.git` (a fork
  the token can PUSH to — probe it with `GET /repos/<owner>/hermes-agent` and read
  `permissions.push`) and `git remote set-url upstream https://github.com/NousResearch/hermes-agent.git`,
  then branch off `upstream/main` (`git checkout -b catalog/<name>-<version> upstream/main`).
  The first fetch from a fresh fork remote of that repo takes minutes — start it
  early, and never let it block the rest of the work.
- `gh` is usually absent and a fine-grained token is often read-only → the PR is
  opened from the owner's fork instead: push the branch to the fork (SSH works
  regardless of the token) and hand over
  `https://github.com/NousResearch/hermes-agent/compare/main...<owner>:<branch>?quick_pull=1`
  with the body written to a file. Do that branch work in `~/git/hermes-agent`
  (fork clone), never in the installed checkout.
- An existing entry can be BEHIND its plugin: check the pinned SHA against
  `origin/main` of the plugin repo before assuming an update is unnecessary — a
  stale `requires_hermes` (e.g. `>=0.19` while the manifest needs `>=0.21.5`) is a
  real bug for users on the older floor.
- **A fine-grained token is scoped PER REPOSITORY, and its scopes are PER
  ENDPOINT.** One that opens PRs happily on the user's own org repos still answers
  `403 Resource not accessible by personal access token` on
  `NousResearch/hermes-agent` — probe THAT repo (invalid-payload `POST /pulls` →
  403 vs 422) before promising the user you can open the catalog PR. On the repos
  it does reach, probe each endpoint you need separately: releasing needs
  `Contents: write` while PRs need `Pull requests: write`, and the `.env` can hold
  several `GITHUB_TOKEN` lines where the first authenticates but lacks the scope —
  collect the distinct values and probe each PER ENDPOINT, never assume the first
  (or the one that read the repo) can write. The unblock is on their side: add
  `NousResearch/hermes-agent` to the token's selected repositories with
  `Pull requests: Read and write`. Until then the push to the fork is what you owe,
  and the API `head` for a fork PR is `"<fork-owner>:<branch>"` — the same owner
  prefix the compare URL needs; a bare `:branch` head never resolves.

## Checklist before submitting

- [ ] Public repo, default branch installs cleanly.
- [ ] `sha` = a full 40-hex commit that is the release (the tag's commit, not a branch/tag string).
- [ ] `version` bumped in the SAME PR as `sha`; `requires_hermes` matches the manifest.
- [ ] No self-updating code (checked at the pinned commit, not only on main).
- [ ] `capabilities:` equals what actually registers at that commit.
- [ ] The EXISTING entry file was edited, not duplicated.
- [ ] `hermes plugins validate` → `Validation passed`, and every remaining
      `caution` finding is in a gitignored (hence absent-at-that-commit) file.
- [ ] The pinned sha answers 200 on the commits API (reachable in the repo).
- [ ] `image`/`screenshots` on GitHub hosts, pinned to the entry's sha, and each
      URL verified to exist at that sha.
- [ ] README at the pinned sha is the one users should see (it renders on the docs page).
