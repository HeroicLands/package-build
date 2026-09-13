# Command reference

`@heroiclands/package-build` ships two binaries. `package-build` is the
packaging half — clean, stage, check, package, deploy, run a Foundry
container, drive the end-to-end suite. `content-build` is the content half —
compile a note tree into compendium packs, check it, publish it as a site or a
book, and manage the caches a build resolves other packages through.

Both read `package-build.config.yaml` from the repository root — see
`docs/configuration.md` for every key. Neither reads it for `--version` or
`--help`: those two answer in a directory with no configuration at all, and
every other invocation resolves the configuration and fails loudly when it is
missing or wrong.

## Conventions

**Every finding is `file:line:column: severity: message`**, the path starting
the line — the diagnostic contract this package's own build tooling emits and
that both binaries' content-side commands use for anything found in a specific
file. A field that cannot be known is dropped rather than guessed: `file:line:`
when the column means nothing, `file:` when only the file is known.

**Exit codes are 0 or 1.** 0 is success — including a command that found
advisory warnings but no error, and a command that had deliberately nothing to
do. 1 is failure: a configuration error, a missing prerequisite, or findings
that the command treats as errors. Each section below states exactly what
makes that command's run a 1.

**`package-build` has one failure path for everything **`.fail()`** does not
handle specially: every thrown error, from any command, is caught, printed as
one line — `package-build: <message>`, or the bare diagnostic when the error
already carries its own `file:line:column:` — and turned into exit code 1. A
command that additionally emits findings of its own (`lang coverage`, `yaml`,
`bundle check`, …) is called out below.**

**`content-build` has no such umbrella.** Each command catches its own errors,
logs them (prefixed `[timestamp] [LEVEL]:` for ordinary failures, unprefixed
for a located diagnostic) and sets `process.exitCode = 1`; a command-line parse
error — an unknown flag, a missing required option, an action outside its
`choices` — is reported by yargs' own default handler and also exits 1.

**Both binaries are `strict()` and `demandCommand(1, …)`.** An unknown command
or option is refused rather than ignored, and running either with no command
prints usage and exits 1 rather than silently doing nothing — the failure mode
that let a typo in a build script pass the step it was meant to run.

---

## `package-build`

### `package-build clean`

```
package-build clean [--distclean]
```

Removes this repository's build artifacts: the conventional directories the
library knows about, plus anything named in `packageBuild.clean.extra` for a
repository that generates more — a site's `content/`, `public/` and
`resources/`, say. Nothing is read from the content tree; nothing is written.

| Option        | Type    | Default | Description                 |
| ------------- | ------- | ------- | --------------------------- |
| `--distclean` | boolean | `false` | Also remove `node_modules`. |

**Exit codes.** 1 on any thrown error (a missing or invalid configuration).
Otherwise 0, whether or not there was anything to remove.

```
$ package-build clean
Nothing to clean.
```

### `package-build assets`

```
package-build assets
```

Stages this repository's static files into the package root, from the table in
`packageBuild.assets` — each entry names a `from` and a `to`, and `to` is
relative to the staged package root, so a table reads `lang`, not
`build/stage/lang`. A repository that has to transform a file on the way names
a module in `packageBuild.assetTransform`, exporting
`transform(sourcePath) -> string | null` — `null` copies the file verbatim,
anything else replaces its content. Reads every `from` path; writes into
`packageBuild.stageDir`.

No options.

**Exit codes.** 1 if `packageBuild.assetTransform` is declared but cannot be
loaded, or exports no `transform` function. 1 on any other thrown error.
Otherwise 0 — including when `packageBuild.assets` is empty, which logs and
stages nothing rather than failing.

```
$ package-build assets
✅ Static assets staged (1 entries, 1 files).
```

### `package-build schema`

```
package-build schema [--check]
```

