---
shortcode: commands
name: { full: "Command reference" }
type: doc
subType: reference
---

# Command reference

`@heroiclands/package-build` ships the `package-build` command. It checks and
compiles content, builds sites and books, stages packages, writes manifests,
and manages release and deployment tasks.

The commands read `package-build.config.yaml` from the repository root — see
[Configuration](configuration.md) for every key. `--version` and `--help`
work in a directory with no configuration. Commands that need a package
resolve its configuration and report missing or invalid values.
`package-build --help` lists every command; `package-build <command> --help`
shows its actions and options.

Each command below reads like a manual page: **NAME**, **SYNOPSIS**,
**DESCRIPTION**, **OPTIONS**, **EXIT STATUS**, **EXAMPLES**, **SEE ALSO**, in
that order, as bold labels rather than headings. A command with no options
says so under **OPTIONS** rather than omitting the section.

## Conventions

**Every finding is `file:line:column: severity: message`**, the path starting
the line — the diagnostic contract this package's own build tooling emits and
that content commands use for anything found in a
specific file. A field that cannot be known is dropped rather than guessed:
`file:line:` when the column means nothing, `file:` when only the file is
known. See [Diagnostics](diagnostics.md) for the full contract.

**Exit codes are 0 or 1.** 0 is success — including a command that found
advisory warnings but no error, and a command that had deliberately nothing to
do. 1 is failure: a configuration error, a missing prerequisite, or findings
that the command treats as errors. Each command's own **EXIT STATUS** states
exactly what makes its run a 1.

Packaging handlers report a thrown error as `package-build: <message>`, or as
the bare diagnostic when it already has a location. Content handlers report
their own failures, with ordinary failures prefixed by loglevel and located
diagnostics unprefixed. Both forms exit 1. A parse error from an unknown flag,
missing option, or invalid action also exits 1.

The command uses `strict()` and `demandCommand(1, …)`. An unknown
command or option is refused rather than ignored, and running it with no
command prints usage and exits 1. `package-build e2e <action>` relaxes to
`.strict(false)` for everything after the action, because that belongs to the
suite or the fast loop and this command line must not judge it.

**`--help` / `-h` and `--version` are global.** The parser registers them
once, and `--help` can be used with any command for its own actions and options.
The command entries below list only their own options.

**`PACKAGE_BUILD_CONFIG`** names the configuration file explicitly instead of
the walk up from the working directory the CLI otherwise does — the only
environment variable the toolchain itself reads for configuration
resolution. `deploy`, `container` and `e2e` additionally read `FOUNDRYVTT_*`,
and `cdn publish` reads `CDN_*`, documented where each applies.

An option name recurring across commands is not a recurring meaning —
`--out`, `--check`, `--from` and `--strict` each carry their own default and
behaviour where they appear below; read the command, not the name.

---

## Standalone source preview

### `package-build-preview`

**NAME**

Render a Markdown buffer without a content index.

**SYNOPSIS**

`package-build-preview [--dark] [--current-date DATE] [--css] < note.md`

**DESCRIPTION**

Reads Markdown from stdin and writes an HTML fragment. Requires no package
configuration. Local Markdown and extensions render; constructs needing other
notes remain highlighted source. Shared CSS is supplied separately.

**OPTIONS**

- `--dark` — select dark mode; light is the default.
- `--current-date DATE` — override the setting-wide neutral current date; otherwise
  read the nearest root configuration setting, defaulting to `"720.1"`.
- `--css` — emit the shared scoped stylesheet without reading stdin.
- `--help`, `-h` — show usage.

**EXIT STATUS**

0 on success, 1 for an invalid argument or rendering error. Findings go to
stderr; stdout contains only HTML (or CSS with `--css`).

**EXAMPLES**

```sh
package-build-preview --dark < note.md > preview.html
package-build-preview --css > preview.css
```

**SEE ALSO**

[Source preview and Gitea renderer](source-preview.md), [API](api.md).

---

## Package and release operations

### `package-build ci`

**NAME**

Replay the commands from pull-request workflows.

**SYNOPSIS**

```text
package-build ci [--native]
```

**DESCRIPTION**

The default command runs in Docker on Linux against a clean export of the
current commit. It reads the repository's pull-request workflows under
`.gitea/workflows/` and runs their `run:` steps in workflow order. A failed
step stops the replay. Uncommitted changes are absent from the clean export.

`--native` runs the same steps on the host in the current working tree. It
needs no Docker and includes uncommitted changes, but its operating system and
existing files can differ from a clean CI runner. The steps themselves
still come from the workflow files.

The command lists `uses:` steps that it cannot run locally. A successful replay
covers the listed `run:` steps; the forge runs the published actions separately.
Workflow steps may install dependencies, generate files, or perform other
declared build actions.

**OPTIONS**

| Option     | Type    | Default | Description                                  |
| ---------- | ------- | ------- | -------------------------------------------- |
| `--native` | boolean | false   | Run on the host in the current working tree. |

**EXIT STATUS**

0 when every runnable step succeeds. 1 when a step fails, no pull-request
workflow supplies runnable steps, Docker is unavailable for the default mode,
or the replay cannot start.

**EXAMPLES**

```bash
package-build ci
package-build ci --native
```

**SEE ALSO**

[End-to-end testing](guides/e2e.md), [Project setup](project-setup.md).

### `package-build init [directory]`

**NAME**

Create a HeroicLands content package or check an existing one.

**SYNOPSIS**

```text
package-build init [directory] [--kind <kind>] [--name <name>] [--title <title>] [--description <description>] [--author <author>] [--license <license>] [--core-minimum <version>] [--core-verified <version>]
package-build init --check [directory]
```

**DESCRIPTION**

The directory defaults to the current directory. If it does not exist, `init`
creates it. The directory needs no Git repository, `package.json`, or local
installation of package-build. It may contain unrelated files, but `init`
refuses a package-build configuration or any file it would overwrite. It
generates a homepage, introduction, package metadata, content configuration,
book document tree, website and book scripts, formatting rules, changeset
configuration, label registry, and build workflow. It does not install
dependencies, initialize Git, or deploy a site.

`--check` reads the named directory and reports missing or invalid project
requirements without writing anything. It accepts existing files with valid
custom content and scripts; they need not be identical to the scaffold.

Without a terminal, the identity and license arguments must be supplied. At a
terminal, missing values are prompted. The package name defaults to the target
directory's basename and determines the content package id by removing hyphens.
The package kind defaults to `modules`; the license template defaults to
`original`. `systems` and `modules` receive a journal pack and Foundry
manifest configuration. `documentation` receives no Foundry pack or manifest.
Every kind includes site and book targets. Typst is needed to build the
book locally; deployment needs separate hosting configuration.

**OPTIONS**

| Option            | Type                                     | Default                   | Description                                               |
| ----------------- | ---------------------------------------- | ------------------------- | --------------------------------------------------------- |
| `directory`       | path                                     | current directory         | New or existing target directory.                         |
| `--check`         | boolean                                  | `false`                   | Inspect an existing package without writing.              |
| `--kind`          | `systems`, `modules`, or `documentation` | `modules`                 | Package kind.                                             |
| `--name`          | string                                   | target directory basename | npm and Foundry package name.                             |
| `--title`         | string                                   | words of the package name | Reader-facing title.                                      |
| `--description`   | string                                   | —                         | Package and website description.                          |
| `--author`        | string                                   | —                         | Author credited in the package.                           |
| `--license`       | `original` or `fan`                      | `original`                | License template for original or unofficial fan material. |
| `--core-minimum`  | string                                   | `14.359`                  | Minimum Foundry core version for a Foundry package.       |
| `--core-verified` | string                                   | `14.364`                  | Verified Foundry core version for a Foundry package.      |

**EXIT STATUS**

0 when the package is created or passes `--check`. 1 when required answers are
missing, the target conflicts with an existing project file, a generated file
cannot be written, or `--check` finds an unmet requirement. A failed write
removes the files created by that invocation.

**EXAMPLES**

```bash
npm exec --package=@heroiclands/package-build -- package-build init acme-bestiary --kind modules --name acme-bestiary --title "Acme Bestiary" --description "Creatures of the reed flats." --author "Acme" --license original
cd acme-bestiary
npm install
npm run lint
npm run build:site
npm run serve:site
npm run build:book
package-build init --check
```

For a global installation, run `npm install --global
@heroiclands/package-build` once and then `package-build init [directory]`.

**SEE ALSO**

[Getting started](getting-started.md), [Project setup](project-setup.md),
[Configuration](configuration.md).

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

### `package-build stage reset`

**NAME**

Clear the assembled Foundry package stage before a complete build.

**SYNOPSIS**

```
package-build stage reset
```

**DESCRIPTION**

The `reset` action removes `packageBuild.stageDir` without removing the content index, PDF, site,
or other build outputs. Run it once before the commands that write assets, packs,
bundles, and the manifest. It succeeds when the stage is already empty.

**OPTIONS**

There are no options.

**EXIT STATUS**

1 on an invalid configuration or a stage directory outside the project. Otherwise 0.

**EXAMPLES**

```
$ package-build stage reset
Removed build/stage
```

**SEE ALSO**

[Project setup](project-setup.md), [Configuration](configuration.md).

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

