# @heroiclands/package-build

## 4.0.0

### Major Changes

- 8cfa834: Reject `package:` in a note's frontmatter (#56).
  
  A note's package is the repository's configured `contentPackage`, full stop. A
  note that declares the field fails the build, naming the file — **whatever the
  value says**. An agreeing declaration is refused exactly as a disagreeing one
  is: there is no value that makes writing the field correct, and a field accepted
  while it agrees is a field that grows back one note at a time.
  
  ```text
  assets/content/Gear/Axe.md:12:1: error: `package: sohl` is a retired frontmatter field — delete it. A note's package is this repository's configured `contentPackage` ("sohl", in package-build.config.yaml), and every note in the tree belongs to it.
  ```
  
  `content-build lint` reports every such note in one pass, so a tree can be
  checked before it is compiled; `package compile` and `manifest` refuse it.
  
  **This is the third and last step**, and the two before it are already released
  and adopted. 3.3.0 made the field optional so an absent one was normal and a
  disagreeing one was an error; every content tree on the org was then swept on
  that version — `sohl` (1,639 files), `thalorna` (1,716), `kethira` (363),
  `harnensemble` (2,517). Nothing this release refuses is authored anywhere today.
  
  **Why a major.** Consumers resolve `^3`, so a minor would reach every repository
  on the next Dependabot run. A major is adopted deliberately, one repository at a
  time, in a pull request that can also delete the field if any grew back — which
  is the whole mechanism that made the deprecate → migrate → remove sequence safe.
  
  **Migrating** is one line, and nothing else reads the field:
  
  ```bash
  find assets/content -name '*.md' -print0 | xargs -0 sed -i '' '/^package: /d'
  ```
  
  `package compile` then produces byte-identical output, because the value the
  build derives is the value the notes restated. See `MIGRATING.md`.
  
  **`contentPackage` is unaffected, and is not vestigial.** It is the address
  namespace — the first segment of every canonical key, the name of the emitted
  link manifest, and the package a cross-package wikilink writes. Retiring the
  frontmatter field is what leaves it as the single source of that value: every
  key is now derived from the configuration, where it used to come from two
  sources that happened to agree.
  
  **A generated table's `WHERE … and package = "<pkg>"` clause keeps matching** —
  45 such clauses across `sohl` and `thalorna` depend on it. The package is
  _synthesised_ into what the table search sees, from `contentPackage`; it is a
  search value, never an authored one.
  
  **API.** `engine/note-package.mjs` no longer exports `notePackage` — every call
  site takes `contentPackage` directly, so no key is derived from frontmatter
  anywhere — and `assertNotePackage` is now `assertNoDeclaredPackage`, which
  asserts the field's absence rather than answering which package a note belongs
  to. `expandNoteTables` no longer takes `pkg`: a table searches the whole tree,
  which is one package's notes and nothing else.