Publishes this package's DataModel field sets as `schema.json`, read by
`content-build content-format schema` (and, in a consuming package, by
`content-build lint`'s emitted-versus-declared check). The registries to walk
come from `packageBuild.schema`; a repository that declares none has nothing
to publish. `--check` compares the committed file against what the source
would produce now instead of rewriting it, so CI can gate on the file being
current. Reads the registries `packageBuild.schema` names; writes (or checks)
`schema.json` at the repository root.

| Option    | Type    | Default | Description                                                                    |
| --------- | ------- | ------- | ------------------------------------------------------------------------------ |
| `--check` | boolean | `false` | Fail when the committed `schema.json` is out of date rather than rewriting it. |

**Exit codes.** 1 when `--check` finds the committed file does not match what
the source would produce. 1 on any other thrown error. Otherwise 0 — including
when `packageBuild.schema` is empty, which logs and publishes nothing.

```
$ package-build schema
package-build: no `packageBuild.schema` declared; nothing to publish.
```

### `package-build manifest`

```
package-build manifest
```

Generates `system.json` or `module.json` into the build stage — `system.json`
when `packageKind` is `systems`, `module.json` otherwise. There is no template:
every key comes from `packageBuild.manifest`, from configuration this
repository already carries (`packageKind`, `packageId`, `compatibility`, the
`packs` list, `relationships`), or from a module named in
`packageBuild.manifestFlags` for a flag the repository has to compute itself —
the compendium address of a document that exists only once the content tree
has been walked. Reads the shared pack configuration and `package.json`;
writes the manifest into `packageBuild.stageDir`.

**Refused for `packageKind: documentation`.** A manifest is the file Foundry
reads to install a package, and a documentation package is not one — emitting
`module.json` for it would advertise an installable package with no packs, no
compatibility range and no id. Its site is built by `content-build site`, and
its book by `content-build pdf`.

No options.

**Exit codes.** 1 for `packageKind: documentation`. 1 if
`packageBuild.manifestFlags` is declared but cannot be loaded, or exports no
`flags` function. 1 on any other thrown error (a manifest key the
configuration cannot supply — `package.json` naming no `repository.url`, for
instance). Otherwise 0.

```
$ package-build manifest
✅ Wrote build/stage/module.json (10 keys, 2 packs).

$ package-build manifest   # packageKind: documentation
package-build: `packageKind: documentation` ships no Foundry package, so there is no manifest to generate. The site and the book are built by `content-build`.
```

### `package-build lang <action>`

```
package-build lang check
package-build lang coverage [--unused]
package-build lang hardcoded
```

Three independent questions about this repository's localization, each blind
to what the others see.

- **`check`** — does every localization file survive
  `foundry.utils.expandObject`? A dotted-prefix collision (`"a.b": 1` beside
  `"a.b.c": 2`) makes it throw, and Foundry drops the whole file silently.
  Reads every file matching `packageBuild.lang.sources`.
- **`coverage`** — does every key the package references exist, and is every
  key it declares referenced? A referenced-but-missing key fails the run,
  because it renders to a player as its own raw key string; an
  unreferenced-but-declared key is reported and does not fail, because no scan
  sees every way a key can be reached. Reads `packageBuild.lang.primary`, and
  every file matching `packageBuild.lang.scripts` and
  `packageBuild.lang.templates`. A repository that generates keys by a
  convention of its own names a module in `packageBuild.lang.references`,
  exporting `references(context) -> ReferenceSet`.
- **`hardcoded`** — does the markup's user-visible text go through
  localization, and does each template still compile? The reverse of
  `coverage`, which is blind to a template that mentions no key at all. Reads
  every file matching `packageBuild.lang.templates`.

Nothing is written by any of the three.

| Option     | Type    | Default | Description                                                                     |
| ---------- | ------- | ------- | ------------------------------------------------------------------------------- |
| `--unused` | boolean | `false` | `coverage` only: list every unreferenced key instead of a preview capped at 20. |

**Exit codes.** `check` — 1 if any file fails `expandObject`, printing
`packageBuild.lang.help` first when the repository declares one. `coverage` —
1 if any reference is missing (an unreferenced key alone does not fail it).
`hardcoded` — 1 if any user-visible literal is unlocalized or any template
fails to compile. Each also dies with 1 if its source glob matches nothing at
all. 1 on any other thrown error. Otherwise 0.

```
$ package-build lang check
package-build: 1 localization file(s) are expandObject-safe.

$ package-build lang coverage
package-build: 1 key(s) declared in lang/en.json · 1 referenced · 0 namespace(s) · 0 dynamic shape(s) · 0 missing · 0 unreferenced

$ package-build lang hardcoded
package-build: 1 template(s) fully localized and compiling.
```

### `package-build labels <action>`

```
package-build labels check [--registry <path>] [--doc <path>]
```

`check` compares the machine label registry synced to GitHub against the
documented reference table, and reports where they disagree — a label the
registry has that the table does not, or the reverse. Neither derives from the
other, so nothing else notices when they drift. Reads both files named below;
writes nothing.

| Option       | Type   | Default                      | Description                                                    |
| ------------ | ------ | ---------------------------- | -------------------------------------------------------------- |
| `--registry` | string | `.github/labels.yml`         | The machine registry synced to GitHub.                         |
| `--doc`      | string | `.github/ISSUE_REPORTING.md` | The documented reference whose §3 table lists the same labels. |

**Exit codes.** 1 if either file does not exist. 1 if the registry and the
table disagree on any label. Otherwise 0.

```
$ package-build labels check --registry .github/labels.yml --doc .github/ISSUE_REPORTING.md
package-build: registry and §3 agree (11 labels).
```

### `package-build yaml [paths..]`

```
package-build yaml [paths..]
```

Lints note frontmatter and every other YAML file in the repository — the check
that exists because a duplicate frontmatter key used to parse to nothing and
the note it belonged to silently lost every field, with every later build pass
reporting success. Needs no ESLint configuration of its own, so a repository
with one for its own source code (`Song-of-Heroic-Lands-FoundryVTT`'s `src/`)
keeps it untouched.

| Positional | Type      | Default                                                                                               | Description             |
| ---------- | --------- | ----------------------------------------------------------------------------------------------------- | ----------------------- |
| `paths`    | string(s) | every YAML file and markdown frontmatter git would consider (tracked, plus untracked and not ignored) | Files or globs to lint. |

**Exit codes.** 1 if any finding is an error. A warning-only run exits 0.

```
$ package-build yaml
package-build: 2 file(s) checked · 0 error(s) · 0 warning(s)
```

### `package-build bundle <action>`

```
package-build bundle check
```

`check` verifies the generated manifest and the staged code bundle agree —
catching three ways a package builds successfully and still does not load, all
invisible to the bundler itself: the entry declared under both `esmodules` and
`scripts` (Foundry loads it twice), under neither (Foundry never loads it), or
under `esmodules` while the file only parses as a classic script (which fails
at runtime with a message about whatever `import` came first, naming nothing
about the manifest). Both files are read from the stage, because the stage is
what ships.

No options.

**Exit codes.** 1 if the staged manifest or bundle is missing — build the stage
first. 1 if the two disagree. Otherwise 0.

```
$ package-build bundle check
package-build: demo-package.mjs is declared under "esmodules" and loads as one.
```

### `package-build release`

```
package-build release [--no-pdf]
```

Zips the staged package for a GitHub release. The artifact name comes from
`packageKind` — a system ships as `system.json`'s sibling, a module as
`module.json`'s — so no repository states it a second time. When the package
publishes content (`publish.site: content`), it also builds the content-tree
book (see `content-build pdf`) and reports it alongside the archive; `--no-pdf`
skips that step for a release that has a tree but does not want the book this
time. A book that fails to build is reported, never fatal — the archive above
is the release regardless. Reads the staged package and (for the book) the
content tree; writes `<artifact>.zip` and, unless skipped, the book, both under
`build/dist`.

| Option     | Type    | Default | Description                                                                 |
| ---------- | ------- | ------- | --------------------------------------------------------------------------- |
| `--no-pdf` | boolean | —       | Skip the content-tree book even when the package would otherwise build one. |

**Exit codes.** 1 on any thrown error (an unstaged package, a manifest that
advertises a metadata file the content index never wrote). Otherwise 0 — book
findings are reported on stderr but do not fail the release.

```
$ package-build release
✅ Packaged 1.0.0 for release: build/dist/module.zip (0.0 MB)
   No book: `publish.site` is `homepage`, which fences the content surfaces off — the tree is not walked and no book is built. Publish content to build one.
```

### `package-build deploy <stage>`

```
package-build deploy <stage>
```

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

| Positional | Type   | Default | Description                                     |
| ---------- | ------ | ------- | ----------------------------------------------- |
| `stage`    | string | —       | Target stage, e.g. `dev`, `qa`, `prod`, `test`. |

**Environment.** `FOUNDRYVTT_<STAGE>_DATA` (required — the destination).
`FOUNDRYVTT_<STAGE>_AGENT`, `FOUNDRYVTT_<STAGE>_PORT`,
`FOUNDRYVTT_<STAGE>_USER`, `FOUNDRYVTT_<STAGE>_KEY` (SFTP destinations only).

**Exit codes.** 1 if `FOUNDRYVTT_<STAGE>_DATA` is unset. 1 on any other thrown
error. Otherwise 0.

```
$ package-build deploy dev
package-build: No destination configured for stage 'dev'. Set FOUNDRYVTT_DEV_DATA — for example FOUNDRYVTT_DEV_DATA="/path/to/foundryvtt/data".

$ FOUNDRYVTT_DEV_DATA=/tmp/pb-docs-demo-410-data package-build deploy dev
Deploying /private/tmp/pb-docs-demo-410/build/stage → /tmp/pb-docs-demo-410-data/Data/modules/demo-package (local copy)
Deployed stage 'dev' successfully.
```

### `package-build container <stage> <action>`

```
package-build container <stage> <start|stop|restart|recreate|rm|status|logs|pull>
```

Runs a stage's Foundry in a Docker container, bind-mounted at the same
`FOUNDRYVTT_<STAGE>_DATA` directory `deploy <stage>` installs into — nothing
about the destination is stated twice. `.env.local` and `.env` are loaded
first.

| Positional | Type                                                                                  | Default | Description                                     |
| ---------- | ------------------------------------------------------------------------------------- | ------- | ----------------------------------------------- |
| `stage`    | string                                                                                | —       | Target stage, e.g. `dev`, `qa`, `prod`, `test`. |
| `action`   | string, one of `start`, `stop`, `restart`, `recreate`, `rm`, `status`, `logs`, `pull` | —       | What to do with the stage's container.          |

`start` requires the stage's data root to exist and runs the image, passing
through `FOUNDRYVTT_<STAGE>_VERSION`, `FOUNDRYVTT_<STAGE>_WORLD` and
`FOUNDRYVTT_<STAGE>_LICENSE_KEY` when set. `stop` stops it. `restart` stops it,
clears a stale lock left by an unclean shutdown, and starts it again — not
`docker restart`, which leaves no window to clear the lock. `recreate` removes
the container first, so a changed world, license or cache environment variable
actually takes effect, then starts fresh. `rm` removes the container. `status`
runs `docker ps` filtered to this stage's container name. `logs` follows its
log. `pull` pulls the configured image (`FOUNDRYVTT_CONTAINER_IMAGE`, then
`packageBuild.container.image`, then a floating `felddy/foundryvtt:release`
tag when the package declares no `compatibility.minimum`).

**Environment.** `FOUNDRYVTT_<STAGE>_DATA` (`start`, `restart`, `recreate`).
`FOUNDRYVTT_<STAGE>_PORT`, `FOUNDRYVTT_<STAGE>_VERSION`,
`FOUNDRYVTT_<STAGE>_WORLD`, `FOUNDRYVTT_<STAGE>_LICENSE_KEY`,
`FOUNDRYVTT_CONTAINER_IMAGE`, `FOUNDRYVTT_CACHE` (a shared download-cache
mount).

**Exit codes.** The command's own status is `docker`'s exit status —
`process.exit(status)` — so a Docker failure surfaces as this command's own
non-zero exit. 1 if Docker is not on `PATH`, or (for `start`/`restart`/
`recreate`) if the stage's data root is unset or does not exist.

```
$ FOUNDRYVTT_DEV_DATA=/tmp/pb-docs-demo-410-data package-build container dev status
CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS    PORTS     NAMES
```

### `package-build e2e <action>`

```
package-build e2e seed
package-build e2e <run|open> [-- <suite args>]
package-build e2e fast [-- <suite args>]
package-build e2e sweep [-- <suite args>]
```

Stands a disposable Foundry world up against the `test` stage and drives the
repository's own end-to-end suite against it — the suite itself is never this
package's; it is named in `packageBuild.e2e.suite`. `seed` writes the world.
`run` and `open` are the from-scratch path — deploy, reseed, recreate the
container, wait for it to become _active_ (not merely reachable), then run —
and are the only two that may change the pinned Foundry build. `fast` is the
iteration loop: rebuild and re-run without tearing the world down. `sweep`
repeats the full run against a Foundry build the repository does not pin, so
`compatibility.verified` can be evidence rather than hope. Everything after the
action is the suite's own and is passed through untouched — this command line
deliberately parses none of it. `.env.local` and `.env` are loaded first.

No options of its own; every flag after the action belongs to the suite.

**Environment.** `FOUNDRYVTT_TEST_DATA` (required for every action —
end-to-end always targets the `test` stage).
`FOUNDRYVTT_TEST_VERSION`, `FOUNDRYVTT_TEST_LICENSE_KEY` for `run`/`open`/
`fast`/`sweep`.

**Exit codes.** `seed` — 1 if `FOUNDRYVTT_TEST_DATA` is unset, or on any other
thrown error; otherwise 0. `run`/`open`/`fast`/`sweep` — the command's own
status is the suite's own exit status, via `process.exit(status)`; 1 if
`packageBuild.e2e.suite` names no runner for the action being asked for.

```
$ FOUNDRYVTT_TEST_DATA=/tmp/pb-docs-demo-410-testdata package-build e2e seed
Seeded world 'demo-package-e2e' at /tmp/pb-docs-demo-410-testdata/Data/worlds/demo-package-e2e
  GM user:  Gamemaster (id heroiclandsE2EGM)
  password: demo-package-e2e

$ FOUNDRYVTT_TEST_DATA=/tmp/pb-docs-demo-410-testdata package-build e2e fast
package-build: This repository declares no end-to-end suite to `run`. Name one under `packageBuild.e2e.suite.run` — for example `run: [npx, cypress, run]`.
```

---

## `content-build`

### `content-build package <action> [pack] [entry]`

```
content-build package compile [pack]
content-build package unpack [pack] [entry]
content-build package clean [pack] [entry]
```

Compiles a content tree into Foundry LevelDB compendium packs, or reverses the
process. `compile` walks the content tree, writes one intermediate JSON file
per document per pack, then compiles each declared pack's JSON into LevelDB —
and refuses to compile _any_ pack when generation reported an error, so a
broken pack never ships beside packs that built cleanly. `unpack` extracts a
built LevelDB pack back to JSON, for inspecting or hand-editing an entry.
`clean` removes a pack's compiled LevelDB (and, with `entry`, a single unpacked
entry). Named without `pack`, `compile` builds every declared pack; named with
one, only that pack. Reads the content tree (`compile`) or the staged LevelDB
packs (`unpack`, `clean`); writes the intermediate JSON and the staged LevelDB
packs.

**Refused for `packageKind: documentation`**, for every action — `compile`,
`unpack` and `clean` alike. A package of that kind declares no packs by rule,
so there is nothing to compile, unpack or clean; a run that exited 0 having
done nothing would be the quiet failure this toolchain refuses everywhere
else. Its site is built by `content-build site`, and its book by
`content-build pdf`.

| Positional | Type                                        | Default             | Description                                                   |
| ---------- | ------------------------------------------- | ------------------- | ------------------------------------------------------------- |
| `action`   | string, one of `compile`, `unpack`, `clean` | —                   | The action to perform.                                        |
| `pack`     | string                                      | every declared pack | Name of the pack to act on.                                   |
| `entry`    | string                                      | every entry         | Name of an entry within the pack — `unpack` and `clean` only. |

**Exit codes.** 1 for `packageKind: documentation`, whatever the action. 1 if
generation reports any error — a pack that compiled zero entries from a
non-empty content tree, for instance, unless the pack declares `mayBeEmpty`. 1
on any other thrown error. Otherwise 0.

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

### `content-build deps <action>`

```
content-build deps fetch [--from <zip|dir>] [--id <id>]
```

The only action is `fetch`, which fills the caches a build resolves other
packages through: the **content index** of every declared dependency, and the
**item catalogue** of those that additionally declare `itemCatalog: true`. Its
own command rather than a step of
`package compile`, so a compile never reaches the network — a build that
downloads silently is not reproducible and hides a dependency's version change
behind a passing run. `--from` fills the cache from a locally built artifact —
a package zip, or the directory it was built from — instead of a release,
which is what makes testing a dependency change against its consumers possible
before any of it ships; `--id` names which declared dependency `--from`
supplies, needed only when the repository declares more than one. Writes into
the configured foreign-cache directory.

| Option   | Type   | Default | Description                                                                              |
| -------- | ------ | ------- | ---------------------------------------------------------------------------------------- |
| `--from` | string | —       | Fill the cache from a locally built artifact instead of a release.                       |
| `--id`   | string | —       | Which declared dependency `--from` supplies. Only needed when more than one is declared. |

**Exit codes.** 1 on any thrown error — including `--from` with no `--id` when
the repository declares anything other than exactly one dependency. Otherwise
0, including when the repository declares no dependencies at all.

```
$ content-build deps fetch
[…] No relationship declares `itemCatalog: true`; nothing to fetch.
[…] This package declares no dependencies.

$ content-build deps fetch --from build/dist/module.zip
[…] ERROR: --from needs --id when a package declares several dependencies (declared: none)
```

### `content-build docs <action>`

```
content-build docs item-fields [--out <path>] [--check] [--title <title>]
```

Renders this repository's item-frontmatter reference from the `fields` each
`itemBuilders` entry declares, so every consuming repository documents its own
registry with the same command. The framing — where the page is filed, its
title, its preamble — comes from `docs.itemFields` in configuration; `--out`
and `--title` override it for a one-off render. `--check` compares against the
file already on disk instead of writing it, for a CI gate; because staleness is
a property of the whole generated file, no line is named. Reads the configured
`itemBuilders` registries; writes (or checks) the destination file, or prints
to stdout when none is configured and `--out` is not given.

| Positional | Type                         | Default | Description             |
| ---------- | ---------------------------- | ------- | ----------------------- |
| `action`   | string, one of `item-fields` | —       | The document to render. |

| Option    | Type    | Default                 | Description                                            |
| --------- | ------- | ----------------------- | ------------------------------------------------------ |
| `--out`   | string  | `docs.itemFields.out`   | Write to this file instead of the configured location. |
| `--check` | boolean | `false`                 | Compare against the file already there; write nothing. |
| `--title` | string  | `docs.itemFields.title` | The page's H1.                                         |

**Exit codes.** 1 if `--check` is given with no destination to compare against.
1 if `--check` finds the file out of date. 1 on any other thrown error.
Otherwise 0.

```
$ content-build docs item-fields --out docs/item-fields.md --title "Demo Item Fields"
[…] Wrote docs/item-fields.md

$ content-build docs item-fields --out docs/item-fields.md --title "Demo Item Fields" --check
[…] docs/item-fields.md is up to date.
```

### `content-build lint [root]`

```
content-build lint [root] [--no-references]
```

Checks a content tree's addresses and frontmatter without compiling anything —
no LevelDB is opened and no Foundry manifest is needed, so it runs in under a
second and can gate a commit. Beyond address well-formedness, it checks
frontmatter against the declared vocabulary and each system's `sohl:` / `hm3:`
block, the package's charset (so a book can pick a font that covers it), that
an icon a note writes is one the registry declares, and that markup inside a
note's body does not smuggle in a character the charset check cannot see.
`--no-references` turns off the check that a frontmatter shortcode reference
lands, for a tree whose cross-package references it cannot see. Reads the
content tree named by `root`, defaulting to `paths.content`; writes nothing.

| Positional | Type   | Default                        | Description           |
| ---------- | ------ | ------------------------------ | --------------------- |
| `root`     | string | the configured `paths.content` | Content tree to lint. |

| Option         | Type    | Default | Description                                         |
| -------------- | ------- | ------- | --------------------------------------------------- |
| `--references` | boolean | `true`  | Check that a frontmatter shortcode reference lands. |

**Exit codes.** 1 if any finding is an error (a warning-only run — the schema
comparison's unemitted-field advisories, for instance — exits 0). 1 if the
content index itself could not be built for any note. Otherwise 0.

```
$ content-build lint
[…] No `itemBuilders` registry declares the vocabulary of `demo`, so that system's block is unchecked — a key inside one is discarded at compile with no warning. Declare `itemBuilders: [demo]`.
[…] No published schema for demo@1.0.0, so emitted `system` fields are unchecked. A system generates its own; a module gets one from `content-build deps fetch`.
[…] Addresses and frontmatter are well-formed (4 address(es) across 4 note(s)).
```

### `content-build content-format <action>`

```
content-build content-format schema --schema <system>=<path> [--schema <system>=<path> ...] [--spec <path>]
content-build content-format fields [--fields <system>] [--coverage] [--spec <path>]
content-build content-format notes [root] [--strict] [--spec <path>]
```

Checks `docs/content-format.md` — the content-format specification this
package ships — against reality, in three ways that fail for different reasons
at different times. Every action reads the specification named by `--spec`,
defaulting to the one this package ships; writes nothing.

#### `content-build content-format schema`

Compares every `system.*` target the specification names against a published
`schema.json` (see `package-build schema`). A schema a system has not yet
published — HM3 today — is reported as unchecked rather than skipped in
silence, because a check that quietly does nothing reads exactly like one that
passed.

| Option     | Type                         | Default                              | Description                               |
| ---------- | ---------------------------- | ------------------------------------ | ----------------------------------------- |
| `--spec`   | string                       | the shipped `docs/content-format.md` | The specification to read.                |
| `--schema` | string, repeatable, required | —                                    | A published schema, as `<system>=<path>`. |

**Exit codes.** 1 if any checked claim names a field no supplied schema
declares, or if a `--schema` entry is not `<system>=<path>`. Otherwise 0.

```
$ content-build content-format schema --schema sohl=schema.json
[…] 19 claim(s) about hm3 are unchecked — no schema was supplied for it, so nothing here confirms them.
[…] 76 mapping claim(s) confirmed against the supplied schemas.
```

#### `content-build content-format fields`

Compares the specification's per-type field tables against the `itemBuilders`
field declarations that actually compile those types — checked, not merged,
because the specification's vocabulary spans note types (Scenes, Macros,
JournalEntries) no item registry covers. A type only one side describes is
named as out of reach rather than silently skipped. `--fields` reads one of
this package's own shipped declaration sets (`sohl`, `hm3`) instead of the
consuming repository's configured `itemBuilders` — this repository ships the
specification and the SoHL declarations together and configures no content
tree of its own, so a consumer's arrangement would not apply here. `--coverage`
lists, per type, the fields only one side names — advisory, not findings, since
the two vocabularies differ by design until a note's data fully moves under
`data:`.

| Option       | Type                         | Default                                       | Description                                         |
| ------------ | ---------------------------- | --------------------------------------------- | --------------------------------------------------- |
| `--spec`     | string                       | the shipped `docs/content-format.md`          | The specification to read.                          |
| `--fields`   | string, one of `sohl`, `hm3` | the consuming repository's own `itemBuilders` | A declaration set this package ships, by system id. |
| `--coverage` | boolean                      | `false`                                       | List, per type, the fields only one side names.     |

**Exit codes.** 1 if any compared field pair disagrees between the
specification and the declaration that compiles it. Otherwise 0.

```
$ content-build content-format fields --fields sohl --coverage
[…] 13 type(s) compared against sohl's declarations (56 field pair(s)).
[…] 12 type(s) the format declares are out of reach — no `itemBuilders` entry covers them: being, homepage, vehicle, armorlocation, lore, map, place, scenario, doc, macro, bundle, folder.
[…] affiliation: format only [commonSkills, demonym, economy, epithet, governance, lore, population, symbol, templatePriority], declaration only [level, office, society, subType, title]
```

#### `content-build content-format notes`

Measures a content tree against the vocabulary the specification declares per
type. A report by default rather than a gate — every authored note predates
the specification, so a failing check would be red from the day it landed and
stay red for the length of a migration nobody could act on; `--strict` raises
its findings to errors, turned on slice by slice as each class of finding
reaches zero.

| Positional | Type   | Default                        | Description              |
| ---------- | ------ | ------------------------------ | ------------------------ |
| `root`     | string | the configured `paths.content` | Content tree to measure. |

| Option     | Type    | Default                              | Description                                          |
| ---------- | ------- | ------------------------------------ | ---------------------------------------------------- |
| `--spec`   | string  | the shipped `docs/content-format.md` | The specification to read.                           |
| `--strict` | boolean | `false`                              | Fail on the findings instead of only reporting them. |

**Exit codes.** 1 if the content index could not be built for any note.
Without `--strict`, findings never fail the run. With `--strict`, 1 if there
are any findings. Otherwise 0.

```
$ content-build content-format notes
[…] 0 finding(s) across 4 note(s) measured against docs/content-format.md.
```

### `content-build links [root]`

```
content-build links [root]
```

Checks that every link in a content tree lands: a dead `#anchor`, a dead
qualified address, a link with no label (the bare `[[Name]]` alias form is
retired — every link is an address), a wikilink authored in frontmatter (which
is data and is never resolved), and a package homepage's markdown links and
`landing:` addresses, which are published verbatim and use no wikilink at all.
Also reports a vendored foreign-package content index that has drifted out of
reach, naming `content-build deps fetch` as the fix. Reads the content tree
named by `root`, defaulting to `paths.content`, and the cached content indexes
of any declared dependency; writes nothing.

| Positional | Type   | Default                        | Description            |
| ---------- | ------ | ------------------------------ | ---------------------- |
| `root`     | string | the configured `paths.content` | Content tree to check. |

**Exit codes.** 1 if the content index could not be built for any note. 1 if a
dependency's cached content index is stale or unaddressable. 1 if any link
problem is found. Otherwise 0.

```
$ content-build links
[…] 2 notes: every link is a labelled address, every anchor link lands and every address resolves (0 cross-package reference(s) via manifest), no wikilink in frontmatter, every homepage address resolvable.
```

### `content-build format [paths..]`

```
content-build format [paths..] [--write]
```

Checks formatting with the shared Prettier configuration, over the whole
repository rather than only the content tree — a repository that has not
configured this package at all must still be able to format itself. A
consumer's own Prettier configuration wins wherever it declares one; only its
`.prettierignore` excludes a path. Every run first reports, as warnings, any
shared convention the repository's own configuration resolves differently (or
declares none of at all) — nothing there fails the run, because a deliberate
local choice is allowed to win; the point is only that it is visible rather
than silently guaranteeing an editor and a bare `npx prettier` disagree with
this command. `--write` rewrites unformatted files in place instead of
reporting them; `--check` (the default) only reports. Reads every matched
file; `--write` rewrites them.

