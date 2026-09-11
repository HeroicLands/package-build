# @heroiclands/package-build

## 20.1.0

### Minor Changes

- f6d2a8f: **A fetched item catalogue is read one system at a time** (#58).
  
  A pack declaring `system: hm3` already read only this repository's `hm3` and
  system-neutral Item packs. The other half of the same lookup — the catalogue
  fetched from a dependency that declares `itemCatalog: true` — was unscoped, and
  both halves are merged into one address space keyed by `subType:shortcode`. So
  an address that exists in both vocabularies resolved against whichever document
  the dependency's other system happened to supply, and said nothing: `skill:awar`
  is a real address under SoHL and under HM3 and means two different documents.
  
  `deps fetch` now records what each extracted pack is, from the dependency's own
  manifest, and `foreignItemCatalogDirs(config, system)` reads only the packs that
  system may see plus the ones declaring no system at all.
  
  **What a consumer sees**
  
  |                                      | Before                  | After                            |
  | ------------------------------------ | ----------------------- | -------------------------------- |
  | a pack with `system: hm3`            | reads every cached pack | reads the `hm3` and neutral ones |
  | a single-system build                | reads every cached pack | unchanged                        |
  | a cache filled by an earlier version | used as-is              | treated as incomplete            |
  
  **Refill the cache once.** A cache written before this holds the items but not
  what they are, and neither way of proceeding without that is honest: reading
  every pack is the wrong-document failure above, and reading none fails a build
  that worked. So it is incomplete, and `content-build deps fetch` refills it —
  the command the cold-cache error already names.

### Patch Changes

- 2b1157e: **The license header is on every shipped module, and CI refuses a `TODO`.**
  
  `engine/foreign-catalog.mjs` and `engine/schema-extract.mjs` shipped without the
  GPL-3.0 header every other module carries — 109 of 111 had one, which is the
  state a rule reaches when nothing checks it.
  
  The forbidden-marker check now runs here too, through the org-wide
  `HeroicLands/.github/actions/todos` action the other repositories already call.
  It scans the whole checkout rather than a named list of directories: this
  package's modules sit at its root as well as under `bin/`, `ci/`, `engine/`,
  `hm3/` and `sohl/`, so a list would name sixteen root files today and quietly
  stop covering the seventeenth.
  
  Nothing a consumer imports changes.

## 20.0.0

### Major Changes

- 1670506: **An omitted address segment now defaults from where the link is written** (#336),
  instead of being wildcarded or searched for. Three resolvers each carried their
  own reading of a partial address and disagreed; there is one rule now, in
  `expandAddress` beside `canonicalKey`.
  
  - **package** omitted → the current package.
  - **system** omitted → the **system block the link sits under**: anywhere under
    `sohl:` is `sohl`, anywhere under `hm3:` is `hm3`, and anywhere else —
    top-level frontmatter, `data:`, body prose — is `none`. The enclosing block
    decides at any depth; the field has no say.
  
  Every short form therefore expands to exactly one canonical address before
  lookup. Resolution is a `Map.get`, with no candidate set and no single-hit rule.
  
  **Under `none`, a system-bearing type addresses its documentation.** A note's
  `none` address _is_ its `doc<type>` journal, so a prose `[[affiliation-x|…]]`
  names the page — what a prose link almost always means. A prose link that means
  the Item states the system: `[[sohl-affiliation-x|…]]`. A `macro` and the map
  types are **not** redirected: their own documents are core ones already at
  `none`, so `macro-x` still names the Macro.
  
  **Breaking, in three ways a consumer will notice**
  
  |                                     | before                                       | after                                             |
  | ----------------------------------- | -------------------------------------------- | ------------------------------------------------- |
  | a bare prose link to an item type   | the Item's UUID                              | the documentation journal's                       |
  | a bare address naming no local note | fell through to any dependency publishing it | `unresolved`; qualify it to reach another package |
  | `[[Skill-Climb\|…]]`                | resolved, case folded                        | `not-lowercase`                                   |
  
  The first rewrites every such link in every pack. The second is the point of the
  issue: a link resolved into another package only because no local note claimed
  the address, and would have retargeted silently the day one did.
  
  **Two defects go with it.** The index's system-blind `type/shortcode` key is
  gone — it was set with a plain `Map.set`, so two notes in one package sharing a
  `(type, shortcode)` across systems silently overwrote each other while both
  canonical keys sat correctly beside it. And cross-package `ambiguous` is now
  unreachable: one expanded address names one package, so a lookup returns one
  entry or none. The finding is retained for older vendored manifests.
  
  **An address capitalises nothing but its shortcode.** Package, system and type
  are closed vocabularies with one spelling each; a shortcode is case-sensitive and
  routinely mixed (`Clb`, `LtShoe`), so it keeps its case. Neither tree carried a
  violation — 10,538 authored targets checked. Requiring the shortcode to be
  lowercase too is tracked as #340.
- c906d54: **A shortcode must now match `^[a-z0-9]+$`** — lowercase letters and digits only
  (#340). So must every other address segment; the charset is one rule with no
  exceptions left in it.
  
  `Dgr` beside `dgr` is a distinction nobody can say out loud and can only see by
  looking twice. It was also a silent identity collapse: `canonicalKey` lowercases
  the address it builds, so a note declaring `Clb` published
  `sohl-sohl-weapongear-clb` and derived its `_id` from that — and two notes
  differing only in case shared one address, one `_id` and one URL with nothing to
  report it, because the shortcode check compared shortcodes (genuinely distinct)
  and the address check saw one address.
  
  It forced two exceptions elsewhere, and both go: #336 had to exempt the shortcode
  from the lowercase rule it pinned on every other segment, and #346 had to fold
  the shortcode's case in the item catalogue because an address is lowercased when
  it is read.
  
  **A consumer with a capital in a shortcode will fail to build**, citing the
  note's file, line and column. The sweep is mechanical: every violation in every
  tree is a capital letter — no underscores, hyphens or other characters occur —
  and **nothing collides when folded**, checked per `(type, shortcode)` in every
  tree.
  
  | tree                              |  shortcodes to change |
  | --------------------------------- | --------------------: |
  | `Song-of-Heroic-Lands-FoundryVTT` |                   438 |
  | `sohl-thalorna`                   |                    96 |
  | every other tree                  | 0 — already compliant |
  
  **No document changes identity and no URL moves**, because an address and a
  document `_id` already derive from the lowercased form. References need no edit
  either: no authored wikilink target carries a capital (10,538 checked), and
  `model:` addresses are already lowercase.
  
  **The emitted packs do change, in three narrow ways**, measured on `sohl`'s 438:
  
  | change                                                | count |
  | ----------------------------------------------------- | ----: |
  | `system.shortcode` on an Item document, `Clb` → `clb` |   438 |
  | embedded item `_id` / `_key` on one being             |     6 |
  | journal pages showing a shortcode in a content table  |     5 |
  | **top-level document `_id`**                          | **0** |
  | **addresses and published URLs**                      | **0** |
  
  The first is the point: the emitted field now matches the address built from it.
  The six embedded ids move because an embedded id derives from the item's own
  `system.shortcode`, which #346 deliberately does **not** case-fold — folding
  there would re-identify documents rather than look them up.
- 4890864: **A map note's `image:` is no longer read** (#149). Its art is `img:`, as every
  other note type's is.
  
  This is the third and last step of the rename #142 began. Through the retirement
  window both spellings were read, `img` won where a note carried both, and a note
  still writing `image` got a located warning — it compiled to the byte-identical
  document, so failing a build over it would have redded a tree that had done
  nothing wrong. The trees have since been swept, so the alias has nothing left to
  honour and is gone.
  
  **No shipped tree is affected.** Every content tree was checked — `sohl`,
  `sohl-thalorna`, `sohl-kethira-basic`, `harn-ensemble` and `harn-adventures` —
  and none writes the retired spelling. The window did its job; this only closes
  it.
  
  **What an unswept note now sees.** Two errors rather than one warning, and it
  stops compiling: `image` in a `sohl:` block is reported as a key the type does
  not have, and the `img` the note therefore never declared is reported as
  missing. The fix is the rename, and moving the key to the note's top level while
  you are there — art is not system-specific, so it belongs beside every other
  note's `img` rather than inside a system block.
  
  **A tile's `image:` is untouched.** `sohl.tiles.<key>.image` is a nested
  placeable's texture, not the note's own artwork, and was never the retired field:
  the check reads the `sohl:` block's own keys and never descends into one.
  
  **Nothing was added to refuse it.** The two findings above are the ordinary
  unknown-key and required-field checks, which is the point of a rename's third
  step — one that had to add a standing refusal would be one whose replacement
  never arrived. No tombstone entry is kept: the absence of an alias is the record.
- a1c21e8: **A being's items entry names the item it copies with `model:`, an address**
  (#334). The top-level `shortcode:` it replaces is retired.
  
  ```yaml
  sohl:
    items:
      - { model: skill-wpnc, system: { masteryLevelBase: 52 } } # this package
      - { model: sohl-sohl-weapongear-dgr } # another one
  ```
  
  The old key was doing two jobs badly. It **selected a template**, while the
  `system.shortcode` beside it **was** the compiled item's identity — one word for
  two things, which the compiler's own error messages had to keep explaining. And
  it could not say **which package** the template came from: `loadItemsMap`
  flattened every local Item pack and every dependency catalogue into one
  `subType:shortcode` space where a local definition silently shadowed a foreign
  one. In `sohl-thalorna`, 25,485 of 26,251 model references reach into `sohl` and
  none of them said so; the day that repository ships its own `weapongear-dgr`,
  every entry citing `dgr` would have retargeted with a green build and no
  diagnostic.
  
  **What changes for an author**
  
  |                          | before                             | after                                          |
  | ------------------------ | ---------------------------------- | ---------------------------------------------- |
  | naming a template        | `{ shortcode: wpnc, type: skill }` | `{ model: skill-wpnc }`                        |
  | reaching another package | impossible                         | `{ model: sohl-sohl-skill-wpnc }`              |
  | `type:` beside it        | required                           | refused — the address names the type           |
  | a custom item            | `name` + `type` + `system`         | unchanged, and `system.shortcode` now required |
  
  A `model` is read by the same grammar every wikilink is (#336), so it is written
  at whatever length says what it means and the system segment defaults from the
  block the entry sits in — which is why the short form names an **Item** here
  while the same string in body prose names a page.
  
  **The catalogue is package-aware.** Every item is keyed under its own package as
  well as unqualified, so a `model` that states a package resolves to that
  package's item and nothing local can shadow it, while a `model` that states none
  still resolves locally-first exactly as before. `foreignItemCatalogDirs` returns
  `{ dir, package }` rather than a bare path.
  
  **Consumer sweeps**: HeroicLands/Song-of-Heroic-Lands-FoundryVTT#1875 (95 beings,
  1,557 entries) and HeroicLands/sohl-thalorna#176 (645 beings, 26,251 entries plus
  938 shortcodes derived for custom gear).

### Minor Changes

- ccf35a1: **An actor note now publishes documentation, like every other note that compiles
  into a system-bearing document** (#337).
  
  A being used to produce its Actor and nothing else. That left it the one
  system-bearing note with no address at `none` — its only address named the
  Actor — so a prose link written `[[being-<shortcode>|Text]]` had no page to land
  on. `sohl-thalorna` alone carries 772 such links.
  
  `docEntryTypes` is now `itemTypes` plus the actor types the shipped subtype maps
  declare (derived from those maps, not listed again), plus `macro` and the map
  types. Only `doc` stays outside it, for the reason that actually applies to it:
  its single document _is_ the prose.
  
  **What a consumer sees**
  
  | Before                                | After                                                                |
  | ------------------------------------- | -------------------------------------------------------------------- |
  | `<pkg>-<system>-being-<shortcode>`    | that, **and** `<pkg>-none-docbeing-<shortcode>`                      |
  | a being's prose reachable only inline | also a JournalEntry, and a page the site publishes                   |
  | `[[docbeing-x\|Text]]` unresolved     | resolves, in the link checker, the pack compilers and the site build |
  
  Packs gain one JournalEntry per being **carrying prose**; a being with an empty
  body compiles no entry, exactly as an item with an empty body does. No existing
  document changes.
  
  **A being keeps its prose inline as well**, and the asymmetry with items is
  deliberate. `system.appearance` and `system.dossier` stay as rendered text, where
  an item's description is an `@UUID` pointer into its journal. One item is
  embedded across hundreds of beings, so baking its description into every copy
  bloats the compendium by the length of the prose times the number of carriers,
  and the pointer buys that back. An actor is singular, so the same indirection
  would cost a reader a click and save nothing.
- afb3650: **An asset path's first segment says which package owns it, and the rule is now
  stated and tested** (#331).
  
  `img:` and `portrait:` have always answered "which package holds this file?" in
  their first segment, but nothing wrote the rule down and nothing asserted it —
  the only way to confirm it was to compile a package and read `build/packs-json`.
  
  | Authored path starts with | Owner                 | Emitted              |
  | ------------------------- | --------------------- | -------------------- |
  | `systems/`                | a separate **system** | unchanged            |
  | `modules/`                | a separate **module** | unchanged            |
  | anything else             | **this package**      | `<assetRoot>/<path>` |
  
  **The third row is now true.** The translator prefixed `icons/…` and `images/…`
  and passed everything else through — the same answer for every path any tree
  authors today, and the wrong one for the next directory a package ships.
  `sohl-kethira-basic` keeps art under `assets/artwork/`, so an authored
  `artwork/deity.webp` would have shipped unprefixed: a 404 in Foundry, reported
  by nothing. Ownership is the rule; the directory names inside a package's
  `assets/` tree are that package's business.
  
  An address naming no package — an absolute URL, a `data:` URI, a `/`-rooted
  path — passes through, on the same rule rather than as an exception. `worlds/`
  is deliberately not exempt: a package may not ship art out of a world.
  
  **No compiled document changes.** Compiling `sohl-thalorna` and this system's
  own tree before and after gives byte-identical `packs-json`; every path either
  tree authors is `icons/`, `images/` or already `systems/`-rooted.
  
  **`banner:` is a path that does not follow this rule, and is documented as
  deliberate rather than reconciled.** It reaches no compiled document: it is a
  top-level key the Hugo theme reads, and the theme prefixes a relative value with
  `images/` and joins it onto `params.cdnBaseURL`. The two address different
  places — `img:` a file Foundry serves, `banner:` a file the CDN serves.
- e3d300c: **An `img:` authored on a type that emits none is now reported instead of
  dropped in silence** (#349).
  
  `img` is a shared top-level field — it maps onto `document.img`, so it is legal
  on every note whatever the type — but not every document has one. `doc`, `place`,
  `lore` and `scenario` compile into a JournalEntry, `folder` into a Foundry
  `Folder`, and neither carries artwork; a `homepage` compiles into no compendium
  document at all. On any of those the authored path went nowhere, the note
  validated, the tree compiled clean, and nothing said so.
  
  The frontmatter lint now warns, naming the note, the key and what the type
  compiles into. `portrait:` is checked the same way, so an item authoring one is
  told it has nowhere to put a sheet portrait.
  
  **What it does not report.** `img: null` — that is the blessed way to say "this
  note names no art", and on a type with no art it is a true and harmless thing to
  say. A warning rather than an error, too: the note still compiles correctly, and
  a note's top level is the generated page's front matter as well, so a site
  template may read there what no document carries.
  
  **Which types those are is derived, not listed.** Each pass declares the art it
  writes (`BasePackCompiler.emitsArt`), and `emittedArtFor` walks type → document →
  pass to answer. A second table of iconless types would be free to drift from what
  is actually emitted, which is the defect rather than the check.
  
  **What a consumer sees.** New advisory findings on notes already in this state;
  warnings do not fail a build. `sohl-thalorna` has 57 — the `Lore/Totems/` and
  `Lore/Deities/Kemetian/` clusters, which carried an `img:` from when they
  compiled to affiliation items. The other shipped trees are clean.
- bd5e6cb: **`lore` declares `gathering`, a genre for a scheduled public occasion** (#333).
  
  A tournament or martial games, a great market or fair, a religious festival, a
  ceremony or rite: something that happens at a place and a time, on a cycle, and
  that people travel to. The genre had no value, and neither neighbour fitted.
  
  | genre       | what it covers                                                   |
  | ----------- | ---------------------------------------------------------------- |
  | `calendar`  | the _reckoning_ — the cycle, the seasons, the dating system      |
  | `culture`   | a social grouping of people                                      |
  | `gathering` | the occasion itself — who attends, what is contested or observed |
  
  A festival's **date** is `calendar`; the festival is not. A tournament is not a
  matter of time-reckoning at all, and a great market is not a grouping of people.
  
  **Why it matters beyond labelling.** `site.sections` narrows a section with
  `listSubType`, so a subType is what makes a genre browsable. Without one, a
  consumer declaring a Gatherings section would sweep in the castes, Marriage and
  Personal Names alongside the games — the notes could not be listed as what they
  are.
  
  **On the name.** `festival` is too narrow: a tournament is not a festival, a
  great market is a fair, and a rite is not a celebration. `event` is avoided
  because it already names something else in SoHL — the event queue and
  `system.scheduledActions`, where an event is a timed thing that fires in play.
  `gathering` covers the whole set, and matches how the other `lore` genres are
  named: a single lowercase noun for a kind of thing.
  
  Nothing existing changes. A note already filed under `lore/culture` keeps
  compiling until its author moves it; `subType` is not an address, so nothing
  resolves through it.
- 5630e7c: **A note can no longer author a field the document writes in play** (#330).
  
  A data model declares everything a document stores, and part of that is runtime
  state — an affliction's `onsetDate` is the world time its onset fired at.
  Writing `sohl.system.onsetDate` reached it as directly as any other field: the
  block is a verbatim passthrough, no declared field claimed the path, and the
  schema check's fatal direction is _undeclared_, which a field the schema really
  does declare satisfies. So a compiled pack could ship one world's play state to
  every world that installed it, with the build reporting success.
  
  A field declaration may now say `runtimeOnly`, whose value is the reason — what
  the field holds — the way `topLevelMeans` already works. It states both halves
  of one fact:
  
  | declaration   | authored    | absent          |
  | ------------- | ----------- | --------------- |
  | ordinary      | emitted     | default written |
  | `runtimeOnly` | **refused** | key omitted     |
  
  The refusal names the note, the line, the whole key and the field's own reason,
  and says that deleting it is the fix — there is no value that makes writing one
  right. Omitting the key rather than emitting `null` is what leaves the data
  model's own `initial` standing.
  
  It is a property of the declaration, not a list of names, so it holds for any
  runtime-only field any system adds later. Such an entry declares a `to` and no
  `name`, which keeps it out of the authored vocabulary — the generated field
  reference lists it under **Never authored** with its reason instead of as a row
  an author might fill in — while still claiming the path for the passthrough.
  
  **What a consumer sees**
  
  - SoHL's six timed-phase dates are declared: `contractDate`, `onsetDate`,
    `treatmentDate` and `resolutionDate` on `affliction`; `contractDate` and
    `treatmentDate` on `trauma`. No tree authors one today, so no compiled
    document changes.
  - The refusal covers both positions a note can reach them from: a note's own
    `<system>.system` block, and an actor's `items:` entry `system:` overlay,
    which merges verbatim and so passed no field declaration at all.
  - A runtime-only path is no longer reported as a field the builder forgot to
    emit — "every compiled document will carry the field's initial value" is what
    the declaration is _for_, so the warning could never be cleared.
  - Regenerate the item frontmatter reference to pick up the new section.
- cf20488: **The specification's `subType` lists are compared to the declared vocabulary,
  for every type** (#345).
  
  `tests/content-format-agreement.test.ts` made `docs/content-format.md`
  executable for the `data` property tables only. The other half of the same
  vocabulary entry — a type's genres, which an author picks from and which a
  note's `subType` is closed against — was prose that nothing read, free to
  disagree with `note-vocabulary.mjs` in either direction. That is the drift #231
  and #232 were filed about, on the half they did not reach. `gathering` (#333)
  guarded `lore` alone, deliberately scoped to the type it changed.
  
  **The five spellings converged on one first.** The document stated a type's
  values as `subType`, `subType:`, `**subType**`, `**subType**:` and
  `**subTypes**:`, and a reader that accepted every one of them would accept the
  sixth by reading that section as declaring nothing — the exact failure the
  comparison exists to catch. One shape is now stated in the specification and
  enforced by the parser: `**subType**:` on its own line, then `- <value>` or
  `- <value>: <definition>`, one bullet per value. A type with no `subType`, or
  one whose values are not enumerated yet, writes no marker.
  
  | Written                                      | Read as                                                     |
  | -------------------------------------------- | ----------------------------------------------------------- |
  | `**subType**:` + a bullet per value          | that type's closed value list, in document order            |
  | no marker                                    | the type enumerates none — the ordinary case for nine types |
  | any other spelling, or a marker with no list | a build error naming the line                               |
  
  **What the comparison asks**, of every type rather than of `lore`: the values
  the specification lists equal the values `NOTE_VOCABULARY` declares, in the same
  order. `subTypes` stays three-valued — a list is closed, `null` is a `subType`
  whose values are not enumerated, an absent key is a type with no `subType` at
  all — and each reading is compared to what the document states. The `lore`-only
  assertion is folded in.
  
  Nothing that compiles changes: the values were already equal everywhere, in both
  shapes, so this is about keeping them that way. `parseContentFormat` gains a
  `subTypes` array per type, and throws on a marker it does not recognise —
  reachable only through `content-format --spec <a copy of the document>`.
- 312379e: **Afflictions and traumas can declare their timed phases** (#329).
  
  SoHL stores each timed phase as `{…DurationFormula, …DurationBase, …Date}`, and
  the two authored thirds were declared by nothing. They were reachable only
  through the raw `system:` passthrough — undocumented, uncoerced, and absent from
  the field list every author-facing surface is built from — so no note in any
  tree wrote one. Every shipped affliction carried `null`, and
  `AfflictionLogic.rollDuration()` opens `if (!formula) return 0`: the timed-phase
  machinery existed, and the content that would drive it could not be written.
  
  They could not simply be declared either. `buildFromFields` wrote every declared
  field unconditionally, so a declaration would have stamped `null` onto every
  document — the same outcome, minus the ability to tell "unset" from "authored as
  empty".
  
  **`omitWhenAbsent`** is the missing capability: a field declaring it is emitted
  when the note carries one and has its **key left out entirely** when it does
  not, so the DataModel's own `initial` stands. It completes the table
  `runtimeOnly` (#330) opened:
  
  | declaration      | authored    | absent          |
  | ---------------- | ----------- | --------------- |
  | ordinary         | emitted     | default written |
  | `omitWhenAbsent` | emitted     | key omitted     |
  | `runtimeOnly`    | **refused** | key omitted     |
  
  The decision is made on the **position** a value came from, never on the value:
  a declared `default: null` and an authored `null` are the same value and
  opposite facts. `readFieldEntry` reports the source beside the value so the
  position is resolved once rather than twice.
  
  **Twelve fields are now declared vocabulary** — `onset`, `healingCheck` and
  `resolution` on `affliction`; `healingCheck`, `bloodLossAdvance` and `course` on
  `trauma` — each as both a `…DurationFormula` and a `…DurationBase`, in the
  `sohl:` block and in the closed `data:` container alike. Intervals are in
  seconds, and a bare number is a valid formula.
  
  **What a consumer sees**
  
  - The twelve appear in the generated item-frontmatter reference, with `_omitted_`
    in the Default column rather than a value. Regenerate the page.
  - The `unemitted` warnings these raised against a pinned schema clear.
  - No compiled document changes: no tree authors one yet, and a note that writes
    nothing emits nothing where it previously emitted nothing.
  - `omitWhenAbsent` may not be combined with `default` (contradictory), with
    `required`, or with `runtimeOnly`; the shipped declarations are checked for all
    three.

### Patch Changes

- b5004f0: **A `model:` now resolves an item whose shortcode carries a capital** (#346). The
  catalogue was keyed on the compiled document's `system.shortcode` exactly, while
  an address is lower-cased when it is read — so `model: weapongear-clb` looked for
  `weapongear:clb` while the document sat under `weapongear:Clb`, and every being
  referencing one of the six mixed-case gear shortcodes in `sohl` failed to
  compile.
  
  The catalogue key folds the shortcode's case. The **id-bearing** address does
  not: `itemAddress` seeds `embeddedItemId`, so folding there would change the
  `_id` of every embedded item whose identity carries a capital — silently
  re-identifying documents nothing about which had changed. A catalogue is a lookup
  table; an id is a promise.
  
  Verified by compiling both swept trees: `sohl` emits actors, items, macros,
  scenes and adventures byte-identical to its pre-sweep baseline, and
  `sohl-thalorna` differs only by the 938 embedded ids its sweep predicts.
- 4c57a5a: **A being's `data.portrait` reaches the actor** (#332). It never had: the
  emitters read `blockProperty(fm, "portrait")`, which knows a system block and
  the note's top level and never splits a dotted path, so the position the content
  format names was invisible to them — and the `?? defaultImg` beside it turned
  every miss into the subtype's icon rather than into a complaint. 646
  `sohl-thalorna` beings authored a portrait, 341 of them pointing at art that
  exists on disk, and every one compiled the generic person icon. Nothing warned.
  
  `portrait` now resolves through the same declaration `data.species` does, in
  both the `sohl` and `hm3` actor passes.
  
  **A `data:` source has a retiring top-level spelling, and step 3b reads it.**
  `data:` did not invent the facts it holds — it gathered them out of the note's
  open top level, where `portrait:` sat beside `img:` — so the pre-`data:`
  spelling of `data.<key>` is `<key>`, and until now nothing read it. That is why
  this is a resolution-order fix and not a one-line emitter fix: `data.portrait`
  had to start working _without_ breaking the top-level `portrait:` that `sohl`'s
  own bestiary writes on every note.
  
  The spelling is **derived**, not declared — a second declaration would be a
  second place for one fact to live — and only a `data.` source has one, so
  `protection.blunt` and `impact.die` resolve exactly as they did.
  
  **Nothing is dropped in silence any more.** A field read from the retiring
  top-level key emits a warning naming the line, the counterpart to the existing
  in-block report; the note compiles to the identical document either way. The
  frontmatter lint's `portrait: ""` check reads the `data:` position too, which it
  could not see before.
- 59469d7: **The dependency check read English prose in a comment as an import** (#355).
  
  `tests/dependencies-are-declared.test.ts` finds a shipped file's imports with a
  regex over the raw file text. It already reasoned about one false positive — the
  lookbehind stops `["from", "to"]` reading as an import of `", "` — but not about
  comments, where `from` is an ordinary word and the quotes are ordinary quotes.
  Any explanatory comment containing the word `from`, `import` or `require`
  followed by a quoted phrase was reported as an undeclared dependency:
  
  ```text
  FAIL sohl/item-fields.mjs imports only builtins, itself, or a declared dependency
    + [ "sohl/item-fields.mjs:455 → this note does not set the phase" ]
  ```
  
  The message names a real file and a real line and says a dependency is missing,
  so the first reading is that one genuinely is. Nothing in it suggests the culprit
  is a sentence, and the fix — reword the comment — is unrelated to anything the
  message describes. It cost a debugging cycle in #329, and the workaround left the
  trap armed for whoever wrote the next comment.
  
  **Comments are now blanked before the regex runs.** They are located by parsing
  the file, not by a second regex, so `//` inside a string literal is still a string
  literal. Each comment's characters are replaced one-for-one with spaces and its
  newlines are left alone, so every offset survives and a finding still points at
  the line a reader opens. The `sohl/item-fields.mjs` comment that provoked this
  reads naturally again, and the suite carries it verbatim.
- fec6c80: **The generated item-frontmatter examples no longer author an `id:`** (#314).
  
  `content-build docs item-fields` emitted `id: <16-character id>` in the worked
  example for every item type — thirteen of them in the `sohl` tree. Since #270
  and #277 a note's document `_id` derives from its canonical address, and the
  authored field is the escape hatch for keeping a document's identity across a
  shortcode rename, not part of the envelope every note carries.
  
  The example is the block an author copies as a template, and the page is the
  per-type reference they read while writing the note, so the one place the field
  survived a tree's sweep was the document teaching them to write it. It is now
  omitted, as every other optional envelope field already was; the `type` and
  `shortcode` the derivation reads are unchanged.
  
  Consumers should regenerate their item frontmatter reference to drop the line.
- a48802f: **A folder note's published `id` is now the id its Foundry documents carry**
  (#310).
  
  The content index derived every note's id under the `document` namespace. A
  `Folder` is hashed under the `folder` namespace, so the index published one
  value and the packs addressed another — `sohl-none-folder-cookware` was
  `f5d3dc635b7e799c` in the index and `b92b28b7d06638ed` in every pack.
  
  `noteDocId` now asks the folder pass for a folder's id instead of deriving a
  second one, so the two cannot disagree.
  
  **Why nothing caught it.** Every one of `sohl`'s 79 folder notes pins an `id`,
  and a pin wins in both paths — so all 65 emitted folder documents agreed by
  coincidence. It is also invisible from inside a build: no pass reads a folder's
  id off the index. The published artifact was the only place the wrong value
  surfaced, and a reader outside the build could neither recompute the right one
  nor notice the wrong one.
  
  **The general rule this settles:** for every entry the content index gives an
  identity to, it publishes both the `id` and the `uuid`, each computed once by
  whatever owns that entry's derivation. A documentation journal's record
  accordingly gains its own `id` — it carried the UUID that id ends in, but not
  the id — so a consumer reads it rather than parsing it back out of the UUID's
  last segment.
  
  _No emitted document changes; this corrects what the index says about them._
- ebd3a80: **A note-level frontmatter check no longer answers from a system field that
  merely shares the name** (#312).
  
  `topLevelMeans` exists because one spelling can name two unrelated quantities. An
  `affiliation` item's `system.title` is the style of address an office carries —
  "Ajaw", "Warden"; a note's top-level `title` is the heading its page publishes
  under. The field declares the collision, and `resolveFieldValue` honours it by
  refusing to read the top level for that field.
  
  The frontmatter lint did not. `authoredValue` resolved every check through the
  `sohl:` block first, so the blank-heading check — whose emitter is `fm.title ??
  name`, the note's top level and nothing else — read `sohl.title` and found the
  office's style of address. An office with no style of address is ordinary, and
  each one was reported as a page published with no heading, sorting to the front
  of its section.
  
  **The statement is symmetric, and is now read that way.** If two positions hold
  unrelated quantities then the in-block position is not the note-level field
  either, so a note-level check reads past a block key the note's own type claims
  for something else. The exemption is still the field's own declaration rather
  than a name the linter knows: `collidingBlockKeys` asks the schemas the caller
  supplies, so the linter and the resolver cannot disagree about which field
  declares one.
  
  **The art fields are checked the same way.** `img` and `portrait` keep resolving
  through the block, because that is what their emitter does — `blockProperty`
  reads `sohl.img` first, so a `sohl.img: ""` really does ship a document with no
  art and is still reported. What changes is that a future system field of either
  name cannot quietly answer for the note's own art; a map's was `sohl.image`
  until #142.
  
  **What a consumer sees.** Twenty-eight fewer warnings on an unswept
  `sohl-kethira-basic` — every affiliation writing `sohl.title: ""`. All were false
  positives; their pages took `name.full` throughout. A tree already swept onto
  `sohl.system.title` was unaffected either way, which is why the findings
  disappearing looked like a lint regression in that sweep rather than the
  false positives going away.
- f6a8a05: **The specification and four engine docblocks stated the retired folder model**
  (#358).
  
  The folder epic replaced a model wholesale — `folder:` named a Foundry id
  resolved against a per-pack `*-folders.yaml`, and `packFolder` named a path.
  None of that exists: `folder:` is refused, the YAML is gone, and `packFolder`
  is a folder note's address. Six passages still described the old shape as the
  live one.
  
  **`docs/content-format.md` contradicted itself twice.** The shared-mappings
  table — the one place eight rows common to all sixteen type tables are stated —
  offered `` `packFolder` / `folder` ``, so a reader was told to write a value the
  build rejects, 330 lines before the same document says it is retired. And the
  argument for deriving a document id cited "`packFolder: <path>` above", where
  above says address.
  
  **Four docblocks described the retired resolution path**, and they publish:
  
  | site                       | said                                                                                |
  | -------------------------- | ----------------------------------------------------------------------------------- |
  | `engine/generate.mjs`      | folder files "referenced from entry frontmatter via `sohl.folder: <id>`"            |
  | `engine/journals.mjs`      | the target folder's id "from folders.yaml", resolved against a folders.yaml list    |
  | `engine/base-compiler.mjs` | `folderResolver` "resolves a `sohl.folder` id against this pack's folder hierarchy" |
  | `engine/frontmatter.mjs`   | `folderField` reads "two spellings", `packFolder` winning "where both are present"  |
  
  The last two were the sharpest. `folderField` reads `packFolder` and nothing
  else, so its docstring described a resolution the function cannot perform and
  deferred to an issue that had closed. `generate.mjs` disagreed with itself
  across one file: the module header named `sohl.folder`, while its `resolver`
  states the rule correctly — "There is one spelling."
  
  **Prose is the defect the epic was about.** Its argument against
  `*-folders.yaml` was that a second, unchecked statement of one fact drifts from
  the first, and nothing compares the two. These six passages were exactly that,
  and nothing caught them: `lint:content-format` makes a claim only for a
  `system.*` target, so a row mapping to core Foundry's `folder` yields none, and
  the source side of a shared row is checked by nothing at all.
  
  Two assertions now hold the specification to it — the shared-mappings sources
  name no retired field, and the document never presents `packFolder` as holding
  a path. The docblocks are held to review instead: a sentence describing
  `folder:` as _retired_ is correct and must survive, and no assertion separates
  that from one describing it as live without reading the prose.
  
  No behaviour changes; the fix is what the documents say.

## 19.0.0

### Major Changes

- e46a791: **`folder:` and the `*-folders.yaml` schema are retired** (#260) — the last step
  of #254, once every tree is green on the new spelling.
  
  They go together. The `folder:` Foundry-id spelling had nothing left to resolve
  against once the YAML was gone, and the YAML had no reader once the spelling was
  refused. What replaces both landed in #255–#258: a folder is a note
  (`type: folder`), `packFolder:` names one by **address**, the packs a folder
  materialises in are derived from what references it, and its Foundry id is
  hashed from its canonical address.
  
  **What is gone**
  
  | Removed                                                      | Replaced by                                                                  |
  | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
  | `*-folders.yaml`, five files per tree                        | `type: folder` notes, resolved through the address index                     |
  | `loadFolders`, `buildFolderResolver` and its five invariants | `collectFolderNotes` / `buildFolderNoteIndex`                                |
  | `writeFolderDocs`                                            | `writeFolderNoteDocs`, written after the pass that learns what it references |
  | The `folders:` pack-configuration key                        | nothing — a pack materialises what its documents reference                   |
  | `folder:` on a note                                          | `packFolder:`                                                                |
  
  **Both are refused, not ignored.** A retired field left ignored reads to its
  author as though it still works: the note says one thing and the build does
  another, and nothing says so. A note that writes `folder:` fails the build
  naming `packFolder` and the line to rewrite, and the frontmatter lint reports
  every one of them in the tree at once — which is what a tree still to sweep
  needs. A pack configuration that still names a `folders:` file is refused the
  same way, saying where the folders went rather than merely "no such key".
  
  **Presence is the whole test**, in both positions a note wrote it — top-level
  and inside the `sohl:` block. An empty `folder:` parses as `null` and is still
  the field, and a value that happens to match a folder note's id is still the
  retired spelling. There is no value that makes writing it correct, so each
  message says what to write instead rather than which value to change.
  
  **Why this is a major.** A tree that has not swept goes red on adoption, by
  design — that is the signal, and it is the reason the removal waited until the
  support and the sweeps had landed. Removing either half earlier would have
  broken a repository mid-migration, which is the failure the `image:` → `img:`
  migration (#142, #149) was staged to avoid: read both, sweep, then remove.
  
  _The adventure-configuration path is untouched here — see #259, deferred._

### Patch Changes

- 829363c: **The container's export is a git repository**, so a workflow step that shells
  out to git behaves as it does on the runner.
  
  `git archive HEAD` yields a bare directory with no `.git`. A step that asks git
  something — `git ls-files` in a tracked-artifact check, for instance — then
  fails for want of a repository, which reads as _the check failing_ rather than
  as this harness lacking something the runner has. GitHub's own first step is a
  **checkout**, so the faithful export is one too.
  
  Found by `HarnMaster-3-FoundryVTT`, whose `check-no-compiled-packs.mjs` lists
  tracked files that way: it passed on the host and failed in the container, and
  the pre-push hook duly refused a push over a defect that was entirely this
  harness's — exactly the false positive that teaches people to reach for
  `--no-verify`.
  
  Initialised and staged rather than committed: `git ls-files` reads the index, so
  staging every extracted file reproduces exactly the set the runner would see,
  and nothing needs a configured identity to commit with. Where `git init` cannot
  run, it says so and carries on rather than pretending.

## 18.2.0

### Minor Changes

- e55c1c0: **The git hooks ship here now**, and with them a pre-push check that runs a
  repository's own Build & Test workflow in a container before the push leaves.
  
  **Why here.** Five repositories carried `.githooks/` with `commit-msg`,
  `pre-commit`, `pre-merge-commit` and `protected-branch.sh` — **twenty copies of
  four byte-identical files**, each free to drift. The `.github` repository cannot
  help: its `actions/*` are fetched by the GitHub _runner_ through `uses:`, and
  nothing on a developer's machine fetches from it. This package is what every
  repository already installs, so it is the only thing that reaches every
  checkout.
  
  A consumer points git at the packaged directory once:
  
  ```json
  "prepare": "git config core.hooksPath node_modules/@heroiclands/package-build/githooks"
  ```
  
  and then carries no hook files at all.
  
  **Every hook has its own switch.** They read `hooks.<key>` through one shared
  `hook_enabled` helper, with git's normal precedence — a plain `git config` sets
  one clone, `--global` sets a machine — so they are turned on and off
  individually rather than as a set:
  
  | hook                             | key                     | default |
  | -------------------------------- | ----------------------- | ------- |
  | `pre-commit`, `pre-merge-commit` | `hooks.protectedBranch` | on      |
  | `commit-msg`                     | `hooks.noAttribution`   | on      |
  | `pre-push`                       | `hooks.prePushCi`       | **off** |
  
  The defaults differ deliberately: a guard that costs nothing is on unless
  refused, while one that runs a container for minutes is off unless asked for.
  `hooks.allowCommitOnMain` is still honoured — it is the name that has always
  meant this, and an existing opt-out must not quietly stop working. The two
  branch hooks share a key because they are one rule: git runs `pre-merge-commit`
  _instead of_ `pre-commit` for a merge, so separate keys would let a `git pull`
  on `main` through a half-disabled guard.
  
  **The new hook, and it is off unless you ask for it.** `pre-push` runs the
  steps of the repository's own `.github/workflows/build.yml` and refuses the push
  if they fail — but only where someone has opted in:
  
  ```bash
  git config hooks.prePushCi true            # this clone, and every worktree of it
  git config --global hooks.prePushCi true   # every repository on this machine
  ```
  
  Off, it is silent and instant. That is deliberate: the check costs a couple of
  minutes and ships to every repository installing this package, so it must not
  be something a contributor discovers by having their push get slow.
  
  Four decisions worth knowing:
  
  - **The steps are read, not restated.** `ci/ci-steps.mjs` parses them from the
    workflow, so there is no second copy of the command list to go stale — which
    matters because a stale copy fails _silently_: running four of five steps
    still exits 0. It refuses loudly when it recognises no steps or finds no
    workflow, and names the `uses:` steps it cannot run. It parses rather than
    importing a YAML library because the first step it must run is `npm ci`, so
    anything from `node_modules` is missing exactly when it is needed.
  - **In a container, over `git archive HEAD`.** Timing decides this: the workflow
    begins with `npm ci`, so a host run costs about what the container costs
    (134s cold, measured) and pays it by deleting the working tree's
    `node_modules` each time. The container touches nothing of yours and tests
    only committed content, as GitHub does — closing a dirty environment and a
    case-sensitive filesystem, neither of which a Mac can catch.
  - **`linux/amd64` by default**, matching the runner. Measured on Apple silicon
    with Docker Desktop's Rosetta translation: JS compute 1104/1071/1078 ms native
    against 1098/1062/1093 ms emulated, and `npm ci` 23s either way —
    indistinguishable, so matching the runner is free. `--native` opts out, for a
    machine where that translation is unavailable.
  
  - **Docker is not required, even when enabled.** Without it the check reports
    that it could not run, says so loudly, and **lets the push through**. The
    workflow is what enforces this; the hook only saves a round trip, so someone
    without Docker — or without this package installed — must still be able to
    open a pull request. Only a genuine check _failure_ refuses a push.
  
  `git push --no-verify` skips it once. A branch delete pushes no commits, so the
  hook stands aside. First enabled run pulls the image (~400MB), once.

## 18.1.1

### Patch Changes

- 029cf03: **A homepage note is no longer refused for an `id` it did not author** (#319).
  
  `resolveNoteId` fills `fm.id` **in place**, so every downstream reader sees one
  derived value — deliberate, and documented as such. The homepage refusal
  iterated that same object, so a note that authors no `id` was reported with a
  message telling the author to delete a field that is not in the file.
  
  It was an **error**, so it failed `lint:addresses`, and `lint` heads the build
  chain — which meant it failed every pull request opened against a repository
  carrying a homepage note, whatever that pull request changed.
  
  A refused field must now be one the note actually wrote. The caller already owns
  the raw note text and already positions these findings with it, so it answers
  which keys are declared at the note's own top level; `positionInFrontmatter`'s
  `topLevel` option is the existing helper for exactly that question, so a nested
  `id:` under some other key is not mistaken for the note's own. With no answer
  supplied, every key in `fm` still counts — the previous behaviour, and the right
  one for a caller holding authored frontmatter only.
  
  Measured on `sohl`: `lint:addresses` goes from one error to **clean across all
  1,685 notes**.

## 18.1.0

### Minor Changes

- e9a4200: **The gear-suffixed note types are restored** — `armorgear`, `concoctiongear`
  and `projectilegear` are the vocabulary again, reversing #78.
  
  #78 renamed them to `armor`, `concoction` and `projectile`, on the argument that
  the suffix named the _SoHL document subtype_ a note compiled into rather than
  the thing the note is about. The argument had a cost the rename did not pay for.
  
  **Nothing adopted the bare spellings.** Across all five content trees, every note
  still authors the suffix — 331 `armorgear` and 18 `projectilegear` in `sohl`, 71
  `concoctiongear` in `thalorna` — and **not one note anywhere** writes `armor`,
  `concoction` or `projectile`. The rename produced **349 warnings and zero
  adopters**, and it was those warnings that made `lint:addresses` noise on every
  consumer that took 18.0.0.
  
  **It also cost a property worth more than the argument.** `weapongear` and
  `containergear` kept their suffix — SoHL and HM3 both call those documents that —
  so the rename left three of the five gear types spelled one way and two the
  other. With it reversed, every SoHL row of the note-type → document-subtype map
  is the identity again, all fourteen of them, which is what lets two tests drop
  their exception lists entirely.
  
  `RENAMED_TYPES` is reversed rather than emptied, so the bare spellings are still
  _read_ and _reported_ rather than refused — the same retirement window the
  rename itself used, pointing the other way. `armorlocation`, the type #78 added,
  is unaffected: it was new, not renamed.

## 18.0.0

### Major Changes

- 0d15342: **The cross-package link manifest is gone.** A package now publishes its own
  content index and a consumer fetches the ones it depends on (#239).
  
  The manifest was vendored — every repository committed a copy of every other
  repository's file — and that failed three ways, none of them fixable by
  tightening it.
  
  **A copy goes stale silently, and one was.**
  `Song-of-Heroic-Lands-FoundryVTT` carried 2,101 `thalorna` entries whose address
  was the old name-derived form, so every cross-package link it rendered pointed
  at a URL the site had stopped publishing. The format-version gate saw nothing,
  because the format had not changed — only the values were wrong.
  
  **Mutual vendoring deadlocks.** SoHL vendored thalorna and thalorna vendored
  SoHL, so a format bump stopped both builds until the other had already
  published: neither could go first.
  
  **It was a second answer to a settled question.** The content index already
  carried the canonical key, the name, the anchors, the Foundry `uuid` and the web
  address. There was nothing in a manifest entry it did not hold.
  
  **What replaces it**
  
  - Every package emits `<package>-metadata.jsonl` and advertises it as
    `flags.metadataUrl`, pinned to the version being built.
  - The release publishes it as a third asset, named by that URL so the file
    shipped and the URL advertised cannot disagree.
  - `content-build deps fetch` pulls each dependency's index into
    `build/cache/metadata`, reading the `manifest` URL the relationship already
    declares and taking `flags.metadataUrl` from it. The whole chain is declared;
    nothing holds an address of its own.
  - Cross-package links resolve from that cache.
  
  **The dependency set is every declared dependency** — everything in
  `relationships.systems` and `relationships.requires` — and deliberately _not_
  only those declaring `itemCatalog: true`. Citing another package's addresses and
  embedding its items are separate edges: `harn-ensemble` cites no foreign address
  and carries 324,016 embedded item references. `recommends` and `conflicts` are
  not dependencies and are not fetched.
  
  **Removed:** `engine/kb-manifest.mjs`, `engine/foreign-manifests.mjs`, the
  `content-build manifest` command, its `--manifests` options, and the
  configuration keys `paths.manifests`, `paths.manifestOut` and
  `publish.manifests`. `engine/manifest-emit.mjs` becomes
  `engine/foundry-entries.mjs`, which is what it always did — `manifest.mjs` and
  `kb-manifest.mjs` both exported `buildManifest` meaning different things, and
  that ends here.
  
  **Kept, and moved:** the address grammar — `canonicalKey`, `readCanonicalKey`,
  `CANONICAL_KEY_SEGMENTS`, `PACKAGE_BASE` and the URL helpers — now lives in
  `engine/content-address.mjs` beside `addressSlug`. It was never the manifest's;
  deleting the module without splitting it would have taken the address form too.
  
  **Two behaviours moved rather than vanished.** A manifest-completeness gate no
  longer exists: a declared dependency with no fetched index is a hard error
  naming `deps fetch`, so past the load everything is accounted for. And whether a
  package serves pages is now the consumer's `PACKAGE_BASE` rather than the
  producer's entries — a package with no configured base stays citable by UUID and
  simply yields no URL, which is what `kethira` needs.
  
  **Consumers must act.** Declare your dependencies in `relationships`, run
  `content-build deps fetch` before a build that resolves cross-package links, and
  delete `assets/manifests/`. A configuration still naming `publish.manifests` or
  `paths.manifests` will be rejected as an unknown key.
- e5f40c7: **A document's id is derived from its identity, not authored and not keyed on a
  list position.** Three ids changed how they are computed (#270, #268), and every
  compiled id this toolchain emits is affected.
  
  **1. A note's document `_id` derives from its canonical address (#270).**
  
  ```
  _id = makeId("document", "<package>-<system>-<type>-<shortcode>")
  ```
  
  `id:` becomes **optional**. A note used to author one — an opaque 16-character
  string, 6,343 of them across the four content trees — that said nothing its
  address did not, could not be read or reviewed, and was guaranteed by nothing:
  `content-lint` refuses a duplicate **address** across every pack of a document
  type, which is exactly the scope a primary document's id must be unique within,
  and it said nothing at all about a duplicate `id`. The derived id inherits a
  guard that already exists. It is the same principle that turned
  `folder: ONXsqZAIZr2qzxTb` into `packFolder: <path>` (#251, #252).
  
  **An authored `id` always wins, and pinning one is how a document keeps its
  identity across a shortcode rename.** That is the pattern the map compiler
  already used (`regionDocId(sceneId, key, pinned)`), now applied to primary
  documents too.
  
  **2. An actor's embedded item is keyed on its identity, not its index (#268).**
  
  ```
  _id = makeId(<actor id>, "<subType>:<system.shortcode>")
  ```
  
  An entry's identity is its **own `system.shortcode`**. The entry's top-level
  `shortcode` is a _selector_ naming the template it is written from, is never
  written to the document, and may repeat. **Two entries resolving to one identity
  are now a build error naming both** — the case a position key used to hide by
  compiling them to two documents denoting one entity.
  
  **3. An unanchored journal page is keyed on its heading, not its index (#268).**
  
  ```
  _id = makeId("journal-page", "<entry id>:<name>")
  ```
  
  Two sibling pages sharing a heading is likewise a build error, matching the
  `MD024` lint rule that already refuses it. An anchored page is unchanged — it
  never took an index, and is the shape the other two now share.
  
  **Why position was wrong.** A Foundry id is how a world refers to a document it
  imported. Keying on position meant reordering a being's item list, or inserting
  a heading into a note, silently renumbered every id after the change — so a
  re-import created new documents beside the old ones. Nothing about those
  documents had changed; only their neighbours had.
  
  **What this costs, measured against a real corpus** (`sohl`, 1,606 notes →
  3,094 documents):
  
  | id                        | count | moved |
  | ------------------------- | ----- | ----- |
  | primary documents         | 3,094 | **0** |
  | embedded items            | 1,337 | 1,337 |
  | journal pages, anchored   | 296   | 0     |
  | journal pages, unanchored | 1,648 | 1,648 |
  
  No primary id moved **because every note in that tree still authors one**, and a
  pin wins. #270 is inert until a tree drops its authored ids; #268 lands at once.
  Stripping all 1,605 authored ids compiles with no new errors, derives every id
  exactly as the formula above states, and leaves all 5,712 internal `@UUID`
  references as consistent as before.
  
  **Consumers must act.**
  
  - **Every embedded item id and every unanchored page id changes once.** A world
    that imported these documents will see new ones on re-import.
  - **Removing a tree's authored `id:`s changes every compendium UUID that package
    publishes**, once. Internal references are regenerated in the same build and
    stay consistent with each other; anything outside — a GM's world, a macro, a
    module — will not. Do it deliberately, and per tree.
  - **Fix any duplicate embedded identity first.** Measured across the four
    corpora: 20 entries in 17 notes, every one a defect. `sohl` has 1
    (`Characters/Aldrik_Harvenar.md` carries `skill/swim` twice);
    `sohl-thalorna` has 19; `harn-ensemble` and `sohl-kethira-basic` have none.
  
  **One diagnostic narrows.** `content-build addresses` tells a **rename** from a
  **withdrawal** by matching document ids across releases. That rested on the id
  being independent of the shortcode; it no longer is, so for a note that pins no
  `id` both sides move together and a rename is reported as a withdrawal with no
  successor named. It never reports a _wrong_ successor, and stays exact for a
  pinned note.
  
  **"Has an id" no longer means "has a compendium document."** Every addressable
  note derives one now, so the types that compile into no _single_ document say so
  themselves rather than resting on an absent `id:`. A **homepage** publishes no
  UUID because it is in no pack, and a **folder** because it may be in several —
  it materialises in every pack holding a document that references it (#276), and
  its id is hashed under the `folder` namespace against its own address. Either
  one would otherwise have published an `Item` UUID at an id no document carries.
  
  **Also:** `assertUniqueAnchors` is renamed `assertUniquePages` (the old name
  remains as a deprecated alias) and now checks page names as well as anchors;
  `journalPageId(entryId, page)` no longer takes an index.
- dcff2f9: **The SoHL passes emit `system.templatePriority`, not `system.archetype`**
  (#266).
  
  The read half landed already: `templatePriority` is what a note authors, and
  `archetype` is read only as the retiring spelling. The **emitted** key stayed
  behind, so a compiled document still carried the old name — and that half cannot
  move on its own schedule, because the receiving schema and the emitted key have
  to agree. `Song-of-Heroic-Lands-FoundryVTT#1836` renames the data-model field;
  this is the other side of that single change.
  
  **Why it is breaking.** Foundry discards an undeclared `system` key at
  construction _without a warning_, so a build emitting `archetype` into a system
  that declares `templatePriority` reports success and ships documents whose
  priority is silently gone. The emitted-versus-declared check catches exactly this
  and fails the pack build, which is what makes the pairing enforced rather than
  hoped for: **a consumer must take this release together with a SoHL that declares
  `system.templatePriority`** (0.8.4 or later). Taking one without the other fails
  the build with a message naming the field, rather than shipping quietly broken
  packs.
  
  `resolveArchetype` and `systemArchetype` are renamed `resolveTemplatePriority`
  and `systemTemplatePriority`; the generated field-reference example authors
  `templatePriority: null`, since the linter now refuses the old spelling in the
  example it tells authors to copy.
  
  The HM3 pass is unaffected — it already wrote `flags.hm3.templatePriority`.
- 79d9503: A top-level `traits:` block is refused (#291).
  
  #128 moved a being's description — `gender`, `species`, `age`, `birthday`, `height`,
  `weight`, `frame` and `appearance.*` — out of a top-level `traits:` block and into
  the closed `data:` container the content format declares. **2,533 notes across four
  repositories** have landed, and every content tree now carries zero. This is the third
  and last step of that retirement.
  
  **Refusing it matters more than refusing an ordinary dead key.** Top level is
  _deliberately open_: an unrecognised key there is passed straight through to Hugo. So
  a stray `traits:` would not be ignored loudly — it would arrive on the published page
  as a theme parameter, checked by nothing, reading to its author as though it still
  worked. The whole argument for `data:` being closed is the argument for refusing this.
  
  The message states the **mapping**, not just the destination, because three of the
  keys reshaped as well as moved: `traits.height.m` → `data.height` (metres),
  `traits.weight.kg` → `data.weight` (kilograms), `traits.build.frame` → `data.frame`.
  A bare _"write `data:` instead"_ would send an author to write `data.height: {m: 1.78}`
  — a declared key holding an undeclared shape.
  
  **`sohl.traits` is untouched.** It is a different field that shares the name —
  `projectilegear` declares one and the theme's gear sidebar reads it — so the refusal
  is anchored at column 1 and never reaches inside a system block.
  
  Refused from the same two compile paths as `draft:`, `aliases:` and `section:`, and
  reported by the frontmatter lint alongside them.
- d17dc98: **A `dataview` query that selects no notes is now a build error** (#223).
  
  A zero-row table publishes as a bare header and a rule, so a stale query — a
  renamed type, a retired category, a typo'd path — looked exactly like a category
  that is legitimately empty. Both builds emitted it and neither said a word.
  
  Where a table is meant to be empty, say so on the fence — `dataview allow-empty`
  in place of `dataview`. The opt-in sits on the fence rather than in the query
  because it is a statement about the directive, not part of the query language.
  The table is still rendered either way: the finding is the point, not
  withholding the output.
  
  The finding names the note, the line of the block and **the clause that matched
  nothing**, quoted as authored, because that is the string the author will edit.
  
  **The site build's table findings are compiler-parseable too.** They were prose
  with a timestamp where a parser reads the path, so one authored table produced a
  machine-readable diagnostic from the pack build and something ungreppable from
  the site. Both now emit `file:line:column: error: message`.
  
  **Major, because a tree carrying a dead table goes red on adoption.**
  `Song-of-Heroic-Lands-FoundryVTT` carries **40**, across eight notes — including
  the eight `type = "creature"` tables in `Rules/Bestiary.md` that the issue was
  filed about, a `sohl.kbcat = "birthsign"` query for a retired concept, and a
  `contains(file.tags, "religous")` that is simply a misspelling. None of them has
  published a row in months.
- 43a1f4d: **The address grammar is strict, and omission runs left to right** (#59).
  
  ```text
  [[[[<package>-]<system>-]<type>-]<shortcode>]
  ```
  
  The written forms are exactly the suffixes of the canonical address —
  `type-shortcode`, `system-type-shortcode`, `package-system-type-shortcode` — and
  **`package-type-shortcode` is not one of them**. A link into another package must
  now be fully qualified. That is the price of positional segments, and the
  alternative is a parser that needs a vocabulary to tell a package from a system.
  
  `readQualifier` counted at most three segments and never read a system, so it
  accepted a package with its system omitted and every authored target resolved
  system-blind. It now counts segments and assigns each position its field, the
  same rule `readCanonicalKey` follows.
  
  **`sohl` is both a package and a system**, and counting is what makes that
  harmless: three segments name a _system_ whatever the first segment could also
  have meant, and four is the full form. Nothing has to guess which sense was
  written.
  
  **A stated system is now matched, not merely parsed.** A target naming a system
  resolves against the segments it supplied rather than falling back to the
  system-blind short key, so `[[hm3-skill-clmb]]` no longer silently resolves to
  a `sohl` note.
  
  **A hyphenated shortcode is no longer read.** The old parser split at the _first_
  hyphen so a shortcode could contain one (`trauma-self-pro`); #1397 made every
  segment `^[A-Za-z0-9]+$`, and the two rules cannot both hold. The charset rule
  wins — it is enforced, and no tree has used the tolerance: 138,204 authored
  shortcodes across four content trees, none carrying a separator.
  
  **Verified against real content, not fixtures.** `content-build links` over
  `Song-of-Heroic-Lands-FoundryVTT` (1,606 notes) and `sohl-thalorna` (1,852 notes,
  which links into SoHL) reports the _same_ findings before and after — 43 and 122
  respectively, identical file sets, no new failure. No authored link in any of the
  four trees uses the retired form.
  
  Two messages follow the grammar: an ambiguity now asks for the fully qualified
  form rather than a package-qualified one that would not parse, and a labelled
  non-address names both the local and the cross-package spelling.
- d17dc98: **A content-index record's Foundry address is keyed by the system that compiles
  it.** `foundry.uuid` becomes `foundry.<system>.uuid` for a document a _game
  system_ defines — an Item or an Actor — while a document the _note format_
  defines keeps the unkeyed form.
  
  ```json
  "foundry": { "sohl": { "uuid": "Compendium.sohl.items.Item.…" } }         // an item
  "foundry": { "none": { "uuid": "Compendium.sohl.journals.JournalEntry.…" } } // a journal
  ```
  
  The vocabulary is the specification's — `sohl`, `hm3`, and **`none`** for a note
  that belongs to no system, the same value the canonical address carries in its
  `<system>` segment (`harnadventures-none-being-grod`, #59). Every record is
  keyed, so "belongs to no system" and "nobody filled this in" are not the same
  shape.
  
  **A note may declare more than one system**, and each compiles into its own
  document, of that system's type, in that system's pack: 2,497 of
  `harn-ensemble`'s notes carry both a `sohl:` and an `hm3:` block, and its
  `packs:` declares an `actors-sohl` _and_ an `actors-hm3`. One `uuid` on the
  record cannot name two documents — it named whichever the single shipped map
  produced and said nothing about the other.
  
  Only `sohl` can appear today, because `KNOWN_DOCUMENT_SUBTYPE_MAPS` holds one
  map and #139 tracks the missing `hm3/` half. **The shape changes now so that
  adding it is one more key rather than a second breaking change** to an artifact
  consumers have already started reading.
  
  **A journal, a macro or a scene is `none`.** Those are the note format's own
  documents rather than a system's, and the documentation journal an item
  compiles beside itself is `none` too — it is one journal however many systems
  the item declares. On `sohl` that is 1,474 records keyed `sohl` and 1,514
  keyed `none`.
  
  The uuid _values_ are unchanged: still equal to the link manifest's, verified
  across `sohl`'s 2,988 addresses with no mismatch.
  
  **Not synthesized onto the `sohl:`/`hm3:` blocks themselves.** Those are regions
  a note authors, and `DERIVED_KEYS` — which refuses a note that writes over
  derived data — reaches only the top level. A note authoring `sohl.uuid` would
  collide silently, which is the failure this index exists to prevent.

### Minor Changes

- ad813e1: **`lint:addresses` reads the content index too** (#243) — the second reader
  converted, and the last of the two lints the issue names.
  
  `addresses diff` reads the tree twice: once for the renames notes declare, once
  to place its findings against the note that made them. Those were two
  independent walks, each parsing every note, each answering "which files are the
  corpus?" for itself. They are now **one** derivation — `indexRecordsFor`,
  enumerated once by the command and handed to both — so the two halves of a
  single command cannot disagree about the corpus, or about the ids in it.
  
  **A latent defect goes with it, and the id is the reason it mattered.**
  `noteFilesById` joins tree-side ids against ids read out of the _compiled
  packs_. Since #270 an id is derived from the canonical address, whose first
  segment is the content package — and the tree side derived it through
  `resolveNoteId(fm)` with no package, which falls back to `contentPackage()` and
  so to whichever configuration the working directory answers with. The compiled
  side is produced by a compiler running on the configuration the _build_
  resolved. Let those differ — under `PACKAGE_BUILD_CONFIG`, in a worktree, in a
  test — and **every id fails to join**: every rename degrades to a withdrawal, and
  every finding loses the note it should have been reported against. The
  configuration is now passed in and both sides derive from the one that was
  resolved.
  
  **It is also faster, which is the shape of the win.** Two whole-tree walks
  became one derivation: over `sohl`'s 1,685 notes the pair of reads goes from
  about 2.8s to about 1.4s. Both maps are byte-identical to what the walks
  produced — 1,685 ids, and the declared predecessors of five renames spanning
  five item types, including the `projectilegear`/`missilegear` pair that a
  declaration keys under both maps.
  
  The scope requirement moves to a shared `assertStatedScope`, so a reader of the
  content index refuses an unstated scope in the same words `walkMarkdownTree`
  does. A pass reading the index makes the identical claim about which files it is
  looking at and must be held to the identical rule; a quiet default there would
  reintroduce the second answer #243 removed.
  
  `declaredPredecessors` and `noteFilesById` take `config` and already-derived
  `records`. Where the walk yielded nothing for a tree that is not there, so do
  they.
- 9e4861c: An affiliation records what it answers to, where it sits, and what it holds sway
  over (SoHL#1781).
  
  **`relation` is now `relations`.** The field holds a _map_ of standings, one per
  affiliation — its own description said so, and `resolveRelation` has always read it
  that way. The singular named the many as one.
  
  The retired spelling is still read, underneath the current one, and reported through
  `RETIRED_FIELD_ALIASES` — the same three steps `img`/`image` and
  `templatePriority`/`archetype` take. `relations` wins wherever a note writes both,
  and the thrown message names whichever spelling the note actually used. Only
  `affiliation` declares the field, so `relation` stays an ordinary unknown key on
  every other type.
  
  **Three fields are new**, and each was unexpressible before: the content format
  specified them and no declaration could receive them.
  
  | authored  | emitted          |                                                                                                      |
  | --------- | ---------------- | ---------------------------------------------------------------------------------------------------- |
  | `parents` | `system.parents` | The bodies it is subordinate to. A list, because an affiliation may sit under more than one at once. |
  | `seat`    | `system.seat`    | Where its authority sits.                                                                            |
  | `domains` | `system.domain`  | The places it holds sway over.                                                                       |
  
  `seat` is deliberately not `capital` or `headquarters` — each fits about half the
  eleven subTypes, while a seat covers a polity, a guild, an order and a faith alike.
  
  `domains` → `domain` is **authored plural, emitted singular**, which is what the
  format's own mapping row states. The declaration carries both spellings so neither
  side has to guess, and a note that authored `domain` would otherwise have compiled
  to nothing.
  
  `parents` and `domains` are separate because they are different relations —
  _subordinate to_ against _holds sway over_ — and an earlier `parent.regions` grouped
  the geographic one under the organisational one while also naming regions where a
  guild's domain may be a single town.
  
  Both lists ship `[]` rather than null: _refers to nothing_ is a value here — a
  sovereign polity answers to nobody — not an absence. Blank rows, which a cleared
  property editor leaves behind, are dropped rather than emitted.
  
  **This needs the schema half to land with it.** SoHL declares `system.relations`,
  `system.parents`, `system.seat` and `system.domain` in the same wave; an emitted key
  the data model does not define is discarded at construction without a warning.
- 1274ff8: **The markdown note vocabulary drops the `gear` suffix** — `armorgear` → `armor`,
  `concoctiongear` → `concoction`, `projectilegear` → `projectile` (#78).
  
  Those three named the **SoHL document subtype** a note happened to compile into rather
  than the thing the note is about. A note's `type` sits outside the `sohl:` and `hm3:`
  blocks precisely because it belongs to no system, and HM3 already compiles a projectile
  into a `missilegear` — so the suffix was never a fact about the note. `weapongear` keeps
  its name: both systems call that document a `weapongear`, so it says nothing
  system-specific. `armorlocation`, which maps to an HM3 Item and to nothing in SoHL at
  all, is a first-class note type: the vocabulary is system-agnostic, not a list of what
  SoHL happens to define.
  
  **Nothing in a compiled pack moves.** The emitted document subtypes are unchanged — an
  `armor` note still compiles into an `armorgear` Item — so no world, no compendium and no
  `_id` is affected. Verified by recompiling `Song-of-Heroic-Lands-FoundryVTT` (331
  `armorgear` and 18 `projectilegear` notes) and `sohl-thalorna` (71 `concoctiongear`) with
  the released toolchain and with this one, and diffing every emitted document: 3,091 and
  2,605 files respectively, byte-identical, with the content trees untouched.
  
  **Both spellings are read, and the retired one is reported — not refused.** This is the
  first of the three steps `package:` took, and the rule `RETIRED_FIELD_ALIASES` already
  states for a renamed _field_: a note carrying the old spelling compiles into exactly the
  document it always did, so failing a build over it would red a tree that has done nothing
  wrong. There are some 31,000 references to move, overwhelmingly `(type, shortcode)`
  entries inside a being's `items:` list, and a consumer must be able to adopt the new
  toolchain before its content does. `content-build lint` reports each one as a **warning**
  naming the file, the line and what to write instead; the sweep and the refusal come after.
  
  **Both sides of a reference resolve.** A being's embedded `(type, shortcode)` reference
  carries the note vocabulary too, and those outnumber notes' own `type:` keys by roughly a
  thousand to one — so `referencedSubtype` normalises alongside the note's own type. A
  window that resolved notes but not references would have dropped 30,000 embedded items in
  silence.
  
  **Two lookups where the vocabularies now genuinely differ**, and both are translated
  rather than joined by name:
  
  | lookup                      | keyed by         | what changed                                                                                                                                                          |
  | --------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `sohl/default-item-art.mjs` | document subtype | `SohlItem.getDefaultArtwork` reads it with a Foundry `Item`'s own `type`, so the map stays on the document side and `sohl/item-builders.mjs` translates before asking |
  | the published-schema check  | document subtype | `compareFields` gets the `subtypeOf` seam it was given for exactly this, so `armorgear`'s findings still fire                                                         |
  
  **Planning a sweep? Two things to move with the frontmatter.** A note's canonical address
  — and therefore its document `_id` — carries its `type` as authored, so renaming a note's
  type moves the address it publishes at. Every wikilink into it and every content-table
  query naming the type (`WHERE type = "armorgear"`) has to move in the same change, and a
  package that _links into_ another has to move with it.
- d17dc98: **A `#section` link is checked by the build that emits it, not only by the
  checker** (#193). `content-build links` reported a dead anchor as an error while
  the pack compilers hashed _any_ slug into a `JournalEntryPage` id and emitted a
  `@UUID` for it — so a link the checker refused still compiled, and dead-ended
  for the reader.
  
  A **foreign** anchor was already checked, because a vendored manifest publishes
  an `anchors` map. A local one was not, for the reason #193 gives: neither index
  held the set. The walk that builds the link index yields each note's body and
  nothing read it.
  
  It reads it now, through the one anchor reader, and reports `unknown-anchor`
  with the message the foreign path already used — nothing new is named.
  
  An index built without anchors still says nothing, which is deliberate: it
  cannot answer the question, and answering it wrongly is what this fixes.
  
  `collectAnchors` moves to `engine/anchors.mjs`, a module that imports nothing.
  It has to: the link checker, the content index and the compilers all ask this
  question, and `helpers.mjs` is imported by the compilers while the index imports
  the manifest emitter, which imports them back. A leaf is what lets all three
  share one reader instead of two disagreeing ones.
- b67a786: **A `bundle` note compiles into a Foundry `Adventure`** (#259).
  
  #263 specified and declared the type and left it uncompiled — authoring one said
  so, in as many words — because two decisions came first, neither answerable from
  the specification. Both are settled here, and the pass exists.
  
  **Which pack.** Not the `adventures` **companion**. The scenes pass already
  writes one Adventure per pinned place into that pack, and a companion is written
  by its parent pass rather than routed to — the router refuses a note that
  addresses one, and is right to. So a bundle lands in an ordinary Adventure pack,
  routed and defaulted exactly as items and actors are, and the place-adventures
  companion is left alone. A repository that authors bundles declares an Adventure
  pack of its own; one that declares none is now told so by name, because `bundle`
  is in the type table the unclaimed-note check reads.
  
  **What a `contents` address names: the note's own document.** That is already
  the router's rule for `pack:`, so there is one answer and not two. A note that
  compiles into _two_ documents — an item and the JournalEntry its prose became —
  puts the second in a bundle only when the bundle names it by its own `doc…`
  address. Nothing is inferred; an address that resolves to nothing fails the
  build, and a `folder` address is refused with a message of its own, since a
  folder materialises in every pack holding something filed in it and so has no
  single copy to take.
  
  **An Adventure holds copies, not references**, so `contents` resolves against
  _compiled output_ rather than against the content tree. The pass therefore reads
  every other one, and **says so** — `Bundles.readsPackOutputOf` names Item,
  Actor, JournalEntry, Macro and Scene, from which the generator derives the
  compile order. An Adventure pack declared first in `packs:` still compiles last.
  
  **A pack's `system:` constrains what its Adventures may hold**, and the
  constraint is read from what the pack can see rather than computed from a
  member's type — which has no single answer for the types both systems map, most
  of them. A pack declaring `system: hm3` reads the HM3 packs and the neutral
  ones, so a member publishing no HM3 document is **left out rather than
  failing**, with a warning naming it. A pack declaring no system scopes nothing
  away, so a member it cannot find is a dead address and fails.
  
  **The note's prose becomes the Adventure's `description`** — the `HTMLField`
  Foundry renders on the import card. A bundle is something you hand someone, so
  its prose belongs on the document itself, which is why it earns no separate
  documentation journal the way an item does. That was #263's third open question.
  
  **A prebuilt pack is passed over rather than compiled.** Its per-document JSON
  is checked in, so it has no pass and no note is routed into it — which
  `content-config.mjs` already said by refusing `default: true` beside `prebuilt`.
  It could not matter before: the only prebuilt pack in the wild holds Adventures,
  and no compiler was registered for that document type, so it failed with "no
  compiler for document type" whatever it was asked. Now one is registered, and
  running a pass over it would wipe its generated JSON directory, write nothing,
  and then report the empty pass as an error.
- 458fd89: **A note declares the shortcode it used to be published under, so a rename stops
  reading as a withdrawal (#278).**
  
  `(type, shortcode)` is a published interface — every satellite declaring
  `itemCatalog: true` assembles its beings out of those addresses — and
  `content-build addresses diff` exists to report what a build stopped publishing
  before a release does. To be useful it has to name where an address _went_, and
  it told a **rename** from a **withdrawal** by matching document ids across two
  releases.
  
  #270 removed the property that rested on. An id is now derived from the
  canonical address, which carries the shortcode, so renaming a shortcode moves the
  id too: both sides of the join move together, the match finds nothing, and the
  rename is reported as a withdrawal with no successor named. It stayed exact for a
  note that **pins** an `id` — but a pin has to be written _before_ the rename, by
  an author who does not yet know they will make one.
  
  An author who has just renamed a shortcode does know, so they say so:
  
  ```yaml
  type: weapongear
  shortcode: Taburi
  renamedFrom: Tabri
  ```
  
  **One shortcode or a list**, because renames chain and a released baseline may
  know an address by a name two renames ago. **Transient**: once every baseline a
  build is compared against post-dates the rename, the declaration may be deleted —
  which is what separates it from an `id:` pin, which is permanent. **One key per
  note, at the top level**, however many systems the note compiles into, since a
  shortcode is the note's rather than a system block's.
  
  **The diagnostic reports which join it had**, because the two are not equally
  checkable — a matched id is a fact a reader can verify in both artefacts, while a
  declaration is the author's word:
  
  ```text
  since sohl@0.8.2, weapongear:Tabri is no longer published; the note now
  published as weapongear:Taburi declares it was renamed from Tabri. Every
  package that resolves weapongear:Tabri breaks when it moves past sohl@0.8.2
  ```
  
  Three joins are tried, in that order of authority: the document id, then a
  declaration, then nothing — which remains **withdrawn**. Nothing infers a
  successor from a similar-looking string; a wrong one sends the reader to the
  wrong fix.
  
  **`content-lint` holds a declaration to the rules a current address is held to.**
  An entry must be a well-formed shortcode, must not be the note's own, and must
  name an address the package actually vacated: an entry naming an address some
  note still publishes is refused, as are two notes claiming one predecessor, since
  an address had one holder and so has one successor. A repeated entry is a
  warning — the declaration still works.
  
  **Also fixed: `addresses diff` threw whenever it had a finding to place.** It
  called `noteFilesById` without `skipDirectories`, which `walkMarkdownTree`
  refuses (#243), so the command worked only when it had nothing to report — the
  one path nobody notices. Both of its tree reads now state the scope from the
  resolved configuration.
- 4926fb8: **The `bundle` note type is specified and declared** (#259).
  
  A bundle is a set of documents taken as a unit — Foundry's `Adventure`, named for
  what it is rather than what Foundry calls it. It declares one property of its
  own, `contents`: the documents it holds.
  
  **How many Adventures a bundle makes is decided by its system blocks**, as for
  every other type, rather than by a property of its own. With no system block it
  is one Adventure holding only the `none` documents; with one or more it is one
  Adventure per system, each holding every `none` document plus that system's own,
  and a document of neither is silently left out.
  
  Each Adventure is written to the pack the note's `pack` names — **the shared
  routing field, not a property of the bundle**, so there is one spelling and not
  two. It differs only in its default, `adventures`; `<system>.pack` overrides it
  per system exactly as it does everywhere else.
  
  That follows from Foundry rather than from taste: **an `Adventure` has no
  `system` field**. A bundle spanning two systems cannot be one document that knows
  it spans them, so it is one document per system and the pack each is written to
  is what carries the system.
  
  **It is not a folder**, and the difference is the whole point: an Adventure
  carries **copies**, and importing one creates or updates each document in the
  world, after which they live independently. A folder is a live grouping, by
  reference, that persists in the pack.
  
  **Nothing compiles a bundle yet**, and authoring one says so. Two decisions come
  first: the scenes pass already writes an Adventure per place into a _companion_
  pack and the router refuses a note naming a companion in `pack:`, so the
  `adventures` default cannot be that pack as things stand; and since an Adventure
  holds compiled documents rather than references, `contents` has to resolve after
  the passes that produce them.
- 0df2870: **Every declared note type is routed, or excused for a stated reason** (#243,
  #241) — asserted statically, of the toolchain, so it no longer depends on some
  repository happening to author the type.
  
  This is the check #241 needed and nobody had. `place`, `lore` and `scenario`
  were declared, validated, and claimed by no pass; every gate reported success,
  and the only thing that noticed was a downstream repository failing to compile
  450 notes. The claim table was already cross-checked against each pass's
  `selects`, but that agreement holds just as well when **both** say nobody claims
  a type — which was exactly the broken state. The missing property is not
  agreement, it is **coverage**.
  
  A declared type must now be one of four things, and the four name different
  reasons rather than being interchangeable: claimed by a pass; **never packed**
  (compiles to no document — `homepage`); **derived packed** (materialises by
  reference in every pack that references it, so no one pass owns it — `folder`);
  or declared by a shipped **system map**, so a configuration carrying that
  system's packs claims it (`armorlocation`, which is HM3's).
  
  **`UNIMPLEMENTED_TYPES` is new, and it is stated rather than inferred.** An
  unimplemented type and a forgotten one look identical from outside: documented,
  validating, reaching no pass. Only intent separates them, so intent is written
  down. The obvious inference — "declared, but absent from the configured
  vocabulary" — reads correctly and is worthless, because that vocabulary is
  _derived from the routing_: take a type's route away and it leaves the
  vocabulary too, so the inference excuses precisely the mistake it was meant to
  catch. That was verified by putting `place` back into its #241 state, where the
  inferred form passed and the stated form fails.
  
  `vehicle` is its one member, and `unclaimedNoteFindings` now chooses its
  "specified, not implemented" wording from the same set rather than from a second
  reading of the same fact.
  
  _No behaviour change: over `sohl`'s tree the compile emits the same 3,085
  documents with identical diagnostics, and `lint` reports the same 354 findings._
- adb2e90: **A folder is a note** (#256), and `packFolder:` names one by **address** (#255).
  
  ```yaml
  ---
  type: folder
  shortcode: possessionscooking
  name:
    full: Cooking
  data:
    parent: possessionsmiscgear
    color: "#7a4b2a"
  ---
  ```
  
  ```yaml
  packFolder: possessionscooking # on any note that files itself there
  ```
  
  A `Folder` was the last document this package compiled from bespoke
  configuration — `*-folders.yaml`, five files per tree — rather than from a note.
  That was the one hole in the rule #243 establishes, _the compiler follows the
  index_: a pass cannot follow the index for things the index does not contain.
  
  **`parent` is an address**, so a dangling one is an ordinary dead-address finding
  rather than a special-cased `Unknown folder id`, and a cycle is refused. Both are
  reported when the tree is read, not when something happens to reference the
  folder that carries them. A folder is addressed `<package>-none-folder-<shortcode>`
  — `none`, because a `Folder` is a core Foundry document like a `JournalEntry`,
  not a system's.
  
  **`parent` may be a map keyed by pack.** A folder's identity is one thing and its
  hierarchy is another: the same folder is deliberately filed under different
  parents in different packs, and both large trees rely on it. This repository
  files its three item roots one level deeper in the journals pack (under
  `Rules/Descriptions`, beside `Rules/Combat`); `sohl-thalorna` groups the items
  pack by document kind and the journals pack by setting geography, and 46 of its
  75 shared folders differ. A scalar — the everyday spelling — is exactly
  `{ default: <value> }`, and the folder keeps one id across every pack whatever
  its parent there.
  
  **Where a folder materialises is derived from what references it** (#257). Every
  pack holding a document that names a folder gets that folder, and its ancestors
  with it; a folder nothing references materialises nowhere.
  
  That removes a live defect rather than reporting it. A documentation journal is
  filed beside the item it describes by putting the item's folder id into the
  _journals_ pack — which only worked where a second folder file mirrored the
  first, and it mirrored in one tree of three:
  
  | tree                              | item folders | in journal folders |        missing |
  | --------------------------------- | -----------: | -----------------: | -------------: |
  | `Song-of-Heroic-Lands-FoundryVTT` |           57 |                 57 |              0 |
  | `sohl-thalorna`                   |          132 |                 75 |         **57** |
  | `sohl-kethira-basic`              |            6 |                  — | **6**, no file |
  
  Both emitted documentation journals into folders their own pack never declared,
  silently. With one folder note and one address there is no second file to
  disagree with the first, so the failure is unrepresentable rather than merely
  caught.
  
  **A folder's Foundry `_id` is derived from its address** (#258), stable across
  runs, so a new folder needs no invented id. An **authored `id` is kept** where
  one is present — which is what lets a tree sweep its folder YAML into notes
  without a world that already holds those folders losing them, making this a build
  change rather than a world migration. Two folders claiming one id is a build
  error.
  
  **`packFolder` was a path for one release and never shipped as one.** #252 landed
  `Possessions/Misc_Gear/Cooking` and its changeset is still pending, so no
  released version ever read a path. A path encoded the hierarchy _in the value_,
  so reparenting a folder rewrote every note naming it; an address is stable under
  reparenting, which is why a note is addressed by `(type, shortcode)` and never by
  `file.path`. The path form is removed rather than deprecated — it had no authors
  to migrate, which is the whole reason the change was cheap enough to make.
  
  **`folder:` is untouched**, and every tree still compiles from its
  `*-folders.yaml` exactly as before: the SoHL tree's 3,094 compiled documents are
  byte-identical across this change. Retiring the id spelling and the YAML schema
  is #260, after each tree has swept.
- 72ce6c2: **The HM3 pass reads the template priority wherever a note states it** (#266).
  
  `flags.hm3.templatePriority` was resolved as an ordinary declared field, whose
  shared source is a **single** position — so only a bare top-level
  `templatePriority` ever answered. The one position that did not work was
  `data.templatePriority`: the specified home, the target of the settled mapping
  table, and the home this pass's own docstring already claimed to read.
  
  **It failed silently, and could only fail silently.** A note that is not a
  template writes no flag, so an omitted flag is how "not a template" is spelled —
  which makes a priority that was lost and a priority that was deliberately
  withheld the same output. There is no tri-state left for a diagnostic to notice,
  and nothing downstream can tell the two apart.
  
  The priority is a **shared, note-level fact** — one statement both systems
  record, SoHL as `system.templatePriority` and HM3 as
  `flags.hm3.templatePriority` — so it is now read through the same resolver the
  SoHL passes use, against the block being compiled: `data:`, this system's block,
  the top level, and the retiring `archetype` spelling in the latter two. A note
  carrying both spellings with different values is refused here exactly as it is
  for SoHL, so the two systems cannot disagree about what a note said.
  
  **It is read against _this_ block, not the `sohl:` one.** A tree still stating
  the priority in `sohl:` writes no HM3 flag — `harn-ensemble` is that tree, on
  2,502 notes — and gets one when it sweeps to `data:`, which is step 2 of #266's
  migration. This change is the prerequisite for that sweep rather than a
  substitute for it: without it, a tree that swept to the specified home would
  have gone from a flag that worked by accident to no flag at all.
  
  `resolveTemplatePriority` takes the block as an option, and
  `statedTemplatePriority` is its tolerant sibling for a system that treats an
  unstated priority as "not a template" rather than as an authoring error.
- 209e633: **The `hm3/` half of the toolchain** — a note can now compile an HM3 document (#139).
  
  `sohl/` was the only system half this package had, so `itemBuilders: [sohl, hm3]` — an
  arrangement `CONTENT.md` already documented — named a registry that did not exist, and no
  note could produce an HM3 Actor or Item however its frontmatter was written. `hm3/` is now
  a sibling of `sohl/`: its own item vocabulary and builders, its own default art, its own
  note-type → document-subtype map declared through the same `defineDocumentSubtypes`, and
  its own Item and Actor compilers. The two halves import nothing from each other; the only
  thing they share is the engine between them.
  
  **A pack's `system:` now selects the compiler.** It already selected the `_stats` stamp, the
  item catalogue a being resolves against and the `itemBuilders` lookup; the Item and Actor
  passes were still SoHL's whatever a pack declared. So a note carrying both a `sohl:` and an
  `hm3:` block compiles **one document in each system**, each shaped by its own builders and
  stamped with its own system version — and a note carrying only one block is passed over by
  the other system's pass rather than failed for a block it was never going to have.
  
  **Four HM3 rows are one-to-many, and the note says which.** `mysticalability` becomes a
  `psionic`, a `spell` or an `invocation`; `trauma` an `injury` or a `trait`; `weapongear` a
  `weapongear` or a `missilegear`; `being` a `character` or a `creature`. The note writes
  `hm3.type`; nothing is inferred from its `subType`, and a note that says nothing is an error
  naming the note and listing the permitted values. `docs/content-format.md` is corrected to
  match — it described the `mysticalability` split as derived from a `subType` vocabulary that
  no longer contains the values the derivation named.
  
  **The five shared names cannot cross over.** `skill`, `weapongear`, `armorgear`,
  `containergear` and `miscgear` exist in both systems with different data models, so each
  resolves through its own system's map, is built by its own system's registry, and is
  field-checked against **its own** system's published `schema.json`. That last one is new:
  `resolveSchemaArtifact` took the package-wide `stats.systemId`, which is deliberately unset
  in a two-system build — so every schema check in such a build was skipped in silence.
  
  **Shared machinery moved to `engine/`, unchanged.** `engine/item-compiler.mjs` and
  `engine/actor-compiler.mjs` now hold what is note-format knowledge rather than game-system
  knowledge, and `engine/anchored-sections.mjs` holds the `{#appearance}` / `{#dossier}`
  convention. `sohl/items.mjs` and `sohl/actors.mjs` are what is left: SoHL's map, and the
  `system` block SoHL's data model wants. Compiled output is byte-identical — verified by
  recompiling `Song-of-Heroic-Lands-FoundryVTT`, `sohl-thalorna` and `sohl-kethira-basic`
  before and after and diffing every emitted document.
  
  `npm run lint` now also checks HM3's column of the content format: the specification's
  `→ hm3` mapping claims against HM3's published `schema.json`, and its per-type tables
  against the new field declarations.
- f2e6e45: **The link check reads the content index instead of walking the tree itself**
  (#243) — the first reader converted, and the one #243 nominated.
  
  `buildLinkIndex` answered "which files are the content?" for itself: its own
  walk, its own frontmatter parse, its own address derivation. That is the shape
  #243 is closing — ten passes each deriving the corpus independently, agreeing
  only by inspection. It now reads
  {@link module:engine/content-index.indexRecordsFor}, the same derivation the
  published artifact, the `sql` tables and the compilers already run on.
  
  **It still opens each note — for its prose, and nothing else.** The index
  deliberately carries no body, and a link lives in the body. Everything _about_
  the note is in the record. That is one read per note rather than two: the walk
  read the file, and this module then read it again for the raw text.
  
  **Two defects go with it.**
  
  - _The package a local address carries came from the ambient configuration._
    `buildLinkIndex` was handed a `config` and then called `contentPackage()`,
    which resolves `loadPackConfig()` from the working directory. The two are the
    same object in an ordinary build and different ones under
    `PACKAGE_BUILD_CONFIG`, in a worktree, or in a test — so the checker could
    build canonical addresses for one package while the manifest it was checking
    built them for another, and every cross-package link would resolve nowhere for
    no visible reason. The package now comes from the configuration the caller
    passed.
  - _Each command derived the corpus twice._ `lint`, `links` and `reachability`
    each built a link index _and_ prepared their `sql` tables, and both walked. The
    records are now derived once per command and handed to both, so a table and a
    wikilink cannot disagree about which notes exist. `reachability` also resolved
    its configuration twice and passed neither to the passes below it; it resolves
    one and passes it on.
  
  **Findings are unchanged, and their order is now stable.** Over `sohl`'s 1,685
  notes the `links` findings are identical as a set and `lint`'s output is
  identical byte for byte; what moved is that diagnostics now come out in content
  path order rather than directory-read order, which was never a fact about the
  content.
  
  `indexRecordsFor` takes the walk's scope as an argument, so a caller that was
  handed one passes it on rather than having it replaced by whichever its
  configuration carries; `prepareTreeSqlTables` and `buildLinkIndex` take
  already-derived `records`. `authoredFrontmatter` and `isNoteRecord` are exported
  beside `DERIVED_KEYS`: a record is a note's frontmatter _plus_ the derived keys,
  and a note authoring one of them fails the walk, so recovering what the author
  wrote is exact rather than best-effort — which is what lets a pass read the
  corpus from the index and still lint what was typed.
- d17dc98: **`package-build yaml` lints note frontmatter and every YAML file** (#248).
  
  Frontmatter carries a note's type, shortcode, address and system blocks, and
  nothing checked it _as YAML_. Worse than unchecked: `parseMarkdownFile` caught a
  parse failure, logged it at `warn`, and returned `{frontmatter: null}` — which is
  not a note with bad frontmatter but, to every pass downstream, a file with no
  frontmatter. A duplicate key did not fail a build; it removed a note from the
  corpus while the build reported success. The parser had detected it all along.
  
  **Frontmatter reaches ESLint through a processor**, the mechanism
  `eslint-plugin-markdown` uses for fenced code blocks. Frontmatter is its easy
  case — the block is always at the top of the file, so a finding maps back with a
  constant `+1` for the opening `---` and no offset table.
  
  **The rule set is deliberately narrow**, as the markdown and stylesheet ones are.
  Prettier already owns YAML's whitespace, quoting and line breaks, including
  inside a fence, so what is left is the class a formatter cannot see: text that
  parses to something other than what it looks like. Parse errors, plus
  `no-empty-mapping-value`, `no-irregular-whitespace`, `no-empty-key` and
  `no-empty-document`. `folder:` and `folder: null` are one value and two opposite
  statements — a decision, or a key somebody began and did not finish — and a key
  with a block under it is not empty.
  
  **GitHub workflows are exempt from the empty-value rule.** `on:` `push:` carries
  its meaning by being present; `push: null` would be worse YAML, not better.
  
  **A consumer changes one line** — `"lint:yaml": "package-build yaml"` — and needs
  no `eslint` dependency, no `eslint.config.js` and no rule configuration.
  package-build owns the tool and the config exactly as it owns markdownlint's, and
  `overrideConfigFile: true` leaves a repository's own ESLint unconsulted.
  
  Adoption costs 92 findings in total: 65 in `sohl-thalorna`, 20 in
  `sohl-kethira-basic`, 5 in `harn-ensemble`, 2 in
  `Song-of-Heroic-Lands-FoundryVTT`, none in `harn-adventures`. No live content
  tree carries a parse error — every one found was in a `nogit/` archive — so this
  is a missing guard rather than an overdue one.
- 6368283: **The template priority is read as `templatePriority`, and `archetype` is
  retiring** (#266).
  
  The number deciding which of several competing templates the Create dialog
  offers was called `archetype` — one letter from `archetypes`, which is a list of
  what _sort_ a character is. A priority and a taxonomy cannot be told apart by a
  plural `s`.
  
  Both spellings are read, `templatePriority` winning, and **the retiring one is a
  lint error**. Unlike the other retired alias, `archetype` is not a field of its
  own — it is `templatePriority` under its prior name, and both sit one letter from
  `archetypes`, which means something else entirely. A tree still on it is one
  where a priority and a taxonomy are told apart by a plural `s`, which is worth
  stopping rather than mentioning.
  
  The compile is unaffected — both spellings are read, so every tree keeps
  compiling — but `content-build lint` refuses a tree until it is swept, and
  **5,727 notes across four trees** author the old key.
  
  It is read from `data.templatePriority` first, which is where the specification
  puts it and where `sohl-thalorna` already writes it on 941 notes — so a tree that
  has authored forward is read from the key it authored.
  
  **A note declaring both spellings with different values is refused.** That is not
  hypothetical: **145 of those 941 say `templatePriority: null` where `archetype:
  0` says the opposite** — "not a template" against "a template at priority 0".
  Preferring either silently would decide that for the author, so the build names
  both values and asks. `0` and `null` are distinct and both valid, which is
  exactly why a note cannot claim both.
  
  The emitted field is unchanged: SoHL's data model still declares
  `system.archetype`, and `Song-of-Heroic-Lands-FoundryVTT#1836` renames it there.
- 18bb812: **The walk's scope is stated by its caller, never resolved from the working
  directory** (#243).
  
  `walkMarkdownTree` defaulted `skipDirectories` to `loadPackConfig()`'s — so an
  unscoped caller read whichever configuration resolved from the working directory
  rather than the one it was working under. **Six of its twelve callers were on
  that default**, which means two passes over one tree could disagree about which
  files they were reading. In an ordinary build those are the same object and
  nothing shows; they are not the same when a test injects a configuration, when
  `PACKAGE_BUILD_CONFIG` names one, or when a command runs from a worktree.
  
  This is the defect class #240 fixed for `entriesForNote` reading `docEntryTypes`
  from the ambient config — found only because a fixture had been passing on the
  leak for as long as it existed.
  
  The parameter is now **required**, so the omission is an error rather than a
  quiet second answer, and `BasePackCompiler` requires it too: a pass that omitted
  it would walk whatever the working directory said, including — in a tree
  configured to skip `Templates`, as `Song-of-Heroic-Lands-FoundryVTT` is — the
  template notes that configuration exists to keep out of the packs.
  
  `Scenes` was dropping it between its own constructor and `super`, which is
  exactly the kind of silent gap a default hides and a requirement does not.
  
  _No consumer calls `walkMarkdownTree`, so this is internal despite the signature
  change._
- a5922b7: **The five declarations that re-read the note now see `<system>.system`**
  (#126) — the last mechanism gap before the corpus can move.
  
  Most fields take the value `resolveFieldValue` hands them, so they already
  resolve at `<system>.system.<to>` first. Five do not. `subType`, `charges`, a
  mystery's `skillAptitudes`, an affiliation's `relations` and a projectile's
  impact die each validate a **shape spread over several keys**, so their `read`
  re-reads the frontmatter — through `sohlField`, which sees `sohl.<key>` and the
  note's top level and **never inside `sohl.system`**.
  
  That was equivalent while every note authored in the block. The moment a note
  authors at the destination instead, those five read as unset: a missing
  `subType` is a thrown build error, and `charges`, `skillAptitudes` and
  `relations` ship empty — in silence, which is the failure class the passthrough
  exists to prevent.
  
  `sohlSystemField` reads the destination first and falls back to the legacy
  position, so both spellings work while the corpus moves. It takes an optional
  `legacyKey` for the one pair spelled differently at the two positions — a
  projectile authors `impact.die` and stores `impactBase.die` — which is the same
  split `FieldSpec.name`/`legacyKey` makes, for the same reason: one name cannot
  key two positions.
  
  The retired-alias probe in `resolveRelation` moves with it. It asked
  `sohlField` whether `relations` was authored in order to choose between the
  current and retired spelling; a note that had moved to `sohl.system.relations`
  carried the current name where the probe could not see it, so it fell through to
  `relation` and read `{}`.
  
  Nothing else changes: every note authoring in the block reads exactly as before,
  which the suite pins alongside the new position.
- f2bf737: **A note the content index cannot record is reported, not thrown** (#243) —
  with a line, a column, and the right correction.
  
  Converting the link check (#290) and the address diff (#292) to read the index
  handed those passes the index's one hard failure. A note authoring a key the
  index derives — {@link DERIVED_KEYS} — aborted the whole pass, so **one
  malformed note took every other finding in the tree with it**, and the reader
  got a bare `Error` where the project's other diagnostics give
  `file:line:column: severity: message`. This is precisely what #243 lists as the
  thing that must not regress, and it did.
  
  Concretely, over a tree holding a legacy `package:` note and an unrelated dead
  link:
  
  |                         | reported                                                             |
  | ----------------------- | -------------------------------------------------------------------- |
  | _before the conversion_ | the dead link; nothing about `package:`                              |
  | _after it_              | ``Skills/Legacy.md: `package:` is derived …`` — and **nothing else** |
  | _now_                   | both, each with its position                                         |
  
  **A reader collects; the emitter still refuses.** `collectContentIndex` and
  `indexRecordsFor` take a `problems` array: given one, a note that cannot be
  recorded is pushed as a diagnostic and skipped, and the derivation continues.
  Given none they throw exactly as before — which is the contract
  `emitContentIndex` needs, since an index quietly missing a note asserts that the
  note does not exist. `buildLinkIndex`, `declaredPredecessors` and
  `noteFilesById` pass the array through, and `lint`, `links`, `reachability` and
  `addresses diff` emit what it collects and exit non-zero — an error whatever the
  command's own strictness flag says, because the note is absent from every answer
  those commands give.
  
  **`package:` gets its own words back.** It is on the derived list, but it is not
  a name collision — it is a **retired field** (#56), and the fix is to delete it,
  not to rename it. `assertNoDeclaredPackage` has said so, correctly and with a
  position, since the field was retired, and had **no caller**: the generic
  "rename the frontmatter field" was the only message anyone saw, and it was
  wrong. The index now defers to it, so one mistake has one message rather than
  two that disagree about the fix.
  
  _No change to any tree that has no such note: `sohl`'s 1,685 notes produce
  byte-identical `links`, `lint` and address-map output._
- d17dc98: **`place`, `lore` and `scenario` compile into JournalEntries.** They are in the
  published content format and #233 declared them for validation, but nothing
  routed them: `PACK_BY_TYPE` did not name them, so the open-set default sent
  them to the items pack, and the journals pass did not select them. A note of
  one lint-ed clean and then compiled into nothing (#241).
  
  `sohl-thalorna` could not compile a single pack for exactly this reason — 450
  errors, and _the same 450_ the linter had reported before it learned the types.
  The count being identical is the tell: nothing about the content changed, only
  which gate noticed. It now compiles 642 actors, and what remains are unrelated
  content faults.
  
  The three are declared once, as `JOURNAL_TYPES` in `engine/ids.mjs`, and read
  from there by the pack router, the journals pass and the claim table — so the
  three cannot disagree about what a journal type is. The drift guard that
  asserts the claim table and each pass's `selects` agree is what caught them
  disagreeing while this was written.
  
  **They carry no synthesized `doc<type>` entry**, which is the distinction the
  new name makes explicit: a journal type's whole document _is_ the journal, so
  there is no second document to address and nothing spells `docplace`. That is
  different from an item, a macro or a map, whose prose becomes a journal
  _beside_ another document and is addressed as `doc<type>`.
- 10522bd: **State the shared mapping rows, and let the checker reach them (#275).**
  
  `docs/content-format.md` § _Mappings every type shares_ promised eight rows that
  every one of the sixteen per-type tables omits "on the stated grounds that they
  appear here", and then stated none: both tables were header-only, from the commit
  that first committed the specification. The fields they cover were therefore
  specified nowhere, and the note pointing at them pointed at nothing.
  
  Both tables now carry their rows. The shared table states `name.full`, `img`,
  `id`, `packFolder` / `folder`, `shortcode`, `data.templatePriority`, `actionDefs`
  and `notes`; the actor-types table states `data.portrait`. `being` and `vehicle`
  had restated `data.portrait` and `data.templatePriority` in their own tables, and
  no longer do — that duplication is what the section exists to remove.
  
  **The rows are confirmed rather than asserted.** `parseContentFormat` read
  mapping tables only inside a `### type:` section, so a table standing before the
  first one was invisible and its rows were checked by nothing. A mapping table in
  that position is now the shared one — position is the whole distinction, since
  the document's own argument for stating these once is that they belong to no type
  in particular — and its rows become claims like any other.
  `npm run lint:content-format:schema` confirms 86 where it confirmed 84, the seven
  new ones being the shared tables' `system.*` targets.
  
  A shared claim carries `shared: true` and is scoped to `the shared mappings`
  rather than to a type, which keeps it out of the per-type field-drift check (it
  has no field declaration to drift from) and reads as prose in a diagnostic:
  _the format maps `shortcode` in the shared mappings to `system.notAField` in
  sohl_.
  
  Two asymmetries the rows exposed are stated beside them rather than smoothed
  over: `actionDefs` and `notes` are declared on every SoHL Item subtype and on no
  SoHL Actor, and SoHL's `system.docHtml` is an Item mapping with no shared source
  to be a row of. A third — HM3 carrying `flags.hm3.templatePriority` on an Actor
  and not on an Item — is a gap in the pass rather than in the table, and is
  tracked as #283.
- 941b672: **A field's shared source and its legacy in-block key are two declarations**
  (#305) — so a field can move into `data:` without a flag day.
  
  `FieldSpec.name` carried both jobs, and they came apart the moment `data:`
  (#128) put every type-specific fact under a container. `resolveFieldValue` reads
  four positions, and steps 2 and 3 were **both keyed on `name`**:
  
  | step | position                    |
  | ---- | --------------------------- |
  | 1    | `<block>.system.<to>`       |
  | 2    | `<block>.<name>` — in-block |
  | 3    | the shared source `<name>`  |
  | 4    | the field's default         |
  
  So `name: "species"` reached `hm3.species` and could not see `data.species`,
  while `name: "data.species"` reached the shared source and could not see
  `hm3.species` — and each yielded the field's **default** wherever only the other
  position was authored. Silently: the field compiles, the document is emitted,
  and the value is simply gone.
  
  Two things followed. The specification's shared→system mapping was implemented
  _nowhere_ — `grep 'name: "data\.'` returned zero hits across all 58 declarations,
  so rows the format states (`data.species`, `data.gender`, `data.occupation`)
  were read by nothing. And no safe transition existed: every other retirement here
  — `package:`, `image`, `archetype`, `relation` — works because **both spellings
  are read while the corpus moves**, and one property could not offer that.
  
  **`legacyKey` separates them.** `name` is the shared source; `legacyKey` is the
  key the system block still carries, and step 2 keys on it. Absent, it falls back
  to `name`, so every declaration written before this resolves unchanged.
  
  - **Both are read, the current position wins.** A note that has not been swept
    is still saying what it means.
  - **The legacy read is _reported_**, as a warning — at compile through
    `legacyKeyMessage`, and in the frontmatter lint — so a sweep has a progress
    signal, matching `RETIRED_FIELD_ALIASES`. A field that declares no `legacyKey`
    is not mid-sweep and is never reported; that would put a finding on every
    field of every note.
  - The lint accepts the legacy key as a key of the block, rather than reporting
    `sohl.species` as a property no `being` has against exactly the notes the
    sweep has not reached.
  - The format check normalizes `data.` on **both** sides, so a moved declaration
    still pairs with the specification row that states it.
  
  **HM3's three actor rows are declared as the sources the format names** —
  `data.species`, `data.gender`, `data.occupation` — while keeping the in-block
  key every note writes. Measured over the four content trees: 2,512 `being` notes
  compile byte-identical to before, and all 2,512 read the legacy position, which
  is the count #126 has to take to zero.
  
  This is the mechanism the `data:` half of #126 and all of #129 were blocked on.
- 4926fb8: **A note whose type the format specifies but nothing compiles gets a finding of
  its own.**
  
  The unclaimed-type check had two messages, and a third thing can be wrong — the
  only one that is not the author's fault. `docs/content-format.md` documents the
  type and the vocabulary declares its properties, so a note written against the
  published specification is correct; this toolchain simply has not implemented it
  yet.
  
  It earns its own wording because the other two both mislead there. Naming a
  missing pack or registry sends an author to `package-build.config.yaml`, where
  nothing they can write will help; saying the type is unknown flatly contradicts
  the specification they read it in.
  
  The message is chosen from the vocabulary rather than from a list of types, so
  each specified-but-unimplemented type is covered as it is declared.
- 28ae4b3: **A content table can be written in SQL, queried over the content index** (#246).
  
  Tables were written in Dataview's query language, chosen when the corpus lived in
  an Obsidian vault so a table rendered live while authoring. The vault is gone, and
  what remained was a hand-written parser and evaluator for someone else's language,
  kept faithful to semantics nothing checked it against.
  
  The query is **real SQL, run by DuckDB** — not a dialect maintained here. That is
  the point: a partial reimplementation would accept some valid SQL and silently
  misread the rest, which is worse than an unfamiliar language because the boundary
  is invisible.
  
  ```sql
  SELECT address.slug AS _ref,
         sohl.kbcat   AS _section,
         name.full    AS "Name",
         sohl.weight  AS "Weight"
  FROM notes
  WHERE type = 'miscgear'
  ORDER BY sohl.kbcat, name.full
  ```
  
  **`sohl.weight` and `name.full` read in a query exactly as a note authors them.**
  DuckDB reads the index as JSON and infers a `STRUCT` per nested object; a
  column-per-path table would force `"sohl.weight"` in quotes and a JSON column
  `sohl->>'weight'`. `union_by_name` is what makes it work across a corpus where
  every note type's system block differs.
  
  **What SQL cannot say, the projection says.** Which column links, and where a
  section breaks, are decisions about output rather than relational operations, so
  they ride as underscore-prefixed aliases — `_ref` and `_section` — which are
  ordinary SQL, need no fence options, and sit where the author is already looking.
  `_section` is why one query replaces the forty near-identical blocks
  `Rules/Gear.md` needs today: it emits a headed table per distinct value, in the
  order the authored `ORDER BY` produced.
  
  `sql allow-empty` and `sql section-level=3` ride on the fence, as `dataview
  allow-empty` already does, because both are statements about the directive rather
  than part of the query.
  
  **Both spellings work.** Every one of the 177 tables in the corpus is still
  `dataview`; those now also report a warning naming this issue, and nothing else
  changes for them. Nothing is opened for a tree with no `sql` directive, so this
  costs a tree that has not converted one walk and no database.
  
  _DuckDB is a **build** dependency, not merely a development one — every
  consumer's CI runs a compile. It adds about 114MB to an install._
- 9d89f31: **A `sql` content table takes org-babel header arguments, and a dependency's
  notes are a schema** (#246).
  
  **Header arguments.** Statements _about the directive_ — as opposed to the query
  — were an ad-hoc bare word (`allow-empty`) and a `key=value`
  (`section-level=3`), each matched by its own regex: a grammar only in the sense
  that two regexes are one, with no room for a third property that did not also
  invent a third spelling. They are now org-babel header args, written after the
  language:
  
  ````
  ​```sql :section-level 3 :allow-empty
  ````
  
  **The language word stays first and stays plain**, so GitHub, Prettier and every
  other markdown reader still highlight the block as SQL and ignore what follows.
  
  The grammar is org's, which is a real one with a specification and an editor
  that completes it: a key is `:name` starting a word (so `:caption Gear: the
  tables` is one argument); a value runs to the next key, spaces included; a
  valueless key is `true`; a value may be `"quoted"` to hold a key-like word; a
  repeated key takes its last value. `parseHeaderArgs` lives in `code-fences.mjs`
  and every argument reaches the caller, so a property this module makes no use of
  is still readable — the point of taking a grammar rather than a regex per
  property.
  
  The `sql` fence has never shipped, so both old spellings are simply gone rather
  than retired. `dataview` keeps its bare `allow-empty`: it is the retiring
  language and its grammar is frozen.
  
  **A dependency is a schema.** Each package this one depends on is attached as a
  schema named after it, so a satellite can tabulate what it builds on:
  
  ```sql
  SELECT name.full AS "Name" FROM sohl.notes WHERE type = 'skill'
  ```
  
  This package's own notes stay at the unqualified `notes`, and one query may read
  both — joining your beings against the skills they cite is a `FROM` clause. It
  costs no fetch and no configuration: every dependency's published index is
  already in the metadata cache when a compile starts, because resolving addresses
  across packages needs it.
  
  Which dataset a query reads is `FROM`'s job, not a fence property naming a file.
  A path in authored content writes a build artifact's name into the corpus, so
  renaming the artifact would mean sweeping every note that cited it — and _which
  dataset_ is exactly what SQL already has a clause for, the same rule that keeps
  `_ref` and `_section` ordinary SQL rather than fence options.
- 3bf9020: **The address lint reads the content index too** (#243) — so
  `content-build lint` is now **one** derivation of the corpus rather than two.
  
  The command already derived the index: its link check is built from it and its
  `sql` tables select over it. Then it walked the whole tree a second time to
  reach `lintContentTree`. One command, two answers to "which files are the
  corpus?", and findings reported side by side that were drawn from different
  ones. The records are now derived once by the command and handed to every pass
  below it, this one included.
  
  **It lints what the author wrote.** A record is the note's frontmatter plus the
  keys the index derives, so the frontmatter is recovered with
  `authoredFrontmatter` — handing a lint the derived keys would have it reasoning
  about `address:` and `anchors:` as though someone had typed them.
  
  **Faster, for the same reason it is more correct.** Over `sohl`'s 1,685 notes
  `content-build lint` goes from about 1.9s to about 1.3s: the second whole-tree
  walk is gone. Findings are byte-identical.
  
  `lintContentTree` takes `config`, already-derived `records`, and the `problems`
  collector, so a note the index cannot record is reported with its position and
  the rest of the tree is still linted — the contract every converted reader now
  shares. It refuses an unstated scope in the same words the others do.
- 9972484: **A compile read every note twenty times. Now it reads it twelve** (#243) —
  and the whole compile runs on one corpus rather than one per pass.
  
  Measured over `sohl`'s 1,685 notes: **33,700 note reads**, exactly twenty each.
  Four per pass — the content-wide link index, the table-search corpus, the `sql`
  directive scan, and the pass's own walk — across five passes that convert
  wikilinks. Every one of those four is a pure function of the same three things:
  the tree, the scope, and the pack router. **None of the three varies between the
  passes of a single compile**, because `generatePacksJson` resolves one router
  and hands it to all of them. So the passes were computing the same answers over
  and over, and — the part that matters — each was free to compute a _different_
  one.
  
  They are derived once now, in `buildCompileCorpus`, and every pass is handed the
  result. The compile loop enumerates the index rather than walking, then reads
  each note for its **prose**: the index deliberately carries no body, and none of
  the `bodyLine`/`bodyColumn` a diagnostic needs, so that read stays — it is a
  read the pass was already making. What it no longer does is decide for itself
  which files to make it over.
  
  | over `sohl`'s tree | before               | after                     |
  | ------------------ | -------------------- | ------------------------- |
  | note reads         | 33,700 (20 per note) | **20,220 (12 per note)**  |
  | compile wall time  | ~10.5s               | **~6.7s**                 |
  | emitted documents  | 3,091                | **3,091, byte-identical** |
  | diagnostics        | 33                   | **33, identical**         |
  
  **The record accessors move to `engine/index-records.mjs`.** Deriving the index
  reaches the pack router and the manifest emitter, and those reach the compilers
  — so `engine/helpers.mjs`, which the compilers load, cannot import
  `content-index.mjs` without closing a cycle. Nothing about _reading_ a record
  needs that machinery: `noteFile`, `authoredFrontmatter`, `isNoteRecord` and
  `DERIVED_KEYS` are pure functions over a plain object. `content-index.mjs`
  re-exports them, so the split is an implementation detail of the import graph
  rather than a second place to look.
  
  `buildContentLinkIndex` and `collectContentDocs` now **require** the corpus
  their caller holds, refused by `assertSuppliedCorpus` the way an unstated scope
  is refused by `assertStatedScope`. That is not a workaround for the cycle: a
  compile runs several passes over one tree, and requiring the answer to be handed
  in makes the sharing structural rather than remembered.
  
  **Two ambient-configuration reads go with it**, the same class as every other
  one #243 has turned up: `buildContentLinkIndex` derived each note's id through
  `resolveNoteId(fm)` with no package, and `collectContentDocs` synthesised each
  row's `package` through `searchableFrontmatter(fm)` with none — both falling
  back to whichever configuration the working directory answers with, rather than
  the one the build resolved.
  
  A note the index cannot record is reported and counted by the compile exactly as
  the compile loop reported it when the loop was the first to see it — it is the
  same refusal, deferring to the same `assertNoDeclaredPackage`; only which pass
  meets the note first has changed.
- 5a476cd: **The rest of the compile reads the index too** (#243). With #300 this takes a
  compile from **20 note reads each to 9**, and from ~10.5s to ~5.4s over `sohl`'s
  1,685 notes — with all **3,091 emitted documents byte-identical** and the 33
  diagnostics unchanged.
  
  Four whole-tree walks go:
  
  - **The scenes pass** collected every note to find map notes and item effects.
    It reads the shared corpus, and opens a file only for a map note's prose —
    three files in `sohl` rather than 1,685.
  - **The unclaimed-type check** (`note-claims`) walked before any pass ran, so
    the check that reports "no pack claims this type" was answering about a
    different corpus from the one the passes then compiled.
  - **The `sql` directive scan** discovered which notes carry a directive by
    walking. It still reads each body — the index carries no note text — but
    _which files_ is no longer a second answer.
  - **The folder-note index**, which is the interesting one; see below.
  
  **Three more ambient-configuration reads**, the same class as every one #243 has
  turned up: the scenes pass built a fresh `packRouter()` twice rather than using
  the compile's, and the folder-note index took its package from
  `contentPackage()` rather than from the configuration the build resolved.
  
  **A trap worth naming, because the next conversion will meet it.** A record's
  `id` is not "the id the author wrote". The index fills one in for every
  addressable note (#270), and `collectFolderNotes` treats `fm.id` as an
  **authored pin** that wins over the id it derives under the folder namespace —
  so handing it records would make every folder look pinned and file each one
  under an id the packs do not address it by. `pack-folder` caught it. The index
  cannot tell a pin from a derivation, so the folder notes are read from disk:
  selected by the index, frontmatter from the file. That is the settled rule of
  #298 doing real work — the file carries what the index deliberately normalises
  away — and it is 79 reads, not 1,685.
  
  `unclaimedNoteFindings` now requires the corpus its caller holds, like
  `buildContentLinkIndex` and `collectContentDocs`.
  
  _`collectFoundryEntries` keeps its walk deliberately: it has no production
  caller — the link manifest it served was deleted in #271 — so converting it
  would change an exported signature for no compile it takes part in._
- e0228f5: **The site build reads the content index, which completes #243's conversion.**
  Every pass that reads this repository's content tree — four checks, the whole
  compile, and now the site — runs on one derivation of the corpus.
  
  The site walked the tree **twice**, once for homepages and once for content
  pages, and each answered "which files are the content?" for itself. It derives
  the corpus once and hands it to both. The note is still read for its
  `{fm, body}`: the index carries no note text, and a page _is_ its text.
  
  **The reordering everyone was warned about does not exist.** This module kept
  directory order deliberately — "a site's emitted pages should not reorder for no
  reason" — and index records are content-path ordered, so converting it looked
  like a change to shipped output. It is not, and this was measured rather than
  argued: over `sohl`'s tree the emitted mount is **byte-identical, all 1,749
  files**, and the build's 82 diagnostics are identical **including their order**.
  Emission order never reaches the mount — each page is written to its own file at
  an address derived from its frontmatter, and the first-writer-wins fallbacks
  that once made order load-bearing went with the bare `[[Name]]` form (#180).
  
  A content-path order is also the better of the two: directory-read order is a
  fact about the filesystem rather than about the content, so it can differ
  between two checkouts of one tree.
  
  **`collectTreePages` is deliberately not converted.** It walks an auxiliary tree
  (`site.trees`, the developer documentation) which is not the content tree and
  appears in no record — converting it would be reading the wrong index.
  
  _The two content-tree walks that remain are both right where they are: the
  content index's own derivation, and `collectFoundryEntries`, which has had no
  production caller since the link manifest was deleted in #271._
- d17dc98: **`title: ""` is now a warning** (#218).
  
  The two art fields follow a rule — `null` falls back, `""` is blank on purpose —
  and `title` was kept off it because the top-level key simultaneously fed an
  affiliation's `system.title`, so `title: null` compiled the literal `"null"`.
  That collision is gone: the field declares `topLevelMeans`, and the two spellings
  no longer meet.
  
  What is left is the page heading. The emitter is `fm.title ?? name`, so `""`
  survives, the page publishes with no heading, and it sorts to the front of its
  section landing ahead of every named page. Fifteen notes in `sohl-thalorna` are
  in exactly that state.
  
  A _warning_ rather than an error: the value is legal under the rule, and a page
  that genuinely wants no heading may keep it — it just has to mean it.

### Patch Changes

- 72ce6c2: **`CONTENT.md` names the template priority by its settled name** (#266).
  
  The shipped specification still described the field as `archetype`, written to
  `system.archetype`, and its worked example authored `archetype: 1` inside the
  `sohl:` block. All three were wrong in the same direction, and the example was
  the worst of them: it told an author to write the exact key the frontmatter
  linter now refuses, in a position that is no longer the field's home.
  
  It now describes what the build does — `data.templatePriority` is the shared
  home, reaching `system.templatePriority` in SoHL and `flags.hm3.templatePriority`
  in HM3, with the legacy in-block and top-level positions still read and
  `archetype` read last and refused by the linter. The emitted-keys list names
  `templatePriority`, and the example authors it under `data:`.
  
  The specification's one remaining use of `archetype` to mean the priority — an
  aside comparing a map's misplaced fields to it — says "the template priority"
  instead, since `archetypes` now means a different thing one letter away.
  
  The schema fixture's comment no longer reads as though
  `Song-of-Heroic-Lands-FoundryVTT#1836` were outstanding. It is merged; the gap it
  describes closes when SoHL 0.8.4 publishes, since the newest published artifact
  (0.8.3) still declares `archetype`.
- f97036b: **`kbcat` is documented** (#264), the last of the five universal keys the
  specification had never mentioned.
  
  `pack` and the template priority were described in the previous release; `kbcat`
  was the sharpest of the three gaps and the one left. It is read 51 times across
  SoHL's knowledgebase layouts and authored on more than 1,300 notes, and
  `docs/content-format.md` said nothing about it at all — while already using
  `sohl.kbcat AS _section` as the worked example of a content table, so the
  specification demonstrated the key without ever defining it.
  
  It is now described beside the compendium folder, as the one key in that section
  that answers _where does this appear_ for the web rather than for Foundry:
  `pack` and `packFolder` place a document in a compendium, `kbcat` places a page
  in a list. Nothing compiles it — it reaches a published page because frontmatter
  is copied onto that page, where a layout groups by it.
  
  Three things an author cannot infer from the corpus are stated:
  
  - **It is editorial, and independent of `subType`.** Neither is derived from the
    other, and `kbcat` both subdivides a subtype — `trauma`/`physcond` lists as
    `physdisability`, `physfeature` or `physprivations` — and renames one for
    display, `trauma`/`fear` listing under `phobias`. Most notes carrying a `kbcat`
    declare no `subType` at all, so a disagreement between the two is not an error
    to correct.
  - **The value is free-form and nothing validates it.** There is no configured
    list of categories, and the frontmatter check knows only that `kbcat` is a key
    every type may write. So a misspelled category is not a build error and is not
    dropped — it silently becomes a group of one.
  - **A note that writes none is dropped from the list entirely.** Grouping is by
    the key, so a page with no value falls in no group and is simply absent from
    the list page — not last, not under a fallback heading — with nothing reported
    at either build. Every note of a listed type in SoHL's tree carries one today
    and nothing here enforces that, which is one of the questions the content index
    exists to answer.
- 09a2112: **`pack` and the template priority are documented** (#264).
  
  `docs/content-format.md` is the published statement of what a note may write, and
  `pack` — one of the five universal keys, which every note type may write and the
  router has always read — appeared in it only as one incidental sentence inside
  another type's section.
  
  It is now described where it belongs, beside the compendium folder: what it
  names, that `<system>.pack` overrides it for one system, that an unstated one
  falls back to the pack of its type marked `default: true`, and the three
  declarations that are refused — a companion pack, a pack nothing answers to, and
  a pack of another document type.
  
  The **template priority** is documented too, and it needed more than a field
  description: it is a priority, and priorities only mean something against the
  ranges that divide them. Opening a Create dialog gathers candidates from the
  world and every matching compendium — other modules' included — filters them to
  the `(type, subType)` being created, dedups by `shortcode`, and takes the highest
  priority, breaking ties by nearest source and then a stable UUID. So the
  specification now states the reserved ranges: `0`–`98` for SoHL and HM3, `99`–`999`
  for other HeroicLands packages, `1000`+ for everyone else. Since the highest wins,
  anyone else's template always beats content shipped from here — which is the point.
  
  It also records what the tri-state costs: the field is **required** on every note
  SoHL compiles into an Item or an Actor, because "not a template" has to be said
  rather than left out, and `0` is a real priority — the one SoHL's own templates
  ship at — rather than an absence. And that HM3 keeps it in `flags.hm3`, its data
  model having no field for it, where SoHL keeps it in `system`.
  
  **The name is now `templatePriority` on all three sides** — the authored key,
  `system.templatePriority` and `flags.hm3.templatePriority`. It had been three
  different things: a note writes `archetype`, the mapping table said
  `data.templatePriority`, and the SoHL target said `system.template`. The
  specification and the schema fixture are normalized here; the build reads both
  spellings through the transition (#266), and the system's own rename is
  `Song-of-Heroic-Lands-FoundryVTT#1836`. That is more than a rename — it frees the
  word, because `archetype` is being repurposed for a different idea entirely: the
  _sort_ a character is, which is a kind and not a priority.
  
  `kbcat` remains, and #264 tracks it: read 51 times across SoHL's knowledgebase
  layouts, and the specification has never mentioned it.
- 0e8b414: **A folder's `parent` may be a map keyed by pack, and the lint now agrees**
  (#288). `folderFields()` has read both forms since #276 — a folder's _identity_
  is one thing and its _hierarchy_ another, and both large trees file the same
  folder under a different parent in the items pack and the journals pack. The
  vocabulary typed the field as a bare `LINK`, so `content-build lint` required a
  scalar and rejected every note using the form the specification prescribes: 46
  findings against `sohl-thalorna` and 3 here, exactly the notes #276 documents as
  its motivating cases and no others. Every note using the form was a finding, and
  no note using it was not.
  
  `parent` is declared `scalar-or-map` now, and a map written in that form is
  checked **entry by entry** rather than as one value — the correction an author
  has to make is one pack's address, not the whole map, and quoting the map back
  named every entry that was right alongside the one that was not. An explicit `~`
  under a pack key still means _at the root there_, which is a different statement
  from saying nothing.
  
  **A pack key naming no declared pack is a finding of its own.** Nothing checked
  it before, because the whole value was rejected before it was read. It is not a
  harmless surplus: the compile asks the map for the pack it is writing and falls
  back to `default` when there is no such key, so a mistyped `journal:` filed the
  folder wherever the default put it — exactly the hierarchy the key was written
  to override, and silently. `content-build lint` passes the configured pack names
  (companions included) for the check; a caller that supplies none makes no claim
  about the keys, as it already does for the vocabulary itself.
  
  The specification's `### type: folder` table types `parent` as the scalar-or-map
  it is, so the two cannot disagree again from opposite sides of one field.
- 655d901: **`content-format notes` reads the content index, and with it every check
  does** (#243).
  
  It was the last one measuring the tree for itself, and it is the check whose
  whole output is a _count_ — 3,812 findings across `sohl`'s 1,685 notes. A report
  that measures the corpus against the declared vocabulary has to be looking at
  the corpus the compile will build, or its counts describe a tree nobody ships.
  
  It measures what the author wrote, recovered with `authoredFrontmatter`: this
  compares a note's fields against a declared vocabulary, and `address:` is in no
  vocabulary. It also joins the shared contract the other checks now have — a note
  the index cannot record is reported with its position and the rest of the tree
  is still measured.
  
  `bin/content-build.mjs` no longer walks a content tree at all.
  
  _Findings are unchanged: 3,812 across 1,685 notes, identical._
- 0651b1a: **An HM3 item records its template priority, as an HM3 actor already did**
  (#283).
  
  `data.templatePriority` is the shared statement that a note is a starting
  template, and the specification states it as a row every type maps:
  `system.templatePriority` in SoHL, `flags.hm3.templatePriority` in HM3. Only
  HM3's **Actor** pass made that mapping. Its Item pass emitted whatever `flags`
  the note itself authored and nothing more, so an item note declaring the
  priority compiled into a SoHL item that knew it was a template and an HM3 item
  that did not.
  
  **It was silent on both sides of the build.** The note is well-formed and the
  pack compiles; an omitted flag is exactly how this system says _not a template_,
  so a lost priority and a deliberate one are the same output. Nor could the
  emitted-key check see it — that compares what a pass writes against the
  receiving **schema**, and a flag is declared by no schema. Every gear, skill and
  trauma note in a tree carrying an `hm3:` block was affected, which is most of
  them.
  
  **The rule now lives in one place.** `hm3/template-priority.mjs` holds it and
  both passes call it, rather than each carrying a copy — two copies being two
  chances to diverge again, which is the failure being fixed. `SystemItemCompiler`
  gains a `commonFlags()` hook alongside `commonSystem()`, defaulting to the
  authored flags alone, so a system that keeps a shared fact in flags has a seam
  to say so at.
- e4c16ad: **The item catalogue picks the newest cached version numerically, not by string
  sort** (#272).
  
  `foreignItemCatalogDirs` chose among several cached versions of a dependency
  with a plain `sort()` over directory names of the form `<id>@<version>`. That is
  a **string** comparison, so `sohl@0.8.10` sorts _before_ `sohl@0.8.2` and the
  build resolved its embedded item references against the older catalogue.
  
  Nothing reported it, and nothing could: both caches are complete and stamped,
  and the older one is a perfectly valid catalogue — it simply answers for the
  wrong version. Several versions coexist whenever a pinned version is raised
  without clearing `build/cache/foreign`, which is the ordinary case, since a
  fetch writes the newly declared version beside the old one rather than replacing
  it.
  
  The content-index cache already compared version segments numerically for
  exactly this reason. That comparison is now shared as `newestVersionDir` rather
  than written once per cache: two copies were two chances to get it wrong, and
  this is the copy that was wrong.
- d17dc98: **One reader for a note's anchors.** `engine/content-links.mjs` kept its own,
  and it disagreed with the content index's: it matched `{#([a-z0-9-]+)}` where
  `collectAnchors` matches `{#([^}]+)}`. So an anchor with a capital in it —
  `{#CalendarFormat}`, three of them in `sohl`'s own content — existed for the
  index and for the compilers, and did not exist for the check of them.
  
  Nothing links to one today, so the disagreement was latent. The first link to
  one would have been reported dead against a heading plainly present in the
  file, which is the worst shape a finding can take.
  
  The specification puts no charset on the id — "`#id` represents an id anchor
  named `id`" — so the narrower pattern was this module's invention rather than a
  rule it was enforcing. That is the argument for one reader rather than a
  well-chosen one, and the first thing #243 asks for: the corpus and everything
  derived from it answered in one place.
- e242701: **#241's closing note, checked and pinned.** It asked whether `vehicle` and
  `armorlocation` were second instances of the trap it reported — a type declared
  and validated that no pack can route. Neither is, and they are not the same case
  as each other:
  
  - **`armorlocation` is HM3's.** The specification says "HM3 only", it has no SoHL
    form, and `hm3/document-subtypes.mjs` maps it. A SoHL configuration claiming
    it would be wrong, so its absence from `SOHL_DOCUMENT_SUBTYPES` is the answer
    rather than a gap. Nothing asserted that, so nothing would have noticed a row
    appearing there by mistake; now something does.
  - **`vehicle` is specified but not yet implemented, and says so.** A note of that
    type is already reported as _"the content format specifies `vehicle`, so the
    note is not wrong — this toolchain has not implemented the type yet … do not
    author the type until a release compiles it"_. That is the opposite of #241,
    where the failure was silent and misattributed to the note.
  
  No behaviour change: this adds the two assertions and the reasoning, so the
  next reader does not have to re-derive it from four files.
- dadbec3: **`content-build lint` and `content-build site` reach the content again** — they
  threw on the first note for every consumer.
  
  #243 made `walkMarkdownTree`'s scope a required argument, which was the point:
  the default it removed read whichever configuration resolved from the working
  directory rather than the one the caller was working under. Two CLI callers had
  been living on that default and were not converted with the rest — so both
  commands failed immediately, reporting nothing about the tree.
  
  This repository ships no content, so nothing in its suite had ever _run_ those
  commands over a tree; every test called the engine directly with arguments it
  supplied. A test now builds a small content tree and runs `lint`, `links` and
  `site` against it, asserting they reach the notes at all — and that they honour
  the configured `skipDirectories` rather than reading a directory the tree said
  to skip.
- ae9ef89: **#243's two open questions, settled** — one by measurement, one by finding it
  had already been answered.
  
  **1. The index does not record frontmatter-key positions, and should not.** The
  question was whether a pass reading the index could report a field defect
  without opening the note. The numbers are not close: over `sohl`'s 1,685 notes
  the index is **3.0 MB** and holds **50,598 leaf values**, so a `{line, column}`
  on each would add roughly **1.6 MB — a 54% larger artifact** — for data read
  only on the _failing_ path.
  
  The rule that replaces it is the one the module was already built on: _the index
  carries what is **about** a note; the file carries the note's text and every
  position within it._ A pass needing either opens the file the record already
  names, which costs nothing it was not already paying — a check reads each note
  once for its body, and a compiler must read the prose regardless, so while it
  holds the bytes a position is free. An anchor's `line` is the exception that
  proves it: an anchor is structure a consumer addresses, not a locator for a
  diagnostic.
  
  `noteFile(contentBase, record)` is the one composition of a record's absolute
  path. There were **four** copies of it — one in each reader converted by #290,
  #292, #294 and #296 — which is the duplication #243 exists to remove, arriving
  by the back door. The index records the path relatively on purpose (an absolute
  one is a fact about the build machine, and would put a home directory in a
  published artifact), so composing it is a real step and belongs in one place.
  
  **2. "Not everything is a note" no longer holds.** The issue lists folder
  documents (`item-folders.yaml`) and the adventures that bundle scenes as
  configuration appearing in no record. Both became notes after it was written —
  folders in #260/#276, bundles in #263/#286 — and both are indexed today, a
  folder with its address and id, a bundle with the `Adventure` UUID it compiles
  into.
  
  What a folder record does not carry is a Foundry address, and that is the right
  answer rather than a gap: a folder materialises in **every** pack holding a
  document that references it, so no one UUID identifies it, and emitting one
  would publish an `Item` UUID for a `Folder` at an id no document carries. A
  homepage carries none for the opposite reason — it compiles into no document at
  all. Both are now pinned at the **record**, which is the level a pass driven by
  the index reads, with a bundle as the positive control.
  
  _No behaviour change: `lint`, `links`, `content-format notes` and both address
  maps are identical over `sohl`'s tree._
- 2669b57: **`undeclaredPaths` stops descending at a declared leaf** — a declared path with
  no children holds _values_, not fields (#126).
  
  A schema declares a path that has nothing beneath it for two ordinary reasons: a
  map with **dynamic keys** (a mystery's `skillAptitudes` is skill selector →
  modifier, an affiliation's `relations` is shortcode → standing) and a
  **TypedSchemaField** (`strikeModes`, discriminated by `type`). In both, what sits
  under the path is data an author wrote, not paths the schema names — so walking
  into one reports every entry as an undeclared `system` key.
  
  It stayed invisible because those maps are authored _outside_ `<system>.system`
  today, where nothing walks them. The moment a note authors one at the
  destination — which is what #126's corpus move does — each entry becomes a
  finding: `sohl.system.skillAptitudes.zepharis`, `…strikeModes.impale`, one per
  key. Measured on a migrated `sohl-thalorna`: **324 findings, none of them a
  defect**, and they would have made the migration look like it had broken 62
  notes.
  
  Descent is now conditional on the schema declaring something _beneath_ the path.
  `body.structure` declares `parts` and `zones`, so it is a real container and an
  undeclared `adjacent` under it is still reported; `skillAptitudes` declares
  nothing beneath it, so its contents are a value.

## 17.2.0

### Minor Changes

- ce40274: **The content index now carries every address the link manifest does**, which
  is the substance of folding the two artifacts into one (#239).
  
  Each record gains a `foundry` block — `{ uuid, anchors }` — and **an item note
  now emits two records**: the item, and its documentation journal. The journal is
  a document in its own right, with its own canonical address
  (`doc<type>/<shortcode>`), its own UUID and its own pages, so it gets its own
  record rather than being nested inside the item's. Resolving
  `docaffliction/blkdth` is then the same lookup as resolving anything else,
  instead of the one address in the index reachable only by knowing to look
  somewhere else.
  
  The two are linked in both directions: the item carries `documentation`, the
  journal carries `documents`.
  
  **The journal's record is lean, and deliberately not the note's frontmatter.**
  The item's `sohl:` block describes the item; copying it onto the journal would
  assert things about the journal that are not true, and double the file to do it.
  The journal carries its addresses, its name, its anchors and the file it came
  from.
  
  **Derived by the manifest's own code, not a second implementation.** A UUID is a
  function of the note's `type`, its authored `id` and the pack router —
  frontmatter and configuration, nothing from a compiled pack — so the index's
  existing walk already had every input. Verified against `sohl`: **2,988 UUIDs
  and 1,510 anchor maps, matching the manifest exactly, with none missing on
  either side.**
  
  Two smaller changes fall out of it:
  
  - `emitContentIndex` reports `notes` and `records` separately, because an item
    note is one note and two records and reporting one as the other overstates the
    tree. Records sort by path, then canonical address, then id — the address
    before the id, because an item's two records share a file and only one carries
    an id.
  - `entriesForNote` takes `docEntryTypes` from its context instead of reading the
    ambient configuration. It is what `manifestContext` already promised — "the
    pass itself is a pure function of its context" — and it was not true: the
    emitter consulted whichever configuration `loadPackConfig()` found, not the one
    it was handed. A fixture that never declared the type it asserted was passing
    on that leak.

### Patch Changes

- 6a3d083: **`package-build labels check` crashed for every consumer in 17.1.0.**
  `labels.mjs` was added and not listed in `package.json` `files`, which is an
  explicit whitelist, so the module never reached the tarball and the command
  threw `ERR_MODULE_NOT_FOUND` on the import the release notes had just
  announced.
  
  Adds the module to `files`, and a guard so the class cannot recur: a new test
  reads the root-relative imports out of `bin/` and requires each one to be
  published, by name or by a containing directory entry. Verified by removing
  `labels.mjs` from `files` again and watching it fail.
  
  The failure could only appear in a consumer, after publish — locally the file
  is simply there, so every check passed.

## 17.1.0

### Minor Changes

- 9d6a52f: **New: `package-build labels check`.** The issue-label registry has two faces
  that must agree — `.github/labels.yml`, which is synced to GitHub, and the §3
  table in `.github/ISSUE_REPORTING.md`, which is what a person reads. Neither
  derives from the other, so either can drift, and nothing notices until an issue
  is filed against a label that does not exist or the sync pushes one the
  documentation never mentions.
  
  It arrives here because **every repository wants it and only the paths ever
  differed** — it was a `utils/check-labels.mjs` copied per repository, which is
  the shape a shared check takes just before its copies start disagreeing. Same
  argument that moved the no-attribution check to a shared action.
  
  Two things improve in the move:
  
  - **Findings are compiler-parseable and located.** The original printed prose
    to stderr; this reports `.github/labels.yml:73:9: error: …` against the file
    each finding belongs to, so a missing row is located in the documentation and
    a missing entry in the registry.
  - **The documentation path is an option.** `--doc` defaults to
    `.github/ISSUE_REPORTING.md`; `Song-of-Heroic-Lands-FoundryVTT` keeps its at
    `kb/dev-docs/how-to/issue-reporting.md` and now needs no separate script.
    `--registry` likewise.
  
  A missing §3 is reported once, as its own failure, rather than as every label
  having drifted. An over-long description is caught here too — GitHub answers a
  bare 422 naming neither the label nor the limit.
  
  Verified against every repository that has a registry: `sohl-thalorna` (12),
  `sohl-kethira-basic` (11), `harn-adventures` (11), `harn-ensemble` (12) and
  `Song-of-Heroic-Lands-FoundryVTT` (16) all agree — and it found real drift in
  `HarnMaster-3-FoundryVTT`, where `good first issue` and `help wanted` are in
  the registry and absent from §3.

## 17.0.0

### Major Changes

- fdd7094: **The linter now implements the format it publishes.** `docs/content-format.md`
  and the vocabulary had drifted, silently and in both directions, and nothing
  compared them.
  
  **Five documented types reached no schema** — `place`, `lore`, `scenario`,
  `vehicle` and `armorlocation`. A note using one was reported as having no
  schema and then _skipped entirely_: `lintNote` returns after that finding, so
  the note's `data:`, `subType`, references and system block all went
  unexamined. So the types were legal enough to author and not legal enough to
  check, and using one **suppressed** every other check on the note (#231).
  
  **Three documented `data` properties reached no vocabulary** — `epithet` and
  `symbol` on `affiliation`, and `lore` on both `affiliation` and `being`. The
  `data:` container is closed, so a note that followed the specification exactly
  was told its property did not exist _and the value was dropped_ rather than
  reaching the page (#232).
  
  `peoples` is **removed**, having widened to `lore` — the specification says so
  outright, and no tree authors it: "Nothing is lost by widening: the target's
  own subType already distinguishes a `folk` from a `law`." That removal is the
  reason this is a major; everything else here turns red trees green.
  
  Between them, on `sohl-thalorna`: **2,001 findings become 20**. The 1,981 that
  go were never content defects. The 20 that stay are: 18 embedded shortcode
  collisions and two genuinely stale keys.
  
  **The specification is executable now.** `tests/content-format-agreement.test.ts`
  parses `docs/content-format.md` and fails if a documented type has no schema or
  no vocabulary, or if a type's declared `data` properties differ in either
  direction from its documented table. Nothing compared the two before, which is
  why this drift lasted.
  
  Also corrects the specification itself: `macro`'s `macroType` and `macroScope`
  were tabled as `data` properties, but the compiler reads them with the
  `sohl`-field accessor — the `sohl:` block, then the note's top level — so
  `data.macroType` is not read at all. They are `sohl` properties, and the table
  now says so.

## 16.0.0

### Major Changes

- d734ac9: **Two embedded items on one actor may no longer share `(type, shortcode)`.**
  `content-build lint` reports each collision as an error, at the later entry.
  
  SoHL treats `(type, shortcode)` as a **logical identity** rather than a lookup
  convenience: two documents of one type bearing one shortcode denote _the same
  entity_, whatever their `_id`s or field values. It is unique within four scopes,
  one of which is an actor's own embedded items — and the invariant exists to keep
  that identity well-defined. Two colliding entries make "the same thing"
  ambiguous, and every match that resolves by it — compendium↔world
  reconciliation, archetype shadowing, `fvttFindItemByShortcode`, cohort
  membership, expression and effect references — becomes unsound.
  
  Nothing caught it. The compiler resolves each entry independently and
  distinguishes the two only when seeding `_id`, so a collision compiled to two
  documents with distinct ids and shipped unremarked:
  
  ```yaml
  items:
    - { shortcode: swim, type: skill, system: { masteryLevelBase: 30 } }
    - { shortcode: swim, type: skill, initSkillMult: 1 }
  ```
  
  Neither entry overrides `system.shortcode`, so both inherit `swim` from the
  template and compile to two `skill` items keyed `swim` on one actor.
  
  **The rule is decidable from frontmatter alone**, which is why it is a lint and
  not a compile step. An entry's effective key is `system.shortcode ?? shortcode`:
  a top-level `shortcode` merely selects the template the entry is written from
  and never reaches the document, while a template's own `system.shortcode` is its
  address by construction. Neither the catalogue nor a compile is needed to know
  what an entry will carry.
  
  Two entries written from one template are still fine when the second says which
  entity it is — `{ shortcode: Dgr, type: weapongear, name: "Dagger 2", system: { shortcode: Dgr2 } }`.
  The key is the _pair_, so two different types may share a shortcode, and an
  entry naming no key at all is left to the compiler, which already reports it.
  
  **Major**, because a tree carrying a collision goes red on adoption. Known at
  the time of writing: `Song-of-Heroic-Lands-FoundryVTT` 1 actor,
  `sohl-thalorna` 15, `sohl-kethira-basic` 0.
- 2e0d32e: **A note's address has one name: `packageAddress`.** `engine/content-address.mjs`
  exported it twice — as `contentAddress` and as `packageAddress` — and the two
  bodies had become byte-identical:
  
  ```js
  // before                              // after
  contentAddress(fm); // "doc-gear/"     packageAddress(fm); // "doc-gear/"
  packageAddress(fm); // "doc-gear/"
  ```
  
  `contentAddress` is removed. Import `packageAddress` from
  `@heroiclands/package-build/engine/content-address` instead; the two returned
  the same string, so nothing else changes.
  
  The names once meant different things — a note's address _within the content
  tree_, and its address _relative to the package_. They could differ while a
  `README.md` addressed its section rather than itself and while a page's URL was
  derived from `name.full`; the first went with the landing rules (#204, #208) and
  the second when a page's URL became its address (#181). What was left was two
  exported names for one notion, on a public subpath, with `contentAddress`'s
  documentation still describing an address "below the knowledgebase mount" that
  it no longer returned.
  
  `packageAddress` is the name that survives because it still says something true
  and load-bearing: the string is measured **from the package**, so a caller
  composing a URL or a manifest `path` prepends where the package is served. That
  is the one qualification a reader of the call site needs, and it is exactly the
  distinction the `url:` change in 15.0.0 turned on. Closes #226.

### Minor Changes

- e131f7b: Publish the note tree as a queryable index, instead of throwing every build's walk away.
  
  Every content build parses every note's frontmatter — the pack compilers, the site
  build, and the content-table expander each do it — and every one of them discards
  the result. Nothing outside a build could therefore ask a question about the
  content: _which beings carry no `kbcat`_, _what does this table actually select_,
  _did that type rename leave anything behind_ each needed a throwaway script that
  re-walked the tree. Eight dead tables shipped for weeks behind exactly that gap.
  
  `content-build content-index` emits one JSON Lines record per note — the whole
  frontmatter, plus a derived `file` (`path`, `folder`, `name`) and the configured
  `package` — so a question is one line of `jq`, and so an editor, a CI check, or
  another package's build can read the content without re-deriving it.
  
  **The record is the note, not a projection of it.** Nothing is selected, flattened,
  or renamed; a reader addresses `sohl.body.weight.base` because that is what the note
  says, which is also exactly what a `dataview` query writes. The refusal to impose a
  schema is deliberate: `sohl`'s frontmatter spreads 242 distinct leaf paths unevenly
  over 15 types, from 9 on a `macro` to 72 on a `being`, so a fixed column set would
  turn ordinary authoring into a schema migration. `package` and `file` are the two
  derived keys, and a note carrying either is an error rather than a silent overwrite.
  
  **Derived, disposable, byte-stable.** It writes to the new `paths.contentIndex`
  (`build/content-index/<package>.jsonl`) — never `paths.stage`, which is mirrored
  into a Foundry data root — so nothing may be authored against it and it need never
  be committed. Regenerating costs a frontmatter parse rather than a build, which is
  why it is a command of its own; and because rebuilding is the intended use, records
  are ordered by content path with the note id breaking ties and every object's keys
  are sorted at every depth, so a rebuild over an unchanged tree is a no-op. A tree
  that yields no note is an error, not an empty index: a reader takes the file as
  authoritative, and "this package has no content" is indistinguishable from a
  mis-pointed tree.
  
  **Every note's address, and every anchor it defines.** A record states
  `address.slug` (what goes inside `[[…]]` locally) and `address.canonical` (the
  package-qualified key the manifest files it under), plus every `{#slug}` anchor the
  body declares — each with its heading name, level, **line in the file**, and the
  `slug#anchor` link that reaches it. Neither address is new information, since both
  derive from `type` and `shortcode`; what the fields add is the rule, derived through
  the same `addressSlug` and `canonicalKey` the manifest and site build use, so an
  index cannot disagree with either about where a note lives. The payoff is that a
  wikilink — anchor and all — becomes checkable by lookup rather than by re-parsing
  the tree, and an editor can jump to a section instead of searching for it. What
  counts as an anchor is kept identical to what `splitPages` matches, and a test
  asserts the two agree.
  
  **A keyboard-typeable form of every name.** `nameAscii` states `name.full`
  reduced to printable 7-bit ASCII — `Kûrbúl ¾-Helm` → `Kurbul 3/4-Helm`, `Kèthîra`
  → `Kethira`, `Ærling` → `AErling`, `Þorn` → `Thorn`, `Straße` → `Strasse`. Names
  carry the setting's orthography and nobody types them, so anything searching or
  completing over the index needs a form a keyboard produces; stating one means
  every consumer folds the same way instead of each inventing its own and two
  searches over the same data disagreeing. It transliterates rather than strips,
  through the same `unidecode` table `slugify` already runs — so an ASCII name and
  a slug cannot disagree about a character, and `Kûrbúl` does not become `Krbl`.
  Emitted even when it equals the name, so a consumer never branches on whether a
  name happened to be ASCII; `null` only when the note has no name. `aliasesAscii`
  does the same for `name.aliases` in the authored order — an alias is the name a
  reader is at least as likely to reach for (`Killer Whale` for an orca), so a
  search has to match it too — and is an empty array rather than null when a note
  has none.
  
  `file.path` stays relative to the content root and is deliberately never absolute:
  an absolute path is a fact about the machine that built the index, so it would break
  byte-stability between checkouts and publish someone's home directory.
  
  Closes #224.

## 15.0.0

### Major Changes

- 5c16c02: Let a note's art path say "unset" and "blank on purpose" with two different values.
  
  `resolveImg` opened with `if (!raw) return ""`, and every caller then applied its
  own default to the result with `||` — `resolveImg(fm.img) || itemArt(type)`. So
  `""`, `null` and an absent key were one case: all three compiled to the type's
  default art, and a note had no way to say _ship no image_ at all.
  
  They are now three values with two meanings, the convention the project already
  holds for an optional "not specified" DataModel string (`nullable, initial: null`,
  so "unset" is one honest value rather than two):
  
  | a note writes  | it means                             | it compiles with |
  | -------------- | ------------------------------------ | ---------------- |
  | nothing at all | _unset_ — name me no art             | the type default |
  | `img: null`    | the same thing, said out loud        | the type default |
  | `img: ""`      | _blank on purpose_ — I want no image | no image         |
  
  **`resolveImg` returns `string | null`.** `null` for an unset path, `""` for a
  deliberate blank, the translation half unchanged. Every caller pairs its default
  with **nullish** coalescing: `sohl/items.mjs`, three in `sohl/actors.mjs` (`img`,
  `portrait`, and the prototype token's `texture.src`), and `engine/macros.mjs`.
  Not `||` — that collapses a deliberate blank back into the default and takes the
  distinction away again, and it does so silently, because `""` is falsy.
  `itemArt()` is unaffected: a registry entry with no art throws before the
  translation, so its result is never the unset case.
  
  **The default-art seam is a documented extension point, so this is the substance
  of the change, not a detail.** A consuming repository that pairs art with its own
  `itemBuilders` entry, or calls `resolveImg` from a builder of its own, gets the
  new reading of `""` whether or not it asked for it — which is why the sweeps have
  to come first. `sohl-thalorna` swept forty-five `img: ""` notes ahead of this
  release (HeroicLands/sohl-thalorna#134) and `sohl-kethira-basic` eleven
  `portrait: ""` beings (HeroicLands/sohl-kethira-basic#81); `sohl` authors neither,
  and its 3,125 compiled documents are byte-identical across the change.
  
  **Both art fields, because both go through `resolveImg`.** A being carries `img`
  (its token art) and `portrait` (its sheet portrait) independently; `portrait` is
  not a variant spelling of `img`, and the rule belongs to the translator rather
  than to one of the keys reaching it. This is not theoretical: `sohl-kethira-basic`
  writes `portrait: ""` on eleven beings and `img: ""` on none, so a change — or a
  guard — keyed on `img` alone would have called that tree clean and dropped every
  one of those portraits.
  
  **A warning for the old spelling.** The frontmatter lint reports `img: ""` and
  `portrait: ""` — in either authoring position — as the meaning-change they are, on
  the pattern the `package:` and retired-alias sweeps set: a warning, because the
  note still compiles, to a document that is merely iconless.
  
  **`title` is deliberately not on this rule.** It reads as a general rule about
  optional strings and it is not: on a `type: affiliation` note `title` is
  _simultaneously_ a declared item field whose default is `""`
  (`sohl/item-fields.mjs`), resolved from the very same shared top-level key the
  site emitter reads as the page title. `title: null` therefore does not fall back —
  it stringifies, and the compiled document ships the literal `"null"`. A `title` a
  note does not want is written by omitting the key; the emitter's `fm.title ?? name`
  is already correct and is untouched. The lint guard is `img`'s alone for the same
  reason.
  
  Delivers the `img` half of #218. The `title` half — the collision above — stays
  open.
- 63dfcae: **A note's own `title` no longer fills an affiliation's `system.title`** (#218).
  
  The two were never the same quantity. A note's top-level `title` is _the title
  of the note_ — the heading its page is published under, which the site emitter
  reads. An `affiliation` item's `system.title` is _the style of address the office
  carries_ — Ajaw, Warden, a person's style within the body. They collided only in
  spelling, and field resolution's third step, the shared top-level property, fed
  the second from the first.
  
  That step also answers **without** applying the field's default — only the
  in-block step does — so an authored `title: null` reached the `String()` coercion
  unguarded and compiled to the literal string `"null"`. Fifteen `sohl-thalorna`
  notes shipped `"system": { "title": "null" }` that way.
  
  **Nothing in any content tree relied on the fallback.** Across all three
  consumers — 295 `affiliation` notes in `sohl-thalorna`, 28 in
  `sohl-kethira-basic`, none in `sohl` — not one carries a non-empty top-level
  `title`, and `content-build package compile` emits byte-identical
  `build/packs-json` for all three. It is a major because the rule that decides a
  consumer's compiled documents changed with no configuration to restore it, and
  because the generated item-field reference moves (below).
  
  **The field is still authorable**, at the two positions that describe the
  document rather than the note: `sohl.system.title`, and the legacy in-block
  `sohl.title` that most trees already write. A membership's title belongs on the
  entry in a being's `sohl.items`, as its `system.title`. `data.title` is neither —
  `title` is not a `data:` property any note type declares, so `content-build lint`
  refuses it.
  
  **Declaring the exemption:** a field in an `itemBuilders` `fields:` declaration
  may now carry `topLevelMeans`, whose value is _what the note's top-level key of
  that name means instead_. Declaring it removes the shared top-level position from
  that field's resolution order, and the generated item-field reference prints the
  reason beneath the type's table, so an author reading it learns that the
  top-level key will not fill the field. A repository that commits that page should
  regenerate it.
  
  The value is the reason rather than a bare flag deliberately: a boolean would
  record the decision and lose the case for it, and the next person adding a field
  needs to know the question exists.
- a41b066: **A page states its address relative to the site root.** `site.base` is no
  longer written into a page's Hugo `url:` front matter — only into the `href`s
  this build renders and the base a link-manifest `path` is measured against:
  
  ```yaml
  # emitted page
  url: /doc-rulesintro/ # was: /sohl/doc-rulesintro/
  ```
  
  `site.base` was two quantities wearing one name. It is correctly _where the
  package is served_ — the prefix on every rendered `href`, and the base a
  manifest `path` is stripped against — and `/<contentPackage>/` is the right
  default for that. It was also written verbatim into each page's `url:`, and that
  is a different quantity: Hugo resolves `url` against `baseURL`, whose path for
  every consumer that exists **already is** the package base. So the prefix was
  written twice, and every content page — plus the homepage — published one
  package segment too deep:
  
  ```text
  /sohl/doc-rulesintro/                404      /sohl/sohl/doc-rulesintro/               200
  /thalorna/being-afzndhprnzr/         404      /thalorna/thalorna/being-afzndhprnzr/    200
  ```
  
  Not one address a link manifest advertised resolved: **0 of `sohl`'s 2,988
  entries**, and 0 of `thalorna`'s 2,585.
  
  **One value fed two readers that need opposite framings**, which is why no
  setting could fix it from a consumer: `site.base: "/"` bought the addresses and
  short-changed the hrefs, and the default did the reverse. They are now separate,
  and each reader gets the form it needs:
  
  | Reader                                              | Gets                        | Because                                                             |
  | --------------------------------------------------- | --------------------------- | ------------------------------------------------------------------- |
  | A page's own `url:` front matter                    | `/<type>-<shortcode>/`      | Hugo prefixes the site's `baseURL` path to it                       |
  | The address index a `[[wikilink]]` resolves through | `<base><type>-<shortcode>/` | A browser resolves the rendered `href` against nothing              |
  | A link-manifest `path`                              | `<type>-<shortcode>/`       | Measured against `site.base` and stripped; unchanged, byte for byte |
  
  The homepage moves with them: `homepageFrontmatter` states `/homepage-root/`,
  and no longer takes a `base` (nor does `writeHomepages`' fourth argument, which
  existed only to supply it). `trees` pages and section landings never stated a
  `url:` and are untouched — they take their address from their path.
  
  **Take this release and drop your `site.base`.** Both publishing consumers set
  `site.base: "/"` as a stopgap
  (HeroicLands/Song-of-Heroic-Lands-FoundryVTT#1813, HeroicLands/sohl-thalorna#131),
  which bought the correct addresses at the cost of same-package body links
  rendering `/doc-x/` rather than `/sohl/doc-x/` — dead either way, so nothing
  regressed. With this release the stopgap is no longer needed and no longer
  harmless: keeping it leaves those hrefs short. Delete the `base:` line and the
  default is right for both halves.
  
  **Verified against pristine `git archive origin/main` extractions of all three
  consumers**, in both configurations, through `content-build site` **and** Hugo
  0.165:
  
  | Consumer   | `site.base` | Page `url:`           | Rendered path                  | Manifest entries resolving |
  | ---------- | ----------- | --------------------- | ------------------------------ | -------------------------- |
  | `sohl`     | unset       | `/doc-rulesintro/`    | `/sohl/doc-rulesintro/`        | 2,988 of 2,988 (was 0)     |
  | `sohl`     | `"/"`       | `/doc-rulesintro/`    | `/sohl/doc-rulesintro/`        | 2,988 of 2,988             |
  | `thalorna` | unset       | `/being-afzndhprnzr/` | `/thalorna/being-afzndhprnzr/` | 2,585 of 2,585 (was 0)     |
  | `thalorna` | `"/"`       | `/being-afzndhprnzr/` | `/thalorna/being-afzndhprnzr/` | 2,585 of 2,585             |
  
  No `/sohl/sohl/` or `/thalorna/thalorna/` path exists in either built tree, the
  section landings, the content mount and the `dev-docs` tree pages all still
  resolve, and with the stopgap dropped a same-package body link renders
  `<a href=/sohl/doc-skills/>` again. `lint` and `links` are identical line for
  line in every combination — `sohl` green, `sohl-thalorna` exactly as red as its
  own content gap leaves it (1,983 lint findings, 122 link findings).
  
  **Exactly one line per page changes, and nothing else does.** Of `sohl`'s 1,671
  emitted files, 1,606 differ — the 1,605 content pages and the homepage — each by
  its `url:` alone; the 46 tree pages and 19 landings are byte-identical, and
  `build/manifests/sohl.json` is byte-identical. `sohl-kethira-basic` publishes a
  homepage and nothing else (`publish.site: homepage`) and declares no
  `site.base`: its console output is identical, its one emitted page moves from
  `/kethira/kethira/homepage-root/` to `/kethira/homepage-root/`, and its landing
  at `/kethira/` is unaffected.
  
  Closes #217

## 14.0.0

### Major Changes

- a0a113b: **`publish.address.landing` is deleted.** `prefix` is the whole address scheme:
  
  ```yaml
  publish:
    address:
      prefix: kb/ # default: "" — the package root
  ```
  
  The key named which note addressed a whole section rather than a page within
  one. #202 retired the second of its two rules and #204 retired the concept both
  rules chose between — a section is a Hugo content directory the note format does
  not carry, a page's address names no directory, and so no note lands one. What
  survived was the key itself: resolved, refused-by-name for the retired value,
  checked against a one-element vocabulary, frozen into the configuration, and
  read by nobody. `LANDING_RULES` said so in its own doc comment — _"Inert since
  #204."_
  
  **A configuration still declaring it is refused, at the line it is written on.**
  Not reported as an unrecognized option, which names a spelling to correct and
  leaves the author to work out that the mechanism is gone:
  
  ```text
  package-build.config.yaml:14:9: error: package-build config:
  `publish.address.landing` is a retired option — delete it. It named which note
  addressed a whole section rather than a page within one, and there are no
  sections to address: a section is a Hugo content directory the note format does
  not carry, so no note lands one and every page is addressed
  `<type>-<shortcode>`. Nothing replaces it.
  ```
  
  Presence is the whole test, as it is for a retired frontmatter field: no value
  makes declaring it right, so `readme` and the already-retired `collection` are
  refused alike, by `RETIRED_ADDRESS_KEYS` — the configuration-side twin of
  `engine/retired-fields.mjs`.
  
  **Why the key outlived its mechanism by one release.** `content-config.mjs` has
  no warning channel — every finding goes through `fail()`, which throws — so
  while both publishing consumers still declared the then-true `landing: readme`
  the only options were to break them over a correct statement or to accept the
  key in silence, and silent acceptance is what this codebase refuses everywhere
  else. So it took the three steps `package:` took (#56): retire the value, have
  consumers drop the key, delete the key. No consumer declares it now.
  
  **The plumbing goes with it.** `packageAddress` took an address scheme only to
  validate the `landing` rule it then discarded — its own docstring already said
  the `prefix` half never applied, because an address is `(type, shortcode)`, a
  package-wide identity that takes no mount. It is now a function of the
  frontmatter and nothing else, and `manifestContext` no longer carries a `scheme`
  that nothing reads.
  
  | Removed                                                                                                                              | Where                        |
  | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
  | `LANDING_RULES`, `RETIRED_LANDING_RULES`                                                                                             | `content-config.mjs`         |
  | `DEFAULT_ADDRESS_SCHEME.landing`, `ADDRESS_KEYS`' second entry, `normalizePublish`'s resolve-and-check, `AddressSchemeInput.landing` | `content-config.mjs`         |
  | The `LANDING_RULES` re-export, `packageAddress`'s `{ scheme }` parameter and its landing check                                       | `engine/content-address.mjs` |
  | `manifestContext`'s `scheme`, and the argument `collectManifestEntries` passed on with it                                            | `engine/manifest-emit.mjs`   |
  
  **Nothing a consumer emits moves.** Verified against pristine
  `git archive origin/main` extractions of all three consumers, before and after:
  `lint`, `links`, `manifest`, `package compile` and `site` produce **identical
  console output, line for line**, and every emitted file is byte-identical —
  31,197 files across the three trees, with only LevelDB's own timestamped `LOG`
  differing. `sohl` stays green (2,988 manifest entries, 3,125 pack documents,
  1,671 emitted pages); `sohl-thalorna` stays exactly as red as it was for its own
  content gap (1,983 lint findings, 122 link findings); `sohl-kethira-basic` stays
  green.
  
  Closes #215
- 98ac362: **`subType: user-guide` is refused.** #206 renamed the `doc` subType
  `user-guide` to `userguide` and held every `type` and `subType` to the address
  charset, but shipped a **transitional acceptance** for the old spelling — a
  warning naming the replacement rather than a refusal — because 43 `sohl` notes
  authored it and no consumer can sweep ahead of the release that renames a value.
  Every consumer tree has now swept: `sohl` **0**, `sohl-thalorna` **0**,
  `sohl-kethira-basic` **0**, counted on a pristine extraction of each
  `origin/main`. So the acceptance guards nothing, and this is the follow-up #207
  named.
  
  `RETIRED_SUBTYPES`, `retiredSubType()` and `retiredSubTypeMessage()` are gone
  from `engine/note-vocabulary.mjs`, along with the retired-spelling branch that
  ran ahead of the charset check in `checkSubType`. Nothing replaces them:
  `user-guide` now falls through to the **charset** check and is refused as an
  error, for the reason that always applied — it contains a hyphen. That is why
  the acceptance could be deleted rather than promoted to an error: the permanent
  rule already covers the case, so no retirement-specific code outlived the sweep.
  
  **Breaking**, though the diff only removes code. A spelling that built at exit 0
  one release ago now fails the build, and three exported symbols no longer exist.
  A tree that has swept sees no change at all — which all three consumers have,
  and each was verified unaffected.
  
  **The subType charset diagnostic is reworded.** It justified the rule by "the
  hyphen separates the segments of an address", true of a `subType` when #206
  shipped — `sectionOf` returned a `doc`'s subType, so the value was a URL path
  segment — and not true since #204 retired sections. The rule stands on its own
  footing instead: a subType is a vocabulary term the whole toolchain keys on, one
  closed set away from being an address segment again, and a charset holding for a
  type, a shortcode and a `contentPackage` but not for a subType would be a rule
  nobody could state in a sentence. `typeCharsetMessage` is untouched — a type
  genuinely is the first segment of every address.
  
  The same correction is applied to `assertVocabularyCharset`'s throw, which
  carried the identical claim in a second place — _"A type and a subType are both
  address segments"_ — where it would go unread until it fires, which is exactly
  when it would be taken at face value. It now states the reason **per key**: the
  address half for a type, the vocabulary-term half for a subType. The guard
  itself is unchanged and stays where it is, running over `NOTE_VOCABULARY` as the
  module loads.
  
  Closes #210

### Minor Changes

- 45b5bd0: **A section can say what it lists.** `site.sections` / `site.readmeSections`
  take two more keys, `listType` and `listSubType`, and both reach the generated
  `_index.md`:
  
  ```yaml
  sections:
    weapongear: { title: Weapons, listType: weapongear }
    user-guide: { title: User Guide, listType: doc, listSubType: userguide }
  ```
  
  Since #204 a content page is written flat under the mount, so a declared
  section's directory holds nothing but the landing this build writes for it and a
  layout reading Hugo's `.Pages` finds no members. The membership survives in the
  `site.sections` map and in nothing a theme can read — not on the page, not on
  the landing, not in any URL — so every section landing served by a generic list
  layout renders empty. `sohl` was unaffected only because its eleven catalog
  layouts already query `site.RegularPages` by `Params.type`; a consumer rendering
  through the shared theme has no layout of its own to edit. The landing now
  states that query and the theme runs it
  (HeroicLands/heroiclands-hugo-theme#50).
  
  **Two keys of their own, not `type` / `subType`.** On an `_index.md`, `type` is
  Hugo's own layout selector: verified against Hugo 0.165, a section landing
  carrying `type: doc` renders through `layouts/doc/list.html` rather than the
  default list template — behaviour this build already relies on deliberately, for
  the mount's own `landing`. Spelling the content type there would silently change
  which template serves the landing.
  
  **Two keys added to the closed set, not an open passthrough.** `site.landing` is
  passed through unvalidated because it is written once, for the mount, in one
  landing template's own vocabulary; a section entry is written fourteen to twenty
  times per build against a contract every package and every section shares.
  Unbounded there, a mistyped `listTpye:` would publish into front matter, list
  nothing, and report no error — which is the bug being fixed, moved one step
  downstream where no build can see it. `normalizeSectionMeta` stays the one place
  the vocabulary is bounded, and the writers still name no keys.
  
  **Both values are checked, because both ways of writing an inert declaration are
  silent.** They name a content type and subType, so each must be an address
  segment (`^[A-Za-z0-9]+$`), and a `listSubType` with no `listType` is refused —
  a subType tells pages apart only within a type, so alone it names no query. The
  charset check is the trap this came from: a section is named for a URL the site
  chose and need not match the address (`/sohl/kb/user-guide/` is the section,
  `userguide` the subType, #207), and copying the section's name in would match no
  page at exit 0. All three refusals are located at the offending key:
  
  ```text
  package-build.config.yaml:504:90: error: package-build config:
  `site.sections.user-guide.listSubType` is `user-guide`, which is not
  alphanumeric. …
  ```
  
  **Additive.** A section that declares neither key emits exactly the bytes it
  did before. Verified on a pristine `origin/main` extraction of `sohl`, the only
  consumer running `content-build site` with declared sections: 1670 emitted files
  byte-identical, and with the keys declared on two of its nineteen sections
  exactly those two `_index.md` files change.
  
  Closes #212

## 13.0.0

### Major Changes

- 0c2def0: A section is a Hugo directory concept, and the note format no longer carries one
  (#204). Content pages emit **flat** under the mount, named by their address; the
  `README.md` landing convention, `sectionOf`, the `<section>/` output routing, and
  the "no section, so nowhere to file the page" refusal are all gone.
  
  **Why it goes.** Since #181 a page's URL _is_ its address,
  `/<package>/<type>-<shortcode>/`, so a section appears in **no address at all**.
  Its only remaining job was choosing the directory a page was written into, and
  the only reason that mattered was Hugo's rule about what counts as a section —
  `writeSectionLandings`'s own docstring said both of its jobs "exist because of
  how Hugo decides what a section is". So the note format carried a filename
  convention, a landing rule, a routing function and a refusal in order to satisfy
  a rendering engine's directory semantics. #197 was the bill for that: `subType`
  did double duty — a genre for an ordinary `doc`, a URL section for a `README` —
  the two vocabularies collided, and it took #198, #200, #201 and a release to
  settle by widening one of them rather than by removing the overload.
  
  **A page that introduces the notes of a type is now an ordinary note**, named by
  convention and with no build path of its own: `type: doc`, `subType: reference`,
  `shortcode: <type>`, addressed `doc-<type>`. The package's own front page already
  worked this way (`homepage-root`, #182).
  
  | Surface                                | Before                                        | After                                             |
  | -------------------------------------- | --------------------------------------------- | ------------------------------------------------- |
  | A content page's file                  | `<mount>/<section>/<type>-<shortcode>.md`     | `<mount>/<type>-<shortcode>.md`                   |
  | A content page's `url:`                | `/<package>/<type>-<shortcode>/`              | **unchanged**                                     |
  | A `README.md` in the content tree      | its section's landing, addressed `<section>/` | an ordinary page, addressed `<type>-<shortcode>/` |
  | A `doc` with no `subType`              | refused — "no section"                        | published, at `doc-<shortcode>/`                  |
  | A `doc`'s `subType`                    | a genre, or a section address on a `README`   | a genre, closed to what the type declares         |
  | `packageAddress(fm, { isReadme })`     | branched on the filename                      | a pure function of the frontmatter                |
  | `sectionOf`                            | exported                                      | removed                                           |
  | `declaredSections`                     | exported, fed the lint                        | removed — it had no other reader                  |
  | `lintNote` / `lintFrontmatter` options | `landing`, `types`, `sections`                | removed                                           |
  
  **The closed-set check becomes meaningful again.** #206, released alongside this,
  put a retired-spelling warning and an address-charset error ahead of it in
  `checkSubType`; removing the section branch from underneath leaves three checks
  in one order — retired spelling, then charset, then the genres the type declares
  — with nothing widening the last of them. A `doc` note whose `subType` names a
  content type is refused again, `README` or not.
  
  **`site.sections` is not retired — it is now the whole of what a section is.**
  With no page filed into `<section>/`, nothing else makes
  `/<package>/<prefix><section>/` exist at all, so `writeSectionLandings` stays and
  its role changes from backfilling directories that pages created to _declaring_
  the Hugo sections a site wants. Two consequences follow for a consuming site:
  
  - **Declare every section the site links to.** A card, menu entry or breadcrumb
    pointing at an undeclared section is a 404.
  - **A section landing lists no child pages.** Its directory holds only its own
    `_index.md`, so a layout reading `.Pages` finds nothing; one that queries
    `site.RegularPages` by `Params.type` is unaffected, and that is the shape a
    content catalog wants anyway — it groups by what a page _is_, not by where its
    file happened to be written.
  
  **`publish.address.landing` is inert, and still accepted.** Both publishing
  consumers declare `landing: readme`, which stated something true when they wrote
  it; refusing it now would break them over a correct statement, and silently
  ignoring it would be worse. It selects nothing and is deleted once no
  configuration writes it — the third step, and a separate change. The retired
  `collection` value stays refused by name (#202).
  
  **Migration.** No note edit is required, and **no published URL moves** — an
  address never contained a section. What a consuming site must check is its
  layouts and its `site.sections`, per the two consequences above. Verified against
  `sohl`, `sohl-thalorna` and `sohl-kethira-basic` at `origin/main`: `lint`,
  `links`, `manifest` and `package compile` are byte-identical for all three (both
  link manifests and every compiled pack document), and `sohl`'s emitted site is
  byte-identical page for page, keyed by URL — all 1,606 addresses unchanged, 1,670
  of 1,671 files identical. The one difference is a backfilled `kb/macro/_index.md`
  that no longer exists, `macro` being the one section `sohl` did not declare;
  nothing in its site or the shared theme links it.

## 12.0.0

### Major Changes

- ab34b1c: Retire the `collection` landing rule, the `section:` frontmatter key it read,
  and the `collection` doc subtype that selected it (#202). A section is landed by
  the `README.md` in its directory, and that is now the only rule.
  
  **Why it goes.** Every publishing tree had already migrated: no note in `sohl`,
  `sohl-thalorna` or `sohl-kethira-basic` declares `section:` or writes
  `subType: collection`, and both publishing consumers configure `landing: readme`.
  What was left was not merely unused but **unimplemented on one of the two sides
  that must agree**. `engine/content-address.mjs` branched on the configured rule;
  `engine/site-build.mjs` never read it — it derives `isReadme` from the basename
  and treats a `README.md` as a landing whatever the configuration says. So under
  `landing: collection` the link manifest and the emitted site would have disagreed
  about where a page is, which is the single failure the shared address function
  exists to prevent. With one rule they agree by construction.
  
  **`landing: collection` is refused, not merely unrecognized.** Reported as a bad
  value it would read as a misspelling of the rule that survives, and an author
  would correct the value rather than learn that the mechanism is gone. The
  diagnostic names the key, says the rule is retired, says a section is landed by
  its `README.md`, and says the `section:` key went with it — located to the line
  and column in `package-build.config.yaml`, as every configuration finding is.
  
  **`section:` is refused the way `draft:`, `package:` and `aliases:` are.** It had
  exactly one reader — the retired branch — and no schema or vocabulary declared
  it, so nothing checked it: left in place it would be _ignored_, which reads to
  its author as though it still works. It is now reported by `content-build lint`
  and refused at compile, with the file, line and column.
  
  | Surface                          | Before                                | After                                  |
  | -------------------------------- | ------------------------------------- | -------------------------------------- |
  | `publish.address.landing`        | `readme` \| `collection`              | `readme` — the value is still accepted |
  | `section:` in a note             | read under `collection`, else ignored | refused, at lint and at compile        |
  | `subType: collection` on a `doc` | selected the rule                     | not a subtype the format declares      |
  | `LANDING_RULES`                  | `["readme", "collection"]`            | `["readme"]`                           |
  
  **Migration.** Delete `landing: collection` from `publish.address` — or write
  `landing: readme` — and make each section's landing the `README.md` in its
  directory. Delete any `section:` a note still carries. A repository that already
  configures `landing: readme` and writes no `section:` needs no change: `lint`,
  `links` and `site` were verified byte-identical against `sohl`, `sohl-thalorna`
  and `sohl-kethira-basic` at `origin/main`, including all 1,657 pages `sohl`
  emits.
  
  **`publish.address.landing` itself survives, for now.** It is the key both
  publishing consumers declare, and refusing a correct `landing: readme` would
  break them over a statement that is still true. With one rule it selects nothing,
  so it is a candidate for deletion once no configuration writes it — the third
  step `package:` took (#56), and a separate change.

### Minor Changes

- ed06be0: Hold `type` and `subType` to the address charset, and rename a `doc`'s
  `user-guide` subtype to `userguide` (#206).
  
  **The rule.** An address is `package-type-shortcode`, read back by counting
  hyphen-separated segments, and that is sound for exactly one reason: no segment
  may contain a hyphen. `ADDRESS_SEGMENT_PATTERN` (`^[A-Za-z0-9]+$`) stated it and
  `SHORTCODE_PATTERN` aliased it, but only a **shortcode** was checked against it.
  The other two values that reach an address were not: a `type` is the first
  segment of every address, and a `doc`'s `subType` is the section it routes to —
  a path segment of its own, and, under #204, a shortcode. Both are now held to
  the same constant, read rather than restated; a third spelling of one rule is how
  the disagreements found in #202 and #203 happened.
  
  **The diagnostic** is located where the value was written, in the standard form:
  
  ```text
  assets/content/Beings/Folk.md:3:1: error: `subType` "common-folk" is not an address segment — a subType is letters and digits only (^[A-Za-z0-9]+$), the same charset a shortcode is held to. …
  ```
  
  The charset is checked **ahead of** the closed-set check, which is what makes it
  reach a type whose `subTypes` are declared but not yet enumerated (`being`) —
  values nothing may otherwise claim to check.
  
  **`user-guide` became `userguide`**, the one declared value that broke the rule
  and the only hyphenated `type` or `subType` in the vocabulary. A hyphenated
  declaration can no longer be imported at all: the registry is checked against the
  charset as `engine/note-vocabulary.mjs` loads.
  
  **The old spelling is accepted for one release, and says so.** A `doc` written
  `subType: user-guide` is reported as a **warning** naming the note, the retired
  value and its replacement, and the note still compiles:
  
  ```text
  User_Guide/Actions.md:3:1: warning: `subType` "user-guide" is a retired spelling of "userguide" on a doc; write "userguide". …
  ```
  
  _The ordering is the reverse of the usual, deliberately._ For a retired field the
  sweep goes first; here it must go last. 43 `sohl` notes author `user-guide`
  today, and declaring only the new spelling would invalidate all 43 with a release
  they had no chance to sweep ahead of. So the acceptance ships first, consumers
  rename, and a later change removes the acceptance — at which point the old
  spelling falls through to the ordinary undeclared-value error with no code left
  to remove. That later change is the breaking one; this one breaks nothing, which
  is why it is a minor.
  
  **`type` gets no transitional path**, deliberately: no note in `sohl`,
  `sohl-thalorna` or `sohl-kethira-basic` authors a hyphenated type, so an
  acceptance would be dead code guarding a case that does not exist. Measured
  against a pristine `origin/main` extraction of each tree, the only hyphenated
  value of either key anywhere is the 43 `user-guide` notes.

## 11.1.0

### Minor Changes

- 8906d7a: **A `README` landing's `subType` is checked against the sections the repository declares, not the genre list.**
  
  Two vocabularies were spelled with one key. For every note, `subType` is a
  sub-kind of its type, checked against a closed list. For a `README` under
  `publish.address.landing: readme` it is additionally the **URL section** —
  `sectionOf` reads a `doc`'s `subType` as the segment the landing addresses — and
  that is an open set the consuming repository names in `site.sections` /
  `site.readmeSections`. `engine/frontmatter-lint.mjs` applied the closed reading
  while `engine/content-address.mjs` applied the open one, so the two halves of the
  toolchain disagreed about the same note: `content-build site` addressed and
  published `Weapons/README.md` at `weapongear/`, and `content-build lint` refused
  it because `doc` declares only `rules`, `user-guide` and `reference`. An item
  section's landing was not expressible.
  
  The check now widens **for a landing only**, and only under `landing: readme`: a
  `README` whose `subType` is its section may name any section the repository
  declares, as well as any of its type's own genres — a genre is a section a `doc`
  tree publishes under whether or not the repository describes it, so narrowing to
  the configured set alone would refuse a correct `README`. An ordinary note's
  `subType` stays closed to its type's genres, unchanged.
  
  **The guard survives**, checked against the set that actually decides where the
  page goes:
  
  ```text
  Weapons/README.md:4:1: error: `subType` "weapongeer" is the section this README
  lands at, and nothing declares it: it is neither a section this repository
  configures under `site.sections` / `site.readmeSections` (rules, user-guide,
  weapongear, …) nor one of the subtypes doc declares (rules, user-guide,
  reference). Did you mean "weapongear"?
  ```
  
  Whether the value is an address is asked of `sectionOf` rather than by naming a
  type, so the linter still knows no type names of its own; the section list is
  read from the resolved configuration the site build renders those landings from,
  through a new `declaredSections(config)`, so neither can name a section the other
  does not.
  
  _Minor rather than patch_: `lintNote` and `lintFrontmatter` take two new
  options (`landing`, `sections`) and `content-config.mjs` exports
  `declaredSections`. Both options default to today's behaviour, so a caller that
  passes neither — and a repository that declares no sections — is unaffected.
  
  Closes #197

### Patch Changes

- 68910b6: **A `README` landing may name any section that exists, not only a configured one.**
  
  #197 widened a landing's `subType` check by one term and it was the wrong one:
  the sections the repository configures in `site.sections` /
  `site.readmeSections`. That keys on configuration a consumer may legitimately not
  have. `sohl-thalorna` has **no `site:` block at all** — it renders its site
  through a local fork of the emitter — so `declaredSections` answered `[]`, the
  accepted set collapsed back to the three `doc` genres, and five of its landings
  were still refused for naming their own content type:
  
  ```text
  assets/content/Characters/README.md:7:1: error: `subType` "being" is not one of the subtypes doc declares (rules, user-guide, reference)
  ```
  
  A landing's `subType` is an **address**, so it is now checked against the
  addresses that exist — the range of `sectionOf` over every note the format
  permits, plus whatever the repository names:
  
  1. **Every content type the specification declares.** `sectionOf` returns
     `fm.type` for a non-`doc` note, so `being`, `lore`, `scenario` and
     `weapongear` are sections _by construction_, configured or not.
  2. **The type's own subtypes** — `rules`, `user-guide`, `reference`.
  3. **The configured sections**, which may name one that is neither: `sohl` has
     `credits` and `dev-docs`.
  
  **The guard survives.** A misspelling is in none of the three, so it still fails,
  and the near miss is drawn from the whole union. What is deliberately no longer
  caught is a landing for a section that exists but is currently empty — which is
  legitimate, and is why the set is the types the format _declares_ rather than
  those _present in the tree_: `sohl` ships two such landings above tables that
  stay empty until the first note of each type does.
  
  **The type list is the specification's, not the schema map's.** `NOTE_SCHEMAS`
  declares 18 types and `docs/content-format.md` declares 23; `lore`, `place`,
  `scenario`, `vehicle` and `armorlocation` are in the second only. Checking an
  address against the schema map would refuse `Lore/README.md` for a reason that
  is not about addresses, and would report one gap twice in two vocabularies.
  Whether a note's fields can be checked is a different question, answered
  elsewhere and reported on the notes themselves.
  
  `lintNote` / `lintFrontmatter` take a `types` option beside `sections`; both
  default to empty, so a caller that passes neither is unaffected.
  
  Closes #200

## 11.0.0

### Major Changes

- 51f9b4f: **The package homepage becomes an ordinary addressed note** (#182).
  
  A homepage declares a `shortcode` — conventionally `root` — and publishes at
  its address, `/<package>/homepage-root/`, written by the same rule as every
  other page. `[[homepage-root|Read the introduction]]` is an ordinary wikilink
  now, resolving to the page the build actually writes.
  
  **Why it was the exception, and why it is not one any more.** A page's URL used
  to derive from `name.full` while a homepage's destination was fixed at
  `_index.md`, so a `shortcode` on one put the note in the address index and
  `[[homepage-<shortcode>]]` resolved _green_ to a page nothing wrote. That is
  what `HOMEPAGE_REFUSED_FIELDS` refused, and the reason was entirely an artifact
  of name-derived URLs. #181 removed the premise: the address a `shortcode`
  computes is the address the build publishes.
  
  **Breaking, two ways.**
  
  - **Every homepage note must now declare a `shortcode`.** Without one the note
    has no address, and both `content-build lint` and `content-build site` refuse
    it, located at the `type:` value that makes it necessary. All six trees need
    the same one-line edit: `shortcode: root`.
  - **The landing moves** from `/<package>/` to `/<package>/homepage-root/`.
    `/<package>/` becomes a `301` the package authors in its own `_redirects`,
    with a pinned `Cache-Control: max-age=3600` in `_headers` — Cloudflare Pages
    sets no `Cache-Control` on a redirect it generates, and an unpinned 301 is
    cacheable indefinitely under RFC 9111. See `CONTENT.md`.
  
  | Field       | Was     | Now                                          |
  | ----------- | ------- | -------------------------------------------- |
  | `shortcode` | refused | **required**                                 |
  | `name`      | refused | permitted, like any other note's             |
  | `id`        | refused | refused — a homepage compiles to no document |
  
  `id` is unaffected because its reason is: a homepage appears in no pack, and it
  stays out of the **link manifest** for the same reason, now that a shortcode
  alone would put it in.
  
  **What is deleted.** `HOMEPAGE_DESTINATION`, and the comment describing the
  homepage as "the one page for which neither addressing rule holds" — it no
  longer is. `homepageDestination(fm)` replaces the constant, and
  `homepageFrontmatter` takes a `base` so the emitted page can state its `url`.
  
  **Singularity is now stated as a cardinality rule.** It used to rest on the
  fixed destination every homepage shared — the second silently overwrote the
  first — so the address rule enforced it as a side effect. Two homepages publish
  two pages now and collide over nothing, so `checkHomepageCount` says what it
  means: a package has one front page, and nothing here can decide which of two
  `/<package>/` should redirect to.
- 6291dec: **A published page's URL is its address, not its display name** (#181).
  
  Every content page now serves at `/<package>/<type>-<shortcode>/`. `(type,
  shortcode)` names one note within a package — the rule `content-build lint`
  already enforces — so the URL is unique _by construction_: there is no
  collision check behind it, and renaming a note moves no URL, because no part of
  the address comes from a display string.
  
  **Every published URL moves**, which is what makes this a major. `sohl`'s
  `/sohl/kb/rules/shock/` becomes `/sohl/doc-shock/`; `thalorna`'s
  `/thalorna/affiliation/the-aerarium-imperii/` becomes
  `/thalorna/affiliation-aerarium/`. Measured across the three live trees: 1,595
  `sohl` pages, 1,848 `thalorna`, 370 `kethira` — every one of them unique, and no
  content edit required in any repository.
  
  **What it replaces.** The URL derived from `name.full`, which made a display
  name load-bearing three ways at once: a rename silently 404'd every inbound
  link, two notes in one section could derive one URL so a uniqueness gate had to
  run, and long names were shortened through a table of 200 abbreviations. The
  module doing it justified the cost by promising redirects — _"every change
  appends to the legacy-URL map"_ — and no such map was ever written, here or in
  any consumer. An address needs none of it.
  
  **Sections stay, as directories.** Hugo derives a page's section from where its
  file is written, not from its URL, and that section is what supplies the section
  landing pages, `.CurrentSection` and per-section layout lookup. So a page is
  still written into `<section>/` and now carries a front-matter `url:` publishing
  it at its address. A **landing page** is the one exception: it _is_ its section,
  so it still addresses the section under the configured `publish.address.prefix`
  (`kb/rules/`), which is why an entry's `path` is still written to the manifest
  rather than left for a consumer to compute.
  
  **The `type-` prefix is deliberate.** Flattening to `<shortcode>` would put
  content in the same namespace as a package's fixed mounts — `/<package>/` for
  the landing page, `/<package>/api/` for generated API docs — neither of which
  contains a hyphen or names a type. With it the namespace is provably disjoint.
  
  **Removed**
  
  | Gone                                            | Why                                          |
  | ----------------------------------------------- | -------------------------------------------- |
  | `contentSlug`                                   | Nothing derives a URL from a name.           |
  | `findSlugCollisions`, and the site build's gate | Two addresses cannot collide.                |
  | `ABBREVIATIONS` / `abbreviateTokens`            | They only ever shortened a name-derived URL. |
  
  `slugify` stays, unchanged and un-abbreviated, in the two places it was always
  right for: heading anchors and pack filenames.
  
  **Breaking, for a consumer calling the engine directly**
  
  - `packageAddress(fm, name, options)` → `packageAddress(fm, options)`, and
    `contentAddress(fm, name, isReadme)` → `contentAddress(fm, isReadme)`. The
    name was the input the address no longer has.
  - `addressSlug(fm)` is new: the `type-shortcode` segment, lowercased, so it is
    exactly the tail of the canonical key.
  - The site build's gate result renames `slugErrors` to `addressErrors` and drops
    `collisions` entirely. A note with no `shortcode`, or no section to be filed
    under, is reported there rather than published.
  - `engine/abbreviations.mjs` is deleted.
- a9fb0fc: **Retire the bare `[[Alias]]` wikilink form and the alias index** (#180, resolving #179).
  
  Every wikilink is now an **address**, and every wikilink carries a **label**. The
  pipe no longer selects between two namespaces — there is only one — so a link
  written without one addresses nothing and is a finding wherever it is met:
  `content-build links` fails on it, the pack compilers fail the note, and the site
  resolver reports it. The correction is always the same, and the message says so:
  write `[[type-shortcode|Text]]`. `[[#slug|Text]]` still resolves; the link part
  may be an anchor, it is the label that is required.
  
  **Why.** The alias namespace was empty in practice. Across 8,305 wikilinks in the
  three content trees, **not one** bare `[[Alias]]` resolved to a note. What the
  index behind it did do was fold every note's `name.full` into itself, so two
  notes of one type could not share a display name — five `doc` notes in the `sohl`
  tree collided, and every available fix moved a published URL (#179). The rule had
  never prevented a broken link; it had only ever forbidden a name.
  
  **The top-level `aliases:` is a retired field.** It fed nothing else, so it is
  now **refused** naming the file and the line, the same way `draft:` and
  `package:` are, and reported by the frontmatter lint as well as at compile.
  
  **`name.aliases` is kept, and is read by nothing.** It fed the same index and
  lost the same reader, but it is **reserved** — held for a use that does not
  exist yet — so it is deliberately neither retired nor consulted. No index folds
  it in, no rule validates it, nothing derives a name, address or URL from it, and
  the refusal above never mentions it. A note carrying one compiles, resolves and
  addresses exactly as the same note without it, and `tests/name-aliases-reserved.test.ts`
  pins that equivalence across the pack compile, both wikilink resolvers, the link
  manifest and the site index, so a reader cannot be reintroduced unnoticed.
  
  **Removed.** `engine/alias-index.mjs` in its entirety — `aliasesOf`, `aliasKey`,
  `indexAliases`, and the `engine.aliasIndex` namespace export — along with
  `resolvesAsAddress` from `engine/wikilink-syntax.mjs`, replaced by
  `unlabelledLinkMessage`, which is the one place that states the rule for both
  builds.
  
  **API changes** for anything importing the engine directly:
  
  | was                                                    | now                            |
  | ------------------------------------------------------ | ------------------------------ |
  | `index.resolve(note, target, labelled)`                | `index.resolve(target)`        |
  | `index.resolveAlias`, `aliasClaims`, `aliasCollisions` | gone                           |
  | `auditLinks().deadAliases` / `.aliasCollisions`        | `auditLinks().unlabelledLinks` |
  | `buildWikilinkIndex().byAlias` / `.aliasClaims`        | gone                           |
  | `buildSiteIndex().typeAlias` / `.typeCollide`          | gone                           |
  | `wikiContext()`'s `typeAlias` / `typeCollide`          | gone                           |
  
  `buildSiteIndex` no longer indexes a page by its **name**, filename or bare slug
  — those were the collision-aware fallbacks the bare form was looked up in, and
  nothing consults them now. `ambiguous` / `collide` becomes the set of short
  `type/shortcode` addresses two **foreign packages** both publish, which the web
  resolver now reports as ambiguous rather than as merely broken.
  
  **Consumer impact, measured.** Every tree needs a mechanical frontmatter sweep
  of the **top-level** field, which is authored almost everywhere: 1,609 notes in
  `sohl`, 1,850 in `thalorna`, 370 in `kethira`. A `name.aliases:` is left exactly
  where it is — the sweep must delete the top-level list only. Links are cheaper — `sohl` has **0** unlabelled
  links and `kethira` has none at all; `thalorna` carries 70 (68 bare links and 2
  pipe-less anchors), which is content work in its own repository. The five `sohl`
  alias collisions and `thalorna`'s thirteen cease to exist with no note renamed
  and no published URL moved.
- ffb1b04: **An address that resolves to no note fails every build** (#184).
  
  A wikilink whose address names no document was a **warning** in `content-build
  links`, a **failure** in the pack compilers, and — in the site build — _nothing
  at all_ while any linkable package had no vendored manifest. One authored link,
  three verdicts. This makes it an error everywhere, and makes the three resolvers
  name and word every class of link failure identically.
  
  **Why the tolerance is spent.** It existed because a bare `[[Sunless Vault]]`
  might be a worldbuilding placeholder for a note nobody had written. That was a
  property of the bare form, which #180 retired, and the intent behind it now has
  a real spelling: a note tagged `draft` exists, resolves, compiles, publishes,
  and renders its inbound links marked (#183). An address naming no note is a typo
  or an omission, and both want fixing.
  
  **One vocabulary, one message.** `engine/wikilink-syntax.mjs` — which already
  held the syntax the three resolvers share — now also holds the closed set of
  failure classes (`LINK_FINDING_REASONS`) and the message each reports through
  (`linkFindingMessage`, `unresolvedAddressMessage`, `ambiguousAddressMessage`).
  An author meets whichever build ran first, and a consumer switching on a
  `reason` should not be switching on which build produced it.
  
  | finding          | checker | pack build | site build |
  | ---------------- | ------- | ---------- | ---------- |
  | `unlabelled`     | error   | error      | error      |
  | `not-an-address` | error   | error      | error      |
  | `unknown-type`   | error   | error      | error      |
  | `unresolved`     | error   | error      | **error**  |
  | `ambiguous`      | error   | error      | error      |
  
  **Breaking changes.**
  
  - _The site build fails an unresolved address unconditionally._
    `wikiContext()` no longer takes `manifestsComplete`, and `resolveWebWikilinks`
    ignores one on the context. A missing manifest is now advice inside the
    message rather than a reason to let the link through.
  - _Two reason strings were renamed into the shared vocabulary._ The pack
    build's `"unknown"` and the site build's `"broken type/shortcode"` are both
    `"unresolved"`. A slash-qualified target naming no known type reports as
    `"unknown-type"` on the site build too, matching the checker.
  - _`ambiguous` is a class in all three._ An address more than one package
    publishes was reported by the checker and the pack build as though nothing
    published it. The finding carries the claiming `packages`, and the message
    names them.
  - _Site-build wikilink findings are compiler-parseable._ They were
    `log.error("bad wikilink [[x]]: reason  (file)")` — a `loglevel` timestamp
    sitting exactly where a parser reads the path from. They are now
    `file:line:column: error: message`, located by the authored link's own
    position in the source note, like every other diagnostic.
  - _Pack-build failure messages are reworded_ by the shared table, and name the
    address rather than the whole authored link.
  
  **Consumer impact: none measured.** Across the three content trees — `sohl`
  (1,607 notes / 3,618 links), `thalorna` (1,849 / 7,913) and `kethira` (371 / 0)
  — the promotion produces **zero** new findings. `thalorna`'s 66 dead addresses
  are all `not-an-address`, which was already an error, and its 70 unlabelled
  links are #180's. No tree carries an address that resolves nowhere.

### Minor Changes

- ba51273: Mark a link whose target is tagged `draft` (#183).
  
  A note that exists only so a link is not dead is now visibly distinct from one
  that is written. Both builds wrap such a link in
  `<span class="sohl-draft-link" title="Draft — not yet written">…</span>` —
  byte-identically, as `unresolvedLink` already does, so one authored link carries
  the same cue in a compiled journal and on the website. The link inside is
  untouched: Foundry enriches inside HTML and Goldmark parses markdown inside an
  inline span, so it is still a live link either way.
  
  **The note stays in the graph.** This marks at presentation and nothing else.
  Resolution, validation, pack compilation and manifest membership are unchanged
  for a draft note, which is what separates the tag from the retired `draft:`
  field — that field moved a note from _published_ to unresolvable without saying
  so, and suppressed the build failures the note carried. Nothing here reinstates
  any of it, and declaring the field is still refused by name.
  
  **Read from the tag vocabulary, not respelt.** `draft` is declared in
  `DECLARED_TAGS.state` (#172) and exported as `DRAFT_TAG`, with `isDraftNote()`
  as its one reader — so the declared tag and the thing that acts on it cannot
  drift apart. This is the first thing in either build to read `tags`.
  
  **For consumers.** The class carries no appearance of its own. A Foundry system
  supplies it in an SCSS partial beside `_unresolved-link.scss`; a site supplies
  it in its theme. Until one does, a draft link renders exactly as it did before.

### Patch Changes

- 743b303: **`collectContentPages` refuses a missing `base` instead of publishing to `undefined/`.**
  
  A page's URL is built as `` `${ctx.base}${slug}/` `` since _a page URL is its
  address_ (#181). When `base` was absent the template still ran, so every
  non-landing page in that build published at `undefineddoc-<shortcode>/` with no
  diagnostic. The function already guards the section immediately below, on the
  stated grounds that a note with none "is reported rather than written to
  `undefined/`" — the same reasoning applies to `base`, which affects _every_ page
  rather than one.
  
  It is a caller contract rather than a note defect, so it throws rather than being
  collected as a finding.
  
  Fixes the two in-repo callers that still supplied the pre-#181 options and had
  gone unnoticed: the end-to-end draft-link case (#183) and a homepage case, whose
  combination with #181 left `main` red — neither pull request failed alone.
  
  Closes #195

## 10.0.1

### Patch Changes

- 5bc08b6: **A frontmatter reference resolves as an address, never as an alias.**
  
  The resolver's third argument chooses the namespace and has no fallback (#131,
  #144). The frontmatter lint's `ref:` check omitted it, so every reference was
  looked up as an _alias_ — and `type-shortcode` is never an alias, so every
  value a `ref:` field carried was reported as naming a note nothing declares:
  
  ```
  Spirit.md:7:60: error: `sohl.assocSkillCode` names skill "spirit", and no note
    or vendored manifest declares it
  ```
  
  The skill existed, in the same tree, with exactly that shortcode.
  
  A frontmatter reference is a bare address by construction — there is no pipe to
  read intent from, and the field supplies the type — so the check now says so.
  
  The suite stayed green because its index stub ignored the argument and resolved
  whatever it was handed. It no longer does, which is the part that keeps this
  fixed.
  
  Closes #176

## 10.0.0

### Major Changes

- 7f5c14b: **The pipe decides how a wikilink resolves** (#131). `[[x]]` is an **alias**;
  `[[x|…]]` is an **address**. Neither falls back to the other, so a target is
  read by the punctuation the author wrote rather than by whether its shape
  happens to look like an address.
  
  Both resolvers previously tried the address grammar and fell through to the
  alias index — or the reverse — so one authored link had two chances to land and
  the author could not say which they meant. A note whose _name_ looked like an
  address (`Grukar-ahk`) was read as one, and a genuine address that resolved
  nowhere silently became a name lookup and reported nothing.
  
  **What changes for a content tree**
  
  | Written                    | Was                              | Now                                      |
  | -------------------------- | -------------------------------- | ---------------------------------------- |
  | `[[type-shortcode\|Text]]` | address                          | address — _unchanged_                    |
  | `[[type-shortcode\|]]`     | address, shows the target's name | _unchanged_                              |
  | `[[Some Name]]`            | alias                            | alias — _unchanged_                      |
  | `[[type-shortcode]]`       | address                          | **alias lookup**, so it must gain a `\|` |
  | `[[Some Name\|Text]]`      | alias                            | **address**, so the name must become one |
  
  An empty label stays writable and now carries its full weight: `[[x|]]` is the
  one way to write an address that renders the target's _current_ name, so a
  rename shows at every citation with no link edited.
  
  **The alias index no longer carries the filename.** Its sources are the
  authored ones — `aliases`, `name.aliases`, `name.full`. `basename(file, ".md")`
  with underscores turned to spaces admitted keys nobody could cite: thirteen
  `_Introduction.md` notes all claimed `" introduction"`, leading space included.
  Measured across five content trees, not one link that resolves today resolves
  through the filename alone.
  
  **A same-type alias collision is now a finding, naming every claimant.** It was
  silently deleted, so the pair resolved to nothing and nobody was told. The
  finding is reported at each claiming note, never at the note that merely cites
  the alias — whoever added the second claimant broke every existing citation.
  
  **The two failure modes read differently.** A piped target that resolves
  nowhere, or does not parse as an address at all, is an **error**: the pipe says
  the author meant an address. An unpiped target naming no note of the source's
  type is a **warning**, since a bare `[[Name]]` may be a worldbuilding
  placeholder for a note not yet written.
  
  Resolution is stated once for both builds: `resolvesAsAddress` in
  `engine/wikilink-syntax.mjs`, and the new `engine/alias-index.mjs` for what may
  be claimed and how a claim is keyed.

### Minor Changes

- 3e6f3a4: Give an affiliation the ranks and offices it confers, settle the
  `government`/`governance` split on one root, and stop the mapping table claiming
  system fields for things that reach none (#160).
  
  **An affiliation now publishes its own social structure.** `governance.ranks` is
  the ladder the body confers — `level`, `title`, `description` per rung — and
  `governance.offices` is a map of named post to what that post does. Level 0 is
  reserved for the excluded: outlawed, expelled, excommunicated is a standing an
  organisation still recognises, so it still has to define it.
  
  The reason to put them here rather than on a membership is that a bare `level: 4`
  says nothing on its own. It means _Knight_ only because the polity declared that
  rung, so the ladder is authored once, on the body that confers it, and a member's
  rank is an index into it. Offices are not ranked at all — a Chancellor and a
  Marshal are both great officers and neither is above the other — so an office is a
  key with a description rather than a rung.
  
  **The membership fields leave `data:`.** `society`, `office`, `title` and `level`
  described a being's standing in a body, not the body, and all 199 authored
  affiliation notes left them null. They are filled on the affiliation _as embedded
  on a being_, which is where they always belonged.
  
  **One root: `governance`.** The specification mixed `governance.model` with
  `government.summary` and `engine/note-vocabulary.mjs` declared exactly that pair,
  with a comment saying the two had to be reconciled somewhere else. They are
  reconciled here, on `governance` — the root that names the concept rather than
  the institution, and the one the new `ranks` and `offices` read naturally under.
  
  **`Republic` joins `GovernanceModel`, and the three civic models are given a
  test.** A Roman-shaped republic was none of the existing values exactly: not an
  `Oligarchy`, whose closed group holds authority with no election and no term; not
  a `Democracy`, where any member may hold office. Ask who fills the offices and on
  what terms and the three separate cleanly, which the enum now says. Naming it
  `Republic` rather than `Senatorial Oligarchy` keeps the enum a partition of
  one-word answers to _where does authority rest_ — "senatorial" is a culture's word
  for its ruling order, and culture words belong in a body's rank titles, not in the
  shared vocabulary every culture is described with.
  
  **Two renames and a new field.** `domain` becomes `domains`, which is what a list
  of places wants to be called; `languages` becomes `commonSkills`, since what
  members share is not only speech; and `economy` is new — the currencies, banking
  bodies and goods an affiliation's economic life runs on, as wikilinks rather than
  prose.
  
  **The mapping table stops overclaiming.** `governance` reaches no `system.*`
  field: SoHL's affiliation item has nowhere to put ranks or offices, and inventing
  a mapping for a field no schema declares is the drift these tables exist to
  catch. The four membership rows go with the fields, leaving 84 mapping claims and
  66 checked against SoHL's published schema.
  
  **`mystery` accepts `birthsign`**, which the specification declares and the
  vocabulary did not, and the four gear headings are spelled as the vocabulary
  enforces them — `armorgear`, `concoctiongear`, `projectilegear`, `weapongear` —
  rather than as #78 will rename them.
- 1c4517f: Let an affiliation cite any lore, and declare its epithet and its symbol (#166).
  
  **`peoples` becomes `lore`**, as it did on `place` in #164 and for the same
  reason: peoples are one kind of lore among many, and the target's own subType
  already distinguishes a `folk` from a `law` or a `calendar`.
  
  **The case that made it urgent is the deity.** A `faithtradition` is a religion —
  a practice, which can outlive belief in its god, and one god may be venerated by
  several religions that agree on nothing else. The god is `lore` of subType
  `deity`. With only `peoples` available a faith had nowhere to name the god it
  venerates, and the authored corpus worked around it with an undeclared top-level
  `deity` string on 75 notes: a name nothing could follow.
  
  **`epithet` and `symbol` are declared.** Seventy-seven affiliations carried them
  at the top level, where nothing checked them and nothing compiled them. Neither
  is a faith's alone — they are what the members call the thing and what they carve,
  so a guild has them as much as a cult does. What a god _is_ belongs on the deity
  note, where every religion that venerates it can point at one account.
  
  **A rank names the standing it is.** `Rank` gains `lore`, a link to a `lore` note
  of subType `law`, and the note is **shared**: a Normen kingdom calls it `Thrall`
  and a Vylarian province calls it `Slave`, and they mean one thing — owned
  outright, with no standing at law except through an owner. The title is what this
  body calls it and the description is how this body puts it, but the obligations
  and rights belong to the standing, so they are written once and cited by every
  ladder that confers them. In the authored corpus 237 distinct titles across 2,602
  rank entries resolve onto 43 standings, which is also what makes a rank
  answerable across bodies: asking what a `Naukrátissa` may do no longer means
  reading the Bethûan fleet's ladder.
  
  **A being cites lore too.** Its `peoples` becomes `lore` for the same reason
  `place` and `affiliation` did: the people a character is of, the standing they
  hold and the law they live under are all lore, and the target's own subType tells
  a `culture` from a `law`. A being that names its culture and its rank in one list
  is saying two things of one kind, which is what the field is for.
- 65a4ba1: **Affiliation subTypes: `spirittradition` added, `pantheon` removed.**
  
  A totemic or ancestor cult had nowhere to go. `faithtradition` is defined as
  concerning _the divine_, and `sohl-thalorna` carries 47 affiliations that are
  not — 44 animal totems plus `Nyaluba_Spirits`, `The_Kindred` and `Astrokyklos`.
  Folding them into `faithtradition` would also have collapsed the partition
  `MYSTICALABILITY_SUBTYPE` distinguishes the spirit families by, and a picker
  filter is only as useful as the partition it filters on. `spirittradition` is
  worded symmetrically with its two siblings.
  
  `pantheon` is gone because it answered a different question from every other
  value. The rest state _what kind of body this is_; `pantheon` stated _where it
  sits in a hierarchy_. A pantheon is a `faithtradition` carrying subordinate
  faith traditions, and that hierarchy is already authored — 77 divine
  affiliations carry a `pantheon:` key holding an affiliation shortcode which
  resolves on all 77, while `parents` is set on none of them.
  
  **No content changes.** None of the eleven values is authored anywhere yet, so
  removing one and adding another costs no note an edit.
  
  Closes #157.
- 20e51a7: Write a document's archetype to `system.archetype` instead of `flags.sohl.docArchetype` (part of #126, part of #127).
  
  **Requires an unreleased SoHL.** This must not ship before HeroicLands/Song-of-Heroic-Lands-FoundryVTT#1780 declares `system.archetype` on SoHL's shared data schema and that release is out. Foundry discards an undeclared `system` key at construction without a word, so a package built with this against an older system carries an archetype nothing can read. The order is: the field, then this, then rebuild.
  
  **What changed.** `sohl/items.mjs` and `sohl/actors.mjs` stop calling `withArchetypeFlag` and write the value into `system` — a number for an archetype at that priority, `null` for a document that is not one. `flags` becomes a plain passthrough of what the note authors, defaulting to `{}` exactly as before. `withArchetypeFlag` is deleted; `resolveArchetype` stays, and so does its required-ness, so an absent `archetype` is still an authoring error rather than a silent "not an archetype".
  
  `engine/helpers.mjs` gains `systemArchetype`, which is where `resolveArchetype`'s `undefined` becomes the field's `null`. That conversion has to be somewhere: an emitted `undefined` is dropped by `JSON.stringify`, which would leave the compiled document with no `archetype` at all and a tri-state readable as two.
  
  **The falsy trap, held by tests.** `0` means "is an archetype, at priority 0" — the priority SoHL's own archetypes ship at — while `null` means "is not one". `resolveArchetype(fm) || null` passes every other case and turns 1,470 SoHL documents from archetypes into non-archetypes, so the suite asserts `0` through the builder and through a `JSON` round trip.
  
  **Compiled output moves, and this is the one change in this stack where it should.** Characterised document by document across three trees, every difference is a `flags.sohl.docArchetype` disappearing and a `system.archetype` appearing with the identical value, plus the now-empty `flags: {}` that the removed flag leaves behind. No `_id` and no `_key` moves anywhere.
  
  Counts, with the last four columns the value each **top-level** document carries (embedded items carry it too, as they carried the flag):
  
  | tree                 | compiled | changed | `0`   | `1` | `100` | `null` |
  | -------------------- | -------- | ------- | ----- | --- | ----- | ------ |
  | `sohl`               | 3,126    | 1,474   | 1,470 | 1   | —     | 3      |
  | `sohl-thalorna`      | 2,561    | 1,273   | 157   | —   | —     | 1,116  |
  | `sohl-kethira-basic` | 385      | 363     | 343   | 10  | 10    | —      |
  
  **One diagnostic moves.** Seven `sohl-thalorna` affiliation notes that already fail to compile now report the missing `archetype` rather than a folder id or a missing `subType`, because the requirement is checked earlier in `buildEntry` than the flag it replaces. Same files, same count, same severity; every other finding in all three trees is unchanged, message for message.
  
  **Neither schema check has anything to say about it**, before or after the field is declared. `compareFields` derives what a builder emits from its `itemBuilders` field declarations, and `archetype` is written by the compiler itself — as `shortcode`, `actionDefs`, `notes` and `docHtml` already are — while the note-side check reads only what a note authors under `<system>.system`, and `archetype` is authored at the block's top level. So the ordering constraint above binds at Foundry's silent discard, not at a check that would catch it; the suite records that, so nobody reads the quiet as coverage.
- 6f59add: Declare `lore` subType `bestiary` and `doc` subType `collection` (#162).
  
  **A creature that is not a people had nowhere to go.** `folk` is _related sapient
  beings — kindreds, ancestries_, and `spirit` is the non-divine numinous; a beast
  is neither. `bestiary` is what `folk` is for the sapient, applied to everything
  else — including the made things that were never born.
  
  **A note that indexes other notes had nowhere either.** A roster, a table of
  settlements, an index of languages is not `rules`, not `user-guide`, and not
  `reference` — and the distinction is where the content comes from. A reference
  **states** facts of its own; a collection **derives** them from the tree, almost
  always through a query. The author's test is whether the page would still say
  anything if every other note vanished. `reference`'s own description drops
  "indexes" accordingly.
  
  **The value earns its keep by making a silent failure nameable.** A collection
  whose query matches nothing renders a header and no rows, which looks exactly
  like a full table until it is read — and `sohl-thalorna` has thirteen in that
  state right now, having filtered on a frontmatter key its content format no
  longer has. Nothing failed and nothing reported it. A checker can only say so
  about a note class it can name.
- 103c307: Check the `system` keys a compiler writes itself against the receiving DataModel (closes #155, part of #127).
  
  **What a consumer sees.** A compile can now fail with a line naming one of its
  notes:
  
  ```
  assets/content/Skills/Social/Charm.md: error: the compiler writes `system.archetype` into every Item of subtype "skill", and no field declaration names it — Item subtype "skill" does not define it at 0.8.2, and Foundry discards an unknown `system` key when the document is constructed, without a warning, so the value is lost at load while the build reports success. No `itemBuilders` change fixes this: declare the field in the receiving system, or hold this package at a build that does not write it
  ```
  
  It means the build is running **ahead of the system it compiles for**. Nothing
  in the repository's own configuration writes the key, so nothing there can stop
  it; the two real fixes are the ones the message names. For `archetype`
  specifically that is HeroicLands/Song-of-Heroic-Lands-FoundryVTT#1785 — SoHL
  checks against its **own** committed `schema.json`, so merging it is enough and
  no release is needed; a module checks against the cached schema of the SoHL
  release it pins, so it needs that release.
  
  **The gap.** The emitted-versus-declared check (#60) derives what a build emits
  from the `itemBuilders` **field declarations**, so a key a compiler writes on its
  own initiative is in neither set it compares and was never compared at all.
  That is not a residue: it is `shortcode`, `actionDefs`, `notes`, `docHtml`, and
  since #126 `archetype`. #145's authored-`system` check does not reach them
  either — it reads `<system>.system`, and these are written rather than authored.
  So #126's ordering constraint, stated in the issue and real, was enforced by
  nothing: get the order wrong and every compiled document silently loses
  `system.archetype`, no check fires, the build is green, and the Create dialog
  simply stops finding archetypes.
  
  **Derived by observation, not by a list.** The compilers assemble a `system`
  object, so `compareEmittedSystem` reads the keys off what they produced — after
  the JSON round trip the pack file actually receives, which is why a key whose
  value is `undefined` is correctly not a finding. A compiler that grows a key is
  covered on the next build without anyone remembering to add it anywhere, and a
  `system` block that is checked is the one that was written.
  
  **Two conditions, because the fixes differ.** Both name the version, as the
  existing message already does. A key a `fields:` entry declares is the
  consumer's own — change the field's `to`, or get the system to declare it. A key
  the compiler writes has no declaration to correct, and the message says so
  rather than sending a reader looking through `itemBuilders` for something that
  is not there.
  
  **An error, deliberately.** The failure is Foundry's silent discard either way,
  and the sibling condition has been an error since #60; making the _less_ fixable
  half the quieter one would invert the point. Measured read-only against five
  consuming trees, the whole cost is 11 findings in
  `Song-of-Heroic-Lands-FoundryVTT` — one `archetype` per subtype, exactly what
  #1785 declares. The satellites are unaffected today: sohl 0.8.2 published no
  `schema.json`, so there is nothing for them to check against and the check stays
  silent, and by the time they pin a release that publishes one the field is in
  it.
  
  **A subtree the schema describes no further is not checked.** SoHL's
  `strikeMode` is a discriminated `TypedSchemaField`: published as one path,
  stored flat as `{ type, name, … }`. Walking into it against a schema that
  enumerates nothing beneath it reported all ten of a combat technique's stored
  keys — ten findings, every one wrong, about a document that is correct. What the
  artifact does not describe is left alone, the same stance the check already takes
  on a subtype the artifact does not name.
  
  **Compiled output does not move.** This adds a check, not an emission: the SoHL
  tree compiles to the same 3,126 `build/packs-json` files, byte for byte.
- 808ef55: Add the closed `data:` container, and close `subType` (#128, part of #127).
  
  **What it is.** A note's frontmatter has three regions and only one of them is
  open. The top level describes the note as a published artefact and every key of
  it is copied into the generated web page, so an unrecognised key there is a Hugo
  or theme parameter this build has no standing to refuse. `data:` holds the
  type-specific facts about the _subject_ — a weapon's weight, an affliction's
  transmission, a being's species — and every note type declares which keys it may
  carry.
  
  **Why it earns its place.** Those facts previously sat at the top level, where
  the pass-through rule applied to them too, so a misspelled `wieght` became a
  theme parameter rather than a finding — indistinguishable, from the outside,
  from a weapon that weighs nothing. Under `data:` the same key is reported where
  it was written, with the key it was probably meant to be, drawn from that type's
  own vocabulary and using the capped edit distance the `sohl:` check already
  applies:
  
  ```text
  assets/content/Gear/Axe.md:14:5: error: "wieght" is not a `data:` property declared by weapongear; the container is closed, so unlike a top-level key it is not passed through to the page. Did you mean "weight"?
  ```
  
  **`subType` stays at the top level**, and is closed in its own way: a type either
  declares a `subType` or does not, and a type that does declares its values. A
  `weapon` declares none — SoHL distinguishes a weapon's uses by strike mode rather
  than by kind — so `subType` on one is a finding; a `skill` declares ten, so
  `subType: crafte` is a finding naming `craft`.
  
  **Additive.** Nothing reads `data:` into a document's `system` block yet — that
  is the passthrough slice — and no note in any tree authors one today, so no
  compiled output changes. `engine/note-vocabulary.mjs` carries the declaration,
  one entry per note type, taken from the content-format specification;
  `lintNote` and `lintFrontmatter` take it as a `vocabulary` option, so the linter
  stays a checker of whatever it is handed rather than gaining type names of its
  own, and a caller that supplies none is checked exactly as before.
- 3542a73: Commit the content format specification as `docs/content-format.md`, and add
  `content-build content-format` to check it.
  
  The specification — how a note becomes a Foundry document and a web page: three
  frontmatter regions, a note vocabulary with its own `type` and `subType`, the
  declared map onto each system's document fields, the precedence between a shared
  source and a system's override, and the wikilink address grammar — lived in a
  gitignored draft. Nothing could link to it, it had no history, and it was
  invisible to everyone but its author while four other issues were being
  implemented against it. It is this package's contract: `content-build` is what
  reads notes and writes documents, so the format belongs beside the code that
  honours it.
  
  **The document is checkable, and two throwaway scripts written while drafting it
  are now real commands.**
  
  `content-build content-format schema --schema <system>=<path>` resolves every
  `system.*` target the document names against the naming system's published
  `schema.json`, in the `version: 1` shape `package-build schema` emits. This is
  the emitted-versus-declared idea pointed at prose rather than at code: the format
  does not define the `sohl:` or `hm3:` schemas — each system does, and its
  artifact is the authority — so a mapping row is a claim, and a claim naming a
  field no schema declares means the two disagree. There are 88 such claims today.
  
  `content-build content-format notes` measures a content tree against the
  per-type `data` tables, counting findings in four classes: a note type the
  document declares no section for, an unknown key in the closed `data:` region, a
  declared shared source written at top level instead, and one written straight
  into a system block.
  
  **Both read the document's own tables.** A transcribed list of targets and
  vocabularies would be a second copy of the specification, free to drift from the
  first the moment either was edited — the exact failure these checks exist to
  prevent, moved one level up. No type name, field name or system name is written
  in the code; editing the specification changes what the checks assert.
  
  **A target resolves against the union of a system's subtypes.** The mapping
  tables say which field a shared source reaches; _which document subtype receives
  it_ is the note-type → subtype map, which is not built yet. Resolving per subtype
  before that map exists would mean inferring it from the prose around each table,
  which is the transcription the whole design avoids. It narrows when that map
  lands.
  
  **A system with no schema supplied is counted unchecked, not passed.** HM3
  publishes no artifact today, so that is the ordinary case for 18 of the 88
  claims, and a check skipping them in silence would read exactly like one that
  passed.
  
  **The corpus meter is a report, and `--strict` is the opt-in.** All ~6,210
  authored notes predate the format, so a failing check would be red in every
  repository on the day it landed and would stay red for the length of the
  migration — a check nobody can act on and everybody learns to skip. The counts
  are the migration's progress bar instead, and each class is promoted to fatal, by
  turning the flag on, as it reaches zero.
  
  Part of HeroicLands/package-build#127; closes HeroicLands/package-build#130.
  
  **Bump**
  
  _Minor._ A new command group, a document added to the published files, and no
  change to any existing behaviour.
- 1120e3f: Close the gaps in the content format specification that the compiler can answer,
  and add `content-build content-format fields` so the hand-written per-type tables
  cannot drift from the declarations that compile them.
  
  **A `### type: macro` section, written from what the compiler does.** `macro` was
  named in the note vocabulary with no section of its own, so
  `content-build content-format notes` reported every authored macro note as an
  unknown type — a false finding caused by the document being incomplete rather
  than by the note being wrong. The section states the `{#script}` anchor and its
  three fence rules, why the executable copy is read from the raw markdown, why
  `macroType: chat` is an error, and the two fields (`macroType`, `macroScope`) the
  compiler reads from `sohl:` today and that belong in `data:` for the same reason
  the map fields do. Measured against SoHL's tree, the `unknown-type` count falls
  from 435 to 434 and no new finding appears.
  
  **`government.model`, not `governance.model`.** The `affiliation` table carried
  two roots for one concept — `governance.model` beside `government.summary`.
  `government` is the established spelling: `engine/web-wikilinks.mjs` documents
  `government.summary` as its example key path, `tests/web-wikilinks.test.ts`
  fixtures it, and 79 authored notes in `sohl-thalorna` write `government:` while
  none writes `governance:`. Only the odd root moved; `GovernanceModel` remains the
  name of the value's vocabulary.
  
  **A map note's art is `image:`, and the document now says so.** The table said
  `img` and a standing note admitted the compiler disagreed. It does:
  `map-notes.mjs` and `scenes.mjs` both read `image`, and all three authored map
  notes write it. Which of the two spellings survives is a decision rather than a
  documentation fix, so the document states what the build reads and points at the
  issue that will settle it.
  
  **Two stale counts corrected.** Twenty-seven fields take a `WikiLink`, not
  "roughly forty"; thirteen of an `affiliation`'s properties describe the
  organisation, not four. The "sixteen tables" the shared-mapping section speaks of
  is exact — there are sixteen per-type mapping tables — and is left alone.
  
  **The drift guard.** The specification hand-writes a `data` table under most of
  its type sections, which is ground `engine/field-reference.mjs` already generates
  from the `fields` on each `itemBuilders` entry. Generating the document is not
  available: its vocabulary spans note types that produce Scenes, Macros and
  JournalEntries, which no item registry covers. So the two are **checked** where
  they both speak — a mapping row saying `data.weight` reaches `system.weightBase`
  and a declaration writing `weight` to `weightBase` are one statement made twice,
  and a rename that moves only one of them now fails, positioned at the cell in the
  specification that makes the claim.
  
  Everything else is reported rather than asserted, because the two vocabularies
  differ by design until the corpus migration lands: fields only one side names come
  back as coverage, and types only one side describes are **named** as out of reach
  rather than skipped in silence. Against the shipped SoHL declarations it compares
  9 types and 26 field pairs, names the 14 the format declares that no
  `itemBuilders` entry covers and the 4 declared types the format has no section
  for, and finds no disagreement. Wired into `npm run lint:content-format`.
- 7cf58f3: `contentPackage` is validated as an address segment, and `readCanonicalKey` counts segments explicitly.
  
  A canonical address (`sohl-skill-clmb`) is read by counting hyphen-separated segments, which is sound only while the hyphen is _purely_ a separator — no segment may contain one. #59 names three charset guarantees behind that and asks for each to be **enforced rather than assumed**. Shortcodes already were; `contentPackage` was not, and its absence had a live cost: `harn-adventures` produced four-segment keys that failed as a `null` return rather than as an error saying what was wrong.
  
  **`contentPackage` is now checked twice.** It must be alphanumeric (`^[A-Za-z0-9]+$`), and it must not equal a note type — `doc`, `being`, the map types, and every declared item type with its `doc`-prefixed documentation form. A violation is a build error in the usual `file:line:column: severity: message` form, naming the key's own line in the configuration file (#95). Every package in use today passes: `sohl`, `hm3`, `thalorna`, `kethira`, `harnensemble`, `harnadventures`.
  
  **The shortcode rule and the package rule are one constant.** `SHORTCODE_PATTERN` now _is_ `ADDRESS_SEGMENT_PATTERN`, from the new `engine/address-charset.mjs` leaf, rather than a second copy of the same regex free to drift from it.
  
  **`readCanonicalKey` states its premise instead of assuming it.** It counts against a named `CANONICAL_KEY_SEGMENTS`, and its documentation says the charset rule is what makes counting sound — rather than restating "nothing contains a hyphen" as a fact about the data that nothing checked. It also distinguishes its two failures: a string that cannot be a key still yields `null`, while an absent or blank input yields `undefined`. Both are falsy and all four call sites test only for truthiness, so no behaviour changes.
  
  Deliberately **not** in this change, because they depend on decisions still open in #59: the system segment, `none`, the manifest format-version bump, partial-address resolution, and the single-hit rule. The key format is unchanged — three segments, `<package>-<type>-<shortcode>`.
  
  Part of #127. Part of #59.
- 00706df: Declare the tags that classify, and say that every other tag stays open (#172).
  
  `tags:` lives at the open top level, and most tags belong there: a theme, a
  region, a working state is the author's own. **A tag that classifies the subject
  is different, because something queries it.** A settlement tagged `village`
  appears in the list of villages and an untagged one does not, so `vilage` does
  not merely look wrong — it removes the note from an index, silently, while the
  index still renders a table that looks complete. That is the failure the closed
  `data:` container was introduced to end, in a region that is still open.
  
  Four groups are declared: a place's **kind** (`city`, `town`, `village`, `port`,
  `fortress`, `hall`, …), its **character** (`fortified`, `temple`, `market`,
  `fishing`, `coastal`, …), its **scale** (`continent`), and a note's **state**
  (`draft`).
  
  **Kind and character are separate because one slot could not hold both.** The
  single-valued field these replaced ran to 101 values over 196 notes, 72% of them
  used exactly once, because `Fishing Village` and `Market Town / Seat of Local
  Nobility` each had to be a value of its own — and a query for villages found two
  of the eleven that existed.
  
  **A continent is a region carrying a tag, not a subtype**, because structurally it
  is a region: the same fields, the same parent chain, everything but scale.
  
  **And the declaration is checked.** `lintFrontmatter` reports a tag that is a near
  miss for a declared one — `vilage` for `village` — while leaving every other tag
  alone, because the region is open and a theme or a region is the author's own.
  The group's **scope** is what makes that sound rather than noisy: distance alone
  was wrong on all eight notes it touched in `sohl-thalorna`, since `azravan`,
  `barter` and `secret` each sit a typo's distance from a place tag while sitting
  on a faith, an economy note and three lore notes. Scoped to the types each group
  applies to, both authored trees report nothing.
  
  **A being's station is declared too**, and it is not a rank: which kind of body a
  person belongs to — the clergy, the soldiery, the tradesfolk — is a different
  axis from where they stand inside one, which `data.lore` carries by naming the
  rank. A tag holds the first, because a person may be several at once and because
  nothing ranks `clergy` against `mages`.
- 215ba23: Key a being's embedded-item references and the predefined-items map on the same vocabulary, and report a reference that resolves to nothing (closes #140, part of #127).
  
  **The defect.** Two vocabularies met in embedded-item resolution and disagreed about which one they were speaking. `Actors.loadItemsMap` keyed each predefined item by the **compiled document's** subtype (`doc.type`), while a being's frontmatter addresses its embedded items by the **note's** `type`. They are the same string in every SoHL row today, so the lookup succeeded by coincidence; the note-type → document-subtype map (#79) made the coincidence visible without creating it.
  
  The first non-identity row breaks it. #78 introduces exactly that — `armorgear` → `armor` and its two siblings — at which point a being's `armor` reference is looked up in a map keyed `armorgear`, finds nothing, and the item is missing from the compiled actor. `harn-ensemble` alone carries 30,741 such references.
  
  **Which vocabulary, and why that one.** The addresses stay keyed on the **document subtype**, and each authored reference is translated forward through the system's map before the lookup. The map is a function from note type to subtype by construction; the reverse is not — two note types may compile into one subtype — and a compiled document records nothing about the note that produced it, so there is no honest way to key the addresses the other way round. The translation lives in one place, `Actors#embeddedSubtype`, over a new `referencedSubtype` in `engine/document-subtypes.mjs`, and both are documented as saying which side translates rather than leaving it implied.
  
  | a reference naming…                           | before                        | after                                  |
  | --------------------------------------------- | ----------------------------- | -------------------------------------- |
  | a mapped type                                 | looked up verbatim            | looked up as the subtype the row names |
  | a type the system does not map                | looked up verbatim            | unchanged — the consumer's own type    |
  | a type the system compiles into another class | resolved to nothing, silently | a finding naming the note              |
  | a one-to-many row                             | resolved to nothing, silently | a finding listing the candidates       |
  | a retired spelling                            | resolved to the old name      | a finding naming the replacement       |
  
  **A stand-alone entry moved too.** An entry carrying no shortcode is built from the reference alone, so the note type became the document's subtype outright — a document of a subtype the system does not define, with nothing said. It now carries the mapped subtype, and the embedded `_id` seed is the subtype as well, so a later note-type rename leaves every embedded id exactly where it was.
  
  **Every finding is located.** An unresolved reference is now reported at the line the reference sits on rather than at the note, in the usual `path:line:column: severity: message` form.
  
  **Nothing compiled changes, and no tree gains a finding.** SoHL's map is the identity throughout: its 3,126 compiled pack files are byte-identical across the change. Compiled read-only against `harn-ensemble`, `sohl-thalorna`, `sohl-kethira-basic`, `harn-adventures` and `sohl`, the diagnostic output is the same finding for finding — 64 pre-existing `sohl-thalorna` findings gain a line and column, and nothing else moves.
- 3ea6f64: **A map is one type, and the three spellings are its subTypes.**
  
  `docs/content-format.md` has always described a map that way, and said why:
  _the three differ only in the canvas defaults derived for them, which is why
  they are subTypes of one type rather than three types._ The implementation
  declared the opposite, so a map note written to the specification was refused
  with `no schema is declared for content type "map"`.
  
  The three names cost three entries in the pack router, three in the claims set,
  three in `NOTE_SCHEMAS`, and three in every consumer's `sections` config — for
  one idea. `mapProfile()` now keys the derived canvas off `subType`, which is
  the one thing the spellings ever decided, and `MAP_SUBTYPES` names them.
  
  `battlemap`, `localmap` and `regionalmap` join `RETIRED_TYPES`, so a note or a
  link still writing one is **told what to write instead** rather than routed
  silently to the items pack — the treatment `character` and `creature` got.
  
  **`data.place` is declared**, closing a second gap in the same table: the link
  from a map to the place it depicts was specified and not declared, so authoring
  it was an error. It is named on the map and not on the place, because a place
  has several maps and a map depicts one place.
  
  Closes #174
- 6d3ffa1: Stop inferring a Foundry document's subtype from the markdown note's `type`, and look it up in a map each system declares (part of #79, slice 3 of #127).
  
  **The defect.** The two vocabularies were the same identifier for one reason: a builder wrote the same string twice. `sohl/actors.mjs` declared `ACTOR_VAULT_TYPE = "being"` and emitted `type: "being"` several hundred lines below it, under a comment reading _"One content type, named for the Foundry actor it produces."_ Nothing related them, so changing one and not the other produced a wrongly-typed document in silence — a wrong-output risk with **one** system, not only with two.
  
  **The mechanism** is `engine/document-subtypes.mjs` and the declaration is the system's, which is the `engine/` ÷ `sohl/` line this package draws everywhere else: note-format knowledge in the engine, game-system knowledge in the system half. `sohl/document-subtypes.mjs` declares SoHL's own map — _identity rows included_. `skill` → `skill` is written out rather than derived from the item registry's keys, because deriving it is exactly the coincidence the map exists to remove.
  
  | behaviour                                          | before                              | after                                       |
  | -------------------------------------------------- | ----------------------------------- | ------------------------------------------- |
  | an item's emitted subtype                          | `fm.type`, verbatim                 | the row the system declares                 |
  | an actor's emitted subtype                         | the literal `"being"`               | the row the system declares                 |
  | which notes the actors pass claims                 | `fm.type === "being"`               | every note type the map sends to an `Actor` |
  | a type the system maps onto another document class | claimed by whichever pass got there | claimed by neither                          |
  
  A markdown type with **no** row for a given system produces no document for that system — silently and correctly, exactly as the thousands of notes belonging to another pass already are. A one-to-many row is resolved by the note, which supplies the discriminator in that system's own block; an absent one is an error that names the note and lists the permitted values, never a default. SoHL has no one-to-many row, so that path is exercised against a fixture system in the suite rather than by inventing one.
  
  **Nothing compiled changes.** Every SoHL row is the identity today, so the lookup returns what the inference returned: `sohl`'s 3,126 compiled pack files and the build's whole diagnostic output are byte-identical across the change. The renames the content format calls for (`armorgear` → `armor` and its three siblings) are #78 and stay deferred — when one lands it edits one row here and the notes that address it, which is a data change rather than a mechanism change.
  
  Additive throughout: `itemBuilders`, the pack list and every other configured surface are untouched, and a consumer shipping an item type this system does not map keeps compiling it exactly as before.
- b292fba: Reduce a `place`'s `data` properties to what is true of ground, and let a map name
  the place it depicts (#164).
  
  Eight properties become four. Measured against the 246 authored place notes,
  three of the eight were used by **no note at all**, one was declared as the wrong
  type, and two were the wrong end of a relation.
  
  **`languages` is a fact about a polity.** A place's languages change when its
  ruler changes, which is what makes them the ruler's property; `commonSkills` on
  the affiliation already holds them. The corpus agrees — of 206 places carrying
  `languages`, 190 were settlements and 16 were regions, and not one was a site, a
  structure or a feature, because a ruin has no language.
  
  **`peoples` widens to `lore`.** It was the only lore-pointing property a place
  had, so a place with a calendar, a body of law or a local history had nowhere to
  cite it. The target's own subType already distinguishes a `folk` from a `law`,
  which is the same reason `affiliation` carries no `pantheons`.
  
  **`demonym` is a `string`**, which is what all 24 uses are and what
  `affiliation.demonym` has always been.
  
  **`summary` duplicated the top-level `description`** — no note carried it.
  
  **`affiliations` and `maps` were authored from the wrong end.** `affiliations` is
  the inverse of `affiliation.domains`, which 91 polities populate and no place
  does; a relation authored from both ends drifts the moment one is edited. `maps`
  moves onto the map, which gains a `place` property — optional, because an
  encounter map depicts no named place, but that is the exception the map section
  already describes. A place's maps are now derived: every map whose `place` is
  this one.
- caea6e3: Map a note's `<system>.system` block onto the document's `system` property, and let one note carry a block per system (part of #58, slice 2 of #127).
  
  **The rule.** A note is system-agnostic; the only system-specific things it carries are the properties named after a system. Within one, `<system>.system` maps straight onto `document.system` — the DataModel's own paths, verbatim, with no renaming layer — while `type`, `img`, `items`, `effects` and `flags` map onto their document properties and `pack` is a build directive that maps onto nothing. `archetype`, `kbcat` and the generators `items` and `attributes` are not `system` fields in any system, so they stay directly under the block.
  
  **The shared fallback is declared, not name-matched, and that is the load-bearing part.** `sohl.system.portrait` and `hm3.system.bioImage` both default from one shared property — two real fields with different names. SoHL's `Actor.being` and HM3's `Actor.character` share **no field name at all**, so a rule matching on spelling is not a rule with exceptions; it is a rule that never fires. Each field declares its source instead, and a source may be a dotted path (`data.portrait`) as `to` already may on the destination side. Resolution for a system `S`: `S.system.<to>`, else `S.<name>` (the legacy in-block position, kept until the corpus moves off it in #126), else the declared shared property, else the field's default.
  
  `FieldSpec.name` is reinterpreted accordingly — it is **the shared property this field draws from**, not "the frontmatter key under `sohl:`", which is the degenerate case where source and destination happen to share a name. `sohlField()` stops being the general rule; `blockField()` generalizes it to any block.
  
  **What is checked, that was not.** A key under `<system>.system` that the system's published `schema.json` does not declare for the subtype the note compiles into is an **error naming the note**, located at the offending line — Foundry discards an unknown `system` key at construction without a word, so the alternative is a field the author wrote and nobody ever sees. Unrecognised keys under a system block are reported against **that system's** vocabulary rather than only SoHL's, and a second system's block is checked once the build declares it.
  
  **`itemBuilders` becomes a set.** One registry is a ceiling as well as a vocabulary: the accepted types are its keys, so a type only the other system knows — `spell` and `invocation` are HM3's, `mysticalability` is SoHL's — cannot be accepted at all. A configuration may now name several (`itemBuilders: [sohl, hm3]`, or `[{ system, builders }, …]` in code) and the vocabulary is their **union**. A type both declare keeps a builder per system; `itemBuilder(type, system)` and `itemArt(type, system)` take the system that is asking, and asking without one for a contested type throws rather than answering with whichever registry was declared first. **The scalar form is unchanged** and still resolves to exactly the flat registry it always did.
  
  **Pack eligibility.** A pack declaring a `system:` compiles only notes carrying that system's block; one that declares none constrains nothing, and a pass whose document is not system data — journals, macros, scenes — is not subject to the rule at all. A violation fails naming the note and the pack, rather than emitting a hollow document with a subtype and none of the fields that subtype exists for. `pack:` itself needed no new mechanism: the block-override rule gives it, `effects` and `flags` their per-system form for free.
  
  **`(type, shortcode)` resolves inside one system's catalogue.** A being addresses its embedded items by that pair and never by pack, so the Item packs are read as one address space — which stops being one address space the moment two systems are in the tree, since `skill:sword` exists under both names over different data models. An Actor pass now reads the Item packs of its own system plus the system-neutral ones. The references themselves were never ambiguous; the resolver simply did not know which catalogue it was searching.
  
  **Nothing compiled changes.** No consumer authors a `<system>.system` block yet, and no consumer's packs declare a system that its notes do not carry, so this is purely additive to real output: `sohl`, `sohl-thalorna` and `sohl-kethira-basic` all compile byte-identically, and `content-build lint` reports the same findings in the same order. A note carrying no system block at all still compiles its system-neutral documents.
  
  The corpus migration that exercises all of this is #126, in the content repositories.
- b45c0f9: Report a note whose `type:` no configured pack claims, instead of compiling it into nothing in silence (#146, part of #127).
  
  **The defect.** Every compile pass answers one question about a note — _is this mine?_ — and a note every pass answers "no" to is skipped as quietly as the thousands that legitimately belong to another pass. Where **no** pass would ever have said yes, that quiet was the whole of the report. `harn-ensemble` declares no `itemBuilders`, so its five `affiliation` notes were a type nothing selected: the journals pass rejected them, the Actor passes rejected them, and no Item pack existed to claim them. They vanished from the build with no error, no warning and no census line — while its 2,512 `being` notes each produced a routing error, which is the correct behaviour. The two cases differed only in whether some pass got far enough to complain, and the quieter one had no owner.
  
  **The finding.** A note whose type no pack in the resolved configuration claims now fails the build, named and located at its `type:` key in the project's diagnostic form:
  
  ```text
  assets/content/Affiliations/fff-901-pentacle.md:6:7: error: no configured pack claims a note of type "affiliation", so it compiles into nothing. The "sohl" system compiles it into an Item, but `packs:` declares no Item pack and no `itemBuilders` registry declares "affiliation" — declare both in package-build.config.yaml, or stop authoring the type.
  ```
  
  **Two conditions, two fixes.** The **vocabulary** — what this toolchain and the systems it ships know a note type to be — is deliberately wider than any one repository's configuration. `affiliation` is a SoHL Item however a given repository is configured, so a tree of `affiliation` notes with no Item pack behind them is a repository that has not finished configuring itself, and the message says which piece is missing. A type in **no** vocabulary is the other finding — nothing anywhere compiles it, so the fix is the note's `type:`, not the configuration. Collapsing the two would have sent `harn-ensemble` to correct five perfectly good notes.
  
  **#79's silence is preserved, and is why the question is asked once.** A markdown type with no mapping in a given system produces no document _for that system_, silently and correctly. A per-pass check would report every such type against every system that does not map it, which is exactly the noise that rule forbids — so the question is put once, to the whole configured pack list, and "no system claims it at all" is the only statement made. A type one system maps and another does not stays silent as long as some pack claims it.
  
  `engine/note-claims.mjs` holds the claim table, which restates each pass's `selects` in the only form that can be asked of a pack the configuration does **not** declare; the suite compares the two for every type in the vocabulary, so they cannot drift apart. `homepage` is exempt by name: it compiles into a page rather than a compendium document, and its absence from every pack is the intended state.
  
  **Measured before it became an error.** Against every content tree in the org, this adds findings to exactly one repository and exactly the notes it was filed for: `harn-ensemble` 2514 → 2519 errors, the five `affiliation` notes; `sohl-thalorna` 150 → 150; `sohl-kethira-basic` 0 → 0; `harn-adventures` 2 → 2; `Song-of-Heroic-Lands-FoundryVTT` 0 → 0, with its 3,126 compiled pack files and its whole diagnostic output byte-identical across the change.
  
  **Bump**
  
  _Minor._ No consumer that builds green today has to change anything to upgrade — the one repository that gains findings is already red for an unrelated reason, and its five findings are the defect this exists to surface rather than a new demand on it. A repository that was silently shipping nothing for a type will now be told so, which is the correction.
- ad0cfd8: A map note's background art is `img:`, and `image:` is retired (#142).
  
  Every note type names its artwork `img` and carries it at the note's **top
  level**. A map alone named it `image` and read it out of the `sohl:` block, so
  one idea had two spellings with nothing to reconcile them — and the content
  format specification had to hedge rather than state a rule.
  
  **`img` is now the name, at the top level.** `buildScene` and the place index
  read `img` through `sohlField`, so it resolves the way every other note's art
  does: the `sohl:` block first, then the note's own top level, which is where it
  belongs. Art is not system-specific — a Scene is a core Foundry document and a
  second system would want the identical one — so the field has no business inside
  a system block. `docs/content-format.md` states that rule now, in place of the
  callout that recorded the disagreement and pointed at this issue.
  
  **`image:` still compiles, and is reported.** This is the first of the three
  steps `package:` took (#56): both spellings are read, `img` wins where a note
  carries both, and a note still writing `image` gets a finding naming the file,
  the line and the replacement. The sweep of the authored notes and the eventual
  refusal are separate, later work — nothing has to be renamed to take this
  release.
  
  **The finding is a warning, not an error.** A note writing `image` compiles to
  the byte-identical document, so failing a build over it would red a tree that
  has done nothing wrong on a key that still works. It is emitted on both paths an
  author meets — the **compile**, which every consumer runs, and `content-build
  lint` — so it is not a lint-only notice a project might never see.
  
  Two consequences worth knowing:
  
  | what                     | before                 | after                                                  |
  | ------------------------ | ---------------------- | ------------------------------------------------------ |
  | `content-build lint`     | any finding set exit 1 | only an **error** does; warnings are reported and pass |
  | a map with no art at all | "needs an `image`"     | "needs an `img`"                                       |
  
  The exit-code change is `reportFindings`' existing rule applied to the lint
  command rather than a second copy of it. Every finding was an error until now,
  so it changed nothing the day it landed.
  
  Verified against the `sohl` content tree, whose three map notes still write
  `image`: 3,126 compiled documents, byte-identical before and after, plus the
  three warnings.

### Patch Changes

- 291f5b3: Declare `section` on a `doc` of subType `collection` (#170).
  
  The address engine already reads it — a collection is a section's landing page,
  and `section` is the URL segment that page occupies — but the specification never
  declared it, so nothing could check it and an author had no way to learn it
  existed. Fifteen notes in `sohl-thalorna` carry it.
  
  Two things the declaration says that the code alone did not. **Two collections may
  not claim the same segment**, so a collection listing a _subset_ of a section
  names none and falls back to its own slug: five of that tree's collections list
  places and three list affiliations, and they cannot all be `/place/`. And it is
  **authored rather than derived** because a note's title is presentation — a
  collection called "Creatures" heads the `being` section, and slugging the title
  would put it somewhere else.
- d6a6b0b: Route a `doc` note by its subtype, not by the retired `category` key (#168).
  
  `sectionOf()` read `fm.category`, and a `doc` is the one type that routes by its
  subtype label rather than by its type — so when the content format retired
  `category`, every `doc` note began answering `undefined` and, as the function's
  own documentation says, _a `doc` with no section has no address and is not
  published_. `sohl-thalorna` has 24 such notes and `sohl` has 128. The site build
  emitted fewer pages and exited 0.
  
  Two further call sites read the same key: `landingOf()` tested
  `category === "collection"`, so a collection stopped being a landing page and its
  authored `section` — which is its URL segment — was ignored; and `site-build`
  fell back to the tree's section rather than the note's.
  
  Four tests now cover a `doc` of each subtype, and one asserts that a note
  carrying the retired key gets no section at all — the regression was visible only
  by reading the source, which is what a test is for.
- 42c03b6: **`content-build format --write` now formats to a fixpoint** (#125)
  
  `--write` formatted each file exactly once and reported success. Prettier's
  `format` is _assumed_ idempotent and is not guaranteed to be, so a single pass
  could leave text the next pass would still change — and the run would call such
  a file formatted while `prettier --check` still rejected it. Each file is now
  formatted repeatedly until it stops changing, capped at three passes, so what
  lands on disk is what a second run would have produced.
  
  **A file that will not converge is reported, not written.** At the cap the file
  is left exactly as it was and a diagnostic names it, because a formatting the
  command cannot reproduce would otherwise churn the file on every run.
  
  **`--write` now surfaces its findings and fails.** It collected them and threw
  them away, so a run that could not parse a file still printed
  `Formatted N of M file(s).` and exited 0. It now emits each diagnostic and exits
  1, which is the same channel the non-convergence report uses.

## 9.0.0

### Major Changes

- 8e48f7e: Raise the shared `printWidth` from 80 to 100.
  
  **Breaking for every consumer**, in the one way this configuration always is: a
  repository that updates and runs `lint:format` will find every file reported
  until it reformats. Nothing about a built package, an emitted document or a
  manifest changes — this is hygiene, and it reaches users not at all.
  
  **80 was inherited, not chosen.** The usual argument for it is reading measure,
  and that argument does not apply here: `proseWrap` is left at Prettier's default
  of `preserve`, so authored prose is **never reflowed**. Measured across the
  content trees, prose lines run to a p90 of 378 characters and a maximum of
  5,531, entirely untouched by this number. What `printWidth` actually governs is
  TypeScript and the YAML of a note's frontmatter.
  
  **Both were measurably cramped.** Reformatting a third of the SoHL source at
  each width:
  
  | width | total lines | vs 80 | lines still over width |
  | ----- | ----------- | ----- | ---------------------- |
  | 80    | 31,198      | —     | **1,399**              |
  | 90    | 30,328      | −2.8% | 193                    |
  | 100   | 29,672      | −4.9% | 75                     |
  | 120   | 28,850      | −7.5% | 25                     |
  
  The last column is the argument. At 80, Prettier _cannot_ honour the limit on
  1,399 lines — long string literals, `@src/…` specifiers, generic signatures — so
  those lines are over-width regardless and their surroundings were broken up for
  nothing. At 100 that falls to 75.
  
  The same knee appears in content. An item entry written in flow style —
  `{ shortcode: X, type: skill, name: …, system: { … } }` — typically lands in the
  low 90s, so of 318,030 entries across the two largest trees, 90.8% fit on one
  line at 80 and **95.3% at 100**, with almost nothing gained in between. 120 buys
  another 0.8 points and is not worth a second reformat.
  
  **This package's own config stops restating the values.** `prettier.config.js`
  carried its own copy of all twelve options with a comment saying they were
  "matched to" the SoHL repository — already the wrong authority once
  `PRETTIER_BASE` existed here, and a copy is a copy: raising the width would have
  left the package that _defines_ the shared style as the one repository not
  written in it. It now re-exports `PRETTIER_CONFIG`, so there is nothing left to
  drift.
  
  This release reformats this repository: 147 files, 2,677 lines shorter.
  
  **Bump**
  
  _Major._ Consumers' `lint:format` fails until they reformat, which is the whole
  of the breakage and is a one-command fix.

## 8.1.0

### Minor Changes

- 333c340: Follow a spread of an imported schema function, and refuse a computed field name.
  
  Two defects in `package-build schema`, both found by running it against real
  content rather than by reading it.
  
  **A shared base schema spread from another file was dropped, in silence.** A
  concrete DataModel spreads a shared builder by name — `...defineSohlDataSchema()`
  — and the resolver looked for that function only in the file doing the
  spreading. When it was imported, the lookup found nothing and the spread
  contributed nothing, with no error: a spread of a missing function read exactly
  like a spread of an empty one.
  
  The effect was not small. Every SoHL Item and Actor subtype lost `shortcode`,
  `actionDefs`, `lastRun` and `scheduledActions` from the published schema. So
  content correctly authoring `system.shortcode` — which SoHL requires to be
  unique per `(type, shortcode)` on an actor, and which content therefore sets
  deliberately — was reported as emitting a field no DataModel declares. The check
  was accusing the content of the reader's own blind spot, which is worse than not
  checking: it is a false accusation delivered with the same confidence as a true
  one.
  
  An imported spread is now resolved through the import, with a same-file
  definition still taking precedence.
  
  **A computed field name is now refused rather than published as source text.**
  `[`${name}Date`]: worldTimeDateField()` takes its real name from an argument
  this reader does not evaluate, and the previous behaviour handed back the source
  text — putting a field called ``[`${name}Date`]`` into the schema. That field
  matches nothing any builder could emit: absent for checking purposes while
  looking present, and permanently reported as unemitted.
  
  It now stops, naming the file and the key:
  
  ```text
  temporal-fields.ts declares a schema field with a computed name,
  `[`${name}DurationFormula`]`, whose value depends on an argument this reader
  does not evaluate. Write the keys out so the published schema can name them.
  ```
  
  Stopping is the same stance `compareFields` already takes on an artifact of the
  wrong version: the schema is a contract other repositories read, so a contract
  this cannot state is worth failing for rather than approximating. The fix
  belongs at the source, where the names are actually decided.
  
  **Bump**
  
  _Minor._ Repositories whose schemas spread an imported builder will publish more
  fields than before — which is the correction. A repository using computed field
  names now fails where it previously produced a wrong artifact; none does today
  except the one this was found on, and that is being fixed at the source.

### Patch Changes

- 2319a56: Bump `markdown-it` from 15.0.0 to 15.0.1 (#121).
  
  The surface is unchanged from the 15.0.0 adoption: one constructor,
  `markdownit({ html: true })` in `engine/helpers.mjs`, and three `md.render()`
  call sites — `engine/helpers.mjs`, `engine/journals.mjs` and `sohl/actors.mjs`.
  No plugin is installed, no renderer rule is overridden, and `linkify` is left at
  its default `false`. That last fact decides most of this release.
  
  **Two of the five changes cannot reach a build that never linkifies.**
  
  | Release note                                              | Reaches here?                                                    |
  | --------------------------------------------------------- | ---------------------------------------------------------------- |
  | _Security:_ quadratic complexity replacing fuzzy links    | No — `linkify` is `false`, so the fuzzy-link replacer never runs |
  | _Security:_ quadratic complexity in scheme backscan       | No — same; the rule is the inline **linkify** rule               |
  | Preserve brackets around IPv6 literals in `normalizeLink` | Yes, in principle — no content in any consumer writes one        |
  | Preserve spaces in all-space code spans (#1180)           | Yes, for runs of three or more spaces only                       |
  | Code spans after unclosed link/image labels (#1201)       | Yes, for an unclosed `[` followed by an odd-length backtick run  |
  
  Calling the first two "security" fixes is upstream's framing and the honest
  reading of it here is that this package was never exposed: both are complexity
  bounds on `linkify-it` code paths that are unreachable with the linkifier off.
  Taking the bump is hygiene, not remediation.
  
  **The three real fixes were measured, not assumed.** Both versions were rendered
  through `markdownit({ html: true })` — this package's exact configuration — and
  compared:
  
  ```text
  a `   ` b   15.0.0 → <p>a <code> </code> b</p>      15.0.1 → <p>a <code>   </code> b</p>
  [`a`b`      15.0.0 → <p>[`a`b`</p>                  15.0.1 → <p>[<code>a</code>b`</p>
  [x](http://[::1]/)
              15.0.0 → href="http://%5B::1%5D/"       15.0.1 → href="http://[::1]/"
  ```
  
  Each has a narrow trigger. The code-span fix moves output only at three spaces
  or more — 15.0.0 stripped one space from each end of an all-space span, so one-
  and two-space spans were already correct and stay byte-identical. The unclosed-
  label fix needs the backtick run to be **odd**: `[Sword `hp`and`ac`` renders
  the same on both, because its four backticks close. And the IPv6 fix only fires
  on a bracketed address literal in a link, image or autolink destination, which
  15.0.0 percent-encoded into a host no browser resolves.
  
  **Verified against every consumer, and against a search rather than a guess.**
  All 14,995 `.md` files across the six HeroicLands content repositories — `sohl`,
  `hm3`, `thalorna`, `kethira`, `harnensemble` and `harnadventures` — were parsed
  the way `parseMarkdownFile` parses them and rendered through both versions.
  Every one is byte-identical. Scanning the same corpus explains why rather than
  leaving it to luck: zero files contain an IPv6 URL, zero contain an all-space
  code span of three or more spaces, and the 109 files that do use `` ` ` `` use
  the one-space form the fix does not touch. Beyond the corpus, an exhaustive
  render of all 488,280 strings up to eight characters over `[`, `]`, `` ` ``,
  `x` and `!` — the alphabet the label-and-backtick fix is about — found the
  divergence set to be exactly the shapes above and nothing else. The repository's
  1,713 tests pass unchanged.
  
  **Bump**
  
  _Patch, not minor._ No export, option, or emitted document changes shape. The
  only behaviour that moves is markdown that was rendered wrongly before, on
  constructs no consumer writes, and the two changes advertised as security fixes
  are unreachable from this configuration.

## 8.0.0

### Major Changes

- d324b5a: Stop emitting five `system` fields no SoHL DataModel declares (#60).
  
  The comparison this release adds was run against sohl's published schema at
  0.8.2 and found five, on its first run:
  
  | type             | emitted, undeclared                                      |
  | ---------------- | -------------------------------------------------------- |
  | `affliction`     | `isTreated`                                              |
  | `trauma`         | `isTreated`, `isBleeding`                                |
  | `projectilegear` | `impactBase.overrideDice`, `impactBase.overrideModifier` |
  
  Every one was discarded when the document was constructed, on every compiled
  document, with nothing said — which is the whole of what #60 is about.
  
  **Two of them were never storable.** `isTreated` and `isBleeding` are _derived_
  on the logic classes: `AfflictionLogic.isTreated` is `treatmentDate != null`,
  and `TraumaLogic.isBleeding` is `bloodLossAdvanceDurationBase != null`. So the
  builder wrote a constant Foundry threw away while the field it is computed from
  went unwritten — both directions of the same defect, on the same field. Nothing
  replaces them: an untreated affliction is one whose `treatmentDate` is unset,
  which is already the initial value.
  
  **Three were authored fields that vanished.** `trauma.isTreated`,
  `trauma.isBleeding` and the two projectile overrides carried a frontmatter
  `name`, so a note could write them — and the value went nowhere.
  
  **The projectile overrides are removed rather than reported upstream as missing
  fields**, because nothing anywhere wants them: no DataModel declares them, no
  logic class reads them, no localization key names them. A
  launcher-versus-ammunition override may be worth having, but it would have to be
  designed in the system first, and a content builder cannot be where it is
  invented.
  
  **Checked before removing, because three were authored.** Dropping an authored
  field turns a note that writes it from a silent loss into an unknown-key error,
  so all six content trees were searched first: `sohl`, `thalorna`, `kethira`,
  `harnensemble`, `harnadventures` and `hm3` write none of the five.
  
  **Verified.** Against sohl 0.8.2's published schema, `undeclared` falls from
  five to zero. The twelve remaining findings are the advisory direction —
  fields a subtype declares that no builder emits, `treatmentDate` among them —
  and are reported rather than fatal.
  
  **Bump**
  
  _Major._ Three of the five were part of the authored frontmatter vocabulary, and
  a note writing one is now an unknown-key error rather than a value silently
  dropped. No content in this organisation writes them, but a consumer outside it
  would have to delete the keys — and would find its documents unchanged, since
  they never reached a saved document in the first place.

### Minor Changes

- d324b5a: Run the emitted-versus-declared field comparison in `content-build lint` (#60).
  
  The comparison shipped in 7.0.0 with nothing calling it, because no system had
  published its field sets yet. `sohl` now does, so this reads the artifact and
  runs both directions.
  
  **Which system, at which version, is already settled.** `stats.systemId` and
  `stats.systemVersion` are derived rather than authored (#48) — a system package
  is its own system, a module takes the one it requires, and the version is the
  `compatibility.verified` it pins. So there is no second piece of configuration
  to disagree with the first about whose schema to check against.
  
  Two places to find it:
  
  - **A system** reads its own `schema.json`, generated from its `src/`.
  - **A module** reads the copy `content-build deps fetch` caches from the archive
    of the version it pins — which is what makes the comparison happen at
    `verified` rather than against whatever the system's `main` holds today.
  
  **The fetch now keeps the schema.** Both fetch paths already unpacked the
  dependency's archive, but only one kept the result: a download unzips into
  `<cache>/package/` and leaves it, while `deps fetch --from` unzips into a
  temporary directory and deletes it. A reader looking in the unpacked tree would
  have found the schema for one and not the other — so it is copied to one known
  place beside the extracted items instead.
  
  **An absent schema is announced, not skipped in silence.** A system before its
  first schema build, and a module pinning a version released before the artifact
  existed, both have nothing to check against. That is not an error — but a check
  that quietly does nothing is indistinguishable from one that passed, and this
  issue exists because a defect went unnoticed for a release. So the run says so:
  
  ```text
  No published schema for sohl@0.8.2, so emitted `system` fields are unchecked.
  A system generates its own; a module gets one from `content-build deps fetch`.
  ```
  
  **Also lands the five fixes the comparison found.** They were pushed after
  #116's merge and so were not part of it: `affliction` and `trauma` emitted
  `isTreated`, `trauma` emitted `isBleeding`, and `projectilegear` emitted
  `impactBase.overrideDice` and `impactBase.overrideModifier` — none of which any
  DataModel declares. Without them this change would have turned `sohl`'s own
  lint red on the defects it was written to find.
  
  **Verified against both shapes.** Against `sohl`, the run reports zero errors
  and twelve advisory warnings, and `lint` passes. Against `sohl-kethira-basic`,
  whose pinned 0.8.2 archive predates the artifact, it announces the skip and
  reports only that repository's pre-existing findings.
  
  **Bump**
  
  _Minor._ New reporting on an existing command, and a fetch that keeps one more
  file. The error direction can fail a build that passed before — but only for a
  package whose dependency publishes a schema, which no released version does yet.
- ee9a9a8: Compare a builder's emitted `system` fields against the receiving DataModel
  (#60) — the comparison half.
  
  Foundry discards an unknown `system` key when a document is constructed, and
  says nothing: the value is absent at load while the build that wrote it reported
  success. Both directions of that mismatch have already happened here, both
  compiled clean, and both were found by set-subtracting compiled documents'
  `system` keys against `defineSchema()` **by hand**.
  
  **The emitted half needs neither compilation nor parsing.** `field-spec.mjs`
  already makes the field list the only statement of the mapping — "the
  declaration is the builder" — so every `system` path a type can emit is
  `field.to`, known statically. Nothing compiles a document to find out.
  
  **The declared half arrives as data, pinned to the declared version.** A system
  publishes its field sets as an artifact and this reads it, the shape the link
  manifest already uses for addresses. Against `compatibility.verified`, never the
  system's `main`: `affiliation.subType` _is_ defined on sohl `main` and simply
  unreleased, while `sohl-kethira-basic` pins `0.8.2` — so a check against `main`
  passes and the field still evaporates for all 21 of its deities.
  
  **`own` and `inherited` are recorded apart, and the two directions read
  different sets.** A subtype's schema spreads its parent's, so `notes`, `docHtml`
  and the rest land on every subtype; they are the system's own runtime concerns
  and no content builder is expected to emit them.
  
  | direction             | read against                                                       | severity |
  | --------------------- | ------------------------------------------------------------------ | -------- |
  | emitted, not declared | `own` ∪ `inherited` — the field must exist somewhere               | error    |
  | declared, not emitted | `own` only — what the subtype adds is what its builder answers for | report   |
  
  Collapsing them would report every inherited field on every type: a wall of
  findings that are all correct and none actionable.
  
  **A false positive the real schema caught before this shipped.** Run against
  sohl's actual `mysticalability`, the _declared, not emitted_ direction reported
  `charges.value` and `charges.max` on a type that populates them correctly — the
  builder writes `charges` as a whole object and never names the leaves beneath
  it. A declared path is now covered when the builder emits any ancestor. The
  first real schema tried produced two false findings, which is exactly the kind
  that teaches people to ignore a report.
  
  **Verified against the real declarations.** With sohl's `mysticalability`
  schema transcribed from source, the comparison reports nothing; with #35's
  `assocMysteryCode` reinstated, it reports exactly that field.
  
  **What this does not do yet.** It does not read an artifact from disk, and
  nothing runs it in a build — those wait on a system actually publishing its
  schemas, which is sohl's half and a separate change. The comparison, the format
  and both regression cases are pinned here so that half has something to satisfy.
  
  **Bump**
  
  _Minor._ New surface — `engine/schema-check.mjs` and its exports — and nothing
  existing changes behaviour. No consumer runs the comparison until an artifact
  exists to run it against.
- 14cd092: Add `package-build schema`, so a system publishes its DataModel field sets from
  here rather than from its own copy of an extractor.
  
  The consuming half of this contract shipped in 7.0.0: `content-build lint`
  subtracts what a package's builders emit from what a document will actually
  receive, because Foundry discards an unknown `system` key at construction and
  says nothing about it. The producing half lived in the first system that needed
  it, which meant the second system to need it would have copied 491 lines — and,
  worse, would have copied a hardcoded `SCHEMA_ARTIFACT_VERSION`, a constant this
  package owns. Two producers stamping a third repository's constant by hand is
  the drift worth removing before it happens rather than after: the version is now
  imported by the producer, not restated.
  
  **Why here and not in each system.** A DataModel's schema is only introspectable
  inside Foundry — `defineSchema()` returns field classes that do not exist in
  Node — so the field sets have to be read out of the source as an AST.
  TypeScript's parser reads plain JavaScript too, and this package already pins
  that compiler for `coverage.mjs`. Putting the reader here means a
  JavaScript-only system does not acquire a TypeScript pin merely to describe its
  own data models.
  
  **Declared, because the two layouts in use disagree.**
  
  ```yaml
  packageBuild:
    schema:
      Item: { from: module/data/item-models.js, registry: itemModels }
      Actor: { from: module/data/actor-models.js, registry: actorModels }
  ```
  
  One system keeps both registries in a single configuration module; the other
  keeps one per file. Neither layout is more correct, and a convention guessing
  between them would fail by reading _nothing_ rather than by complaining — which
  is the worst failure available here, since an empty schema passes every check.
  A registry that maps nothing is refused for the same reason.
  
  **Four spellings of inheritance, all followed.** `...Super.defineSchema()`,
  `...super.defineSchema()`, `Object.assign(super.defineSchema(), {…})`, and a
  subclass with no `defineSchema()` at all. The last is a real and complete
  declaration — `class MiscGearModel extends GearModel {}` — and reading it as
  "declares nothing" would make every field of a whole subtype look undeclared.
  `SchemaField` nesting is recorded as dotted paths whether written bare or as
  `fields.SchemaField`, since both spellings are in use.
  
  **A schema with nothing to compare against now says so.** The emitted side of
  the check is the `fields:` of `itemBuilders`, so a package whose compendium
  content is committed JSON rather than built from field declarations has an empty
  one — and every field the system declares would have been reported as unemitted.
  That is hundreds of findings whose only content is that the package does not
  build documents that way, which is not news and not a defect. It is announced
  once instead, for the same reason the absent-schema case is: a check that quietly
  does nothing reads exactly like one that passed. The moment a builder declares
  `fields:`, the comparison starts running on its own.
  
  **Bump**
  
  _Minor._ A new command, a new optional configuration key, and a `lint` that
  reports strictly less than before.

## 7.0.0

### Major Changes

- a136429: Separate declaring a system from requiring one, and stamp `_stats` per pack
  (#48).
  
  A module shipping content for two systems could not say so. The only place to
  state a system version was `relationships.systems`, and that list is a
  **restriction**: Foundry's `supportsSystem` drops a package from any world whose
  system it does not name. So the two needs were in direct conflict — name your
  systems and become unloadable elsewhere, or stay loadable and stamp nothing.
  
  **`harn-ensemble` is the case, and it is live.** It declares an `actors-hm3`
  pack and an `actors-sohl` pack, and resolves to:
  
  ```json
  { "statsSystemId": null, "statsSystemVersion": null }
  ```
  
  Nothing stamped, on content that was certainly built against `hm3 1.6.3` and
  `sohl 0.8.2`. It takes that path deliberately, because declaring the two systems
  would hide the module from every other world — including the ones that want only
  its system-neutral journals pack.
  
  **The split.**
  
  |                   | describes                                    | gates                       |
  | ----------------- | -------------------------------------------- | --------------------------- |
  | `systems:`        | which systems this package can stamp against | **nothing**                 |
  | `requiresSystem:` | —                                            | where the package will load |
  
  Naming a system under `systems:` restricts nothing. `requiresSystem` is separate
  and optional, and emits the `relationships.systems` entry Foundry reads —
  _reusing_ the declaration rather than restating it, because
  `stats.systemVersion` sat at `0.6.0` for four releases when a transcription was
  free to disagree with what it copied.
  
  ```yaml
  systems:
    hm3: { compatibility: { minimum: "1.6.3", verified: "1.6.3" } }
    sohl: { compatibility: { minimum: "0.8.2", verified: "0.8.2" } }
  requiresSystem: null # optional; omitted, the package loads anywhere
  ```
  
  **A pack's `system:` now selects what stamps its documents.** `_stats` was one
  memoised block for the whole package, so every document in every pack was
  stamped identically. It is per pack now: `statsForPack()` resolves the pack's
  declared system through `systems:`, and `BasePackCompiler` exposes it as
  `this.stats`, memoised per instance — one pass, one pack, one system.
  
  **`systemId` travels with `systemVersion`.** They are one decision, so where one
  is omitted both are. Stamping a per-pack version against a package-wide id would
  emit `systemId: sohl, systemVersion: 1.6.3` on HM3 documents — a plausible lie,
  which is worse than the missing value #43 fixed, because nothing about it looks
  wrong.
  
  **A name that resolves to nothing is an error.** A pack's `system:` must name a
  declared system; `requiresSystem` must too; and with a gate set, a pack naming a
  _different_ system is refused outright — Foundry would hide the whole package
  from any world that pack could have appeared in, so it would ship and be
  unreachable.
  
  **Nothing that ships today moves.** All six consumers were resolved before and
  after; none declares a `systems:` block yet, so every pack still falls through to
  the package-wide block it used before:
  
  | package              | `systems:` | `requiresSystem` | stamps         | packs unchanged |
  | -------------------- | ---------: | ---------------- | -------------- | --------------- |
  | `sohl`               |          0 | —                | `sohl / 0.8.2` | yes             |
  | `sohl-thalorna`      |          0 | —                | `sohl / 0.8.2` | yes             |
  | `sohl-kethira-basic` |          0 | —                | `sohl / 0.8.2` | yes             |
  | `harn-ensemble`      |          0 | —                | `— / —`        | yes             |
  | `harn-adventures`    |          0 | —                | `— / —`        | yes             |
  | `hm3`                |          0 | —                | `hm3 / 1.6.3`  | yes             |
  
  **`stats.systemId` and `stats.systemVersion` are refused outright.** Authoring a
  derived value is an error rather than an override, which is the rule this
  configuration already applies elsewhere — and the reason is the same one that let
  `stats.systemVersion` sit at `0.6.0` for four releases: a transcribed copy is
  free to drift from what it copied, and nothing reads a stamped `_stats` until
  something migrates on it. The refusal names the key, its line, and what supplies
  it now.
  
  The value still has to reach the validator from the loader, which is the half
  that may read the adjacent `package.json`. It travels under a **symbol**, so the
  channel is not a second, forgeable spelling of the key just refused: a symbol
  cannot be written in YAML and does not appear in `Object.keys`.
  
  **`relationships.systems` keeps working, and still answers.** It carries
  `itemCatalog` — a separate concern this split does not replace — so a repository
  using it would otherwise have to restate its compatibility under `systems:`
  purely to keep stamping, which is the duplication the change exists to remove. A
  lone relationship is a declaration as much as a gate, so it derives `systemId`
  too. Several have no single answer and get none.
  
  **Every consumer was migrated in the same change.** One line each:
  
  ```diff
   stats:
  -    systemId: sohl
       lastModifiedBy: sohlbuilder00000
  ```
  
  `sohl` and `hm3` are systems and are their own system by construction;
  `sohl-thalorna` and `sohl-kethira-basic` derive it from the single system
  relationship they already declare; `harn-ensemble` and `harn-adventures` declared
  none and were already clean.
  
  **Bump**
  
  _Major._ `stats.systemId` and `stats.systemVersion` were accepted and are now
  refused, so a configuration that resolved before can fail — which is the
  definition this repository uses. Every HeroicLands consumer is migrated in
  lockstep and verified to stamp exactly what it stamped before, but a consumer
  outside that set must delete the two keys.
  
  Part of #57, the third of its three keys that both describe and gate. #56 is
  done, #49 shipped in 6.2.0, and this is #48.

### Minor Changes

- db40b24: Address another package's landing without naming a host (#87).
  
  A link from one package's page to another package's landing had no form but a
  hardcoded absolute URL, and the homepage link check (#54) exempted one — a
  finding whose fix does not exist is noise. `sohl-kethira-basic`'s homepage writes
  `https://www.heroiclands.org/sohl/` twice.
  
  **The premise the exemption rested on is true, and does not lead where it looked
  like it led.** A landing is in no link manifest: it compiles to no document and
  is entered in no index. The reading that follows is that nothing can resolve it.
  But a landing's address is not a _note's_ address — it is the **package's**, and
  `PACKAGE_BASE` has recorded where each package is served all along. Consulting it
  walks no tree, reads no manifest and builds no index, which is exactly why the
  mechanism survives the fence: `kethira` and `harnadventures` publish a homepage
  and nothing else, and that mode never walks a content tree.
  
  **So the authored form is the absolute URL with the host struck off.** `/sohl/`
  in a body, or `href: /sohl/` in a card. Both were already accepted here — nothing
  had ever named one as the form to use, which is the whole of what was missing.
  
  | Field   | Cross-package landing | Why                                       |
  | ------- | --------------------- | ----------------------------------------- |
  | body    | `[SoHL](/sohl/)`      | emitted verbatim, resolved by the browser |
  | `href:` | `/sohl/`              | "already resolved, used verbatim"         |
  | `url:`  | **not expressible**   | package-relative by construction          |
  
  `url:` cannot leave its own package, so a `url:` naming another package's landing
  is now reported with the field as the fix rather than a path — previously it was
  told to "write `/`", which is nonsense arrived at by taking the path after the
  prefix when there is nothing after the prefix.
  
  **The base comes from the roster, not from the prefix.** The finding names
  `PACKAGE_BASE[pkg]`, so a package the roster relocates (`/setting/thalorna/`) is
  addressed where it actually is. That is the property the manifest enforces
  everywhere else — the address published is the address emitted — reaching these
  links for the first time.
  
  **Roster for landings only.** Widening the package set the other rules read would
  have them offer manifest-based advice about packages no manifest is vendored for.
  An in-site path naming no known package is still left alone: several surfaces a
  landing routes to are built by other tools, and this build does not hold the set
  of published pages.
  
  **Measured across every homepage authored today.** All five were run before and
  after, each under its own `package-build.config.yaml`:
  
  | Package                   | Before | After |                         |
  | ------------------------- | ------ | ----- | ----------------------- |
  | `sohl-kethira-basic`      | 0      | **2** | the two the issue names |
  | `sohl-thalorna`           | 0      | 0     |                         |
  | `harn-ensemble`           | 0      | 0     |                         |
  | `harn-adventures`         | 0      | 0     |                         |
  | `HarnMaster-3-FoundryVTT` | 0      | 0     |                         |
  
  Kethira vendors no manifest at all — it is homepage-only — so it is also the
  proof that the roster reaches where an index does not. Applying the fix the
  finding names takes it back to 0.
  
  **Sequencing, stated because it decides the bump.** These are hard errors:
  `severity: "error"`, counted into `failures`, `exitCode 1`. By this repository's
  own rule — a new hard error is breaking only if it fails a previously-passing
  consumer — this is minor **only once kethira's two lines are converted**, and
  major if it ships before them. The conversion does not wait on this release:
  `/sohl/` already passes under the current published version, verified, so it can
  land in `sohl-kethira-basic` immediately and independently. It must land first.
  
  **Bump**
  
  _Minor, not patch, and not major._ Not patch: a check that previously passed a
  page can now fail it. Not major, on the condition above — with kethira converted,
  every homepage authored today passes before and after, and no export, option or
  emitted document changes shape.
- 35bde43: Locate a configuration error in the file it was written in (#95).
  
  Every check across `content-config.mjs` and `config.mjs` — 81 of them — reports
  through one `fail()`, which named the offending key's **dotted path** and
  nothing else. That is a good description and a bad locator: nothing in the line
  is a path an editor can open or a CI annotator can resolve, in a file that runs
  to 400 lines with fourteen sibling entries under `sections:` alone, several of
  them flow-mapped onto one line.
  
  The path now rides on the error as a `field`, and the loader that read the file
  resolves it — through `positionOfYamlPath`, the same locator `manifest`'s
  `packFolders` findings already use — so all 81 come out in the
  `file:line:column: severity: message` form every other finding uses, path first:
  
  ```text
  package-build.config.yaml:382:64: error: package-build config: `site.sections.being.descrption` is not a recognized option (expected one of: title, banner, description).
  ```
  
  **Located at the boundary, not at the check.** `content-config.mjs` is the leaf
  an `.mjs` configuration imports and performs no I/O, so it attaches the path and
  `configFromData` — which knows the file — formats it. `config.mjs`'s pure
  `resolvePackageBuildConfig` is unchanged for the same reason;
  `loadPackageBuildConfig` is where its findings are located.
  
  **Positions are dropped, never guessed.** A required key the file never declared
  has no node of its own, so the position names the **mapping it belongs in**, one
  level up and no further — that entry is a real node and the one the reader must
  edit. A missing _top-level_ key has nothing above it but the document, and an
  `.mjs` configuration has no YAML to resolve a path against at all (parsing
  JavaScript as YAML would resolve some paths to lines that mean nothing). Both
  report `package-build.config.yaml: error: …` — the file, without a line.
  
  Both command lines print a located failure unprefixed, since `package-build: `
  and `loglevel`'s `[timestamp] [ERROR]:` occupy exactly the position a parser
  reads the path from.
  
  **Additive.** A valid configuration resolves exactly as before; only the text of
  a rejection changes, and it keeps the body it had. `positionOfYamlPath` gains an
  optional `{ key: true }` — report where a key is _declared_ rather than where
  its value sits, which is what a message naming a field wants — and
  `engine/diagnostics` gains `yamlKeyPath`, the one translation between a dotted
  path and a YAML key path.
- b7ad450: Compile actors without an Item pack of this package's own (#49).
  
  The actors pass threw unless the package declared at least one pack of type
  `Item`. An Item pack is system-bound by construction — Foundry requires `system`
  on Item packs and on few others — so the guard asked a deliberately
  system-agnostic module to declare the very thing it exists not to depend on.
  
  **This is not hypothetical, and it is not a future case.** `harn-ensemble`
  declares two Actor packs and no Item pack at all in its
  `package-build.config.yaml` today. Run against that configuration, the compiler
  does not start:
  
  ```text
  packs declared   : actors-hm3(Actor), actors-sohl(Actor)
  itemPackJsonDirs : []
  Actors           : THREW — Actors compiler requires `itemsSourceDirs` …
  ```
  
  Its 2,512 beings resolve their embedded items — `skill:awar`, `attribute:str`,
  `weapongear:…` — against the `sohl` and `hm3` catalogues through
  `foreignSourceDirs`. The optional mechanism is the one that matters there; the
  mandatory one had nothing to contribute.
  
  **The guard did not test what it claimed.** It counted _declared directories_,
  not resolvable items. An Item pack containing no documents satisfied it, while a
  being naming an item nothing defines still failed later — so it neither
  prevented the failure it named nor reported it where it happened. And its
  remedy, "declare at least one pack of type `Item`", is the opposite of the fix
  for a system-agnostic package.
  
  **The condition actually cared about was already checked, at the site of the
  mistake.** `resolveEmbedded` reports each unresolved `(type, shortcode)` by
  name, with the being as context, and counts it — and those counts aggregate into
  `totalErrors`, so a package genuinely missing an item still fails the build:
  
  ```text
  Bandit: no predefined item for "skill:awar"
  ```
  
  That is the same line #43 and the frontmatter-lint work drew: a structural
  precondition that is cheap to state is not the condition you care about, and
  reporting where the mistake is beats refusing to start.
  
  **Nothing tightens.** `itemsSourceDirs` defaults to `[]` and is otherwise
  unchanged; `foreignSourceDirs` is untouched; `itemPackJsonDirs` already returned
  an empty list for a repository with no Item packs, and only the constructor
  rejected it. A package that declares Item packs behaves exactly as before — the
  1,647 existing tests pass unchanged, with four added for the empty case and for
  the point-of-use error that replaces the guard.
  
  **Bump**
  
  _Minor, not patch._ No consumer that compiled before fails now — the change only
  removes a refusal — but a configuration that was rejected is now supported, which
  is new surface rather than a repair to existing surface. Not major for the same
  reason: nothing that was accepted stops being accepted.
  
  Part of #57, which is the same defect in three places: a key that both describes
  and gates, so the legitimate case cannot be expressed. Here the gate is removed
  and the description — which Item packs this package ships — is left saying only
  that.

### Patch Changes

- 8aab711: Bump `glob` from 11.1.0 to 13.0.6.
  
  **Both majors are changes to glob's command-line program, not its library.**
  
  - **12** removed the unsafe `--shell` option, keeping it only on shells where it
    can be implemented safely (the remediation for GHSA-5j98-mcp5-4vw2, whose
    mitigation 11.1 had introduced).
  - **13** moved the CLI out to a separate `glob-bin` package.
  
  This repository never invokes that program. The single use of the library is
  `globSync(patterns, { cwd, absolute: true })` in `readMatching`
  (`bin/package-build.mjs`), which is untouched across both majors — no workflow,
  hook, or script calls `glob` from a shell, so the removed binary is not a
  dependency this package had.
  
  **Verified rather than assumed.** `globSync` was exercised under 13.0.6 with the
  options `readMatching` actually passes, returning the same absolute paths; the
  repository's 1,642 tests pass unchanged.
  
  **Bump**
  
  _Patch, not minor._ Nothing in this package's surface moves, and the majors are
  the library's own. Worth noting for a consumer only in one case: a repository
  that installed `glob` transitively through this package and relied on
  `node_modules/.bin/glob` being present must now depend on `glob-bin` directly.
  That was never a supported edge of this package, and no HeroicLands repository
  does it.
- 8e0778e: Bump `markdown-it` from 14.3.0 to 15.0.0.
  
  This package's entire use of the library is `markdownit({ html: true })` and
  `md.render(body)`, at three call sites — `engine/helpers.mjs`,
  `engine/journals.mjs` and `sohl/actors.mjs`. Nothing overrides a renderer rule,
  installs a plugin, or reaches into the parser.
  
  **Every breaking change in 15.0.0 lands outside that surface.**
  
  | Breaking change                                                        | Why it does not reach here                                                      |
  | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
  | `linkify-it` → v6: no fuzzy links, no auth check, CJK link termination | `linkify` defaults to `false` and is never enabled, so the linkifier never runs |
  | Package-internal subpath exports (`markdown-it/lib/*`) removed         | Only the package root is imported                                               |
  | `validateLink`/`normalizeLink`/`normalizeLinkText` moved to prototype  | None is read, assigned, or overridden                                           |
  | `StateBlock#ddIndent` removed                                          | No plugin is installed, `markdown-it-deflist` included                          |
  | Root now resolves to prebuilt `dist/` rather than raw sources          | Import is by package name; the resolved path was never depended on              |
  
  **Verified rather than assumed.** The same corpus was rendered through 14.3.0
  and 15.0.0 and diffed byte-for-byte, covering exactly the constructs the release
  touched — bare URLs, autolinks, email-shaped text, reference links and their
  definitions, CJK adjacent to a URL, hard line breaks, raw HTML, tables, nested
  lists, and both fenced and indented code. Output is identical. The repository's
  1,642 tests pass unchanged.
  
  **Bump**
  
  _Patch, not minor._ No export, option, or emitted document changes shape, and no
  behaviour a consumer can observe moves. The version is a major on the library's
  own surface, none of which this package presents onward.
- 6318722: Add `.github/dependabot.yml`. This repository had none, so nothing proposed a
  dependency update — not npm, not GitHub Actions.
  
  That matters more here than in a consumer: this is the toolchain every other
  HeroicLands package builds with, and it is published to npm, so its dependency
  tree reaches every consumer's build and everyone who installs it. The
  consuming repositories are already covered; this producer was the one link in
  the chain nothing watched.
  
  `@foundryvtt/foundryvtt-cli` and `classic-level` are each an ungrouped
  single-package entry, ordered ahead of the housekeeping catch-all, for every
  update type including minor and patch. Both sit directly on the compendium
  pack pipeline, and a version bump that silently changes how a pack compiles is
  exactly the failure this repository's byte-level output comparisons exist to
  catch — grouping either into a housekeeping pull request would hide which
  dependency caused a regression.
  
  No `ignore` entries: nothing here has a known-bad range to record.
  `typescript` is a direct dependency, but `build.yml`'s "Declaration emit" step
  already gates a breaking bump on every pull request.
  
  Closes #100.
- cd32ea1: Render `[[target|]]` as the target's name on the web, as the packs already do
  (#113).
  
  A wikilink with an explicit but empty label produced an **empty anchor** —
  `[](/rules/sohl-shock/)`, a link with no clickable text — silently, through
  every site build:
  
  ```text
  [[doc-shock]]             => [Shock](/rules/sohl-shock/)
  [[doc-shock|]]            => [](/rules/sohl-shock/)      ← before
  [[doc-shock|]]            => [Shock](/rules/sohl-shock/) ← after
  [[#sec|]]                 => [](#sec)                    ← before
  ```
  
  **The two resolvers had drawn the same line in two places, differently.**
  `parseWikilink` distinguishes "no label" from "empty label" deliberately, and
  its docstring says so — _"`null` and `""` differ: an author may write
  `[[x|]]`"_. The packs resolver honoured that by testing falsiness. The web
  resolver used `??`, which falls through on `null` only, so `""` survived to the
  output at three sites: the same-page anchor, the resolved link, and the
  unresolved link.
  
  That is the third instance of exactly the drift `wikilink-syntax.mjs` was
  created to stop — its module docstring opens on the two copies of the link
  parser having already diverged. The parse was centralised; the _interpretation
  of the parsed parts_ was not, and it drifted in the one case the docstring
  names.
  
  **So the reading is stated once.** `authoredLabel()` joins the syntax module and
  both resolvers consult it, rather than each deciding what an empty label means.
  `labelled` is untouched and still separates `[[x]]` from `[[x|]]`, which is what
  #1409 actually depends on — an unlabelled `[[Shock State]]` still shows the
  author's own prose rather than the canonical name.
  
  **Why it is worth a release rather than waiting.** `[[x|]]` becomes load-bearing
  under the four-segment address grammar (#59): the pipe is what distinguishes an
  address lookup from an alias lookup, so `[[target|]]` is the canonical way to
  write an address that displays its target's name — and the planned migration
  rewrites every authored address link into that form. Converting the corpus into
  a form that renders an empty anchor would be a corpus-wide regression, so this
  has to land first.
  
  **Bump**
  
  _Patch._ A defect fix with no new surface. `authoredLabel` is exported because
  both resolvers import it, not as a feature for consumers; no option, address, or
  emitted document changes shape, and no link that renders correctly today renders
  differently after.
- bc2c5c8: Bump `@types/node` in the lockfile for development tooling maintenance.
- 1a4d882: Hold `typescript` at major 6 in Dependabot, because TypeScript 7 removes the
  compiler API `coverage.mjs` parses with.
  
  Dependabot proposed 6.0.3 → 7.0.2 (#105). It cannot be taken.
  
  **TypeScript 7 is the native port, and its npm package no longer ships the
  JavaScript compiler API.** The `"."` export resolves to `lib/version.cjs`, whose
  entire surface is `version` and `versionMajorMinor`.
  
  `coverage.mjs` uses that API as a _parser_, not as a compiler: it reads
  localization keys out of a consumer's `src/**/*.{ts,mjs}` by walking a real AST,
  deliberately down one path so JavaScript and TypeScript cannot drift. Under 7.0.2
  the AST **vocabulary** survives behind `typescript/unstable/ast` — `ScriptTarget`
  and every `isX` guard the scan uses — but the three things that actually drive it
  exist nowhere in the JS surface:
  
  | Needed by `coverage.mjs`                                      | In 7.0.2                                   |
  | ------------------------------------------------------------- | ------------------------------------------ |
  | `createSourceFile`                                            | **missing** — only a factory of that name¹ |
  | `forEachChild`                                                | **missing**                                |
  | `flattenDiagnosticMessageText`                                | **missing**                                |
  | `ScriptTarget`, `isStringLiteral`, `isPropertyDeclaration`, … | present, behind `unstable/ast`             |
  
  ¹ 7's `createSourceFile` assembles a SourceFile from statements already parsed.
  It is not a parser.
  
  **The gate this file predicted would catch it did not.** The previous comment in
  `dependabot.yml` recorded no ignore entry on the reasoning that `build.yml`'s
  "Declaration emit" step already guards a breaking `typescript` bump. That step
  passes clean under 7.0.2 — `tsc` still emits every `.d.mts`. What failed was
  `npm test`: 11 failures in `tests/coverage.test.ts`, all
  `TypeError: Cannot read properties of undefined (reading 'Latest')`. A dependency
  can be load-bearing in two unrelated ways at once, and the file named only one of
  them. That correction is now written where the wrong prediction was.
  
  **Why an ignore rather than a migration.** Parsing in 7 lives in the Go binary,
  reachable only through `unstable/sync`'s Project/Program API. Adopting it would
  put a subprocess and a virtual filesystem inside a module whose stated contract
  is "everything here is pure — source text in, references or findings out", in
  exchange for an API whose own export path says `unstable`. Acorn is not a
  substitute either: the default scan glob is `src/**/*.{ts,mjs}`, and the largest
  consumer's sources are TypeScript.
  
  That migration is worth doing when the API stabilises. It is not a dependency
  bump, and it should not arrive as one.
  
  **Scope of the hold.** Majors only — minor and patch releases within 6 still
  arrive on the weekly schedule. The entry names the two conditions that lift it:
  a stable in-process parse entry point, or a `coverage.mjs` that no longer needs
  one.
  
  **Bump**
  
  _Patch._ Nothing shipped changes. `.github/dependabot.yml` is this repository's
  own automation and sits outside `files`; the `typescript` range in
  `package.json` is untouched, because `^6.0.3` already excludes 7 — the entry
  stops the pull request being reopened, it does not change what resolves.
- f3167c3: Read the changesets action's `pr-number` output, so the step that marks the
  Version Packages pull request stops being dead code (#84).
  
  `release.yml` pins `changesets/action@v2` but read v1's `pullRequestNumber`. An
  unset output evaluates to the empty string rather than erroring, so the guard was
  `'' != ''` — always false. The step has never run once.
  
  **The failure was silent by construction, which is why it survived three
  releases.** A misspelled output does not fail a workflow; it disappears. `v3.4.0`,
  `v4.0.0` and `v5.0.0` were all cut with this step skipped, and every run reported
  green.
  
  **Only one of the three names actually moved.** Checked against v2's own
  `action.yml` rather than against the assumption that v2 kebab-cased everything:
  
  | v1                  | v2                   | Used here                             |
  | ------------------- | -------------------- | ------------------------------------- |
  | `pullRequestNumber` | `pr-number`          | yes — the two lines this change fixes |
  | `publishedPackages` | `published-packages` | no                                    |
  | `hasChangesets`     | `has-changesets`     | no                                    |
  | `published`         | `published`          | yes — **unchanged**, and left alone   |
  
  `published` is the one name v2 kept. A blanket kebab-case sweep of this file —
  the obvious reading of "rename the v1 outputs" — would have broken the one step
  that was working.
  
  **Bracket notation, not `outputs.pr-number`.** A hyphen is the subtraction
  operator in an Actions expression, so the dotted form parses as
  `outputs.pr - number`: a second silent-ish defect sitting directly behind the
  first. `steps.changesets.outputs['pr-number']` is the form that means what it
  reads as.
  
  **What this repairs.** The Version Packages pull request is opened by
  `GITHUB_TOKEN`, and GitHub deliberately starts no workflow runs from that token,
  so the required `Changeset declared` context never reports on it. This step
  exists to post that status. With it inert, every Version Packages pull request
  has needed the check waived or force-merged by hand.
  
  **Not yet demonstrated running, and stated rather than glossed.** The acceptance
  criterion asks for a run where the step is not `skipped`, and that can only
  happen on `main`, on the next release that opens a Version Packages pull request
  — this change cannot produce one from a branch. The expression is verified by
  parsing the workflow and by v2's manifest; the live proof arrives with the next
  bump.
  
  **Sibling repositories are fixed individually, not swept from here.** The same
  defect is open on `harn-ensemble` (#13) and `HarnMaster-3-FoundryVTT` (#427),
  where it is more severe — there the misspelling gates the release itself, and no
  release is ever cut. Each repository owns its own copy of `release.yml`; this one
  is not a reusable workflow. Turning it into one is a real improvement and a
  separate change, and folding it into a two-line fix would put a shared release
  pipeline into production on the back of a typo correction.
  
  **Bump**
  
  _Patch, not minor._ Nothing this package exports, emits, or documents for a
  consumer changes. The file is this repository's own release plumbing, and it is
  not shipped: `.github` is outside `files`.
- 2bdc792: Make `lint:markdown` pass, and run it in CI (#92).
  
  This repository provides `content-build markdown` and was the one repository that
  never ran it. The script existed, failed, and was executed by nothing — no
  aggregate `lint` script, and no workflow naming it.
  
  **The finding count in the issue is wrong, and the correction changes the
  decision.** 117 is what `npx markdownlint-cli2 CHANGELOG-content-build.md`
  reports — markdownlint's _default_ rule set, which this toolchain deliberately
  turns off (`default: false`, then each rule enabled by name). Under the rules the
  repository actually uses, `npm run lint:markdown` reports **three**: two
  `MD001` heading skips and one `MD034` bare URL. The issue's "fix it — 117
  mechanical findings" and "exclude it — 117 is too many to fix" were both
  arguments about a number that was never the repository's.
  
  **Excluded anyway, and not because three is still too many.**
  `CHANGELOG-content-build.md` is the published changelog of
  `@heroiclands/content-build` — a **deprecated repository**, absorbed into this
  one at 3.0.0 (#32). It is frozen, not merely generated: exactly one commit has
  ever touched it, nothing regenerates it, and it ships only because `files` lists
  it. Its three findings are facts about what content-build published. Rewriting
  them would edit a historical record to satisfy a rule about prose nobody will
  write again, and would put a style-only commit in the blame of a file whose whole
  value is being what was published. It is the same class as `CHANGELOG.md`, which
  the shared default already ignores for the weaker reason that the next release
  rewrites it.
  
  **Declared locally, so no consumer moves.** The exclusion is a new
  `.markdownlint-cli2.jsonc` in this repository, not an entry added to the shared
  `MARKDOWN_IGNORES`. One repository's retired filename does not belong in
  configuration six repositories consume, and the shared rule set is unchanged for
  all of them.
  
  **What that file had to get right, and what it documents.** `content-build
  markdown` passes the shared rules as markdownlint-cli2's `optionsDefault`, and a
  consumer file merges over them **key by key, each key wholesale**:
  
  | Declared locally | Effect on the shared default                                          |
  | ---------------- | --------------------------------------------------------------------- |
  | only `ignores`   | rule set survives intact — `default: false` and every per-rule option |
  | `ignores`        | **replaces** `MARKDOWN_IGNORES`; it does not extend it                |
  
  So the local file restates `CHANGELOG.md`. Verified rather than assumed — with
  that entry dropped, `lint:markdown` reports ten findings in `CHANGELOG.md`; with
  a probe file present, `MD049` still fires with its shared `underscore` option
  while `MD013` stays silent, which is what proves the rule set was not replaced.
  
  `engine/prose-lint.mjs` said a consumer config "replaces it", which is the
  reading that would send the next person to add the ignore to the shared default
  or to a full config copy. Its docstring now states the key-by-key rule and the
  `ignores` trap by name.
  
  **Wired as a separate CI step, not folded into the chain.** `npm run lint` is
  added for running both checks locally in one command, but `build.yml` gets a
  `Markdown` step of its own beside `Formatting`. The aggregate chains with `&&`,
  so a formatting failure would short-circuit it and hide every markdown finding
  behind it; as two steps the failing one is named in the checks UI.
  `lint:markdown:fix` is added too — the issue referred to it, and it did not exist.
  
  **The exclusion cannot rot silently.** If a future markdownlint-cli2 bump changes
  those merge semantics, the restated `CHANGELOG.md` entry stops applying and its
  ten findings reappear — in the CI step this change adds. The guard is checked by
  the thing it guards.
  
  **Bump**
  
  _Patch._ Nothing a consumer imports, calls, or configures changes behaviour. The
  one shipped file touched is a docstring in `engine/prose-lint.mjs`, which reaches
  consumers through the emitted declarations; everything else — the workflow, the
  local lint config, the scripts — is this repository's own plumbing and is outside
  `files`.

## 6.1.0

### Minor Changes

- dc424d7: **`content-build addresses diff` reports every published address a build has
  stopped publishing, and tells a rename from a removal** (#66).
  
  A package's `(type, shortcode)` addresses are a published interface — every
  satellite declaring `itemCatalog: true` assembles its beings out of them — but
  nothing compared one release's addresses against the next, so renaming a
  shortcode cost nothing and produced no signal. The check that got made instead
  was a repository-local grep, which cannot see the other repositories and reports
  the reassuring answer. `sohl` renamed `weapongear:Tabri` to `weapongear:Taburi`
  two days after the `v0.8.2` tag both satellites pin, stating that nothing
  referenced the old value; five lookups across two repositories do, and they fail
  the moment either pin moves.
  
  ```bash
  gh release download v0.8.2 -p system.zip -D build/baseline
  npx content-build addresses diff --from build/baseline/system.zip
  ```
  
  Run against `sohl` today that reports 20 findings — 8 renames and 12
  withdrawals — including the `Tabri` one, at the line of the note that made it:
  
  ```text
  assets/content/Weapons/Melee/Taburi.md:12:1: warning: since sohl@0.8.2, weapongear:Tabri is no longer published; the same document (s5D6QJbw7ZbETxdN) is now published as weapongear:Taburi. Every package that resolves weapongear:Tabri breaks when it moves past sohl@0.8.2
  ```
  
  **A rename is told from a removal by the document id, which is an identity match
  rather than an inference.** A note authors its `_id` in frontmatter and it is not
  derived from the shortcode, so it survives a rename. Where the id is published
  under no address at all, the finding says only that — _withdrawn_, naming no
  successor. A split, a deletion and a merge are indistinguishable at that point,
  and a "did you mean" guessed from string similarity would send the reader to the
  wrong fix.
  
  Both findings are warnings and neither fails a build: retiring content is
  legitimate, and so is renaming — the shortcode charset rule forces some. What a
  rename must not do is happen in silence. `--strict` reports both as errors and
  exits non-zero, for a release workflow that wants a gate.
  
  Additive: nothing runs unless the command is invoked, and no existing behaviour
  changed.
- f28f653: A section can now describe itself: `site.sections` and `site.readmeSections`
  take a `description`, and it reaches the generated `_index.md` (#91).
  
  A generated section landing is the only place a section can speak — a content
  package authors no `_index.md` for `weapongear` or `affliction`, so the file the
  theme reads is the one this build writes. Its vocabulary was two keys, and
  `partials/hero-banner.html` has always rendered `description` as the hero
  standfirst, so every generated landing rendered a heading with no standfirst and
  could not be given one by any consumer, at any level.
  
  **The pair was the defect, not a passthrough.** The vocabulary lived in two
  places that had to be kept in step by hand: the schema that admits a key, and
  the two writers that each transcribed `title` and `banner` by name. A key added
  to the schema alone validated cleanly and then reached no page. So the writers
  stop naming keys and emit what the section resolved to, `title` first, and the
  schema is now the single place a section's vocabulary is decided.
  
  **The bound stays.** An unrecognised key under a section is refused at config
  load, by name, exactly as before — `site.sections.affliction.descrption is not a
  recognized option (expected one of: title, banner, description)`. Passing
  sections through unvalidated the way `site.landing` is was weighed and refused:
  `landing` is written once, for the mount, in one landing template's vocabulary,
  where a section entry is written fourteen to twenty times per build against a
  contract every package shares. Unbounded, a mistyped `descrption:` would publish
  into front matter, be read by nobody, and say nothing to anyone — which is the
  failure this issue was filed about, one step downstream where no build can see
  it.
  
  Additive. `description` is optional and no consuming package declares one — none
  could, since the loader has always refused it — so every generated landing is
  byte-identical, verified across all six consuming packages.
- 43a9de4: Refuse `name`, `shortcode` and `id` on a `type: homepage` note (#53).
  
  A note's URL derives from `name.full` and its identity from `(type, shortcode)`.
  The homepage is the one page for which neither holds — it publishes at
  `/<package>/`, fixed by the package id — so an author fluent in the conventions
  writes them there expecting exactly what they do everywhere else, and gets none
  of it. Until now `content-build lint` ignored all three: a homepage carrying
  `shortcode`, `id` and `name.full` passed at exit 0.
  
  **They were never inert, which is why ignoring them was the wrong answer.** A
  `shortcode` puts the note in the address index and in the `dataview` link
  universe, so `[[homepage-<shortcode>]]` resolves _green_ — to `homepage/<slug>/`,
  an address derived from `name.full` and published by nothing, because a homepage
  is written to `_index.md` at the package root. A build that reports a live link
  to a 404 is worse than one that says nothing.
  
  **The inflated address tally is the same defect, not a second one.** The same
  note was counted as an address it does not publish, so the lint and the link
  manifest disagreed about what the package ships: SoHL's tree reports
  `1607 address(es) across 1607 note(s)` with a `shortcode` on its landing and
  `1606 address(es) across 1607 note(s)` without one. The tally is only ever
  printed on a clean run, so refusing the field is what makes the count honest —
  `lintContentTree` needed no change, and got none.
  
  **A named class, not an allow-list, and that boundary is the decision.** An
  unknown top-level key is deliberately still accepted. A homepage's frontmatter is
  emitted into the published page, so an unrecognised key is a Hugo or theme
  parameter this build has never heard of and has no standing to reject, and a
  closed list would make every new theme parameter wait on a package-build release.
  What is refused is the class that makes a false claim about _where this page is_.
  `aliases` is not in it either — it is already dropped from every emitted page, so
  authoring one here is the same no-op it is anywhere else. This departs from the
  issue's third acceptance criterion, deliberately: over-strictness here breaks
  authoring on a page whose whole frontmatter is pass-through.
  
  **Where it fires: `content-build lint` only.** This is a frontmatter-schema rule,
  and `content-build site` runs none of them; wiring one type's field rule in there
  would have the site build refuse `shortcode` on a homepage while accepting
  `weight: heavy` on a weapon. The gap that leaves is `HarnMaster-3-FoundryVTT`,
  which runs no `content-build lint` at all and so receives no frontmatter finding
  of any kind — a missing script in that repository rather than a rule to duplicate
  one at a time.
  
  Each finding is located at the offending key and says what the field would have
  decided:
  
  ```text
  assets/content/homepage.md:26:1: error: `shortcode` decides nothing on a `type: homepage` note: this page's address is the package's own, `/<package>/`, fixed by the package id. It is not ignored either — it puts the note in the address index, so `[[homepage-<shortcode>]]` resolves to a page the site build never writes. Delete it
  ```
  
  **Minor rather than major, measured rather than assumed.** A new hard error is
  breaking only if it fails a previously-passing consumer. All six HeroicLands
  content packages were linted at their default branch, before and after — `sohl`,
  `hm3`, `thalorna`, `kethira`, `harnensemble` and `harnadventures` — and every one
  produces byte-identical findings and the same exit code with the rule as without
  it. None of the six authors any of the three fields on its homepage.
- d1166d0: Require exactly one `type: homepage` note per package (#52).
  
  Every package is reachable at `/<package>/` and what a reader finds there is one
  authored note in its content tree — but nothing required a package to have one,
  so the failure mode of the whole arrangement was a package that builds green and
  serves nothing at its own address.
  
  **Zero and two are the same defect, at the same severity.** Neither is a warning,
  because a build that proceeds past either publishes the wrong front page while
  reporting success — which is exactly what a warning tolerates.
  
  | Count    | What ships                                                                                                                                                                       |
  | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | **Zero** | Nothing at `/<package>/`, silently: the site build reports `wrote 0 homepage(s)` and exits 0.                                                                                    |
  | **Two**  | A page nobody chose. Both are written to the same `_index.md`, so the last one walked wins — the front page decided by _filename_, on a type whose point is frontmatter routing. |
  
  **It fires in `content-build lint` and in `content-build site`, because neither
  one reaches every package.** `HarnMaster-3-FoundryVTT` runs `site` and no `lint`;
  `sohl-thalorna` runs `lint` and its own site builder. A rule in one of them is a
  rule two of the six packages do not have. Both call the same function, so this is
  one rule with two call sites rather than two rules that can drift. In the site
  build it runs _before the output tree is cleared_, so a failing gate cannot
  destroy a good site to report a bad tree.
  
  **It does not vary by `publish.site`.** That setting chooses whether the
  _content_ surfaces are published; the homepage is the floor beneath both modes.
  The lint call site reads no `site:` block at all, so it could not vary by mode
  even if the rule wanted to.
  
  **Zero has no file to name, and none is invented.** The locator is the content
  root — a real path, and the directory the note has to be added to — with no line
  and no column, as the diagnostic rules require. Two is reported once per note,
  located at its own `type:` value and naming the other, because each note is a
  place an author has to open and edit:
  
  ```text
  assets/content: error: holds no `type: homepage` note, so package "sohl" publishes nothing at its own address /sohl/ — a package's front page is one authored note in this tree, routed by `type:` rather than by filename
  assets/content/homepage.md:3:7: error: duplicate `type: homepage` note, also declared by assets/content/Landing.md; a package has one front page, at /sohl/, and every homepage is written to the same `_index.md` — so the one the walk reaches last silently overwrites the rest
  ```
  
  **Minor rather than major, measured rather than assumed.** A new hard error is
  breaking only if it fails a previously-passing consumer. All six HeroicLands
  content packages were run at their default branch, before and after: `sohl`,
  `hm3`, `thalorna`, `kethira`, `harnensemble` and `harnadventures` each carry
  exactly one homepage note, and every one produces byte-identical findings and the
  same exit code with the check as without it.
  
  The issue's sequencing — ship it inert, flip it to an error later — was written
  when the count was ~45 repositories and two homepages existed only in unmerged
  pull requests. Both have since merged, the real count is six, and every one
  passes today, so the warning window would protect nobody and the flip would be a
  second pull request for no reason.

## 6.0.0

### Major Changes

- 5538fdf: Check `packFolders` against the derived `packs[]` (#81).
  
  `packageBuild.manifest.packFolders` is the one **declared** manifest key that
  names something the build **derives**. Every other declared key states a fact
  about the package (`title`, `socket`, `grid`) or addresses a staged file
  (`esmodules`, `styles`, `languages`) — a staged file being a different relation,
  answered against the stage rather than against configuration. Surveyed across
  all six HeroicLands packages, no other declared key names a derived value, so
  this is the only place the two halves could drift.
  
  They did. `HarnMaster-3-FoundryVTT` shipped a folder naming `character`,
  `possessions`, `esoteric` and `system-help`; three had not existed since its
  compendium was consolidated into one `items` pack, and `items` — 1,577 of 1,597
  documents — was named by no folder at all. Foundry rendered the folder holding
  one journal pack with the entire item compendium loose beside it, and the build
  reported nothing at any point (HarnMaster-3-FoundryVTT#420).
  
  **Two findings, deliberately different severities**
  
  | Finding                                         | Severity    | Why                                                                                                                 |
  | ----------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
  | a folder names a pack the package does not ship | **error**   | Foundry silently skips a name it cannot resolve, so the declaration does nothing; no arrangement intends it         |
  | a pack no folder names                          | **warning** | legal, and a root-level pack can be deliberate — but a package that declared a folder rarely meant to leave one out |
  | no `packFolders` declared at all                | nothing     | everything at the root is an arrangement, not an omission                                                           |
  
  Giving the two one severity gets one of them wrong: erroring on an ungrouped
  pack fails working packages over a matter of taste, and warning on an
  unresolvable name reproduces the defect this exists to catch.
  
  The comparison descends through nested folders — Foundry's
  `PackageCompendiumFolder` re-declares itself while `depth < 4` — so a nested
  name is checked in both directions rather than being missed and then reported as
  ungrouped.
  
  **Reported where the reader can open it**
  
  Findings carry the config key path of the offending scalar, which
  `positionOfYamlPath` (new, in `engine/diagnostics.mjs`) resolves against the
  configuration file. A position that cannot be established honestly — an `.mjs`
  configuration, an unreadable file — is dropped rather than guessed, so the line
  degrades from `file:line:column:` to `file:` to no locator:
  
  ```text
  package-build.config.yaml:164:23: error: packFolders: folder "HârnMaster 3 System" names pack "character", which this package does not ship (packs: items, system-help)
  package-build.config.yaml:162:13: warning: packFolders: pack "items" is named by no folder, so it ships outside every folder this package declares
  ```
  
  An error **stops the write**: a manifest already known to describe packs that do
  not exist should not reach the stage, where the next command would deploy it.
  
  **Why major**
  
  It newly fails a build that passes today. Measured against every real consumer
  as each stands: `sohl`, `sohl-kethira-basic`, `harn-ensemble` and
  `harn-adventures` are clean; `sohl-thalorna` warns once, for an `actors` pack no
  folder names, and still builds; and `HarnMaster-3-FoundryVTT`'s `main` fails
  with the three errors above, which is HarnMaster-3-FoundryVTT#420 — filed, and
  fixed in its open PR #426. That is a real defect reported rather than
  accommodated, but it is still a red build a consumer would meet on a blind
  upgrade, so it takes the major.
  
  Also new and exported: `packFolderFindings` (the rule, pure) from
  `@heroiclands/package-build/manifest`, `positionOfYamlPath` from
  `@heroiclands/package-build/engine/diagnostics`, and `packConfigPath` from
  `@heroiclands/package-build/engine/pack-config` — the file `loadPackConfig`
  actually read, so a finding about a configured value names it rather than
  re-deriving a path free to disagree. `writeManifest` takes an optional
  `configFile`; omitting it costs the position, not the finding.

### Minor Changes

- 46e0c10: Check the package homepage's own links (#54).
  
  The homepage is the page a reader arrives at, and it was the one page nothing
  checked. Every other note addresses the corpus with wikilinks, which
  `content-build links` resolves; a landing addresses the web the way the web does
  — markdown links and `landing:` `url` / `href` fields — and none of those went
  through a checker at all. SoHL's landing pointed at `kb/creature/` and
  `kb/character/` from the day those two types merged into `being`: two 404s on
  the package's front page, surviving every build, found only by a person reading
  the page.
  
  **Both halves of the note are in scope, and the real pages are why.** Of the six
  homepages authored today, four carry every link in the body as ordinary markdown
  and two carry them in `landing:` front matter — and the one whose dead links
  prompted this has an _empty body_. A body-only check would have found nothing on
  the page it was written for. So `landing.install.url`, every card and card-link
  `url` / `href`, the markdown links inside the prose fields (`lead`, `closing`,
  `install.intro`, `install.note`, a card's `description`, a link's `note`) and the
  body's own markdown links are all read.
  
  **`url` and `href` are not the same address.** The theme resolves a `url`
  against the site with `relURL`, so a package writes `kb/rules/` and is served
  `/sohl/kb/rules/` without naming its own prefix; an `href` is an address that is
  _already_ resolved and is used verbatim, which is what `cards.source: sections`
  fills in. A leading `/` is therefore a defect in a `url` — Hugo prefixes it a
  second time — and correct in an `href`, so the two are not checked the same way.
  
  **What is reported**, each finding naming the form to write instead:
  
  | Finding                      | Why                                                                        |
  | ---------------------------- | -------------------------------------------------------------------------- |
  | A **retired content type**   | `kb/creature/` after `creature` became `being` — the engine knows.         |
  | A **hardcoded absolute URL** | Into this package's own prefix, or into one a vendored manifest names.     |
  | A **root-relative `url:`**   | `relURL` prefixes it again. `href:` is exempt — verbatim is what it means. |
  | A **wikilink**               | Nothing resolves one here: a homepage is published verbatim in every mode. |
  
  That last one settles a question rather than deferring it. A homepage does
  **not** get the wikilink resolution every other note body gets, because in
  `homepage` mode the content tree is never walked — there is no index for a
  wikilink to resolve against, and giving the page one would make the mode depend
  on exactly the machinery its licensing fence exists to not build. A wikilink on
  a landing is therefore reported, not resolved.
  
  **What is deliberately not attempted.** Whether an external URL answers: there is
  no network at build time and a build must not go red because a third party is
  down. And whether a live in-site address names a page that exists: several
  surfaces a landing routes to are produced by other tools entirely — generated API
  documentation, hand-authored Hugo sections — so this build does not hold the set
  of published pages and would report a working link as dead. A bare
  `https://www.heroiclands.org/<package>/` is left alone for the same reason it
  cannot be improved: a package homepage is in no link manifest, so there is no
  better form to write.
  
  **Minor rather than major, measured rather than assumed.** A new lint error that
  fails a previously-passing consumer would be breaking. All six HeroicLands
  content packages were run against it — `sohl`, `hm3`, `thalorna`, `kethira`,
  `harnensemble`, `harnadventures`, including the two homepages that exist only in
  open pull requests — and every one is clean; the four whose trees are checked out
  in full pass `links` end to end. Run against SoHL's landing as it stood _before_
  the port, the check reports both dead links, at their line and column.
  
  It rides in the existing pass rather than beside it: no new command, no second
  walk, and a consumer that already runs `content-build links` gets it with no
  change.
- d8ce7b3: Derive the compile order from what each pass reads, instead of trusting the
  order `packs:` happens to declare (#73).
  
  `generatePacksJson` ran its passes in declaration order, but the actors pass
  resolves each being's embedded items against the **output** of the item passes —
  the JSON under `build/packs-json/`, not the content tree. A package declaring its
  Actor pack first therefore compiled only where an earlier run had already left
  that directory populated: green on every local tree that had built once, exit 1
  on a cold one, over a message naming a missing directory rather than the ordering
  that caused it.
  
  `build/` is gitignored, so **every fresh checkout and every CI runner is cold**.
  `sohl-kethira-basic` shipped exactly that list and its release path was broken;
  the failure had not fired only because an unrelated lint failure exited first.
  
  **What changed**
  
  - A compiler declares the document types whose compiled output it reads —
    `static readsPackOutputOf` on `BasePackCompiler`, `["Item"]` on `Actors`. A
    consumer registering a compiler of its own declares its dependencies the same
    way.
  - `orderPassesByDependency` (exported from `engine/generate.mjs`) schedules each
    pass after **every** pack of every type it names — a being addresses an item by
    `(type, shortcode)` without knowing which Item pack ships it, so waiting for
    one of several would resolve some beings and silently fail others. The
    reordering is the smallest one that works: the earliest declared pass whose
    dependencies have all run goes next, so a list already in a workable order is
    compiled exactly as declared. The build logs the derived order only when it
    differs from the declared one.
  - **The declared list is untouched**, which is the point: it is also the
    manifest's `packs` array, and a consumer orders that for a reader browsing
    compendiums. The two are now allowed to disagree, so fixing a cold build no
    longer means reordering the shipped manifest away from its `packFolders`.
  - The case ordering cannot answer — `content-build package compile <name>`, which
    runs one pass and no other — is now reported in this project's diagnostic form,
    naming the pack that waits, the pack it waits on and the fix, instead of
    throwing about a directory:
  
    ```text
    error: pack "characters" (Actor) reads the compiled output of the Item pack
           "characteristics", which this run does not compile and which
           build/packs-json/characteristics does not hold — compile the whole
           package, or compile "characteristics" first
    ```
  
  **Bump**
  
  _Minor, not patch, and not major._ Minor because it adds public surface: two
  exports on `engine/generate.mjs` and a third documented static switch on
  `BasePackCompiler`, which is the registration point for a consumer's own
  compiler.
  
  **No previously-passing consumer build starts failing.** The change is strictly
  permissive — configurations that failed now succeed, and configurations that
  succeeded compile the same documents. Of the four HeroicLands packages, three
  (`sohl`, `sohl-thalorna`, `HarnMaster-3-FoundryVTT`) declare an order the
  derivation returns unchanged; `sohl-kethira-basic` is the one that moves, and its
  `build/packs-json` is **byte-identical** across the two orders — 385 documents,
  `diff -r` exit 0. The new single-pack diagnostic replaces a throw on exactly the
  runs that already failed.
- f716902: Stop emitting `isEquipped` on a compiled gear item (#68).
  
  `GEAR_COMMON` emitted `isEquipped: false` on every gear item, and no SoHL
  DataModel declares the field. `GearDataModel` declares `isCarried`,
  `containerId` and `sharedWithCohortIds` as its possession state, and nothing
  else — Foundry discards the extra key when the document is constructed, so
  every gear item in every consuming pack shipped a value that was thrown away at
  load, with nothing at compile or load time saying so.
  
  `GEAR_COMMON` is spread into all six gear types (`armorgear`, `concoctiongear`,
  `containergear`, `miscgear`, `projectilegear`, `weapongear`), so this reached
  every gear item of every consuming package.
  
  This is the second instance of #35's defect and has the same root cause:
  nothing compares a builder's emitted `system` block against the DataModel that
  receives it. The general check is #60.
  
  **The field was retired, not renamed.**
  Song-of-Heroic-Lands-FoundryVTT#662 made the worn/equipped concept armour-only:
  it removed `system.isEquipped` from the shared gear data model and gave
  `ArmorGearDataModel` its own `system.isWorn`. That shipped in SoHL 0.8.0, so no
  released system has read the key since. `isWorn` belongs to armour alone and is
  not a target this declaration can be retargeted at — whether an `armorgear`
  note should be able to author one is a separate content question, left open on
  #68.
  
  **Nothing to sweep.** Unlike `assocMysteryCode`, this was never authorable: the
  declaration carried a `to` and a `value` but no `name`, so `readField` never
  consulted the frontmatter and no note in any package could set it. It was
  already absent from `authoredFields`, so the author-facing field reference is
  unchanged. A consumer has no line to delete.
  
  **This changes emitted documents**, so a consumer wants a rebuild rather than a
  silent upgrade — though nothing downstream can have depended on the value.
  Verified by recompiling two consumer trees at `main` before and after, comparing
  every emitted document key-ordered:
  
  - `sohl` — removes exactly 1019 `"isEquipped": false` keys from 1012 of its 3126
    compiled documents: 1010 items (465 `miscgear`, 331 `armorgear`, 114
    `containergear`, 82 `weapongear`, 18 `projectilegear`) and 9 more embedded in
    gear-carrying actors. No other difference, and no document added or removed.
  - `sohl-thalorna` — removes 97 of 2018 across 2555 documents (96 items: 71
    `concoctiongear`, 25 `weapongear`). No other difference.
  
  **A consumer that embeds a foreign item catalogue keeps the key until its
  upstream republishes.** The 1921 `sohl-thalorna` occurrences this does not
  remove are not emitted by this build at all: they are inherited verbatim from
  the pinned `sohl@0.8.2` release pack its actors resolve against, which was
  compiled by an earlier package-build. They clear when `sohl` cuts a release
  built with this version, not before — so a consumer grepping its own output
  after upgrading should expect the catalogue's share to remain.
- 07944a2: Resolve the `sohlKb` TypeDoc symbol map against the repository root, and stop
  swallowing every failure to read it (#75).
  
  `site.passOptions.symbolMap` is authored repo-relative, but `readSymbolMap` read
  it against the process cwd and wrapped the read in a bare `catch` that returned
  `{}`. A missing file, a malformed one, a permissions error, a path typo and a
  correctly configured build with no symbols were all indistinguishable — and the
  build exited 0 either way, publishing every `{@link}` as a code span instead of
  a link into the API documentation. Driving `content-build site` from outside the
  tree through `PACKAGE_BUILD_CONFIG` — how #51 was verified — silently dropped
  224 API links across 25 pages of the `sohl` knowledgebase, and nothing at any
  stage reported it.
  
  **What changed**
  
  | State                                  | Before               | Now                                          |
  | -------------------------------------- | -------------------- | -------------------------------------------- |
  | `symbolMap` unset                      | `{}`, silent         | `{}`, silent — unchanged                     |
  | Configured, readable                   | works from repo root | works from **any** directory                 |
  | Configured, missing / unreadable       | `{}`, exit 0         | build fails, naming the path and `errno`     |
  | Configured, malformed JSON             | `{}`, exit 0         | build fails, naming the path and the JSON    |
  | Configured, JSON that is not an object | `{}`, exit 0         | build fails, naming the path                 |
  | Configured, read                       | nothing              | `resolved N API symbols from <path>` at info |
  
  The count is reported because a map that loaded and a map that loaded _empty_
  are otherwise indistinguishable without reading the emitted HTML, and an empty
  one degrades every tag exactly as a missing one used to.
  
  **Bump**
  
  _Minor, not patch._ No key, export, or flag changed shape, and a consumer whose
  map is where its configuration says it is sees only the new info line. But a
  build that previously exited 0 can now fail — deliberately — which reverses the
  module's own documented licence to run the knowledgebase before `npm run docs`
  and publish degraded tags. A consumer that orders its pipeline that way must
  either generate the map first or leave `symbolMap` unset. No known consumer is
  affected: `Song-of-Heroic-Lands-FoundryVTT` commits `kb/data/api-symbols.json`.

### Patch Changes

- bb08713: Stop `content-build lint` failing a homepage-only content tree (#77).
  
  A package in `publish.site: homepage` mode may hold exactly one note, and a
  homepage carries no `shortcode` **by design** — it is addressed by the package
  rather than by a slug, so `HOMEPAGE_FIELDS` is empty. The vacuous-tree guard
  keyed off the address map, so that tree produced no keys and was reported as a
  missing checkout:
  
  ```text
  assets/content: error: holds no keyed content, so every rule here is vacuous — check that the content tree is present and that this is its root
  ```
  
  The tree was present, it was the root, and it held the one note the package is
  meant to have. `harn-adventures` and `sohl-kethira-basic` both ship in that
  mode, so for them the failure was permanent — and an expected failure trains its
  author to stop reading the output, which is the one thing this guard needs them
  to do.
  
  The guard now reports an **empty walk** rather than an empty key set: a tree
  holding notes is a tree, whatever they are keyed on, and only a tree holding
  none is the absent one. Nothing about its strength changes — an empty tree, a
  tree of untyped scaffolding, and a path that is not the content root each still
  fail with the same diagnostic, now worded "holds no content notes".
  
  `patch`, not `minor`: no tree that lints today reports anything different. The
  only behaviour that changes is a false failure becoming a pass. The success line
  gains its missing noun — `(0 address(es) across 1 note(s))` — since a
  homepage-only pass is the first time it prints a zero.

## 5.0.0

### Major Changes

- 4da0dbc: Every package publishes an authored homepage at `/<contentPackage>/`, and
  `publish.site` becomes a mode rather than a boolean (#51, #55).
  
  **A `type: homepage` note (#51)**
  
  A new engine-level content type that compiles into a **page** rather than into a
  compendium document. Its whole frontmatter envelope is `type` and an optional
  `title`, defaulting to `packageBuild.manifest.title` so the package's name is not
  written twice:
  
  ```markdown
  ---
  type: homepage
  title: HârnMaster Kethira Basic
  ---
  
  What the module is, which system it needs, how to install it.
  ```
  
  It compiles into no document, appears in no pack and in no link manifest, and is
  addressed by the **package** — `/<contentPackage>/` — rather than by a slug
  derived from its name, so `name.full`, `shortcode` and `id` decide nothing on it.
  It is written at the root of `site.out`, one level above the content mount.
  
  The page is _authored, not assembled_. Deriving it from the manifest, the release
  address and `relationships` was the obvious shortcut and produces a page nobody
  chose the contents of — it cannot express that Kethira requires buying the book
  from Keléstia, or which of twenty sections a reader should start with.
  
  It is declared in `engine/note-schemas.mjs` rather than in the `sohl` item
  registry: the `engine/` ÷ `sohl/` line is note-format knowledge against
  game-system knowledge, and a homepage carries no `system` block and mirrors no
  item builder. Reachability is the symptom that makes it obvious —
  `HarnMaster-3-FoundryVTT` declares no `itemBuilders` at all, so a type living in
  the SoHL registry would be unavailable to HM3 and every HM3 module, which is most
  of the packages that need a homepage and nothing else.
  
  **`publish.site` is a mode (#55) — breaking**
  
  | Was           | Write                              |
  | ------------- | ---------------------------------- |
  | `site: true`  | `site: content`                    |
  | `site: false` | `site: homepage`                   |
  | absent        | absent — the default is `homepage` |
  
  `homepage` publishes the authored homepage and **no other page**; `content`
  publishes it plus every page the content tree compiles to. There is no value
  meaning "no web presence", because every package publishes its homepage.
  
  Both booleans are **refused rather than mapped** onto the nearest mode, naming
  the mode to write. `false` read as _this package has no web presence_, which
  describes no package now, and a value silently reinterpreted reads to its author
  as though it still means what it said.
  
  **Homepage-only is a first-class mode, not an accommodation.**
  `sohl-kethira-basic` (Keléstia Productions' Fan Material Guidelines) and
  `harn-adventures` (HârnFanon under Lythia's terms) each publish a homepage and
  nothing beneath it — two packages under two different fan-content licences. The
  boundary is _published content_: journal text, artwork, item descriptions,
  compiled notes. Because the failure mode is silent — a `site:` block added later
  ships licensed content with nobody noticing — the mode **fences the content
  surfaces off**: in `homepage` mode the tree is never walked for pages, and
  `sections`, `trees`, `landing` and `backfillSections` emit nothing even when they
  are declared. Measured against the real `sohl-kethira-basic` tree — 363 notes,
  and a `site:` block deliberately declaring sections and a landing — the build
  emits exactly one file.
  
  `publish.manifests.publish` is a separate decision and stays `false` for both, for
  an unrelated reason: a link manifest is the dependency edge that would stop a
  module being withdrawable, and a homepage is one row in a routing table.
  
  **Nothing else moves.** `publish.address`, `publish.manifests` and the whole
  `site:` block are unchanged, and every address `sohl` already publishes is
  byte-identical across the upgrade. Verified against the real tree: 1,669 emitted
  files before, 1,670 after, the one addition being `kb/content/_index.md`; the
  link manifest's 2,989 entries and all 3,126 compiled pack documents are
  byte-identical with and without the homepage note.

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
