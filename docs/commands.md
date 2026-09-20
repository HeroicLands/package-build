# Command reference

`@heroiclands/package-build` ships two binaries. `package-build` is the
packaging half — clean, stage, check, package, deploy, run a Foundry
container, drive the end-to-end suite. `content-build` is the content half —
compile a note tree into compendium packs, check it, publish it as a site or a
book, and manage the caches a build resolves other packages through.

Both read `package-build.config.yaml` from the repository root — see
[Configuration](configuration.md) for every key. Neither reads it for
`--version` or `--help`: those two answer in a directory with no
configuration at all, and every other invocation resolves the configuration
and fails loudly when it is missing or wrong.

Each command below reads like a manual page: **NAME**, **SYNOPSIS**,
**DESCRIPTION**, **OPTIONS**, **EXIT STATUS**, **EXAMPLES**, **SEE ALSO**, in
that order, as bold labels rather than headings. A command with no options
says so under **OPTIONS** rather than omitting the section.

## Conventions

**Every finding is `file:line:column: severity: message`**, the path starting
the line — the diagnostic contract this package's own build tooling emits and
that both binaries' content-side commands use for anything found in a
specific file. A field that cannot be known is dropped rather than guessed:
`file:line:` when the column means nothing, `file:` when only the file is
known. See [Diagnostics](diagnostics.md) for the full contract.

**Exit codes are 0 or 1.** 0 is success — including a command that found
advisory warnings but no error, and a command that had deliberately nothing to
do. 1 is failure: a configuration error, a missing prerequisite, or findings
that the command treats as errors. Each command's own **EXIT STATUS** states
exactly what makes its run a 1.

**`package-build` has one failure path for everything **`.fail()`** does not
handle specially: every thrown error, from any command, is caught, printed as
one line — `package-build: <message>`, or the bare diagnostic when the error
already carries its own `file:line:column:` — and turned into exit code 1. A
command that additionally emits findings of its own (`lang coverage`, `yaml`,
`bundle check`, …) is called out below.**

**`content-build` has no such umbrella.** Each command catches its own errors,
logs them (prefixed `[timestamp] [LEVEL]:` for ordinary failures, unprefixed
for a located diagnostic) and sets `process.exitCode = 1`; a command-line
parse error — an unknown flag, a missing required option, an action outside
its `choices` — is reported by yargs' own default handler and also exits 1.

**Both binaries are `strict()` and `demandCommand(1, …)`.** An unknown
command or option is refused rather than ignored, and running either with no
command prints usage and exits 1 rather than silently doing nothing — the
failure mode that let a typo in a build script pass the step it was meant to
run. The one exception is `package-build e2e <action>`, which relaxes to
`.strict(false)` for everything after the action, because that belongs to the
suite or the fast loop and this command line must not judge it.

**`--help` / `-h` and `--version` are global, not per-command.** Both
binaries register them once on their own top-level parser
(`.version(ownVersion())`, `.help()`, `.alias("help", "h")`); no command below
lists them among its own options.

**`PACKAGE_BUILD_CONFIG`** names the configuration file explicitly instead of
the walk up from the working directory both binaries otherwise do — the only
environment variable the toolchain itself reads for configuration
resolution. `deploy`, `container` and `e2e` additionally read `FOUNDRYVTT_*`,
documented where each applies.

An option name recurring across commands is not a recurring meaning —
`--out`, `--check`, `--from` and `--strict` each carry their own default and
behaviour where they appear below; read the command, not the name.

---

## `package-build`

### `package-build clean`

**NAME**

Remove this repository's build artifacts.

**SYNOPSIS**

```
package-build clean [--distclean]
```

**DESCRIPTION**

Removes the conventional directories the library knows about, plus anything
named in `packageBuild.clean.extra` for a repository that generates more — a
site's `content/`, `public/` and `resources/`, say. Nothing is read from the
content tree; nothing is written.

**OPTIONS**

| Option        | Type    | Default | Description                 |
| ------------- | ------- | ------- | --------------------------- |
| `--distclean` | boolean | `false` | Also remove `node_modules`. |

**EXIT STATUS**

1 on any thrown error (a missing or invalid configuration). Otherwise 0,
whether or not there was anything to remove.

**EXAMPLES**

```
$ package-build clean
Nothing to clean.
```

**SEE ALSO**

[Configuration](configuration.md).

### `package-build assets`

**NAME**

Stage this repository's static files into the package root.

**SYNOPSIS**

```
package-build assets
```

**DESCRIPTION**

Stages every entry in `packageBuild.assets` — each names a `from` and a `to`,
and `to` is relative to the staged package root, so a table reads `lang`, not
`build/stage/lang`. A repository that has to transform a file on the way
names a module in `packageBuild.assetTransform`, exporting
`transform(sourcePath) -> string | null` — `null` copies the file verbatim,
anything else replaces its content. Reads every `from` path; writes into
`packageBuild.stageDir`.

**OPTIONS**

None.

**EXIT STATUS**

1 if `packageBuild.assetTransform` is declared but cannot be loaded, or
exports no `transform` function. 1 on any other thrown error. Otherwise 0 —
including when `packageBuild.assets` is empty, which logs and stages nothing
rather than failing.

**EXAMPLES**

```
$ package-build assets
✅ Static assets staged (1 entries, 1 files).
```

**SEE ALSO**

[Configuration](configuration.md).

### `package-build schema`

**NAME**

Publish this package's DataModel field sets as `schema.json`.

**SYNOPSIS**

```
package-build schema
```

**DESCRIPTION**

Publishes the registries named in `packageBuild.schema` as `schema.json`, read
by `content-build content-format schema` and, in a consuming package, by
`content-build lint`'s emitted-versus-declared check. A repository that
declares no registries has nothing to publish. Reads the registries
`packageBuild.schema` names; writes `build/schema.json`. A release publishes
it beside the archive and the manifest when `packageBuild.assets` names
`build/schema.json` (see `package-build release`); a module's
`content-build deps fetch` keeps the copy from the archive it downloads.

**OPTIONS**

None.

**EXIT STATUS**

1 on any thrown error. Otherwise 0 — including when `packageBuild.schema` is
empty, which logs and publishes nothing.

**EXAMPLES**

```
$ package-build schema
package-build: no `packageBuild.schema` declared; nothing to publish.
```

**SEE ALSO**

`content-build content-format schema`, `content-build lint [root]`,
`package-build release`, [Configuration](configuration.md).

### `package-build manifest`

**NAME**

Generate the Foundry package manifest into the build stage.

**SYNOPSIS**

```
package-build manifest
```

**DESCRIPTION**

Generates `system.json` or `module.json` into the build stage —
`system.json` when `packageKind` is `systems`, `module.json` otherwise.
There is no template: every key comes from `packageBuild.manifest`, from
configuration this repository already carries (`packageKind`, `packageId`,
`compatibility`, the `packs` list, `relationships`), or from a module named
in `packageBuild.manifestFlags` for a flag the repository has to compute
itself — the compendium address of a document that exists only once the
content tree has been walked. Reads the shared pack configuration and
`package.json`; writes the manifest into `packageBuild.stageDir`.

**Refused for `packageKind: documentation`.** A manifest is the file Foundry
reads to install a package, and a documentation package is not one —
emitting `module.json` for it would advertise an installable package with no
packs, no compatibility range and no id. Its site is built by
`content-build site`, and its book by `content-build pdf`.

**OPTIONS**

None.

**EXIT STATUS**

1 for `packageKind: documentation`. 1 if `packageBuild.manifestFlags` is
declared but cannot be loaded, or exports no `flags` function. 1 on any other
thrown error (a manifest key the configuration cannot supply —
`package.json` naming no `repository.url`, for instance). Otherwise 0.

**EXAMPLES**

```
$ package-build manifest
✅ Wrote build/stage/module.json (10 keys, 2 packs).

$ package-build manifest   # packageKind: documentation
package-build: `packageKind: documentation` ships no Foundry package, so there is no manifest to generate. The site and the book are built by `content-build`.
```

**SEE ALSO**

`content-build site`, `content-build pdf`, `package-build bundle check`,
[Configuration](configuration.md).

### `package-build site-root`

**NAME**

`package-build site-root` — write the deployment's `_headers`.