| Positional | Type      | Default              | Description                    |
| ---------- | --------- | -------------------- | ------------------------------ |
| `paths`    | string(s) | the whole repository | Files or directories to check. |

| Option    | Type    | Default             | Description                                                                                      |
| --------- | ------- | ------------------- | ------------------------------------------------------------------------------------------------ |
| `--write` | boolean | `false`             | Rewrite unformatted files in place instead of reporting them.                                    |
| `--check` | boolean | (default behaviour) | Report unformatted files without rewriting them. Naming both `--check` and `--write` is refused. |

**Exit codes.** 1 if `--check` and `--write` are both named. 1 if any file is
unformatted (`--check` mode) or could not be formatted at all (`--write`
mode). Otherwise 0.

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

### `content-build markdown [paths..]`

```
content-build markdown [paths..] [--fix]
```

Lints markdown with the shared markdownlint rule set — the structural checks
Prettier cannot make: a heading level that skips, two sibling headings sharing
an anchor, a reversed link, an emphasis marker other than the one these
repositories write. Runs over the repository rather than the content tree,
taking its rules from this package unless the consumer declares its own.
`--fix` applies the fixes markdownlint can make. Reads every matched file;
`--fix` rewrites them.

| Positional | Type      | Default                               | Description    |
| ---------- | --------- | ------------------------------------- | -------------- |
| `paths`    | string(s) | every markdown file in the repository | Globs to lint. |

