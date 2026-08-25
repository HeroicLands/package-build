# @heroiclands/package-build

## 3.0.0

### Major Changes

- 3e6a6d7: Absorb `@heroiclands/content-build`. The two packages are one.
  
  They split by input — content-build read `assets/content/**`, this package read
  `lang/`, `styles/`, `src/` and the manifest template — on the theory that a
  module would use one or the other. No consumer ever did: all three installed
  both, and this package depended on the other besides. What the boundary cost was
  a configuration file with two owners, two CLIs with a colliding `manifest`
  command, and a two-repository dance for changes that touched a single idea.
  
  Nothing about how a build works changed. Same modules, same CLI commands, same
  configuration keys, one name.
  
  **Breaking:**
  
  - `@heroiclands/content-build/*` specifiers become `@heroiclands/package-build/*`.
  - The content configuration contract moves from `./config` to `./content-config`,
    because both packages exported a `./config` meaning different things. This
    package's own `./config` is unchanged.
  - **The configuration file is renamed**: `content-build.config.{yaml,yml,mjs}`
    becomes `package-build.config.{yaml,yml,mjs}`, matching the one package that
    now reads it. The old stem is not accepted — a deprecation window would let a
    repository sit on a filename naming a package that no longer exists. Every key
    inside the file is unchanged.
  - `CONTENT_BUILD_CONFIG` becomes `PACKAGE_BUILD_CONFIG`. The old name is not read.
  - `@heroiclands/content-build` is deprecated and gets no further releases.
  
  **Unchanged:** every configuration key, every CLI command and flag — `content-build`
  and `package-build` are both bin entries of the merged package — every engine and
  `sohl` module export, and every compiled document id.
  
  See `MIGRATING.md`.

### Patch Changes

- 968fed8: Stop publishing a relationship's build-only keys into the manifest.
  
  `relationships` was copied verbatim out of `content-build.config.yaml`, and that
  block now has a second reader: content-build 1.8.0 added `itemCatalog: true` as
  an opt-in on a declared dependency, selecting that package's Item packs as a
  resolution source for the actors pass. It is a directive to the build, not a
  fact about the shipped package — so `sohl-kethira-basic` shipped a `module.json`
  whose `relationships.systems[0]` carried `"itemCatalog": true` beside `id`,
  `manifest` and `compatibility`, with nothing to tell a consumer which was which.
  Foundry's relationship schema does not define the key; nothing broke, because
  Foundry ignores what it does not know.
  
  The fix is the distinction rather than the one name: `BUILD_ONLY_RELATIONSHIP_KEYS`
  lists the keys that answer _how is this built?_, and `publishedRelationships`
  drops them on the way into the manifest. Everything else is copied — including a
  key this package has never heard of, on the same reasoning that lets a declared
  manifest key through unread. A list is enough here, and needs no prefix agreed
  between the two packages, because content-build already normalises a
  relationship to a closed set of keys and rejects the rest at configuration time.

## 0.6.1

### Patch Changes

