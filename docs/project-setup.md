---
shortcode: projectsetup
name: { full: "Project setup" }
type: doc
subType: userguide
---

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
│   │   ├── ISSUE_REPORTING.md        # how issues are filed
│   └── workflows/
├── assets/
│   └── content/                  # authored Markdown notes
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
| `build/packs-json/`     | `package-build package`        | One JSON file per compiled document, before the pack is made. |
| `build/stage/packs/`    | `package-build package`        | The LevelDB compendium packs.                                 |
| `build/stage/`          | `package-build assets`         | The staged package — manifest, packs, and the shipped files.  |
| `build/content-index/`  | `package-build content-index`  | This package's published note index.                          |
| `build/cache/foreign/`  | `package-build deps`           | A dependency's unpacked item catalogue.                       |
| `build/cache/metadata/` | `package-build deps`           | A dependency's fetched content index.                         |
| `build/tmp/packs/`      | `package-build package unpack` | A compiled pack extracted back to JSON.                       |
| `build/dist/`           | `package-build release`        | The release archive, and the book when one is built.          |

The two that matter when something is wrong are `build/packs-json/`, which is
the compiled document before Foundry ever sees it, and `build/stage/`, which is
exactly what ships.

**`assets/content/` holds the source notes.** Edit the Markdown and YAML
frontmatter directly; a plain checkout builds without an export step. The
tree is arranged for readers and authors, while `type:` determines how each
note compiles.

## `package.json`

Beyond the identity keys [`getting-started.md`](getting-started.md) covers,
`package.json` carries the whole command surface of the repository. Nobody types
`npx package-build package compile`; they type `npm run build`.

The scripts fall into six groups, and the grouping is the point — a contributor
who knows the groups can guess a name.

### `prepare` — the git hooks

```json
"prepare": "git config core.hooksPath .githooks || true"
```

npm runs `prepare` after every install. In this repository it points Git at the
committed `.githooks/`, including in a fresh worktree. Run `npm ci` for a fresh
checkout or `npm run prepare` to repeat setup. `|| true` allows an install
outside a Git checkout, such as a Docker build or CI cache step.