| Option  | Type    | Default | Description                            |
| ------- | ------- | ------- | -------------------------------------- |
| `--fix` | boolean | `false` | Apply the fixes markdownlint can make. |

**Exit codes.** 1 if any finding remains after fixing (or without `--fix`, if
any finding exists at all). Otherwise 0.

```
$ content-build markdown
[…] Markdown is clean.
```

### `content-build content-index [root]`

```
content-build content-index [root] [--out <dir>]
```

Emits this package's note index as JSON Lines — one record per note, carrying
its full frontmatter plus its place in the tree. Every build already walks the
tree and parses every note's frontmatter and then throws the result away; this
publishes that walk so anything outside a build can query the content without
paying for a second walk. Its own command rather than only a build step,
because the point is that anyone can regenerate it at will — the artifact
costs a frontmatter parse, not a build, which is also what lets it stay
uncommitted. Reads the content tree named by `root`, defaulting to
`paths.content`; writes `<contentPackage>-metadata.jsonl` into `--out`,
defaulting to the configured `paths.contentIndex`.

| Positional | Type   | Default                        | Description           |
| ---------- | ------ | ------------------------------ | --------------------- |
| `root`     | string | the configured `paths.content` | Content tree to read. |

| Option  | Type   | Default                             | Description              |
| ------- | ------ | ----------------------------------- | ------------------------ |
| `--out` | string | the configured `paths.contentIndex` | Directory to write into. |

