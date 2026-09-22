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
# every canonical address, the name of the content index it emits, and the
# package a cross-package wikilink writes to reach one of its notes.
contentPackage: thalorna
# What kind of package this is. "systems" and "modules" are where Foundry
# installs it, and each decides the served asset root a note's `img:` resolves
# to — `modules/sohl-thalorna/assets/…`. "documentation" is a package Foundry
# never installs; see "A package that compiles nothing" below.
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

# Optional. The icon fonts this package ships and the names its notes draw from
# them. Nothing is supplied by default: an entry is a promise that a glyph will
# render, and only the package shipping the font can keep it.
#
# Either the registry itself, or a path to a file holding it — the file form is
# what a real package wants, because a registry is generated from what the
# interface draws and a generated document inlined here conflicts on every
# regeneration.
icons: assets/icon-registry.yaml
#
# The same, written inline:
#
# icons:
#   families:
#     # `class` is the stylesheet prefix; `styles` are the weights the font
#     # ships, and `[]` means it has none.
#     fontawesome: { class: fa, styles: [solid, regular, brands], describe: Font Awesome Free }
#     game-icons: { class: ginf, styles: [], describe: the Game-Icons webfont }
#   # Which family an entry with no `family` belongs to. Optional where exactly
#   # one is declared, since then there is nothing to choose between.
#   defaultFamily: fontawesome
#   icons:
#     # A name is what a note writes between the colons, in the charset an
#     # address segment uses. `fixedWidth` asks for a full advance, which a
#     # glyph like an ellipsis needs to sit in a column of controls.
#     being: { style: solid, icon: user, label: being }
#     context-menu: { style: solid, icon: ellipsis-vertical, fixedWidth: true, label: context menu }
#     vehicle: { family: game-icons, icon: old-wagon, label: vehicle }

# Optional; each path is relative to this file's directory and defaults to the
# conventional layout shown here.
paths:
  content: assets/content
  # The asset roots' parent: `icons/`, `images/` and `audio/` sit directly under
  # it, and the content tree beside them.
  assets: assets
  # Vendored foreign manifests, read by `links`. Inbound.
  manifests: assets/manifests
  # Where `manifest` writes this package's own. Outbound, and a build artifact.
  manifestOut: build/manifests
  # Where `content-index` writes this package's note index. Derived and
  # disposable — never a source, and never inside `stage`.
  contentIndex: build/content-index
  packJson: build/packs-json
  stage: build/stage/packs
  unpack: build/tmp/packs

# The one pack list. `packDirectories` and the manifest's `packs` array are both
# derived from it, so order it for a reader browsing compendiums — the compile
# order is worked out separately, from what each pass reads (see "Declaration
# order is presentation" below).
packs:
  - { name: items, type: Item, label: Items }
  - { name: journals, type: JournalEntry, label: Journals }
  # A companion is written by its parent's pass rather than one of its own.
  - name: scenes
    type: Scene
    companions:
      - { name: adventures, type: Adventure }

  # A pack whose per-document JSON is already built — checked in rather than
  # generated. `prebuilt` names where it lives, generation is skipped for it,
  # and `cleanPackEntry` and the Scene/Level integrity check still run. It may
  # not carry `companions` or `default`, and may not be a companion:
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

# How much of the package reaches the web, plus the address scheme both
# `manifest` and `site` derive addresses under. `site` is a mode, not a
# boolean: `homepage` (the default) publishes the authored homepage and no
# other page; `content` publishes it plus every page the tree compiles to, and
# is also what builds the book.
publish:
  site: content
  address:
    prefix: kb/

# How this repository frames the website `content-build site` publishes.
# Framing only: addresses come from `publish.address` above.
site:
  assets: https://cdn.heroiclands.org
  description: The rules, the setting, and the reference material.
```

The loader validates the document, resolves every path against the directory
the file sits in, fills the optional halves with their defaults
(`skipDirectories: []`, `packageBuild: {}`, the conventional `paths` and
`publish.site` at its `homepage` floor),
derives `assetRoot`, `packDirectories`, `itemTypes` and `docEntryTypes`, and
freezes the result. A malformed configuration throws a `TypeError` naming the
offending field — and the line and column it was written on, in the
[located form](#diagnostics) — so it fails at load rather than as an empty pack
much later.

**Four values are derived rather than authored**, because each is something a
file can be asked for rather than told:

| Field                 | Derived from                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `rootDir`             | the directory the configuration file sits in                                                                                      |
| `foundryPackage`      | the `name` of the adjacent `package.json`, verbatim                                                                               |
| `stats.systemVersion` | a **system**: that `package.json`'s `version`. A **module**: the `verified` version of the system it declares a relationship with |
| `itemBuilders`        | the named registry (`sohl`) — or a list of names — required lazily so importing costs nothing                                     |

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

### A package that compiles nothing

`packageKind: documentation` is the answer "not a Foundry package at all". It
publishes a website and the book built from the same notes, and compiles no
compendium: nothing is installed into a Foundry data directory, so there is no
manifest, no pack and no document.

```yaml
contentPackage: toolkit
packageKind: documentation

# Required, and `content`: publishing the tree is the whole of what this kind
# does. `homepage` would leave one authored page, no book and nothing compiled.
publish:
  site: content
  address: { prefix: guide/ }

packageBuild:
  manifest:
    title: The Toolkit

pdf:
  title: The Toolkit
  document: book.yaml
  fonts: { serif: Libertinus Serif }
```

`contentPackage`, `paths`, `skipDirectories`, `icons`, `site`, `pdf` and
`packageBuild` mean exactly what they mean anywhere else. **Every key that
describes a Foundry package is refused**, by name, with the line and column it
was written on — `packs`, `itemBuilders`, `docs`, `compatibility`,
`relationships`, `systems`, `requiresSystem`, `stats` and `foundryPackage`:

```text
package-build.config.yaml:7:1: error: package-build config: `packs` is refused in a `documentation` package, which compiles no compendium, so there are no packs to declare.
```

A key that cannot mean anything in this shape fails at load rather than being
read and ignored, which is the difference between a configuration that is wrong
and a build that is quietly wrong.

What follows from the kind:

- **`foundryPackage` is not derived.** For every other kind the loader reads it
  from the adjacent `package.json`; there is no Foundry package here to carry an
  id, so `foundryPackage` and `assetRoot` are both `null`. A note's `img:`
  therefore names a `/`-rooted path or a URL — a pathname this package would
  have to serve itself is refused, because Foundry serves no files for a
  package it does not install.
- **`package-build manifest` refuses**, rather than emitting a `module.json`
  advertising an installable package with no id, no packs and no compatibility
  range. So does `content-build package compile`, which would otherwise exit 0
  having compiled nothing.
- **Notes need no `id:`.** An id is derived from a note's address, and a
  hand-assigned one is only ever a pin for a document that already shipped —
  which needs a compendium, and there is none.
- **The note vocabulary is `doc` and `homepage`.** Every other type exists to
  become a Foundry document, so a note carrying one has no destination;
  `content-build lint` reports it at its `type:` line.
- **A content index is still published.** `content-build content-index` emits
  `<contentPackage>-metadata.jsonl` exactly as it does elsewhere, so another
  package can resolve an address into this one and a wikilink from its notes can
  reach a page here.

### A note's package is the repository's, not the note's

`contentPackage` is the **address namespace** every note in the tree is
published under: the first segment of every canonical key, the name of the link
manifest this build emits (`sohl.json`), and the package a cross-package
wikilink writes to reach one of these notes. It is the repository's identity in
the address space — not a filter — and a note does not restate it.

A canonical key has four segments, read by position:

```text
<package>-<system>-<type>-<shortcode>
```

`<system>` is a game system this toolchain compiles for — `sohl` or `hm3` — or
the literal `none` for a document no game system defines: a JournalEntry, a
Macro, a Scene, and an item's documentation journal, which is `none` however
many system blocks the item itself carries. The registry of permitted values is
`engine/systems.mjs`, and `none` is a **word** on purpose: `any` would read as a
wildcard, which is the opposite of what it says, and a YAML null (`null`, `~`,
an empty value) parses to an absent value and drops the segment altogether. So
`sohl-none-doc-gear`, `sohl-sohl-skill-clmb` — the package and the system are
independent slots that may hold the same word, because Foundry requires a system
package's id to _be_ its system id.

Because it is a segment of an address, the value is **validated** rather than
taken as written, and a violation fails the build naming the line it is on:

- **Lowercase alphanumeric** (`^[a-z0-9]+$`). An address is read by counting
  hyphen-separated segments, so the hyphen has to be purely a separator — which
  is why `harn-adventures` is configured as `harnadventures`. This is the same
  rule `shortcode` is already held to, and the two are one constant.
- **Not a note type.** A written address is a _partial_ one — the shorter forms
  drop segments from the left, so `skill-clmb` and `sohl-skill-clmb` are both
  addresses — and position alone therefore no longer says which vocabulary a
  leading segment is drawn from. The reader settles that by asking whether the
  name is a known package, so a name belonging to both vocabularies makes one
  target readable two ways with no defensible pick. The package and the type are
  no longer _adjacent_ segments now that the system sits between them, and that
  changes nothing: the hazard was never adjacency, it is that a short form omits
  the slots in between. `doc`, `being`, every map type, and every item type this
  repository declares — with its `doc`-prefixed documentation form — are
  refused.

```text
package-build.config.yaml:1:1: error: package-build config: `contentPackage` is `harn-adventures`, which is not lowercase alphanumeric (^[a-z0-9]+$). It is the first segment of every address this package publishes (`harn-adventures-<system>-<type>-<shortcode>`), and an address is read by counting hyphen-separated segments — so anything outside that here makes those addresses unreadable rather than merely ugly. `harn-adventures` became `harnadventures`.
```

**`package:` in a note's frontmatter is retired, and declaring it fails the
build**, naming the file, whatever the value says. An agreeing declaration is
refused exactly as a disagreeing one is: there is no value that makes writing
the field correct. The diagnostic says so, and says where the value comes from
instead:

```text
assets/content/Gear/Axe.md:12:1: error: `package: sohl` is a retired frontmatter field — delete it. A note's package is this repository's configured `contentPackage` ("sohl", in package-build.config.yaml), and every note in the tree belongs to it.
```

`content-build lint` reports every such note in one pass; `content-build
package compile` and `content-build content-index` refuse the tree.

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
  stats: { lastModifiedBy: "…" },
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
- **A default is per system, not merely per type**. The rule above counts
  every pack of a type together, so a tree shipping one Actor pack per system has
  two and would need a flag — except that asked _per system_ the layout is
  unambiguous, one pack each, for the same reason a single-pack type needs no
  flag. And a system is never answered with another system's pack: a type-wide
  default declaring `system: sohl` does not route the HM3 document, which
  otherwise had that pass see a pack name that was not its own and skip every
  note in the tree without a word.
- **A `pack:` naming another system's pack** is refused where the _block_
  declares it — `hm3.pack` says where the HM3 document goes, so naming a SoHL
  pack is a contradiction, reported naming the note and the pack. At the top
  level it is no contradiction: the shared position is the value a note states
  once for every system, and a system-specific pack cannot be that value, so it
  simply does not answer for the other system, which falls through to its own
  default.
- **A `pack:` naming no configured pack is a build error**, not a fall-through to
  the default. A typo'd name that quietly landed content in the wrong compendium
  would be silent partial compilation — the failure mode this toolchain's guards
  exist to eliminate. The same applies to a name that belongs to a pack of
  another document type, or to a companion (no note is ever routed into one).
- **A note's `pack:` names where its _own_ document goes.** Anything derived from
  it — an item's or a macro's prose, which compiles into a JournalEntry of its
  own — lands in the default pack of _that_ type.
- **Every document a note produces needs a pack, and one that has none is a
  finding**. A note produces more than one document as a matter of
  course: an item note an Item and the JournalEntry its prose becomes, a map
  note a Scene and a JournalEntry, an actor note an Actor and a JournalEntry
  too. Where the configuration declares no pack for one of them, that
  document would be dropped while the rest of the note compiled into a pack
  that does exist — a build that succeeds and ships half of what was written.
  The finding names the note, the class with no pack, and the class that did
  compile, which is what distinguishes it from a note **nothing** claims: that
  one is a `type:` to correct, this one a pack to declare.

  It is asked **per note, not per type**, because documentation is: `Journals`
  declines a doc-carrying note whose body is empty — an item with no prose gets
  no doc — so a tree of deliberately description-less items loses nothing by
  having no JournalEntry pack, and is told nothing. And it names no system, so a
  type one system maps and another does not stays silent for the system that
  declines it.

- **`pack: none` compiles the note into no document, on purpose.** The note is
  walked, published as a page, present in the content index with an address
  and no UUID, and addressable by wikilink; every pass passes over it without
  a finding, and the finding above says nothing about it. It is accepted only
  on a type whose sole document is the JournalEntry its prose becomes — a
  `doc`, say — and refused by name on a type that compiles an Item, an Actor,
  a Macro, a Scene or an Adventure, where it would drop that document. A
  configured pack may not be called `none`. This is how a page of developer
  documentation lives in the content tree beside everything else: it is a
  note like any other, and it reaches no compendium.

**The configuration is found by walking up from the working directory, and from
the installed package only if that finds nothing.** `engine/pack-config.mjs`
climbs from `process.cwd()` first, so a build reads the tree it was run in —
from the repository root, from `packages/`, from anywhere below, since the walk
climbs. Climbing from the module itself is the fallback, for an invocation from
outside any repository.

The order matters in one shape: a git worktree nested under its parent checkout
with **no `node_modules` of its own** resolves `@heroiclands/package-build` out
of the parent's, because Node's resolution walks parent directories. Climbing
from the module then landed on the _parent's_ configuration, and the build
compiled the parent's content tree into the parent's `build/` and exited 0
. When both walks find a configuration and they disagree, the working
directory's is read and the ignored one is named in a warning — that
disagreement is also the cheapest signal that this tree is building on another
checkout's `node_modules`. Run `npm ci` in the worktree to give it its own.

Set `PACKAGE_BUILD_CONFIG` to point at the file explicitly if a consumer keeps
it somewhere else; it skips both walks.

**The configuration is resolved on first read, never at import.** Every module
here can be imported — and `content-build --version` and `--help` answered — in a
directory with no `package-build.config.yaml` and no Foundry package manifest, so
a consumer can reach for one pure helper (`engine/content-address`,
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

**Every note compiling into a system-bearing document carries documentation, and
that includes actors**. `docEntryTypes` is `itemTypes` plus the actor
types the shipped subtype maps declare (`ACTOR_TYPES`, derived from them rather
than listed again), plus `macro` and the map types. Only `doc` is outside it, for
the reason that actually applies to it: its single document _is_ the prose.

A being therefore has the same two addresses an item has — `<pkg>-<system>-being-<shortcode>`
for the Actor and `<pkg>-none-docbeing-<shortcode>` for the page — where before
it had only the first, and was the one system-bearing note a prose link could not
name.

**An actor keeps its prose inline as well, and that asymmetry is deliberate.** An
item's description is an `@UUID` pointer into its journal, because one item is
embedded across hundreds of beings and baking long prose into every copy bloats
the compendium by the length of the text times the number of carriers. An actor
is singular, so the same indirection costs a reader a click and saves nothing:
`system.appearance` and `system.dossier` stay as rendered prose.

The Item compiler **dispatches through that same resolved table**, via
`engine/item-registry.mjs` (`itemTypes()` and `itemBuilder(type)`), so the types a
consumer's notes are accepted for and the builders they compile with are one
object. Supplying `itemBuilders` is therefore all a consumer does to define an
item type of its own; a table this package ships is one possible value, not the
one the compiler holds.

**A tree feeding two systems declares a set of registries.** One registry is
also a ceiling: the accepted vocabulary is its keys, so a type only the _other_
system knows — `spell` and `invocation` are HM3's, `mysticalability` is SoHL's —
cannot be accepted at all. So `itemBuilders` takes either form:

```yaml
itemBuilders: sohl # one registry, and what every existing configuration says
itemBuilders: [sohl, hm3] # a set; the vocabulary is their union
```

A registry's **name is the system it belongs to**, which is what lets a data
configuration declare a set without naming each system twice. In an `.mjs`
configuration the same set is written out:

```js
itemBuilders: [
  { system: "sohl", builders: SOHL_ITEM_BUILDERS },
  { system: "hm3", builders: HM3_ITEM_BUILDERS },
],
```

A type **both** registries declare — `skill` is one name over two data models —
keeps a builder on each side. `itemBuilder(type, system)` and `itemArt(type,
system)` take the system that is asking; asking without one, for a type more
than one registry declares, **throws** rather than answering with whichever was
declared first.

**`hm3` is a real registry, and the rest of the pipeline follows the same
field.** This package ships two system halves, `sohl/` and `hm3/`,
each with its own builders, its own default art and its own note-type →
document-subtype map; they share the engine between them and import nothing from
each other. A pack's `system:` is what selects among them — the Item and Actor
compilers, the item catalogue a being resolves against, the published
`schema.json` its emissions are checked against, and the `_stats` stamp all read
that one field — so declaring one Item pack and one Actor pack per system is the
whole of the configuration a dual-system tree needs:

```yaml
itemBuilders: [sohl, hm3]
systems:
  sohl: { compatibility: { verified: "0.9.0" } }
  hm3: { compatibility: { verified: "1.6.3" } }