**SYNOPSIS**

```
package-build site-root [--out <dir>]
```

**DESCRIPTION**

Hugo renders into `<out>/<contentPackage>/`, because the deployment carries the
`/<contentPackage>/` prefix physically and the routing layer is a
path-preserving pass-through. The directory that is _uploaded_ is its parent,
and Cloudflare Pages reads `_headers` and `_redirects` from there and nowhere
else — a copy inside the prefix is published as a text file and never applied.
Hugo owns everything under the prefix; this owns what sits beside it.

One file is written, `_headers`, and it says one thing: indexing is
suppressed on every address a deployment answers on but nobody advertises —
the project's `pages.dev`, the per-deployment `pages.dev`, and the custom
domain the routing layer fetches — each of which would otherwise compete with
the canonical URL in search results. No `Cache-Control` is pinned on the
prefix root: it is the homepage, and a lifetime on it would hold a stale copy
at the most-linked address after a deploy.

No `_redirects` is written: the prefix root _is_ the homepage, which the site
build writes as the mount's `_index.md`, so nothing redirects. A `_redirects`
left beside the site by an earlier build is removed, since Pages would apply
it.

The rules are scoped to those hostnames, so a site deployed under a domain of
its own stays indexable.

**OPTIONS**

`--out <dir>` — the directory that is deployed. Defaults to `build/site`.

**EXIT STATUS**

1 when `<out>/<contentPackage>/` holds no rendered site, which means the site
build has not run and writing root files would publish a deployment with nothing
under the prefix. Otherwise 0.

**EXAMPLES**

```
$ package-build site-root
✅ Wrote build/site/_headers.
```

**SEE ALSO**

`content-build site`, [Configuration](configuration.md).

`package-build lang <action>` asks three independent questions about this
repository's localization, each blind to what the others see: `check`,
`coverage` and `hardcoded`, one section below per action.

### `package-build lang check`

**NAME**

Check that every localization file survives `foundry.utils.expandObject`.

**SYNOPSIS**

```
package-build lang check
```

**DESCRIPTION**

A dotted-prefix collision (`"a.b": 1` beside `"a.b.c": 2`) makes
`expandObject` throw, and Foundry drops the whole file silently. Reads every
file matching `packageBuild.lang.sources`; writes nothing.

**OPTIONS**

None.

**EXIT STATUS**

1 if any file fails `expandObject`, printing `packageBuild.lang.help` first
when the repository declares one. 1 if `packageBuild.lang.sources` matches no
file. 1 on any other thrown error. Otherwise 0.

**EXAMPLES**

```
$ package-build lang check
package-build: 1 localization file(s) are expandObject-safe.
```

**SEE ALSO**

`package-build lang coverage`, `package-build lang hardcoded`,
[Configuration](configuration.md).

### `package-build lang coverage`

**NAME**

Check that declared and referenced localization keys agree.

**SYNOPSIS**

```
package-build lang coverage [--unused]
```

**DESCRIPTION**

Does every key the package references exist, and is every key it declares
referenced? A referenced-but-missing key fails the run — it renders to a
player as its own raw key string. An unreferenced-but-declared key is
reported and does not fail, because no scan sees every way a key can be
reached. Reads `packageBuild.lang.primary`, and every file matching
`packageBuild.lang.scripts` and `packageBuild.lang.templates`. A repository
that generates keys by a convention of its own names a module in
`packageBuild.lang.references`, exporting `references(context) ->
ReferenceSet`. Writes nothing.

**OPTIONS**

| Option     | Type    | Default | Description                                                    |
| ---------- | ------- | ------- | -------------------------------------------------------------- |
| `--unused` | boolean | `false` | List every unreferenced key instead of a preview capped at 20. |

**EXIT STATUS**

1 if any reference is missing (an unreferenced key alone does not fail it).
1 if the configured source globs match nothing at all. 1 on any other thrown
error. Otherwise 0.

**EXAMPLES**

```
$ package-build lang coverage
package-build: 1 key(s) declared in lang/en.json · 1 referenced · 0 namespace(s) · 0 dynamic shape(s) · 0 missing · 0 unreferenced
```

**SEE ALSO**

`package-build lang check`, `package-build lang hardcoded`,
[Diagnostics](diagnostics.md), [Configuration](configuration.md).

### `package-build lang hardcoded`

**NAME**

Check that markup text is localized and that every template compiles.

**SYNOPSIS**

```
package-build lang hardcoded
```

**DESCRIPTION**

Does the markup's user-visible text go through localization, and does each
template still compile? The reverse of `coverage`, which is blind to a
template that mentions no key at all. Reads every file matching
`packageBuild.lang.templates`; writes nothing.

**OPTIONS**

None.

**EXIT STATUS**

1 if any user-visible literal is unlocalized or any template fails to
compile. 1 if `packageBuild.lang.templates` matches nothing. 1 on any other
thrown error. Otherwise 0.

**EXAMPLES**

```
$ package-build lang hardcoded
package-build: 1 template(s) fully localized and compiling.
```

**SEE ALSO**

`package-build lang check`, `package-build lang coverage`,
[Diagnostics](diagnostics.md), [Configuration](configuration.md).

### `package-build labels check`

**NAME**

Compare the machine label registry against the documented reference table
(`check` is the only action).

**SYNOPSIS**

```
package-build labels check [--registry <path>] [--doc <path>]
```

**DESCRIPTION**

Compares the machine label registry synced to GitHub against the documented
reference table, and reports where they disagree — a label the registry has
that the table does not, or the reverse. Neither derives from the other, so
nothing else notices when they drift. Reads both files named below; writes
nothing.

**OPTIONS**

| Option       | Type   | Default                      | Description                                                    |
| ------------ | ------ | ---------------------------- | -------------------------------------------------------------- |
| `--registry` | string | `.github/labels.yml`         | The machine registry synced to GitHub.                         |
| `--doc`      | string | `.github/ISSUE_REPORTING.md` | The documented reference whose §3 table lists the same labels. |

**EXIT STATUS**

1 if either file does not exist. 1 if the registry and the table disagree on
any label. Otherwise 0.

**EXAMPLES**

```
$ package-build labels check --registry .github/labels.yml --doc .github/ISSUE_REPORTING.md
package-build: registry and §3 agree (11 labels).
```

**SEE ALSO**

None.

### `package-build bump [packages..]`

**NAME**

Take a newer published version of a declared dependency.

**SYNOPSIS**

```
package-build bump [packages..] [--tag <tag>] [--check]
```

**DESCRIPTION**

Takes the newest published version of one or more declared dependencies,
updating `package-lock.json` — and `package.json` when the declared range has to
move — and holding both files to the indentation they already carry.

npm performs the resolution, which is what this exists for. A version whose
dependency set differs from the one it replaces is handled as correctly as one
that moves three lines, while editing the `version` / `resolved` / `integrity`
lines by hand is only right while the two dependency sets are identical — and
nothing tells the author when they are not.

npm writes `package-lock.json` with the indentation `package.json` uses, so a
consumer whose manifest is formatted gets a formatted lockfile back and the
diff is the version change alone. The indentation step covers the case where
the two files disagree: each is written back with the indent it already
carried, rather than the lockfile taking the manifest's. A run that had to put
an indent back names the file it rewrote.

Named no packages, it takes every `@heroiclands/*` dependency the manifest
declares. That scope is the one a person bumps by hand — a first-party release
is taken the moment it publishes, usually to unblock the change that prompted
it, while third-party updates arrive from Dependabot on their own schedule.

The version reported is the one the **lockfile** resolves, not the range the
manifest declares, because `npm ci` installs from the lockfile. Above 1.0 a
caret range usually already admits the new version, so the manifest does not
move and the lockfile is the whole change; below 1.0 a caret is locked to the
minor, so it does.

Writes no `node_modules`: install the result with `npm ci`.

**OPTIONS**

| Option    | Type    | Default  | Description                                 |
| --------- | ------- | -------- | ------------------------------------------- |
| `--tag`   | string  | `latest` | The dist-tag to take.                       |
| `--check` | boolean | `false`  | Report what would change and write nothing. |

**EXIT STATUS**

1 if the working directory holds no `package.json` or no `package-lock.json`. 1
if a named package is not a declared dependency. Otherwise 0, including when
every package is already current.