- e5cfbbb: Move the release workflow to `changesets/action@v2`.
  
  v2 renamed four of the inputs this workflow passes — `version` →
  `version-script`, `publish` → `publish-script`, `commit` → `commit-message`,
  `title` → `pr-title` — and **rejects the old names outright** rather than
  warning and carrying on. So the bump and the rename have to land in the same
  commit.
  
  Taken deliberately rather than waiting for Dependabot, because Dependabot bumps
  the pin without touching the inputs, and that combination has already broken the
  release pipeline in three sibling repositories:
  Song-of-Heroic-Lands-FoundryVTT#1729, sohl-thalorna#71 and
  sohl-kethira-basic#42. In the first of those it went unnoticed for over two
  weeks — a failing release job looks exactly like a repository nobody has
  released lately.
  
  Nothing else had to move: `version-script` already calls an npm script (#25), and
  one command is what v2's tokenized, never-shelled input requires.
- d4a5a6e: Take `@heroiclands/content-build` 1.8.2.
  
  The declared range was `^1.0.0`, which permitted this all along — the lockfile
  was the thing four minors behind, pinned at **1.4.0**. So the two packages were
  built and tested against a version no consumer would actually resolve. Pinning
  the range at `^1.8.2` and refreshing the lockfile makes what CI tests and what a
  consumer installs the same thing.
  
  The jump matters more than a patch bump suggests: package-build imports
  `loadPackConfig` from `content-build/engine/pack-config`, and 1.4.0 predates
  both the move to YAML configuration and the switch to lazy config accessors.
  Verified against the new version rather than assumed — 293 tests pass,
  `build:types` and `format:check` are clean, and the CLI resolves its
  configuration and lists its commands.

## 0.6.0

### Minor Changes

- 53dd83b: **Commands for the Foundry container and the end-to-end harness** (#18).
  
  A package that declares a `compatibility` range is making a promise, and until
  now exactly one repository could defend it: container lifecycle, world seeding
  and the browser harness all lived in `SoHL/utils/`, so two of three HeroicLands
  module repositories declared a range nothing could test.
  
  Two new commands:
  
  ```
  package-build container <stage> <start|stop|restart|recreate|rm|status|logs|pull>
  package-build e2e <seed|run|open|fast|sweep>
  ```
  
  **Nothing about the destination is restated.** A container mounts
  `FOUNDRYVTT_<STAGE>_DATA` — the variable `deploy` already writes into — so
  serving what was just deployed is the next step from one variable rather than a
  second configuration. Stage ports, the container name, the world id and the GM
  credentials all derive from what the repository already declares.
  
  **The end-to-end stage is pinned to `compatibility.minimum`.** The claim and the
  evidence for it are now literally the same number, so raising the pin is what it
  should be: a decision to raise the supported floor. `FOUNDRYVTT_<STAGE>_VERSION`
  still wins for a one-off, and `e2e sweep <build>` runs the full suite against a
  build the repository does _not_ pin, so `compatibility.verified` can be evidence.
  
  **The wait is for an active world, not an open port.** Foundry answers on its
  port long before a world is serving, and a suite started then fails every spec
  for no visible reason. A licence failure — which never recovers — is read out of
  the container log and reported at once.
  
  **What the suite _is_ stays the consumer's**, named in `packageBuild.e2e.suite`
  the way `assetTransform` and `manifestFlags` are named. So does the seed world's
  extra content, in `packageBuild.e2e.documents`. A **module** package additionally
  gets `core.moduleConfiguration` seeded, without which its suite would run against
  a world that never loaded it.
  
  New configuration, all optional: `packageBuild.container.{image,stages}` and
  `packageBuild.e2e.{stage,suite,build,world,gm,documents}`. New subpath exports
  `./container` and `./e2e`. Adds `@foundryvtt/foundryvtt-cli` as a dependency —
  seeding a world means compiling its LevelDB collections.
- 3c631c3: Add the two localization guards that keep a package translated: `lang coverage`
  and `lang hardcoded` (#19).
  
  `lang check` already asked whether a localization file is _shippable_. Neither
  of the questions that decide whether it is _translated_ was asked anywhere but
  in the Song of Heroic Lands repository, in two scripts of its own — and both
  satellites ship `lang/` files with no guard at all.
  
  **`lang coverage`** — every key the package references exists, and every key it
  declares is referenced. The two halves are not the same severity: a referenced
  key that is missing renders to a player as its own raw key string and fails the
  run; a declared key nothing references is reported and does not, because no scan
  sees every way a key is reached and a guard that fails over one teaches people
  to switch it off.
  
  **`lang hardcoded`** — every user-visible literal in the templates goes through
  localization, and every template still compiles once it does. This is the
  _reverse_ walk, and it is the reason both exist: coverage walks key → file and
  is blind to a template that names no key whatsoever. Before the work that
  prompted this guard, SoHL had 516 hardcoded English literals across 61
  templates, and translating every key in `en.json` would have left every one of
  them in English.
  
  **What a repository states.** Which files to scan is configuration and defaults
  to the conventional layout, so a repository that follows it declares nothing.
  The escape hatches — a key retained despite looking unreferenced, a literal
  allowed despite looking like prose — each carry a required `reason`, because
  each is a claim a reviewer has to be able to check.
  
  **What stays the repository's.** `packageBuild.lang.references` names a module
  exporting `references(context) -> ReferenceSet`, contributing the keys only that
  repository's conventions can find — SoHL's `defineType(prefix, def)` mints one
  key per member of an enum by a rule of its own. Everything Foundry-shaped is
  built in: `{{localize}}`, `game.i18n.localize` / `format`, keys in string and
  template literals, a DataModel's `LOCALIZATION_PREFIXES`, and the field
  `label` / `hint` keys Foundry mints off one.
  
  Scripts are read through the **AST**, so a key named in a JSDoc `@example` is
  neither required to exist nor able to keep a dead key alive. `typescript` and
  `handlebars` become runtime dependencies for that reason.

## 0.5.0

### Minor Changes

- 905254d: **`text.mjs` is deleted; the one implementation lives with the diagnostics
  contract it serves.**
  
  `locateInText` and `positionOf` computed which line and column a substring sits
  on. `@heroiclands/content-build` computes the same thing in
  `engine/diagnostics.mjs` as `positionOfLiteral`, and has said so in a comment
  for some time:
  
  > That is a duplicate worth naming: unlike the diagnostic _format_ or a
  > validation _rule_, "which line and column is this substring on" has exactly
  > one correct answer and cannot drift into disagreement. The tidier arrangement
  > is for that package to re-export this one — the dependency runs that way — and
  > it should, next time either is touched.
  
  This is that time. Rather than re-export, the module is removed outright: the
  `./text` subpath was a library surface with one internal caller (`lang.mjs`) and
  one external one, and this package's job is a command line, not a text-utility
  grab bag.
  
  **Breaking for anyone importing `@heroiclands/package-build/text`.** Import
  `positionOfLiteral` from `@heroiclands/content-build/engine/diagnostics`
  instead; it is the same arithmetic, and returns `{}` rather than `undefined`
  when the literal is absent — the shape the diagnostics contract already spreads.
  `locateInText` had no callers anywhere and is simply gone.

## 0.4.0

### Minor Changes

- 2c2fc37: **`package-build bundle check` — the last capability that had no command.**
  
  The bundle-loading check was exported as a library function and reachable no
  other way, so a consumer that wanted it had to write the script the command line
  exists to remove: read the manifest, read the bundle, call the function, decide
  how to print findings, choose an exit code. It now runs from configuration like
  every other job.
  
  It catches three ways a package builds successfully and still does not load,
  none of which a bundler can see, because each is a disagreement between two
  files rather than a fault in either:
  
  | The manifest says                                                         | What Foundry does                                                                  |
  | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
  | the entry under both `esmodules` and `scripts`                            | loads the bundle twice                                                             |
  | the entry under neither                                                   | never loads it at all                                                              |
  | the entry under `esmodules`, but the file only parses as a classic script | fails at load, naming whichever `import` came first and nothing about the manifest |
  
  Both files are read from the stage, because the stage is what ships.
  
  **The entry is derived, not stated.** `packageBuild.bundle.entry` defaults to
  `<packageId>.mjs`, which is already derived from `package.json` `name`; a
  repository states it only when its bundler emits something else. It is
  deliberately _not_ read back out of the generated manifest — a value taken from
  there would agree with itself by construction, and the check's whole question is
  whether the manifest declares this file the way Foundry needs it.
  
  **Reporting is now decided once.** `lang check` had the diagnostic contract —
  `file:line:column: severity: message`, the path starting the line, a field
  dropped rather than guessed — spelled out inline in its handler. Both commands
  now report through one seam that maps findings onto the format
  `@heroiclands/content-build` already owns, so the two packages cannot drift into
  two nearly-identical formats. `lang check`'s output is unchanged.
  
  **The command surface has a stated shape.** A capability with a single operation
  is a bare command (`clean`, `assets`, `manifest`, `release`, `deploy <stage>`);
  one with more than a single operation takes a positional action, so a second can
  be added without renaming the first (`lang check`, `bundle check`).
  
  Closes #12

## 0.3.0

### Minor Changes

- 0a2ef1e: **The Foundry manifest is generated from configuration. The template is
  retired.**
  
  `package-build manifest` writes `system.json` / `module.json` from
  `packageBuild.manifest` plus the facts the build already holds. There is no
  `assets/templates/*.template.json`, and the template-reading path is removed
  rather than left as a fallback: `writeFoundryManifest`, `stampManifest` and
  `artifactFromTemplate` are gone, replaced by `buildManifest`, `writeManifest`
  and `manifestPacks`.
  
  The manifest was the one build input still hand-authored JSON, per repository,
  with no schema and nothing checking it — and it declared facts the configuration
  already declared. SoHL's pack list was written twice, in two formats, with
  nothing checking the pairs agreed; `sohl-kethira-basic` hand-maintained its whole
  `module.json`, and its `download` named an older version than the module claimed.
  
  Three kinds of key end up in the result:
  
  - **Declared** — `packageBuild.manifest`, emitted unchanged, so a key Foundry
    adds in a later version needs no release of this package. The block is
    deliberately not key-checked; pass-through and unknown-key checking cannot
    coexist, which is why it is its own block rather than spread across
    `packageBuild:` where the keys around it are still checked.
  - **Derived** — `id`, `version`, `url`, `bugs`, `manifest`, `download`,
    `compatibility`, `relationships`, `packs`. Declaring one is an **error**
    naming the key and where the value actually comes from, not an override: an
    authored copy would be silently overwritten and the two would disagree with
    nothing to say so.
  - **Computed** — namespaced `flags` from a module named in
    `packageBuild.manifestFlags`, merged over any declared. That is for a value a
    repository must work out rather than state — SoHL's credits `@UUID` only
    exists once the content tree has been walked.
  
  `packs` comes from the **one** pack list at the top level of
  `content-build.config.yaml`, with companions flattened in. Give each pack the
  `label` Foundry should show; everything else is derived.
  
  Requires `@heroiclands/content-build` **1.0.0**, which moved `compatibility` and
  `relationships` to the top level (content-build#50).
  
  Verified against SoHL's real package: the generated manifest is **byte-identical**
  to what its template pipeline produces today, all 24 keys, key order included.

## 0.2.1

### Patch Changes

- 4144291: **Release from merged changesets instead of a remembered command**
  
  Fixes [#4](https://github.com/HeroicLands/package-build/issues/4). Releasing was
  hand-driven — bump `package.json` on a branch, merge, then remember
  `gh release create`, because cutting the Release is what published. Nothing
  enforced the last step, so a merged version could sit unpublished with no check
  red; the sibling repository lost two versions that way.
  
  - Every pull request now declares its bump as a `.changeset/*.md` file, and CI's
    **Changeset declared** job fails one that does not. `npx changeset add --empty`
    is how a change says it needs no release — explicitly, rather than by omission.
  - Merging to `main` opens a **Version Packages** pull request carrying the bump
    and the rewritten `CHANGELOG.md`. An unreleased state is now a pull request
    waiting in the queue rather than nothing at all.
  - Merging that runs `changeset publish`: npm publish, the `v<version>` tag, and
    the GitHub Release with the changelog section as its body. The OIDC Trusted
    Publishing step is unchanged and still last; there is still no `NPM_TOKEN`, and
    re-running on a published version is a no-op.
  - `CHANGELOG.md` is seeded from the two hand-cut Releases so far and now ships
    with the package. A changeset is also where a raised dependency floor gets
    recorded — 0.2.0 raised one to `@heroiclands/content-build >= 0.15.0` and said
    so nowhere.

<!-- Sections at 0.2.1 and above are generated by `changeset version` from the
     changesets merged into `main`. Sections at 0.2.0 and below predate that
     pipeline and are the hand-written GitHub Release notes, kept verbatim
     (headings demoted one level to sit under their version) so no history was
     lost in adopting it. -->

## 0.2.0

_2026-08-22 — a command line, not a wrapper script per job_

**A command line, so a consumer writes configuration instead of scripts.**

This package was library-only, so every consuming repository wrote a wrapper script per job — six of them in the Song of Heroic Lands repository, 441 lines that between them contained no logic:

| Wrapper | Lines | What was in it |
| --- | --- | --- |
| `build-system-json.mjs` | 143 | |
| `push-stage.mjs` | 76 | argv, dotenv, then `packageKind: "systems"` and `packageId: "sohl"` hard-coded beside a configuration that already declared both |
| `copy-assets.mjs` | 71 | a nine-entry data table, plus one genuine repository-specific transform |
| `check-lang.mjs` | 69 | a glob, a call, and a help string |
| `clean.mjs` | 47 | a `repoRoot` from `import.meta.url`, one flag, one call — no consumer-specific value at all |
| `pack-release.mjs` | 35 | one call passing `{ artifact: "system" }`, which `packageKind` already decides |

Every copy had drifted from its sibling in the other repositories, because copies do: `clean.mjs` was 47 lines in SoHL and 48 in `sohl-thalorna`, `copy-assets.mjs` 71 and 76. `sohl-thalorna`'s copy still reimplements the recursive directory copy this package has exported since it was extracted, because it was written before the extraction and nobody went back.

It is the same shape the configuration had before it became data: not logic, but the boilerplate a code file needs in order to *state a literal*. So the literals moved into configuration, and the boilerplate lives here, once.

#### The commands

```
npx package-build clean [--distclean]
npx package-build assets
npx package-build lang check
npx package-build release
npx package-build deploy <stage>
```

Wrapped as npm scripts:

```json
{
  "clean": "package-build clean",
  "build:assets": "package-build assets",
  "lint:lang": "package-build lang check",
  "build:pack-release": "package-build release",
  "push:qa": "package-build deploy qa"
}
```

#### One configuration file, not two

Settings come from the reserved `packageBuild:` section of `content-build.config.yaml` — the file a repository already has — which requires **`@heroiclands/content-build` 0.15.0 or later**.

```yaml
packageKind: systems      # read from the top level, never restated below
foundryPackage: sohl

packageBuild:
    assets:
        - { from: lang, to: lang }
    assetTransform: ./utils/svg-theme.mjs
    clean:
        extra: [site/content, site/public]
    deploy:
        envPrefix: SOHL
```

A second config file would have restated `packageKind` and `foundryPackage`, which is two places for one fact. content-build validates only that the section is a mapping and hands it back frozen; everything inside it is validated here, so neither package learns the other's schema.

**Derived, never stated:** the repository root (the config file's own location), `packageKind` and `packageId` (the shared configuration's top level), and the release artifact — a system ships `system.json`, a module `module.json`, so the kind already decides it.

**The one genuine piece of consumer code stays the consumer's.** SoHL rewrites each SVG's hard-coded fill so icons follow the Foundry theme; `packageBuild.assetTransform` names a module exporting `transform(sourcePath) -> string | null`.

#### Also in this release

- `exports["./config"]` now ships its type declaration. It was declared but never generated — `tsconfig.dts.json` lists its inputs explicitly and `config.mjs` was missing from the list — so the subpath would have pointed at a file that does not exist.
- The library modules are unchanged. Every signature the CLI needed was already there.

#### Notes

`--version` and `--help` answer in a directory with no configuration at all. Failures report one line rather than a stack, whether the handler was synchronous or asynchronous. Localization findings follow the diagnostics contract, `file:line:column: severity: message`.

**Full changelog:** https://github.com/HeroicLands/package-build/compare/v0.1.0...v0.2.0

## 0.1.0

_2026-08-22 — the Foundry package toolchain_

The counterpart to [`@heroiclands/content-build`](https://github.com/HeroicLands/content-build). The two split by **input**, not by repository: content-build reads `assets/content/**` and answers for what a package *says*; this one reads `lang/`, `styles/`, `src/`, `assets/` and the manifest template, and answers for what a package *is* — the parts Foundry loads whether or not the package ships any content.

A module uses either, or both. An adventure module that ships only notes needs no bundler; a variant module that ships only behavior needs no Markdown pipeline. The coupling runs one way: package-build asks content-build for the compiled `packs[]` block, never the reverse.

### Seven modules — the whole of assemble → validate → ship

- **`manifest`** — `system.json` / `module.json`. The artifact is inferred from the template's name, and every address is derived from `package.json`'s `repository` rather than transcribed. Handles the `git+https://….git` spelling npm writes, which yields a 404 on every Foundry update check if left in place.
- **`stage`** — assembling the build stage and clearing it away. A listed asset that does not exist **fails the build** instead of shipping a package that quietly lacks its localization or templates; the whole list is checked before anything is copied.
- **`lang`** — what a shippable localization file must satisfy: it parses, its top level is an object, no key is both a leaf and a dotted prefix of another (which makes Foundry discard the entire file), placeholders are single-braced, key segments carry no data.
- **`bundle`** — whether the manifest agrees with the file it points at. Declared under `"esmodules"` the bundle must parse as a module; declared under `"scripts"` it must declare **nothing** at top level, because each top-level declaration in a classic script is a global lexical binding and one colliding with a non-configurable `window` property throws at parse time. That rule bricked SoHL v0.8.0.
- **`release`** — the two assets a GitHub Release carries. Waits for the archive to be *written*, not merely finalized.
- **`deploy`** — installing into a Foundry data directory, local or SFTP, always as a staged atomic swap: a running Foundry holds its LevelDB packs open, and replacing them in place leaves a directory LevelDB "repairs" to zero.
- **`text`** — locating a literal, so a finding names its line and column.

### Design

The rules are pure functions over data; the functions that touch disk or a network are named for what they do. That is what makes them testable at all — the scripts they were extracted from each ran their work at import time and exported nothing.

### Provenance

Developed as a workspace inside the Song of Heroic Lands repository across six changes (SoHL#1680, #1682, #1684, #1685, #1686), exactly as content-build incubated before its own extraction, and extracted now that its shape has stopped changing.

128 tests; declaration files are emitted from the JSDoc at pack time.