packs:
  - { name: items-sohl, type: Item, system: sohl }
  - { name: items-hm3, type: Item, system: hm3 }
  - { name: actors-sohl, type: Actor, system: sohl }
  - { name: actors-hm3, type: Actor, system: hm3 }
```

**The `systems:` block is required here, not decorative.** A pack's `system:` is
what its documents are stamped `_stats.systemId` and `systemVersion` from, and
the version can only come from that block — or, for a package whose packs are
all for its own system, from the package-wide stats. A pack naming a system that
resolves to neither is refused at configuration time, naming the pack and the
entry to add. Falling through and stamping `null` for both is a plausible lie:
a pack whose configuration says `system: sohl` on the line above ships every
compiled actor with no system at all.

No `default: true` anywhere, because each system has exactly one pack of each
type and a default is resolved per system. Marking one is still allowed and
still means what it says — it designates that _system's_ default where a system
has several packs of a type.

A note carrying both a `sohl:` and an `hm3:` block then compiles **one document
in each system**, each shaped by its own builders and stamped with its own
system version. A note carrying only one block compiles only that system's
document: the other system's pass passes over it, rather than failing it for a
block it was never going to have.

Four of HM3's rows are **one-to-many** — `mysticalability` becomes a `psionic`,
a `spell` or an `invocation`; `trauma` an `injury` or a `trait`; `weapongear` a
`weapongear` or a `missilegear`; `being` a `character` or a `creature` — and the
note says which by writing `hm3.type`. Nothing is inferred from the note's own
`subType`, and a note that says nothing is an error naming the note and listing
the permitted values.

**Configuration is the source, and the manifest is generated from it.** The
floor is the top-level `compatibility.minimum`, the id is derived from
`package.json` `name`, and `@heroiclands/package-build` writes the manifest from
this file. There is no `paths.packageManifest` pointing at a hand-authored
`system.template.json` for a package-id guard or a `_stats.coreVersion` stamp to
read out of.

### Declaration order is presentation, not compile order

`packs:` is the manifest's `packs` array as well, so a consumer orders it for a
reader browsing compendiums. It is **not** the order the passes run in, and it
does not have to be: the compile order is derived from what each pass reads.

One pass reads another's output today. The actors pass resolves each being's
embedded items against the JSON the item passes wrote — a being names an item by
`(type, shortcode)` and never by the pack it ships in, so **every** Item pack has
to be compiled before the Actor pass, not merely the first. A compiler states
that on itself:

```js
export class Actors extends BasePackCompiler {
  static readsPackOutputOf = Object.freeze(["Item"]);
}
```

The generator schedules each pass after the packs of every type it names, and
does so with the **smallest** reordering that works — the earliest declared pass
whose dependencies have all run goes next. A list already in a workable order is
therefore compiled exactly as declared, and one that is not moves only the
passes that had to move. When the two orders differ the build says so:

```text
[INFO]: Pass order: characteristics, mysteries, characters — a pass that reads
        another's output compiles after it, whatever order `packs:` declares.
```

This is not the author's problem, and it would be a nasty one: an Actor pack declaring
first compiled only where an earlier run had already left `build/packs-json`
populated. `build/` is gitignored, so it was green on every local tree that had
built once and exit 1 on every fresh checkout and CI runner, over a message that
named a missing directory rather than the ordering that caused it. A
consumer registering a compiler of its own declares its dependencies the same
way; a type no pack of which is declared is simply not waited for.

**Compiling one pack by name is the case ordering cannot answer.**
`content-build package compile <name>` runs the pass you asked for and no other,
so a dependency that is neither in the run nor already on disk is reported
rather than ordered around:

```text
error: pack "characters" (Actor) reads the compiled output of the Item pack
       "characteristics", which this run does not compile and which
       build/packs-json/characteristics does not hold — compile the whole
       package, or compile "characteristics" first
```

### An item type's default art

A note that names no art gets its type's **default art**, and a type declares
that art in the same place it declares its builder. An `itemBuilders` entry may
be written two ways:

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
same `resolveImg` rule as a note's `img:`, so one spelling means one thing
wherever it is written.

#### A pathname names the package that owns the file

Every authored pathname — a registry `img:`, a note's `img:`, an actor's
`data.portrait:`, a map's background, the address of an image in a body —
answers "which package holds this file?" in its **first segment**, when an
`assets/` follows it. Everything after that `assets/` is the _suffix_, and a
pathname that does not open `<package>/assets/` belongs to the package being
compiled, whole.

Four surfaces derive an address from that one statement. For a `thalorna` note
— the package Foundry installs as the module `sohl-thalorna` — writing
`images/map.webp`:

| Surface     | Address                                                  |
| ----------- | -------------------------------------------------------- |
| **Foundry** | `modules/sohl-thalorna/assets/images/map.webp`           |
| **Local**   | `assets/images/map.webp`                                 |
| **Web**     | `https://cdn.heroiclands.org/thalorna/images/map.webp`   |
| **Book**    | `assets/images/map.webp`, staged beside the Typst source |

`sohl/assets/icons/relic.svg` names the `sohl` package's file wherever it is
written, which is what lets a module pair a SoHL default with one of its own
types. The package's name is not its Foundry id: `thalorna` is the content and
`sohl-thalorna` the install, and only the Foundry form carries the second.

The web host is `site.assets`, and a package-owned image on a page with none
set is an error naming that key.

**The rule is about ownership, not a list of directories.** A package owns its
whole `assets/` tree, so a directory this toolchain has never heard of is still
that package's: art under `assets/artwork/` is addressed `artwork/deity.webp`
and resolved exactly as `icons/…` and `images/…` are. An address naming no
package at all — an absolute URL, a `data:` URI, a `/`-rooted path — passes
through on every surface, on the same rule rather than as an exception.

**A `systems/…` or `modules/…` pathname is refused**, with a finding naming the
replacement: it resolves for Foundry and for neither of the other surfaces, and
deriving anything from it would put a wrong address on two of the three.
`worlds/` is not such a root — a package may not ship files out of a world, so
that path gets the ordinary reading and produces a plainly broken one rather
than a plausible one that 404s unreported.

A `documentation` package installs nothing, so it has no Foundry form to derive
and addresses another package's file by a `/`-rooted path or a URL.

