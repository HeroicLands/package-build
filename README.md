# @heroiclands/package-build

The shared toolchain for building and shipping a HeroicLands **Foundry
package** — the parts Foundry loads whether or not the package ships any
content.

It is the counterpart to
[`@heroiclands/content-build`](https://github.com/HeroicLands/content-build), and
the two split by **input**:

| Package         | Reads                                                        | Produces                                                       |
| --------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| `content-build` | `assets/content/**`                                          | compendium packs, site content, link manifest                  |
| `package-build` | `lang/`, `styles/`, `src/`, `assets/`, the manifest template | `system.json` / `module.json`, styles, bundle, release archive |

A module uses either, or both. An adventure module that ships only notes needs
no bundler; a variant module that ships only behavior needs no Markdown
pipeline. The coupling runs one way — `package-build` asks `content-build` for
the compiled `packs[]` block, never the reverse.

## Install

```
npm install -D @heroiclands/package-build
```

## What it covers

The whole of assemble → validate → ship, one subpath each:

- **`manifest`** — the Foundry package manifest, `system.json` or `module.json`:
  read the repository's template, stamp the version and the four release
  addresses, write it into the stage. The artifact is inferred from the
  template's name, and every address is derived from `package.json`'s
  `repository` — nothing is transcribed.
- **`stage`** — assembling the build stage and clearing it away again. A listed
  asset path that does not exist **fails the build** rather than shipping a
  package that quietly lacks its localization or its templates, and the whole
  list is checked before anything is copied, so a bad list leaves no
  half-populated stage.
- **`lang`** — what a shippable Foundry localization file must satisfy: it
  parses, its top level is an object, no key is both a leaf and a dotted prefix
  of another, placeholders are single-braced, and key segments carry no data.
- **`coverage`** — whether the keys a package references and the keys it
  declares are the same set. A referenced key that is missing renders to a
  player as its own raw key string, so it fails the run; a declared key nothing
  references is reported and does not.
- **`templates`** — the opposite question, which coverage cannot ask: whether
  the markup's user-visible text goes through localization at all, rather than
  sitting in the file in English — and whether each template still compiles once
  it does.
- **`bundle`** — whether the manifest agrees with the file it points at.
  Declared under `"esmodules"` the bundle must parse as a module; declared under
  `"scripts"` it must declare **nothing** at top level, because every top-level
  declaration in a classic script is a global lexical binding and one colliding
  with a non-configurable `window` property throws at parse time.
- **`release`** — the two assets a GitHub Release carries, `<artifact>.zip` and
  the manifest beside it. Waits for the archive to be _written_, not merely
  finalized.
- **`deploy`** — installing a staged package into a Foundry data directory, over
  a local copy or SFTP. Always a staged, atomic swap: a running Foundry holds
  its LevelDB packs open, and replacing them in place leaves a directory LevelDB
  "repairs" to zero.
- **`text`** — locating a literal inside a file, so a finding names the line and
  column it is about.

## Configure

A repository declares its build in **one** file — `content-build.config.yaml`,
the same one `content-build` reads — and this package takes its settings from
the reserved `packageBuild:` section:

```yaml
# Read from the top level, not restated below.
packageKind: modules
foundryPackage: sohl-thalorna

packageBuild:
  # Where the package is assembled. Every `to:` below is relative to it, so a
  # table reads `lang`, not `build/stage/lang`.
  stageDir: build/stage

  assets:
    - { from: lang, to: lang }
    - { from: assets/icons, to: assets/icons }
    - { from: LICENSE.md, to: LICENSE.md }

  # Optional. A module exporting `transform(sourcePath) -> string | null`,
  # applied to every staged file — `null` copies it verbatim. This is the one
  # genuine piece of code in staging, and it stays the repository's: SoHL
  # rewrites each SVG's hard-coded fill so icons follow the Foundry theme.
  assetTransform: ./utils/svg-theme.mjs

  clean:
    # Beyond the conventional build artifacts, which the library already knows.
    extra: [site/content, site/public, site/resources]

  lang:
    sources: lang/*.json
    # Printed after a `lang check` failure — where this repository documents its
    # key rules.
    help: See kb/dev-docs/reference/localization-keys.md.

    # `lang coverage` and `lang hardcoded`. Every one of these defaults to the
    # conventional layout, so a repository that follows it states none of them.
    primary: lang/en.json # the file coverage is measured against
    scripts: src/**/*.{ts,mjs} # scanned for key references
    templates: templates/**/*.hbs # scanned for references and for English

    # Only when the package references a root its file does not yet declare;
    # otherwise the roots are read from the file's own keys.
    keyRoots: [SOHL, TYPES, TYPE]

    # Optional. A module exporting `references(context) -> ReferenceSet`,
    # contributing the keys only this repository's conventions can find. SoHL's
    # `defineType(prefix, def)` mints one key per member of an enum by a rule of
    # its own; no shared guard can know it, and no repository can compare the
    # result against the file. See "Contributing generated keys" below.
    references: ./utils/lang-references.mjs

    # Keys reached in a way no scan can see, exempt from the unreferenced
    # advisory. The reason is required: it is a claim a reviewer has to be able
    # to check, and the honest fix for an unreferenced key is to delete it.
    retained:
      - prefix: SOHL.Gear.Action.
        reason: Titles built as `${titlePrefix}.${shortcode}` — the prefix is a parameter.

    # Template literals that are deliberately not localization keys. The escape
    # hatch, not the rule.
    allow:
      - literal: item.system.code === 'pyrn'
        reason: An expression example shown as a placeholder — code, not prose.

  deploy:
    # Prefix of the shared SFTP override variables. Default `SOHL`.
    envPrefix: SOHL

  bundle:
    # The file Foundry loads, as the manifest spells it, relative to the stage.
    # Defaults to `<packageId>.mjs`; state it only when the bundler emits
    # something else. Deliberately not read back out of the manifest — a value
    # taken from there would agree with itself by construction, and `bundle
    # check` asks whether the manifest declares this file correctly.
    entry: sohl.mjs

  # Optional. A module exporting `flags(config)` returning namespaced Foundry
  # flags the repository has to *compute* — an address that only exists once
  # the content tree has been walked, say. Merged over any declared below.
  manifestFlags: ./utils/manifest-flags.mjs

  # The Foundry package manifest. Emitted as declared, so a key Foundry adds in
  # a later version needs no release of this package.
  manifest:
    title: Song of Heroic Lands
    description: <p>…</p>
    license: LICENSE.md
    readme: README.md
    authors:
      - { name: Toasty, discord: "toasty#8538" }
    esmodules: [sohl.js]
    styles: [css/sohl.css]
    languages:
      - { lang: en, name: English, path: lang/en.json }
    documentTypes:
      Item:
        skill: { htmlFields: [notes, docHtml] }
    packFolders:
      - name: Song of Heroic Lands
        sorting: m
        color: "#094fcb"
        packs: [items, journals, actors, macros, scenes, adventures]
    media:
      - { type: logo, url: systems/sohl/assets/ui/logo.webp }
    socket: true
    grid: { distance: 5, units: ft }
    primaryTokenAttribute: health
```

### The manifest is generated, not stamped

`package-build manifest` writes `system.json` / `module.json` into the stage.
**There is no template file.** A manifest used to be hand-authored JSON that the
build stamped a few fields into — the one build input still written by hand, per
repository, with no schema and nothing checking it. It also declared facts the
configuration already declared: the pack list twice, in two formats, with
nothing checking the pairs agreed.

Three kinds of key end up in the result:

| Kind         | Where it comes from                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------- |
| **Declared** | `packageBuild.manifest`, emitted unchanged                                                        |
| **Derived**  | `id`, `version`, `url`, `bugs`, `manifest`, `download`, `compatibility`, `relationships`, `packs` |
| **Computed** | namespaced `flags` from `manifestFlags`, merged over any declared                                 |

**Declaring a derived key is an error, not an override.** An authored `version`
would look authoritative, sit there unread, and disagree with the shipped
package forever; the build says so, naming the key and where the value actually
comes from.

`packs` is derived from the **one** pack list at the top level of
`content-build.config.yaml` — each entry's `label`, `type`, `name` and
`private`, plus a `system` from `stats.systemId` and a `path` of
`packs/<name>`. Companions are flattened in, because Foundry sees no difference:
a companion is only a pack written by another pass rather than one of its own.
Give each pack the `label` you want Foundry to show.

`compatibility` and `relationships` are read from the **top level** of the
shared configuration, not from this section — content-build consumes them
(`supportedCoreVersion`, and a module'''s `stats.systemVersion`) and the
dependency runs one way.

**Why one file and not two.** Two of the values this package needs —
`packageKind` and `foundryPackage` — are already declared for `content-build`. A
second config file would restate them, which is two places for one fact; that is
exactly what every consumer's `push-stage.mjs` did, hard-coding
`packageKind: "systems"` and `packageId: "sohl"` beside a configuration that
already said both.

`content-build` checks only that `packageBuild:` is a mapping and hands it back
frozen. Everything inside it is validated here, so neither package learns the
other's schema — they split by input, and the dependency runs one way.

**What is derived, not stated:**

| Field                      | Derived from                                                                |
| -------------------------- | --------------------------------------------------------------------------- |
| the repository root        | the configuration file's own location                                       |
| `packageKind`, `packageId` | the shared configuration's top level                                        |
| the release artifact       | `packageKind` — a system ships `system.json`, a module `module.json`        |
| the bundle entry           | `packageId` — `<id>.mjs`, unless `packageBuild.bundle.entry` says otherwise |

## Command line

```
npx package-build clean [--distclean]
npx package-build assets
npx package-build manifest
npx package-build lang check
npx package-build lang coverage [--unused]
npx package-build lang hardcoded
npx package-build bundle check
npx package-build release
npx package-build deploy <stage>
```

Wrapped as npm scripts — SoHL spells them:

```json
{
  "clean": "package-build clean",
  "distclean": "package-build clean --distclean",
  "build:assets": "package-build assets",
  "lint:lang": "package-build lang check",
  "lint:lang-coverage": "package-build lang coverage",
  "lint:lang-hardcoded": "package-build lang hardcoded",
  "lint:bundle-globals": "package-build bundle check",
  "build:pack-release": "package-build release",
  "push:qa": "package-build deploy qa"
}
```

**The shape of the surface.** A capability with a single operation is a bare
command (`clean`, `assets`, `manifest`, `release`, `deploy <stage>`); one with
more than a single operation takes a positional action, so a second can be added
without renaming the first (`lang check`, `bundle check`). Flat `lang:check`
names would make every operation a new top-level command and hide which ones
belong together.

**What the two localization guards ask.** They are deliberate opposites, and
neither can answer the other's question. `lang coverage` walks _key → file_, so
it is completely blind to a template that names no key whatsoever; `lang
hardcoded` walks _text → key_, and catches exactly that. Before the work that
prompted the second, Song of Heroic Lands had **516 hardcoded English literals
across 61 templates** — translating every key in `en.json` would have left every
one of them in English.

**Contributing generated keys.** `packageBuild.lang.references` names a module
exporting `references(context)`, called once with
`{ config, rootDir, roots, files }` — `files` being the scanned sources as
`{ path, text }`, already read, so the contributor sees exactly the text the
built-in scan saw. It returns a reference set:

```js
export function references({ files }) {
  return {
    keys: [
      // `exact` when the key is minted whole, so keys sitting beneath it do
      // not vouch for it; `origin` is the verb phrase the message reads with.
      {
        key: "SOHL.Skill.CODE.lore",
        file: "src/utils/constants.ts",
        line: 42,
        exact: true,
        origin: "defineType generates",
      },
    ],
    namespaces: ["SOHL.Skill.CODE"], // families whose leaves are never named
    patterns: ["SOHL.Skill.*.label"], // shapes, `*` standing for one segment
    findings: [], // whatever the contributor could not resolve
  };
}
```

Everything Foundry-shaped is already built in — `{{localize}}`,
`game.i18n.localize` / `format`, keys in string and template literals, a
DataModel's `LOCALIZATION_PREFIXES`, the `FIELDS.<field>.label` / `.hint` keys Foundry
mints off one. A contributor is for what only the repository knows.

**What `bundle check` checks.** Three ways a package builds successfully and
still does not load, none of which a bundler can see, because each is a
disagreement between two files rather than a fault in either:

| The manifest says                                                         | What Foundry does                                                                  |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| the entry under both `esmodules` and `scripts`                            | loads the bundle twice                                                             |
| the entry under neither                                                   | never loads it at all                                                              |
| the entry under `esmodules`, but the file only parses as a classic script | fails at load, naming whichever `import` came first and nothing about the manifest |

It reads both files from the stage, because the stage is what ships — checking
sources would answer for a package nobody installs. Findings are emitted as
`file:line:column: severity: message`, and the command exits non-zero when any
of them is an error.

**Why the CLI exists.** This package was library-only, so every consuming
repository wrote a wrapper script per job — six of them in the SoHL repository,
441 lines that between them contained no logic. `clean.mjs` was 47 lines that
computed a `repoRoot` from `import.meta.url`, read one flag, and made one call.
Every copy had drifted from its sibling in the other repositories, because
copies do: `clean.mjs` was 47 lines in one and 48 in another, `copy-assets.mjs`
71 and 76.

It is the same shape the configuration had before it became data — not logic,
but the boilerplate a code file needs in order to state a literal. The literals
moved into configuration; the boilerplate lives in the CLI, once.

`--version` and `--help` answer in a directory with no configuration at all.
Running an actual command resolves it, and fails loudly when it is missing.

## Design

**The rules are pure, and I/O is confined to functions named for it.** A rule
takes source text or data and returns findings or values; discovery and
reporting stay with the caller. Where a step genuinely has to touch disk or a
network it is an export named for what it does — `writeFoundryManifest`,
`stageAssets`, `packRelease`, `deployStage`.

That is what lets one rule set serve a `lint` script, a build step and a unit
test without any of them agreeing on how files are found or how findings are
printed — and it is what makes the rules testable at all, which the scripts they
were extracted from were not: each ran its work at import time and exported
nothing.

Findings carry the fields the shared diagnostic format takes (`line`, `column`,
`severity`, `message`) but never `file`, which only the caller knows. The format
itself is owned by `@heroiclands/content-build`'s `engine/diagnostics`, and is
not restated here.

```js
import { validateLangSource } from "@heroiclands/package-build/lang";

for (const file of globSync("lang/*.json")) {
  for (const finding of validateLangSource(readFileSync(file, "utf8"))) {
    reportDiagnostic({ file, ...finding });
  }
}
```

## Tests

```
npm test
```

Plain `vitest`, no setup file and no aliases: everything here is ESM over Node
built-ins and three dependencies, and a harness that offered a Foundry global
would let something reach for one.

`tests/dependencies-are-declared.test.ts` is the guard an extraction most needs
— every bare specifier in a shipped file must be a builtin, this package, or a
declared `dependency`. Inside a workspace a missing declaration is invisible;
installed from npm it fails on the first import.

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
request saying so. The previous, hand-driven process failed by leaving _nothing_
behind when its final step was forgotten (#4).

**Merging that publishes.** `changeset publish` puts the version on npm through
Trusted Publishing (OIDC — there is no `NPM_TOKEN`), tags the commit `v<version>`
and cuts the GitHub Release with the changelog section as its body. It publishes
only versions that are not already on the registry, so re-running it is a no-op;
`workflow_dispatch` on **Publish to npm** is the recovery path if a run fails
after versioning.

A changeset is also where a **raised dependency floor** gets recorded. 0.2.0 began
requiring `@heroiclands/content-build >= 0.15.0` and announced it nowhere; a
changeset is the place that now happens.

Below 1.0.0, `^0.x` never crosses a minor — a consumer on `^0.2.0` will not see
`0.3.0` until it bumps the pin deliberately, and Dependabot raises that as its own
pull request.

> After a successful publish, `npm view @heroiclands/package-build version` can
> report the _previous_ version for a minute or so. `dist-tags` is correct
> immediately, and is what the workflow prints.

## Licence

GPL-3.0-or-later.
