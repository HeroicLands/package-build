# @heroiclands/content-build

## 1.8.2

### Patch Changes

- 1fb6b96: Move the release workflow to `changesets/action@v2`.

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

  Nothing else had to move: `version-script` already calls an npm script (#74), and
  one command is what v2's tokenized, never-shelled input requires.

## 1.8.1

### Patch Changes

- 9cbf2c4: Actually assign the foreign item catalogue onto the actors compiler.

  1.8.0 shipped `itemCatalog: true` and `deps fetch` in a state where they did
  nothing. The compiler destructured `foreignSourceDirs` and never assigned it, so
  `this.foreignSourceDirs` was always `undefined` and `loadItemsMap` fell back to
  its empty default. The catalogue was downloaded, extracted, cached — and
  silently dropped.

  The symptom was a compile that had changed in no way at all: `sohl-thalorna`
  with the feature fully switched on still reported all 26,220 unresolved items,
  and logged `Loaded 630 predefined items` — its own count, with none of sohl's
  1,224.

  Every test passed throughout, because they exercised the catalogue module in
  isolation and nothing exercised the wiring. A feature wired up wrong looks
  exactly like one switched off, so the regression test asserts the compiler keeps
  the directories it was constructed with, and was checked by mutation.

## 1.8.0

### Minor Changes

- 0bf5334: Resolve a being's embedded items against a dependency's shipped item catalogue.

  A repository that authors beings without holding the items they are assembled
  from could not compile an actors pack at all: the pass resolved against local
  Item packs and nothing else, so `sohl-thalorna` turning its actors pack on
  produced 26,220 unresolved-item errors.

  A declared relationship may now opt in with `itemCatalog: true`. Fetching
  downloads that package's release, extracts its Item packs with
  `@foundryvtt/foundryvtt-cli`, and hands the resulting directories to the actors
  pass, which reads them exactly as it reads a local pack.

  Three things it does deliberately:

  - **Pins, rather than following `latest`.** A published
    `releases/latest/download/…` URL is rewritten to the declared
    `compatibility.verified` version, so a build names one particular dependency
    and stays reproducible. Where the URL cannot be rewritten, the version that
    comes back is checked against `verified` instead — floating silently is not
    on offer.
  - **Never reaches the network during a compile.** Fetching is its own command,
    `content-build deps fetch`, and a compile with a cold cache fails naming it.
    The cache is version-keyed, so a second run costs nothing.
  - **Lets a local item shadow a foreign one.** Two local packs claiming one
    address still collide, because that is ambiguous; a repository's own
    `skill:awar` standing in front of the system's is not.

  New `paths.foreignCache` (`build/cache/foreign`) names where catalogues land.

## 1.7.0

### Minor Changes

- 189b795: Retire the address-alias rule (#79).

  `lint` required every note to repeat its own `type-shortcode` address in the
  top-level `aliases:` list. That served exactly one reader — **Obsidian**, so
  `[[type-shortcode]]` resolved in the editor — and no build ever read it: both
  resolvers parse the hyphen qualifier themselves, and the alias list feeds only
  the bare-alias fallback index.

  The project no longer authors in Obsidian, so the rule required a line of
  frontmatter per note for a reader that does not exist.

  `sohl-thalorna` had already dropped its aliases, which left its `lint` reporting
  **1,738 findings — one per note**, none of them a defect, burying the 120 that
  were real. With the rule retired that tree reports **0** address findings, and
  `sohl` (1,457 notes) and `sohl-kethira-basic` (363 notes) — which still carry
  their aliases — report 0 as well. An alias that is still there is simply an
  ordinary alias now.

  `isAddressAlias` and `auditNoteAliases` are removed with it. Neither was
  imported by anything but this package's own tests.

  _Verified output-neutral before the aliases were dropped:_ across 1,735 stripped
  notes, `package compile` produced byte-identical `build/packs-json` and the site
  build byte-identical `site/content`. Only `lint` ever disagreed.

  The two rules that remain are the ones about identity rather than tooling: a
  `shortcode` is ASCII-alphanumeric, and `(type, shortcode)` names one note.

## 1.6.0

### Minor Changes

- be6667e: Apply the shared markdown indentation in a repository that declares no Prettier
  config of its own (#76).

  `content-build format` fell back to the shared configuration object and passed
  it inline to Prettier. **Prettier applies an `overrides` block only while
  resolving a config file**, never to options handed to it directly, so the
  `**/*.md → tabWidth: 2` override was silently dropped and markdown was formatted
  at the global `tabWidth: 4`.

  Pointing `resolveConfig` at the shipped config file does not fix it either:
  Prettier matches an override's glob relative to **the config file's own
  directory**, and that file lives inside `node_modules`.

  **Only a consumer with no Prettier config was affected** — which is every
  repository this command was added for. One with a config resolves it from its
  own root and was always correct, which is why this repository and
  `Song-of-Heroic-Lands-FoundryVTT` both reported clean.

  Caught while adopting the command in `sohl-thalorna`: it proposed rewriting
  **1,738 content notes**, converting YAML frontmatter from 2-space to 4-space.
  SoHL's notes are 2-space, so that is precisely backwards for a configuration
  whose purpose is that a note formatted in one repository is formatted the same
  way in the next. Verified after the fix: a real thalorna note is now returned
  byte-identical, and the tree reports zero markdown findings.

  The values are now declared once as `PRETTIER_BASE` + `PRETTIER_MARKDOWN`, with
  `PRETTIER_CONFIG` composing them into the shape a config file wants and the new
  `sharedPrettierOptionsFor(file)` giving the runner the same values as flat
  options. One source, two presentations, and nothing passes `overrides` inline
  again.

## 1.5.0

### Minor Changes

- 4a86493: Carry a mystical ability's and a mystery's granting affiliation through to the
  compiled document (#3).

  `assocAffiliationCode` is a real field on both `MysticalAbilityDataModel` and
  `MysteryDataModel`, and neither type's declaration named it — so the builders,
  which are an allow-list, discarded it. In `sohl-kethira-basic` **204 of 224
  mysticalability notes set it to a real value**, and every one of them compiled
  without it: no mystical ability in that shipped pack was linked to the
  affiliation that grants it. `mystery` was missing `assocSkillCode` for the same
  reason.

  Both are declared `nullable: true, blank: false, initial: null` on their
  DataModels, so the new fields read blank as `null` rather than `""` — "unset" is
  one value, not two.

  **This changes emitted documents**, so a consumer whose notes set either field
  wants a rebuild rather than a silent upgrade.

  _Not fixed here:_ the silence itself. A `sohl:` key no declaration names is
  still dropped with no warning and no effect on the exit code, which is what made
  this cost 204 documents before anyone noticed — that is #19's unknown-property
  check. The inverse case, an emitted field no DataModel declares, is #70.

- d9ea689: Check a note's frontmatter against the schema its type declares (#19), and make
  the builders' allow-list loud (#3).

  `content-build lint` now checks frontmatter as well as addresses. Five classes,
  each previously reported somewhere other than where it was made, or not at all:

  - **Unknown or retired type**, told what replaced it.
  - **Missing required property** — `dimensions` on a map, `subType` on a skill.
  - **Wrong value shape** — `weight: heavy` where a number belongs.
  - **Unknown property**, with a near-miss suggestion. This is #3's second half:
    the builders discard a `sohl:` key no field declares, with no warning and no
    effect on the exit code, which is how 204 kethira mystical abilities shipped
    with no affiliation. An author could not tell a builder that forgot a field
    apart from a field that does not belong on the type at all.
  - **Dead shortcode reference**, resolved through the same resolver `links` uses,
    so a cross-package reference answered by a vendored manifest lands exactly as
    it would in a wikilink. `--no-references` turns it off for a tree whose
    cross-package references it cannot see.

  **A schema says what a note may _write_, not what the compiler emits.** That
  distinction is the calibration: a note also feeds a knowledgebase and a website,
  which read classification the pack build never compiles. Equating the vocabulary
  with the builder's allow-list reported 4,241 unknown properties against SoHL's
  own tree, every one correctly authored; declared properly, the same tree reports
  **nothing** across 1,457 notes.

  What that calibration then finds elsewhere is real: 120 findings in
  `sohl-thalorna` — including 44 mysteries still carrying the retired `trait`, a
  being on the retired `birthsign`, and a skill with no `subType` — and 270 in
  `sohl-kethira-basic`.

  **Expect a previously green tree to go red.** That is the point of the issue,
  not a regression: the findings were always there and nothing reported them.

  Two additions to a field declaration make this checkable: `kind`, a
  machine-readable value shape distinct from the prose `shape` (a field may
  declare one without changing a byte of what it emits), and `ref`, the content
  type a shortcode addresses.

- 97fcb9b: Own prose formatting and markdown linting, so a consumer invokes rather than
  configures (#69).

  Two new commands:

  - `content-build format [paths..] [--write]` — Prettier, with the shared
    configuration.
  - `content-build markdown [paths..] [--fix]` — markdownlint, with a narrow,
    individually justified rule set covering the structure Prettier is indifferent
    to: a skipped heading level, two sibling headings claiming one anchor, a
    reversed `(text)[url]`, a bare URL, an empty link, a table row with the wrong
    cell count, and the emphasis markers these repositories write.

  **Why here.** Nothing checked the _shape_ of the markdown this package compiles
  — `lint` checks addresses, `links` checks that links land. Each consumer wired
  prose checking itself, so coverage was lopsided: SoHL ran both tools, thalorna
  had Prettier but never from `lint`, and kethira had neither, leaving the package
  least likely to have been proofread checked for addresses and nothing else. This
  package is the only one all three consume.

  **Both are defaults, not overrides.** A consumer's own Prettier config or
  `.markdownlint-cli2.jsonc` wins. Repository-layout knowledge — which paths to
  skip — stays in that repository's `.prettierignore` and `.gitignore`, both
  honoured natively. `CHANGELOG.md` is skipped by default, since `changeset
version` regenerates it in every repository here.

  Neither tool's file discovery is reimplemented, so `content-build format` and a
  bare `prettier --check .` report the same thing — verified against SoHL's tree
  (2,470 files, identical result). A file Prettier cannot parse is reported as a
  located finding rather than taking the run down, which is how
  `sohl-kethira-basic`'s invalid `lang/en.json` was found
  (HeroicLands/sohl-kethira-basic#34).

  The shared rules are also exported for editors, so format-on-save agrees with
  the lint chain: `@heroiclands/content-build/prettier` and
  `@heroiclands/content-build/markdownlint`.

  _New runtime dependencies:_ `markdownlint-cli2`, and `prettier` moves from a dev
  dependency to a real one — the commands run them in process.

## 1.4.0

### Minor Changes

- 04577c7: **`content-build manifest` emits a package's link manifest, so no consumer
  writes the walk itself (#58).**

  `writeManifests` could always write a manifest; nothing could _derive_ one. So a
  repository that publishes one wrote the walk, the address derivation, the anchor
  pass and the entry assembly for itself — 285 lines in `sohl`, 300 in
  `sohl-thalorna` — and the two drifted in ways nobody chose. One routed its UUIDs
  through the pack router and one did not, so a repository shipping several packs
  of a type published UUIDs naming the wrong one.

  ```bash
  npx content-build manifest              # the configured tree and output directory
  npx content-build manifest --out tmp/   # or somewhere else
  ```

  It takes no paths. The content tree, the output directory, the two package
  identities and the address scheme all come from configuration; `[root]` and
  `--out` exist to point the same derivation at a scratch tree.

  **The base a manifest records against is gone from the interface, because it was
  never an input.** Both scripts built a site-absolute URL and handed
  `buildManifest` the base it was built from, whose first act is to strip that same
  prefix back off — the value provably never reached the file. Addresses are now
  derived package-relative from the start. What survives is the two-state
  distinction `publish.site` already carries: a build that publishes no pages emits
  entries with no `path`, exactly as a note that compiles into no document emits
  none with no `uuid`.

  **What genuinely differed between the two consumers is now one setting, shared
  with the page build.** Where the content tree mounts inside the package, and
  which note addresses a whole section rather than a page within one, are both
  load-bearing — `sohl` records `kb/affliction/aconite/` and `thalorna` records
  `affiliation/the-aerarium-imperii/` — and reading them in one place is what stops
  a manifest asserting an address the site does not publish:

  ```yaml
  publish:
    site: true
    manifests: { publish: true, consume: true }
    address:
      prefix: kb/ # default "" — the content tree mounts at the package root
      landing: readme # readme | collection
  ```

  `landing` names which note is a section's landing page: `readme` (a `README.md`
  addresses its section) or `collection` (a `doc` note whose `category` is
  `collection` addresses the section it introduces, named by its authored
  `section`). The two are alternatives, not a pair that could both apply — each
  live content tree holds notes the other rule would move.

  **Verified byte-for-byte against both consumers**: the command reproduces
  `sohl`'s manifest (2,691 entries from 1,457 notes) and `sohl-thalorna`'s (2,367
  entries) exactly as the scripts it replaces emit them, on the same toolchain.

  Also new:

  - `paths.manifestOut` (default `build/manifests`) — where the manifest is
    written. Deliberately not `paths.manifests`, which is the _inbound_ directory
    of vendored foreign manifests that `links` consumes.
  - `publish.manifests.publish` is enforced as a declaration rather than a
    preference: with it off, emitting fails instead of writing a file other
    repositories would vendor and read as authoritative. The check lives in the
    library, so a caller that bypasses the command cannot bypass the declaration.
  - A note the scheme yields no address for is reported as a located diagnostic and
    omitted, never guessed — the old scripts printed a loose list.
  - `engine/manifest-emit.mjs` exports the pass (`collectManifestEntries`,
    `entriesForNote`, `anchorsOf`, `emitLinkManifest`) for a consumer that needs a
    step of it rather than the whole command.

- 7ce0349: **`content-build site` publishes a content tree as a website, so no consumer
  writes the pipeline itself (#63).**

  Compiling a content tree into compendium packs was `content-build package
compile`. Publishing the _same tree_ as a website was a script each consumer
  wrote for itself — 473 code lines in `sohl`, 462 in `sohl-thalorna`, 87 of them
  identical — and the copies drifted where nobody could see it. `sohl-thalorna`
  reimplemented four things this package already exported, not because it needed
  different behaviour but because its script predates the extraction.

  ```bash
  npx content-build site               # the configured tree and output
  npx content-build site --out tmp/kb  # or somewhere else
  ```

  The command does the walk, the frontmatter read, the address derivation, the
  address index, table expansion, wikilink resolution, code-fence protection, the
  foreign-manifest merge, page emission, and the section-landing backfill.

  **Addresses are not part of the new `site:` section.** They come from
  `publish.address`, the same setting `manifest` reads, so a page and its manifest
  entry cannot disagree about where the page is. `site:` is framing only — the
  output root, the base, which packages are rendered, what a section is called,
  which extra trees are published beside the content, and which named pass bundle
  supplies the repository's own body rewrites.

  **Consumer passes are named, not imported.** A repository's own rewrites are
  code and a configuration is data, so a configuration names a bundle and the
  toolchain resolves it, exactly as `itemBuilders` names an item registry.
  `sohlKb` is the bundle for the `sohl` knowledgebase — `{@link}` against a
  TypeDoc symbol map, and repository-relative links in developer docs. A bundle
  supplies `beforeLinks` (every page, before wikilinks resolve) and `afterLinks`
  (extra-tree pages only), both inside code-fence protection.

  **Every gate reports; none exits.** The seven integrity checks — a wikilink in
  frontmatter, a name yielding no slug, two notes claiming one URL, an unusable or
  unaddressable vendored manifest, an address two packages both claim, a bad table
  or dead link — were inline `process.exit` calls in both scripts, with no test
  between them. They now return findings and the command decides, which is the
  only reason they can be tested at all.

  **Verified byte-for-byte**: the command reproduces `sohl`'s entire published tree
  — 1,520 files, 5,479,528 bytes — exactly as the script it replaces emits it.

  **A safety note worth stating plainly.** The output tree is wiped on every run so
  a renamed note's page cannot linger. An unset `site.out` resolves to the
  repository root, and the wipe then deletes the working tree — which happened
  while this command was being written, on a configuration that had no `site`
  section yet. `site.out` is now required, and refused again unless it resolves
  strictly inside the repository root. Both failing shapes are ordinary rather than
  exotic, so neither is left to care.

  Also new:

  - `engine/site-build.mjs` exports each stage (`collectContentPages`,
    `collectTreePages`, `siteGates`, `renderPages`, `writeSectionLandings`) for a
    consumer that needs a step rather than the whole command.
  - `sohl/kb-passes.mjs` exports the two `sohl` rewrites directly.
  - `gray-matter` is a dependency. It is the authority on the exact bytes of a
    page's frontmatter, and matching it is what makes the byte-identical claim
    above true rather than approximately true.

## 1.3.0

### Minor Changes

- 1a36dfa: **`docs item-fields` renders the page a consumer publishes, not just the
  tables.**

  The command existed but no consumer could use it: it emitted the generated
  tables and nothing else, so a repository that wanted a page — with a heading, a
  "See also" line, and a paragraph telling the reader what they are looking at —
  wrapped the renderer in a script of its own. That script was the thing the
  command line exists to remove.

  A new top-level `docs:` section says what is the consumer's:

  ```yaml
  docs:
    itemFields:
      title: Item Note Frontmatter
      out: kb/dev-docs/content-creator/item-frontmatter.md
      preamble:
        - "See also: [The Authoring Workflow](authoring-workflow.md)"
        - ""
        - Every item note carries the envelope described there.
  ```

  `--check` compares against the file already there and writes nothing, so a
  repository can gate on the page being current without a temporary file or a
  second implementation of the comparison.

  **The page is now what Prettier would write.** A consumer commits it and formats
  its repository, so a generator that disagreed with the formatter by one
  character would have its output rewritten on the next format run and then called
  stale by `--check` on every clean checkout — the two undoing each other forever.
  Three things were making that happen, and all three are fixed at the source
  rather than by adding a formatting pass:

  - Table columns are padded to their widest cell, which is what Prettier's
    alignment comes to for this content.
  - The worked example's fence said `yaml`, but the block is a whole note —
    frontmatter _and_ the prose beneath it. Prettier formats a fenced block in the
    language it declares, so labelling it YAML both misdescribed it and dropped the
    blank line after the frontmatter. It is `markdown`.
  - One field description used `*emphasis*`; Prettier normalises to `_emphasis_`.
    Fixed where it is written rather than by rewriting markers on the way out.

  `tests/field-reference.test.ts` asserts the rendered page survives Prettier
  unchanged, so if its markdown printer changes — or a field description starts
  using a construct it normalises — that fails here, in the package that generates
  the page, rather than in the repository that publishes it.

  Also clears prose left behind when the manifest template was retired: the
  `paths.packageManifest` typedefs, and a `config.mjs` example still showing a
  `foundryPackage` that is now rejected.

## 1.2.0

### Minor Changes

- c5360c5: **Every invocation the command line accepts is now one it performs.**

  Four invocations were accepted, performed nothing, and exited 0. From a `run-s`
  build chain each read as a step that had done its work:

  | Invocation                 | Was                                          | Now                            |
  | -------------------------- | -------------------------------------------- | ------------------------------ |
  | `content-build`            | exit 0, no output                            | usage, exit non-zero           |
  | `content-build bogus`      | exit 0, silently ignored                     | rejected by name               |
  | `content-build package`    | exit 0, compiled nothing                     | names `compile\|unpack\|clean` |
  | `content-build docs`       | rendered `item-fields` whatever it was asked | names the documents            |
  | `content-build lint --xyz` | exit 0, option ignored                       | rejected                       |

  The CLI is built on yargs but had opted into none of its guarantees — no
  `.demandCommand()`, no `.strict()`, and both multi-action commands declared
  their action optional (`package [action]`) rather than required. `docs` went
  further: it declared an `action` positional with `choices` and never read
  `argv.action`, so the positional constrained what could be typed and selected
  nothing. With one document that was latent; a second would have rendered the
  wrong one and exited 0. The action is now dispatched on.

  The sibling toolchain `@heroiclands/package-build` already opts into the same
  two guards, so the two command lines now agree about what an error is.

  **On the bump.** Marked _minor_ rather than _major_ although exit codes change
  for inputs that were previously accepted: no invocation that did any work
  behaves differently, and every invocation that changes was one doing nothing at
  all. A consumer whose build starts failing was not compiling, linting or
  rendering anything at that step. Treating it as a breaking change would strand
  every `^1.0.0` consumer for a fix whose entire effect is to make a silent
  no-op loud.

  `--version` and `--help` still answer in a directory with no configuration.

  Closes #57

## 1.1.0

### Minor Changes

- a032fd7: **The package-id guard is deleted, and with it every read of the shipped
  manifest.** A single source needs no corroboration.

  `assertPackageIdMatchesManifest` existed because the package id was declared
  twice — once in configuration, once in a hand-authored manifest template — and
  guarded the pair against drift (#1503). content-build 1.0.0 derived the
  configured half from `package.json`; package-build 0.3.0 generates the manifest
  from that same configuration. The guard was left in place through both, since
  deleting it before the second declaration was actually gone would have removed a
  check that still checked something. Both are gone now, and it compares a derived
  value against itself.

  Removed rather than repaired, along with everything that only existed to serve
  it: `engine/package-manifest.mjs` entire — `resolvePackageManifestPath`,
  `readPackageManifest`, `readManifestPackageId`,
  `assertPackageIdMatchesManifestFile` — its barrel export, and the
  `paths.packageManifest` key.

  **`content-build package unpack` reads the configured pack list.** It took the
  list out of the shipped manifest, which was the same second declaration one
  level along. Nothing in the toolchain opens a manifest template now, so a
  repository that has deleted `assets/templates/` compiles, unpacks and stamps
  exactly as before.

  **Breaking for any configuration still declaring `paths.packageManifest`** — the
  key is refused, naming it. Every consumer drops it in the same change that
  deletes its template.

## 1.0.0

### Major Changes

- 29857ed: **Four keys change hands: two stop being authored, two start.** All four were
  wrong in the same way — a fact either transcribed into the configuration from a
  file that already stated it, or read back _out of_ the manifest because the
  configuration could not state it.

  | Key                   | Was                               | Is                                |
  | --------------------- | --------------------------------- | --------------------------------- |
  | `foundryPackage`      | transcribed `package.json` `name` | derived; authoring it is an error |
  | `stats.systemVersion` | declarable                        | derived; authoring it is an error |
  | `compatibility`       | read out of the manifest          | declared, top level               |
  | `relationships`       | hand-authored in the manifest     | declared, top level               |

  **Breaking.** Every consumer configuration must drop `foundryPackage` and
  `stats.systemVersion` and gain `compatibility`, moving the values out of its
  manifest template rather than retyping them.

  **A module's system version is not its own version.** For a system,
  `package.json` `version` _is_ the system version. For a module it is the
  _module's_ — `sohl-thalorna` sits at `0.0.1` — so deriving from it would stamp a
  SoHL version that has never existed, which is worse than the frozen `0.6.0` both
  modules carry today, since that at least was once true. It comes instead from
  the `compatibility.verified` of the system the module declares a relationship
  with: `_stats.systemVersion` records what the packs were built against, not the
  floor they tolerate. A module declaring no usable system relationship fails the
  build rather than guessing.

  **This reverses a rule.** Configuration used to be forbidden from holding the
  Foundry floor — it named the manifest and the value was read from there, because
  the manifest was hand-authored and moved with test evidence. Now that
  package-build generates the manifest _from_ the configuration, reading it back
  would be a round trip through an artifact that need not exist yet: `build:db`
  can run before the manifest is written. `supportedCoreVersion` takes the
  resolved configuration instead of a manifest directory, and no longer reads the
  filesystem at all. The loud failure survives the reversal: an undeclared floor
  throws rather than defaulting, which is what `coreVersion: "14"` taught (#1533).

  `relationships` is **top level**, not in `packageBuild:`, because this package
  must read the system relationship to derive a module's version — and the
  dependency runs one way, so content-build must never read package-build's
  section.

  Mind the collision: top-level `compatibility` is the **Foundry core** range;
  `relationships.systems[].compatibility` is the **game system's**. Same key,
  different subject. `minimum` is required of the former, since it is stamped into
  every document, and optional inside a relationship, where `verified` is what is
  load-bearing.

  The package-id drift guard is deliberately left in place. It compares this
  configuration's id against the shipped template's, and the template still
  declares one; it becomes vacuous only once package-build generates the manifest,
  and should be deleted then rather than repaired.

## 0.17.0

### Minor Changes

- da18007: **The address index a site build resolves its wikilinks against moves here.**

  `engine/site-index.mjs` exports `buildSiteIndex` and `wikiContext`: given pages
  that already know their own URLs, it builds every key space a wikilink resolver
  reads — `section/slug`, `type/shortcode`, the canonical
  `package-type-shortcode`, collision-aware bare fallbacks, and type-scoped
  aliases — merges the foreign packages in, and reports what more than one package
  claims.

  Every consumer publishing a content tree as a website answers the same question
  — given `[[Something]]`, which page? — and each answered it with its own copy.
  `sohl` and `sohl-thalorna` still share **147 identical lines** of that answer,
  comments and indentation aside.

  **What deliberately stays with the consumer:** how a page gets its address. The
  URL scheme, the section a note is filed under, whether developer docs are part
  of the site at all — the two builds differ on all three, and those differences
  are real rather than drift.

  The ordering of the foreign merge is now pinned by a test and explained where it
  happens: foreign entries merge _before_ local canonical addresses are written,
  so a local page always ends up owning its own `package-type-shortcode` even if a
  stale vendored manifest claims it.

  Additive — nothing here consumes it yet. Verified against SoHL's real tree:
  1,457 notes and a 2,101-entry foreign index produce an index identical to the
  one its build constructs today, across all six key spaces (12,663 addresses, 12
  ambiguous keys, 3,402 type-scoped aliases, 3 poisoned aliases, 34 content types,
  0 conflicts).

## 0.16.0

### Minor Changes

- db89a4d: **A being's info-block derivation moves here, from the two repositories that
  each had a copy.**

  `sohl/being-info.mjs` exports `deriveBeingInfo`, `isBeing`, `BEING_TYPE` and
  `GEAR_TYPE_TO_KEY`: the translation between the flat `sohl.items[]` a being note
  authors and the resolved shapes the shared theme's sidebar reads — a `skills`
  map, `gear` grouped by kind, and `spells`/`talents` split out of the mystical
  abilities. It is SoHL data-model knowledge (which item type is a skill, where a
  mastery level lives, what separates a spell from a talent), so it belongs in
  this package's `sohl` half rather than in each site build.

  It lived in `Song-of-Heroic-Lands-FoundryVTT` and `sohl-thalorna` at once, and
  the copies drifted. SoHL's caller still gated the derivation on `character` and
  `creature` — the types #1580 merged into `being` — so it had matched nothing
  since the merge, and all 95 of its being pages published with empty sidebar
  sections (SoHL#1696). thalorna's copy checked `being` and was correct. Nothing
  failed in either repository.

  `isBeing` exists because of that: the defect was never in the derivation, it was
  in each caller's idea of what a being _is_, written out per repository where it
  could rot independently. The retired names are deliberately not accepted as
  aliases — they throw elsewhere in the system, and tolerating them here would
  hide the next drift instead of surfacing it.

  Two deliberate differences from the code it replaces:

  - **The `corpus` derivation is dropped.** `corpus` is not a registered item
    type, so nothing can compile to one and the branch matched nothing — the same
    class of dead code as the gate that caused the bug. It was in SoHL's copy and
    never in thalorna's.
  - The mystical-ability branch keeps its lack of a shortcode fallback, unlike
    gear, and now says why: these render as prose names, so a row reading like a
    shortcode is worse than no row.

  Additive — nothing in this package consumes it yet. Verified against every real
  being note: `deriveBeingInfo` and the copy it replaces produce byte-identical
  output for all 95, deriving a skills map for 95 and gear for 2.

### Patch Changes

- a89a065: **Release from merged changesets instead of a remembered command**

  Fixes [#15](https://github.com/HeroicLands/content-build/issues/15). Releasing was
  hand-driven — bump `package.json` on a branch, merge, then remember
  `gh release create`, because cutting the Release is what published. Nothing
  enforced the last step, so on 2026-08-21 `main` carried 0.5.1 while npm served
  0.4.0: two versions merged and never published, with no check red.

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
  - `CHANGELOG.md` is seeded from the eleven hand-cut Releases so far and now ships
    with the package.

<!-- Sections at 0.16.0 and above are generated by `changeset version` from
     the changesets merged into `main`. Sections at 0.15.0 and below predate
     that pipeline and are the hand-written GitHub Release notes, kept verbatim
     (headings demoted one level to sit under their version) so no history was
     lost in adopting it. -->

## 0.15.0

_2026-08-22 — one config file, two build packages_

**One repository describes itself in one file — and now that file serves both build packages.**

#### A reserved `packageBuild:` section

`defineConfig` accepts a `packageBuild:` mapping, validates that it _is_ a mapping, and hands it back frozen and **uninterpreted**. `@heroiclands/package-build` validates everything inside it.

```yaml
packageKind: systems # read from the top level, never restated below
foundryPackage: sohl

packageBuild:
  assets:
    - { from: lang, to: lang }
  deploy:
    envPrefix: SOHL
```

The two packages split by **input** — content-build reads the content tree, package-build reads `lang/`, `styles/`, `src/`, the assets and the manifest template — so neither should learn the other's schema. A section rather than a scatter of top-level keys, because that keeps the unknown-key guard intact for everything around it: that guard is what catches a typo'd `packs` before it becomes an empty compendium.

The alternative was a second config file, and it would have restated `packageKind` and `foundryPackage` — two places for one fact. That is exactly what every consumer's `push-stage.mjs` did, hard-coding `packageKind: "systems"` and `packageId: "sohl"` beside a configuration that already declared both.

#### `assets` is retired

The key had been part of the contract since the pack-config hoist — validated and frozen on every load, and read by **nothing**. The job it describes is `stageAssets`, which belongs to package-build, and each consumer did it from a local table instead. It now lives at `packageBuild.assets`.

No configuration anywhere declared it — not SoHL's, not this package's own — so the removal costs nobody a migration.

#### Upgrading

`^0.x` never crosses a minor, so no consumer moves until it bumps deliberately. For most, this release changes nothing: adopt it when you adopt `@heroiclands/package-build`'s command line.

**Full changelog:** https://github.com/HeroicLands/content-build/compare/v0.14.0...v0.15.0

## 0.14.0

_2026-08-22_

Released with no notes — see [v0.14.0](https://github.com/HeroicLands/content-build/releases/tag/v0.14.0).

## 0.13.0

_2026-08-22 — links and reachability as commands_

Two things a consumer should not have to write a script for.

### `content-build links [root]`

Checks that every link in a content tree lands, reporting:

- a **dead `#anchor`** — a page id is derived by hashing the note id and the anchor slug, and nothing else checks that a heading declaring it exists;
- a **dead qualified address** — a `type-shortcode` target resolving to no note is a typo (a bare `[[Name]]` that finds nothing is a worldbuilding placeholder, and is left alone);
- a **wikilink authored in frontmatter** — both builds copy frontmatter through verbatim, so it publishes as literal `[[…]]` text;
- a **vendored manifest that has drifted out of reach** — readable is not the same as addressable, and a key shape the lookup cannot parse makes every cross-package link miss while each page still reads correctly.

All of it is package-agnostic, so a consumer needs no script of its own.

### `content-build reachability <dir> [file] [--index <shortcode>]`

A documentation set is a **book, not a pile of notes**: it has a page one, and everything in it should follow from that page by reading. A note with no inbound link still compiles and still publishes — it is simply impossible to arrive at, and nothing else notices, because every other check asks whether a link _lands_, never whether a document is _reached_.

The corpus is named on the command line because it never changes for a repository:

```json
"lint:reachability:rules": "content-build reachability Rules --index glossary",
"lint:reachability:guide": "content-build reachability User_Guide --index glossary"
```

`--index` marks a page walked **to** but not **through** — an index links to nearly everything it covers, so traversing one makes the check vacuous. A corpus whose entry page is missing exits 1 rather than reporting every page as an orphan.

`walkReachability` is exported too, for a caller that wants the graph rather than a report.

### Also

- `engine/foreign-manifests.mjs` — the addressability guard, beside the key format it guards rather than in whichever consumer loads a manifest.
- `positionOfLiteral` in `engine/diagnostics.mjs` — for a finding about a literal in a file that is neither a note body nor frontmatter.

### Verified

Against the SoHL content tree, matching what its own scripts report: 1457 notes, every anchor landing, every qualified address resolving, 21 cross-package references via manifest, and 73/73 rules plus 43/43 user guide documents reachable. 854 tests.

Purely additive — but a `^0.12` pin will not cross to 0.13.0, so each consumer bumps its pin **and lockfile** deliberately.

## 0.12.0

_2026-08-22 — link resolution and the link audit_

Three link defects survive both content builds silently, so neither the pack compilers nor a site build catches them:

- **a dead `#anchor`** — a page id is derived by hashing the note id and the anchor slug, and nothing checks that a heading declaring it exists;
- **a dead qualified address** — a `type-shortcode` target resolving to no note is a typo (a bare `[[Name]]` that finds nothing is not: that is a worldbuilding placeholder, and is left alone);
- **a wikilink authored in frontmatter** — both builds copy frontmatter through verbatim, so it publishes as literal `[[…]]` text.

The checks for all three lived in the SoHL repository, inspecting only its own tree. `engine/content-links.mjs` builds the resolution index both builds construct — the type-scoped alias map, the `type/shortcode` and `doc<type>/shortcode` addresses, the vendored foreign manifests — and reports what lands nowhere.

**It parses links the way the builds do now.** It carried its own copy of the wikilink pattern: the _third_ in this codebase, and the same drifted one that let an unclosed bracket swallow a document. The checker was parsing more loosely than the compilers it was checking.

**Corpus reachability and retired hostnames are deliberately absent.** Both are statements about what one package publishes rather than about the note format, and both are served by the link graph the module returns (`notes`, `linksOf`, `resolve`) — so a consumer keeps those checks without keeping its own resolver.

Verified against the SoHL content tree: 1457 notes, 0 dead anchors, 0 dead addresses, 0 frontmatter wikilinks, and the same 21 cross-package references answered by manifest that its own script reports. 848 tests.

Purely additive — but a `^0.11` pin will not cross to 0.12.0, so each consumer bumps its pin **and lockfile** deliberately.

## 0.11.0

_2026-08-22 — arms-and-armour abbreviations_

Four words this content names constantly gain abbreviations:

| word     | short  |
| -------- | ------ |
| `sword`  | `swd`  |
| `shield` | `shld` |
| `round`  | `rnd`  |
| `battle` | `btl`  |

The table had none of them, so `Round Shield` addressed a page at `round-shield` where the convention is `rnd-shld` — and the vowel reduction a shortcode falls back to produced `roundshild`, a shortening nobody would have chosen by hand.

Whole-word matching handles the near-misses with no special casing: `Broadsword` is one word, so `sword`'s rule does not reach inside it and the name stays whole.

**Derived addresses change, which is why this is a minor.** A page whose name contains one of these words now publishes at a different URL, and a shortcode suggested from such a name differs too. A `^0.10` pin will not cross to 0.11.0 — each consumer bumps deliberately, and regenerates any copy of the table it keeps.

Verified against the SoHL content tree: 1457 notes still yield 1457 distinct URLs, and the compiled packs remain byte-identical across all 2,828 documents. 829 tests.

## 0.10.0

_2026-08-22 — one wikilink syntax, one slug rule_

An authored `[[…]]` compiles to two addresses — a Foundry `@UUID` for the packs, a URL for the web — and those destinations are the only thing that legitimately differs. The syntax was written twice and **had already drifted**: the web side's pattern omitted `\n`, so an unclosed bracket swallowed everything up to the next `]]` anywhere in the document. `engine/wikilink-syntax.mjs` now owns the pattern and the parse, and both resolvers consume it.

**Breaking renames.** The names now say which address space each resolves into, since that is the whole of the difference:

- `engine/kb-wikilinks.mjs` → `engine/web-wikilinks.mjs`
- `resolveKbWikilinks` → `resolveWebWikilinks`
- barrel namespace `kbWikilinks` → `webWikilinks`

"kb" named one consumer's site section; the resolver already served any site. "html" would be wrong too — it emits Markdown.

**One slug rule.** Four slug-shaped transforms had drifted, and three dropped non-ASCII letters instead of transliterating them: `Kûrbúl Helm` published at `kurbul-helm` while its pack file was `k-rb-l-helm` and a link to a heading of that name pointed at `#k-rb-l-helm`. Twenty-two notes in the SoHL tree were affected. `engine/content-slug.mjs` owns the rule; `helpers`, `web-wikilinks` and `compendiums` consume it. `compendiums` was the worst — `.replace("'", "")` with a _string_ argument stripped only the first straight apostrophe and never a curly one.

**`engine/abbreviations.mjs`** — the conventional shortenings for this setting's vocabulary (ranks, offices, materials, units), matched greedily longest-first, whole words only. Applied to **document addresses only**: an anchor key is written by hand, and abbreviating a heading broke a real map pin (`locations.stair-foot` against a heading that became `stair-ft`).

**`protectCode`** joins `codeRegions` and `replaceOutsideCode` in `engine/code-fences.mjs`.

Verified against the SoHL content tree: 1,457 notes yield 1,457 distinct URLs, and the compiled packs are byte-identical across all 2,828 documents. 827 tests.

## 0.9.0

_2026-08-22 — lint a content tree's addresses_

The three rules a content note's **identity** is authored against move into this package, where every consumer gets them, instead of living in the SoHL repository where they only ever inspected SoHL's own tree (#20).

- **Shape** — a `shortcode` is strictly ASCII-alphanumeric. It is the identity key referenced from saved world data, and half of the `type-shortcode` address, whose parse needs the separating hyphen to be the only hyphen.
- **Uniqueness** — `(type, shortcode)` names one note.
- **Alias** — the note physically carries its own address in `aliases`, exactly once. Obsidian resolves a wikilink against the files on disk, so without the alias the address form resolves in the build and is dead in the editor.

```bash
npx content-build lint            # the configured `paths.content`
npx content-build lint some/tree  # or a tree named outright
```

It compiles nothing, opens no LevelDB and needs no Foundry manifest, so it takes about a second and can gate a commit. An empty or untyped tree **fails** rather than passing: "every one of nothing is unique" is a vacuous pass, and it is exactly what a tree that failed to check out produces.

**Why this mattered.** Pointed at the three real trees, two of which nothing had ever checked: `sohl` 1457 notes / 0 findings (matching its own guards exactly), `thalorna` 1738 notes / 4 findings, `kethira` 363 notes / **363 findings** — not one note there carries its address, so the address form of a wikilink has never resolved in that vault.

**Also fixes SoHL#1678.** The uniqueness rule now states what the pipeline actually enforces — a document is addressed by `(type, shortcode)` across _every_ pack of its document type — rather than the per-pack scope that #1566 made false once a note could declare `pack:`. Duplicates are reported once per offending note, each naming the others.

**New API:** `engine/content-lint` (`lintContentTree`, `auditNoteAliases`, `isAddressAlias`, `isValidShortcode`, `SHORTCODE_PATTERN`), the `contentLint` barrel export, and `positionInFrontmatter` in `engine/diagnostics`.

Purely additive — but a `^0.8` pin will not cross to 0.9.0, so each consumer bumps its pin **and lockfile** deliberately.

## 0.8.0

_2026-08-21 — declarative item fields_

**Item builders now declare the frontmatter they consume.**

The mapping from a note's `sohl:` frontmatter to the emitted `system` block
lived inside each builder's function body, so nothing could read it — not a
documentation generator, not a validator, not a person (#22).

The declaration is now the only statement of that mapping, and the builder is
generated from it:

- `engine/field-spec.mjs` — the declaration primitives, the coercions, and
  `buildFromFields`, which turns a field list into the builder that runs.
- `sohl/item-fields.mjs` — all thirteen SoHL item types, each field with its
  name, target, shape, requiredness, default and a one-line description.
- `engine/field-reference.mjs` and `content-build docs item-fields` — the
  authoring reference, rendered from whatever the resolved configuration
  declares.

**New in the configuration contract:** an `itemBuilders` entry may carry
`fields` alongside `system` and `img`, so a consuming repository declares — and
documents — its own item types the same way. The key is optional; a type that
omits it compiles exactly as before and is simply undocumented.

**No behaviour change.** Compiling the SoHL content tree before and after
produces 2,828 byte-for-byte identical pack documents, 1,230 of them items.

Consumers pick this up with a pin bump; nothing breaks on the old one.

## 0.7.0

_2026-08-21 — parseable, located diagnostics_

**Diagnostics about a content note now name the file, line and column.**

A warning used to name the note by `name.full`, which is not an address — four
identical warnings on one note were indistinguishable, and each had to be hunted
for in a file the build had already read. Every diagnostic is now emitted in the
form every C-family compiler, `tsc` and ESLint already use, so an editor's error
matcher or a CI annotator resolves it with no knowledge of this build:

```text
assets/content/Regions/Capital_Nome.md:43:635: warning: unresolved wikilink [[Kenbet_Pat|Kenbet'Pat]] (unknown) in "The Capital Nome"
```

Two rules keep it parseable: the locator starts the line (diagnostics bypass
`loglevel`, whose `[timestamp] [WARN]:` prefix sits where a parser reads the
path from), and a field is dropped rather than guessed — nothing defaults to
`1:1`.

#### Breaking

- **`expandNoteTables` returns `{ markdown, lineMap }`**, not the markdown
  string. `engine/*` is a public export, so a direct importer must be updated.
  A `^0.6` pin will not cross to 0.7.0; each consumer bumps deliberately.

#### Also in this release

- `parseMarkdownFile` additionally returns `bodyLine` / `bodyColumn`.
- `expandContentTables` additionally returns `lineMap`; its `errors` entries
  carry the failing directive's `line`.
- `convertWikilinks`' `unresolved` entries carry `offset`.
- `convertNoteWikilinks` accepts `file` / `bodyLine` / `bodyColumn` / `lineMap`;
  its thrown errors carry `file` and `position`.
- `BasePackCompiler` publishes the note being compiled as `currentNote` and
  exposes `noteWarn` / `noteError`, so a pass reports a position without every
  method being handed one. The map warnings and the actor-compiler errors go
  through it too — both previously named a note and no file.
- A link a `dataview` table generated is blamed on the directive that produced
  it and reports **no** column, since there is no authored character to point at.

Progress and summary lines are unchanged.

Closes #17.

## 0.6.0

_2026-08-21 — default art by builder, ambiguous links now fail_

**Breaking**

- An item type's **default art now travels with its builder** (#11). An
  `itemBuilders` entry may be `type: buildFn` as before, or
  `type: { system: buildFn, img: "…" }`. A consuming repository can finally
  declare art for its own item types; previously art was looked up in a table
  this package ships and a consumer could not add to, so a consumer's own type
  compiled only while every one of its notes carried an explicit `img:`.
- An **ambiguous wikilink now fails the compile** instead of warning (#13), and
  the message names the notes that collided rather than the note that cites
  them. An ambiguous address matched real content twice; there is no defensible
  way to pick one, and the fix is mechanical — write the qualified form. The
  knowledgebase build has always treated this as fatal, so the two builds now
  agree. Verified against every consumer: 0 links would fail in
  Song-of-Heroic-Lands-FoundryVTT, sohl-thalorna or sohl-kethira-basic.

**Fixed**

- A Scene `levels` entry is described by the shape it actually has (#12).
- An empty `relation` / `skillAptitudes` list reads as an empty map (#10).

**Upgrading**

Consumers pin `^0.4.0` = `>=0.4.0 <0.5.0`, so this release does not reach anyone
on its own — both the manifest and the **lockfile** must move, since `npm ci`
installs what is locked. Dependabot is configured in all three consumers with
this package as its own single-package group and will open one pull request each
now that a version exists to bump to.

## 0.4.0

_2026-08-20 — retire the character/creature content types_

Retires `character` and `creature` in favour of a single `being`, reported rather than silently routed to the items pack. Also carries the lazy-config change from #4. See #5, #6.