**Exit codes.** 1 on any thrown error. Otherwise 0.

```
$ content-build content-index
[…] demo → build/content-index/demo-metadata.jsonl (4 notes, 2 KiB)
```

### `content-build site`

```
content-build site [--out <dir>]
```

Publishes the content tree as a Hugo content mount — the sibling of
`package compile`: the same tree, rendered as pages instead of compiled into
packs. Everything a consumer would otherwise write for itself happens here:
the walk, address derivation, the address index, table expansion, wikilink
resolution, code-fence protection, the foreign-manifest merge and the
section-landing backfill. Every gate is checked and reported, and the run
stops at the first that fires, ordered so the report names the cause rather
than its symptoms — an unusable dependency manifest, reported after the links
that failed because of it, would otherwise read as a pile of broken notes.
Reads the content tree named by `paths.content`; writes into `--out`,
defaulting to the configured `site.out`, which is wiped on every run.

| Option  | Type   | Default                   | Description                                              |
| ------- | ------ | ------------------------- | -------------------------------------------------------- |
| `--out` | string | the configured `site.out` | Write the mount here instead of the configured location. |

**Exit codes.** 1 if `site.out` is unset and `--out` is not given (an unset
output would resolve to the repository root, which this command refuses to
wipe). 1 if any gate fires — no homepage or two competing for it, a
frontmatter wikilink, an address that cannot be derived, a stale or
unaddressable dependency manifest, an address published twice, a table that
failed to expand, or a dead wikilink. Otherwise 0.