Then stages the package's pictures itself. Every file under `assets/icons/`
and `assets/images/` whose provenance says `ai: false` and whose licence is on
the shipping list (the default list plus `packageBuild.shippingLicenses`) is copied flat to `icons/<basename>` or `images/<basename>`
at the package root, through the same transform, and the package's asset set,
`asset-sets/default.json`, lists what was staged. Everything else stays in the repository. See
[what a package ships](reference/format-details.md#what-a-package-ships).

The pictures are written beside whatever a `packageBuild.assets` row copied
into `icons/` or `images/`, and nothing there is removed. A picture whose
deployed path is already a file a row staged is an error, and no picture is
staged:

> ``build/stage/images/gate.png: error: `images/gate.png` is already in the stage, copied by a `packageBuild.assets` row; the picture `assets/images/places/gate.png` was not staged over it``
> A `packageBuild.assets` row that copies a picture root, a directory inside
> one, or a directory holding one is refused, because it would ship every file
> unfiltered.

**OPTIONS**

None.

**EXIT STATUS**

1 if `packageBuild.assetTransform` is declared but cannot be loaded, or
exports no `transform` function. 1 when a row copies a picture root, and 1 on
any asset finding — a file no provenance record covers, a record missing
`attribution`, `license` or `ai`, two files claiming one address — with
nothing staged. 1 on any other thrown error. Otherwise 0.

**EXAMPLES**

```
$ package-build assets
Pictures: 4 staged, 2 left out by provenance.
✅ Static assets staged (2 entries, 9 files).

$ package-build assets
package-build.config.yaml:14:17: error: `packageBuild.assets[6]` copies `assets/images`, which reaches assets/images/ — the stage copies the icon and image roots itself, flat and filtered by each file's provenance, so a row copying them would ship every file unfiltered. Remove the row
```

**SEE ALSO**

[Configuration](configuration.md).

### `package-build calendars`

**NAME**

Emit calendar definitions and Calendaria import files from the content index.

**SYNOPSIS**

```
package-build calendars --calendaria-version <version>
```

**DESCRIPTION**

Reads the package's current JSONL content index and writes
`build/calendars/<shortcode>.json` and
`build/calendars/<shortcode>.calendaria.json` for each calendar note. The
import file contains the same definition and a fixed `exportedAt` sentinel,
making both files reproducible. A package with no calendars gets an empty
`build/calendars/` directory. Run `package-build content-index` after changing
notes and before this command. Stage the generated directory with
`packageBuild.assets` when the Foundry package should ship it.

**OPTIONS**

`--calendaria-version` is required and identifies the Calendaria
import format targeted by the envelope. It has the form `major.minor.patch`.

**EXIT STATUS**

1 if the index is missing or invalid, a calendar shortcode is invalid or
duplicated, a calendar has no world year, or the version is invalid. Otherwise 0.

**EXAMPLES**

```
$ package-build calendars --calendaria-version 1.4.2
✅ 5 calendars emitted (10 files).
```

**SEE ALSO**

`package-build content-index`, [Getting started](getting-started.md).

### `package-build datefrom`

**NAME**

Convert a day in an authored calendar to a canonical date.

**SYNOPSIS**

```
package-build datefrom <calendar> <date>
```

**DESCRIPTION**

Reads the current content tree, resolves its world year and calendar eras, and
prints `<year>.<day>[:HHMMSS]` to standard output. `<calendar>` is a calendar
shortcode, full Address, or addressed era. The date follows the calendar's
`data.formats.std` pattern, or its first named pattern when `std` is absent.
For example, `MM/DD/Y GGG` reads `04/23/326 VR`. An era-relative year written
with `[yearInEra]` must identify its era. A date must specify a day;
year-only and month-only dates do not identify one canonical day.
Prefix the date with `~` to preserve an approximate value.

**OPTIONS**

None.

**EXIT STATUS**

1 if the content tree or calendar is invalid, the era is missing or mismatched,
or the date cannot be resolved to one day. Otherwise 0.

**EXAMPLES**

```
$ package-build datefrom vrcal '23 Taranis 326 VR'
326.114
```

**SEE ALSO**

`package-build dateto`, [Content format](content-format.md).

### `package-build dateto`

**NAME**

Express a canonical day in an authored calendar.

**SYNOPSIS**

```
package-build dateto <calendar> <canonical-date> [--format <name>]
```

**DESCRIPTION**

Reads the current content tree, selects the era covering the canonical day, and
prints the date using `data.formats.std`, or the first named pattern if `std`
is absent. The input is
`<year>.<day>[:HHMMSS]`, optionally prefixed with `~`. A date in a gap between
eras has no conversion.

**OPTIONS**

`--format` selects another named pattern from the calendar note; pass its name as the value.

**EXIT STATUS**

1 if the content tree or calendar is invalid, the canonical date is invalid,
or no era covers that day. Otherwise 0.

**EXAMPLES**

```
$ package-build dateto vrcal 326.114
23 Taranis 326 VR
```

**SEE ALSO**

`package-build datefrom`, [Content format](content-format.md).

### `package-build schema`

**NAME**

Publish this package's DataModel field sets as `schema.json`.

**SYNOPSIS**

```
package-build schema
```

**DESCRIPTION**

Publishes the registries named in `packageBuild.schema` as `schema.json`, read
by `package-build content-format schema` and, in a consuming package, by
`package-build lint`'s emitted-versus-declared check. A repository that
declares no registries has nothing to publish. Reads the registries
`packageBuild.schema` names; writes `build/schema.json`. A release publishes
it beside the archive and the manifest when `packageBuild.assets` names
`build/schema.json` (see `package-build release`); a module's
`package-build deps fetch` keeps the copy from the archive it downloads.

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

`package-build content-format schema`, `package-build lint [root]`,
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
`packageBuild.manifest.title` must be a non-empty string, so the staged
manifest carries the title Foundry requires for installation.

**Refused for `packageKind: documentation`.** A manifest is the file Foundry
reads to install a package, and a documentation package is not one —
emitting `module.json` for it would advertise an installable package with no
packs, no compatibility range and no id. Its site is built by
`package-build site build`, and its book by `package-build pdf`.

**OPTIONS**

None.

**EXIT STATUS**

1 for `packageKind: documentation`. 1 if `packageBuild.manifestFlags` is
declared but cannot be loaded, or exports no `flags` function. 1 on any other
thrown error (a manifest key the configuration cannot supply —
`package.json` naming no `repository.url`, or a missing or blank
`packageBuild.manifest.title`, for instance). Otherwise 0.

**EXAMPLES**

```
$ package-build manifest
✅ Wrote build/stage/module.json (10 keys, 2 packs).

$ package-build manifest   # packageKind: documentation
package-build: `packageKind: documentation` ships no Foundry package, so there is no manifest to generate. The site and the book are built by `package-build`.
```

**SEE ALSO**

`package-build site build`, `package-build pdf`, `package-build bundle check`,
[Configuration](configuration.md).

### `package-build site-root`

**NAME**

`package-build site-root` — write the deployment's `_headers`, and index the
site for search.

**SYNOPSIS**

```
package-build site-root [--out <dir>]
```

**DESCRIPTION**

The site is rendered into `<out>/<contentPackage>/`, because the deployment carries the
`/<contentPackage>/` prefix physically and the routing layer is a
path-preserving pass-through. The directory that is _uploaded_ is its parent,
and Cloudflare Pages reads `_headers` and `_redirects` from there and nowhere
else — a copy inside the prefix is published as a text file and never applied.
The render owns everything under the prefix; this owns what sits beside it.

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

With `_headers` written, the rendered site is indexed for search. Pagefind
reads the pages under `<out>/<contentPackage>/` that are reachable from the
homepage (see [the pages a reader finds](guides/site.md#decide-which-pages-a-reader-finds))
and writes the index into
`<out>/<contentPackage>/pagefind/`, so it is deployed with the pages and served
at `/<contentPackage>/pagefind/`; the theme loads `pagefind.js` from there,
relative to the site's base URL, and the browser bundle derives the prefix from
its own address, so nothing about the prefix is configured on either side. What
is indexed is the body of every reachable page and the homepage; the theme marks its own
chrome — header, footer, breadcrumbs, infobox, the related-pages card —
`data-pagefind-ignore`, and carries `data-pagefind-filter` attributes for a
page's `type` and `package`, so a search can be narrowed to one kind of page.
This command's part is only to run the indexer over whatever the theme
rendered.

The indexer is the `pagefind` package this toolchain depends on, which installs
the binary for the platform as an optional dependency; nothing goes on a
`PATH`. Every failure of the step is an error located at the rendered site —
`build/site/<contentPackage>: error: search index: …` — and a binary that is
not installed names the platform package `npm ci` installs.

[`site.search: false`](configuration.md#site) skips the step, and removes a
`pagefind/` an earlier build left beside the pages, so a site that wants no
search deploys none.

**OPTIONS**

`--out <dir>` — the directory that is deployed. Defaults to `build/site`.

**EXIT STATUS**

1 when `<out>/<contentPackage>/` holds no rendered site, which means the site
build has not run and writing root files would publish a deployment with nothing
under the prefix; 1 when the index cannot be built. Otherwise 0.

**EXAMPLES**

```
$ package-build site-root
✅ Wrote build/site/_headers.
✅ Indexed 412 pages for search into build/site/thalorna/pagefind/.
```

```
$ package-build site-root
✅ Wrote build/site/_headers.
Search is off (`site.search: false`), so no index was written.
```

**SEE ALSO**

`package-build site build`, [Configuration](configuration.md).

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
$ package-build bump @heroiclands/package-build --check
@heroiclands/package-build  22.6.0 → 22.7.0

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

The check that exists because a duplicate frontmatter key parses to
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
rarely. Accented letters keep proper names such as HârnMaster whole, so a
fragment of one does not trigger a code-token warning. A block's bold label
absent from a declared `changelog.labels` is
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
label is merged into a single block for that label. Prose and bullets are
retained, with exact duplicate items kept once. Opening paragraphs from
merged labels combine in source order before their items. Wrapped
paragraphs, nested item content and literal code stay intact. The merged
blocks are reordered: the unlabelled lead paragraph a
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
gets none. When the stage carries `asset-sets/default.json`, it writes
`icons.zip` and `images.zip` too, one per picture root the stage holds, each
with that set. When the content tree holds notes beyond its homepage, it
also builds the content-tree book (see `package-build pdf`) and reports it
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
   No book: The content tree contains only a homepage, so there is no book to build.
```

**SEE ALSO**

`package-build pdf`, `package-build schema`, [Configuration](configuration.md).

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

Once the new tree is in place, the previous one — renamed aside to
`<id>.old-<pid>` — is removed, along with any `<id>.old-<pid>` an earlier
deploy left beside the package, whatever its pid. A leftover tree still holds
a manifest, so Foundry reads it as a second copy of the package and logs it as
an invalid one on every start. Foundry running in a container writes files
owned by the container's user, which under rootless Docker is a mapped uid the
host user cannot unlink. When the host user is refused, a throwaway container
of the stage's image removes the tree as root on the same data root, the
mechanism `e2e` uses to hand its install to Foundry. If that fails too — no
`docker`, or a remote destination — the deploy still succeeds: it prints a
warning for each leftover tree, naming it and the command that removes it,
and leaves the tree under its `.old-<pid>` name for the next deploy to sweep.

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
Otherwise 0, including when the previous tree is left behind with a warning:
the new package is installed either way.

**EXAMPLES**

```
$ package-build deploy dev
package-build: No destination configured for stage 'dev'. Set FOUNDRYVTT_DEV_DATA — for example FOUNDRYVTT_DEV_DATA="/path/to/foundryvtt/data".

$ FOUNDRYVTT_DEV_DATA=/tmp/pb-docs-demo-410-data package-build deploy dev
Deploying /private/tmp/pb-docs-demo-410/build/stage → /tmp/pb-docs-demo-410-data/Data/modules/demo-package (local copy)
Deployed stage 'dev' successfully.

$ package-build deploy test
Deploying /srv/pkg/build/stage → /srv/fvtt-test/Data/systems/sohl (local copy)
Deployed stage 'test' successfully.
/srv/fvtt-test/Data/systems/sohl.old-4242: warning: the new package is installed, but its previous tree could not be removed (docker was not found on PATH. Install Docker and make sure the `docker` CLI is available.); remove it with `docker run --rm --user 0:0 --volume /srv/fvtt-test:/data --entrypoint rm felddy/foundryvtt:14 -rf /data/Data/systems/sohl.old-4242`
```

**SEE ALSO**

`package-build container <stage> <action>`, `package-build e2e <action>`,
[Configuration](configuration.md).

### `package-build cdn publish`

**NAME**

Upload every picture the package has to the CDN, and publish the art the
package leaves out as a named asset set.

**SYNOPSIS**

```
package-build cdn publish --set <file> --name <display name> [--dry-run]
```

**DESCRIPTION**

The one writer to `<site.assets>/<contentPackage>/`. It is run by hand, or by
a manually dispatched workflow; no build or release runs it.

Every icon and image under the package's picture roots is uploaded flat, as
`icons/<basename>` or `images/<basename>` — shipped and left-out pictures
alike, because the website draws every one of them from the same address the
site build gives it. `packageBuild.assetTransform` runs on each file exactly
as `package-build assets` runs it, so a picture on the CDN holds the bytes the
staged package holds. SVG is served as `image/svg+xml`.

The bucket is served at `site.assets`, so an object's key is its path below
that address: `thalorna/images/thorn.webp` is
`https://cdn.heroiclands.org/thalorna/images/thorn.webp`.

`--set` names the set file, written at `<site.assets>/<contentPackage>/<file>`.
It lists only the pictures the package leaves out — an address a set does not
list resolves to the shipped copy — chosen by the same rule the stage applies,
`packageBuild.shippingLicenses` included. Its shape is the shipped set's, with
each `source` the file's absolute CDN address:

```json
{
  "name": "Thalorna — illustrated",
  "package": "thalorna",
  "assets": [
    {
      "address": "thalorna-none-image-thorn",
      "source": "https://cdn.heroiclands.org/thalorna/images/thorn.webp",
      "target": "images/thorn.webp",
      "size": 48213
    }
  ]
}
```

Several sets may sit side by side under one package, each with its own file
name. `default.json` is refused: it is the shipped set's name.

A picture whose object already exists at the same size is skipped, and the set
file is skipped when its bytes are unchanged, so a second run uploads nothing.
A picture that fails to upload is reported and the rest carry on; the set file
is then withheld, since it would list a file the CDN does not hold.

**Refusals and reports.** A file under `icons/` or `images/` whose name is no
address — a basename that is not a shortcode, or two files claiming one — and
a provenance record that cannot be read stop the run before anything is
uploaded, each reported against its file. A note naming a picture the package
does not have, and a note naming left-out art that is not on the CDN when the
run ends, are warnings at the note's line and column: an art slot under
`data:`, an embed, or a body image.

**Credentials.** The store is an S3-compatible bucket — Cloudflare R2 for
`cdn.heroiclands.org` — signed with AWS Signature Version 4. Its settings are
read from the environment, after `.env.local` and `.env` are loaded:

| Variable                | What it is                                                                |
| ----------------------- | ------------------------------------------------------------------------- |
| `CDN_ENDPOINT`          | The S3 endpoint; for R2, `https://<account id>.r2.cloudflarestorage.com`. |
| `CDN_BUCKET`            | The bucket served at `site.assets`.                                       |
| `CDN_ACCESS_KEY_ID`     | The access key id of a token that can write the bucket.                   |
| `CDN_SECRET_ACCESS_KEY` | That token's secret. Never printed.                                       |

Setting some but not all of them is an error naming the missing ones. With
none set, `--dry-run` compares against the public CDN at `site.assets`
instead, read-only, and an upload is refused.

A workflow calls the command the same way, passing the four values as named
secrets in the step's environment:

```yaml
- run: npx package-build cdn publish --set alt-art.json --name "Thalorna — illustrated"
  env:
    CDN_ENDPOINT: ${{ secrets.CDN_ENDPOINT }}
    CDN_BUCKET: ${{ secrets.CDN_BUCKET }}
    CDN_ACCESS_KEY_ID: ${{ secrets.CDN_ACCESS_KEY_ID }}
    CDN_SECRET_ACCESS_KEY: ${{ secrets.CDN_SECRET_ACCESS_KEY }}
```

**OPTIONS**

| Option      | Type    | Default | Description                                                                 |
| ----------- | ------- | ------- | --------------------------------------------------------------------------- |
| `--set`     | string  | —       | Required. The set file's name under the package's CDN root, a `.json` file. |
| `--name`    | string  | —       | Required. The set's display name.                                           |
| `--dry-run` | boolean | `false` | List what would upload and what is skipped; write nothing.                  |

**EXIT STATUS**

1 when a picture's file has no address, when a picture fails to upload, when
`--set` is `default.json` or a path, when `site.assets` is undeclared, and
when an upload has no store configured. Warnings about notes do not change
it. Otherwise 0.

**EXAMPLES**

```
$ package-build cdn publish --set alt-art.json --name "Thalorna — illustrated" --dry-run
Dry run: comparing 582 pictures against https://cdn.heroiclands.org, read-only.
  would upload thalorna/icons/anvilbdg.svg (969 bytes)
  …
  would upload thalorna/alt-art.json (582 assets)
Would upload 582, skipped 0, failed 0; https://cdn.heroiclands.org/thalorna/alt-art.json lists 582 left-out pictures (would change).

$ package-build cdn publish --set default.json --name Shipped
package-build: `--set default.json` is refused: `default.json` is the shipped set's name, the fallback every other set is read against. Name the set for its art
```

**SEE ALSO**

`package-build assets`, `package-build release`,
[Configuration](configuration.md#site),
[Release and deploy](guides/release-and-deploy.md#publish-pictures-to-the-cdn).

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
`FOUNDRYVTT_<STAGE>_LICENSE_KEY` when set. Every other `FOUNDRY_*` and
`CONTAINER_*` variable passes through too, except that `FOUNDRY_USERNAME` and
`FOUNDRY_PASSWORD` are withheld when the image has no use for them: the pinned
build's `foundryvtt-<version>.zip` is already in the cache (`FOUNDRYVTT_CACHE`,
or `container_cache` beneath the data root when that is unset) and a licence
is available without the account (a licence key of 24 characters or more, or
`Config/license.json` in the data root). Given an account, the image signs in
to foundryvtt.com and requests a download URL on every container it creates,
cached or not, and a request refused with HTTP 429 stops it before Foundry
starts. `stop` stops it. `restart` stops
it, clears a stale lock left by an unclean shutdown, and starts it again —
not `docker restart`, which leaves no window to clear the lock. `recreate`
removes the container first, so a changed world, license or cache
environment variable actually takes effect, then starts fresh. `rm` removes
the container. `status` runs `docker ps` filtered to this stage's container
name. `logs` follows its log. `pull` pulls the configured image.

The image is `FOUNDRYVTT_CONTAINER_IMAGE`, then `packageBuild.container.image`,
then felddy's tag for the pinned build (`felddy/foundryvtt:14.359` for a stage
pinned to `14.359`), because each image installs its own build by default and
warns that a different `FOUNDRY_VERSION` may not work with it. A stage with no
exact pin takes the major tag of its pin or of `compatibility.minimum`
(`felddy/foundryvtt:14`), and a package that declares neither floats on
`felddy/foundryvtt:release`.

**OPTIONS**

| Positional | Type                                                                                  | Default | Description                                     |
| ---------- | ------------------------------------------------------------------------------------- | ------- | ----------------------------------------------- |
| `stage`    | string                                                                                | —       | Target stage, e.g. `dev`, `qa`, `prod`, `test`. |
| `action`   | string, one of `start`, `stop`, `restart`, `recreate`, `rm`, `status`, `logs`, `pull` | —       | What to do with the stage's container.          |

**Environment.** `FOUNDRYVTT_<STAGE>_DATA` (`start`, `restart`, `recreate`).
`FOUNDRYVTT_<STAGE>_PORT`, `FOUNDRYVTT_<STAGE>_VERSION`,
`FOUNDRYVTT_<STAGE>_WORLD`, `FOUNDRYVTT_<STAGE>_LICENSE_KEY`,
`FOUNDRYVTT_CONTAINER_IMAGE`, `FOUNDRYVTT_CACHE` (a shared download-cache
mount), `FOUNDRYVTT_CONTAINER_USER` (passed to `docker run --user`; `0:0`
under rootless Docker makes the data root's files belong to the host user,
because the image otherwise runs Foundry as user 1000 and ignores
`FOUNDRY_UID` and `FOUNDRY_GID`), `FOUNDRYVTT_CONTAINER_S3` (`1` or `true`
runs an S3-compatible server beside the container; see
[an S3 server for the container](guides/e2e.md#an-s3-server-for-the-container)).

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

## Content operations

### `package-build content run <targets..>`

**NAME**

Run selected content checks and outputs from one captured source tree.

**SYNOPSIS**

```text
package-build content run <targets..> [--no-references] [--pack <name>] [--out <dir>]
```

**DESCRIPTION**

Choose one or more of `index`, `lint`, `links` and `compile`. The command runs
each selected target once, in that order, regardless of the argument order.
They perform the same operations as `content-index`, `lint`, `links` and
`package compile`. The standalone commands remain available.

The selected operations share captured files, parsed frontmatter, content
records and exact-source markup scans. Public and complete SQL preparations
remain separate, as do prose-link checking and native document resolution.
Each invocation starts a fresh in-memory session; independent commands do
their own work. Finish dependency fetching, source generation and asset
preparation before running this command, and start a new invocation after
changing any input.

All selected preparations finish before the first output is written. If
source or writer preparation fails, `index` and `compile` leave existing
index, intermediate JSON and staged packs untouched. Read-only targets still
report the findings they can produce. An ordinary lint error does not block
an otherwise successful index or compile target. The command writes no
persistent source cache.

Selecting `compile` applies the package command's existing package-kind rule
before any writer. A documentation package can select `index` alone; selecting
`index compile` reports the compile refusal and leaves its index untouched.

**OPTIONS**

| Option            | Type    | Default                  | Description                                 |
| ----------------- | ------- | ------------------------ | ------------------------------------------- |
| `--references`    | boolean | true                     | Check frontmatter references during `lint`. |
| `--pack` `<name>` | string  | all configured packs     | Restrict `compile` to this pack.            |
| `--out` `<dir>`   | string  | configured content index | Set the `index` output directory.           |

**EXIT STATUS**

0 when every selected target succeeds, including advisory warnings. 1 when
arguments or preparation fail, or any selected target reports an error.

**EXAMPLES**

```bash
package-build content run lint links
package-build content run index compile
package-build content run index lint links compile
```

**SEE ALSO**

`package-build content-index`, `package-build lint`, `package-build links`,
`package-build package compile`, [Configuration](configuration.md),
[Programmatic sessions](api.md#enginecontentsession).

---

### `package-build package <action> [pack] [entry]`

**NAME**

Compile a content tree into Foundry compendium packs, or reverse the
process.

**SYNOPSIS**

```
package-build package compile [pack]
package-build package unpack [pack] [entry]
package-build package clean [pack] [entry]
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
everywhere else. Its site is built by `package-build site build`, and its book by
`package-build pdf`.

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
$ package-build package compile   # packageKind: documentation
[…] ERROR: `packageKind: documentation` compiles no compendium, so there is nothing to compile. Build its site with `package-build site build` and its book with `package-build pdf`.

$ package-build package compile
[…] Content tree: 4 note(s) at /private/tmp/pb-docs-demo-410/assets/content
[…] Pack items: /private/tmp/pb-docs-demo-410/assets/content → …/build/packs-json/items
[…] Compiled 0 items:
[…] Pack journals: /private/tmp/pb-docs-demo-410/assets/content → …/build/packs-json/journals
[…] Compiled 3 journal entries (0 documentation entries)
[…] Pack items: compiling to LevelDB at …/build/stage/packs/items
[…] Pack journals: compiling to LevelDB at …/build/stage/packs/journals
[…] Pack compilation complete.

$ package-build package unpack
[…] Extracting pack items
[…] Extracting pack journals
Wrote welcome.json
```

**SEE ALSO**

`package-build site build`, `package-build pdf`, `package-build addresses diff`,
[Diagnostics](diagnostics.md), [Configuration](configuration.md).

### `package-build deps fetch`

**NAME**

Fill the caches a build resolves other packages through.

**SYNOPSIS**

```
package-build deps fetch [--from <zip|dir>] [--id <id>]
```

**DESCRIPTION**

The only action is `fetch`, which fills three caches under `build/cache/`:
the **content index** of every declared dependency and of every
`recommends` or `conflicts` relationship that declares `itemCatalog: true`,
the **item catalogue or
asset archive** of those that additionally declare `itemCatalog: true` or
`assetArchive: true`, and the **site navigation** —
`https://www.heroiclands.org/nav.json`, the header menu every package site
renders, fetched for every package because every package publishes a site.
A relationship declaring both `itemCatalog: true` and `assetArchive: true`
is fetched once. Its own command rather than a step of `package compile` or
`site`, so neither reaches the network — a build that downloads silently is
not reproducible and hides a dependency's version change behind a passing
run. Each cache is stamped complete only once its fetch finishes, so a
half-finished one reads as cold.

`lint`, `links`, `site`, `pdf`, `map`, `reachability`, and `package compile`
check the declared dependencies' content-index cache before reading notes or
writing output. A cold cache produces a diagnostic at the package configuration
file naming `deps fetch`. These checks only read local files; `deps fetch` is
the separate step that reaches the network.

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
$ package-build deps fetch
[…] Fetched the site navigation to build/cache/navigation/nav.json.
[…] No relationship declares `itemCatalog: true` or `assetArchive: true`; nothing to fetch.
[…] This package declares no dependencies.

$ package-build deps fetch --from build/dist/module.zip
[…] ERROR: --from needs --id when a package declares several dependencies (declared: none)
```

**SEE ALSO**

`package-build site build`, `package-build addresses diff`, [Configuration](configuration.md).

### `package-build types check`

**NAME**

Check project declarations.

**SYNOPSIS**

```sh
package-build types check [--project <tsconfig>] [--exports]
```

**DESCRIPTION**

Check a TypeScript project's declarations with library checking enabled. The
default `--project` is `tsconfig.json`. Diagnostics in `node_modules` are
excluded; diagnostics in project files name the file, line, and column.
`--exports` also checks every declaration entry point advertised by
`package.json` `exports`, including wildcard subpaths. Run it after generating
declarations.

**OPTIONS**

| Option      | Default         | Meaning                                     |
| ----------- | --------------- | ------------------------------------------- |
| `--project` | `tsconfig.json` | TypeScript project file.                    |
| `--exports` | off             | Include published declaration entry points. |

**EXIT STATUS**

1 when a project declaration fails to type-check or an exported entry point is
missing; otherwise 0.

**EXAMPLES**

```sh
package-build types check --project tsconfig.json
```

**SEE ALSO**

`package-build docs links`.

### `package-build docs links`

**NAME**

Check documentation links.

**SYNOPSIS**

```sh
package-build docs links [--root <dir>]
```

**DESCRIPTION**

Check relative Markdown links and heading anchors in a documentation tree.
Code fences and code spans are ignored. The default root is `docs`; use
`--root <dir>` for another tree. Missing targets and anchors are reported at
the link's file, line, and column.

**OPTIONS**

| Option   | Default | Meaning             |
| -------- | ------- | ------------------- |
| `--root` | `docs`  | Documentation root. |

**EXIT STATUS**

1 when a link or anchor fails to resolve; otherwise 0.

**EXAMPLES**

```sh
package-build docs links --root docs
```

**SEE ALSO**

`package-build docs index`.

### `package-build docs index`

**NAME**

Check documentation index coverage.

**SYNOPSIS**

```sh
package-build docs index [--root <dir>]
```

**DESCRIPTION**

Check that every Markdown page immediately inside each section directory is
linked from the documentation root's `README.md`. The default root is `docs`;
use `--root <dir>` for another tree. Each unlinked page is reported by path.

**OPTIONS**

| Option   | Default | Meaning             |
| -------- | ------- | ------------------- |
| `--root` | `docs`  | Documentation root. |

**EXIT STATUS**

1 when a page is not indexed; otherwise 0.

**EXAMPLES**

```sh
package-build docs index --root docs
```

**SEE ALSO**

`package-build docs links`.

### `package-build docs item-fields`

**NAME**

Render this repository's item-frontmatter reference.

**SYNOPSIS**

```
package-build docs item-fields [--out <path>] [--check] [--title <title>]
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

| Positional | Type                                           | Default | Description               |
| ---------- | ---------------------------------------------- | ------- | ------------------------- |
| `action`   | string, one of `item-fields`, `links`, `index` | —       | The documentation action. |

| Option    | Type    | Default                 | Description                                            |
| --------- | ------- | ----------------------- | ------------------------------------------------------ |
| `--out`   | string  | `docs.itemFields.out`   | Write to this file instead of the configured location. |
| `--check` | boolean | `false`                 | Compare against the file already there; write nothing. |
| `--title` | string  | `docs.itemFields.title` | The page's H1.                                         |
| `--root`  | string  | `docs`                  | Documentation root for `links` and `index`.            |

**EXIT STATUS**

1 if `--check` is given with no destination to compare against. 1 if
`--check` finds the file out of date. 1 on any other thrown error. Otherwise 0.

**EXAMPLES**

```
$ package-build docs item-fields --out docs/item-fields.md --title "Demo Item Fields"
[…] Wrote docs/item-fields.md

$ package-build docs item-fields --out docs/item-fields.md --title "Demo Item Fields" --check
[…] docs/item-fields.md is up to date.
```

**SEE ALSO**

[Configuration](configuration.md).

### `package-build prose lint [path]` and `prose score [path]`

**NAME**

Review sentence readability or score each note against a package's prose bands.

**SYNOPSIS**

```text
package-build prose lint [path] [--age <years>] [--threshold <count>] [--min-words <count>] [--rules readability|simplify|all] [--fail-on-warning]
package-build prose score [path] [--min-words <count>] [--fail-outside]
```

**DESCRIPTION**

Run the `lint` or `score` action from the package root. Pass a Markdown note while editing;
omit the path to read the configured `paths.content` tree. A directory path
scans Markdown files recursively and honors `skipDirectories`. A file path
analyzes that file alone, even in an excluded directory. Both actions read
source files and write nothing. They are optional editorial checks and are
outside `package-build lint` and the normal build.

Set defaults in `package-build.config.yaml` under `packageBuild.proseLint`:

```yaml
packageBuild:
  proseLint: { age: 21, threshold: 5, minWords: 8, rules: readability }
  proseScore:
    minWords: 80
    bands:
      flesch: { min: 45, max: 80 }
      syllablesPerWord: { max: 1.65 }
```

No configuration is required. `proseLint` uses the defaults shown. The
`proseScore` default is `minWords: 80` with no bands; the example bands express
one package's editorial preference, not a toolchain standard. `age` is the
intended reader's age in years. `threshold` is the number of seven readability
algorithms that must classify a sentence as difficult before it is reported.
For example, a threshold of 5 reports a sentence if five or more algorithms
flag it; a threshold of 7 reports only unanimous findings. Lint's `minWords`
excludes shorter sentences. `rules: readability` reports difficult sentences;
`simplify` reports wording suggestions; `all` reports both. The CLI options
override individual settings. Lint numeric settings are positive integers;
`threshold` is at most 7.

Lint analyzes Markdown paragraphs, including those in blockquotes, with `retext-english` and the selected
readability or simplify rules; `retext-stringify` completes the text pipeline.
Frontmatter, headings, lists, GFM tables, code blocks and inline code, image
embeds, wikilinks, and inline expressions are excluded. The body of an ordinary
directive such as `:::info` remains prose; SQL directive bodies are excluded.
Each suggestion is a warning with a file, line,
column, rule ID, confidence, offending sentence, and `expected` replacement
list. The source location marks the difficult sentence or the specific phrase
that could be simplified. Readability confidence is the number of algorithms
that found the sentence difficult, out of seven. Simplify suggestions have no
numeric confidence score, so they say `unscored`. `expected` lists suggested
replacements; `[]` means the rule offers no replacement and may recommend
deleting a word or rewriting a sentence. Suggestions are advisory and are
never applied automatically. `--fail-on-warning` makes a selected rule's
suggestions an explicit exit-code gate.

Score uses the same paragraph selection. It reports Flesch reading ease,
syllables per word, mean and longest sentence length, unfamiliar-word percentage
against the Dale–Chall list, and nominalizations per thousand words. A
nominalization is counted by its word ending (`-tion`, `-sion`, `-ment`,
`-ness`, `-ity`, `-ance`, `-ence`, or `-ism`); this is a mechanical count, not a
grammar judgment. Coverage is the percentage of readable body words included
in the score: headings and lists count toward the body but are not scored.
Review low-coverage notes in context. A note with fewer than score's `minWords`
is reported as insufficient and is not compared with bands.

Under `packageBuild.proseScore.bands`, any of `flesch`, `syllablesPerWord`,
`meanSentenceWords`, `longestSentenceWords`, `unfamiliarWordPercent`, and
`nominalizationsPer1000Words` may set `min`, `max`, or both. Limits are finite
numbers and a minimum cannot exceed a maximum. Violations are warnings. The
directory summary pools sentence, word, and syllable counts across sufficiently
long notes before computing Flesch; it is not an average of note scores.
`--fail-outside` makes band violations an explicit gate. No band is enforced
until the package declares it.

**OPTIONS**

| Input               | Default                    | Meaning                                      |
| ------------------- | -------------------------- | -------------------------------------------- |
| `path`              | configured `paths.content` | Markdown file or content tree                |
| `--age`             | 21                         | Lint reader age in years                     |
| `--threshold`       | 5                          | Lint readability algorithms required (1–7)   |
| `--rules`           | `readability`              | Lint rules: `readability`, `simplify`, `all` |
| `--min-words`       | 8 lint; 80 score           | Minimum words per sentence or note           |
| `--fail-on-warning` | false                      | Fail lint on selected rule findings          |
| `--fail-outside`    | false                      | Fail score when a note crosses a band        |

**EXIT STATUS**

0 after an advisory report; 1 for invalid options, unreadable paths, or an
explicit failure condition.

**EXAMPLES**

```bash
package-build prose lint assets/content/Lore/Harbor.md
package-build prose lint assets/content/Lore/Harbor.md --rules simplify
package-build prose lint assets/content/Lore/Harbor.md --fail-on-warning
package-build prose lint
package-build prose lint assets/content --age 18 --threshold 6 --min-words 10
package-build prose score assets/content/Lore/Harbor.md
package-build prose score assets/content/Lore --fail-outside
```

For a note whose fifth line says `The utilization is very high.`, lint with
`--rules simplify` can report:

```text
assets/content/Lore/Harbor.md:5:5: warning: retext-simplify/utilization: confidence=unscored; sentence="The utilization is very high."; expected=["use"]; Unexpected `utilization`, use `use` instead
```

Open the file at line 5, column 5, and decide whether `use` suits the context.
The rule ID identifies the suggestion if you need to search or group results.

**SEE ALSO**

[`package-build lint`](#package-build-lint-root),
[Configuration](configuration.md#packagebuildproselint).

### `package-build lint [root]`

**NAME**

Check a content tree's addresses and frontmatter without compiling it.

**SYNOPSIS**

```
package-build lint [root] [--no-references]
```

**DESCRIPTION**

Checks a content tree's addresses and frontmatter without compiling anything
— no LevelDB is opened and no Foundry manifest is needed. Beyond address
well-formedness, it
checks frontmatter against the declared vocabulary and each system's `sohl:`
/ `hm3:` block, the package's charset (so a book can pick a font that covers
it), that an icon a note writes is one the registry declares, and that
markup inside a note's body does not smuggle in a character the charset
check cannot see. A being's appearance is held to
[a being's look](reference/format-details.md#a-beings-look): `complexion` a
list, and `extra_features` only short plain descriptions of physical marks.
`--no-references` turns off the check that a frontmatter
shortcode reference lands, including references in schema-declared system
fields, for a tree whose cross-package references it cannot see. Address
references in system fields resolve against this package and its declared
dependencies; exact Item UUID validation remains part of compilation. Reads
the content tree named by `root`, defaulting to
`paths.content`; writes nothing.

Name marking is advisory: lint checks explicit `.name` spans and authored link
labels against the [name-marking
conventions](authoring/links-and-markup.md#marking-names-in-prose). Plain prose
is not searched for names. It builds one matcher from the current local and
dependency names, then
reports each affected occurrence at its exact source location. These warnings
also appear when `lint` is selected in `content run`; they do not fail the run.

Lint also emits one grouped package advisory for marked names without an
indexed full-name or alias match, and for conflicting supplied classifications.
It lists every source use and is located at the earliest reported span.
Untyped uses and compatible type/subtype refinements do not conflict.
An invalid supplied `.name` `data-type` is a located preparation error and
prevents selected writers. See the same name-marking guide for typed examples.

Content lint computes source positions when it emits findings and shares each
note's YAML position document across consecutive lookups.

The final summary reports wall time in milliseconds for `index` (collecting
content records), `SQL` (opening relations and preparing tables, inline queries
and generated sections), and `validation` (building the link index and running
the checks). These are elapsed durations from a monotonic clock, including any
waits within each stage. They are prose summary output, separate from positioned
findings, and appear whether completed validation passes or reports errors.

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
$ package-build lint
[…] No `itemBuilders` registry declares the vocabulary of `demo`, so that system's block is unchecked — a key inside one is discarded at compile with no warning. Declare `itemBuilders: [demo]`.
[…] No published schema for demo@1.0.0, so emitted `system` fields are unchecked. A system generates its own; a module gets one from `package-build deps fetch`.
[…] Addresses and frontmatter are well-formed (4 address(es) across 4 note(s)).
```

**SEE ALSO**

`package-build links [root]`, `package-build reachability <dir> [file]`,
`package-build content-format schema`, `package-build content-format fields`,
[Diagnostics](diagnostics.md),
[Configuration](configuration.md).

`package-build content-format <action>` checks `docs/content-format.md` —
the content-format specification this package ships — against reality, in
two ways that fail for different reasons at different times: `schema`
and `fields`, one section below per action. Both read the
specification named by `--spec`, defaulting to the one this package ships,
and write nothing.

### `package-build content-format schema`

**NAME**

Compare the content-format specification against a published schema.

**SYNOPSIS**

```
package-build content-format schema --schema <system>=<path> [--schema <system>=<path> ...] [--spec <path>]
```

**DESCRIPTION**

Compares every `system.*` target the specification names against a
published `schema.json` (see `package-build schema`). A schema a system has
not yet published — HM3 today — is reported as unchecked rather than
skipped in silence, because a check that quietly does nothing reads exactly
like one that passed.

**OPTIONS**

| Option     | Type                         | Default                                  | Description                               |
| ---------- | ---------------------------- | ---------------------------------------- | ----------------------------------------- |
| `--spec`   | string                       | the shipped `engine/content-format.yaml` | The specification to read.                |
| `--schema` | string, repeatable, required | —                                        | A published schema, as `<system>=<path>`. |

**EXIT STATUS**

1 if any checked claim names a field no supplied schema declares, or if a
`--schema` entry is not `<system>=<path>`. Otherwise 0.

**EXAMPLES**

```
$ package-build content-format schema --schema sohl=schema.json
[…] 19 claim(s) about hm3 are unchecked — no schema was supplied for it, so nothing here confirms them.
[…] 76 mapping claim(s) confirmed against the supplied schemas.
```

**SEE ALSO**

`package-build content-format fields`, `package-build schema`,
[Configuration](configuration.md).

### `package-build content-format fields`

**NAME**

Compare the specification's field tables against the compiled item
declarations.

**SYNOPSIS**

```
package-build content-format fields [--fields <system>] [--coverage] [--spec <path>]
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
| `--spec`     | string                       | the shipped `engine/content-format.yaml`      | The specification to read.                          |
| `--fields`   | string, one of `sohl`, `hm3` | the consuming repository's own `itemBuilders` | A declaration set this package ships, by system id. |
| `--coverage` | boolean                      | `false`                                       | List, per type, the fields only one side names.     |

**EXIT STATUS**

1 if any compared field pair disagrees between the specification and the
declaration that compiles it. Otherwise 0.

**EXAMPLES**

```
$ package-build content-format fields --fields sohl --coverage
[…] 13 type(s) compared against sohl's declarations (56 field pair(s)).
[…] 12 type(s) the format declares are out of reach — no `itemBuilders` entry covers them: being, homepage, vehicle, armorlocation, lore, map, place, scenario, doc, macro, bundle, folder.
[…] affiliation: format only [demonym, economy, epithet, governance, lore, population, symbol, templatePriority], declaration only [commonSkills, level, office, society, subType, title]
```

**SEE ALSO**

`package-build content-format schema`, [Configuration](configuration.md).

### `package-build links [root]`

**NAME**

Check that every link in a content tree lands.

**SYNOPSIS**

```
package-build links [root]
```

**DESCRIPTION**

Checks that every link in a content tree lands: a dead `#anchor`, a dead
qualified address, a link with no label (every link is an address), a wikilink authored in frontmatter
(which is data and is never resolved), and a package homepage's markdown
links and `landing:` addresses, which are published verbatim and use no
wikilink at all. Also reports a vendored foreign-package content index that
has drifted out of reach, naming `package-build deps fetch` as the fix. Resolves
address-valued SoHL system fields declared by the installed schema against this
package and its declared dependencies.
An anchored reference to a dependency's readable note must name a prose anchor
in its fetched content index. A missing section is an error even when the page
address resolves. Event ids are not prose sections and cannot be wikilink targets.
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
$ package-build links
[…] 2 notes: every link is a labelled address, every anchor link lands and every address resolves (0 cross-package reference(s) via manifest), no wikilink in frontmatter, every homepage address resolvable.
```

**SEE ALSO**

`package-build lint [root]`, `package-build reachability <dir> [file]`,
`package-build deps fetch`, [Diagnostics](diagnostics.md),
[Configuration](configuration.md).

### `package-build format [paths..]`

**NAME**

Check formatting with the shared Prettier configuration.

**SYNOPSIS**

```
package-build format [paths..] [--write]
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
$ package-build format
warning: this repository declares no Prettier configuration, so `package-build format` applies the shared conventions while an editor and a bare `npx prettier` apply Prettier's own to the same tree; declare them in a prettier.config.mjs — export { default } from "@heroiclands/package-build/prettier";
build/dist/module.json: error: is not formatted; run `package-build format --write` to fix it
[…]
[…] ERROR: 10 of 15 file(s) are not formatted.

$ package-build format --write
[…] Formatted 10 of 15 file(s).

$ package-build format
[…] Formatting is clean (15 file(s)).
```

**SEE ALSO**

`package-build markdown [paths..]`, [Diagnostics](diagnostics.md).

### `package-build markdown [paths..]`

**NAME**

Lint markdown with the shared markdownlint rule set.

**SYNOPSIS**

```
package-build markdown [paths..] [--fix]
```

**DESCRIPTION**

Lints markdown with the shared markdownlint rule set — the structural
checks Prettier cannot make: a heading level that skips, two sibling
headings sharing an anchor, a reversed link, an emphasis marker other than
the one these repositories write. Runs over the repository rather than the
content tree, taking its rules from this package unless the consumer
declares its own. `--fix` applies the fixes markdownlint can make, then
reports what remains. Reads every matched file; `--fix` rewrites them.
Files excluded by any `.gitignore` are skipped, and `node_modules` and `.git`
are never entered, even when the repository supplies its own markdownlint ignore
list. A `.markdownlint-cli2.*` options file or `.markdownlint.*` rule file
overrides the rules and the ignore list; an option the file cannot mean is
refused as `file:line:column: error:` and nothing is linted. See
[Project setup](project-setup.md) for the accepted keys.

**OPTIONS**

| Positional | Type      | Default                               | Description                     |
| ---------- | --------- | ------------------------------------- | ------------------------------- |
| `paths`    | string(s) | every markdown file in the repository | Globs, or directories, to lint. |

| Option  | Type    | Default | Description                            |
| ------- | ------- | ------- | -------------------------------------- |
| `--fix` | boolean | `false` | Apply the fixes markdownlint can make. |

**EXIT STATUS**

1 if any finding remains after fixing (or without `--fix`, if any finding
exists at all). Otherwise 0.

**EXAMPLES**

```
$ package-build markdown
[…] Markdown is clean.
```

**SEE ALSO**

`package-build format [paths..]`, [Diagnostics](diagnostics.md).

### `package-build content-index [root]`

**NAME**

Emit this package's note index as JSON Lines.

**SYNOPSIS**

```
package-build content-index [root] [--out <dir>]
```

**DESCRIPTION**

Emits this package's note index as JSON Lines, carrying full frontmatter,
tree positions, prose and event anchors, and document targets. Reads the
content tree named by `root`, defaulting to `paths.content`; writes
`<contentPackage>-metadata.jsonl`, `<contentPackage>-dictionary.jsonl` and
`<contentPackage>-terms.jsonl` into `--out`, defaulting to the configured
`paths.contentIndex`.

Metadata includes each own note's authored `.name` occurrences under `names`,
with visible text, nullable type/subtype and original source line/column.
Local and dependency SQL schemas expose them through `names`; they travel in
the metadata artifact.

Metadata also includes each own note's spans, divs and verse fences marked with
`lang=`, `font=` or `map=` under `runs`, with the language as written, the tag
it resolves to, the font, the map and the original source line/column. Local
and dependency SQL schemas expose them through `runs`, and each mapping note's
rows through `maps`.

The command prepares SQL tables, page lists, automatic sections and scalar
expressions before publishing their prose targets. Each source uses its own
audience for prose declarations: public notes use public providers and usage,
and GM notes use the complete corpus. Native target maps use the compendium's
complete SQL corpus and expose only declared prose slugs present there, with
their actual native page targets. Readable item documentation targets its
documentation journal. An empty published prose-anchor list declares no prose targets,
including for pages without a Foundry document. Preparation errors leave all
three output files untouched.

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
$ package-build content-index
[…] demo → build/content-index/demo-metadata.jsonl (4 notes, 2 KiB)
```

**SEE ALSO**

`package-build site build`, `package-build pdf`, `package-build deps fetch`,
[Configuration](configuration.md).

### `package-build site build`

**NAME**

`package-build site build` — render the content tree as a website, and index
it for search.

**SYNOPSIS**

```
package-build site build [--out <dir>]
```

**DESCRIPTION**

Builds the site from the content tree: the sibling of `package compile`, the
same tree rendered as pages instead of compiled into packs. Everything a
consumer would otherwise write for itself happens here: the walk, address
derivation, the address index, table expansion, wikilink resolution,
code-fence protection and the foreign-manifest merge. Each note is expanded —
links, tables, expressions, generated sections, maps — and rendered by the
same renderer the Foundry journals and the editor preview use, then drawn by
the site theme's layouts.

**A site is its homepage and its pages.** The `type: homepage` note is the
package's front page at `/<contentPackage>/`; every other note is one page at
`/<contentPackage>/<type>-<shortcode>/`. Nothing is generated between them
beyond the listings `site.sections`, `site.feed` and `site.tags` ask for. An
index of what the package publishes is a `doc` note carrying a content table,
authored where every other page is.
On the web, every heading carries an id the page's contents list links to,
and straight quotes, `--`, `---` and `...` are set as typographic quotes,
dashes and an ellipsis.

Written under `<out>/<contentPackage>/` — or under the path
[`site.base`](configuration.md#where-a-site-is-served-and-what-it-lists)
states, so a site served at `/` is written at `<out>/` itself — which is
emptied first:

- one `index.html` per page — the homepage at the site's root, a note
  `site.sections` names at its section, every other note at
  `<type>-<shortcode>/` — each minified;
- `404.html`, the page-not-found page `site.notfound` describes;
- `sitemap.xml`, the full address of every page reachable from the homepage;
- the theme's stylesheets, scripts, icon font and images, and `css/code.css`;
- the script fonts the notes set text in, under
  `fonts/heroiclands/<version>/`;
- with `site.feed`, the section's page listing its posts newest first, and its
  Atom feed at `<section>/atom.xml`;
- with `site.tags`, a page for each tag at `tags/<tag>/` and the tag index at
  `tags/`;
- with `site.sitemaps`, `sitemap-index.xml` and `robots.txt`, naming this
  site's sitemap and each package site's.

Without `site.tags` a tag is a label and links nowhere. A link of
`site.notfound.links` to a page the site does not publish is left off the
page-not-found page and reported as a warning located at that entry of
`package-build.config.yaml`. A section of `site.sections` whose note is not in
the content tree is an error located at its entry, and writes nothing.

Then, as `package-build site-root` does, `_headers` is written at `<out>/` and
the pages reachable from the homepage are indexed for search into `pagefind/`
inside the site's directory, unless `site.search` is `false`. With `site.mergeIndexes`, the search reads
each package site's index beside its own. What a page tells the search is set
out in the [site guide](guides/site.md#search).

The site's address, title and menu are read before the tree is, so a missing
`homepage` or a cold navigation cache fails with the last good site in place.
Every gate is then checked and reported, and the run stops at the first that
fires, ordered so the report names the cause rather than its symptoms — an
unusable dependency manifest, reported after the links that failed because of
it, would otherwise read as a pile of broken notes. A gate that fires writes
nothing. A note in error — a dead link, a table that cannot
expand — is written as its page shows it, the finding is reported, and the
run fails before the search index is built.

**OPTIONS**

`--out <dir>` — the directory that is deployed. Defaults to `build/site`.

**EXIT STATUS**

1 if `package.json` declares no `homepage`, or one that does not end
`/<contentPackage>/`; if the site declares no title, description or `assets`
host; or if the navigation has not been fetched (`package-build deps fetch`
fills the cache and is named in the message). 1 if any gate fires — no
homepage or two competing for it, a frontmatter wikilink, an address that
cannot be derived, a stale or unaddressable dependency manifest, an address
published twice, a table that failed to expand, or a dead wikilink. 1 on a
script-font finding, and when the search index cannot be built. Otherwise 0,
findings of severity `warning` included.

**EXAMPLES**

```
$ package-build site build
package-build.config.yaml:38:24: warning: the page-not-found links to /thalorna/polity/, which the site does not publish, so the link is left out
[…] wrote 4306 page(s) to build/site/thalorna
[…] indexed 4307 page(s) for search into build/site/thalorna/pagefind
```

**SEE ALSO**

`package-build site serve`, `package-build site-root`,
`package-build deps fetch`, [the site guide](guides/site.md).

### `package-build site serve`

**NAME**

`package-build site serve` — serve the website, and keep it current.

**SYNOPSIS**

```
package-build site serve [--port <port>] [--host <address>] [--out <dir>]
```

**DESCRIPTION**

Builds the site as `package-build site build` does, indexes it for search once,
and serves the deployed directory over HTTP, so every page is at the address it
is deployed at: `http://127.0.0.1:1313/<contentPackage>/`, or the path
`site.base` states. An address the site does not publish is answered with its
`404.html`. A search index `site.mergeIndexes` names is not served, since it is
another site's; the site's own index is.

The content tree and the theme are watched. A change to a note's body or
frontmatter writes that note's page again; a note whose name, type or
shortcode changed, a new or removed note, a note holding an `sql` table, and
any other file in the content tree build the whole site again; a change to the
theme draws every page again. Every open page then reloads: each HTML page is
sent with a script that listens for the server's `reload` event at
`/__package-build/reload`, added as it is sent and never written to the site.

A page that changes only because another note changed — a table listing it,
a link carrying its name — is written again by the next whole build. Findings
are reported as `package-build site build` reports them, and the server keeps
running. Interrupt it to stop.

**OPTIONS**

`--port` — the port to listen on, a number. Defaults to `1313`.

`--host` — the address to listen on. Defaults to `127.0.0.1`.

`--out <dir>` — the directory the site is written to. Defaults to
`build/site`.

**EXIT STATUS**

1 when the site's settings or its cached menu cannot be read. Otherwise 0 once
interrupted.

**EXAMPLES**

```
$ package-build site serve
[…] built the site
[…] serving http://127.0.0.1:1313/thalorna/ — interrupt to stop
[…] wrote build/site/thalorna/place-vedyara/index.html
```

**SEE ALSO**

`package-build site build`, [the site guide](guides/site.md).

### `package-build pdf`

**NAME**

Build the books the content tree publishes as.

**SYNOPSIS**

```
package-build pdf [--book <id>] [--out <path>] [--book-version <version>] [--compile] [--list-assets]
```

**DESCRIPTION**

Builds every book `pdf.books` declares, in the order declared, or with
`--book <id>` the one book with that `id` — the third surface beside
`package compile` and `site`, reporting in the same `file:line:column:
severity: message` shape both of those use. **Not building a book is a
normal outcome and exits 0**: a package publishing only a homepage, one
with no `pdf:` block, and one with no content tree have each said they
publish no book, and failing the command over that would break the release
of every package that is not a book. `--compile` (on by default) runs the
Typst compiler; `--no-compile` emits the Typst source and stops there,
which is what lets the source be inspected or compiled by hand.

A reference to a note that another book is home to prints that book and page,
`Name (_Book title_, p. 12)`, or `Name (Aelw. p12)` when that book declares an
`abbreviation`. A compile renders and lays out every book, writes
`pages.json` (each note's home book and the page its entry starts on) into the
output directory, and renders again with those pages; `--no-compile` runs
neither pass and prints `p. ?`. See the
[book guide](guides/book.md#a-reference-to-a-note-in-another-book).

Each book reads its tree from its inline `contents` or the file its
`document` names, and the notes under `paths.content`. It writes
`<out>-<version>.typ` and, unless `--no-compile`, `<out>-<version>.pdf`, where
`<out>` is the book's file stem (default `<contentPackage>-<id>`) and
`<version>` is `--book-version`; with no version the files are `<out>.typ` and
`<out>.pdf`. Every book is written into `--out`, or the configured `pdf.out`,
or `build/dist`.

A book's `coverImage`, `document` and `front` files are checked first; a
missing one is an error at its key in the configuration, and that book is not
built while the others are. An `--book` naming no declared book is an error at
`pdf.books` that lists the declared ids.

Every declared book's queries run before any book is written, so coverage is
reported over the whole set even with `--book`: a printable note no book selects
is a finding at its `type:` line, at the severity `pdf.coverage` names. A book
whose queries select no note is an error at `pdf.books[].id` and is not built.
A section whose queries select none is left out without a finding. Each book's
pictures are staged under a directory named for its file stem beside its
source.

For each book written, the command prints a line of counts and the paths of
its source and PDF, each prefixed with the book's `id`. It then prints, per
declared book, its entries, distinct notes and notes without a culture, the
totals, and one line per note several books select, naming its home book.

`--list-assets` builds nothing. It prints a JSON array on standard output with
one object per declared book, in configuration order — `id`, `title` and the
`file`, the path the build writes it to at `--book-version`, relative to the
working directory and inside `--out` or the configured `pdf.out` — and an empty
array for a package that publishes no book. The release workflow attaches
exactly these files and lists them in the release notes.

**OPTIONS**

| Option           | Type    | Default                  | Description                                                             |
| ---------------- | ------- | ------------------------ | ----------------------------------------------------------------------- |
| `--book`         | string  | every declared book      | Build only the book with this `id`.                                     |
| `--out`          | string  | the configured `pdf.out` | Write the books here instead.                                           |
| `--book-version` | string  | —                        | Stamp this version on the title page and in each file name.             |
| `--compile`      | boolean | `true`                   | Run the Typst compiler. `--no-compile` emits the source and stops.      |
| `--list-assets`  | boolean | `false`                  | Print each book's `id`, `title` and output path as JSON; build nothing. |

**EXIT STATUS**

0 when there is a stated reason not to build (only a homepage note, no `pdf:`
block, no content tree). 1 when any finding is an error — an unknown `--book`,
a missing `coverImage`, `document` or `front` file, a tree that cannot be read
or parsed, a book that selects no note, an uncovered note under
`pdf.coverage: error`, a link that resolves nowhere — when a requested book was not
written or did not compile, or on any other thrown error. Otherwise 0:
warnings, such as a picture the book cannot carry, are reported but do not
fail the command.

**EXAMPLES**

```
$ package-build pdf
[…] No book built: no `pdf:` block is configured, so this package publishes no book

$ package-build pdf --book nope --no-compile
package-build.config.yaml:12:5: error: --book `nope` names no declared book; declared: core, vedyara

$ package-build pdf --book-version 1.4.0 --no-compile
[…] core: 1734 entr(ies) and 3 prose file(s) across 41 section(s)
[…] core: Typst source: build/pdf/thalorna-1.4.0.typ
[…] vedyara: 28 entr(ies) and 1 prose file(s) across 4 section(s)
[…] vedyara: Typst source: build/pdf/thalorna-vedyara-1.4.0.typ
```

**SEE ALSO**

`package-build site build`, `package-build package <action> [pack] [entry]`,
[Diagnostics](diagnostics.md), [Configuration](configuration.md).

### `package-build map`

**NAME**

Draw the containment tree, the map or the chart from a place, or the whole
route graph.

**SYNOPSIS**

```
package-build map --tree [--root <shortcode>] [--engine dot|twopi|neato] [--rankdir TB|LR|BT|RL]
                  [--nodesep <inches>] [--ranksep <inches>] [--no-polities]
package-build map --from <shortcode>.. | --from all
package-build map --chart <shortcode>.. | --chart all [--horizon <days>]
package-build map --travel
package-build map [...] [--scale <factor>] [--base <url>] [--out <dir>]
```

**DESCRIPTION**

Draws what the place notes state. Every drawing is read from the content
index — this package's records and every declared dependency's fetched
index — so a consumer's map draws its dependencies' places beside its own
and no note is opened except to locate a finding. Everything lands under
`build/map/`, always the `.dot` beside the `.svg`, so a drawing can be
re-rendered, diffed or read without the index. The npm-installed Graphviz runtime draws with `dot` (or `twopi`, `neato`)
for the tree and `neato` for the other drawings.

The containment tree draws every `world` note as a separate root. A map from a
place follows that place's own relations, so another world in the package does
not change its viewpoint.

Site builds put a linked SVG in each eligible place page. PDF builds put a
vector map on its own page immediately after each selected place entry with
relations. The drawings are pictures for a reader; no Foundry Scene is made
from them.

A map note is a different thing: it carries a Scene exported from Foundry under
`data.scene`, on every map subtype. The pack compiler passes it through, binds
pins marked `#anchor` to pages from the map note's Markdown, and applies the
fixups — `data.fixup` and `data.thumbnail`, the Scene's `thumb` — which resolve
asset Addresses into selected fields of the exported Scene; a missing path or
asset is a build error.

The four drawings, any of which may be asked for in one run:

**`--tree`** — the author's check. The containment tree from `data.parents`,
edges running child → parent, clustered by continent — a `region` parented
directly on the `world` note — with the places reaching no continent
floating outside every cluster. Node shape, colour and size are by
`subType` (a gold double circle for the world, a blue box for a region, a
small green ellipse for a settlement, a purple diamond for a site, a teal
hexagon for a feature, an orange house for a structure), and a legend
drawn from the same style table sits on every drawing. A `polity`
affiliation is drawn as a grey dashed cylinder beside every region note in
its own directory. Anomalies are highlighted and reported as findings: a
place with **no parent** and a **placeholder for a parent shortcode no
place declares** are filled red (errors); a place on a **cycle** is
outlined red (an error); a place with **more than one parent**, a region
with **no `packFolder`** and a polity whose directory holds **no region
note** are warnings. The world note has no parent by nature and is not a
finding. Writes `tree.svg` for the whole world and `tree-<shortcode>.svg`
for each continent; with `--root`, the subtree beneath that one place as
`tree-<shortcode>.svg` — every place whose `parents` chain reaches it by
any path — and no findings.

**`--from <shortcode>`** — the map from a place, `from-<shortcode>.svg`.
Pre-modern maps were itineraries: partial, centred on their maker, exact
about the next stage and vague about the tenth. A place's `borders` and
`routes` are exactly that, so the reader's map is one map per place, from
that place. The place sits at the centre, **north up, east right**. Every
neighbour it states — or that states it, since a border or a route is one
fact stated from each end — sits at the angle of its bearing and on the
ring of its days, with an edge labelled by the bearing and days; a border
is a dashed edge, and where several modes reach one place the label lists
each. Beyond each neighbour, every place a second hop reaches is drawn
dimmer at the composed bearing where the two hops agree — the same bearing
or adjacent ones, added as vectors weighted by their days — on the ring of
their total; where the hops disagree the place is omitted rather than
guessed at. Nodes sharing a ring and a bearing are fanned apart. `all`
draws the map from every place that states or is named in a border or a
route. Positions are computed by the command and pinned, so `neato` only
draws; nothing on the page is a solver's decision.

_The rings._ One faint dashed circle per marker of the days scale up to
the horizon of 90 days — `1 2 3 5 10 20 30 45 60 90` — each labelled at
its top, spaced logarithmically so that equal ratios of days are equal
steps of radius: a day to two days is the same step as five to ten, and a
day's ride and a month's voyage both fit on one page. A neighbour with a
route sits on the ring of its shortest route's days. A neighbour reached by
a border alone sits on the innermost ring, because a frontier states no
distance. One more circle, the rim, lies a log step beyond the horizon:
a place farther than 90 days, and a second hop whose days are unknown
because either hop was a border, are a name at the rim carrying its days
or `?` — beyond what the notes state, the map states nothing more.

_Two scales._ The generated map from a place is the default regional map:
every place gets one at build time, from its `borders` and `routes`. An
authored `regionalmap` note is an artefact of the setting — a road book, a
sailor's chart, a tax survey, partial and from somewhere, whose prose says
whose it is — and never the survey. The two are two sources of the same
thing on a place's page.

**`--chart <shortcode>`** — the chart from a place, `chart-<shortcode>.svg`:
the world-scale drawing chosen by viewpoint rather than projection — the
sea from a port, the eastern roads from a caravan city. It is the same
graph from the same place with a larger horizon: the centre pinned, north
up and east right, the neighbours exactly as `--from` draws them, and
beyond them the hops chaining on. Hops compose as a running vector sum
weighted by their days, and a hop is accepted when its bearing lies within
one octant — 45° either way — of the **running composed direction** at
that point, not of the previous hop; so a path may bend a little at every
hop, but never turn back, and a place reached only through a hop that
turns back is omitted. Where several chains reach one place, the one with
the fewest total days is drawn. The total is the sum of the hops' days,
placed on the ring of the smallest marker not less than it. A border
carries no days: on the first hop it sits on the innermost ring, as on the
map from a place; beyond the first hop it makes the total unknown, the
place goes to the rim marked unknown, and the chart states nothing beyond
it. `all` draws the chart from every place that states or is named in a
border or a route.

_The horizon._ `--horizon <days>`, a marker of the scale, `360` by default:
one ring per marker up to and including it, on the same log spacing as the
map from a place, so a chart to a year's travel is simply a larger page
with more rings. A place whose total exceeds the horizon is omitted — the
chart is already the larger view, and there is no "beyond" rim, only the
unknown one, a log step past the horizon. `--horizon` applies to charts
alone; the map from a place keeps its horizon of 90 days and its rim.

_The dimming._ The neighbours are drawn full, the second hop as the map
from a place draws it — grey border and label, pale fill, faint edge —
and each hop beyond a step fainter, never below half opacity, so the
farthest place still reads. An edge is dimmed with its far end, and
labelled with its bearing and days like any other.

**`--travel`** — the whole route graph, `travel.svg`, for the author: one
undirected edge per pair of places, a border dashed, each route asking
`neato` for a length on the same log scale as the rings so the god's-eye
view and the itinerary agree about what a day and a month look like; the
engine solves the positions.

Every node's label is the place's `name.full` and its tooltip the canonical
address. With `--base`, every name is also a link — GraphViz writes an
`<a href>` around it — to the page at `<base><slug>/` for this package's
places and to the URL the fetched index resolved for a dependency's, so a
page can inline the SVG. Without it the names are plain text.

**OPTIONS**

| Option       | Type    | Default      | Description                                                                                                                                |
| ------------ | ------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `--tree`     | boolean | `false`      | Draw the containment tree: `tree.svg`, one `tree-<shortcode>.svg` per continent, and the findings.                                         |
| `--root`     | string  | —            | With `--tree`, draw the subtree beneath this place as `tree-<shortcode>.svg` and report nothing.                                           |
| `--from`     | string  | —            | Draw the map from this place as `from-<shortcode>.svg`; repeatable, or `all` for every place with a border or a route.                     |
| `--chart`    | string  | —            | Draw the chart from this place as `chart-<shortcode>.svg` — the map from it at a larger horizon; repeatable, or `all`.                     |
| `--horizon`  | number  | `360`        | The charts' horizon in days, a marker of the scale: rings are drawn to it, and a place farther than it is left out.                        |
| `--travel`   | boolean | `false`      | Draw the whole route graph as `travel.svg`.                                                                                                |
| `--engine`   | choice  | `dot`        | The tree's layout engine — `dot`, `twopi` (radial, rooted on the world or the `--root`) or `neato`. The other drawings are always `neato`. |
| `--rankdir`  | choice  | `TB`         | The tree's rank direction — `TB`, `LR`, `BT` or `RL`; `dot` engine only.                                                                   |
| `--nodesep`  | number  | by `--scale` | The tree's GraphViz `nodesep`, in inches.                                                                                                  |
| `--ranksep`  | number  | by engine    | The tree's GraphViz `ranksep`, in inches.                                                                                                  |
| `--scale`    | number  | `1`          | Multiply every node's width, height, font size and border weight, the legend's included.                                                   |
| `--polities` | boolean | `true`       | Draw polities beside their regions in the tree. `--no-polities` drops them.                                                                |
| `--base`     | string  | —            | The site base this package's pages are served under, ending in a slash; given, every name is a link to its page.                           |
| `--out`      | string  | `build/map`  | Directory to write into, relative to the working directory.                                                                                |

**EXIT STATUS**

1 when no drawing is asked for, when a `--from`, `--chart` or `--root`
names no place, when `--horizon` is not a marker of the days scale, when
the renderer fails, when a dependency's index cannot be read, when a note the index cannot record is
met, on any error finding from `--tree` (a place with no parent, a parent
that does not resolve, a cycle), or on any other thrown error. Otherwise 0
— the warnings are reported and never fail the command.

**EXAMPLES**

```
$ package-build map --tree
assets/content/Regions/Sea.md:16:5: warning: place "innersea" has more than one parent (northc, southc), which is legal for a sea between continents or a region split between two, and worth a look otherwise
assets/content/Regions/Marches/Lost_Fort.md:9:14: error: place "lostfort" names parent "marchs", which does not resolve to any place in this package or a fetched index
[…] 394 place(s) → 7 drawing(s) under build/map

$ package-build map --from dunharargn --base /thalorna/
[…] 394 place(s) → 1 drawing(s) under build/map

$ package-build map --chart takheperurgn --horizon 90
[…] 394 place(s) → 1 drawing(s) under build/map

$ package-build map --travel
[…] 394 place(s) → 1 drawing(s) under build/map
```

**SEE ALSO**

`package-build lint [root]` (which checks `borders` and `routes` from both
ends), `package-build deps fetch`, `package-build content-index [root]`,
[Content format](content-format.md), [Diagnostics](diagnostics.md).

### `package-build reachability <dir> [file]`

**NAME**

Check that every document in a corpus is reachable by reading.

**SYNOPSIS**

```
package-build reachability <dir> [file] [--index <shortcode> ...] [--root <path>]
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
$ package-build reachability Guide
[…] All 2 document(s) in Guide are reachable from README.md.

$ package-build reachability assets/content
[…] ERROR: no note at assets/content/README.md, so the corpus has no page to be read from
```

**SEE ALSO**

`package-build links [root]`, `package-build lint [root]`, [Diagnostics](diagnostics.md),
[Configuration](configuration.md).

### `package-build transliterate <map> [text..]`

**NAME**

Map a passage into a script exactly as the build maps a marked run.

**SYNOPSIS**

```
package-build transliterate <map> [--lang <language>] [--font <slug>] [--hex] [text..]
```

**DESCRIPTION**

Reads the content index, as `package-build lint` does, and prints the passage
rewritten by the mapping note whose `data.map.name` is `<map>`, through the
same code the build sets a run marked `map=<map> lang=<language> font=<slug>`
with. With `--lang`, each word the language's lexicon states a native form for
is written by it and every other word is spelled by the rows; without it, the
rows alone apply. See
[a map reads the dictionary first](reference/format-details.md#a-map-reads-the-dictionary-first).
Under a [logographic map](reference/format-details.md#a-logographic-map) every
word is written from the language's lexicon, by its own writing or its parts',
and the rows write only the text between words.
The text is the words given, joined by single spaces; `-` or no text reads it
from standard input, less one trailing newline. Writes nothing.

**OPTIONS**

| Positional | Type             | Default | Description                            |
| ---------- | ---------------- | ------- | -------------------------------------- |
| `map`      | string           | —       | The `data.map.name` of a mapping note. |
| `text`     | string, variadic | stdin   | The passage; `-` reads it from stdin.  |

| Option   | Type    | Default                                                                           | Description                                                                                           |
| -------- | ------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `--lang` | string  | —                                                                                 | A language declared in `languages`, whose lexicon is read first.                                      |
| `--font` | string  | the language's face where the map is drawn in it, else the map's one face, if one | The face, whose own rows come first; required when neither gives one and the map lists more than one. |
| `--hex`  | boolean | `false`                                                                           | Print the code points, as `U+XXXX` separated by spaces.                                               |

**EXIT STATUS**

1 if the content index could not be built for any note, or the map, the
language or the face names nothing, each reported as a finding: an unknown
language at `languages` in the configuration, an unknown map or face at the
content tree. 1, with the build's own message, if a capitalised word of the
passage has a native form the rows cannot capitalise, or, under a logographic
map, a word has no writing or stands for entries written differently.
Otherwise 0.

**EXAMPLES**

With Vylari's `zaron` stating a native form for `semaron`, and `lonak` stating
none:

```
$ package-build transliterate semaron --lang vyl --hex zaron lonak
U+F024F U+F0230 U+F023F U+F023C U+0020 U+F023A U+F023D U+F023C U+F0230 U+F0239
$ package-build transliterate semaron --hex zaron
U+F0255 U+F0230 U+F023F U+F023D U+F023C
$ package-build transliterate semoran zaron
assets/content: error: `semoran` is not a map: a map is named by the `data.map.name` of a mapping note; did you mean `semaron`?
```

The first run writes `zaron` by its exception; the second, with no `--lang`,
spells it by the rows.

Under the logographic `zethu`, with Khelathi's `lekhunet` built from `lekhau`
and the affix `-unet`, the plural written by its own sign, and `zamlu` given no
writing:

```
$ package-build transliterate zethu --lang khel --hex lekhunet halziim.
U+1EA93 U+1EBC7 U+0020 U+1EABB U+1EBE1 U+1EBED
$ package-build transliterate zethu --lang khel zamlu
error: `zamlu` has no `zethu` writing in the `khel` lexicon, and its parts do not give one; state one, or write the word directly in signs
```

**SEE ALSO**

`package-build lexicon <language>`, [Mapping notes](reference/format-details.md#mapping-notes).

### `package-build lexicon <language>`

**NAME**

List a language's words with their native forms under a map.

**SYNOPSIS**

```
package-build lexicon <language> [--map <map>] [--font <slug>] [--derived] [--json]
```

**DESCRIPTION**

Reads the content index and lists every word of the language note
[`languages.<language>.note`](configuration.md#languages) names, in `data.words`
order, each with its native form under `<map>`, or under the script the
language note names in `data.writtenIn` when `--map` is left out: the stated exception where the
word has one, else the rows' spelling, each exactly as
`package-build transliterate` and the build give it. Each line holds, separated
by tabs, the word's `form`, its native form, `exception` or `rows`, its `class`
and its `gloss`. Writes nothing.

Under a [logographic map](reference/format-details.md#a-logographic-map) the
native form is the word's writing, and the third column says where it comes
from: `own` for a writing the word states, `parts` for one its `built` pieces
give, or `none`, with an empty second column, for a word with no writing. A
word whose form a run cannot write, because the form stands for entries
written differently or one of its parts does, is marked `ambiguous`, and its
second column is still that entry's own writing: the signs to write directly
for that sense. Every word listed with a writing and not `ambiguous` is written
so by the build and by `package-build transliterate`.

With `--derived`, the forms the language's own rules derive from those words
follow them: each word's declared `variants`, then plurals, verb forms, replacing suffixes, agreeing forms and
participles, exactly the regular forms
[the mapped-run word check](authoring/links-and-markup.md#a-mapped-runs-words)
accepts. Each is listed once, case folded as the check compares it, and spelled
by the rows; a form that is itself a lexicon word is not repeated. Every line
then has a sixth column: the lexicon word a derived form comes from, empty for
the lexicon's own words. A derived line carries its word's `class` and `gloss`.

**OPTIONS**

| Positional | Type   | Default | Description                                         |
| ---------- | ------ | ------- | --------------------------------------------------- |
| `language` | string | —       | A declared language whose `note` names its lexicon. |

| Option      | Type    | Default                                                                           | Description                                                                                                                                                                                                                                      |
| ----------- | ------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--map`     | string  | the language's `data.writtenIn` map                                               | The `data.map.name` of a mapping note; required when the language note states no `data.writtenIn`.                                                                                                                                               |
| `--font`    | string  | the language's face where the map is drawn in it, else the map's one face, if one | The face; required when neither gives one and the map lists more than one.                                                                                                                                                                       |
| `--derived` | boolean | `false`                                                                           | Also list the forms the language's rules derive, each with the word it comes from.                                                                                                                                                               |
| `--json`    | boolean | `false`                                                                           | Print a JSON array of `{ form, native, exception, class, gloss }` instead; a derived form adds `from`. Under a logographic map `source` (`own`, `parts` or `none`) takes the place of `exception`, and an ambiguous word adds `ambiguous: true`. |

**EXIT STATUS**

1 if the content index could not be built for any note, or the language, the
map or the face names nothing, no map is named and the language note states no
`data.writtenIn`, the language states no `note`, or a capitalised
word has a native form the rows cannot capitalise, each reported as a finding.
Otherwise 0.

**EXAMPLES**

```
$ package-build lexicon vyl --map semaron | head -3
zaron	<native form>	exception	n	an oath
lonak	<native form>	rows	n	a road
thizaron	<native form>	rows	n	a seal
$ package-build lexicon vyl --map semaron --derived | grep -P '\talathos$'
alatha	<native form>	rows	pron	he, that one	alathos
alathon	<native form>	rows	pron	he, that one	alathos
alathoi	<native form>	rows	pron	he, that one	alathos
alathai	<native form>	rows	pron	he, that one	alathos
$ package-build lexicon khel --map zethu | grep -P '\t(none|ambiguous)\t'
nelgir	<writing>	ambiguous	n	a god
Nelgir	<writing>	ambiguous	stem	god
zamlu		none	n	music
```

**SEE ALSO**

`package-build transliterate <map> [text..]`,
[A language's words](reference/format-details.md#a-languages-words).

### `package-build core`

**NAME**

List the core concepts each covering language has no word for.

**SYNOPSIS**

```
package-build core [--language <name>] [--json]
```

**DESCRIPTION**

Reads the content index and reports, for each language note that states
`data.core: true`, the concepts of the package's
[`data.concepts`](reference/format-details.md#the-core-vocabulary) list that no
word of it serves. A word serves the concepts its `concept` names, and a language
reads the words of its `data.family` chain as its own. The languages are listed
by name; each block gives the number missing, then the missing concepts under
their groups in list order, each group with its count, each concept as its `id`
and `gloss` separated by a tab. A language with no concept missing is reported as
covering them all. Writes nothing.

A missing concept is a fact to work through, never a finding, so the report does
not change the exit status.

**OPTIONS**

| Option       | Type    | Default | Description                                                                                                                                                            |
| ------------ | ------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--language` | string  | —       | Report this language alone, by its name, its shortcode or its reference, whether or not it states `data.core`.                                                         |
| `--json`     | boolean | `false` | Print `{ concepts, languages }` instead, each language `{ name, language, core, total, covered, missing }` and each missing group `{ group, count, total, concepts }`. |

**EXIT STATUS**

1 if the content index could not be built for any note, no note states
`data.concepts`, or `--language` names no language note, each reported as a
finding. Otherwise 0.

**EXAMPLES**

```
$ package-build core --language vylarilng
Vylari Language (skill-vylarilng): 1 of 4 core concepts have no word
  senses: 1 of 1
    see-verb	to see
```

**SEE ALSO**

[The core vocabulary](reference/format-details.md#the-core-vocabulary),
[Tying words to the core vocabulary](authoring/links-and-markup.md#tying-words-to-the-core-vocabulary).

### `package-build addresses diff`

**NAME**

Report every published address a build no longer publishes.

**SYNOPSIS**

```
package-build addresses diff --from <zip|dir> [--strict]
```

**DESCRIPTION**

Reports every published `(type, shortcode)` address this build no longer
publishes, against a released artifact. A departed address is identified as
renamed when the same document id appears under another address; otherwise it
is reported as withdrawn. An id derived from the canonical address changes
with its shortcode. The old address is reported as withdrawn; the new address
appears in the current package and produces no finding. Pair those addresses
by hand. A pinned id lets the command identify the same document at its new
address. `--from` names the baseline explicitly: a release's `.zip`, or the
directory built from one. The command reads the baseline artifact and current
content tree and writes diagnostics only.

**OPTIONS**

| Positional | Type                  | Default | Description            |
| ---------- | --------------------- | ------- | ---------------------- |
| `action`   | string, one of `diff` | —       | The action to perform. |

| Option     | Type    | Default                 | Description                                                                                   |
| ---------- | ------- | ----------------------- | --------------------------------------------------------------------------------------------- |
| `--from`   | string  | — (required for `diff`) | The released artifact to compare against — a package zip, or the directory it was built from. |
| `--strict` | boolean | `false`                 | Report findings as errors and exit non-zero, for a release workflow that gates on them.       |

**EXIT STATUS**

1 if `diff` is named with no `--from`. Without `--strict`, a departed address
is reported as a warning and does not fail the run. With
`--strict`, 1 if any address is no longer published. 1 on any other thrown
error (the baseline declaring an Item pack this build does not have, or
this repository declaring no Item pack at all to diff). Otherwise 0.

**EXAMPLES**

```
$ package-build addresses diff --from build/dist/module.zip
[…] ERROR: demo-package@1.0.0: pack "items" is declared at packs/items, which the package does not contain
```

**SEE ALSO**

`package-build package <action> [pack] [entry]`, `package-build deps fetch`,
[Diagnostics](diagnostics.md).

### `package-build npc new`

**NAME**

Write a new NPC being note from a spec, its look drawn from its culture's
appearance profile and its name from its culture's language.

**SYNOPSIS**

```
package-build npc new (--spec <json> | --specfile <path>) [--seed <text>] [--out <path>]
```

**DESCRIPTION**

Writes one `type: being`, `subType: npc` note: the full `data` block, an
`# Appearance {#appearance}` section and a `# Dossier {#dossier}` section, with
no system block. The note goes to standard output, or to a new file with
`--out`.

The spec is a possibly incomplete set of frontmatter fields, given as a JSON
string with `--spec` or as a `.json`, `.yaml` or `.yml` file with
`--specfile`; exactly one of the two is required. `data.culture` and
`data.gender` are required in it. Every field the spec gives is written
exactly as given, at every depth, and every field it leaves out is generated:

| Field                                                   | Generated value                                                                                                                           |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `name.full`                                             | Drawn from the culture's language's name lists by one of its patterns for `data.gender`, the given name from the list for that gender.    |
| `shortcode`                                             | The name transliterated to lowercase letters and digits and cut to twelve characters; a counter replaces its tail where a being holds it. |
| `type`, `subType`, `tags`                               | `being`, `npc`, `[generated, draft]`.                                                                                                     |
| `data.icon`, `data.species`, `data.packFolder`          | The commonest value among the package's npcs of the same culture, else among all its npcs; left out where none states one.                |
| `data.archetypes`                                       | `[commoner]`, the archetype of a person who fits no more specific one.                                                                    |
| `data.templatePriority`, `data.occupation`, `data.died` | `null`.                                                                                                                                   |
| `data.lore`, `data.homes`                               | `[]`.                                                                                                                                     |
| `data.affiliations`                                     | `{}`.                                                                                                                                     |
| `data.born`                                             | An adult age of 18 to 60 years before the configured `currentDate` (default `"720.1"`), as a `<year>.<day>` date.                         |
| `data.frame`, `data.appearance.*`                       | Weighted draws from the culture's appearance profile; `extra_features` is `[]`.                                                           |
| `data.height`                                           | From the profile's range for the gender, in feet and inches.                                                                              |
| `data.weight`                                           | From the height and the frame's body-mass band, in pounds. A spec giving height and weight but no frame gets the frame they imply.        |

Generation is seeded from the spec itself, through a canonical serialisation
that sorts every map's keys: the same spec always writes the same note, whether
or not it states a name, and the order the spec writes its fields in changes
nothing. `--seed` adds text to that seed, so the same spec with a different
`--seed` writes a different person; two people drawn from a spec that states
only the culture and the gender differ only by their seeds.

`data.culture` resolves as any culture reference does, through this package's
content tree and its dependencies, and must name a `lore` note of
`subType: culture`. The culture supplies two things, and the command refuses a
culture missing either, with an error at the culture note:

- **Its look**, from `data.appearanceProfile`: the words and ranges every
  appearance field is drawn from. See
  [appearance profiles](reference/format-details.md#appearance-profiles).
- **Its names**, from the language skill note its `data.language` names, whose
  `data.names` holds the pattern and the lists. A language with no
  `data.names` is an error at the language note. See
  [name lists](reference/format-details.md#name-lists).

The content-index JSONL resolves a culture's `data.language` and
`data.appearanceProfile` before this command reads them. A child culture may
inherit each omitted field from its `data.parents`, while a stated value keeps
precedence. The command consumes the resolved values and keeps the selected
child culture on the generated note. A parent cycle or conflicting inherited
sources are errors; complete fields on the selected culture do not excuse a
cycle. See [culture parents](reference/format-details.md#culture-parents-and-inherited-fields).

A profile or name lists with problems are refused with a finding at each.

A spec that states `name.full` keeps it, and the name must fit the language's
lists: one of the patterns for `data.gender`, with every placeholder filled by
a name of its list, the given name from the list for `data.gender`. A name that does not fit is an
error naming the part that fails and the language it was checked against; from
a `--specfile`, the error is located at the name in the file. Where the
gender has no given list of its own, the given name is drawn from, and
checked against, every given list together.

Two top-level spec keys are section bodies rather than frontmatter.
`appearance` is the Appearance section's markdown, written verbatim with its
newlines and spacing; without it, the section is a paragraph written from the
data. `dossier` is the Dossier section's markdown, likewise verbatim; without
it, the section is its heading alone.

**OPTIONS**

| Positional | Type                 | Default | Description            |
| ---------- | -------------------- | ------- | ---------------------- |
| `action`   | string, one of `new` | —       | The action to perform. |

| Option       | Type   | Default         | Description                                                                      |
| ------------ | ------ | --------------- | -------------------------------------------------------------------------------- |
| `--spec`     | string | —               | The spec as a JSON string. Exactly one of `--spec` and `--specfile` is required. |
| `--specfile` | string | —               | The spec as a `.json`, `.yaml` or `.yml` file.                                   |
| `--seed`     | string | —               | Text that seeds generation beside the spec, to draw a different person.          |
| `--out`      | string | standard output | Write the note to this new file. An existing file is never overwritten.          |

**EXIT STATUS**

1 if neither or both of `--spec` and `--specfile` are given, if the spec
cannot be read or lacks `data.culture` or `data.gender`, if `data.culture`
names no culture note, if the culture states no appearance profile or no
language, if its language states no name lists, if the profile or the lists
have problems, if the spec's `name.full` does not fit the lists, if the spec's
`shortcode` already names a being, or if `--out` names a file that exists.
Otherwise 0.

**EXAMPLES**

A spec, `spec.yaml`, stating the culture, the gender, two archetypes, an
occupation and the dossier, and no name:

```yaml
data:
  culture: khelathi
  gender: male
  archetypes: [warrior, mariner]
  occupation: River Fleet Officer
dossier: |
  He holds a commission in the river fleet, and his service is a matter of
  record rather than of reputation.
```

Run against a package configured with `currentDate: "720.300"`, whose
`khelathi` culture carries the profile in
[appearance profiles](reference/format-details.md#appearance-profiles) and
names `language: skill-khelathilng`, and whose language carries the lists in
[name lists](reference/format-details.md#name-lists):

```
$ package-build npc new --specfile spec.yaml
---
shortcode: khelemureziq
name: {full: Khelemûr ez Iqu}
type: being
subType: npc
tags: [generated, draft]
data:
  templatePriority: null
  archetypes: [warrior, mariner]
  occupation: River Fleet Officer
  lore: []
  culture: khelathi
  homes: []
  affiliations: {}
  gender: male
  born: "699.134"
  died: null
  height: 5' 11"
  weight: 167 lbs
  frame: medium
  appearance:
    eye_color: brown
    hair_color: black
    skin_color: brown
    complexion: [clear]
    extra_features: []
---

# Appearance {#appearance}

Khelemûr ez Iqu is a 21-year-old man who stands 5'11" tall with a medium build. He has brown skin, clear complexion, black hair, and brown eyes.

# Dossier {#dossier}

He holds a commission in the river fleet, and his service is a matter of
record rather than of reputation.
```

A spec file, `bad.yaml`, stating a name whose second part is in no list:

```
$ package-build npc new --specfile bad.yaml
bad.yaml:2:9: error: name.full "Aguri ez Lut" does not fit the names of demo-note-skill-khelathilng: "Lut", the {place} part, is not in the place list
```

A spec inline, for a culture that names no language:

```
$ package-build npc new --spec '{"data":{"culture":"plainfolk","gender":"female"}}'
assets/content/Cultures/Plainfolk.md:6:1: error: demo-note-lore-plainfolk states no `data.language`, so `npc new` has no name lists to draw from; name the language skill note its people speak
```

**SEE ALSO**

`package-build lint [root]`,
[Appearance profiles](reference/format-details.md#appearance-profiles),
[Name lists](reference/format-details.md#name-lists),
[A being's look](reference/format-details.md#a-beings-look).