**`banner:` is a path that does not follow this rule.** It reaches no compiled
document and no book; it is a top-level key the Hugo theme reads, and the theme
prefixes a relative value with `images/` and joins it onto
`params.cdnBaseURL`. The two address different places — a pathname a file a
package ships, `banner:` a hero image on the site's own asset host — so they are
stated apart rather than reconciled. See the
[content format specification](docs/content-format.md#banner-addresses-the-cdn-not-the-foundry-install).

#### "Names no art" and "wants no art" are different

A note has two ways to leave `img:` empty, and they mean opposite things:

| a note writes  | it means                             | it compiles with |
| -------------- | ------------------------------------ | ---------------- |
| nothing at all | _unset_ — name me no art             | the type default |
| `img: null`    | the same thing, said out loud        | the type default |
| `img: ""`      | _blank on purpose_ — I want no image | no image         |
| `img: <path>`  | this art                             | that path        |

`resolveImg` returns `null` for the first two and `""` for the third, and every
caller pairs its default with **nullish** coalescing — `resolveImg(fm.img) ?? itemArt(type)`.
Never `||`: that collapses a deliberate blank back into the default and takes the
distinction away again.

**`portrait` is the same field twice over.** A being carries `img` (its token
art) and `portrait` (its sheet portrait) independently, and both resolve through
`resolveImg`, so the rule above is the rule for both.

This is the convention the project already holds for an optional "not specified"
DataModel string — `nullable, initial: null`, so "unset" is one honest value
rather than two.

> **The rule is `img`'s, and does not extend to `title`.** `title` is not art
> and never reaches `resolveImg`, so nothing here applies to it.
>
> The field declares `topLevelMeans`, so the top-level key is not a source for
> an `affiliation` item's `system.title`. Were it one, a single authored key
> would feed two unrelated destinations that disagree about what empty means,
> and `title: null` would stringify into the compiled document as the literal
> `"null"`.
>
> So `title: null` is a note declining to state a heading, and the site emitter's
> `fm.title ?? name` falls back to `name.full`. `title: ""` publishes a
> deliberately blank heading and is warned about on its own account — as the
> page's heading, not as an art path.
>
> **That warning reads the note's top level only.** The two spellings still name
> unrelated quantities, so a `sohl.title` — the office's style of address — must
> not answer for the page's heading. Twenty-eight `sohl-kethira-basic`
> affiliations write `sohl.title: ""`, meaning an office with no style of
> address, and every one of them was reported as publishing a blank heading
> until the check honoured the declaration.

Because `""` reads as "unset" elsewhere, a note carrying that spelling has
quietly changed meaning, and the frontmatter lint says so — for either art
field:

```
Note.md:9:1: warning: `img: ""` means "ship no art at all" — it no longer falls
back to this type's default. Write `img: null` for a note that simply names
none; keep `""` only where the document is meant to have no image
```

A warning, not an error: the note still compiles, to a document that is merely
iconless.

**A type with neither is a build error, deliberately.** When a note names no
art and its type pairs none, the pack build aborts rather than shipping an
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
defaults are one list and cannot drift. Pairing art with the
builder instead moves it onto the seam a type is _already_ declared through, and
costs the `sohl` package nothing: `ITEM_BUILDERS` reads each entry's image out of
that same map, so there is still exactly one map — and the drift a test used to
watch for is now unrepresentable, because building the registry throws if a type
has no art.

## The per-system block

A note is **system-agnostic**. The only system-specific things it carries are
the properties named after a system, and one note may carry more than one — a
`being` in `harn-ensemble` compiles into a SoHL `being` _and_ an HM3
`character`. Within a system's block:

| property           | maps to                                                       |
| ------------------ | ------------------------------------------------------------- |
| `<system>.system`  | `document.system` — the DataModel schema, verbatim paths      |
| `<system>.type`    | `document.type` — the subtype the note compiles into          |
| `<system>.img`     | `document.img`                                                |
| `<system>.items`   | `document.items` — actors only                                |
| `<system>.effects` | `document.effects`                                            |
| `<system>.flags`   | `document.flags`                                              |
| `<system>.pack`    | _nothing on the document_ — a build directive naming the pack |

Everything else a system declares sits directly under the block. `kbcat` is
toolchain vocabulary, and the _generators_ `items` and `attributes` expand into
embedded documents rather than mapping anywhere, so neither has a `system` path
to be written at.

`templatePriority` is the one key of this shape that _is_ a field, and it is
**shared rather than per-system**: its home is `data.templatePriority`, and it
reaches `sohl.system.templatePriority` and `hm3.flags.hm3.templatePriority` —
exactly as `portrait` reaches two differently-named fields from one shared
property. A number is a template at that priority, `null` is not a template, and
absent is an authoring error. The legacy in-block and top-level
positions are still read, in that order after `data:`, so a tree sweeps on its
own schedule; `archetype` is the retiring spelling of the same field, still read
last but **refused by the frontmatter linter** — a priority and the `archetypes`
a being fits are different things, and one letter is not enough to tell them
apart.

```yaml
type: being # the content type — system-agnostic
pack: actors # shared: unless a block says otherwise
portrait: kaldor.webp # shared: reaches both systems' fields, differently named
data:
  templatePriority: 1 # shared: → sohl `system.`, hm3 `flags.hm3.`
hm3:
  type: character # this system's document subtype
  pack: actors-hm3 # overrides the shared one, for HM3 only
  system: # → document.system, verbatim
    species: human
    sunsign: ulandus
  attributes: { str: 10, sta: 14 } # a generator, not a system field
sohl:
  type: being
  system:
    currentMoveMedium: walk
```

**The shared fallback is declared, not name-matched.** `sohl.system.portrait`
and `hm3.system.bioImage` both default from one shared property, and they are
two real fields with different names — SoHL's `Actor.being` and HM3's
`Actor.character` share **no** field name at all, so a rule matching on spelling
would never fire. Each field declares its source instead, and resolution for a
system `S` is:

1. `S.system.<to>` — authored directly, wins outright;
2. `S.<name>` — the legacy in-block position, until the corpus moves off it;
3. the shared top-level property the field declares as its source, which may be
   a **dotted path** (`data.portrait`) rather than a sibling key;
4. the field's own default.

`FieldSpec.name` is that declared source. Read as "frontmatter key under
`sohl:`", which is the degenerate case where source and destination happen to
share a name.

**A spelling that means two different things skips step 3.** Because a field's
`name` doubles as its identity and as the shared property it draws from, the two
coincide only while the note vocabulary and the system vocabulary agree about
what a spelling means. `title` is where they do not. A note's top-level `title`
is _the title of the note_ — the heading its page publishes under, which the
site emitter reads. An `affiliation` item's `system.title` is _the style of
address the office carries_ — Ajaw, Warden, a person's style within the body.
They are unrelated quantities, and step 3 used to feed the second from the first
.

That was not merely untidy, because **step 3 answers without applying
`field.default`** — only step 2 does — so an authored `title: null` reached the
field's `String()` coercion unguarded and shipped as the literal string `"null"`.

So a field may declare `topLevelMeans`: what the top-level key of that name means
_instead_. Declaring it removes step 3 for that field, and the value is the
reason rather than a bare flag, so the collision is legible where the field is
declared and the generated field reference can print it. It is a per-field
opt-out, not a change to the order — step 3 is right wherever the two levels
state the same quantity, which is nearly everywhere: `subType` is the other
declared item field spelled like a note-level key, and there the two agree by
design.

**The statement is symmetric, and the frontmatter linter reads it from the other
side too.** If the two positions hold unrelated quantities, then the _in-block_
position is not the note-level field either — so a check about a note-level field
(the page's heading, an art path) reads past a block key the note's own type
claims for something else. Declaring `topLevelMeans` settles both directions at
once. Reading it for the emitted field alone is how an
affiliation's office style came to answer for its page heading.

**An exempted field is still authorable**, at the two positions that describe the
document rather than the note:

```yaml
title: The Order of the Silver Hand # the note's own heading — reaches the page
type: affiliation
subType: order
sohl:
  system:
    title: Warden # → document.system.title, the style of address
```

`sohl.title`, the legacy in-block position, works the same way. A membership — a
`title` a particular being holds — is authored on the entry in that being's
`sohl.items`, whose `system` is overlaid on the catalogue document directly.
`data.title` is neither position: `title` is not a `data:` property any note type
declares, so the frontmatter lint refuses it.

**`<system>.system` is written through verbatim**, at the DataModel's own paths,
with no renaming layer. A key the system's published `schema.json` does not
declare for the subtype the note compiles into is an **error naming the note**,
not a silent drop: Foundry discards an unknown `system` key at construction
without a word, so the alternative is a field the author wrote and nobody will
ever see. A path a declared field already writes is left to that field, so the
value goes through one coercion rather than two.

**What the compiler writes on its own is checked too.** A compiled document
carries keys no field declaration and no note ever names — `shortcode`,
`templatePriority`, `actionDefs`, `notes`, `docHtml` — because the pass writes them
itself, and they were compared against nothing: the declaration-derived check
reads `itemBuilders`, the note-side check reads `<system>.system`, and these are
in neither. A compile now reads the `system` block each pass **assembled** and
checks its keys against the same published `schema.json`, so the emitted set is
observed rather than listed and a compiler that grows a key is covered without
anyone remembering to add it. A key the schema does not declare is an error,
reported once per subtype rather than once per document, and the message says
which of two things wrote it: a `fields:` entry, which the repository can change,
or the compiler, which it cannot — that one means the build is running ahead of
the system it compiles for, and the fixes are to declare the field there or to
hold this package at a build that does not write it. A subtree the schema
declares but describes no further — a discriminated `TypedSchemaField`, stored
flat — is left alone rather than reported wholesale.

**A pack that declares a `system:` takes only notes carrying that block.** A
note that says nothing about a system has no system data, and compiling it there
would emit a hollow document — a subtype, and none of the fields the subtype
exists for. The build fails naming the note and the pack. A pack declaring no
system constrains nothing, and a pass whose document is not system data at all —
journals, macros, scenes — is not subject to the rule.

**`(type, shortcode)` resolves inside one system's catalogue.** A being names its
embedded items by address and never by pack, so the Item packs are read as one
address space; with two systems in the tree that space stops being one, because
`skill:sword` exists under both names. An Actor pass reads the Item packs of its
**own** system plus the system-neutral ones.

## Command line

```
npx content-build package <compile|unpack|clean> [pack] [entry]
npx content-build docs item-fields [--out <path>] [--title <title>]
npx content-build lint [root] [--no-references]
npx content-build content-format schema --schema <system>=<path>
npx content-build content-format notes [root] [--strict]
npx content-build links [root] [--manifests <dir>]
npx content-build format [paths..] [--write]
npx content-build markdown [paths..] [--fix]
npx content-build content-index [root] [--out <dir>]
npx content-build site
npx content-build reachability <dir> [file] [--index <shortcode>]
npx content-build addresses diff --from <zip|dir> [--strict]
```

| Command          | What it does                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package`        | Compile the content tree into LevelDB packs, unpack a shipped pack back to JSON, or clean one. See [Install](#install).                                                 |
| `docs`           | Render a generated reference from the configured registries. `item-fields` is the item-frontmatter page.                                                                |
| `lint`           | Check a content tree's addresses and its frontmatter. See [Linting a content tree](#linting-a-content-tree).                                                            |
| `content-format` | Check the content format specification itself. See [The content format specification](#the-content-format-specification).                                               |
| `links`          | Check that every link in the tree lands: dead anchors, dead qualified addresses, wikilinks in frontmatter, drifted manifests, and the package homepage's own addresses. |
| `format`         | Prettier, with the shared configuration. See [Prose: formatting and markdown](#prose-formatting-and-markdown).                                                          |
| `markdown`       | markdownlint, with the shared rule set — the structure Prettier is indifferent to.                                                                                      |
| `content-index`  | Emit this package's note index as JSON Lines. See [Publishing a content index](#publishing-a-content-index).                                                            |
| `site`           | Publish the content tree as a website. See [Publishing a website](#publishing-a-website).                                                                               |
| `reachability`   | Walk outward from an index note and report what no path reaches, for a tree meant to be navigable from one entry point.                                                 |
| `addresses`      | Report every published item address this build has stopped publishing. See [Diffing published addresses](#diffing-published-addresses).                                 |

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

Checks the three rules every note's **identity** is authored against, and reports
each finding in the located form below:

- **Shape** — a `shortcode` is strictly lowercase ASCII-alphanumeric. It is
  the identity key referenced from saved world data, and half of the
  `type-shortcode` address, whose parse needs the separating hyphen to be the
  only hyphen.
- **Uniqueness** — `(type, shortcode)` names one note. A document is addressed
  across _every_ pack of its document type, so routing two same-address notes to
  different packs with `pack:` does not separate them.
- **One front page** — exactly one note declares `type: homepage`. See
  [Exactly one homepage](#exactly-one-homepage) below.

It compiles nothing, opens no LevelDB and needs no Foundry manifest, so it runs
in about a second and can gate a commit. An empty or untyped tree **fails**
rather than passing: "every one of nothing is unique" is a vacuous pass, and it
is exactly what a tree that failed to check out produces.

What that guard reports is an **empty walk**, not an empty set of addresses. A
note may be keyless — a folder document carries no `shortcode` — so a tree of
them is populated, correct and unkeyed. That tree passes; a tree holding no
notes at all still fails. (The homepage is not the headline example, though it was once
it was addressed by the package rather than by a slug. It carries an address
like every other note now; the guard is unchanged, because what it reads
was never the key count.)

### Exactly one homepage

A content tree declares **exactly one** `type: homepage` note. Zero is an
error and two is an error, at the same severity, because they are one defect: a
package whose front page is not the page a person chose.

- _Zero_ and the package serves nothing at `/<package>/` — the failure the
  authored homepage exists to prevent, and a silent one: the site build reports
  `wrote 0 homepage(s)` and exits 0.
- _Two_ and it serves a page nobody chose. **This is a cardinality rule, and
  only that.** Both are written to the mount's `_index.md`, so the second
  silently overwrites the first: the duplicate-address check catches only the
  pair that happen to share a shortcode, and says nothing at all about a
  `homepage-root` beside a `homepage-front`. Which of the two should be the
  front page is a question nothing here can answer.

Neither has a safe default, so neither is a warning: a build that proceeded past
either would publish the wrong front page while reporting success, which is
exactly what a warning tolerates.

**Where it fires: `lint` _and_ `site`.** No single command reaches every
package — `HarnMaster-3-FoundryVTT` runs `content-build site` and no
`content-build lint`; `sohl-thalorna` runs `content-build lint` and its own site
builder — so a rule in one of them is a rule two of the six packages do not
have. Both call the same function, so there is one rule and two call sites
rather than two rules. In the site build it runs **before the output tree is
cleared**, so a failing gate cannot destroy a good site to report a bad tree.

**It does not vary by `publish.site`.** That setting chooses whether the
_content_ surfaces are published; the homepage is the floor beneath both modes.
The lint call site reads no `site:` block at all, and so could not vary by mode
even if the rule wanted to.

Zero has no file to name, so the locator is the **content root** — a real path,
and the directory the note has to be added to. No line or column is invented for
it. Two is reported once per offending note, located at its own `type:` value and
naming the other, because each note is a place an author has to open and edit:

```text
assets/content: error: holds no `type: homepage` note, so package "sohl" publishes nothing at its own address /sohl/ — a package's front page is one authored note in this tree, routed by `type:` rather than by filename
assets/content/homepage.md:3:7: error: duplicate `type: homepage` note, also declared by assets/content/Landing.md; a package has one front page, at /sohl/, and nothing here can say which of these it should be. Keep one, and make the rest ordinary notes
```

### Frontmatter, against the schema its type declares

The same command also checks that each note's `sohl:` block is what its **type**
allows. Five classes, all of them mistakes that were previously reported
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

**A place's `borders` and `routes` are checked from both ends.** A `place`
note states what it is next to and what it is reachable from as two `data:`
lists — `borders: [{ to, bearing }]` and
`routes: [{ to, bearing, mode, days, terrain?, leagues? }]` — and every value
is from a closed set: the eight bearings, `land | boat | ship`, a days scale of
`1 2 3 5 10 20 30 45 60 90 180 360`, and a terrain registry in which each
terrain names the modes that cross it. Every `to` must be the shortcode of a
place, here or in a fetched index. The other end must state the pair back —
at the opposite bearing, and for a route by the same mode in the same days.
A neighbour stating nothing is a warning naming both notes; one stating a
different bearing, mode or days is an error, as is a border to the note's own
parent or child, or a pair listed twice by one mode. Each finding lands on the
entry that states it. The keys, the sets and the days scale are specified under
`type: place` in `docs/content-format.md`.

**A settlement is held by someone.** An affiliation's `domains` names the
places it holds, and a `place` of subType `settlement`, `site` or `structure`
that no affiliation's `domains` names — in this tree or in a fetched index —
is a warning, `unheld land`, at the note's `type:` line, so a gap in tenure
shows. A region is held through its polity's `domains` and a feature by
nobody, so neither is checked.

**A settlement's market class is one of six.** `data.market` states what trade
a settlement supports — `1` a hamlet, with no market beyond what neighbours
trade among themselves; `2` a village and its weekly market; `3` a town with
several trades working full time; `4` a market town, its chartered fair and its
moneylender; `5` a city, where anything ordinary can be had in quantity; `6` a
great city that banks, imports as a matter of course, and is the market from
which the other markets buy. The numbers order the steps and do nothing else, so a value off the
scale is an error at the value that states it rather than a number rounded onto
a class the author did not write. The key is optional and the lint checks no
`subType` condition, as it checks none for `population`. The scale is stated
under `type: place` in `docs/content-format.md`.

Nothing here writes. A check reports and an author fixes.

**`content-build map` draws what those keys state.** `--tree` is the author's
check of `parents` — the containment tree, clustered by continent, with a
place no parent reaches, a parent no place declares and a cycle flagged red
and reported as findings. `--from <shortcode>` is the reader's map: the place
at the centre, north up, each neighbour at the angle of its bearing and on a
log-spaced ring of its days, a second hop drawn dimmer where the two hops
agree; `--from all` draws one for every place with a relation. `--travel` is
the whole route graph. Every drawing reads the content index, so a
dependency's places take part, and lands under `build/map/` as a `.dot`
beside its `.svg`; GraphViz draws, and is needed by this command alone. The
command and its rings are documented in `docs/commands.md`.

### The `data:` container is closed; the top level is not

A note's frontmatter has three regions, and only one of them is open:

| region           | describes                                    | an unknown key is  |
| ---------------- | -------------------------------------------- | ------------------ |
| top level        | the note as a published artefact             | passed to the page |
| `data:`          | the subject itself, whatever system reads it | an **error**       |
| `sohl:` / `hm3:` | the subject as one system's documents        | an **error**       |

**Top level is deliberately open**, for the reason the homepage rule above gives
at length: every key of it is copied into the generated page, so an
unrecognised one is a Hugo or theme parameter this build has no standing to
refuse. `description` is the everyday case — not a document field at all, but
the page's description.

**`data:` is deliberately closed**, and that is the point of having it. The
type-specific facts about a subject — a weapon's weight, an affliction's
transmission, a being's species — do not sit at the top level, where the
pass-through rule applied to them too. So a misspelled `wieght` became a theme
parameter rather than a finding, indistinguishable from a weapon that weighs
nothing. Under `data:` the same key is reported where it was written, with the
key it was probably meant to be, drawn from that type's own vocabulary:

```text
assets/content/Gear/Axe.md:14:5: error: "wieght" is not a `data:` property of a weapongear; the container is closed, so unlike a top-level key it is not passed through to the page. Did you mean "weight"?
```

**A system block is closed too, and which blocks exist is the configuration's
answer**. A package is held to the blocks named after the systems it
declares it ships for, read from the three places that already declare them:
`systems:`, a pack's own `system:`, and `stats.systemId` where neither is
written. So a package shipping for HM3 has its `hm3:` block checked and a
package shipping for SoHL its `sohl:`. Held constant at `sohl`, an `hm3:` block
would never be read at all: every key in it would be discarded at compile
without a word, while the block that _was_ checked would be named after a system
the package does not ship for.

A pack's `system:` counts because it is already authoritative at compile — a
note routed to a pack declaring one and carrying no such block fails the build —
so a lint blind to it would refuse a note for want of a block it never checked.
`harn-ensemble` declares its two systems that way and no other.

**Each block is checked against its own system's vocabulary**, and that has two
sources. A system's **`itemBuilders` registry** covers its item types: `skill` is
one name over two data models, so a key SoHL's `skill` declares is not thereby a
key HM3's declares, and a block that borrowed its neighbour's field names would
accept the one mistake this check exists to report. The **note schemas** cover
the rest — `being` above all, which is an actor type and sits in no item
registry — and they belong to one system, SoHL, because that is the vocabulary
`content-build` is built with.

A type neither source names — `mysticalability` is SoHL's, `invocation` is
HM3's — is a type that system says nothing about, and its block is left alone on
such a note rather than reported wholesale. A package that names no system at all
is system-agnostic on purpose: its packs are core document types carrying no
system data, so it has no system block and none is invented for it.

**A block whose vocabulary nothing states is said out loud.** A package
declaring a system other than SoHL and no `itemBuilders` registry for it has
nothing that can say what that block may carry, so the block goes unchecked — and
`content-build lint` reports that once, naming the system and the registry to
declare, because a check that quietly does nothing is indistinguishable from one
that passed. `harn-ensemble` is the tree that gets it today: its `sohl:` block is
checked, and its `hm3:` waits on `itemBuilders: [hm3, sohl]`.

**`subType` stays at the top level**, and is closed in its own way: a type
either declares a `subType` or does not, and a type that does declares its
values. A `weapon` declares none — SoHL distinguishes a weapon's uses by strike
mode rather than by kind — so `subType` on one is a finding; a `skill` declares
ten, so `subType: crafte` is a finding naming `craft`.

**A `type` and a `subType` are both held to `^[a-z0-9]+$`** — the same
constant a `shortcode` is held to, read rather than restated. A type is a
segment of every address — the first of the short form an author writes, the
third of the canonical `package-system-type-shortcode` — so a hyphen in one is
read back as a segment boundary nobody wrote. A `subType` reaches no address
— sections are retired — and keeps the rule anyway: it is a vocabulary term the toolchain keys
on, and one charset that holds for every term is a rule an author can state. The
rule is checked ahead of the closed-set check, which is what makes it reach a
type whose values are declared but not yet enumerated:

```text
assets/content/Beings/Folk.md:3:1: error: `subType` "common-folk" is not a well-formed subType — a subType is letters and digits only (^[a-z0-9]+$), the same charset a type, a shortcode and a contentPackage are held to. …
```

One declared value broke that rule: a `doc`'s `user-guide`, now **`userguide`**.
The old spelling was accepted for one transitional release, as a warning naming
the replacement, because an error would have redded every tree that took the
release before it had a chance to sweep. Every tree has swept, so the acceptance
is gone: `user-guide` is refused by the charset check like any other
hyphenated value, and nothing retirement-specific was left to remove.

The vocabulary lives in `engine/note-vocabulary.mjs`, one entry per note type,
taken from the content-format specification. It is note-format knowledge rather
than any system's: `data:` holds what is true of the thing, and what a system
makes of that value is declared in that system's own half.

**There is deliberately no third rule** requiring every note to repeat its own
`type-shortcode` address in `aliases:`. It would serve one reader — Obsidian, so
`[[type-shortcode]]` resolves in the editor — and no build reads it: both
resolvers parse the hyphen qualifier themselves. The field is retired.

**And the top-level field itself is now retired.** `aliases:` fed the
alias index, which is what a bare `[[Alias]]` was looked up in. That form
resolved to nothing anywhere in the corpus, while the collision rule guarding it
folded in every note's `name.full` and so decided what a note could be named
. Both are gone: every wikilink is an address, written
`[[type-shortcode|Text]]`, and declaring `aliases:` is refused naming the file
and the line.

### Writing a link: the address grammar

Every wikilink is an address, and omission runs **strictly left to right**:

```text
[[[[<package>-]<system>-]<type>-]<shortcode>]
```

So the written forms are exactly the suffixes of the canonical address:

| Form                            | Example                              | Means                             |
| ------------------------------- | ------------------------------------ | --------------------------------- |
| `type-shortcode`                | `[[skill-clmb\|Climbing]]`           | This package, any system.         |
| `system-type-shortcode`         | `[[sohl-skill-clmb\|Climbing]]`      | This package, the `sohl` system.  |
| `package-system-type-shortcode` | `[[thalorna-sohl-being-grod\|Grod]]` | Another package, fully qualified. |

**There is no `package-type-shortcode`.** Naming a package means naming the
system before the type, because the segments are positional rather than tagged.
A link into another package must therefore be fully qualified — which is the
price of a grammar that needs no vocabulary to parse.

**An omitted system is a wildcard; an omitted package is a default.** Most links
target items, which belong to a system, so a target naming none matches a note
under any of them and exactly one hit is required — two claimants is an
_ambiguity_, a different finding with a different fix from resolving nowhere. A
target naming no package means the citing note's own, so an unqualified link
resolves locally and only locally.

**`sohl` is both a package and a system**, and positional counting is what makes
that harmless: three segments name a _system_ whatever the first segment could
also have meant, and four is the full form.

**Parsing is plain segment counting**, the same rule the canonical key follows,
and it is sound because every segment is `^[a-z0-9]+$` — so a hyphen is
purely a separator. A target with five segments is not a hyphenated shortcode;
it is a name, and not an address.

**`name.aliases` is kept, and is read by nothing.** It fed the same index and
lost the same reader, but unlike the top-level list it is **reserved** — held
for a use that does not exist yet. So it is the one field in the format that is
neither retired nor consulted: no index folds it in, no rule validates it,
nothing derives a name, address or URL from it, and no build branches on it. A
note carrying one compiles, resolves and addresses exactly as the same note
without it; it rides through into a page's emitted front matter untouched,
because the emitter spreads a note's frontmatter wholesale and stripping it
there would mean referencing it. Write it if you have a use for it later —
nothing today will read it.

### The homepage is the package root, addressed like every other note

A homepage declares a `shortcode` — conventionally `root` — because that is
what a link is written with: `[[homepage-root|Read the introduction]]` is an
ordinary wikilink. It resolves to `/<package>/`, because the homepage _is_ the
package root: the site build writes it as the mount's `_index.md`, and Hugo
renders that as the `home` kind at `baseURL`. The shortcode names the page in
links; the address is the package root, and `[[thalorna-homepage-root]]` from
another package lands on `/thalorna/` for the same reason.

A homepage that declares no `shortcode` is refused, located at the `type:`
value that makes it necessary:

```text
assets/content/homepage.md:3:7: error: a `type: homepage` note declares a `shortcode`, like every other note: it is addressed as `homepage-<shortcode>`, which is what `[[homepage-<shortcode>|Text]]` is written with to reach the package's front page at `/<package>/`. Write `shortcode: root` — the front page is `homepage-root` in every package
```

`root` is a **convention, not a rule**: the address only has to be unique within
the package, which `(type, shortcode)` already guarantees, and nothing here
knows better than an author what their front page is called. What the
convention buys is one spelling shared by every tree, so `[[homepage-root|…]]`
is the same link in every package.

**Not a bare `[[homepage]]`.** With no hyphen it does not parse as an address,
so it would need a hardcoded single-token exception in the grammar.

#### `id` and `landing` are refused

Two top-level keys are refused, because neither decides anything on a page.
`id` is the Foundry document id a compendium UUID is built from, and a
homepage compiles into **no document**:

```text
assets/content/homepage.md:4:1: error: `id` decides nothing on a `type: homepage` note: it is the Foundry document id a compendium UUID is built from, and a homepage compiles into no document — it appears in no pack and in no link manifest. Delete it
```

`landing` is a card block. The homepage is a page with a body, rendered as
one, and no card block is read off it — an index of what the package
publishes is a `doc` note carrying a content table, linked from the homepage
like any other page:

```text
assets/content/homepage.md:5:1: error: `landing` decides nothing on a `type: homepage` note: the homepage is a page with a body, rendered as one, and no card block is read off it. Write the page's links in its body, and author an index of what the package publishes as a `doc` note carrying a content table. Delete it
```

That is also why a homepage states **no Foundry address**. A manifest entry is
how another package resolves a _document_; a cross-package link to a package's
front page is its bare `/<package>/` address, which needs no index.

**A named class, not an allow-list.** The documented envelope is `type` and
`shortcode`, with `name`, `title`, `description` and `banner` legitimate beside
them — but an unknown top-level key is **not** refused, and that boundary is
the decision rather than an omission. A homepage's frontmatter is emitted into
the published page, so an unrecognised key is a Hugo or theme parameter this
build has never heard of and has no standing to reject; a closed list would
make every new theme parameter wait on a package-build release. `aliases` is
not in the class either — it is a retired field, refused on every note
whatever its type.

**Where it fires: `content-build lint` only.** Unlike a rule about the shape of
the _tree_, which the site build has its own reason to gate on, this is a
_frontmatter-schema_ rule and `content-build site` runs none of them — wiring in
one type's field rule would have the site build refuse `id` on a homepage while
accepting `weight: heavy` on a weapon. The site build does refuse a homepage it
cannot address, because a link to it could not resolve otherwise, and it
reports that beside the count so the finding reaches `publish.site: homepage`
mode as well. The remaining gap is `HarnMaster-3-FoundryVTT`, which runs no
`content-build lint` at all and so receives no frontmatter finding of any kind;
that is a missing script in that repository, not a rule to duplicate one at a
time.

### `/<package>/` is the homepage, and nothing redirects

The package's own address serves the homepage directly: Hugo renders the
mount's `_index.md` as the `home` kind at `baseURL`, which is
`https://www.heroiclands.org/<package>/`. `package-build site-root` writes no
`_redirects` beside the site — and removes one an earlier build left there,
since Cloudflare Pages would apply it. Its `_headers` suppress indexing on
every host-assigned address and nothing else: no `Cache-Control` is pinned on
the prefix root, because a lifetime on the homepage would hold a stale copy at
the most-linked address after a deploy. The same command then indexes the
rendered pages for search into `<package>/pagefind/`, served with the rest of
the site; `site.search: false` skips it.

### The homepage's own links

The homepage is the page a reader arrives at, and it is the one page no
wikilink resolver reaches: a homepage is published verbatim in every
publishing mode, so its links are markdown links in its body, and `links`
audits them. A body link is emitted as written and resolved by the browser
against the homepage's own address, which _is_ the package root, so a
package-relative one (`kb/rules/`) lands where a reader expects.

Three findings, and each one names the form to write instead:

| Finding                      | Why                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------- |
| A **retired content type**   | `kb/creature/` when `creature` became `being`. The engine knows what was retired. |
| A **hardcoded absolute URL** | Into this package's own prefix, or into one a fetched index names.                |
| A **wikilink**               | Nothing resolves one here: a homepage is published verbatim in every mode.        |

That last one is why a homepage does **not** get the wikilink resolution every
other note body gets. In `homepage` mode the content tree is never walked, so
there is no index for a wikilink to resolve against — and giving the page one
would make the mode depend on exactly the machinery its licensing fence exists
to not build. So a homepage addresses the web the way the web does, and a
wikilink on one is reported rather than resolved.

**What is checkable, and what is not.** Only an address into this site is, and
only against facts the build already holds — the retired-type table and the
package prefixes a fetched index names. Two things are deliberately not
attempted:

- **Whether an external URL answers.** There is no network at build time, and a
  build must not go red because a third party is down.
- **Whether a live in-site address names a page that exists.** Several surfaces
  a homepage routes to are produced by other tools entirely — generated API
  documentation, say — so this build does not hold the set of published pages
  and would report a working link as dead. A bare `/<package>/` names another
  package's front page and needs no index: it is left alone because it cannot
  be improved.

## The content format specification

`docs/content-format.md` is the contract this package honours: how a note
becomes a Foundry document and a web page. Three frontmatter regions, a note
vocabulary with its own `type` and `subType`, a declared map onto each system's
document fields, the precedence between a shared source and a system's override,
and the wikilink address grammar.

**It does not define the `sohl:` or `hm3:` schemas.** Each system defines its
own, and its published `schema.json` is the authoritative statement of it. The
format says which shared source feeds which system field; what fields exist, and
what they mean, belongs to the system.

That makes a mapping row **checkable rather than declarative**, and two commands
check it. Both read the document's own tables, so editing the specification
changes what they assert — a transcribed copy would be free to drift from the
prose the moment either was edited, which is the failure they exist to prevent.

### `content-format schema` — the specification against a published schema

```bash
npx content-build content-format schema --schema sohl=./schema.json
```

Every `system.*` target the document names must appear in the naming system's
published `schema.json`, in the `version: 1` shape `package-build schema` emits.
A target no schema declares is an error naming the note type, the field, the
system and the version it was checked at — because a field may be perfectly well
defined on the system's `main` and simply unreleased, and that is the difference
between "the specification is wrong" and "the schema has not caught up".

A target is resolved against the **union** of the system's document subtypes.
The mapping tables say which field a shared source reaches; _which subtype
receives it_ is the note-type → subtype map, which does not exist yet — so the
question asked is the one that can be answered honestly today, and it narrows to
the subtype when that map lands.

`--schema` is repeatable and takes `<system>=<path>`, because a consumer holds
its system's artifact and this repository holds a committed fixture, and neither
arrangement should have to pretend to be the other. A system the document maps
onto but no schema was supplied for is reported as **unchecked**, with a count:
HM3 publishes no artifact today, so that is the ordinary case for a fifth of the
claims, and a check that skipped them in silence would read as one that passed.

### `content-format notes` — a content tree against the declared vocabulary

```bash
npx content-build content-format notes            # the configured `paths.content`
npx content-build content-format notes --strict   # and fail on what it finds
```

Measures every authored note against the per-type `data` tables, and counts the
findings by class:

| class                   | what it means                                                         |
| ----------------------- | --------------------------------------------------------------------- |
| `unknown-type`          | the format declares no `### type:` section for this note's `type`     |
| `unknown-data-key`      | a key in `data:`, which is closed, that the type does not declare     |
| `top-level-data-key`    | a declared `data` property written at top level instead               |
| `system-block-data-key` | a declared shared source written straight into a `sohl:`/`hm3:` block |

**It reports; it does not fail.** Every authored note predates the format, so a
failing check would be red in every repository on the day it lands and would
stay red for the length of the migration — which is a check nobody can act on
and everybody learns to skip. The counts are the migration's progress bar
instead, and each class is promoted to fatal, by turning `--strict` on, as it
reaches zero.

What it deliberately leaves alone is a key inside a system block that the format
says nothing about. Those regions are closed against _the system's_ schema, not
against this document, and `content-build lint` already checks them against the
declared fields.

## Prose: formatting and markdown

```bash
npx content-build format             # check the whole repository
npx content-build format --write     # rewrite what is not formatted
npx content-build markdown           # lint every markdown file
npx content-build markdown --fix     # apply the fixes markdownlint can make
```

Two conventions every content repository writes to, declared once here so a note
formatted in one is formatted the same way in the next:

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

**A default that says when it is not in force.** Because a local config wins
wholesale rather than merging, the conventions above otherwise hold by convention
alone: a `prettier.config.mjs` that spreads `PRETTIER_BASE` without the `**/*.md`
override reindents every note at 4, and a partial `.prettierrc` such as
`{"tabWidth": 2}` silently discards `printWidth: 100`, `trailingComma` and the
rest. So every `format` run first names, as warnings, each shared convention this
repository resolves differently:

```text
prettier.config.mjs: warning: markdown `tabWidth` is 4 here; the shared configuration says 2
.prettierrc: warning: `printWidth` is not set here, so Prettier's own default applies; the shared configuration says 100
```

A repository with **no** Prettier config is warned too, and it is the sharper
case: the shared conventions then reach this command and nothing else, so an
editor's format-on-save and a bare `npx prettier --check .` apply Prettier's own
defaults to the same tree and the two take turns rewriting the same lines. The
fix is the one-line re-export below.

None of this fails a run. A deliberate local choice still wins — it just stops
being silent.

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

## YAML: frontmatter, and every YAML file

```bash
npx package-build yaml                     # every YAML file git would consider
npx package-build yaml assets/content      # or just these paths
```

Frontmatter carries a note's type, its shortcode, its address and the system
blocks a document is compiled from — and until this command existed nothing
checked it _as YAML_.

**Worse than unchecked: a parse failure unmade the note.** `parseMarkdownFile`
caught the error, logged it at `warn`, and returned `{frontmatter: null}` — which
is not a note with bad frontmatter but, to every pass downstream, _a file with no
frontmatter_. It was skipped by the compiler, the linter, the link checker and
the index, and the build reported success. A duplicate key did not fail anything;
it removed a note from the corpus. The parser had detected it all along.

**Frontmatter is linted through an ESLint processor** — the mechanism
`eslint-plugin-markdown` uses for fenced code blocks. Frontmatter is its easy
case: the block is always at the top of the file, so a finding maps back to the
line it came from with a constant `+1` for the opening `---`, and nothing after
the closing `---` is read as YAML.

The rule set is **deliberately narrow**, for the same reason `markdown`'s is.
Prettier already owns YAML's whitespace, quoting and line breaks — including
inside a frontmatter fence — so a rule about any of those would duplicate the
formatter or fight it. What is left is the class a formatter cannot see: text
that parses to something other than what it looks like.

| Reported                              | Why it is not a matter of taste                                |
| ------------------------------------- | -------------------------------------------------------------- |
| a parse error                         | A duplicate key, a tab indent, mis-aligned mapping items.      |
| `yml/no-empty-mapping-value`          | `folder:` and `folder: null` are one value and two statements. |
| `yml/no-irregular-whitespace`         | A non-breaking space is invisible and part of the value.       |
| `yml/no-empty-key`, `-empty-document` | A fence or a file that parses to nothing at all.               |

`folder:` and `folder: null` read as opposites — a decision, or a key somebody
began and did not finish — so the distinction is drawn where the text still
exists. **A key with a block under it is not empty**: `name:` followed by an
indented mapping, or by a sequence at its own indent, is an ordinary container.

**GitHub workflows are exempt from the empty-value rule.** `on:`, `push:` and
`workflow_dispatch:` carry their meaning by being present, and writing
`push: null` to satisfy a linter would be worse YAML, not better. A real error in
a workflow is still reported.

**The files are the ones git would consider** — `--cached --others
--exclude-standard`, tracked plus untracked-and-not-ignored, the same set
`gitignore: true` gives the markdown linter. Untracked is included so a note is
linted while it is being written rather than only once it has been staged.

**A consumer needs no ESLint.** This ships as a command, not as a configuration
to adopt: there is no `eslint` dependency to add, no `eslint.config.js` and no
rules to declare. A repository that _has_ an ESLint of its own keeps it untouched
and unconsulted — the run sets `overrideConfigFile: true`, so no config file is
looked for at all.

## Publishing the content index

Every package emits one file naming every note it publishes:

```bash
npx content-build content-index         # the configured tree and output directory
```

`<contentPackage>-metadata.jsonl` holds one JSON record per line, keyed by the
canonical `package-system-type-shortcode` address and carrying every address
that note has: its `address.slug` on the web, a `foundry.<system>.uuid` in
Foundry, the `anchors` its named sections compiled to, and a `documentation`
pointer where an item's prose compiles into a JournalEntry of its own.

**This is the artifact other packages resolve your addresses through.** It is
advertised in the emitted `system.json` / `module.json` as
`flags.metadataUrl` — derived, version-pinned, and not something you write down
— and published as a release asset beside the manifest and the `.zip`.

| Setting              | What it decides                               |
| -------------------- | --------------------------------------------- |
| `contentPackage`     | The package emitted, and the file's name.     |
| `foundryPackage`     | The package every emitted `uuid` names.       |
| `paths.content`      | The tree walked.                              |
| `paths.contentIndex` | Where the file lands (`build/content-index`). |

**Both addresses are optional, independently.** A note that compiles into no
document states no `foundry` block, and a package that ships compendiums and
publishes only a homepage serves no page at its addresses. Neither is an error,
and neither is guessed: inventing the missing one asserts a target that does not
exist, which is the silent dead link this whole mechanism exists to prevent.

## Resolving another package's addresses

Declare what you depend on, and fetch it:

```bash
npx content-build deps fetch                    # every declared dependency
npx content-build deps fetch --from ../sohl     # from a local build, unreleased
```

```yaml
relationships:
  systems:
    - id: sohl
      type: system
      manifest: https://github.com/HeroicLands/Song-of-Heroic-Lands-FoundryVTT/releases/latest/download/system.json
      compatibility: { minimum: "0.8.0", verified: "0.8.2" }
```

`deps fetch` reads that manifest, takes the `flags.metadataUrl` it advertises,
and pulls the index into `build/cache/metadata`. The whole chain is declared, so
nothing here holds an address of its own and a dependency that moves its release
assets does not break its consumers.

**You may cite what you depend on, and nothing else.** The set is every entry in
`relationships.systems` and `relationships.requires`; `recommends` and
`conflicts` are declarations _about_ other packages rather than dependencies on
them, so a link into one is a defect in the citing note. An address into a
package you have not declared resolves nowhere and fails the build.

**A build never reaches the network.** A declared dependency whose index has not
been fetched is an error naming `deps fetch`, rather than a download nobody
asked for — a build that downloads silently is not reproducible and fails
strangely offline. The cache is keyed by version, so changing the pinned version
is a miss rather than a silent overwrite.

### A relationship may be a Foundry dependency only

`requires` and `systems` install with Foundry whether or not the tree cites
them, and a package may need the one without the other — thalornaaltart
`requires` Thalorna so Foundry installs the base module, and its one homepage
note links nowhere. Declare `contentIndex: false` on that entry to say so:

```yaml
relationships:
  requires:
    - id: thalorna
      type: module
      manifest: https://github.com/HeroicLands/thalorna/releases/latest/download/module.json
      contentIndex: false
```

`deps fetch` fetches nothing for it — no cache directory, nothing to go stale —
and a wikilink into it fails at the link, naming `contentIndex`, rather than
resolving against a stale declaration or an index nobody fetched. It cannot be
combined with `itemCatalog: true`, which extracts items from the same index
this declares there is none of.

### `packagebuild` needs no declaration

package-build ships a set of images of its own — section banners chiefly — and a
note reaches one without declaring anything:

```yaml
data:
  banner: packagebuild-none-image-skillbnr
```

**There is nothing to declare and nothing to fetch.** package-build is an npm
dependency of every consumer rather than a Foundry package, so there is no
release archive behind the name and no reason to fetch one — the tree is already
on disk under `node_modules/@heroiclands/package-build/assets/`. The records are
walked from it on every load and join the index like any other package's, so a
cold cache is not a failure mode here and every lookup stays one path.

`packagebuild` is a **reserved** name: no repository may configure it as its
`contentPackage`, and a configuration that tries is refused.

**These addresses have no Foundry form.** Foundry installs no package for this
one, so a resolver returns "no Foundry address" deliberately rather than
deriving `modules/packagebuild/…`, which installs nowhere. That is not a
limitation in practice: the only slot that names them is `banner`, which reaches
no compiled document at all and is read by the website and the book.

**A fetched catalogue is read one system at a time.** A dependency may ship a
pack per system, and the two hold the same `(type, shortcode)` addresses with
different data models — `skill:awar` is a real address in both vocabularies and
means two different documents. So a pack declaring `system: hm3` resolves its
embedded items against the dependency's `hm3` packs and its system-neutral ones,
never against another system's, exactly as it already does for this repository's
own packs. What each cached pack is comes from the dependency's manifest at
fetch time, so a cache filled before this rule existed is treated as incomplete
and `deps fetch` refills it — the alternative is a lookup that answers with the
wrong system's document and reports nothing.

**Within one document, the shortcode itself comes from `system.shortcode`
where the data model declares such a field, and otherwise from
`flags.<systemId>.shortcode` in that same system's own flag namespace** — a
system writes its per-document handle into its own flags and never another
system's, so a document carrying its shortcode under a different system's flag
namespace is not resolved by it.

**`--from` is for two packages changing together.** It fills the cache from a
locally built artifact — a package zip or the directory it was built from — so a
consumer can be built against a dependency that has not shipped. Without it,
testing a dependency change against its consumers would cost a release
round-trip.

> **This replaced a vendored link manifest**, which every repository committed a
> copy of every other repository's file into. A copy went stale silently and one
> did — 2,101 entries in `Song-of-Heroic-Lands-FoundryVTT` pointed at URLs the
> `thalorna` site had stopped publishing, at the current format version, so the
> version gate saw nothing. Mutual vendoring also deadlocked: each package had to
> read the other's file before it could publish its own. A fetched artifact
> cannot drift from its producer, and a consumer reads one the producer has
> already shipped.

### A page's URL is its address

```text
/<package>/<type>-<shortcode>/
```

`(type, shortcode)` names one note within a package — that is the rule
`content-build lint` enforces — so the URL is **unique by construction**. There
is no collision check behind it, there never can be one to fail, and renaming a
note changes nothing: no part of the address comes from a display string.

**A URL carries no `<system>` segment**, though the canonical address does. That
is deliberate rather than an omission: a note publishes one page however many
systems' documents it compiles into, so the segment would have nothing to
distinguish and would only split one page's URL in two. The canonical address
names a _document_; a URL names a _page_. So a consumer deriving a page address
from a manifest key drops the package **and** the system, not the package
alone.

It does not come from `name.full`. That would make a display name load-bearing three
ways at once — a rename silently 404'd every inbound link, two notes in one
section could derive the same URL so a uniqueness gate had to run, and long names
had to be shortened through a table of 200 abbreviations. The header of the
module doing it justified the cost by promising redirects "every change appends
to the legacy-URL map" — and no such map was ever written, here or in any
consumer. All of it is gone.

The `type-` half earns its place: it keeps every content address clear of the
package's fixed mounts (`/<package>/` for the homepage, `/<package>/api/` for
generated API docs), neither of which contains a hyphen or names a type. So the
namespace is provably disjoint rather than conventionally so.

**A page is written flat, named by its address**, not filed into a
directory, because Hugo derives a page's section from where the file is
written, and a section appears in no address. The file is
`<mount>/<type>-<shortcode>.md` and the front-matter `url:` publishes it at
the package root, one level above; the `section` kind is disabled on every
site, so no directory would answer even if one were written.

**A page states its address without the package base; everything pointing _at_
it composes one**. They read as one quantity and are two:

| Written                                     | Form                        | Because                                                                                 |
| ------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------- |
| A page's own `url:` front matter            | `/<type>-<shortcode>/`      | Hugo resolves it against `baseURL`, whose path already _is_ where the package is served |
| Every `href` this build renders into a body | `<base><type>-<shortcode>/` | A browser resolves it against nothing                                                   |
| A link-manifest `path`                      | `<type>-<shortcode>/`       | Measured against `site.base` and stripped; a consumer prefixes its own                  |

`site.base` is the second and third of those and reaches the first not at all.
Writing it into the `url:` as well makes every consumer's Hugo prefix
its own base to a value that already carried one and published every content
page a segment too deep — `/sohl/sohl/doc-rulesintro/`, 404 at the address the
manifest, the sitemap and every inbound link named.

**There is no landing page and no section.** A page that introduces the notes
of a type is an ordinary note addressed `doc-<type>`, with no build path of its
own, carrying a content table over what it introduces. A site is its homepage
and its pages, and nothing is generated between them — see
[What the site publishes](#what-the-site-publishes).

### The address scheme

Where the content tree mounts _inside the package_ differs between repositories
and is load-bearing. It is one setting, read by this command **and** by the page
emitter, so the address a manifest publishes is the address a page is emitted at
— stating it twice is how a manifest comes to assert a URL that resolves at build
time and 404s for the reader.

```yaml
publish:
  site: content
  manifests: { publish: true, consume: true }
  address:
    prefix: kb/ # default: "" — the package root
```

- **`prefix`** — the content tree's mount within the package: the Hugo directory
  its pages are written under. `sohl` publishes a knowledgebase alongside
  generated API docs, so its tree sits under `kb/` while its pages address the
  package root (`affliction-aconite/`); `thalorna`'s site is nothing but its
  content, so it has no prefix. It must end in a slash and must not begin with
  one — where the _package_ is mounted is the consuming build's knowledge and is
  never recorded here.

`prefix` is the whole scheme. The `collection` subtype and the top-level
`section:` key are refused by name.

A note's `subType` is checked against the values its type declares, and only
those.

The only note the scheme yields no address for is one carrying no `shortcode`.
It is **reported and omitted**, never guessed: the command prints one located
diagnostic per note and still writes the file, because a note with no address is
ordinary while a manifest entry pointing at a page that does not exist is not.

## Publishing a content index

Every content build walks the whole note tree and parses every note's
frontmatter — the pack compilers, the site build, and the content-table expander
each do it — and every one of them throws the result away. So nothing outside a
build can ask a question about the content. "Which beings carry no `kbcat`?",
"what does this table actually select?", "did that type rename leave anything
behind?" have no answer short of writing a throwaway script that re-walks the
tree, which is how eight dead Bestiary tables came to ship for weeks unnoticed.

`content-index` publishes the walk:

```bash
npx content-build content-index
# sohl → build/content-index/sohl.jsonl (1606 notes, 1578 KiB)
```

One line of [JSON Lines](https://jsonlines.org/) per note, holding the note's
whole frontmatter plus where it sits in the tree:

```json
{
  "type": "being",
  "shortcode": "aurochs",
  "package": "sohl",
  "file": { "path": "Bestiary/Animal/Aurochs.md", "folder": "Bestiary/Animal", "name": "Aurochs" },
  "sohl": { "kbcat": "animal", "body": { "weight": { "base": 1500 } } }
}
```

so a question is one line of `jq`:

```bash
jq -r 'select(.type == "being" and .sohl.kbcat == "animal") | .shortcode' \
  build/content-index/sohl.jsonl
```

### The record is the note, not a projection of it

Nothing is selected, flattened, or renamed. A reader addresses
`sohl.body.weight.base` because that is what the note says — which is also,
not by accident, exactly what a `dataview` content-table query writes.

That is a deliberate refusal to impose a schema, and the tree is why. In `sohl`,
frontmatter spreads **242 distinct leaf paths** unevenly over **15 types**, from
9 on a `macro` to 72 on a `being`, and adding a field to one type is ordinary
authoring. A format with a fixed column set would turn that authoring into a
schema migration; a document format has no such problem.

Three keys are **derived** rather than authored, and a note carrying one is an
error rather than a silent overwrite:

| Key       | What it holds                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------- |
| `package` | The configured `contentPackage`. A note may not declare its own, and the expander reads the same.  |
| `file`    | `path`, `folder` and `name` below the content root — the same `file.*` a content-table query uses. |
| `asset`   | The file an asset record addresses. Present on an asset's record and on no note's.                 |

The location is namespaced under `file` precisely because `folder` is real
frontmatter on most notes; a record states both, and they mean different things.

### A file is a record too

The same pass walks the package's **asset roots** — `assets/icons`,
`assets/images` and `assets/audio` — and emits one record per addressable file
into the same index. There is no second artifact and no asset-specific emitter:
a package whose tree holds only pictures publishes an ordinary content index
that happens to hold only asset records.

The filename is the shortcode, the root supplies the type, and the layout in
between is the package's own business:

```json
{
  "type": "icon",
  "shortcode": "anvil",
  "package": "sohl",
  "address": { "canonical": "sohl-none-icon-anvil" },
  "asset": {
    "path": "icons/game-icons/lorc/anvil.svg",
    "attribution": "Lorc",
    "source": "http://lorcblog.blogspot.com",
    "license": "CC-BY-3.0",
    "notes": "From game-icons.net"
  }
}
```

An asset record carries no frontmatter, no anchors and no `foundry` block, and
its `address` holds the canonical key and no page slug — a file declares nothing
about itself, compiles into no document, and publishes no page. The `asset`
block is what a reader tells the two shapes apart by.

`path` is relative to the emitting package's own asset directory, so each
consumer joins its own root onto it and resolves in one step. Provenance comes
from a sibling `<filename.ext>.yaml` where one exists, and otherwise from the
nearest `provenance.yaml` above the file, searching no higher than the type
root. `docs/content-format.md` states the whole rule.

Two files under one root sharing a basename are two claims on one address, and
the build fails naming both.

### Every note's address, and every anchor it defines

A record states the address a wikilink writes to reach the note, and every
`{#slug}` anchor its body declares:

```json
{
  "address": { "slug": "being-aurochs", "canonical": "sohl-sohl-being-aurochs" },
  "file": { "path": "Bestiary/Animal/Aurochs.md", "folder": "Bestiary/Animal", "name": "Aurochs" },
  "anchors": [
    {
      "slug": "appearance",
      "name": "Appearance",
      "level": 1,
      "line": 348,
      "link": "being-aurochs#appearance"
    },
    {
      "slug": "dossier",
      "name": "Dossier",
      "level": 1,
      "line": 352,
      "link": "being-aurochs#dossier"
    }
  ]
}
```

A record also states `nameAscii`, the note's `name.full` reduced to printable
7-bit ASCII:

| `name.full`     | `nameAscii`       |
| --------------- | ----------------- |
| `Kûrbúl ¾-Helm` | `Kurbul 3/4-Helm` |
| `Kèthîra`       | `Kethira`         |
| `Ærling`        | `AErling`         |
| `Þorn`          | `Thorn`           |
| `Ðunhold`       | `Dunhold`         |
| `Straße`        | `Strasse`         |

Names carry the setting's orthography and nobody types them, so anything
searching or completing over the index needs a form a keyboard produces. Stating
one means every consumer matches the same way, rather than each inventing a
slightly different fold and two searches over the same data disagreeing.

It **transliterates rather than strips**, through the same `unidecode` table
`slugify` already runs — so an ASCII name and a slug can never disagree about a
character. Diacritics fold, ligatures expand, the runic letters spell out, and a
vulgar fraction becomes readable. Deleting the marks instead would reduce
`Kûrbúl` to `Krbl`, which is worse than the original for anyone trying to
recognise it. Whatever is still outside printable ASCII afterwards becomes a
space and runs of whitespace collapse — a space rather than nothing, so a
character that transliterates away cannot weld two words together.

The value is emitted even when it equals the name, so a consumer matching on it
never has to branch on whether the name happened to be ASCII already; it is
`null` only when the note has no name at all. On the `sohl` tree, 25 of 1,606
notes differ from their `name.full`.

`aliasesAscii` does the same for `name.aliases`, in the authored order. An alias
is the name a reader is at least as likely to reach for as the canonical one —
`Killer Whale` for an orca, `Ice Bear` for a polar bear, `Ix'balam` for a
jaguar — so anything searching the index has to match them too. It is an **empty
array**, never null, when a note has no aliases: an empty set of names is a fact
rather than a missing value, and a consumer iterating it should not have to check
first. An entry that is not a non-empty string is dropped rather than left as a
hole, since the array is a set of names to match and a null is not one.

`address.slug` is what goes inside `[[…]]` within the package; `address.canonical`
is the fully qualified key the content index files the note under, carrying the
package and the system as well. The slug is the canonical key's **last two
segments**, not its whole tail: a page has no system to name, so the two forms
diverge by that segment rather than one trailing the other. Both are `null` for a
note with no type or no shortcode, which has no address at all — the record says
so rather than leaving each reader to rediscover the rule.

**Neither is new information** — the slug derives from `type` and `shortcode`,
which every record already carries, and the canonical key adds only the system
those two already imply. What the fields add is the _rule_: the lowercasing
and the hyphen join live in one place, derived by the same `addressSlug` and
`canonicalKey` the manifest and the site build use, so an index cannot disagree
with either about where a note lives. A consumer that reimplements the join
slightly differently gets a lookup matching nothing and no explanation — which is
exactly how a resolver keyed on a bare `type/shortcode` silently misses every
canonical `pkg-system-type-shortcode` entry.

**Anchors make a link checkable without a build.** Because the index states every
anchor a note defines, `[[being-aurochs#dossier]]` can be confirmed — or shown
dead — by a lookup, rather than by re-parsing the tree. Each anchor also carries
its **line in the file**, so an editor jumps straight to the heading instead of
searching for it, and a diagnostic about a section can name a real position.

Only headings carrying an explicit `{#slug}` are listed. A bare `#` heading also
starts a journal page, but declares no slug, so nothing can address it with `#…`
and listing it would offer a link that cannot be written. What counts as an anchor
is kept identical to what `splitPages` matches — that pass decides which sections
become addressable journal pages — and a test asserts the two agree, so drift
fails the suite rather than advertising a link that resolves nowhere.

**The path stays relative.** `file.path` is below the content root and is
deliberately never absolute: an absolute path is a fact about the machine that
built the index rather than about the content, so it would differ between two
checkouts of the same tree — costing the byte-stability the artifact depends on —
and a published copy would carry someone's home directory and be wrong for every
reader. Anyone holding the index knows the root it was built from, and
`root + file.path` is the absolute form whenever it is wanted.

### Why JSON Lines, and not a database

The artifact has to survive the build that made it and be usable by anything — a
person with `jq`, an editor, a CI check, another package's build. A
line-per-note text file needs no server, no driver, and no schema; it is
readable by every language without an install; and it **diffs**, so a migration
that quietly empties a category shows up as a reviewable change rather than as a
silently different binary.

Choosing it forfeits no SQL: DuckDB reads JSON Lines directly, with nested
access, so `FROM read_json_auto('build/content-index/sohl.jsonl')` is a query
away. A stored schema would forfeit the open shape, which is the asymmetry that
decides it.

### It is derived, disposable, and byte-stable

The index is written under `build/`, gitignored with the rest of it, and
**nothing may be authored against it**. It is deliberately not in `paths.stage`:
that tree is mirrored destructively into a Foundry data root, so anything left
there ships inside the installed system to every player.

Regenerating costs a frontmatter parse rather than a build, so the intended way
to use it is to rebuild it whenever it looks stale — which is why it is a
command of its own and not only a build step, and why it need never be
committed.

That only holds if a rebuild is a no-op when nothing changed, so the output is
**byte-stable**: records are ordered by content path with the note id breaking
any tie, and every object's keys are sorted at every depth. A walk order is a
directory-read order, and directory-read order is not a fact about the content.

An empty tree is an **error**, not an empty index. A reader takes the file as
authoritative, and an index stating that a package has no content is
indistinguishable from one built against a mis-pointed tree.

## Publishing a website

```bash
npx content-build site               # the configured tree, under build/hugo/
```

The sibling of `package compile`: the same content tree, rendered as pages
instead of compiled into packs. It does the walk, the frontmatter read, the
address derivation, the address index, table expansion, wikilink resolution,
code-fence protection, the foreign-manifest merge and the page emission. A
site is its homepage and its pages — see
[What the site publishes](#what-the-site-publishes).

### The homepage, and how much else is published

Every package is reachable at `https://www.heroiclands.org/<contentPackage>/`,
and what a reader finds there is a note in the content tree — one markdown file,
written by a person:

```markdown
---
type: homepage
shortcode: root
title: HârnMaster Kethira Basic # optional; defaults to packageBuild.manifest.title
---

What the module is, which system it needs, how to install it.
```

A package declares **exactly one** of these, and both `content-build lint` and
`content-build site` require it — see
[Exactly one homepage](#exactly-one-homepage).

That is the whole envelope. A homepage **compiles into no compendium
document**, and so appears in no pack and in no link manifest — which is why it
refuses `id`. It is the package root: written as the mount's `_index.md`,
rendered at `/<contentPackage>/`, and cited as `[[homepage-root|Text]]` by
the `shortcode` it declares (see
[The homepage is the package root](#the-homepage-is-the-package-root-addressed-like-every-other-note)).
It is dispatched on `type` like every other note, not on a filename — nothing
in this format is decided by a file's name, which is why `sohl-thalorna` can
keep a `README.md` in its content tree as a developer explainer about the
source tree.

`type: homepage` is declared by the **engine**, not by the `sohl` item registry,
so a package that configures no `itemBuilders` at all — `HarnMaster-3-FoundryVTT`
and every HM3 module — can author one. The `engine/` ÷ `sohl/` line is
note-format knowledge against game-system knowledge, and a homepage carries no
`system` block.

`publish.site` then says how much _else_ is published:

| Mode       | What is published                                                         |
| ---------- | ------------------------------------------------------------------------- |
| `homepage` | The authored homepage, and no other page. **The default, and the floor.** |
| `content`  | The homepage plus every page the content tree compiles to.                |

There is no value meaning "no web presence": every package publishes its
homepage. A boolean is refused, with a message naming the mode to write
instead.

**Homepage-only is a first-class mode, not an accommodation.**
`sohl-kethira-basic` (unofficial Hârn fan material under Keléstia Productions'
Fan Material Guidelines) and `harn-adventures` (HârnFanon under Lythia's terms)
must each publish a homepage and nothing beneath it. The boundary is _published
content_ — journal text, artwork, item descriptions, compiled notes — and a page
announcing the module discloses none of it. Because the failure mode is silent,
the mode **fences the content surfaces off** rather than trusting a
configuration to stay empty: in `homepage` mode the tree is never walked for
pages, whatever else the `site:` block declares.

That is separate from the **dependency** edge, which such a module also
declines: being cited by another package is what would stop it being
withdrawable, and a homepage is one row in a routing table rather than an
address anyone links to. A package publishes its content index regardless — the
licensing constraint is against publishing _pages_, not against the artifact
existing — but nothing may declare it as a dependency.

The homepage's file is the mount's `_index.md`, written at the root of the
content tree, `build/hugo/content/` — the package's own site root, one level
above the content mount, which is where `publish.address.prefix` puts
everything else. Hugo renders it as the `home` kind at `baseURL`, so it states
no `url` of its own.

**What it does not do is decide addresses.** Those come from `publish.address`,
the same setting the content index reads, so a page and its index record cannot
disagree about where the page is. Everything under `site:` is _framing_ —
the repository's own body rewrites, and the residue of the generated Hugo
configuration that is this repository's own. What the site publishes is the
homepage and the content tree and nothing beside them: a page of
documentation is a note (`type: doc`, with `pack: none` where it compiles into
no document), so there is no second mechanism for mounting a directory of
markdown, and a `trees:` or `readmeSections:` key is refused with a message
saying so.

```yaml
site:
  base: /sohl/ # default: /<contentPackage>/ — hrefs only, never a page's `url:`
  packages: [sohl, thalorna] # default: just contentPackage
  pass: sohlKb
  passOptions:
    apiBase: /sohl/api/
    symbolMap: kb/data/api-symbols.json
  notfound:
    tagline: Song of Heroic Lands has no page at
    sitenoun: site
    links:
      - { title: Rules, url: doc-rulesintro/, text: Success and opposed tests, injury, healing. }
```

| Key           | What it decides                                                                                                                                                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base`        | Where the package is served: the prefix on every rendered `href`, and what a manifest `path` is measured against. It reaches no page's own `url:` — see [A page's URL is its address](#a-pages-url-is-its-address). Defaults to `/<contentPackage>/`. |
| `packages`    | Which content packages this site renders. Defaults to its own.                                                                                                                                                                                        |
| `pass`        | A named bundle of this repository's own body rewrites.                                                                                                                                                                                                |
| `passOptions` | That bundle's options.                                                                                                                                                                                                                                |
| `assets`      | The host every package's imagery is served from; the generated `params.cdnBaseURL`.                                                                                                                                                                   |
| `notfound`    | The wording of the "page not found" page; the generated `params.notfound`.                                                                                                                                                                            |
| `hugo`        | A mapping deep-merged over the generated Hugo configuration, last. Every key the generator writes is refused here — see `docs/configuration.md`.                                                                                                      |

Where the tree is written is not among them. `content-build site` writes the
whole Hugo source tree under `build/hugo/` — the generated `hugo.toml`, the
content mount at `build/hugo/content/`, Hugo's cache — and the consumer's
script runs `hugo --source build/hugo` over it. The generated file's every
value has a source the repository already states; `docs/configuration.md`
lists them.

### What the site publishes

**A site is its homepage and its pages, and nothing is generated between
them.** The `type: homepage` note is `/<package>/`; every other note is one
page at `/<package>/<type>-<shortcode>/`. No section directory is written, no
listing of a type, no tag page: the generated Hugo configuration disables the
`section`, `taxonomy`, `term` and `RSS` kinds on every site, so `home` and
`page` are the only kinds that render, and a request for `/<package>/being/`
is a 404.

Every structure above the pages — which notes belong together, in what order,
under which headings, with which columns — is **authored**, as a `doc` note
carrying a content table over the content index:

````markdown
---
type: doc
subType: reference
shortcode: beings
pack: none
name:
  full: Beings
---

Every person and creature of the setting, by realm.

```dataview
TABLE name.full AS Name, subType AS Kind, data.realm AS Realm
FROM type = "being"
SORT data.realm, name.full
```
````

````

That page is `doc-beings`, published at `/<package>/doc-beings/`, and it is the
index — linked from the homepage like any other page, and choosing its own
membership, order, headings and columns. A tag is a field such a table
filters on, not a page of its own.

**One page per note, whatever it compiles into.** A system-bearing note — an
`affiliation`, a `being`, every item type — compiles into two Foundry
documents, the Item and the JournalEntry carrying its prose, addressed
`doc<type>-<shortcode>`. On the web it renders as one page, which is its own
documentation: the site index keys that page under both `<type>/<shortcode>`
and `doc<type>/<shortcode>`, so a link written either way lands on it, and a
content table that lists a type surfaces each note once.

A configuration that asks the build to generate an index — `site.sections`
(with the `listType` / `listSubType` an entry carried), `site.landing`,
`site.backfillSections`, and `site.list`, which said how such a listing
renders — is refused by name, with one message:

```text
package-build config: `site.sections` is retired — a site is its homepage and
its pages, and any index between them is a `doc` note: write one with
`type: doc`, a `shortcode` and `pack: none`, carrying a content table over the
notes it lists, and link it from the homepage. Nothing is generated between
the homepage and the pages, so delete the key.
````

### Every page carries what links to it, and what it links to

The build resolves every wikilink on every page through the address index, so
at the moment it writes a page it holds the whole link graph. It writes the
part that concerns each page into that page's front matter:

```yaml
related:
  backlinks: # pages that link to this one
    - title: Afzandah Parnâzar
      url: /thalorna/being-afzndhprnzr/
      type: being
  mentions: # pages this one links to
    - title: Kethramír
      url: /thalorna/place-kthrmr/
      type: place
```

The theme's `related.html` partial reads both lists and renders them as one
"Related" card, grouped by `type`. What the build guarantees about them:

- **A page appears once per list**, however many times it is linked, and
  whichever address the link was written to: `docbeing-grod` and `being-grod`
  are one page, and a page that cites it under both lists it once. A link from
  a page to itself is not a connection and is dropped.
- **Each list is sorted by `type`, then `title`**, so the card's grouping is
  the same on every build whatever order the notes were walked in.
- **Both lists are present whenever either has an entry**, so a theme reads one
  shape; a page with no links either way carries **no `related` key at all**,
  which is the partial's silent-disappear convention kept at the source.
- **`url` composes `<base><slug>/`**, like every other href this build renders
  — see [A page's URL is its address](#a-pages-url-is-its-address). The page
  states its own address as `/<slug>/`; everything pointing _at_ it, this
  included, carries the base.
- **The homepage is a page like any other on both sides.** A content page
  reaches it through `[[homepage-root|Text]]` and is listed in its backlinks;
  its own body links are ordinary markdown, resolved against the package root
  the way a browser resolves them, so `being-grod/`, `/thalorna/being-grod/`
  and `./being-grod/#top` each count as a mention of that page. A link that
  names a host leaves the site and counts as nothing.
- **Only a page of this site is an endpoint.** A link into another package
  resolves to an href the build renders but no page it writes, so it is listed
  on neither side; a backlink can be counted only on a page this build emits.

`related` is derived, never authored: what links to a page is a fact about
every other page in the tree. A note that writes one has it replaced.

### A place page says what lies within it and who holds it; an affiliation page says what it holds

Two keys the notes already carry answer three questions a reader asks of a
page. A place's `data.parents` is geography — what it sits within — and an
affiliation's `data.domains` is tenure — what it holds. The build reads both
across the tree and every fetched index, inverts them, and writes each page
the lists that concern it, shaped like `related`:

```yaml
# on a place
contains: # every place whose `parents` names this one
  - title: Khaset-Mehtet
    url: /thalorna/place-khasetmehtet/
    type: place
    subType: settlement
held_by: # every affiliation whose `domains` names this one
  - title: The Nome of Ankhsetun
    url: /thalorna/affiliation-nomenkhstn/
    type: affiliation
    subType: polity

# on an affiliation
holdings: # every place its `domains` names
  - title: Ankhsetun
    url: /thalorna/place-ankhsetunnome/
    type: place
    subType: region
```

- **`contains` and `holdings` are sorted by `subType`, then `title`**;
  `held_by` by `title`. An entry carries `subType` where the note declares
  one.
- **A key is present only when it has an entry.** A place nobody holds and
  nothing sits within carries neither key; an affiliation whose `domains` is
  empty carries no `holdings`. The theme's silent-disappear convention, kept
  at the source.
- **`domains` names what an affiliation holds directly, and is never
  expanded.** A polity whose `domains` names a region holds the region; the
  settlements within it are reached through the region's `contains`, and are
  not repeated in the polity's `holdings`. Tenure runs through
  `affiliation.parents` — a house of its earl, an earl of the crown — and
  geography through `place.parents`. A subinfeudated manor sits in one region
  by the second and under a lord of another polity by the first, and both
  pages say so.
- **A dependency's places and affiliations take part.** A fetched index entry
  carries the `parents` and `domains` its record stated, so a place another
  package publishes is listed within a local region, and a house another
  package publishes is named on the local manor it holds. A local note
  declaring a shortcode shadows a fetched entry declaring the same one.
- **`url` composes `<base><slug>/`**, as every `related` entry does.

All three are derived, never authored: a note that writes one has it
replaced. The theme renders each list as a table on the page.

### A place page carries the map from that place

A place that states a border or a route, or is named in one, has a map from
it — the drawing `content-build map --from` makes, with the place at the
centre and each neighbour at its bearing. The site build draws that map for
every such place and writes it with the page: the page is a leaf bundle,
`place-<shortcode>/index.md`, the drawing sits beside it as
`from-<shortcode>.svg`, and the front matter names it:

```yaml
map: from-kthrmr.svg
```

The theme's "From here" panel reads the key, inlines the file as a page
resource, and so every place name on the map is a link to that place's page.
What the build guarantees:

- **The address does not move.** A bundled page states the same `url` a flat
  one does, `/<slug>/`, so `place-kthrmr/index.md` publishes exactly where
  `place-kthrmr.md` would.
- **Every name links through the site base.** The map is drawn with the base
  the pages are served under, so each `href` composes `<base><slug>/` the way
  every other href the build renders does.
- **It is written for inlining.** No XML prologue, no DOCTYPE, no comment, no
  reference to anything outside the file; the root carries a `viewBox` and no
  fixed width or height, so the theme sizes it to the column.
- **A place with no relation carries nothing**: no file beside it, no `map`
  key, and the page stays a flat file. So does every page that is not a place.
- **A site never fails for want of a map.** GraphViz draws; when it is not
  installed the build says so once, as a warning naming what to install, and
  every page is written as it would be without maps. `site.maps: false` in
  `package-build.config.yaml` draws nothing and asks nothing of GraphViz.

`map` is derived, never authored: a note that writes one has it replaced when
the build draws a map, and dropped when there is none to draw.

### Why the output location is fixed

The content mount is a build artifact and is **deleted on every run**, so that a
page whose note was renamed cannot linger and keep publishing. A configurable
location is a location that can be unset — and an unset one resolves to the
repository root, where the wipe deletes the working tree. A fixed one under
`build/` can point nowhere else, so `site.out` is refused by name and the wipe
needs no guard.

### Consumer passes are named, not imported

A repository's own body rewrites are code, and a configuration is data, so a
configuration **names** a bundle and the toolchain resolves it — exactly as
`itemBuilders` names an item registry. `sohlKb` is the bundle for the `sohl`
knowledgebase: it resolves `{@link}` tags against a TypeDoc symbol map and
rewrites repository-relative links in the developer docs to their published or
GitHub addresses. Neither rewrite can fail a build; an unknown `{@link}` degrades
to a code span.

`symbolMap` is resolved **against the repository root**, not the process cwd, so
`content-build site` reads the same map whatever directory it was invoked from.
Leaving it unset is the legitimate empty case — every `{@link}` degrades, and
nothing is reported. Setting it to a path that cannot be read, cannot be parsed,
or does not hold a name → page object **fails the build**, naming the file and
the reason. Left unreported they are indistinguishable from "no symbols", and
a site publishes dead `{@link}` tags at exit 0. A map that is read reports
its symbol count at info level, which is the only way to tell a map that loaded
from one that loaded empty without reading the emitted HTML.

A bundle supplies one hook, `beforeLinks`, which runs on every page before
wikilinks resolve — a `{@link}` tag may sit in prose a wikilink also touches.
It runs inside code-fence protection, so it cannot rewrite a fenced example.

### The gates

Every integrity check reports and the run stops at the first that fires, so the
output names the cause rather than its symptoms — an unusable manifest reported
after the links that failed because of it reads as a pile of broken notes.

| Gate                   | What it catches                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------- |
| Frontmatter wikilinks  | A link in frontmatter, which is copied verbatim and reaches the reader as `[[…]]`. |
| Addresses              | A note with no shortcode to be addressed by, or no section to be filed under.      |
| Unusable manifest      | A vendored manifest this build cannot read.                                        |
| Unaddressable manifest | One it can read but cannot look anything up in.                                    |
| Tables and wikilinks   | A table directive that cannot be honoured, or a link that lands nowhere.           |

None of them exits the process from inside the library; the command decides. That
is what makes them testable, which the consumer scripts' inline `process.exit`
calls were not.

## Publishing a book

The third surface the content tree publishes, beside the compendium packs and
the website: one PDF, built by `content-build pdf` and by `package-build release`.

```bash
npx content-build pdf                    # build it where `pdf.out` says
npx content-build pdf --out build/book   # somewhere else
npx content-build pdf --no-compile       # emit the Typst source and stop
npx content-build pdf --version 1.4.0    # stamp a version on the title page
```

### A book is a selection, not a rendering of everything

The packs and the website publish the _whole_ tree: every note becomes a
document and a page, and the three surfaces agreeing about what the content is
is the point. **A book is not that.** It is a declared structure whose leaves
pick notes out of the corpus, interleaved with prose that need not live in the
content tree at all.

`pdf.document` names that structure — a YAML file of nested sections, each
holding some mixture of prose files and `filter:` clauses:

```yaml
contents:
  - sectionName: Gear
    contents:
      - file: prose/gear-preamble.md
      - filter: "type = 'weapongear'"
      - sectionName: Armour
        contents:
          - filter: "type = 'armorgear'"
  - sectionName: The Cast
    contents:
      - filter: "type = 'being' AND subType = 'npc'"
```

Three consequences follow, and each is behaviour rather than oversight:

- **A note no clause selects is not in the book.** A project decides what its
  own volume carries, so an omission is an editorial act and nothing reports it.
- **A note several clauses select appears several times**, each occurrence its
  own page, outline node and anchor. Inbound wikilinks are pointed at the
  first, so `[[weapongear-dagger]]` reaches one place however often it prints.
- **A filter that selects nothing _is_ reported.** A note nobody asked for is
  expected; a clause matching nothing is either wrong or left over from a
  structure that has moved on.

The `WHERE` clause runs against the same content index the SQL tables read, and
the build owns the `SELECT … FROM notes` — so a filter cannot name a table, and
cannot reach another package's notes.

### How the book is set

**Every entry opens a page of its own**, under a full-bleed plate carrying a
small-caps kicker above the entry's name. A reference book is consulted rather
than read through: an entry beginning halfway down a page is harder to find,
cannot carry its own running head honestly, and makes a page number in the
contents point at the middle of something else. A section opens a page of its
own too, plated to twice the depth, so a section reads as a section rather than
as the first entry beneath it.

**The body is set in two columns**, and every other measure follows from that
one: an image with no width class is a column wide, the infobox flows in the
column measure and breaks between its sections, and a table wider than three
columns is set across the page. Two columns are print's answer and print's
alone — a scrolling page has no fixed viewport, so the website keeps one
measure with a side rail.

A note's `description:` sets as an epigraph between short rules under the
plate. It disappears rather than leave a shell: a note with no description has
no epigraph. The running foot carries the section's name, an ornament and the
folio.

A table of **more than three columns** is given an explicit span rather than
left to overflow the measure. Which span depends on how tall it is, and that is
measured while the page is laid out: a table that fits a page is floated across
both columns at the top of one, and a longer one is set on single-column pages
of its own — a float cannot break, and a table taller than the page placed as
one piles its rows on top of each other without a word of warning.

### What a section declares, its entries inherit

A section may carry presentation alongside its `contents:`, and everything
beneath it agrees unless it says otherwise:

```yaml
contents:
  - sectionName: Beings
    footer: The Bestiary # what the running foot carries
    page:
      banner: assets/images/banners/bestiary.webp # the plate's picture
      kicker: The Bestiary of Thalorna # the line above each entry's name
      columns: 2 # the measure this section's pages are set in
    contents:
      - filter: "type = 'being'"
```

| Key            | Default                | What it does                                          |
| -------------- | ---------------------- | ----------------------------------------------------- |
| `footer`       | the section's own name | The name in the running foot.                         |
| `page.banner`  | none                   | A file this repository ships, plated under the title. |
| `page.kicker`  | the section's trail    | The small-caps line above an entry's name.            |
| `page.columns` | `2`                    | Columns, from 1 to 4.                                 |

`page:` is inherited whole: a subsection declaring one of its keys states the
others it wants as well.

**A missing banner is a plate without a picture.** A section plate implies a
banner per section, and art arrives later than rendering does — so a section
that names none still gets its plate, its kicker and its title, set over the
book's ink, and nothing is reported. A banner the build _cannot read_ is a
different matter: that is a statement the tree makes and the build cannot
honour, so it is a finding.

`header:` and `infobox:` are part of the format and read by nothing: the
running head is a foot in this design, and which infobox a note draws is
decided by the note's type.

### What it is fenced by

**`publish.site` decides whether a book is built, and it is the only switch.**
`content` builds one; `homepage` does not — the same fence that stops the tree
being walked for pages stops it being walked for a book. A PDF of the content
tree is a content surface by any reading, arguably the most portable one there
is, so a package that publishes only a homepage publishes no book however its
`pdf:` block is written. The command says so and exits 0.

That is also the opt-out: a package with no `pdf:` block, no content tree, or
`publish.site: homepage` builds nothing and fails nothing.

### Configuration

```yaml
pdf:
  title: The Hârn Ensemble # required
  subtitle: a roster of the ready-made
  document: book.yaml # required — the document tree above
  out: build/dist # default
  front: # prose before the contents
    - prose/colophon.md
  fonts: # every key optional — the defaults below
    serif: Libertinus Serif
    sans: Libertinus Sans
    mono: DejaVu Sans Mono
    path: assets/fonts # faces of your own, searched as well as the shipped ones
  iconFonts: # icon family → the font carrying its glyphs
    fontawesome: assets/fonts/fa-solid-900.ttf
  binary: typst # when it is not simply `typst` on PATH
```

Nothing here is an address or a brand: the title, the front matter and the faces
are the publishing repository's to choose, which is why they are configuration.

### The faces come with the build, not with the machine

All three defaults resolve on a machine that has none of them installed. The
serif and the mono the defaults name are faces the compiler embeds; the sans is
one the toolchain ships, under `assets/fonts`, along with the superfamily's own
mono for a package that names it. The compile searches that directory, and
`pdf.fonts.path` when a package names one, and **nothing the machine has
installed** — `--font-path` and `--ignore-system-fonts` together — so the same
source sets the same book everywhere, and a machine carrying its own copy of a
named family does not quietly change what it prints.

The default mono is the compiler's rather than the superfamily's because the
superfamily's mono carries none of the dot-below and dot-above letters this
corpus spells names with. A package whose fenced blocks stay inside what it does
carry can name it instead, and the compiler reports nothing when a glyph is
missing, so that is a claim to measure against the fences rather than assume.

A face nothing resolves is a **finding** — the compiler says so, and a compile
that says it still exits 0 and writes a book set in the fallback, which is the
one way a wrong face reaches a reader unnoticed.

Compiling an emitted `.typ` by hand takes the same two flags to set it the way
the build does:

```bash
typst compile --ignore-system-fonts \
  --font-path node_modules/@heroiclands/package-build/assets/fonts \
  build/dist/the-book.typ
```

The shipped face is licensed under the SIL Open Font License, which travels with
it.

### Typst is a binary, not a dependency

The compiler is an external program, found on `PATH` or named by `pdf.binary`.
Bundling a native compiler would put a platform-specific artefact into the
dependency tree of three repositories, only one of which is mostly a book, and
it would have to resolve on every consumer's CI runner before any of them could
install the toolchain at all.

A missing binary is a **finding**, not a failure: the `.typ` source is written
anyway, which is both the diagnostic and the thing a consumer can compile by
hand.

### What the book gets right, and why each matters

| Property                 | How                                                                             |
| ------------------------ | ------------------------------------------------------------------------------- |
| Searchable               | Real text, not page images — a roster nobody can search for a name is no use.   |
| Bookmark outline         | Every section and entry is a heading, so a viewer's sidebar is the way in.      |
| Page-numbered contents   | `#outline()`, shallower than the bookmarks — 2,500 entries would be 40 pages.   |
| Repeating table headers  | `table.header`, so a property table spilling a page keeps its column names.     |
| Internal cross-reference | A wikilink between two notes of the book becomes an internal destination.       |
| External cross-reference | A cross-package link, and a note the book did not select, stay URLs.            |
| Illustration             | An image authored in the body is staged and set at the measure its class names. |

An image states its own width and position once, in the note, and the book, the
website and a Foundry journal page each honour it — see
[Images](docs/content-format.md#images) for the two closed vocabularies. The book
copies each picture it prints into the output directory before the compiler
runs, because Typst reads nothing above its own root; an address naming a file
this package does not ship prints its caption alone and is reported.

`{#anchor}` on a heading becomes an internal destination namespaced by its
entry, so `[[being-jaslyne#appearance]]` reaches the section and two notes may
both declare `{#appearance}`. A reference to a destination the book does not
carry falls back to the entry that would have held it, or to plain text, and is
reported — because Typst treats a dangling reference as fatal, and one mistyped
anchor should not take a thousand-page book down at the last step.

### The charset is what makes a face choosable

A PDF embeds the faces it sets, so every character in the corpus is a claim on
the book's typeface — and Typst does not warn about a missing glyph, it falls
back and exits 0. That is why `content-build lint` holds content to a charset,
and why `:icon-…:` names an icon rather than pasting one. Both exist for this
surface. See _Prose: formatting and markdown_.

## Diffing published addresses

```bash
gh release download v0.8.2 -p system.zip -D build/baseline
npx content-build addresses diff --from build/baseline/system.zip
npx content-build addresses diff --from build/baseline/system.zip --strict
```

A package's `(type, shortcode)` addresses are a **published interface**. Every
satellite declaring `itemCatalog: true` assembles its beings out of them —
`attribute:str`, `skill:awar`, `weapongear:Tabri` — resolving each against the
Item packs of the release its `compatibility.verified` pins. Renaming a
shortcode is therefore a breaking change to something other repositories
consume, and it used to cost nothing and produce no signal: the check that got
made was a repository-local grep, which cannot see the other repositories and
reports the reassuring answer.

`sohl` renamed one weapon's shortcode from `Tabri` to `Taburi` two days after
the `v0.8.2` tag, on the stated ground that "nothing referenced the old value".
True of that repository. Both satellites pin `v0.8.2` and address
`weapongear:Tabri` on their copy of the same character — five lookups that
resolve today and fail the moment either pin moves, reporting a missing item.

**A rename is told from a removal by the document id, and that is an identity
match rather than an inference.** A note authors its `_id` in frontmatter; it is
not derived from the shortcode, so it survives a rename. An address that
disappeared while its document is still published elsewhere _is_ a rename:

```text
assets/content/Weapons/Melee/Taburi.md:12:1: warning: since sohl@0.8.2, weapongear:Tabri is no longer published; the same document (s5D6QJbw7ZbETxdN) is now published as weapongear:Taburi. Every package that resolves weapongear:Tabri breaks when it moves past sohl@0.8.2
```

Where the id is published under no address at all, that is all it says —
**withdrawn**, with no successor named. A split, a deletion and a merge are
indistinguishable at that point, and a "did you mean" guessed from string
similarity would be worse than silence, because a wrong one sends the reader to
the wrong fix.

| Finding     | What it means                                            | Severity                                |
| ----------- | -------------------------------------------------------- | --------------------------------------- |
| `renamed`   | Address gone; the same document publishes under another. | `warning` — legitimate, but not silent  |
| `withdrawn` | Address gone; its document publishes under none.         | `warning` — retiring content is allowed |

Neither fails a build. Retiring content is legitimate, and so is renaming — the
shortcode charset rule forces some. What a rename must not do is happen without
anyone noticing. `--strict` reports both as errors and exits non-zero, for a
release workflow that wants a gate.

**A finding is placed against the note, not the pack it was read from.** The
address space is read from compiled output because that is what actually ships;
the content tree is read only to find the note carrying the id, so the reader
lands on the `shortcode:` line they just edited. A withdrawal has no such note,
so it degrades to the baseline document — and where neither is readable the
position is dropped rather than guessed.

**The baseline is named, never derived, and never downloaded.** `--from` takes
the artifact for the same reason `deps fetch --from` does: a command that
reaches the network on its own is not reproducible and fails strangely offline.
A baseline that yields **no** addressable item is refused rather than read as
"nothing changed" — it would report a clean result for every possible input,
which is the one failure a check like this can never catch.

Item packs only, because that is the address space consumers resolve against: a
being's embedded items are the only cross-package resolution by
`(type, shortcode)`.

## Diagnostics

Every warning or error a build reports **about a content note** is emitted in the
form every C-family compiler, `tsc` and ESLint already use, so an editor, a CI
annotator or a `grep` parses it with no knowledge of this build:

```text
assets/content/Regions/Capital_Nome.md:43:635: error: address [[place-kenbetpat]] resolves to no note — no package publishes it. Fix the shortcode, or declare the package that does as a dependency and run `content-build deps fetch` — in "The Capital Nome".
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

**A configuration error is located the same way.** Every check in
`content-config.mjs` and `config.mjs` reports through one `fail()`, naming the
offending key's dotted path — a good description and a bad locator, in a file
that runs to hundreds of lines with sibling entries flow-mapped onto one. The
path now rides on the error, and the loader that read the file resolves it
against the YAML, so all of them come out located:

```text
package-build.config.yaml:382:64: error: package-build config: `site.notfound.links[0].descrption` is not a recognized option (expected one of: title, url, text).
```

The same two rules apply. A key the file never declares — a required one that is
simply missing — has no node of its own, so the position names the **mapping it
belongs in** and no further out; a missing _top-level_ key has nothing above it
but the document, and an `.mjs` configuration has no YAML to resolve a path
against at all. Both report `package-build.config.yaml: error: …`, the file
without a line, rather than a line that would be wrong.

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
  content walk, frontmatter, tables, wikilinks, ids, folders, the content index
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
runtime values cannot disagree.

`@heroiclands/package-build/content-config` exposes the configuration contract's own
module, so a consumer can name its types (`ContentBuildConfig`, `PackSpec`) from
JSDoc.

## Tests

The package carries its own suite, so it is verifiable without any repository
that consumes it:

```
npm test                                  # the whole suite
npx vitest run tests/wikilinks.test.ts    # one file
```

**The suite is configured from a fixture, not from this repository's root.**
`vitest.config.ts` points `PACKAGE_BUILD_CONFIG` at
`tests/fixtures/repo/package-build.config.yaml`, whose adjacent `package.json`
is shaped like a consumer's. The Foundry package id and the system version are
derived from the manifest beside the configuration, and at the root that
manifest is this toolchain's own — `@heroiclands/package-build`, which is
neither a Foundry package id nor a game system version, so the derivations
would assert nothing.

The harness is deliberately austere: no global setup, no Foundry stubs, and no
alias onto a consuming repository's source. `tests/suite-is-self-contained.test.ts`
enforces that — a test that reached for `globalThis.game`, imported `@src/…`, or
resolved a path climbing out of the package would pass in situ and fail the
moment the package was installed from npm. Before the extraction five files
resolved `"../../.."` and asserted about whatever happened to be there, which
was the system repository, because the package was vendored inside it (#1).

`tests/dependencies-are-declared.test.ts` guards the same failure from the
shipping side. This package spent its first six changes as a workspace inside
the Song of Heroic Lands repository, where npm hoisted the root's
`devDependencies` into the workspace root: an import this package never declared
still resolved, and failed nowhere but a consumer's install. The test
walks every module named by the `files` field and holds each bare specifier to
one of three cases — a Node builtin, this package addressing itself, or a
declared `dependency` — and checks the converse: nothing shipped may import a
`devDependency`, and no declared dependency may go unimported.

`tests/import-needs-no-config.test.ts` is the third of the same family, and the
one that keeps "resolved on first read, never at import" honest. It copies the
files the package ships into a temporary directory outside this repository and
imports each shipped module on its own, in a process whose environment has
`PACKAGE_BUILD_CONFIG` deleted. Outside is load-bearing: the config walk climbs
from the working directory and from the module's own directory, and the copy is
both — so one left inside the tree could reach a configuration above it and
prove nothing, which is why the first case asserts that none is reachable from
the copy before the rest run. A module that hoisted a configured value to import
time fails there, and only there.

`tests/config-from-working-directory.test.ts` describes the resolution order
itself. It builds the shape no unit test can fake — a repository with the
toolchain installed under it, and a second checkout nested inside that
repository with its own configuration and no `node_modules` — and asserts which
configuration a build run in each place reads. The nested case is the one that
was wrong, and it is untestable any other way: the tell of a wrong-tree build is
normally an unexpected zero diff, and the sweeps that provoke this shape expect
zero differences, so only "which file was read" separates the outcomes.

## Releasing

Releasing is not a command anyone runs. It is a consequence of merging, in two
steps, and each step is visible while it is pending.

**A pull request declares its bump when a consumer will notice.** Run
`npx changeset` and pick major/minor/patch; the summary you write becomes the
changelog entry and the release note. Nothing a consumer meets means no
changeset at all — CI carries no gate demanding one. What CI does check is the
quality of a changeset that exists: `node bin/package-build.mjs changelog check`
lints every pending one against the rules a changeset is held to.

**Merging to `main` opens a Version Packages pull request** carrying the version
bump and the rewritten `CHANGELOG.md`. That pull request _is_ the pending
release: as long as something is merged but unpublished, there is an open pull
request saying so. This is the whole point of the pipeline — the previous,
hand-driven process failed by leaving _nothing_ behind when the final step was
forgotten, and on 2026-08-21 it did exactly that for two versions.

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