```
$ content-build site
[…] wrote 1 homepage(s) + 1 content page(s) + 0 tree page(s) + 0 landing(s) to build/site
```

### `content-build pdf`

```
content-build pdf [--out <path>] [--book-version <version>] [--compile]
```

Builds the book the content tree publishes as — the third surface beside
`package compile` and `site`, reporting in the same
`file:line:column: severity: message` shape both of those use. **Not building
a book is a normal outcome and exits 0**: a package publishing only a homepage,
one with no `pdf:` block, and one with no content tree have each said they
publish no book, and failing the command over that would break the release of
every package that is not a book. `--compile` (on by default) runs the Typst
compiler; `--no-compile` emits the Typst source and stops there, which is what
lets the source be inspected or compiled by hand. Reads the content tree named
by `pdf.document` and `paths.content`; writes the `.typ` source and, unless
`--no-compile`, the `.pdf`, to `--out` or the configured `pdf.out`.

| Option           | Type    | Default                  | Description                                                        |
| ---------------- | ------- | ------------------------ | ------------------------------------------------------------------ |
| `--out`          | string  | the configured `pdf.out` | Write the book here instead.                                       |
| `--book-version` | string  | —                        | Stamp this version on the title page and in the file name.         |
| `--compile`      | boolean | `true`                   | Run the Typst compiler. `--no-compile` emits the source and stops. |