The installed `commit-msg` and `pre-commit` are byte-identical copies of the
[canonical POSIX hooks](https://github.com/HeroicLands/.github#local-git-hooks-and-actionsgithooks).
The message guard refuses assistant credits without requiring Node; the branch
guard refuses commits on `main` and `master`. These hooks honor
`hooks.noAttribution`, `hooks.protectedBranch`, and `hooks.allowCommitOnMain`.
CI compares every installed hook against the pinned canonical set. This setup
installs no pre-push or pre-merge-commit hook.

### Optional published hook bundle

The package also ships `githooks/` for repositories that explicitly select its
additional checks. To select that bundle, point `core.hooksPath` at
`node_modules/@heroiclands/package-build/githooks` in that repository’s setup.
That bundle requires the installed package and Node; it is separate from this
repository’s canonical `.githooks/` installation.

Four hooks are available, each with its own switch, read with Git’s normal
precedence: a plain `git config` sets one clone, `--global` sets a machine.

| Hook                             | What it does                                                         | Key                                  | Default |
| -------------------------------- | -------------------------------------------------------------------- | ------------------------------------ | ------- |
| `pre-commit`, `pre-merge-commit` | Refuse a commit on a protected branch.                               | `hooks.allowCommitOnMain` (inverted) | on      |
| `pre-commit`                     | Lint any `.changeset/*.md` the commit stages.                        | `hooks.changelogCheck`               | on      |
| `commit-msg`                     | Refuse AI attribution in a commit message.                           | `hooks.noAttribution`                | on      |
| `pre-push`                       | Run the consuming repository’s Build & Test workflow in a container. | `hooks.prePushCi`                    | off     |

The defaults differ deliberately: a guard that costs nothing is on unless
refused, and one that runs a container for minutes is off unless asked for.

The commit-message guard requires Node, like the rest of the toolchain. It checks
complete coauthor trailers and standalone credit clauses, with indentation,
bullets, emoji, Markdown emphasis and inline links permitted as decoration.
Supported identities are Codex, ChatGPT, OpenAI Codex, OpenAI ChatGPT, OpenAI,
Claude, Claude Code, Anthropic,
GitHub Copilot, Gemini, Cursor, and generic AI assistant credits. Signature forms
are generated by/with, assisted by, written by, AI-assisted and AI-generated.
Matching ignores case. Human coauthors such as Claudette Smith and Jean-Claude
Martin, explanatory prose, and ordinary mentions of these tools pass.

Specific assistant mailbox identities also identify a coauthor credit:
`codex@openai.com`, `chatgpt@openai.com`, `noreply@openai.com`,
`claude@anthropic.com` and `noreply@anthropic.com`. A provider's email domain
alone does not identify an assistant. This is an explicit set of credit forms,
not a classifier for arbitrary natural-language attribution.

Git comment lines and the verbose diff after a scissors comment are excluded.
Findings report the original message line and column. This local hook examines
commit messages only; the shared No Attribution workflow also checks pull
request titles and bodies. Neither examines repository files, issues, comments,
or Git author/committer metadata. The canonical shell hooks apply the same
credit grammar with their own POSIX implementation.

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

`pre-push` reads the pull-request workflows and runs their commands over a
clean export of `HEAD` in a `linux/amd64` container. Run the same check manually
with `package-build ci`; use `package-build ci --native` to run against the
current working tree without Docker. The container catches wrong-case imports
that pass on a case-insensitive Mac filesystem and fail on the Linux runner.
Published `uses:` actions are listed but run only on GitHub.

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

Six checks, each answering one question and blind to what the others see.
They are separate scripts rather than one because a failing chain stops at its
first failure, and knowing _which_ question failed is most of the diagnosis.

```json
"lint": "run-s lint:format lint:markdown lint:addresses lint:content-links lint:lang lint:changelog",
"lint:format": "package-build format",
"lint:markdown": "package-build markdown",
"lint:markdown:fix": "package-build markdown --fix",
"lint:addresses": "package-build lint",
"lint:content-links": "package-build links",
"lint:lang": "package-build lang check",
"lint:changelog": "package-build changelog check"
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
- **`lint:changelog`** — does every pending `.changeset/*.md` read like a
  release note rather than a pasted pull-request description? Passes
  trivially when nothing is pending: no pull request is required to carry a
  changeset, only to write one that reads well when it does.

`run-s` comes from `npm-run-all`, a devDependency. It runs scripts in sequence
and stops at the first failure, which is what makes a named chain readable.

### `build:*` — the chain

```json
"build": "npm ci && npm run build:noci",
"build:local": "npm i && npm run build:noci",
"build:noci": "run-s lint build:stage-reset build:db build:module",
"build:stage-reset": "package-build stage reset",
"build:db": "run-s build:content-index build:assets build:compiledb",
"build:content-index": "package-build content-index",
"build:assets": "package-build assets",
"build:compiledb": "package-build package compile",
"build:unpackdb": "package-build package unpack",
"build:module": "package-build manifest",
"build:pack-release": "package-build release"
```

The split between `build` and `build:noci` is not cosmetic. **`build` installs
from the lockfile first**, so what it compiles is what CI compiles;
`build:local` installs without the lockfile, for a working tree mid-change; and
`build:noci` skips the install entirely, which is the one to reach for inside a
git worktree where `node_modules` is already correct.

`build:stage-reset` clears only the assembled Foundry package. Keep it before
every stage writer, including a repository's own code or stylesheet bundle
step. This keeps moved and deleted files out of the next package while
preserving the content index and other generated outputs.

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

A package with a dependency adds `"build:deps": "package-build deps fetch"` at
the head of `build:db`. Fetching is its own step and never happens during a
compile, so a build never reaches the network silently — a cold cache fails
naming `deps fetch`.

Commands that read dependency addresses check for a complete local index before
walking content or writing output. This applies to `lint`, `links`, `site`,
`pdf`, `map`, `reachability`, and `package compile`. The check does not fetch;
run `package-build deps fetch` as a separate step when the cache is empty.

### `format` — writing rather than checking

```json
"format": "package-build format --write",
"format:check": "package-build format"
```

Two names for one command because two audiences want it: a contributor wants
the writing form, and CI wants the checking form. `format:check` and
`lint:format` are the same command; both names exist because the lint chain
reads better with one and a CI workflow reads better with the other.

### `changeset:*` — the release mechanism

```json
"changeset": "changeset",
"changeset:version": "changeset version && npm install --package-lock-only"
```

`changeset` adds one, written only when a consumer will notice the change —
nothing gates a pull request on carrying one. `changeset:version` consumes the
pending changesets, writes `CHANGELOG.md` and bumps `package.json` — and the
`npm install --package-lock-only` after it is what keeps `package-lock.json`'s
recorded version in step, since changesets does not touch the lockfile.

What a pending changeset is held to is quality, not existence: `lint:changelog`
and the `pre-commit` hook `prepare` installs both run
`package-build changelog check` against it, in CI and at commit time
respectively, and both pass trivially when there is none.

### The site scripts

Every package publishes a website — at the least, its homepage — so every
package carries this group:

```json
"build:site": "run-s build:deps build:content-index build:site-render",
"build:site-render": "package-build site build",
"serve:site": "run-s build:deps build:content-index serve:site-render",
"serve:site-render": "package-build site serve"
```

`build:site-render` renders the site into `build/site/<contentPackage>/` with
`package-build site build`, then writes the deployment's `_headers` beside it
and indexes the rendered pages for search into
`build/site/<contentPackage>/pagefind/`. `serve:site-render` runs
`package-build site serve`, which builds the same site and serves it for a live
preview. The repository carries no site configuration of its own: the site is
composed on every run from `package.json`, `package-build.config.yaml`, the
shared theme that ships with `@heroiclands/package-build`, and the navigation
`deps fetch` cached — a site declares this one package and needs nothing
further added for its theme, and nothing beyond Node to render it.

The site build reads the cached navigation, so `build:site` runs `deps fetch`
first, and the content index it reads is built before it:

```json
"build:deps": "package-build deps fetch",
"build:content-index": "package-build content-index"
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

`package-build markdown` needs no equivalent file: it applies the shared rule
set through the markdownlint library, and a repository that declares nothing
gets it. A `.markdownlint-cli2.jsonc` (or `.yaml`, `.cjs`, `.mjs`) at the
repository root overrides it and is what the editor's markdownlint extension
reads, and [`@heroiclands/package-build/markdownlint`](api.md) is the export it
re-uses — with one trap worth knowing before writing one. A consumer file
overrides the shared configuration **key by key, and each key wholesale**:
declaring only `ignores` keeps every rule intact but _replaces_ the shared ignore
list rather than extending it, so such a file must restate `CHANGELOG.md` if it
still wants that file excluded. The command always excludes `node_modules` and
`.git`.

The options file accepts a closed set of keys, and any other key is refused with
a located diagnostic:

| Key              | Where                | Meaning                                                                                                                                                                 |
| ---------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config`         | any directory        | Rule settings, merged rule by rule over the settings above it. An `extends` key inside it names a rule file, relative to the options file, whose settings it builds on. |
| `customRules`    | any directory        | Module ids (resolved from that directory) or rule objects to add.                                                                                                       |
| `frontMatter`    | any directory        | Regular expression source matching a front matter block.                                                                                                                |
| `ignores`        | any directory        | Globs, relative to that directory, whose files are skipped.                                                                                                             |
| `noInlineConfig` | any directory        | `true` to disregard `<!-- markdownlint-... -->` comments.                                                                                                               |
| `globs`          | repository root only | Globs of files to lint, in addition to `**/*.md` when no paths are named.                                                                                               |
| `gitignore`      | repository root only | `false` to lint files that `.gitignore` files exclude; `true` by default.                                                                                               |

An options file in a subdirectory applies to that directory and below, merged
over the root's. A `.markdownlint.jsonc`, `.json`, `.yaml`, `.yml`, `.cjs` or
`.mjs` file holds a rule `config` directly and replaces the merged `config` for
its directory.

## `.prettierignore`

`package-build format` already consults `.gitignore`, so generated trees named
there need no second entry. `.prettierignore` is for the opposite case: files
that are **committed** and must not be rewritten.

```text
# Written by `changeset version`, not by hand. The Version Packages pull request
# runs no CI — it is opened by GITHUB_TOKEN — so a changelog the formatter has
# rewritten turns `main` red the moment that pull request merges.
CHANGELOG.md
```

Two more entries are common, and both are the same principle:

- **A tree of templates.** Handlebars layouts carry inline markup and line
  breaks that are the page that ships, which Prettier's template formatter
  reflows.
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
`package-build format` reads `.gitignore` and `.prettierignore` both, and
`package-build markdown` reads `.gitignore`.

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

**`.github/ISSUE_REPORTING.md`** says how issues are filed. Labels are
organisation-level and defined in `HeroicLands/.github`, so the repository
carries no label registry of its own.

`.gitea/workflows/` carries the repository's own CI. The org-wide
`HeroicLands/.github` repository supplies the shared composite actions those
workflows `uses:` — `labels`, `no-attribution` and `todos` — plus the reusable
site-deploy workflow, so a fix to any of them reaches every repository at once.

## What the toolchain reads, and what it writes

A summary, because "where does this come from" is the question that recurs.

| Read                         | By                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `package.json`               | The Foundry package id, the version, the release addresses; the site's `baseURL`, description and author. |
| `package-build.config.yaml`  | Everything else about the build.                                                                          |
| `assets/content/**/*.md`     | Every content command.                                                                                    |
| `.gitignore`                 | `package-build format`, `package-build markdown`.                                                         |
| `.prettierignore`            | `package-build format`.                                                                                   |
| `lang/*.json`                | `package-build lang`.                                                                                     |
| `.env.local`                 | `package-build deploy`.                                                                                   |
| `.gitea/workflows/build.yml` | The `pre-push` hook, for its step list.                                                                   |

Everything written goes under `build/`. Nothing the toolchain generates is
committed.
