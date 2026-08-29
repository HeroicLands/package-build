# @heroiclands/package-build

The shared toolchain that compiles a **HeroicLands content tree** — a folder of
Markdown notes with YAML frontmatter — into **Foundry VTT compendium packs**.

Every HeroicLands content module (`sohl`, `thalorna`, `kethira`, and the
adventure modules) builds its packs from this one implementation, rather than
from a copied `utils/packs/` tree.

It ships a command line as well as a library — see
[Command line](#command-line) for the whole surface.

## Install

```
npm install -D @heroiclands/package-build
```

## Configure

A consuming repository declares one `package-build.config.yaml` at its root:

```yaml
# The package this repository's content is published as: the first segment of
# every canonical address, the name of the link manifest it emits, and the
# package a cross-package wikilink writes to reach one of its notes.
contentPackage: thalorna
# Where Foundry installs it: "systems" or "modules". Also decides the served
# asset root a note's `img:` resolves to — `modules/sohl-thalorna/assets/…`.
packageKind: modules

# The Foundry core range this package supports. `minimum` is stamped into every
# compiled document as `_stats.coreVersion`; `verified` names the newest build
# the full suite has actually passed on — never an aspiration.
compatibility:
  minimum: "14.359"
  verified: "14.364"

# What this package declares about others, in Foundry's own shape. A module's
# `_stats.systemVersion` comes from the `verified` version of the system it
# targets — note that this `compatibility` is the *system's* range, not
# Foundry's. Same key, different subject.
relationships:
  systems:
    - id: sohl
      type: system
      manifest: https://github.com/HeroicLands/Song-of-Heroic-Lands-FoundryVTT/releases/latest/download/system.json
      compatibility:
        minimum: "0.4.0"
        verified: "0.4.3"

# Stamped into every compiled document's `_stats`. `coreVersion` and
# `systemVersion` are both absent on purpose — see the derived table below.
stats:
  systemId: sohl
  lastModifiedBy: thalornabuild000

# Which content types compile into Items, and what builds each one's `system`
# block — named, because the registry is code. The registry's keys are the
# accepted item types, so a type cannot be whitelisted without a builder behind
# it. A module that ships no items omits this key. See "An item type's default
# art" below, and "A registry of your own" for the `.mjs` form.
itemBuilders: sohl

# Directory names the content walk ignores wherever they appear.
skipDirectories: [Templates]

# Optional; each path is relative to this file's directory and defaults to the
# conventional layout shown here.
paths:
  content: assets/content
  # Vendored foreign manifests, read by `links`. Inbound.
  manifests: assets/manifests
  # Where `manifest` writes this package's own. Outbound, and a build artifact.
  manifestOut: build/manifests
  packJson: build/packs-json
  stage: build/stage/packs
  unpack: build/tmp/packs

# The one pack list. Order is load-bearing where one pass reads another's
# output, and `packDirectories` is derived from it.
packs:
  - { name: items, type: Item, label: Items, folders: item-folders.yaml }
  - { name: journals, type: JournalEntry, label: Journals }
  # A companion is written by its parent's pass rather than one of its own.
  - name: scenes
    type: Scene
    companions:
      - { name: adventures, type: Adventure }

  # A pack whose per-document JSON is already built — checked in rather than
  # generated. `prebuilt` names where it lives, generation is skipped for it,
  # and `cleanPackEntry` and the Scene/Level integrity check still run. It may
  # not carry `folders`, `companions` or `default`, and may not be a companion:
  # each of those describes a generation pass a prebuilt pack does not have.
  # When every configured pack is prebuilt the content walk is skipped
  # entirely, so a package with no `assets/content` builds.
  - name: adventures
    type: Adventure
    prebuilt: assets/packs/adventure
    # Foundry requires `system` on ActiveEffect, Actor and Item packs and on no
    # others, so it is declared per pack. Unset falls back to `stats.systemId`
    # — itself optional — and with neither the manifest omits the key. An
    # Adventure or Scene pack that names a system is hidden from every other
    # one, which is rarely what a package that declined to name one meant.
    system: null

# How this repository frames the pages `content-build docs` generates. The
# tables come from the itemBuilders registry and are the same everywhere; the
# heading, the filing and what a reader is told first are this repository's.
docs:
  itemFields:
    title: Item Note Frontmatter
    out: kb/dev-docs/content-creator/item-frontmatter.md
    preamble:
      - "See also: [The Authoring Workflow](authoring-workflow.md)"
      - ""
      - Every item note carries the frontmatter envelope described there. This
        page covers what each **type** adds to it.

# Reserved for @heroiclands/package-build, which validates what is inside it.
# One repository describes itself in one file; the two build packages split by
# input, and neither learns the other's schema. Values package-build needs that
# already live at the top level — `packageKind`, `foundryPackage` — it reads
# from there rather than restating them here.
packageBuild:
  assets:
    - { from: assets/icons, to: assets/icons }

# Three independent switches — every combination is real — plus the address
# scheme both `manifest` and `site` derive addresses under. `site` is a mode,
# not a boolean: `homepage` (the default) publishes the authored homepage and
# no other page; `content` publishes it plus every page the tree compiles to.
publish:
  site: content
  manifests: { publish: true, consume: true }
  address:
    prefix: kb/
    landing: readme

# How this repository frames the website `content-build site` publishes.
# Framing only: addresses come from `publish.address` above.
site:
  out: kb/content
  landing: { title: Knowledgebase, type: knowledgebase }
  sections:
    being: { title: Beings, banner: banners/creature.webp }
```

The loader validates the document, resolves every path against the directory
the file sits in, fills the optional halves with their defaults
(`skipDirectories: []`, `packageBuild: {}`, the conventional `paths`, both
manifest switches off and `publish.site` at its `homepage` floor),
derives `assetRoot`, `packDirectories`, `itemTypes` and `docEntryTypes`, and
freezes the result. A malformed configuration throws a `TypeError` naming the
offending field, so it fails at load rather than as an empty pack much later.

**Four values are derived rather than authored**, because each is something a
file can be asked for rather than told:

| Field                 | Derived from                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `rootDir`             | the directory the configuration file sits in                                                                                      |
| `foundryPackage`      | the `name` of the adjacent `package.json`, verbatim                                                                               |
| `stats.systemVersion` | a **system**: that `package.json`'s `version`. A **module**: the `verified` version of the system it declares a relationship with |
| `itemBuilders`        | the named registry (`sohl`), required lazily so importing costs nothing                                                           |

**Authoring any of the first three is an error**, not an override. Each was
previously transcribed from a file that already stated it, and a transcription
is free to disagree with what it copies — `stats.systemVersion` froze at
`0.6.0` for four releases before anyone noticed, and was still frozen there in
two repositories afterwards.

A module does **not** take its system version from its own `package.json`: that
is the _module's_ version, and stamping it would claim a system version that
never existed. A module declaring no usable system relationship fails the build
rather than guessing — a wrong `_stats.systemVersion` is invisible until
something migrates on it.

### A note's package is the repository's, not the note's

`contentPackage` is the **address namespace** every note in the tree is
published under: the first segment of every canonical key (`sohl-skill-clmb`),
the name of the link manifest this build emits (`sohl.json`), and the package a
cross-package wikilink writes to reach one of these notes. It is the
repository's identity in the address space — not a filter — and a note does not
restate it.

**`package:` in a note's frontmatter is retired, and declaring it fails the
build**, naming the file, whatever the value says. An agreeing declaration is
refused exactly as a disagreeing one is: there is no value that makes writing
the field correct. The diagnostic says so, and says where the value comes from
instead:

```text
assets/content/Gear/Axe.md:12:1: error: `package: sohl` is a retired frontmatter field — delete it. A note's package is this repository's configured `contentPackage` ("sohl", in package-build.config.yaml), and every note in the tree belongs to it.
```

`content-build lint` reports every such note in one pass; `content-build
package compile` and `content-build manifest` refuse the tree.

A generated table that scopes itself with `WHERE … and package = "<pkg>"` keeps
working: the package is **synthesised** into what the table search sees,
supplied from `contentPackage` rather than read off the note. It is a search
value, never an authored one.

It used to **select**: a note compiled when its `package:` matched and was
skipped when it did not. Every content tree is single-package — each is
single-sourced in the repository that ships it — so the field restated one
constant thousands of times, while a tree whose notes named a package no
configuration answered to compiled **zero notes and exited 0**. Deleting the
field from a note is the fix; deleting the _configured_ value is not, since
every address derives from it.

Sweeping a tree is mechanical — the field is a whole line, and nothing else
reads it:

```bash
find assets/content -name '*.md' -print0 | xargs -0 sed -i '' '/^package: /d'
```

### A registry of your own

`itemBuilders` is the one part of the contract that is code — a table of
functions building each type's `system` block — so data can only _name_ one of
the registries this package ships. A consumer supplying its own writes
`package-build.config.mjs` instead, which is loaded in place of the YAML:

```js
import { defineConfig } from "@heroiclands/package-build/content-config";
import { ITEM_BUILDERS } from "./build/item-builders.mjs";

export default defineConfig({
  // Stated, since a code configuration derives nothing: it is code, and can
  // read whatever it likes for itself.
  rootDir: import.meta.dirname,
  contentPackage: "kethira",
  foundryPackage: "sohl-kethira-basic",
  packageKind: "modules",
  compatibility: { minimum: "14.359", verified: "14.364" },
  stats: { systemId: "sohl", systemVersion: "0.4.3", lastModifiedBy: "…" },
  itemBuilders: ITEM_BUILDERS,
  packs: [{ name: "items", type: "Item" }],
});
```

The two forms end at the same `defineConfig`, so they are validated and frozen
identically; a code config simply states the three fields above itself, which it
can, because it is code. **Import `defineConfig` from
`@heroiclands/package-build/content-config`, never from the package root** — the root
barrel pulls in the compilers, the compilers read the resolved configuration,
and resolving it loads this file, so importing the barrel here closes a cycle
around the file's own evaluation. The `/config` entry point imports nothing but
`node:path` and the id helpers, so it cannot.

**One directory, one configuration.** A directory holding both a `.yaml` and an
`.mjs` is an error, not a precedence question: picking one would let a
repository mid-conversion build from the file its author is no longer editing,
and look entirely healthy doing it.

### Several packs of one document type

A repository may declare more than one pack of the same `type`, and route notes
between them. Editorial grouping of same-type documents into separate
compendiums is ordinary Foundry practice — "Core Spells" and "Expanded Spells"
are two Item packs — and it matters beyond taste: a compendium UUID carries its
pack name (`Compendium.<package>.<pack>.Item.<id>`), so collapsing several packs
into one invalidates every reference an existing world holds.

Two axes, deliberately orthogonal:

- a pack's **`type`** selects the _compiler_ that fills it;
- a note's **`pack:`** frontmatter selects _which pack of that type_ receives its
  document.

```yaml
packs:
  - { name: characteristics, type: Item, default: true }
  - { name: mysteries, type: Item }
  - { name: journals, type: JournalEntry }
```

```yaml
# A note that says nothing lands in `characteristics`, the default Item pack.
---
name:
  full: Climbing
type: skill
id: ...
---
# A note that names one lands there instead.
---
name:
  full: Second Sight
type: skill
id: ...
pack: mysteries
---
```

- **`pack:` is optional, and silence means the default.** Every note written
  before this existed declares nothing, so an undeclared note must keep
  compiling exactly where it always did. A type with exactly **one** pack is
  that type's default implicitly; a type with several designates one with
  `default: true`. Where several exist and none is marked, a declaration is
  **mandatory** and an undeclared note fails the build.
- **A `pack:` naming no configured pack is a build error**, not a fall-through to
  the default. A typo'd name that quietly landed content in the wrong compendium
  would be silent partial compilation — the failure mode this toolchain's guards
  exist to eliminate. The same applies to a name that belongs to a pack of
  another document type, or to a companion (no note is ever routed into one).
- **A note's `pack:` names where its _own_ document goes.** Anything derived from
  it — an item's or a macro's prose, which compiles into a JournalEntry of its
  own — lands in the default pack of _that_ type.

**The configuration is found by walking up, not from the working directory.**
`engine/pack-config.mjs` climbs from itself — so it works from `packages/` and
from `node_modules/` alike, and does not depend on the directory the build was
launched from. Set `PACKAGE_BUILD_CONFIG` to point at the file explicitly if a
consumer keeps it somewhere else.

**The configuration is resolved on first read, never at import.** Every module
here can be imported — and `content-build --version` and `--help` answered — in a
directory with no `package-build.config.yaml` and no Foundry package manifest, so
a consumer can reach for one pure helper (`engine/content-slug`,
`engine/wikilinks`) without standing up a pack build. Anything derived from
configuration is therefore an accessor rather than a hoisted constant —
`loadPackConfig()`, `contentPackage()`, `foundryPackageId()`, `itemTypes()`,
`docEntryTypes()`, `packRouter()`, `defaultTemplateDir()` — and each throws, with
the same explicit message as before, the moment a build actually needs a value it
cannot find. Absence is still a hard failure; only the moment it is reported
moved (#2).

The file is read synchronously — an `.mjs` one with `require` — so that reading
a configured value stays an ordinary expression instead of making every module
downstream of it an async one. The one shape that cannot be loaded is an `.mjs`
config whose own module graph uses top-level `await`, which is reported as such.

**`itemBuilders` is how the engine learns a consumer's item types without
holding its data model.** `itemTypes` is its key set, and `docEntryTypes` — every
type whose prose compiles into a JournalEntry of its own — is composed from it
exactly once, here, and read through `loadPackConfig()` everywhere. There is one
resolved set at runtime; the compilers and the link-manifest emitter cannot come
to disagree about which notes carry documentation.

The Item compiler **dispatches through that same resolved table**, via
`engine/item-registry.mjs` (`itemTypes()` and `itemBuilder(type)`), so the types a
consumer's notes are accepted for and the builders they compile with are one
object. Supplying `itemBuilders` is therefore all a consumer does to define an
item type of its own; a table this package ships is one possible value, not the
one the compiler holds.

**Configuration is the source, and the manifest is generated from it.** That
arrow used to point the other way: `paths.packageManifest` said where a
hand-authored `system.template.json` lived, and the package-id guard and the
`_stats.coreVersion` stamp both read out of it. Both are gone — the floor is the
top-level `compatibility.minimum`, the id is derived from `package.json`
`name`, and `@heroiclands/package-build` writes the manifest from this file.

### An item type's default art

A note that carries no `img:` gets its type's **default art**, and a type
declares that art in the same place it declares its builder. An `itemBuilders`
entry may be written two ways:

```js
itemBuilders: {
  // A bare builder. Every note of this type must carry its own `img:`.
  charm: buildCharm,
  // The same builder, paired with the art a note of this type gets when it
  // sets no `img:` of its own.
  relic: { system: buildRelic, img: "icons/relic.svg" },
}
```

Both spellings are equal; the difference is only whether the type brings art.
`itemTypes` is still the key set either way, so a type is still impossible to
whitelist without a builder behind it.

**The path is spelled the way a note spells it.** Registry art goes through the
same `resolveImg` rule as a note's `img:`, so `icons/relic.svg` means _this_
repository's asset root — `modules/sohl-relics/assets/icons/relic.svg` — and an
already-served path (`systems/sohl/assets/icons/…`) passes through untouched.

**A type with neither is a build error, deliberately.** When a note sets no
`img:` and its type pairs none, the pack build aborts rather than shipping an
item with a mismatched icon:

```
No default art for item type "relic" — the note carries no `img:`, and the
`itemBuilders` entry for "relic" in this repository's configuration
pairs none with its builder.
```

#### Why art travels with the builder (#7)

It did not always. The item **type** whitelist was derived from a consumer's
`itemBuilders` keys, while the **art** for those same types was looked up in
`sohl/default-item-art.mjs` — a table this package ships for the `sohl` package
and which a consumer cannot add to. A type was therefore configurable while its
default art was not, and a second consumer's own item type compiled only if
every one of its notes carried an explicit `img:`; the first note that omitted
one failed the build with an error naming a module in someone else's package.

Widening that map was not the fix. It is deliberately SoHL data, shared with the
runtime's `SohlItem.getDefaultArtwork` so that the build-time and runtime
defaults are one list and cannot drift (SoHL#932/#1510). Pairing art with the
builder instead moves it onto the seam a type is _already_ declared through, and
costs the `sohl` package nothing: `ITEM_BUILDERS` reads each entry's image out of
that same map, so there is still exactly one map — and the drift a test used to
watch for is now unrepresentable, because building the registry throws if a type
has no art.

## Command line

```
npx content-build package <compile|unpack|clean> [pack] [entry]
npx content-build docs item-fields [--out <path>] [--title <title>]
npx content-build lint [root] [--no-references]
npx content-build links [root] [--manifests <dir>]
npx content-build format [paths..] [--write]
npx content-build markdown [paths..] [--fix]
npx content-build manifest [root] [--out <dir>]
npx content-build site [--out <dir>]
npx content-build reachability <dir> [file] [--index <shortcode>]
```

| Command        | What it does                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `package`      | Compile the content tree into LevelDB packs, unpack a shipped pack back to JSON, or clean one. See [Install](#install).       |
| `docs`         | Render a generated reference from the configured registries. `item-fields` is the item-frontmatter page.                      |
| `lint`         | Check a content tree's addresses and its frontmatter. See [Linting a content tree](#linting-a-content-tree).                  |
| `links`        | Check that every link in the tree lands: dead anchors, dead qualified addresses, wikilinks in frontmatter, drifted manifests. |
| `format`       | Prettier, with the shared configuration. See [Prose: formatting and markdown](#prose-formatting-and-markdown).                |
| `markdown`     | markdownlint, with the shared rule set — the structure Prettier is indifferent to.                                            |
| `manifest`     | Emit this package's cross-package link manifest. See [Publishing a link manifest](#publishing-a-link-manifest).               |
| `site`         | Publish the content tree as a website. See [Publishing a website](#publishing-a-website).                                     |
| `reachability` | Walk outward from an index note and report what no path reaches, for a tree meant to be navigable from one entry point.       |

Every path, pack name and root it needs comes from the consuming repository's
`package-build.config.yaml`, so the usual invocation takes no arguments beyond
the command itself. What may be named on the command line overrides that.

**Every invocation it accepts is one it performs.** A missing command, an
unknown command, a missing or unknown action, and an unknown option are each an
error that names what was wrong and exits non-zero — never a silent success. A
build chain can therefore treat a zero exit as "the work happened". `--version`
and `--help` still answer in a directory with no configuration at all.

## Linting a content tree

```bash
npx content-build lint            # the configured `paths.content`
npx content-build lint some/tree  # or a tree named outright
```

Checks the two rules every note's **identity** is authored against, and reports
each finding in the located form below:

- **Shape** — a `shortcode` is strictly ASCII-alphanumeric. It is the identity
  key referenced from saved world data, and half of the `type-shortcode`
  address, whose parse needs the separating hyphen to be the only hyphen.
- **Uniqueness** — `(type, shortcode)` names one note. A document is addressed
  across _every_ pack of its document type, so routing two same-address notes to
  different packs with `pack:` does not separate them.

It compiles nothing, opens no LevelDB and needs no Foundry manifest, so it runs
in about a second and can gate a commit. An empty or untyped tree **fails**
rather than passing: "every one of nothing is unique" is a vacuous pass, and it
is exactly what a tree that failed to check out produces.

### Frontmatter, against the schema its type declares

The same command also checks that each note's `sohl:` block is what its **type**
allows (#19). Five classes, all of them mistakes that were previously reported
somewhere other than where they were made, or not at all:

- **Unknown or retired type** — a note on a retired spelling is told what
  replaced it.
- **Missing required property** — `dimensions` on a map, `subType` on a skill.
- **Wrong value shape** — `weight: heavy` where a number belongs.
- **Unknown property** — _the allow-list made loud_. The builders discard a
  `sohl:` key no field declares, with no warning and no effect on the exit code,
  which is how 204 kethira mystical abilities shipped with no affiliation (#3).
  A near miss is named: `Did you mean "masteryLevelBase"?`
- **Dead shortcode reference** — `assocSkillCode` naming a skill nothing
  declares. Resolved through the same resolver `links` uses, so a cross-package
  reference answered by a vendored manifest lands exactly as it would in a
  wikilink. `--no-references` turns this one off for a tree whose cross-package
  references it cannot see.

**A schema says what a note may _write_, not what the compiler emits.** Those
are different, and the difference is the whole calibration of the check: a note
also feeds a knowledgebase and a website, and those read classification the pack
build never compiles — `kbcat` alone appears 51 times in SoHL's knowledgebase
layouts. Equating the vocabulary with the builder's allow-list reported 4,241
unknown properties against SoHL's own tree, every one correctly authored.

Item types need no separate declaration: their field list already _is_ the
builder, so schema and compiler cannot disagree. The hand-written compilers —
`being`, `macro`, `doc` and the three map types — declare theirs in
`sohl/note-schemas.mjs`.

Nothing here writes. A check reports and an author fixes.

**A third rule was retired (#79).** Every note used to be required to repeat its
own `type-shortcode` address in `aliases:`. That served one reader — Obsidian,
so `[[type-shortcode]]` resolved in the editor — and no build ever read it: both
resolvers parse the hyphen qualifier themselves. The project no longer authors
in Obsidian, so the rule cost a line of frontmatter per note for a reader that
does not exist. Removing it was verified output-neutral first: across 1,735
stripped notes, `package compile` produced byte-identical `build/packs-json` and
the site build byte-identical `site/content`.

## Prose: formatting and markdown

```bash
npx content-build format             # check the whole repository
npx content-build format --write     # rewrite what is not formatted
npx content-build markdown           # lint every markdown file
npx content-build markdown --fix     # apply the fixes markdownlint can make
```

Two conventions every content repository writes to, declared once here so a note
formatted in one is formatted the same way in the next (#69):

- **`format`** runs Prettier. Same values SoHL has always used, so a module or a
  note moving between repositories does not reformat on arrival.
- **`markdown`** runs markdownlint — the structural checks Prettier cannot make:
  a heading level that skips, two sibling headings claiming one anchor, a
  reversed `(text)[url]`, a bare URL, an empty link, a table row with the wrong
  cell count, and the emphasis markers (`_emphasis_`, `**strong**`) these
  repositories write.

The rule set is **deliberately narrow**. markdownlint's defaults over a content
tree produce tens of thousands of findings, almost all of them line length, list
indentation and blank lines — Prettier's territory. So `default` is off and each
rule is enabled by name, with the reason it earns its place; add one only if it
can report that a page is _wrong_.

Both run over the **repository**, not the content tree, and neither reads the
pack configuration — a repository's formatting covers everything it holds, and
one that has not configured this package at all can still format itself.

**What ships here is a default, not an override.** A consumer's own Prettier
config or `.markdownlint-cli2.jsonc` wins wherever it has one. Which paths to
skip is knowledge about a repository's layout and stays with that repository, in
its own `.prettierignore` and `.gitignore` — both honoured, as Prettier and
markdownlint honour them natively. The one exception is `CHANGELOG.md`, which
`changeset version` regenerates in every repository here: linting it reports on
the generator, so it is skipped by default.

Neither tool's file discovery is reimplemented, so `content-build format --check`
and a bare `prettier --check .` report the same thing. A file Prettier cannot
parse is a **finding**, with its position — not a crash that costs the report on
every other file.

To make an editor agree with the lint chain, point its config at the same rules:

```js
// prettier.config.mjs
export { default } from "@heroiclands/package-build/prettier";
```

```js
// .markdownlint-cli2.mjs — extending rather than replacing
import shared from "@heroiclands/package-build/markdownlint";
export default { ...shared, config: { ...shared.config, MD013: true } };
```

## Publishing a link manifest

```bash
npx content-build manifest              # the configured tree and output directory
npx content-build manifest --out tmp/   # or somewhere else
```

Writes `<contentPackage>.json` naming every note this package publishes, keyed by
the canonical `package-type-shortcode` address and valued with every address that
note has: a `path` on the web, a `uuid` in Foundry, the `anchors` its named
sections compiled to, and a `doc` pointer where an item's prose compiles into a
JournalEntry of its own. A consuming build vendors the file into its own
`paths.manifests` and resolves cross-package links through it — the counterpart
of `links`, which consumes what this emits.

It reads its whole input from configuration and takes nothing else:

| Setting                     | What it decides                                               |
| --------------------------- | ------------------------------------------------------------- |
| `contentPackage`            | The package emitted, which every note belongs to.             |
| `foundryPackage`            | The package every emitted `uuid` names.                       |
| `paths.content`             | The tree walked.                                              |
| `paths.manifestOut`         | Where the file lands (`build/manifests` by default).          |
| `publish.manifests.publish` | Whether this repository publishes one at all.                 |
| `publish.site`              | Whether entries carry a `path` — see below.                   |
| `publish.address`           | The address scheme those paths are derived under — see below. |

**Both addresses are optional, independently.** A note that compiles into no
document has no `uuid`, and a package that ships compendiums and publishes only
a homepage (`publish.site: homepage`) has no `path` on any entry — its notes are
not pages. Neither is an error, and neither is guessed: inventing the missing one
asserts a target that does not exist, which is the silent dead link the manifest
exists to prevent.

**`publish.manifests.publish` is a declaration, not a preference.** The file is
vendored by other repositories and read as authoritative, so emitting one is a
statement about this package. With the switch off the command fails rather than
writing.

### The address scheme

Where the content tree mounts _inside the package_, and which note addresses a
whole section rather than a page within one, differ between repositories and are
both load-bearing. They are one setting, read by this command **and** by the page
emitter, so the address a manifest publishes is the address a page is emitted at
— stating it twice is how a manifest comes to assert a URL that resolves at build
time and 404s for the reader.

```yaml
publish:
  site: content
  manifests: { publish: true, consume: true }
  address:
    prefix: kb/ # default: "" — the package root
    landing: readme # default: readme
```

- **`prefix`** — the content tree's mount within the package. `sohl` publishes a
  knowledgebase alongside generated API docs, so its notes sit under `kb/`
  (`kb/affliction/aconite/`); `thalorna`'s site is nothing but its content, so it
  has no prefix (`affiliation/the-aerarium-imperii/`). It must end in a slash and
  must not begin with one — where the _package_ is mounted is the consuming
  build's knowledge and is never recorded here.
- **`landing`** — which note is a section's landing page, and so has no slug of
  its own:
  - `readme` — a `README.md` addresses its section. A `doc` note then routes by
    its `category` like any other, so a `category: collection` note publishes
    under a literal `collection/` section.
  - `collection` — a `doc` note whose `category` is `collection` addresses the
    section it introduces, named by its authored `section`.

  The two are alternatives rather than a pair that could both apply: each live
  content tree holds notes the other rule would move.

A note the scheme yields no address for — a `doc` with no category, a collection
note naming no section — is **reported and omitted**, never guessed. The command
prints one located diagnostic per note and still writes the file, because a note
with no address is ordinary while a manifest entry pointing at a page that does
not exist is not.

## Publishing a website

```bash
npx content-build site               # the configured tree and output
npx content-build site --out tmp/kb  # or somewhere else
```

The sibling of `package compile`: the same content tree, rendered as pages
instead of compiled into packs. It does the walk, the frontmatter read, the
address derivation, the address index, table expansion, wikilink resolution,
code-fence protection, the foreign-manifest merge, the page emission and the
section-landing backfill.

### The homepage, and how much else is published

Every package is reachable at `https://www.heroiclands.org/<contentPackage>/`,
and what a reader finds there is a note in the content tree — one markdown file,
written by a person:

```markdown
---
type: homepage
title: HârnMaster Kethira Basic # optional; defaults to packageBuild.manifest.title
---

What the module is, which system it needs, how to install it.
```

That is the whole envelope. A homepage **compiles into no compendium
document**, appears in no pack and in no link manifest, and is addressed by the
_package_ rather than by its own name — so `name.full`, `shortcode` and `id`
decide nothing on it. It is dispatched on `type` like every other note, not on a
filename: `README.md` is already a section landing under `landing: readme`, and
in `sohl-thalorna` it is a developer explainer about the source tree.

`type: homepage` is declared by the **engine**, not by the `sohl` item registry,
so a package that configures no `itemBuilders` at all — `HarnMaster-3-FoundryVTT`
and every HM3 module — can author one. The `engine/` ÷ `sohl/` line is
note-format knowledge against game-system knowledge, and a homepage carries no
`system` block.

`publish.site` then says how much _else_ is published:

| Mode       | What is published                                                               |
| ---------- | ------------------------------------------------------------------------------- |
| `homepage` | The authored homepage, and no other page. **The default, and the floor.**       |
| `content`  | The homepage plus every page the content tree compiles to, and its extra trees. |

There is no value meaning "no web presence": every package publishes its
homepage. It was a boolean until 5.0.0, and both spellings are now refused
naming the mode to write instead — see [MIGRATING.md](MIGRATING.md).

**Homepage-only is a first-class mode, not an accommodation.**
`sohl-kethira-basic` (unofficial Hârn fan material under Keléstia Productions'
Fan Material Guidelines) and `harn-adventures` (HârnFanon under Lythia's terms)
must each publish a homepage and nothing beneath it. The boundary is _published
content_ — journal text, artwork, item descriptions, compiled notes — and a page
announcing the module discloses none of it. Because the failure mode is silent,
the mode **fences the content surfaces off** rather than trusting a
configuration to stay empty: in `homepage` mode the tree is never walked for
pages, and `sections`, `trees`, `landing` and `backfillSections` emit nothing
even when they are declared.

That is separate from `publish.manifests.publish`, which stays off for both for
an unrelated reason: a link manifest is the dependency edge that would stop the
module being withdrawable, and a homepage is one row in a routing table.

The homepage is written at the root of `site.out` — the package's own address —
one level above the content mount, which is where `publish.address.prefix` puts
everything else.

**What it does not do is decide addresses.** Those come from `publish.address`,
the same setting the link manifest reads, so a page and its manifest entry cannot
disagree about where the page is. Everything under `site:` is _framing_ —
where the tree is written, what a section is called, which extra trees are
published beside the content:

```yaml
site:
  out: kb/content # required; wiped on every run
  base: /sohl/ # default: /<contentPackage>/
  packages: [sohl, thalorna] # default: just contentPackage
  backfillSections: true
  landing: { title: Knowledgebase, type: knowledgebase }
  pass: sohlKb
  passOptions:
    apiBase: /sohl/api/
    symbolMap: kb/data/api-symbols.json
    blob: https://github.com/HeroicLands/…/blob/main/
  trees:
    - { from: kb/dev-docs, section: dev-docs }
  sections:
    being: { title: Beings, banner: banners/creature.webp }
  readmeSections:
    dev-docs: { title: Developer Documentation, banner: banners/dev-docs.webp }
```

| Key                | What it decides                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `out`              | The Hugo content root. **Required** in both modes, and wiped on every run — see below.           |
| `base`             | Where the package is served. Defaults to `/<contentPackage>/`.                                   |
| `packages`         | Which content packages this site renders. Defaults to its own.                                   |
| `sections`         | Landing title and hero per section, so a landing matches the card that links to it.              |
| `readmeSections`   | The same, for a section whose landing comes from a `README`.                                     |
| `landing`          | Frontmatter for the mount's own `_index.md`. Passed through — the vocabulary is the theme's.     |
| `backfillSections` | Write a bare `_index.md` for any other section directly under the mount.                         |
| `trees`            | Extra source trees published beside the content, preserving their source layout below a section. |
| `pass`             | A named bundle of this repository's own body rewrites.                                           |
| `passOptions`      | That bundle's options.                                                                           |

### Why `out` is required

The output tree is a build artifact and is **deleted on every run**, so that a
page whose note was renamed cannot linger and keep publishing. An unset `out`
resolves to the repository root, and the wipe then deletes the working tree.
That is not hypothetical — it happened while this command was being written, on
a configuration that simply had no `site` section yet. So `out` is refused when
unset, and refused again when it resolves anywhere that is not strictly inside
the repository root.

### Consumer passes are named, not imported

A repository's own body rewrites are code, and a configuration is data, so a
configuration **names** a bundle and the toolchain resolves it — exactly as
`itemBuilders` names an item registry. `sohlKb` is the bundle for the `sohl`
knowledgebase: it resolves `{@link}` tags against a TypeDoc symbol map and
rewrites repository-relative links in the developer docs to their published or
GitHub addresses. Neither rewrite can fail a build; an unknown `{@link}` degrades
to a code span.

A bundle supplies up to two hooks, and their order around the shared work is the
point:

1. `beforeLinks`, on every page, before wikilinks resolve — a `{@link}` tag may
   sit in prose a wikilink also touches.
2. `afterLinks`, on pages from an extra tree only — repository-relative links are
   a property of how those pages are authored, not of content notes.

Both run inside code-fence protection, so neither can rewrite a fenced example.

### The gates

Every integrity check reports and the run stops at the first that fires, so the
output names the cause rather than its symptoms — an unusable manifest reported
after the links that failed because of it reads as a pile of broken notes.

| Gate                   | What it catches                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------- |
| Frontmatter wikilinks  | A link in frontmatter, which is copied verbatim and reaches the reader as `[[…]]`. |
| Slugs                  | A name that yields no URL.                                                         |
| Collisions             | Two notes claiming one page URL.                                                   |
| Unusable manifest      | A vendored manifest this build cannot read.                                        |
| Unaddressable manifest | One it can read but cannot look anything up in.                                    |
| Package conflicts      | One address claimed by two packages.                                               |
| Tables and wikilinks   | A table directive that cannot be honoured, or a link that lands nowhere.           |

None of them exits the process from inside the library; the command decides. That
is what makes them testable, which the consumer scripts' inline `process.exit`
calls were not.

## Diagnostics

Every warning or error a build reports **about a content note** is emitted in the
form every C-family compiler, `tsc` and ESLint already use, so an editor, a CI
annotator or a `grep` parses it with no knowledge of this build:

```text
assets/content/Regions/Capital_Nome.md:43:635: warning: unresolved wikilink [[Kenbet_Pat|Kenbet'Pat]] (unknown) in "The Capital Nome"
```

`file:line:column: severity: message`. The path is relative to the working
directory — during a build, the consuming repository's root.

Two rules keep it that way, both in `engine/diagnostics.mjs`:

- **The locator starts the line.** Diagnostics deliberately bypass `loglevel`,
  whose `[timestamp] [WARN]:` prefix sits exactly where a parser reads the path
  from; a greedy path pattern swallows the prefix and yields a filename nothing
  can open. Progress and summary lines still go through `loglevel` — they are
  not about a file and nothing needs to parse them.
- **A field is dropped, never guessed.** A diagnostic reports the position it
  can establish honestly and no more: `file:line: …` when the column is
  meaningless, `file: …` when only the note is known. Nothing defaults to
  `1:1`, which would send a reader to the frontmatter every time.

Establishing a position at all takes three corrections, applied only where they
hold — see `positionInBody`. A body offset is not a file line until the
frontmatter's lines are added (`bodyLine`); the trim that strips the body can
take indentation off its first line (`bodyColumn`); and a body is scanned
_after_ its content tables expand, so an offset may land in text nobody
authored. `expandContentTables` therefore returns a `lineMap` saying which
authored line each emitted line came from — a generated row is blamed on the
directive that produced it and reports **no column**, because there is no
authored character to point at.

## Layout

- **`@heroiclands/package-build/engine`** — package-agnostic machinery: the
  content walk, frontmatter, tables, wikilinks, ids, folders, the link manifest
  and the web-address rule, `BasePackCompiler`, and the generic Foundry document
  compilers.
- **`@heroiclands/package-build/sohl`** — Song of Heroic Lands data-model
  knowledge: item types, builders, the items and actors compilers, and default
  art. Isolated behind its own entry point so an adventure module never receives
  `buildWeaponGear`.

Each module is also reachable as its own entry point —
`@heroiclands/package-build/engine/journals`,
`@heroiclands/package-build/sohl/items` — so a build that needs one thing does
not load the whole pipeline. The barrels re-export each module as a namespace
rather than flattening it, because several modules deliberately re-export a
neighbour's symbol and a flattened star export would drop every such name
silently.

A few plain-ESM leaves are shared **with the Foundry runtime**, not just with the
build: the item default-art map, the curated region-event vocabulary, and the
affiliation standings. Each has its own entry point —
`@heroiclands/package-build/sohl/default-item-art`,
`.../engine/region-events`, `.../sohl/affiliation-standings` — so a client bundle
reaches the constant without importing a barrel that grows to hold compilers
reading the filesystem. Keeping one copy of each is the point: the build-time and
runtime values cannot disagree, which is the drift that produced #932.

`@heroiclands/package-build/content-config` exposes the configuration contract's own
module, so a consumer can name its types (`ContentBuildConfig`, `PackSpec`) from
JSDoc.

## Tests

The package carries its own suite and its own vitest project, so it is
verifiable without the repository that happens to host it:

```
npm test -w @heroiclands/package-build     # from the SoHL repository root
npm test                                   # from packages/content-build/
```

The SoHL repository's root `npm run test` names the very same project config, so
one command still gates everything CI runs and neither entry point can drift
into a different suite.

The harness is deliberately austere: no global setup, no Foundry stubs, and no
alias onto a consuming repository's source. `tests/suite-is-self-contained.test.ts`
enforces that — a test in this suite that reached for `globalThis.game` or `@src`
would pass in situ and fail the moment the package was installed from npm.

`tests/dependencies-are-declared.test.ts` guards the same failure from the
shipping side. Because this package is a workspace, npm hoists the root
repository's `devDependencies` into the workspace root, so an import this
package never declared still resolves here and fails nowhere but a consumer's
install (#1557). The test walks every module named by the `files` field and
holds each bare specifier to one of three cases — a Node builtin, this package
addressing itself, or a declared `dependency` — and checks the converse: nothing
shipped may import a `devDependency`, and no declared dependency may go
unimported.

## Releasing

Releasing is not a command anyone runs. It is a consequence of merging, in two
steps, and each step is visible while it is pending.

**Every pull request declares its bump.** Run `npx changeset` and pick
major/minor/patch; the summary you write becomes the changelog entry and the
release note. If the change ships nothing a consumer can see, say so explicitly
with `npx changeset add --empty`. CI's **Changeset declared** job fails a pull
request that declares neither — `npm run changeset:check` is the same check,
locally.

**Merging to `main` opens a Version Packages pull request** carrying the version
bump and the rewritten `CHANGELOG.md`. That pull request _is_ the pending
release: as long as something is merged but unpublished, there is an open pull
request saying so. This is the whole point of the pipeline — the previous,
hand-driven process failed by leaving _nothing_ behind when the final step was
forgotten, and on 2026-08-21 it did exactly that for two versions (#15).

**Merging that publishes.** `changeset publish` puts the version on npm through
Trusted Publishing (OIDC — there is no `NPM_TOKEN`), tags the commit `v<version>`
and cuts the GitHub Release with the changelog section as its body. It publishes
only versions that are not already on the registry, so re-running it is a no-op;
`workflow_dispatch` on **Publish to npm** is the recovery path if a run fails
after versioning.

Below 1.0.0, `^0.x` never crosses a minor — a consumer on `^0.15.0` will not see
`0.16.0` until it bumps the pin deliberately. Dependabot raises that as its own
pull request in each of the three consuming repositories.

> After a successful publish, `npm view @heroiclands/package-build version` can
> report the _previous_ version for a minute or so. `dist-tags` is correct
> immediately, and is what the workflow prints.

## License

GPL-3.0-or-later — see the
[SoHL repository](https://github.com/HeroicLands/Song-of-Heroic-Lands-FoundryVTT).