**Exit codes.** 0 when there is a stated reason not to build (`publish.site`
is `homepage`, no `pdf:` block, no content tree). 1 if the document tree
`pdf.document` names cannot be read or parsed, or on any other thrown error.
Otherwise 0 — findings inside a book that did build (a filter that matched
nothing, for instance) are reported but never fail the command.

```
$ content-build pdf
[…] No book built: no `pdf:` block is configured, so this package publishes no book

$ content-build pdf --no-compile
demo-book: error: the document tree named by `pdf.document` cannot be read
```

### `content-build reachability <dir> [file]`

```
content-build reachability <dir> [file] [--index <shortcode> ...] [--root <path>]
```

Checks that every document in a corpus is reachable by reading — a corpus is a
book, not a pile of notes, so every page in it must be linked from the chapter
or section that owns it. The corpus is named on the command line because it
never changes for a given repository, so a consumer hardcodes the invocation
in `package.json` and gets the check with no script of its own. `--index`
names a page (by shortcode) that is walked _to_ but not _through_ — an index
links to nearly everything it covers, so walking one would make the check
vacuous. Reads the content tree named by `--root`, defaulting to
`paths.content`; writes nothing.

| Positional | Type   | Default     | Description                                              |
| ---------- | ------ | ----------- | -------------------------------------------------------- |
| `dir`      | string | —           | The corpus directory, relative to the content tree root. |
| `file`     | string | `README.md` | The corpus's entry page within that directory.           |