**EXAMPLES**

```
$ package-build bump
@heroiclands/package-build  20.6.0 → 20.7.0

Install it with `npm ci`, which resolves from the lockfile this just moved.
```

```
$ package-build bump @heroiclands/hugo-theme --check
@heroiclands/hugo-theme  0.5.0 → 0.6.0

Run without --check to take it.
```

**SEE ALSO**

`package-build clean`.

### `package-build yaml [paths..]`

**NAME**

Lint note frontmatter and every other YAML file in the repository.

**SYNOPSIS**

```
package-build yaml [paths..]
```

**DESCRIPTION**

The check that exists because a duplicate frontmatter key used to parse to
nothing and the note it belonged to silently lost every field, with every
later build pass reporting success. Needs no ESLint configuration of its
own, so a repository with one for its own source code
(`Song-of-Heroic-Lands-FoundryVTT`'s `src/`) keeps it untouched. Reads the
paths given, or every matched file; writes nothing.

**OPTIONS**

| Positional | Type      | Default                                                                                               | Description             |
| ---------- | --------- | ----------------------------------------------------------------------------------------------------- | ----------------------- |
| `paths`    | string(s) | every YAML file and markdown frontmatter git would consider (tracked, plus untracked and not ignored) | Files or globs to lint. |

**EXIT STATUS**

1 if any finding is an error. A warning-only run exits 0.

**EXAMPLES**

```
$ package-build yaml
package-build: 2 file(s) checked · 0 error(s) · 0 warning(s)
```

**SEE ALSO**

[Diagnostics](diagnostics.md).

### `package-build changelog check`

**NAME**

Lint release prose — pending changesets, or a `CHANGELOG.md` release section
— against the rules a changeset is actually held to (`check` is the only
action).

**SYNOPSIS**

```
package-build changelog check [--release] [paths..]
```

**DESCRIPTION**

A changeset answers one question — who notices, and what do they see — and
nothing enforced that, so a pull-request description pasted into one ships
verbatim as a release note: commit hashes, issue references, code fences,
"Verified" paragraphs, byte counts and test tallies, a paragraph disguised as
a bullet, a nested checklist, a `#` heading that outranks the version heading
above it once wrapped into a list item, or simply too many bullets or too
many lines for one entry. Each finding names the rule it tripped and says
what to write instead.

Default reads every pending changeset (`.changeset/*.md`; `config.json` and
`README.md` excluded) and checks each one's body, frontmatter fence dropped.
`--release` reads the first `## <version>` section of `CHANGELOG.md` instead
— the section a **Version Packages** branch is about to publish — with its
generated `## <version>` and `### <Bump> Changes` scaffold lines exempted
from the heading rule, since neither is authored.

A token that reads as code — `camelCase()`, a `path/with/slashes.ext`,
`SCREAMING_SNAKE` — outside any code span is a warning, not a failure: a
user-facing note sometimes needs one (`Compendium.hm3.items.Item.<id>`), but
rarely. A block's bold label absent from a declared `changelog.labels` is
also a warning — the drift `**Character data**` beside `**Characters**`
produces — and checks nothing when the repository declares no
`changelog.labels`. Every other finding is an error. Reads the files given,
or resolves its own defaults; writes nothing.

**OPTIONS**

| Positional  | Type      | Default                                                                                     | Description                                                                             |
| ----------- | --------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `paths`     | string(s) | `.changeset/*.md` (`config.json`, `README.md` excluded), or `CHANGELOG.md` with `--release` | Files to check.                                                                         |
| `--release` | boolean   | `false`                                                                                     | Check the first `## <version>` section of `CHANGELOG.md` instead of pending changesets. |

**EXIT STATUS**

1 if a named file does not exist. 1 if any finding is an error. A run with
only warnings — the code-like-token case — exits 0.

**EXAMPLES**

```
$ package-build changelog check
package-build: 1 file(s) checked · 0 error(s) · 0 warning(s)
```

```
$ package-build changelog check --release
CHANGELOG.md:5:3: error: changelog-check/commit-hash a commit hash is a commit-log artefact; the changelog generator should not write one — set `changelog` to `@changesets/cli/changelog`
package-build: 1 file(s) checked · 1 error(s) · 0 warning(s)
```

**SEE ALSO**

[Diagnostics](diagnostics.md).

### `package-build changelog group`

**NAME**

Fold a release section's changeset blocks together by their bold label
(`group` is a sibling of `check`, not one of its actions).

**SYNOPSIS**

```
package-build changelog group [paths..]
```

**DESCRIPTION**

`@heroiclands/package-build/changelog` writes each changeset's summary into
`CHANGELOG.md` as its own block, verbatim, under `### <Bump> Changes` — one
per changeset, in whatever order Changesets read the files. Three pull
requests each touching compendium content each write their own
`**Compendiums**` block, and nothing merges them: the release reads as three
scattered entries instead of one.

`group` rewrites the first `## <version>` section of `CHANGELOG.md` in
place. Within each `### <Bump> Changes` body, every block sharing one bold
label is merged into a single block for that label — its bullets kept in
the order they were originally written, an exact-duplicate bullet kept
once — and the merged blocks are reordered: the unlabelled lead paragraph a
changeset writes with no category first, then every label
[`changelog.labels`](configuration.md#changelog) declares, in the order
given, then any label absent from that list last, in the order it first
appeared — each reported as a warning naming it. With no `changelog.labels`
declared, every group instead keeps the order its label first appeared in,
lead paragraph first, and nothing is reported as unknown. Every earlier
release section is untouched, byte for byte. Running `group` on its own
output is a no-op.

**OPTIONS**

| Positional | Type      | Default        | Description                         |
| ---------- | --------- | -------------- | ----------------------------------- |
| `paths`    | string(s) | `CHANGELOG.md` | Files to group, rewritten in place. |

**EXIT STATUS**

1 if a named file does not exist. 0 otherwise — an undeclared label is a
warning, never a failure.

**EXAMPLES**

```
$ package-build changelog group
package-build: 1 file(s) grouped · 0 warning(s)
```

```
$ package-build changelog group
CHANGELOG.md:12: warning: changelog-group/unknown-label "Scenery" is not declared in `changelog.labels` — filed last, in order of first appearance
package-build: 1 file(s) grouped · 1 warning(s)
```

**SEE ALSO**

[`changelog check`](#package-build-changelog-check),
[`changelog.labels`](configuration.md#changelog).

### `package-build bundle check`

**NAME**

Check that the staged manifest and code bundle agree (`check` is the only
action).

**SYNOPSIS**

```
package-build bundle check
```

**DESCRIPTION**

Verifies the generated manifest and the staged code bundle agree — catching
three ways a package builds successfully and still does not load, all
invisible to the bundler itself: the entry declared under both `esmodules`
and `scripts` (Foundry loads it twice), under neither (Foundry never loads
it), or under `esmodules` while the file only parses as a classic script
(which fails at runtime with a message about whatever `import` came first,
naming nothing about the manifest). Both files are read from the stage,
because the stage is what ships; nothing is written.

**OPTIONS**

None.

**EXIT STATUS**

1 if the staged manifest or bundle is missing — build the stage first. 1 if
the two disagree. Otherwise 0.

**EXAMPLES**

```
$ package-build bundle check
package-build: demo-package.mjs is declared under "esmodules" and loads as one.
```

**SEE ALSO**

`package-build manifest`, [Diagnostics](diagnostics.md).

### `package-build release`

**NAME**

Zip the staged package for a GitHub release.

**SYNOPSIS**

```
package-build release [--no-pdf]
```

**DESCRIPTION**

The artifact name comes from `packageKind` — a system ships as
`system.json`'s sibling, a module as `module.json`'s — so no repository
states it a second time. It also publishes the content index the manifest
advertises (`flags.metadataUrl`) and, when the stage carries one,
`schema.json` — a repository that names `build/schema.json` in
`packageBuild.assets` gets it released beside the archive; one that does not
gets none. When the package publishes content (`publish.site: content`), it
also builds the content-tree book (see `content-build pdf`) and reports it
alongside the archive; `--no-pdf` skips that step for a release that has a
tree but does not want the book this time. A book that fails to build is
reported, never fatal — the archive above is the release regardless. Reads
the staged package and (for the book) the content tree; writes
`<artifact>.zip` and, unless skipped, the book, both under `build/dist`.

**OPTIONS**

| Option     | Type    | Default | Description                                                                 |
| ---------- | ------- | ------- | --------------------------------------------------------------------------- |
| `--no-pdf` | boolean | —       | Skip the content-tree book even when the package would otherwise build one. |

**EXIT STATUS**

1 on any thrown error (an unstaged package, a manifest that advertises a
metadata file the content index never wrote). Otherwise 0 — book findings
are reported on stderr but do not fail the release.

**EXAMPLES**

```
$ package-build release
✅ Packaged 1.0.0 for release: build/dist/module.zip (0.0 MB)
   No book: `publish.site` is `homepage`, which fences the content surfaces off — the tree is not walked and no book is built. Publish content to build one.
```

**SEE ALSO**

`content-build pdf`, `package-build schema`, [Configuration](configuration.md).

### `package-build deploy <stage>`

**NAME**

Push the staged package into a Foundry data directory.

**SYNOPSIS**

```
package-build deploy <stage>
```

**DESCRIPTION**

Pushes the staged package into a Foundry data directory for the named stage.
`packageKind` and `packageId` come from the shared configuration rather than
being restated per repository. The destination is read from
`FOUNDRYVTT_<STAGE>_DATA` (a local filesystem path is copied; a
`[user@]host:/path` target is uploaded over SFTP, authenticated through the
running SSH agent unless `FOUNDRYVTT_<STAGE>_KEY` names an explicit key). The
deploy is staged and swapped rather than written in place, because a running
Foundry holds its LevelDB packs open and a replacement written underneath it
corrupts them. `.env.local` and `.env` are loaded first. Reads
`packageBuild.stageDir`; writes into the stage's data directory.

**OPTIONS**

| Positional | Type   | Default | Description                                     |
| ---------- | ------ | ------- | ----------------------------------------------- |
| `stage`    | string | —       | Target stage, e.g. `dev`, `qa`, `prod`, `test`. |

**Environment.** `FOUNDRYVTT_<STAGE>_DATA` (required — the destination).
`FOUNDRYVTT_<STAGE>_AGENT`, `FOUNDRYVTT_<STAGE>_PORT`,
`FOUNDRYVTT_<STAGE>_USER`, `FOUNDRYVTT_<STAGE>_KEY` (SFTP destinations
only).

**EXIT STATUS**

1 if `FOUNDRYVTT_<STAGE>_DATA` is unset. 1 on any other thrown error.
Otherwise 0.

**EXAMPLES**

```
$ package-build deploy dev
package-build: No destination configured for stage 'dev'. Set FOUNDRYVTT_DEV_DATA — for example FOUNDRYVTT_DEV_DATA="/path/to/foundryvtt/data".

$ FOUNDRYVTT_DEV_DATA=/tmp/pb-docs-demo-410-data package-build deploy dev
Deploying /private/tmp/pb-docs-demo-410/build/stage → /tmp/pb-docs-demo-410-data/Data/modules/demo-package (local copy)
Deployed stage 'dev' successfully.
```

**SEE ALSO**

`package-build container <stage> <action>`, `package-build e2e <action>`,
[Configuration](configuration.md).

### `package-build container <stage> <action>`

**NAME**

Run a stage's Foundry in a Docker container.

**SYNOPSIS**

```
package-build container <stage> <start|stop|restart|recreate|rm|status|logs|pull>
```

**DESCRIPTION**

Runs a stage's Foundry in a Docker container, bind-mounted at the same
`FOUNDRYVTT_<STAGE>_DATA` directory `deploy <stage>` installs into — nothing
about the destination is stated twice. `.env.local` and `.env` are loaded
first.

`start` requires the stage's data root to exist and runs the image, passing
through `FOUNDRYVTT_<STAGE>_VERSION`, `FOUNDRYVTT_<STAGE>_WORLD` and
`FOUNDRYVTT_<STAGE>_LICENSE_KEY` when set. `stop` stops it. `restart` stops
it, clears a stale lock left by an unclean shutdown, and starts it again —
not `docker restart`, which leaves no window to clear the lock. `recreate`
removes the container first, so a changed world, license or cache
environment variable actually takes effect, then starts fresh. `rm` removes
the container. `status` runs `docker ps` filtered to this stage's container
name. `logs` follows its log. `pull` pulls the configured image
(`FOUNDRYVTT_CONTAINER_IMAGE`, then `packageBuild.container.image`, then a
floating `felddy/foundryvtt:release` tag when the package declares no
`compatibility.minimum`).

**OPTIONS**

| Positional | Type                                                                                  | Default | Description                                     |
| ---------- | ------------------------------------------------------------------------------------- | ------- | ----------------------------------------------- |
| `stage`    | string                                                                                | —       | Target stage, e.g. `dev`, `qa`, `prod`, `test`. |
| `action`   | string, one of `start`, `stop`, `restart`, `recreate`, `rm`, `status`, `logs`, `pull` | —       | What to do with the stage's container.          |

**Environment.** `FOUNDRYVTT_<STAGE>_DATA` (`start`, `restart`, `recreate`).
`FOUNDRYVTT_<STAGE>_PORT`, `FOUNDRYVTT_<STAGE>_VERSION`,
`FOUNDRYVTT_<STAGE>_WORLD`, `FOUNDRYVTT_<STAGE>_LICENSE_KEY`,
`FOUNDRYVTT_CONTAINER_IMAGE`, `FOUNDRYVTT_CACHE` (a shared download-cache
mount).

**EXIT STATUS**

The command's own status is `docker`'s exit status — `process.exit(status)`
— so a Docker failure surfaces as this command's own non-zero exit. 1 if
Docker is not on `PATH`, or (for `start`/`restart`/`recreate`) if the
stage's data root is unset or does not exist.

**EXAMPLES**

```
$ FOUNDRYVTT_DEV_DATA=/tmp/pb-docs-demo-410-data package-build container dev status
CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS    PORTS     NAMES
```

**SEE ALSO**

`package-build deploy <stage>`, `package-build e2e <action>`,
[Configuration](configuration.md).

### `package-build e2e <action>`

**NAME**

Drive the repository's end-to-end suite against a served Foundry world.

**SYNOPSIS**

```
package-build e2e seed
package-build e2e <run|open> [-- <suite args>]
package-build e2e fast [-- <suite args>]
package-build e2e sweep [-- <suite args>]
```

**DESCRIPTION**

Stands a disposable Foundry world up against the `test` stage and drives the
repository's own end-to-end suite against it — the suite itself is never
this package's; it is named in `packageBuild.e2e.suite`. Everything after
the action is the suite's own and is passed through untouched — this
command line deliberately parses none of it (`.strict(false)`; see
[Conventions](#conventions)). `.env.local` and `.env` are loaded first.

| Action  | Description                                                                  |
| ------- | ---------------------------------------------------------------------------- |
| `seed`  | Write the disposable world.                                                  |
| `run`   | Deploy, reseed, recreate the container, wait until _active_, then run.       |
| `open`  | The same from-scratch path as `run`, opening the suite's interactive runner. |
| `fast`  | The iteration loop: rebuild and re-run without tearing the world down.       |
| `sweep` | Repeat the full run against a Foundry build the repository does not pin.     |

`run`, `open` and `sweep` may change the pinned Foundry build; `sweep` exists
so `compatibility.verified` can be evidence rather than hope.

**OPTIONS**

No options of its own; every flag after the action belongs to the suite.

**Environment.** `FOUNDRYVTT_TEST_DATA` (required for every action —
end-to-end always targets the `test` stage). `FOUNDRYVTT_TEST_VERSION`,
`FOUNDRYVTT_TEST_LICENSE_KEY` for `run`/`open`/`fast`/`sweep`.

**EXIT STATUS**

`seed` — 1 if `FOUNDRYVTT_TEST_DATA` is unset, or on any other thrown error;
otherwise 0. `run`/`open`/`fast`/`sweep` — the command's own status is the
suite's own exit status, via `process.exit(status)`; 1 if
`packageBuild.e2e.suite` names no runner for the action being asked for.

**EXAMPLES**

```
$ FOUNDRYVTT_TEST_DATA=/tmp/pb-docs-demo-410-testdata package-build e2e seed
Seeded world 'demo-package-e2e' at /tmp/pb-docs-demo-410-testdata/Data/worlds/demo-package-e2e
  GM user:  Gamemaster (id heroiclandsE2EGM)
  password: demo-package-e2e

$ FOUNDRYVTT_TEST_DATA=/tmp/pb-docs-demo-410-testdata package-build e2e fast
package-build: This repository declares no end-to-end suite to `run`. Name one under `packageBuild.e2e.suite.run` — for example `run: [npx, cypress, run]`.
```

**SEE ALSO**

`package-build deploy <stage>`, `package-build container <stage> <action>`,
[Configuration](configuration.md).

---

## `content-build`

### `content-build package <action> [pack] [entry]`

**NAME**

Compile a content tree into Foundry compendium packs, or reverse the
process.

**SYNOPSIS**

```
content-build package compile [pack]
content-build package unpack [pack] [entry]
content-build package clean [pack] [entry]
```

**DESCRIPTION**

`compile` walks the content tree, writes one intermediate JSON file per
document per pack, then compiles each declared pack's JSON into LevelDB —
and refuses to compile _any_ pack when generation reported an error, so a
broken pack never ships beside packs that built cleanly. `unpack` extracts a
built LevelDB pack back to JSON, for inspecting or hand-editing an entry.
`clean` removes a pack's compiled LevelDB (and, with `entry`, a single
unpacked entry). Named without `pack`, `compile` builds every declared pack;
named with one, only that pack. Reads the content tree (`compile`) or the
staged LevelDB packs (`unpack`, `clean`); writes the intermediate JSON and
the staged LevelDB packs.

**Refused for `packageKind: documentation`**, for every action — `compile`,
`unpack` and `clean` alike. A package of that kind declares no packs by
rule, so there is nothing to compile, unpack or clean; a run that exited 0
having done nothing would be the quiet failure this toolchain refuses
everywhere else. Its site is built by `content-build site`, and its book by
`content-build pdf`.

**OPTIONS**

| Positional | Type                                        | Default             | Description                                                   |
| ---------- | ------------------------------------------- | ------------------- | ------------------------------------------------------------- |
| `action`   | string, one of `compile`, `unpack`, `clean` | —                   | The action to perform.                                        |
| `pack`     | string                                      | every declared pack | Name of the pack to act on.                                   |
| `entry`    | string                                      | every entry         | Name of an entry within the pack — `unpack` and `clean` only. |

**EXIT STATUS**

1 for `packageKind: documentation`, whatever the action. 1 if generation
reports any error — a pack that compiled zero entries from a non-empty
content tree, for instance, unless the pack declares `mayBeEmpty`. This
condition applies to `compile` only; `unpack` and `clean` have no generation
step to report against. 1 on any other thrown error. Otherwise 0.

**EXAMPLES**

```
$ content-build package compile   # packageKind: documentation
[…] ERROR: `packageKind: documentation` compiles no compendium, so there is nothing to compile. Build its site with `content-build site` and its book with `content-build pdf`.

$ content-build package compile
[…] Content tree: 4 note(s) at /private/tmp/pb-docs-demo-410/assets/content
[…] Pack items: /private/tmp/pb-docs-demo-410/assets/content → …/build/packs-json/items
[…] Compiled 0 items:
[…] Pack journals: /private/tmp/pb-docs-demo-410/assets/content → …/build/packs-json/journals
[…] Compiled 3 journal entries (0 documentation entries)
[…] Pack items: compiling to LevelDB at …/build/stage/packs/items
[…] Pack journals: compiling to LevelDB at …/build/stage/packs/journals
[…] Pack compilation complete.

$ content-build package unpack
[…] Extracting pack items
[…] Extracting pack journals
Wrote welcome.json
```

**SEE ALSO**

`content-build site`, `content-build pdf`, `content-build addresses diff`,
[Diagnostics](diagnostics.md), [Configuration](configuration.md).

### `content-build deps fetch`

**NAME**

Fill the caches a build resolves other packages through.

**SYNOPSIS**

```
content-build deps fetch [--from <zip|dir>] [--id <id>]
```

**DESCRIPTION**

The only action is `fetch`, which fills three caches under `build/cache/`:
the **content index** of every declared dependency, the **item catalogue**
of those that additionally declare `itemCatalog: true`, and the **site
navigation** — `https://www.heroiclands.org/nav.json`, the header menu
every package site renders, fetched for every package because every package
publishes a site. Its own command rather than a step of `package compile`
or `site`, so neither reaches the network — a build that downloads silently
is not reproducible and hides a dependency's version change behind a
passing run. Each cache is stamped complete only once its fetch finishes,
so a half-finished one reads as cold.

The navigation is fetched first, because every package needs it and it
depends on nothing a repository declares — so a dependency whose release
cannot be read stops the run with the navigation already cached.

`--from` fills the cache from a locally built artifact — a package zip, or
the directory it was built from — instead of a release, which is what makes
testing a dependency change against its consumers possible before any of it
ships; `--id` names which declared dependency `--from` supplies, needed only
when the repository declares more than one. `--from` fills that one
dependency's caches and nothing else: the navigation is not an artifact of
any dependency, and is fetched by a plain `deps fetch`.

**OPTIONS**

| Option   | Type   | Default | Description                                                                              |
| -------- | ------ | ------- | ---------------------------------------------------------------------------------------- |
| `--from` | string | —       | Fill the cache from a locally built artifact instead of a release.                       |
| `--id`   | string | —       | Which declared dependency `--from` supplies. Only needed when more than one is declared. |

**EXIT STATUS**

1 on any thrown error — including `--from` with no `--id` when the
repository declares anything other than exactly one dependency. Otherwise 0,
including when the repository declares no dependencies at all.

**EXAMPLES**

```
$ content-build deps fetch
[…] Fetched the site navigation to build/cache/navigation/nav.json.
[…] No relationship declares `itemCatalog: true`; nothing to fetch.
[…] This package declares no dependencies.

$ content-build deps fetch --from build/dist/module.zip
[…] ERROR: --from needs --id when a package declares several dependencies (declared: none)
```

**SEE ALSO**

`content-build site`, `content-build addresses diff`, [Configuration](configuration.md).

### `content-build docs item-fields`

**NAME**

Render this repository's item-frontmatter reference.

**SYNOPSIS**

```
content-build docs item-fields [--out <path>] [--check] [--title <title>]
```

**DESCRIPTION**

Renders this repository's item-frontmatter reference from the `fields` each
`itemBuilders` entry declares, so every consuming repository documents its
own registry with the same command. The framing — where the page is filed,
its title, its preamble — comes from `docs.itemFields` in configuration;
`--out` and `--title` override it for a one-off render. `--check` compares
against the file already on disk instead of writing it, for a CI gate;
because staleness is a property of the whole generated file, no line is
named. Reads the configured `itemBuilders` registries; writes (or checks)
the destination file, or prints to stdout when none is configured and
`--out` is not given.

**A destination under `paths.content` gets a complete note, not a typeless
page.** The content-tree walk collects every published page by its `type:`,
so a generated page filed there needs the envelope every other note carries
or the walk drops it silently — no build failure, no page, every wikilink
into it dead. So when `--out` (or `docs.itemFields.out`) resolves inside the
content tree, the written file carries:

- `type: doc`, `subType: reference` — out-of-world lookup material, like
  every other generated reference page;
- `shortcode`, derived from the destination's basename — lowercase
  alphanumerics only, so `item-frontmatter.md` derives `itemfrontmatter` —
  unless `docs.itemFields.frontmatter.shortcode` gives one;
- `name.full`, from the page's title;
- `pack: none` — the page publishes to the website and compiles into no
  compendium document.

`docs.itemFields.frontmatter` is deep-merged over that envelope, so a
consumer may add keys (`description`, `tags`) or override any of the derived
ones. `--check` then compares the **whole** file, envelope included — a page
committed with a hand-written or stale envelope reads as out of date exactly
as a stale body does. A destination outside the content tree gets the page
body alone, with no frontmatter, exactly as before.

**OPTIONS**

| Positional | Type                         | Default | Description             |
| ---------- | ---------------------------- | ------- | ----------------------- |
| `action`   | string, one of `item-fields` | —       | The document to render. |

| Option    | Type    | Default                 | Description                                            |
| --------- | ------- | ----------------------- | ------------------------------------------------------ |
| `--out`   | string  | `docs.itemFields.out`   | Write to this file instead of the configured location. |
| `--check` | boolean | `false`                 | Compare against the file already there; write nothing. |
| `--title` | string  | `docs.itemFields.title` | The page's H1.                                         |

**EXIT STATUS**

1 if `--check` is given with no destination to compare against. 1 if
`--check` finds the file out of date. 1 on any other thrown error. Otherwise 0.

**EXAMPLES**

```
$ content-build docs item-fields --out docs/item-fields.md --title "Demo Item Fields"
[…] Wrote docs/item-fields.md

$ content-build docs item-fields --out docs/item-fields.md --title "Demo Item Fields" --check
[…] docs/item-fields.md is up to date.
```

**SEE ALSO**

[Configuration](configuration.md).

### `content-build lint [root]`

**NAME**

Check a content tree's addresses and frontmatter without compiling it.

**SYNOPSIS**

```
content-build lint [root] [--no-references]
```

**DESCRIPTION**

Checks a content tree's addresses and frontmatter without compiling anything
— no LevelDB is opened and no Foundry manifest is needed, so it runs in
under a second and can gate a commit. Beyond address well-formedness, it
checks frontmatter against the declared vocabulary and each system's `sohl:`
/ `hm3:` block, the package's charset (so a book can pick a font that covers
it), that an icon a note writes is one the registry declares, and that
markup inside a note's body does not smuggle in a character the charset
check cannot see. `--no-references` turns off the check that a frontmatter
shortcode reference lands, for a tree whose cross-package references it
cannot see. Reads the content tree named by `root`, defaulting to
`paths.content`; writes nothing.

**OPTIONS**

| Positional | Type   | Default                        | Description           |
| ---------- | ------ | ------------------------------ | --------------------- |
| `root`     | string | the configured `paths.content` | Content tree to lint. |

| Option         | Type    | Default | Description                                         |
| -------------- | ------- | ------- | --------------------------------------------------- |
| `--references` | boolean | `true`  | Check that a frontmatter shortcode reference lands. |

**EXIT STATUS**

1 if any finding is an error (a warning-only run — the schema comparison's
unemitted-field advisories, for instance — exits 0). 1 if the content index
itself could not be built for any note. Otherwise 0.

**EXAMPLES**

```
$ content-build lint
[…] No `itemBuilders` registry declares the vocabulary of `demo`, so that system's block is unchecked — a key inside one is discarded at compile with no warning. Declare `itemBuilders: [demo]`.
[…] No published schema for demo@1.0.0, so emitted `system` fields are unchecked. A system generates its own; a module gets one from `content-build deps fetch`.
[…] Addresses and frontmatter are well-formed (4 address(es) across 4 note(s)).
```

**SEE ALSO**

`content-build links [root]`, `content-build reachability <dir> [file]`,
`content-build content-format schema`, `content-build content-format fields`,
`content-build content-format notes`, [Diagnostics](diagnostics.md),
[Configuration](configuration.md).

`content-build content-format <action>` checks `docs/content-format.md` —
the content-format specification this package ships — against reality, in
three ways that fail for different reasons at different times: `schema`,
`fields` and `notes`, one section below per action. All three read the
specification named by `--spec`, defaulting to the one this package ships,
and write nothing.

### `content-build content-format schema`

**NAME**

Compare the content-format specification against a published schema.

**SYNOPSIS**

```
content-build content-format schema --schema <system>=<path> [--schema <system>=<path> ...] [--spec <path>]
```

**DESCRIPTION**

Compares every `system.*` target the specification names against a
published `schema.json` (see `package-build schema`). A schema a system has
not yet published — HM3 today — is reported as unchecked rather than
skipped in silence, because a check that quietly does nothing reads exactly
like one that passed.

**OPTIONS**

| Option     | Type                         | Default                              | Description                               |
| ---------- | ---------------------------- | ------------------------------------ | ----------------------------------------- |
| `--spec`   | string                       | the shipped `docs/content-format.md` | The specification to read.                |
| `--schema` | string, repeatable, required | —                                    | A published schema, as `<system>=<path>`. |

**EXIT STATUS**

1 if any checked claim names a field no supplied schema declares, or if a
`--schema` entry is not `<system>=<path>`. Otherwise 0.

**EXAMPLES**

```
$ content-build content-format schema --schema sohl=schema.json
[…] 19 claim(s) about hm3 are unchecked — no schema was supplied for it, so nothing here confirms them.
[…] 76 mapping claim(s) confirmed against the supplied schemas.
```

**SEE ALSO**

`content-build content-format fields`, `content-build content-format notes`,
`package-build schema`, [Configuration](configuration.md).

### `content-build content-format fields`

**NAME**

Compare the specification's field tables against the compiled item
declarations.

**SYNOPSIS**

```
content-build content-format fields [--fields <system>] [--coverage] [--spec <path>]
```

**DESCRIPTION**

Compares the specification's per-type field tables against the
`itemBuilders` field declarations that actually compile those types —
checked, not merged, because the specification's vocabulary spans note
types (Scenes, Macros, JournalEntries) no item registry covers. A type only
one side describes is named as out of reach rather than silently skipped.
`--fields` reads one of this package's own shipped declaration sets
(`sohl`, `hm3`) instead of the consuming repository's configured
`itemBuilders` — this repository ships the specification and the SoHL
declarations together and configures no content tree of its own, so a
consumer's arrangement would not apply here. `--coverage` lists, per type,
the fields only one side names — advisory, not findings, since the two
vocabularies differ by design until a note's data fully moves under `data:`.

**OPTIONS**

| Option       | Type                         | Default                                       | Description                                         |
| ------------ | ---------------------------- | --------------------------------------------- | --------------------------------------------------- |
| `--spec`     | string                       | the shipped `docs/content-format.md`          | The specification to read.                          |
| `--fields`   | string, one of `sohl`, `hm3` | the consuming repository's own `itemBuilders` | A declaration set this package ships, by system id. |
| `--coverage` | boolean                      | `false`                                       | List, per type, the fields only one side names.     |

**EXIT STATUS**

1 if any compared field pair disagrees between the specification and the
declaration that compiles it. Otherwise 0.

**EXAMPLES**

```
$ content-build content-format fields --fields sohl --coverage
[…] 13 type(s) compared against sohl's declarations (56 field pair(s)).
[…] 12 type(s) the format declares are out of reach — no `itemBuilders` entry covers them: being, homepage, vehicle, armorlocation, lore, map, place, scenario, doc, macro, bundle, folder.
[…] affiliation: format only [commonSkills, demonym, economy, epithet, governance, lore, population, symbol, templatePriority], declaration only [level, office, society, subType, title]
```

**SEE ALSO**

`content-build content-format schema`, `content-build content-format notes`,
[Configuration](configuration.md).

### `content-build content-format notes`

**NAME**

Measure a content tree against the specification's vocabulary.

**SYNOPSIS**

```
content-build content-format notes [root] [--strict] [--spec <path>]
```

**DESCRIPTION**

Measures a content tree against the vocabulary the specification declares
per type. A report by default rather than a gate — every authored note
predates the specification, so a failing check would be red from the day it
landed and stay red for the length of a migration nobody could act on;
`--strict` raises its findings to errors, turned on slice by slice as each
class of finding reaches zero.

**OPTIONS**

| Positional | Type   | Default                        | Description              |
| ---------- | ------ | ------------------------------ | ------------------------ |
| `root`     | string | the configured `paths.content` | Content tree to measure. |

| Option     | Type    | Default                              | Description                                          |
| ---------- | ------- | ------------------------------------ | ---------------------------------------------------- |
| `--spec`   | string  | the shipped `docs/content-format.md` | The specification to read.                           |
| `--strict` | boolean | `false`                              | Fail on the findings instead of only reporting them. |

**EXIT STATUS**

1 if the content index could not be built for any note. Without `--strict`,
findings never fail the run. With `--strict`, 1 if there are any findings.
Otherwise 0.

**EXAMPLES**

```
$ content-build content-format notes
[…] 0 finding(s) across 4 note(s) measured against docs/content-format.md.
```

**SEE ALSO**

`content-build content-format schema`, `content-build content-format fields`,
`content-build lint [root]`, [Diagnostics](diagnostics.md),
[Configuration](configuration.md).

### `content-build links [root]`

**NAME**

Check that every link in a content tree lands.

**SYNOPSIS**

```
content-build links [root]
```

**DESCRIPTION**

Checks that every link in a content tree lands: a dead `#anchor`, a dead
qualified address, a link with no label (the bare `[[Name]]` alias form is
retired — every link is an address), a wikilink authored in frontmatter
(which is data and is never resolved), and a package homepage's markdown
links and `landing:` addresses, which are published verbatim and use no
wikilink at all. Also reports a vendored foreign-package content index that
has drifted out of reach, naming `content-build deps fetch` as the fix.
Reads the content tree named by `root`, defaulting to `paths.content`, and
the cached content indexes of any declared dependency; writes nothing.

**OPTIONS**

| Positional | Type   | Default                        | Description            |
| ---------- | ------ | ------------------------------ | ---------------------- |
| `root`     | string | the configured `paths.content` | Content tree to check. |

**EXIT STATUS**

1 if the content index could not be built for any note. 1 if a dependency's
cached content index is stale or unaddressable. 1 if any link problem is
found. Otherwise 0.

**EXAMPLES**

```
$ content-build links
[…] 2 notes: every link is a labelled address, every anchor link lands and every address resolves (0 cross-package reference(s) via manifest), no wikilink in frontmatter, every homepage address resolvable.
```

**SEE ALSO**

`content-build lint [root]`, `content-build reachability <dir> [file]`,
`content-build deps fetch`, [Diagnostics](diagnostics.md),
[Configuration](configuration.md).

### `content-build format [paths..]`

**NAME**

Check formatting with the shared Prettier configuration.

**SYNOPSIS**

```
content-build format [paths..] [--write]
```

**DESCRIPTION**

Checks formatting with the shared Prettier configuration, over the whole
repository rather than only the content tree — a repository that has not
configured this package at all must still be able to format itself. A
consumer's own Prettier configuration wins wherever it declares one; only
its `.prettierignore` excludes a path. Every run first reports, as
warnings, any shared convention the repository's own configuration resolves
differently (or declares none of at all) — nothing there fails the run,
because a deliberate local choice is allowed to win; the point is only that
it is visible, rather than silently guaranteeing an editor and a bare `npx
prettier` disagree with this command. `--write` rewrites unformatted files
in place instead of reporting them; `--check` (the default) only reports.
Reads every matched file; `--write` rewrites them.

**OPTIONS**

| Positional | Type      | Default              | Description                    |
| ---------- | --------- | -------------------- | ------------------------------ |
| `paths`    | string(s) | the whole repository | Files or directories to check. |

| Option    | Type    | Default             | Description                                                                                      |
| --------- | ------- | ------------------- | ------------------------------------------------------------------------------------------------ |
| `--write` | boolean | `false`             | Rewrite unformatted files in place instead of reporting them.                                    |
| `--check` | boolean | (default behaviour) | Report unformatted files without rewriting them. Naming both `--check` and `--write` is refused. |

**EXIT STATUS**

1 if `--check` and `--write` are both named. 1 if any file is unformatted
(`--check` mode) or could not be formatted at all (`--write` mode).
Otherwise 0.

**EXAMPLES**

```
$ content-build format
warning: this repository declares no Prettier configuration, so `content-build format` applies the shared conventions while an editor and a bare `npx prettier` apply Prettier's own to the same tree; declare them in a prettier.config.mjs — export { default } from "@heroiclands/package-build/prettier";
build/dist/module.json: error: is not formatted; run `content-build format --write` to fix it
[…]
[…] ERROR: 10 of 15 file(s) are not formatted.

$ content-build format --write
[…] Formatted 10 of 15 file(s).

$ content-build format
[…] Formatting is clean (15 file(s)).
```

**SEE ALSO**

`content-build markdown [paths..]`, [Diagnostics](diagnostics.md).

### `content-build markdown [paths..]`

**NAME**

Lint markdown with the shared markdownlint rule set.

**SYNOPSIS**

```
content-build markdown [paths..] [--fix]
```

**DESCRIPTION**

Lints markdown with the shared markdownlint rule set — the structural
checks Prettier cannot make: a heading level that skips, two sibling
headings sharing an anchor, a reversed link, an emphasis marker other than
the one these repositories write. Runs over the repository rather than the
content tree, taking its rules from this package unless the consumer
declares its own. `--fix` applies the fixes markdownlint can make. Reads
every matched file; `--fix` rewrites them.

**OPTIONS**

| Positional | Type      | Default                               | Description    |
| ---------- | --------- | ------------------------------------- | -------------- |
| `paths`    | string(s) | every markdown file in the repository | Globs to lint. |

| Option  | Type    | Default | Description                            |
| ------- | ------- | ------- | -------------------------------------- |
| `--fix` | boolean | `false` | Apply the fixes markdownlint can make. |

**EXIT STATUS**

1 if any finding remains after fixing (or without `--fix`, if any finding
exists at all). Otherwise 0.

**EXAMPLES**

```
$ content-build markdown
[…] Markdown is clean.
```

**SEE ALSO**

`content-build format [paths..]`, [Diagnostics](diagnostics.md).

### `content-build content-index [root]`

**NAME**

Emit this package's note index as JSON Lines.

**SYNOPSIS**

```
content-build content-index [root] [--out <dir>]
```

**DESCRIPTION**

Emits this package's note index as JSON Lines — one record per note,
carrying its full frontmatter plus its place in the tree. Every build
already walks the tree and parses every note's frontmatter and then throws
the result away; this publishes that walk so anything outside a build can
query the content without paying for a second walk. Its own command rather
than only a build step, because the point is that anyone can regenerate it
at will — the artifact costs a frontmatter parse, not a build, which is
also what lets it stay uncommitted. Reads the content tree named by `root`,
defaulting to `paths.content`; writes `<contentPackage>-metadata.jsonl`
into `--out`, defaulting to the configured `paths.contentIndex`.

**OPTIONS**

| Positional | Type   | Default                        | Description           |
| ---------- | ------ | ------------------------------ | --------------------- |
| `root`     | string | the configured `paths.content` | Content tree to read. |

| Option  | Type   | Default                             | Description              |
| ------- | ------ | ----------------------------------- | ------------------------ |
| `--out` | string | the configured `paths.contentIndex` | Directory to write into. |

**EXIT STATUS**

1 on any thrown error. Otherwise 0.

**EXAMPLES**

```
$ content-build content-index
[…] demo → build/content-index/demo-metadata.jsonl (4 notes, 2 KiB)
```

**SEE ALSO**

`content-build site`, `content-build pdf`, `content-build deps fetch`,
[Configuration](configuration.md).

### `content-build site`

**NAME**

Build the Hugo source tree from the content tree.

**SYNOPSIS**

```
content-build site
```

**DESCRIPTION**

Writes the whole Hugo source tree under `build/hugo/` — the sibling of
`package compile`: the same tree, rendered as pages instead of compiled
into packs. Everything a consumer would otherwise write for itself happens
here: the walk, address derivation, the address index, table expansion,
wikilink resolution, code-fence protection, the foreign-manifest merge, and
the Hugo configuration itself. The consumer's script then runs Hugo over the
tree — `hugo --source build/hugo` — and this command never does.

**A site is its homepage and its pages.** The `type: homepage` note is
written as the mount's `_index.md`, so Hugo renders it at
`/<contentPackage>/`; every other note is one page at
`/<contentPackage>/<type>-<shortcode>/`. Nothing is generated between them —
no section directory, no listing, no tag page — and the generated
configuration disables the `section`, `taxonomy`, `term` and `RSS` kinds on
every site. An index of what the package publishes is a `doc` note carrying a
content table, authored where every other page is.

Three things are written, and nothing outside `build/`:

- `build/hugo/hugo.toml`, generated on every run from `package.json`
  (`homepage`, `description`, `author`), `package-build.config.yaml`
  (`packageBuild.manifest.title`, `site.assets`, `site.notfound`,
  `site.hugo`), the organisation's constants, the installed
  `@heroiclands/hugo-theme`'s location, and the navigation `deps fetch`
  cached. Every value's source is listed under
  [the generated Hugo configuration](configuration.md#the-generated-hugo-configuration).
- `build/hugo/content/`, the content mount — the homepage as its `_index.md`,
  and the content tree's pages flat below `publish.address.prefix`. Wiped on
  every run.
- `publishDir` pointing Hugo at `build/site/<contentPackage>/`, the
  deployment root `package-build site-root` writes beside. Nothing Hugo
  reads lands in what is published.

The configuration's sources are read before the output tree is touched, so
a missing `homepage`, a cold navigation cache or an uninstalled theme fails
with the previous site intact. Every gate is then checked and reported, and
the run stops at the first that fires, ordered so the report names the cause
rather than its symptoms — an unusable dependency manifest, reported after
the links that failed because of it, would otherwise read as a pile of
broken notes. Reads the content tree named by `paths.content`.

**OPTIONS**

None.

**EXIT STATUS**

1 if `package.json` declares no `homepage`, or one that does not end
`/<contentPackage>/`; if `packageBuild.manifest.title` is undeclared; if the
navigation has not been fetched (`content-build deps fetch` fills the cache
and is named in the message); or if `@heroiclands/hugo-theme` is not
installed. 1 if any gate fires — no homepage or two competing for it, a
frontmatter wikilink, an address that cannot be derived, a stale or
unaddressable dependency manifest, an address published twice, a table that
failed to expand, or a dead wikilink. Otherwise 0.

**EXAMPLES**

```
$ content-build site
[…] wrote 1 homepage(s) + 1 content page(s) to build/hugo/content
[…] wrote build/hugo/hugo.toml

$ content-build site
[…] ERROR: the site navigation has not been fetched. Run `content-build deps fetch` first.
```

**SEE ALSO**

`content-build deps fetch`, `package-build site-root`, `content-build package <action> [pack] [entry]`, `content-build pdf`, `content-build content-index [root]`,
[Diagnostics](diagnostics.md), [Configuration](configuration.md).

### `content-build pdf`

**NAME**

Build the book the content tree publishes as.

**SYNOPSIS**

```
content-build pdf [--out <path>] [--book-version <version>] [--compile]
```

**DESCRIPTION**

Builds the book the content tree publishes as — the third surface beside
`package compile` and `site`, reporting in the same `file:line:column:
severity: message` shape both of those use. **Not building a book is a
normal outcome and exits 0**: a package publishing only a homepage, one
with no `pdf:` block, and one with no content tree have each said they
publish no book, and failing the command over that would break the release
of every package that is not a book. `--compile` (on by default) runs the
Typst compiler; `--no-compile` emits the Typst source and stops there,
which is what lets the source be inspected or compiled by hand. Reads the
content tree named by `pdf.document` and `paths.content`; writes the
`.typ` source and, unless `--no-compile`, the `.pdf`, to `--out` or the
configured `pdf.out`.

**OPTIONS**

| Option           | Type    | Default                  | Description                                                        |
| ---------------- | ------- | ------------------------ | ------------------------------------------------------------------ |
| `--out`          | string  | the configured `pdf.out` | Write the book here instead.                                       |
| `--book-version` | string  | —                        | Stamp this version on the title page and in the file name.         |
| `--compile`      | boolean | `true`                   | Run the Typst compiler. `--no-compile` emits the source and stops. |

**EXIT STATUS**

0 when there is a stated reason not to build (`publish.site` is
`homepage`, no `pdf:` block, no content tree). 1 if the document tree
`pdf.document` names cannot be read or parsed, or on any other thrown
error. Otherwise 0 — findings inside a book that did build (a filter that
matched nothing, for instance) are reported but never fail the command.

**EXAMPLES**

```
$ content-build pdf
[…] No book built: no `pdf:` block is configured, so this package publishes no book

$ content-build pdf --no-compile
demo-book: error: the document tree named by `pdf.document` cannot be read
```

**SEE ALSO**

`content-build site`, `content-build package <action> [pack] [entry]`,
[Diagnostics](diagnostics.md), [Configuration](configuration.md).

### `content-build reachability <dir> [file]`

**NAME**

Check that every document in a corpus is reachable by reading.

**SYNOPSIS**

```
content-build reachability <dir> [file] [--index <shortcode> ...] [--root <path>]
```

**DESCRIPTION**

Checks that every document in a corpus is reachable by reading — a corpus
is a book, not a pile of notes, so every page in it must be linked from the
chapter or section that owns it. The corpus is named on the command line
because it never changes for a given repository, so a consumer hardcodes
the invocation in `package.json` and gets the check with no script of its
own. `--index` names a page (by shortcode) that is walked _to_ but not
_through_ — an index links to nearly everything it covers, so walking one
would make the check vacuous. Reads the content tree named by `--root`,
defaulting to `paths.content`; writes nothing.

**OPTIONS**

| Positional | Type   | Default     | Description                                              |
| ---------- | ------ | ----------- | -------------------------------------------------------- |
| `dir`      | string | —           | The corpus directory, relative to the content tree root. |
| `file`     | string | `README.md` | The corpus's entry page within that directory.           |

| Option    | Type               | Default                        | Description                                    |
| --------- | ------------------ | ------------------------------ | ---------------------------------------------- |
| `--index` | string, repeatable | `[]`                           | Shortcode of a page walked to but not through. |
| `--root`  | string             | the configured `paths.content` | Content tree to read.                          |

**EXIT STATUS**

1 if the content index could not be built for any note. 1 if any document
in the corpus is unreachable from the entry page. Otherwise 0.

**EXAMPLES**

```
$ content-build reachability Guide
[…] All 2 document(s) in Guide are reachable from README.md.

$ content-build reachability assets/content
[…] ERROR: no note at assets/content/README.md, so the corpus has no page to be read from
```

**SEE ALSO**

`content-build links [root]`, `content-build lint [root]`, [Diagnostics](diagnostics.md),
[Configuration](configuration.md).

### `content-build addresses diff`

**NAME**

Report every published address a build no longer publishes.

**SYNOPSIS**

```
content-build addresses diff --from <zip|dir> [--strict]
```

**DESCRIPTION**

Reports every published `(type, shortcode)` address this build no longer
publishes, against a released artifact — the signal that a shortcode
rename or a withdrawn note used to cost nothing and now does, emitted in
the repository doing the renaming while the change is still in front of
its author. Its own command rather than a step of `package compile`,
because it reads a _second_ artifact the compile knows nothing about and
asks a question about a release, not about a build — a repository between
releases has nothing to compare against. `--from` names the baseline
explicitly — a release's `.zip`, or the directory built from one — never
derived and never downloaded, for the same reason `deps fetch --from` is
explicit: a command that reaches the network on its own is not
reproducible. A finding is placed against the tree, at the note that made
the rename, not against the compiled output it was read from. Reads the
baseline artifact and the current content tree; writes nothing.

**OPTIONS**

| Positional | Type                  | Default | Description            |
| ---------- | --------------------- | ------- | ---------------------- |
| `action`   | string, one of `diff` | —       | The action to perform. |

| Option     | Type    | Default                 | Description                                                                                   |
| ---------- | ------- | ----------------------- | --------------------------------------------------------------------------------------------- |
| `--from`   | string  | — (required for `diff`) | The released artifact to compare against — a package zip, or the directory it was built from. |
| `--strict` | boolean | `false`                 | Report findings as errors and exit non-zero, for a release workflow that gates on them.       |

**EXIT STATUS**

1 if `diff` is named with no `--from`. Without `--strict`, a renamed or
withdrawn address is reported as a warning and does not fail the run. With
`--strict`, 1 if any address is no longer published. 1 on any other thrown
error (the baseline declaring an Item pack this build does not have, or
this repository declaring no Item pack at all to diff). Otherwise 0.

**EXAMPLES**

```
$ content-build addresses diff --from build/dist/module.zip
[…] ERROR: demo-package@1.0.0: pack "items" is declared at packs/items, which the package does not contain
```

**SEE ALSO**

`content-build package <action> [pack] [entry]`, `content-build deps fetch`,
[Diagnostics](diagnostics.md).