- ad7691f: Remove `draft:` from a note's frontmatter (#69).
  
  The field excluded a note from the compiled packs, from the link manifest and
  from a consuming site build — and **nothing reported the consequence**.
  `content-links.mjs`, `site-index.mjs` and `content-lint.mjs` never read it, so a
  wikilink into a drafted note was indistinguishable from a link to a note that
  does not exist, and no checker could say which. Its entire effect was to move a
  note from _published_ to _unresolvable_, in silence. It also suppressed real
  build failures: a note the compilers never reached could not fail on the defects
  it carried.
  
  Nothing used it. Across every HeroicLands content repository — `sohl`,
  `sohl-thalorna`, `sohl-kethira-basic`, `harn-ensemble`, `harn-adventures` — not
  one note declared it.
  
  **What changed**
  
  - The three readers are gone: the compile loop, the link-manifest walk, and the
    scenes pass's map collection. So are the `skippedDraft` tally, its `PassStats`
    field, and the `Skipped N draft(s)` log line.
  - A note declaring `draft:` now **fails the build**, naming the file and the
    line, whatever the value says — `draft: false` included, since it reads as
    "publish this note", which is what happens either way. A field left merely
    ignored reads to its author as though it still works, which is the same
    silence in a different place.
  - `content-build lint` reports it too, so a whole tree is answered at once
    rather than one note per build.
  
  **The `draft` _tag_ is untouched.** It is an authoring marker, read only by the
  generated-table pass for `FROM #draft` queries, and 268 `sohl-thalorna` notes
  carry it. An unfinished page is honest about being unfinished; a dropped link is
  silent.
  
  **Adopting**
  
  Nothing to sweep — no note in the org declares the field. A consumer that
  carries one deletes the line.
  
  This lands in the same major as the `package:` rejection (#56 step 3), so the
  two retired fields are one adoption rather than two. They are refused the same
  way, through the same diagnostic format and the same positioning, and the
  locator both need is now shared rather than written twice.

## 3.4.0

### Minor Changes

- 19df269: Stop emitting `assocMysteryCode` on a compiled mystical ability (#35).
  
  The `mysticalability` declaration named a field no SoHL DataModel receives.
  `MysticalAbilityDataModel` declares `subType`, `assocSkillCode`,
  `assocAffiliationCode`, `masteryLevelBase`, `improveFlag`, `levelBase` and
  `charges`, and nothing else — Foundry discards the extra key when the document
  is constructed, so every mystical ability in every consuming pack shipped a
  value that was thrown away at load, with nothing at compile or load time saying
  so.
  
  This is the exact inverse of #3 and has the same root cause: nothing compares a
  builder's emitted `system` block against the DataModel that receives it. #3 was a
  declared field the builder failed to emit; this is an emitted field the DataModel
  never declares. Both compile clean, both lose data silently, and an author cannot
  tell either from a correct build. The general check is #60.
  
  **The field was retired, not renamed.**
  Song-of-Heroic-Lands-FoundryVTT#973 deleted `assocMysteryCode` because nothing in
  production read the mystery it resolved to; #1012 later added
  `assocAffiliationCode` as a separate concept — the faction whose standing confers
  the ability. They look alike and mean different things, so the declaration is
  dropped rather than retargeted.
  
  **This changes emitted documents**, so a consumer wants a rebuild rather than a
  silent upgrade — though nothing downstream can have depended on the value:
  
  - `sohl` — nine notes authored the key, all of them blank. Corrected in
    Song-of-Heroic-Lands-FoundryVTT#1747.
  - `sohl-kethira-basic` — no note authors it; all 224 mystical abilities carried
    the builder's own `""`. Recompiling `main` with this change removes exactly
    those 224 lines and touches nothing else.
- dced8b2: Write the derived package into an emitted page's frontmatter (#65).
  
  `content-build site` copied a note's frontmatter to the page verbatim. Since
  3.3.0 a note need not declare `package:` — it is derived from the configured
  `contentPackage` — and `engine/site-build.mjs` resolved that value one line
  before it built the page, carrying it for the index, the table universe and the
  local-package set. It never reached the page's own frontmatter, so a swept tree
  published pages that said nothing about which package they belong to.
  
  **The visible symptom is the breadcrumb.**
  `@heroiclands/hugo-theme`'s `layouts/partials/breadcrumbs.html` reads
  `{{ $pkg := .Params.package | default "" }}` and builds the middle crumb from
  it. With no `package` the section is never resolved and the crumb degrades from
  a linked, labelled section to a bare, unlinked type slug:
  
  ```text
  before: Home > SoHL Affliction > Aconite   (linked)
  after:  Home > affliction       > Aconite   (bare)
  ```
  
  Consumer layouts reading the field directly degrade the same way — a `package`
  column renders blank.
  
  The fix is where the value was already known: `pageFrontmatter` spreads
  `package` after the note's own frontmatter, so a note that declares the field
  keeps its authored position and value and an unswept tree emits byte-identically,
  while a swept one regains the line it lost. The alternative — teaching every
  theme and consumer layout to default the package from a site parameter — pushes
  a fact the build already knows out to N consumers, and the theme deliberately
  carries no addresses.
  
  **This changes emitted output**, so a consumer wants a rebuild rather than a
  silent upgrade, which is why it is a minor rather than a patch — the same
  reasoning as #35. Verified against the swept `sohl` tree: 1,606 emitted content
  pages differ, none added or removed, and the only diff line class across the
  whole tree is the restored `package: sohl`. Rendering that tree, 1,600 pages
  differ and in exactly two ways — the breadcrumb's middle crumb, and a `package`
  column that was blank.
  
  `sohl-thalorna` has the same defect independently, in its own
  `utils/build-site-content.mjs`, and is fixed in that repository
  (sohl-thalorna#79) — two emitters, one behaviour, which is a second argument
  for #36.

## 3.3.0

### Minor Changes

- 1f6eb85: Compile an unopened skill's opening mastery level into the actor pack.
  
  A skill embedded on a being carries `masteryLevelBase: null` when neither the
  catalogue entry nor the note states one — `null` meaning _not yet opened_. The
  client filled that in on import, at Skill Base × `initSkillMult`
  (`SkillLogic.initialize`), so a compiled being said nothing about what its
  skills open at. It materialised on import instead of being visible in the
  document, reviewable in a diff, or testable without standing up Foundry.
  
  The actors pass now computes it. `openUnopenedSkills` runs at the end of
  `buildEmbeddedItems`, after the note's frontmatter has been merged onto the
  catalogue skill and after the attribute items exist — the Skill Base formula
  reads the actor's attributes, so it cannot run any earlier. Only nulls are
  filled; a skill that states a `masteryLevelBase` keeps it.
  
  Evaluating `skillBaseFormula` needs an expression evaluator, which this package
  had none of. `sohl/skill-base.mjs` reproduces the part of SoHL's
  `SafeExpression` that a Skill Base uses: numeric literals, `attr.<code>` reads
  defaulting to `0`, arithmetic, and a small helper set including `sb()` — whose
  rounding (a pair averages up only when the primary is the greater) and whose
  `Math.max(0, n)` clamp are copied from SoHL deliberately and must not drift. A
  formula outside that subset is reported, never guessed at.
  
  Two build-side rules the client does not need, neither of which changes what a
  client computes:
  
  - A zero or absent `initSkillMult` leaves `masteryLevelBase` null. The
    multiplier is the switch for whether a skill opens at all, so writing the `0`
    the arithmetic yields would claim the skill opened at zero rather than that it
    never opened.
  - A fractional product is an error, not a rounding. `masteryLevelBase` is an
    integer field, so there is no honest value to write — the same stance
    `resolveSkillAptitudes` takes on a fractional modifier.
  
  The scores used are the `scoreBase` values the pass just wrote, where the client
  resolves `attr.<code>` to an attribute's _effective_ score. They agree for a
  being carrying no attribute-altering effects, which is every being in content
  today; one that did carry such an effect would bake a Skill Base its client then
  disagrees with.
  
  Closes #46.
- e37d201: A note's package is the repository's `contentPackage`, and `package:` is
  optional.
  
  A note was compiled when its `package:` frontmatter matched the configured
  `contentPackage`, and skipped when it did not — silently, and tallied as
  `skippedOther`, the same bucket as the thousands of notes that legitimately
  belong to another pass. So a tree whose notes named a package no configuration
  answered to compiled **zero notes and exited 0**, which is the state the
  un-migrated `hm-loc-*` / `hm-adv-*` repositories are in today.
  
  Every content tree is single-package — each is single-sourced in the repository
  that ships it — so the field restated one constant about 6,200 times across the
  org. This is the first of three steps that retire it, and the only one that
  changes any code here:
  
  1. **Optional**, now. An absent `package:` is normal and the note compiles; a
     present one is accepted while it agrees with `contentPackage`, and is a
     **loud error naming the file** when it does not. Nothing a consumer authors
     has to change, which is what makes the sweep safe to land next.
  2. **Swept** out of every content tree, on this version.
  3. **Rejected** outright — a later major, once the sweeps have merged.
  
  **What changed**
  
  - `engine/note-package.mjs` is the new seam: `notePackage` derives the package
    a note belongs to, `assertNotePackage` refuses one that names another, and
    `searchableFrontmatter` presents a note to a generated table with its package
    present however the note spells it.
  - The compile loop no longer filters on the field. A note declaring another
    package is reported through the ordinary diagnostic channel
    (`file:line:column: error: …`), counted in `errorCount` so the build fails,
    and tallied as its own `PassStats.declined` — never folded into
    `skippedOther`, which is what made the original defect invisible.
  - The link manifest throws rather than skipping such a note: skipping it
    quietly is how a manifest came to claim a package publishes nothing.
  - **No key is derived from frontmatter any more.** The link index
    (`content-links`), the site index (`site-index`) and the site build's
    package grouping all take the derived value; the manifest emitter already
    took it from configuration. A note addresses identically whether or not it
    declares the field.
  - A generated table that scopes itself with `WHERE … and package = "<pkg>"` —
    the shape every collection note uses — keeps matching after the field is
    deleted, so a sweep is a mechanical deletion rather than a silent
    emptying of every table.
  
  **`contentPackage` is not becoming dead configuration.** Its selecting job is
  what is going; the value is the **address namespace** — the first segment of
  every canonical key, the name of the link manifest a build emits, and the
  package a cross-package wikilink writes. Its documentation now says so.
  
  Verified against the real `Song-of-Heroic-Lands-FoundryVTT` tree (1,606 notes):
  `build/packs-json` is byte-identical to `main`'s output both with the field
  present on every note and with it deleted from every note.
  
  Step 1 of #56. Steps 2 (the sweep) and 3 (rejection, a major) follow.

## 3.2.0

### Minor Changes

- a5f07a3: Let a system-agnostic module stamp no system version.
  
  #40 made `stats.systemId` optional. `stats.systemVersion` stayed mandatory and
  derived — from the `compatibility.verified` of a declared system relationship,
  throwing when there is none — and a data configuration may not declare it
  directly. A module that deliberately targets no system therefore could not be
  configured at all.
  
  Declaring the relationship is not an escape. Foundry's `_testSupportedSystems`
  returns true when a package declares no systems, but returns false when it
  declares some and none of them is installed. Naming `hm3` and `sohl` would make
  such a module unavailable to a world running anything else — the opposite of
  what a system-agnostic package is for.
  
  `shippedSystemVersion` now returns `null` when a module names **neither** a
  `stats.systemId` **nor** any `relationships.systems`, and `stats.systemVersion`
  is optional alongside it. Every other case is unchanged: a module that names a
  system but declares no usable relationship still throws, because that is the
  mistake #1548 added the guard for. The two signals together are what separate
  system-agnostic on purpose from a forgotten declaration.

## 3.1.0

### Minor Changes

- 40386b1: Build a pack from JSON that is already built, and declare the system per pack.
  
  The compile is two stages — content notes to `build/packs-json/<pack>/`, then
  that directory to LevelDB — but only the first could feed the second. A package
  whose packs are already Foundry JSON had no way in: generation runs first and
  refuses an empty content tree, so a package with no `assets/content` threw
  before the compile loop, and staging the files by hand did not survive
  `generatePack`'s `rmSync` of its destination.
  
  `packs[].prebuilt` names the directory a pack's per-document JSON already lives
  in. Generation is skipped for it and the compile reads from there, so
  `cleanPackEntry` and the Scene/Level integrity check still run — which is the
  reason to route through this toolchain rather than call `compilePack` directly.
  When every selected pack is prebuilt the content walk is skipped altogether.
  
  `prebuilt` may not be combined with `folders`, `companions` or `default`, and
  may not be declared on a companion. Each of those describes a generation pass,
  and a prebuilt pack has none; refusing is better than ignoring a folder file
  that can never be read.
  
  Separately, `stats.systemId` is now optional and `packs[].system` declares it
  per pack, falling back to the package-wide value and omitted from the manifest
  when neither is set. Every pack used to be emitted with one system id, which no
  package needing two could express. Foundry requires `system` on ActiveEffect,
  Actor and Item packs and on no others, and an Adventure pack that declares one
  is hidden from every other system.
- de6dc40: Let packages share one Foundry container, and so one signed licence.
  
  The container name was derived from the package id, and `--hostname` set to
  match. The hostname part is right — Foundry binds a signed licence to it, and a
  stable one is exactly what makes the signature survive a `recreate`. What was
  wrong is that the value could not be shared: `sohl` got `sohl-foundry-test` and
  `hm3` got `hm3-foundry-test`, so a `Config/license.json` signed for the first
  would not verify for the second, and one maintainer with one dev licence needed
  one per package.
  
  Neither fallback rescues it. Passing `FOUNDRYVTT_<STAGE>_LICENSE_KEY` makes the
  felddy image write the key **unsigned**, and Foundry v13+ refuses to start with
  `Software license requires signature`; omitting it makes the image fetch a key
  from the account, unsigned, same refusal. Signing is a one-time interactive step
  per host, so a second package's container could not come up without a second
  licence — or a re-signing that then broke the first.
  
  The rest of the shared-instance model already worked. `requireIsolatedDataRoot`
  refuses only the dev/qa/prod roots, so a shared **test** root was already
  allowed, and `resolveE2EWorld` already derives a distinct world id per package,
  so one data root already holds both systems and both worlds with `FOUNDRY_WORLD`
  choosing which launches. The container identity was the last package-scoped
  piece.
  
  So `packageBuild.container.name` declares it:
  
  ```yaml
  packageBuild:
    container:
      # Shared with the other HeroicLands packages so one signed Foundry
      # licence covers them all.
      name: heroiclands-foundry
  ```
  
  The stage is still appended — this declares `heroiclands-foundry-test`, not
  `heroiclands-foundry`. Sharing is meant to cross packages, not stages: two
  stages are two containers over two data roots, and docker names are unique, so a
  name used whole would have `container dev` find the `test` container already
  there, start it, and serve the test data root on the dev port. Nothing is
  declared by default, and the name stays `<packageId>-foundry-<stage>`.

## 3.0.1

### Patch Changes

- 73a7e60: Correct the release the merge is dated to: 3.0.0, not 2.0.0.
  
  The merge commit set `version` by hand _and_ carried a major changeset, so
  changesets bumped it a second time. `MIGRATING.md` was the live defect — it told
  a consumer to install `^2.0.0`, which resolves nowhere.

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