| Option    | Type               | Default                        | Description                                    |
| --------- | ------------------ | ------------------------------ | ---------------------------------------------- |
| `--index` | string, repeatable | `[]`                           | Shortcode of a page walked to but not through. |
| `--root`  | string             | the configured `paths.content` | Content tree to read.                          |

**Exit codes.** 1 if the content index could not be built for any note. 1 if
any document in the corpus is unreachable from the entry page. Otherwise 0.

```
$ content-build reachability Guide
[…] All 2 document(s) in Guide are reachable from README.md.

$ content-build reachability assets/content
[…] ERROR: no note at assets/content/README.md, so the corpus has no page to be read from
```

### `content-build addresses <action>`

```
content-build addresses diff --from <zip|dir> [--strict]
```

`diff` reports every published `(type, shortcode)` address this build no
longer publishes, against a released artifact — the signal that a shortcode
rename or a withdrawn note used to cost nothing and now does, emitted in the
repository doing the renaming while the change is still in front of its
author. Its own command rather than a step of `package compile`, because it
reads a _second_ artifact the compile knows nothing about and asks a question
about a release, not about a build — a repository between releases has
nothing to compare against. `--from` names the baseline explicitly — a
release's `.zip`, or the directory built from one — never derived and never
downloaded, for the same reason `deps fetch --from` is explicit: a command
that reaches the network on its own is not reproducible. A finding is placed
against the tree, at the note that made the rename, not against the compiled
output it was read from. Reads the baseline artifact and the current content
tree; writes nothing.

| Positional | Type                  | Default | Description            |
| ---------- | --------------------- | ------- | ---------------------- |
| `action`   | string, one of `diff` | —       | The action to perform. |

| Option     | Type    | Default                 | Description                                                                                   |
| ---------- | ------- | ----------------------- | --------------------------------------------------------------------------------------------- |
| `--from`   | string  | — (required for `diff`) | The released artifact to compare against — a package zip, or the directory it was built from. |
| `--strict` | boolean | `false`                 | Report findings as errors and exit non-zero, for a release workflow that gates on them.       |

**Exit codes.** 1 if `diff` is named with no `--from`. Without `--strict`, a
renamed or withdrawn address is reported as a warning and does not fail the
run. With `--strict`, 1 if any address is no longer published. 1 on any other
thrown error (the baseline declaring an Item pack this build does not have, or
this repository declaring no Item pack at all to diff). Otherwise 0.

```
$ content-build addresses diff --from build/dist/module.zip
[…] ERROR: demo-package@1.0.0: pack "items" is declared at packs/items, which the package does not contain
```
