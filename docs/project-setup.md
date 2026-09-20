# Project setup

[`getting-started.md`](getting-started.md) builds a package. This document
describes the repository around it: the files every HeroicLands package carries
beyond `package-build.config.yaml`, what each npm script in the chain is for,
and the directory layout the build reads and writes.

None of it is required to compile a pack. All of it is required for a repository
someone else can contribute to, and the reason to write it down is that
otherwise each repository copies it from the last and the copies drift.

## The layout

```text
acme-bestiary/
├── package.json                  # identity, and every script below
├── package-lock.json             # committed
├── package-build.config.yaml     # the build's single source
├── prettier.config.js            # re-exports the shared Prettier options
├── .prettierignore               # committed files Prettier must not rewrite
├── .gitignore                    # what is generated
├── .changeset/
│   ├── config.json
│   └── *.md                      # one per unreleased change
├── .github/
│   ├── labels.yml                # the closed label registry
│   ├── ISSUE_REPORTING.md        # §3 lists the same labels
│   └── workflows/
├── assets/
│   └── content/                  # authored notes — an Obsidian vault
├── lang/
│   └── en.json
├── src/                          # module JavaScript, if the package has any
├── styles/
├── README.md
├── LICENSE.md
└── build/                        # everything generated; gitignored
```

`build/` is the only directory the toolchain writes into, and every path under
it is configurable through [`paths`](configuration.md#paths). The defaults:

| Path                    | Written by                     | Holds                                                         |
| ----------------------- | ------------------------------ | ------------------------------------------------------------- |
| `build/packs-json/`     | `content-build package`        | One JSON file per compiled document, before the pack is made. |
| `build/stage/packs/`    | `content-build package`        | The LevelDB compendium packs.                                 |
| `build/stage/`          | `package-build assets`         | The staged package — manifest, packs, and the shipped files.  |
| `build/content-index/`  | `content-build content-index`  | This package's published note index.                          |
| `build/cache/foreign/`  | `content-build deps`           | A dependency's unpacked item catalogue.                       |
| `build/cache/metadata/` | `content-build deps`           | A dependency's fetched content index.                         |
| `build/tmp/packs/`      | `content-build package unpack` | A compiled pack extracted back to JSON.                       |
| `build/dist/`           | `package-build release`        | The release archive, and the book when one is built.          |

The two that matter when something is wrong are `build/packs-json/`, which is
the compiled document before Foundry ever sees it, and `build/stage/`, which is
exactly what ships.

**`assets/content/` is opened as an Obsidian vault.** There is no export step
and no vault environment variable: the notes in the repository are the source,
and a plain checkout builds. Dataview renders the content tables live while
authoring, which is why the tree is arranged for humans even though `type:`
rather than location is what routes a note.

## `package.json`

Beyond the identity keys [`getting-started.md`](getting-started.md) covers,
`package.json` carries the whole command surface of the repository. Nobody types
`npx content-build package compile`; they type `npm run build`.

The scripts fall into six groups, and the grouping is the point — a contributor
who knows the groups can guess a name.

### `prepare` — the git hooks

```json
"prepare": "git config core.hooksPath node_modules/@heroiclands/package-build/githooks || true"
```

npm runs `prepare` after every install, so this is what installs the hooks. It
points git at the hook directory this package ships, which means a repository
carries no hook files of its own and cannot drift from the others. `|| true` so
that an install outside a git checkout — a Docker build, a CI cache step —
does not fail on it.

Three hooks arrive with it, each with its own switch, read with git's normal
precedence: a plain `git config` sets one clone, `--global` sets a machine.

| Hook                             | What it does                                                    | Key                                  | Default |
| -------------------------------- | --------------------------------------------------------------- | ------------------------------------ | ------- |
| `pre-commit`, `pre-merge-commit` | Refuse a commit on a protected branch.                          | `hooks.allowCommitOnMain` (inverted) | on      |
| `commit-msg`                     | Refuse AI attribution in a commit message.                      | `hooks.noAttribution`                | on      |
| `pre-push`                       | Run this repository's own Build & Test workflow in a container. | `hooks.prePushCi`                    | off     |

The defaults differ deliberately: a guard that costs nothing is on unless
refused, and one that runs a container for minutes is off unless asked for.

The branch guard is the one you meet first:

```console
$ git commit -m "Add the bestiary content package"
pre-commit: refusing to commit on the protected branch 'master'.

'master' is protected on GitHub, so this commit could never be pushed from
here. Move it onto a branch first — this keeps everything you have staged:

    git switch -c <type>/<issue_#>_<slug>

To commit here anyway just this once, use 'git commit --no-verify'. To opt this
repository out permanently, 'git config hooks.allowCommitOnMain true'.
```

`pre-push` reads the step list out of `.github/workflows/build.yml` rather than
holding its own copy, and runs it over a clean export of `HEAD` in a
`linux/amd64` container. That last detail is the one a Mac cannot reproduce any
other way: this filesystem is case-insensitive and the runner's is not, so a
wrong-case import passes locally and fails there.

### `clean` — removing what the build wrote

```json
"clean": "package-build clean",
"distclean": "package-build clean --distclean"
```

`clean` removes the conventional build directories plus anything named in
`packageBuild.clean.extra` — a coverage directory, say. Everything the site
build writes is under `build/`, so a site needs no entry. `distclean`
additionally removes `node_modules`. Both exit 0 whether or not there was
anything to remove.

### `lint:*` — the checks, one per question

Six checks, each answering one question and blind to what the others see. They
are separate scripts rather than one because a failing chain stops at its first
failure, and knowing _which_ question failed is most of the diagnosis.

```json
"lint": "run-s lint:format lint:markdown lint:addresses lint:content-links lint:lang lint:labels",
"lint:format": "content-build format",
"lint:markdown": "content-build markdown",
"lint:markdown:fix": "content-build markdown --fix",
"lint:addresses": "content-build lint",
"lint:content-links": "content-build links",
"lint:lang": "package-build lang check",
"lint:labels": "package-build labels check"
```

- **`lint:format`** — is every file formatted to the shared Prettier options?
  Reports without writing, which is what a CI gate wants; `npm run format`
  is the writing form.
- **`lint:markdown`** — does the prose satisfy the shared markdownlint rule set?
  `lint:markdown:fix` applies the fixes markdownlint can make.
- **`lint:addresses`** — is every note's frontmatter well-formed, is every
  address unique, and does the tree hold exactly one homepage?
- **`lint:content-links`** — does every `[[…]]` resolve, does every `#anchor`
  land, and is every cross-package reference reachable through a fetched
  manifest?
- **`lint:lang`** — does every localization file survive
  `foundry.utils.expandObject`? A dotted-prefix collision (`"a.b": 1` beside
  `"a.b.c": 2`) makes Foundry drop the whole file silently, which is the quiet
  failure this catches. A package with templates and scripts also wires
  `package-build lang coverage` and `package-build lang hardcoded`; a
  content-only package has nothing for those two to read, and each dies naming
  the glob that matched nothing rather than passing vacuously.
- **`lint:labels`** — do `.github/labels.yml` and §3 of
  `.github/ISSUE_REPORTING.md` still list the same labels? Neither derives from
  the other, so nothing else notices when they drift.

`run-s` comes from `npm-run-all`, a devDependency. It runs scripts in sequence
and stops at the first failure, which is what makes a named chain readable.

### `build:*` — the chain

```json
"build": "npm ci && npm run build:noci",
"build:local": "npm i && npm run build:noci",
"build:noci": "run-s lint build:db build:module",
"build:db": "run-s build:content-index build:assets build:compiledb",
"build:content-index": "content-build content-index",
"build:assets": "package-build assets",
"build:compiledb": "content-build package compile",
"build:unpackdb": "content-build package unpack",
"build:module": "package-build manifest",
"build:pack-release": "package-build release"
```

The split between `build` and `build:noci` is not cosmetic. **`build` installs
from the lockfile first**, so what it compiles is what CI compiles;
`build:local` installs without the lockfile, for a working tree mid-change; and
`build:noci` skips the install entirely, which is the one to reach for inside a
git worktree where `node_modules` is already correct.

Within the chain, two orderings are real:

- **`build:content-index` before `build:pack-release`.** The manifest advertises
  the content index at a pinned address, and `package-build release` refuses an
  archive whose manifest advertises an index the tree never wrote.
- **`lint` before any of it.** The checks read the tree; the compilers read the
  tree and write. Finding a malformed address after the packs are built means
  rebuilding them.

The three stage-writing steps — `build:assets`, `build:compiledb`,
`build:module` — each write their own part of `build/stage/` and none clobbers
another's, so their order among themselves is legibility rather than necessity.

`build:unpackdb` is the inverse of `build:compiledb`: it extracts a compiled
LevelDB pack back to JSON, which is how you read what actually shipped.

A package with a dependency adds `"build:deps": "content-build deps fetch"` at
the head of `build:db`. Fetching is its own step and never happens during a
compile, so a build never reaches the network silently — a cold cache fails
naming `deps fetch`.

### `format` — writing rather than checking

```json
"format": "content-build format --write",
"format:check": "content-build format"
```

Two names for one command because two audiences want it: a contributor wants
the writing form, and CI wants the checking form. `format:check` and
`lint:format` are the same command; both names exist because the lint chain
reads better with one and a CI workflow reads better with the other.

### `changeset:*` — the release mechanism

```json
"changeset": "changeset",
"changeset:check": "changeset status --since=origin/main",
"changeset:version": "changeset version && npm install --package-lock-only"
```

`changeset` adds one. `changeset:check` reports what is pending against `main`,
which is what a CI job gates on so that a behaviour change cannot merge without
declaring its bump. `changeset:version` consumes the pending changesets, writes
`CHANGELOG.md` and bumps `package.json` — and the `npm install --package-lock-only`
after it is what keeps `package-lock.json`'s recorded version in step, since
changesets does not touch the lockfile.

### The site scripts

Every package publishes a website — at the least, its homepage — so every
package carries this group:

```json
"build:site": "run-s build:site-content build:site-html build:site-root",
"build:site-content": "content-build site",
"build:site-html": "hugo --source build/hugo --minify --gc --cleanDestinationDir",
"build:site-root": "package-build site-root",
"serve:site": "npm run build:site-content && hugo server --source build/hugo"
```

`build:site-content` writes the whole Hugo source tree under `build/hugo/` —
the generated `hugo.toml` and the content mount — with `content-build site`;
`build:site-html` runs Hugo over it, rendering into `build/site/<contentPackage>/`;
`build:site-root` writes the deployment's `_headers` beside
that; and `serve:site` does the first and then `hugo server` for a live
preview. The repository carries no Hugo configuration of its own: `hugo.toml`
is generated on every run from `package.json`, `package-build.config.yaml`,
the installed `@heroiclands/hugo-theme` and the navigation `deps fetch`
cached, and the only file to add is `@heroiclands/hugo-theme` under
`devDependencies`. Hugo itself is a separate install — the extended edition,
on the developer's `PATH` and the runner's.

The site build reads the cached navigation, so `build:site` in a package with
no other dependency still runs `deps fetch` first:

```json
"build:site": "run-s build:deps build:site-content build:site-html build:site-root",
"build:deps": "content-build deps fetch"
```

### Deployment scripts

`push:dev`, `push:qa` and `push:prod` wrap `package-build deploy <stage>`, and
`deploy:*` chains a build in front of each. They read credentials from
`.env.local`, which is never committed. A fresh worktree has no `.env.local`, so
these exit without copying anything and the target keeps serving the previous
build — copy the file in before trusting a deployment from one.

## `prettier.config.js`

```js
/**
 * The shared HeroicLands Prettier configuration.
 *
 * @type {import("prettier").Config}
 */
export { default } from "@heroiclands/package-build/prettier";
```

**Never restate an option here.** The options live in
`@heroiclands/package-build/prettier` so that every repository formats
identically, and a local override is how two repositories stop agreeing. The
file exists solely so that an editor and a bare `npx prettier` resolve the same
options the toolchain applies — without it they fall back to Prettier's own
defaults, and a print width that differs from the project's turns every
save into a diff the lint chain reverts.

`content-build markdown` needs no equivalent file: it hands the shared rule set
to markdownlint directly, and a repository that declares nothing gets it. A
`.markdownlint-cli2.jsonc` is for the editor's markdownlint extension, and
[`@heroiclands/package-build/markdownlint`](api.md) is the export it re-uses —
with one trap worth knowing before writing one. A consumer file overrides the
shared configuration **key by key, and each key wholesale**: declaring only
`ignores` keeps every rule intact but _replaces_ the shared ignore list rather
than extending it, so such a file must restate every shared entry it still
wants.

## `.prettierignore`

`content-build format` already consults `.gitignore`, so generated trees named
there need no second entry. `.prettierignore` is for the opposite case: files
that are **committed** and must not be rewritten.

```text
# Written by `changeset version`, not by hand. The Version Packages pull request
# runs no CI — it is opened by GITHUB_TOKEN — so a changelog the formatter has
# rewritten turns `main` red the moment that pull request merges.
CHANGELOG.md
```

Two more entries are common, and both are the same principle:

- **A generated site tree.** Hugo layouts are Go templates in `.html` files,
  which Prettier reflows as HTML — folding the template directives into prose.
- **Vendored files from another build.** A file copied verbatim from another
  repository is reformatted into a permanent diff against its source, which
  re-diffs on every re-vendor.

`package-lock.json` needs no entry when `package.json` is formatted, because npm
matches `package.json`'s indentation when it writes the lockfile — so a
formatted `package.json` produces a lockfile the formatter already agrees with.
A repository whose `package.json` is indented some other way ignores the
lockfile instead, or `npm install` and the formatter rewrite it in turn.

## `.gitignore`

The build's own output, plus the local-only paths every repository has:

```text
node_modules
/build/
/nogit/
/.env
/.env.local
/.claude/
CLAUDE.md
AI.md
*.tgz
.DS_Store
```

Three of those carry rules rather than conventions.

**`nogit/` is local scratch** — design write-ups, working notes, downloaded
references. Nothing in it is ever committed.

**`.env.local` holds real credentials** for the deployment targets. Never
committed, never echoed.

**`node_modules` with no leading slash and no trailing slash.** The trailing
slash matches a directory only, so a worktree carrying `node_modules` as a
symlink is not ignored and a `git add -A` commits a symlink holding one
developer's absolute path. Unanchored so the same cannot happen one directory
down, which is where a nested worktree puts it.

Note also that `.gitignore` is what keeps `build/` out of the prose checks:
`content-build format` reads `.gitignore` and `.prettierignore` both, and
`content-build markdown` reads `.gitignore`.

## `.changeset/`

```json
{
  "$schema": "https://unpkg.com/@changesets/config@4.0.0/schema.json",
  "changelog": "@changesets/changelog-git",
  "commit": true,
  "baseBranch": "main",
  "privatePackages": {
    "version": true,
    "tag": false
  },
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

`npx changeset init` writes a starting point — it prompts once, for whether to
use the GitHub changelog integration, and the answer here is no. Four keys then
need setting, and each is a decision rather than a preference.

- **`changelog: "@changesets/changelog-git"`** attributes each entry to its
  commit. The GitHub changelog generator wants a token and produces entries
  naming pull requests, which is history the changelog does not need.
- **`privatePackages: {version: true, tag: false}`** is what makes changesets
  work at all here. Every package in the constellation is `private`, because it
  ships as a Foundry release rather than to npm; without `version: true`
  changesets skips it entirely, and `tag: false` because the release tag is cut
  by the release workflow rather than by changesets.
- **`commit: true`** so `changeset version` commits its own result.
- **`baseBranch: "main"`** is what `changeset status --since=origin/main`
  compares against.

Then one `.changeset/*.md` per unreleased change:

```markdown
---
"acme-bestiary": minor
---

**Creatures** — The marsh drake joins the bestiary, with its habits and the
stretch of water it holds.
```

Three rules about the body, and they are enforced by review rather than by a
tool:

- **It describes the setting, not the work.** Write for someone who installs or
  upgrades and wants to know what changed for them.
- **Bold labels, never `#` headings.** Changesets nests the whole summary inside
  one bullet, so an `h2` written here becomes a real `<h2>` in the changelog,
  outranking the `Minor Changes` heading above it and polluting the outline.
- **On a 0.x package a breaking change is `minor`, never `major`.** `major`
  takes the package to 1.0.0, which is a product decision rather than a
  description of a diff.

## `.github/`

Two files the toolchain reads, and they must agree.

**`.github/labels.yml`** is the closed label registry — the machine-readable
source of truth, synced to GitHub by the org-wide `labels` action. A label on
GitHub that is not listed there is deleted on the next sync, which is what makes
the set closed and why nothing invents one.

```yaml
- name: documentation
  color: "0075ca"
  description: Documentation about this repository — README, process, authoring guides.

- name: devops
  color: "e07b31"
  description: Build, tooling, CI, release, repo config.
```

**`.github/ISSUE_REPORTING.md`** §3 is the same list in prose, for a human
filing an issue. `package-build labels check` compares the two and fails when
they disagree:

```console
$ npx package-build labels check
package-build: registry and §3 agree (2 labels).
```

Neither file derives from the other, so this check is the only thing standing
between them and a silent divergence. Editing the registry means editing both.

Labels are **subject matter only**. Work shape — bug, feature, epic, task, spike
— is an issue _type_, shared across the organization, so there is no `bug` label
and filtering on one returns nothing.

Neither file exists in a fresh repository, and `labels check` says so rather
than passing vacuously:

```console
$ npx package-build labels check
package-build: labels check: .github/labels.yml does not exist.
```

`.github/workflows/` then carries the repository's own CI. The org-wide
`HeroicLands/.github` repository supplies the shared composite actions those
workflows `uses:` — `labels`, `no-attribution` and `todos` — plus the reusable
site-deploy workflow, so a fix to any of them reaches every repository at once.

## What the toolchain reads, and what it writes

A summary, because "where does this come from" is the question that recurs.

| Read                                               | By                                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `package.json`                                     | The Foundry package id, the version, the release addresses; the site's `baseURL`, description and author. |
| `package-build.config.yaml`                        | Everything else about the build.                                                                          |
| `assets/content/**/*.md`                           | Every content command.                                                                                    |
| `.gitignore`                                       | `content-build format`, `content-build markdown`.                                                         |
| `.prettierignore`                                  | `content-build format`.                                                                                   |
| `.github/labels.yml`, `.github/ISSUE_REPORTING.md` | `package-build labels check`.                                                                             |
| `lang/*.json`                                      | `package-build lang`.                                                                                     |
| `.env.local`                                       | `package-build deploy`.                                                                                   |
| `.github/workflows/build.yml`                      | The `pre-push` hook, for its step list.                                                                   |

Everything written goes under `build/`. Nothing the toolchain generates is
committed.
