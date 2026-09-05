## Content format: how a note becomes documents

### Documentation

All markdown will end up generating a JournalNote document: If anything appears before the first H1 header, that will be placed in an "Introduction" page, and then every H1 header will become a subsequent page. The link id of this document will be `<package>-none-<note_type>-<shortcode>`

If there are `hm3` or `sohl` sections in the frontmatter, those will be used to generate InfoBoxes, which will be displayed as a separate page (named "SoHL InfoBox" and "HM3 InfoBox", with anchors sohlinfobox and hm3infobox)

**There are two kinds of infobox.**

A **note infobox** summarises the subject itself, from `data:` — a scenario's
length, party size and required archetypes; a place's subtype and its parent; a
weapon's weight and value. None of that is SoHL or HM3 information, and it
deserves a summary panel all the same. Any type that declares `data:` fields has
one.

A **system infobox** summarises what one system makes of the note, drawn from
that system's block. There is one per system, and they are not alike: the two
systems describe a weapon with different values for impact, heft, reach and draw,
so neither box can stand for the other.

**Which boxes appear is decided by the note type; what they say is decided by the
note.** A type that both systems support always shows both system boxes, and a
box whose system this particular note produces no document for reads
**"Not available"**.

| note type                                                         | system boxes shown                                 |
| ----------------------------------------------------------------- | -------------------------------------------------- |
| `weapon`, `skill`, `being`, `armor`, `containergear`, `miscgear`… | SoHL **and** HM3 — either may read _Not available_ |
| `affiliation`, `affliction`, `attribute`, `concoction`, `mystery` | SoHL only                                          |
| `armorlocation`                                                   | HM3 only                                           |

This is stated rather than inferred from an empty block, because an absence is a
poor signal: noticing that something is missing requires already knowing it
should have been there, and a reader meeting one page has no way to know. A box
that says _Not available_ tells them outright.

It also separates two facts that an absence would conflate. `Spear (thrown)` is
HM3-only while spears plainly exist in SoHL — _that_ note has no SoHL form, and
its SoHL box says so. HM3, by contrast, has no affiliations, mysteries or
attributes **at all**; on those pages a box reading "Not available" would suggest
a gap in the note when the truth is about the system's scope, so no HM3 box is
drawn.

The set of boxes needs no new declaration: the note-type → document-subtype map
already records which systems each type reaches. Rendering one box per mapped
system makes the page checkable — _every page carries exactly the boxes its type
maps to_ is an assertion the build can make, so a missing infobox is a failure
rather than something nobody notices.

For Web Pages, the entire markdown content will be converted into an HTML page, with appropriate infoboxes.

### Frontmatter has three regions

A note's frontmatter divides into three parts, and the difference matters because
only one of them is open:

| region               | describes                                                                                      | unknown keys               |
| -------------------- | ---------------------------------------------------------------------------------------------- | -------------------------- |
| **top level**        | the note as a published artefact — `id`, `type`, `subType`, `shortcode`, `description`, `tags` | **passed through to Hugo** |
| **`data:`**          | the subject itself — system-agnostic, specific to the note type                                | **an error**               |
| **`sohl:` / `hm3:`** | the subject as one system's documents                                                          | **an error**               |

**Top level is deliberately open.** Every key is copied into the generated web
page's front matter, so an unrecognised key is a Hugo or theme parameter this
build has no standing to refuse. `description` is the everyday case: it is not a
document field at all, it is the page's description.

**`data:` is deliberately closed.** It holds the type-specific facts about the
subject — a weapon's weight, an affliction's transmission, a being's species —
and every note type declares which keys it may carry. A misspelled key there is a
finding that names the key you meant; the same misspelling at top level would
silently become a theme parameter, which is exactly why these cannot live
together.

**Tags are open, except the ones that classify.** `tags:` shares the top level's
openness: a tag naming a theme or a region — `underworld`,
`byzaria`, `riverlands` — is the author's own and this build has no opinion about it.
A tag that classifies the subject is different, because something queries it. A
settlement tagged `village` appears in the list of villages and an untagged one
does not, so `vilage` does not merely look wrong: it removes the note from an
index, silently, and the index still renders. That is the same failure a
misspelled `data:` key used to be, and it gets the same answer — the vocabulary
is declared, so a near miss is a finding that names what you probably meant.

| group               | applies to             | tags                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **place kind**      | `place` / `settlement` | `city`, `city-state`, `town`, `village`, `settlement`, `port`, `fortress`, `citadel`, `castle`, `stronghold`, `garrison`, `camp`, `oasis`, `waypoint`, `post`, `precinct`, `district`, `necropolis`, `hall`, `capital`                                                                                               |
| **place character** | `place`                | `fortified`, `temple`, `market`, `trading`, `merchant`, `mining`, `fishing`, `naval`, `military`, `imperial`, `provincial`, `coastal`, `river`, `lakeside`, `hill`, `mountain`, `valley`, `forest`, `woodland`, `inland`, `island`, `frontier`, `border`, `craft`, `caravan`, `pilgrimage`, `holy`, `sacred`, `free` |
| **place scale**     | `place` / `region`     | `continent`                                                                                                                                                                                                                                                                                                          |
| **being station**   | `being`                | `tradesfolk`, `common-folk`, `soldiery`, `administration`, `clergy`, `mages`, `underworld`, `dependents`, `guilded`, `unguilded`                                                                                                                                                                                     |
| **state**           | any                    | `draft`                                                                                                                                                                                                                                                                                                              |

**`draft` is the one tag either build reads.** A note tagged `draft` exists so a
link into it is not dead, and a link into it renders marked — as
`<span class="sohl-draft-link" title="Draft — not yet written">…</span>` in a
compiled journal and on the website alike, with the appearance supplied by the
consuming system's stylesheet or the site theme. **Nothing else changes**: the
note compiles, validates, publishes and resolves exactly as any other, and it
stays in the packs, in the link manifest and on the site. That is what separates
the tag from the retired `draft:` field, whose whole effect was to move a note
from published to unresolvable without saying so — and which is refused, by name,
if you write it.

**The group's scope is what makes the check work.** A group names the types it
applies to, and a place's kinds are only ever checked on a place. Without that
the rule is wrong on every note it touches: `azravan` on a faith, `barter` on an
economy note and `secret` on three lore notes each sit a typo's distance from
`caravan`, `border` and `sacred`, and none of them is a mistake. Scoped, the same
corpus reports nothing — while a settlement tagged `vilage` is still caught, even
beside a correct `town`.

**Kind and character are separate because one slot could not hold both.** A
fishing village is a `village` that is `fishing`, and the field this list
replaced had to spell that `Fishing Village` as a value of its own — which is why
a query for villages found two of the eleven that existed.

**A station is not a rank.** Which kind of body a person belongs to — the
clergy, the soldiery, the tradesfolk — is a different axis from where they stand
inside one, which is what `data.lore` carries by naming the rank. A tag holds the
first because a person may be several at once and because nothing ranks
`clergy` against `mages`.

**A continent is a region carrying a tag, not a subtype**, because structurally it
is a region: the same fields, the same parent chain, everything but scale.

The mapping tables below describe the **document** destinations. A key that
appears in no table still reaches the web page; it simply reaches no Foundry
document.

**The shared source is a default; the system block overrides it.** Where a field
can be reached two ways — `data.weight` through the mapping table, or
`sohl.system.weightBase` written directly — the value in the system block wins.
`data:` says what is true of the thing in general; a system says what is true of
it _there_, and a system that disagrees is not in error. A weapon weighs what
`data.weight` says unless SoHL says otherwise, and then SoHL is right for SoHL.

This is the same rule as `hm3.type` overriding a derived document type, applied
to fields: derive from the shared source, and let the system state the exception.

**A field whose spelling means something else at the note level has no shared
source.** The fallback assumes the two vocabularies agree about what a name
means, and they do not always: a note's top-level `title` is the heading its page
publishes under, while an `affiliation` item's `system.title` is the style of
address an office carries. Where they diverge, the field declares what the
top-level key means instead, and the top level stops being read for it — leaving
`<system>.system.<field>` and the legacy in-block position, which describe the
document rather than the note. `title` is the one field this applies to; `subType`
is the other declared item field spelled like a note-level key, and there the two
levels mean the same thing by design.

**A `WikiLink` becomes a shortcode where the target field expects one.** SoHL
stores cross-references as shortcode strings, which is what the `Code` suffix
marks: `data.assocSkill` is a link to a skill note, and `system.assocSkillCode`
holds that note's shortcode. The resolution happens at build time, and a link
that resolves to nothing is an error naming the note — never a blank field. Where
a target field has no `Code` suffix, the link is stored as the reference the
field expects.

### The note vocabulary, and how it maps

A note has its own `type` and `subType`. **This is a third vocabulary** — not
SoHL's and not HM3's. It says what the note _is_ and the scope it covers,
irrespective of whether it becomes an Actor, an Item, a JournalEntry or nothing
at all in any particular system.

Each system then declares a map from the note's `(type, subType)` onto its own
document type — and, for SoHL, its own `system.subType`. The map is **declared**,
never inferred from a coincidence of names: `skill`, `weapongear`, `armorgear`,
`containergear` and `miscgear` exist in both systems with _different_ data
models, so name-matching there would not fail, it would succeed wrongly.

Because the map derives the document type, `hm3.type` and `sohl.system.subType`
are **overrides**, not required declarations. A note states them only when the
map cannot decide, or decides wrongly.

**Four rows cannot decide, and there `hm3.type` is required.** HM3 splits four
of the note vocabulary's types across several documents — `mysticalability` into
a `psionic`, a `spell` or an `invocation`; `trauma` into an `injury` or a
`trait`; `weapongear` into a `weapongear` or a `missilegear`; `being` into a
`character` or a `creature`. Nothing in the note's own vocabulary partitions
cleanly onto any of those splits, so the note says which, in its own block, and
a note that says nothing is **an error naming the note and listing the permitted
values**. It is never defaulted: a default would pick one and be right about
half the time.

A consequence worth knowing before you author a being's embedded items: a
`(type, shortcode)` reference has no block of its own to read a discriminator
from, so it **cannot address a one-to-many type**. `[[weapongear-spear]]` names
no single HM3 document, and the reference is refused rather than resolved to
whichever came first.

A note whose `(type, subType)` has no mapping for a system it carries a block
for is an **error naming the note**, never a silent skip and never a guess at the
first matching value. Where a mapping is missing for a whole class of note, that
is a gap in the vocabulary rather than something to write into every note: an
override that thousands of notes need is a missing subType value.

### Mappings every type shares

Eight rows were identical in all sixteen tables below, so they are stated once
here and omitted there. Each per-type table shows only what is particular to that
type.

| shared source | → sohl | → hm3 |
| ------------- | ------ | ----- |

**A column reads NA wherever the type produces no document in that system.** An
`affiliation` has no HM3 form, so its whole HM3 column is NA; `armorlocation` has
no SoHL form, so its SoHL column is. Nothing else varies — which is why these
rows are worth stating once: repeated sixteen times they buried the differences
that matter.

Actor types (`being`, `vehicle`) add one more:

| shared source | → sohl | → hm3 |
| ------------- | ------ | ----- |

**One exception.** HM3's `armorlocation` declares no `notes` — it is the one
subtype that extends the Foundry base directly with no templates — so `notes` is
NA on both sides for that type, and its table says so.

#### The pack a note compiles into

`pack` names which configured compendium receives the note's document.

```yaml
pack: items-hm3
```

It is deliberately close to the retired `package:` and deliberately not the same
word: `package:` said which _distribution_ owned a note — now the repository's
`contentPackage`, and no longer authorable — while `pack:` says which
_compendium_ receives its document.

**It names the pack for the note's _own_ document.** A document derived from it
— an item's prose compiling into a `JournalEntry` of its own — is not what the
author was addressing, and is routed by the pass that produces it.

**`<system>.pack` overrides it for one system.** A note that compiles into two
systems can send each document to its own pack:

```yaml
pack: items-sohl
hm3:
  pack: items-hm3
```

**Unstated, the document goes to the pack of its type marked `default: true`.**
Where no pack of that type is the default, the build refuses rather than
guessing, and names the candidates.

Three declarations are refused, each with the reason:

| written                             | why it is refused                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| a **companion** pack                | A companion is written by another pack's pass, so no note may be routed into one. |
| a pack **nothing answers to**       | The message lists the configured packs of that document type.                     |
| a pack of **another document type** | A note's `pack:` names a pack of its own document type.                           |

#### Template priority: which template wins

A note can mark its document as a **starting template** the Create dialog offers
to clone from, so a new being or item is born populated rather than blank. The
value is a **priority**, and the priority is the whole mechanism — it decides
which of several competing templates a player is actually offered.

The shared mapping table above names it `data.templatePriority`, targeting
`system.templatePriority` in SoHL and `flags.hm3.templatePriority` in HM3.

> **What a note writes today is `archetype`.** The build still reads
> `sohl.archetype` and SoHL's data model still declares `system.archetype`. The
> name is now settled as `templatePriority` on all three sides — the authored
> key, `system.templatePriority`, and `flags.hm3.templatePriority` — and the move
> is tracked by `HeroicLands/package-build#266` here and
> `Song-of-Heroic-Lands-FoundryVTT#1836` in the system.
>
> It is more than a rename, and the collision is **already live** rather than
> pending: `archetypes` is specified above as the _sort_ a character is, and a
> being's row declares it. So a number deciding which template wins and a list of
> what sort of character this is are today distinguished **only by a plural
> `s`**. Both spellings of the priority are read through the transition.

```yaml
sohl:
  archetype: 0 # a template, at the priority SoHL's own ship at
```

```yaml
sohl:
  archetype: null # not a template
```

**Every note SoHL compiles into an Item or an Actor must state it.** Absent, the
build refuses: "not a template" has to be _said_, not left out, or an omission
and a decision look identical. The value is a number or `null`, and **`0` is a
real priority** — the one SoHL's own templates ship at — not an absence.

**Where it lands differs by system, because HM3's data model has no field for
it.** SoHL records it in `system`; HM3 keeps it under its own flag scope,
`flags.hm3`, and a note that is not a template writes nothing there rather than a
`null` nothing reads. HM3's _item_ pass does not emit it yet.

**How a winner is chosen.** Opening a Create dialog gathers every candidate
across the world and every matching compendium, _including other modules'_. Those
are filtered to the `(type, subType)` being created, deduped by **`shortcode`** —
a template's stable identity, where the name is only presentation — and one
winner is taken per shortcode:

1. the highest priority;
2. then the nearest source — **world**, then **system**, then **module** — so a
   GM's own copy shadows a shipped one at equal priority;
3. then a stable UUID, so the answer never depends on load order.

**The reserved ranges make a collision predictable.** Two packages can easily
ship a template under one shortcode, and the number says which yields:

| priority   | reserved for               |
| ---------- | -------------------------- |
| `0`–`98`   | SoHL and HM3 themselves    |
| `99`–`999` | other HeroicLands packages |
| `1000`+    | everyone else              |

HeroicLands reserves everything below `1000`. Since the highest priority wins,
**anyone else's template always beats content shipped from here** — which is the
point: a module author can override a standard template without coordinating with
anybody, and be certain it takes effect.

#### The compendium folder

A note says which folder of its pack it lands in. Two spellings are read, and
`packFolder` wins where both are present:

```yaml
packFolder: Possessions/Consumables/Poisons and Toxins # a path
folder: ONXsqZAIZr2qzxTb # a Foundry id
```

**`packFolder` is a path** through the pack's folder file, `/`-separated, using
each folder's `name`. Sibling names are unique and no name may contain `/`, so a
full path identifies exactly one folder. A path the pack does not declare is a
build error naming every path it does.

**`folder` is a Foundry id**, and is unchanged: a note that names one is read,
resolved and emitted exactly as before.

**Which one a value is comes from the field it was written in, never from the
string.** A top-level path is a bare name, and a name is as alphanumeric as an
id, so there is nothing in `Possessions` to tell the two apart.

Note this is the _pack_ folder, not the note's directory. The directory is
`file.path` / `file.folder`, which a content table reads separately.

**A documentation journal is filed beside the document it describes**, so the
journals pack must declare that folder too. Where it does not, the build fails
naming the path — the folder files disagree, and that is worth catching at once.
The id spelling never noticed: it was passed across packs verbatim and validated
nowhere, so the journal simply carried a folder reference its pack could not
honour.

### WikiLinks

Twenty-seven fields in the tables below take a `WikiLink`, and a link is written
`[[target]]` or `[[target|label]]`. The target is an **address**.

#### The canonical address

```text
<package>-<system>-<note_type>-<shortcode>
```

Read it from the right: the last segment is always the shortcode, the one before
it always the note type, the one before that always the system, and the first the
package. Nothing is positional-by-guess — a segment means what its position says
it means.

The `<system>` segment is `none` for a note that belongs to no system, which is
most of them: `harnadventures-none-being-grod`. A note that exists only for one
system names it.

#### Shorter forms

The full address is the unambiguous form, and almost nothing uses it — 92 of
12,056 links in the current trees. The rest rely on shorter forms, each dropping
segments from the left:

| form                            | resolves by                                  |
| ------------------------------- | -------------------------------------------- |
| `package-system-type-shortcode` | exactly, always                              |
| `package-type-shortcode`        | `(type, shortcode)` within the named package |
| `type-shortcode`                | `(type, shortcode)` within this package      |
| `shortcode`                     | `shortcode` within this package — see below  |

The last row is the everyday case, and it means two different things by
context. In a **frontmatter field** the type segment is supplied by the field's
own declaration, so `tashal` is a complete address. In **body prose** there is no
field to supply it, so a bare shortcode is resolved across types and must match
exactly one; an ambiguity is an error naming the candidates.

**Parsing is positional counting from the right, and nothing else.** Every
segment is alphanumeric — shortcodes, **types** and **subTypes** are all
`^[A-Za-z0-9]+$`, systems come from a closed registry, and `contentPackage` is
alphanumeric — so the hyphen is purely a separator. There is no longest-match
against a roster and no vocabulary check before splitting.

**`type` and `subType` are held to that charset, not merely expected to meet
it** (#206). A type is the first segment of every address, so a hyphen in one is
read back as a segment boundary that was never meant as one. A `subType` reaches
no address since #204 retired sections, but it is held to the same rule all the
same: it is a vocabulary term the whole toolchain keys on, one closed set away
from being an address again, and a charset that holds for two of the three
segments and half of a fourth is a rule nobody can state. Both are checked
against the same constant a shortcode is checked against, and a note carrying a
hyphenated value is reported where it wrote it:

```text
Trauma/Blood_Loss.md:3:1: error: `subType` "blood-loss" is not a well-formed subType — a subType is letters and digits only (^[A-Za-z0-9]+$), the same charset a type, a shortcode and a contentPackage are held to. It is a vocabulary term the whole toolchain keys on, and one closed set away from being an address segment again, so a charset that held for every term but this one would be a rule nobody could state in a sentence
```

One declared value broke the rule and has been renamed: a `doc`'s `user-guide`
is now **`userguide`**. The old spelling was accepted for one transitional
release, as a warning naming the replacement, so the 43 `sohl` notes authoring
it were not invalidated by the release that renamed them. Every consumer tree
has swept, so the acceptance is gone (#210) and `user-guide` is refused by the
charset check — it contains a hyphen, which is the reason that always applied.
No retirement-specific code outlived the sweep.

That is a guarantee rather than an observation, and it holds: of **4,456 distinct
shortcodes** across the four content trees, not one contains a character outside
`[A-Za-z0-9]`. It is load-bearing, so relaxing the charset later would break
resolution with nothing to say so.

`type/shortcode` with a slash is the legacy form, still resolved so links written
before the vault migrated do not silently die. A slash is _unconditionally_ an
address separator — pipe or no pipe — so an unknown type before one is an error
rather than something to guess at.

#### Every link is an address, and every link carries a label

There is one namespace, and the pipe is required:

| written              | resolved as | displays                   |
| -------------------- | ----------- | -------------------------- |
| `[[WikiLink\|]]`     | an address  | the target note's own name |
| `[[WikiLink\|Text]]` | an address  | `Text`                     |
| `[[Name]]`           | nothing     | a finding                  |

**A link written without a label addresses nothing** (#180), and the correction
is always the same: write `[[type-shortcode|Text]]`.

The bare form used to name an **alias** — a note's own display name, or one of
the names it listed in `aliases:` — looked up within the citing note's type. It
was measured before it was retired, and the namespace was empty in practice:
across 8,305 wikilinks in three content trees, **not one** bare link resolved to
a note. What the index behind it did do was fold every note's `name.full` into
itself, so two notes of one type could not share a display name — a rules page
and a user guide page both called "Gear" were a build failure whose every
available fix moved a published URL (#179).

The top-level `aliases:` that fed it is **retired** and refused. The nested
`name.aliases:` is **not**: it is reserved for a use that does not exist yet, so
it is permitted and read by nothing — no index, no resolver, no lint rule, no
derived address. A note carrying one behaves exactly as one without it.

Requiring the label is also what makes positional parsing safe. Note names
contain hyphens — `Grukar-ahk` is a name, not a `Grukar` of type `ahk` — so a
target that does not parse as an address is reported as one that does not, rather
than split at an arbitrary place or quietly looked up somewhere else.

The **empty** label is not a way of writing no label. It says _address this
target, and show whatever it calls itself_ — so a note renamed later takes its new
name at every citation with no link edited. `[[x|]]` is labelled; `[[x]]` is not.

The link part may still be an anchor: `[[#slug|Text]]` addresses a section of the
page it is written on. It is the label that is required, not a target.

#### Every address resolves, and every build says so the same way

An address that names no note **fails the build** (#184) — in the link checker,
in the pack compilers and in the site build alike.

It was a warning in the checker and, in the site build, nothing at all while any
linkable package had no vendored manifest. The reasoning was that `[[Sunless
Vault]]` might be a placeholder for a note somebody meant to write. That was a
property of the **bare** form, which is retired, and the intent behind it has a
real spelling now: a note tagged `draft` exists, resolves, compiles and
publishes, and a link to it renders visibly marked (#183). So an address landing
nowhere is a typo or an omission, and both want fixing.

There are six ways a link can fail, and each is one **error** with one message
wherever it is met:

| finding          | what it means                                  | the fix                                   |
| ---------------- | ---------------------------------------------- | ----------------------------------------- |
| `unlabelled`     | no `\|`, so the link addresses nothing         | write `[[type-shortcode\|Text]]`          |
| `not-an-address` | labelled, but the target is not an address     | write the address, not the name           |
| `unknown-type`   | qualified, but names no type this build knows  | correct the type segment                  |
| `unresolved`     | parses as an address; nothing publishes it     | fix the shortcode, or vendor the manifest |
| `ambiguous`      | more than one package publishes the short form | write `[[package-type-shortcode\|Text]]`  |
| `unknown-anchor` | the address resolves; the `#section` does not  | correct the anchor                        |

The vocabulary and the messages live in one module (`engine/wikilink-syntax.mjs`)
precisely because an author meets whichever build ran first. Three resolvers read
one authored link; they must not describe the same mistake in three ways, and
they must never disagree about whether it is a mistake at all.

#### In frontmatter, a link is a bare address

A `WikiLink` **field** takes the address with no brackets:

```yaml
data:
  parents:
    - hexhodai
  seat: tashal
```

not `[[hexhodai]]`. The field is declared as a `WikiLink`, so the schema already
knows the value is an address and reads it as one; brackets would be punctuation
the reader has to strip before it can do anything.

A frontmatter value is parsed by the address grammar above, so a single-segment
value such as `hexhodai` is a _shortcode_. Frontmatter is structure rather than
prose: a field value is a reference something else will compile against, and it
should say exactly what it points at.

**The field supplies the type.** Every `WikiLink` field declares the note type it
targets — `seat` a `place`, `parents` an `affiliation`, `stations` a `lore` — so
the type segment defaults from the declaration and a bare shortcode is the
ordinary case, not an abbreviation of one. That is why the examples above read
`tashal` rather than `place-tashal`: the shorter form carries the same
information, because the field already said what kind of thing it points at.

**The declaration constrains the type; it does not shorten the address.** A field
value may be written at any length, and every length is equally correct so long
as the type it names is the one the field declares. All four of these are valid
in a `seat` field:

```yaml
seat: tashal
seat: place-tashal
seat: kethira-place-tashal
seat: kethira-none-place-tashal
```

An `affiliation-` prefix there is an **error naming the field and both types** —
never a silent widening of what the field accepts. Where a field permits more
than one type, a bare shortcode must resolve to exactly one of them, and an
ambiguity is an error naming the candidates rather than a first match.

**Only the type segment defaults.** Package and system are not the field's to
supply — it has no opinion about which package holds the target — so reaching
another package's note means qualifying, and because parsing is positional
counting from the right, qualifying at all means naming the type too.
`kethira-tashal` is not "the `tashal` place in `kethira`"; it is two segments, so
it reads as type `kethira`, shortcode `tashal`, and fails.

So the ladder has one rung where the field helps and three where it only checks:
a bare shortcode takes its type from the declaration, and every longer form
states the type itself and is verified against it.

This is enforced rather than merely preferred: the build walks every frontmatter
value, reports each bracketed link it finds, and reports each value whose
qualification contradicts its field. A successful run says so — _no wikilink in
frontmatter_ is part of what `content-build links` reports when it passes.

Brackets belong in prose, where a link sits inside a sentence and needs marking
off from the words around it. A frontmatter value has nothing to be marked off
from.

#### Not yet implemented

One rule in this section is settled but unbuilt, and describes the target rather
than current behaviour:

- **The `<system>` segment.** `readQualifier` reads package, type and shortcode;
  there is no system segment. A four-segment target today parses as
  `package-type-shortcode` with a hyphenated shortcode, or fails.
  The corpus is close to the rule already. Of 12,056 links, 10,413 are
  `[[type-shortcode|Label]]`, which is correct as written. Two authored links use
  an unpiped multi-segment target, and 69 use a pipe with a note name where an
  address belongs; those are the migration.

### What a note produces

Note types fall into two groups, and only the first has a mapping table.

**Types producing a system document** — a SoHL or HM3 Actor or Item, one per
system, described by the tables further down.

**Types producing only a core document** — `lore`, `place`, `scenario`, `doc`,
`map`, `macro` and `homepage`. A core document is one Foundry defines rather than
a system: a JournalEntry, a Scene, a Macro. These are system-agnostic, so such a
note carries no `sohl:` or `hm3:` block, has no mapping table, and shows no
**system** infoboxes.

It may still show a **note** infobox, and several should: a scenario's length,
party size and required archetypes, or a place's subtype and parent, are exactly
what a reader wants at a glance. Being outside both systems is not the same as
having nothing worth summarising.

Every note in **both** groups still produces its JournalEntry and its web page.
The difference is only whether a system Actor or Item is created as well.

### One note is at most one document per system

A note produces **at most one document in each system**. That constraint is worth
stating because the obvious counter-example is real, and the way it is resolved
shapes how weapons are authored.

SoHL gives a weapon **strike modes**: `system.strikeModes` on a single
`weapongear`, each mode melee or missile. A shorkana has four — the edge, the
blunt of the swung blade, the haft or pommel, and the throw. HM3 has no such
field: it assumes one usage per item, so those four modes are three
`weapongear` documents and one `missilegear`.

**The mechanical values cannot be shared, so the modes cannot be lifted into
`data:`.** Impact, heft, reach and draw all differ between the two systems even
where the concept matches. `data:` holds what the _thing_ is; how it performs is
each system's own, and belongs in that system's block.

**So the second document becomes a second note.** A `Spear` note carries a
`sohl:` block describing four strike modes and an `hm3:` block describing its
usual melee profile; a separate `Spear (thrown)` note carries **only** an `hm3:`
block, describing the missilegear. That yields two shortcodes, which is what HM3
needs, and the companion never appears in SoHL, which is what SoHL needs.

The population is small. Of HM3's eleven `missilegear` items, seven are distinct
objects with a SoHL counterpart — `Arrow (Longbow)`, `Bolt (Crossbow)`,
`Dart (Blowgun)`, `Stone (Sling)` and so on, which are ordinary notes carrying
both blocks. Only four are companions: `Javelin (thrown)`, `Shorkana (thrown)`,
`Spear (thrown)`, `Taburi (thrown)`.

**Every note carrying an `hm3:` block states its type.** Nothing can derive
whether `Spear (thrown)` is a `weapongear` or a `missilegear` — there is no other
system to infer from and no subType to read — and the same is true of the note
carrying both blocks, whose SoHL strike modes describe every usage at once. So
`hm3.type` is _required_ on both, not only on the companion.

The following special markdown sequences are recognized:

```
# Heading {#id .class1 .class2 attr="value"}
```

Any header can include curly braces. Inside the curly braces:

- `#id` represents an id anchor named `id` (only one allowed)
- `.class1` represents a CSS class named `class1` (any number of classes allowed)
- `attr="value"` represents an HTML attribute named `attr` whose value is `value` (any number of attr/value pairs allowed)

#### Content tables

A fenced `dataview` block is replaced by the table its query selects:

````markdown
```dataview
TABLE WITHOUT ID name.full AS "Name", shortcode AS "Code"
WHERE type = "armorgear"
```
````

**A query that selects nothing is a build error.** A zero-row table publishes as
a bare header and a rule, and a stale query — a renamed type, a retired
category, a typo'd path — is then indistinguishable from a category that is
legitimately empty. Eight tables in one note published that way for months after
a type rename, and no build said a word.

Where a table is _meant_ to be empty, say so on the fence:

````markdown
```dataview allow-empty
TABLE WITHOUT ID name.full AS "Name"
WHERE type = "affliction" AND sohl.kbcat = "not-written-yet"
```
````

The opt-in is on the fence rather than in the query because it is a statement
about this directive, not part of the query language. Either way the table is
still rendered — the finding is the point, not withholding the output.

##### In SQL, over the content index

`dataview` is being replaced by **SQL**, queried over the content index, and both
fences work while the corpus is converted (#246). The query is real SQL, run by
DuckDB — not a dialect maintained by this package.

````markdown
```sql
SELECT address.slug AS _ref,
       sohl.kbcat   AS _section,
       name.full    AS "Name",
       sohl.weight  AS "Weight"
FROM notes
WHERE type = 'miscgear'
ORDER BY sohl.kbcat, name.full
```
````

**`FROM notes`** is the content index: one row per note, plus one per
documentation entry, so `type = 'miscgear'` selects the items and never their
journals. A nested field is addressed exactly as a note authors it —
`sohl.weight`, `name.full`, `file.path` — because the index is read as JSON and
every nested object is inferred as a struct. A field a note type does not carry
reads `NULL` rather than failing.

**Two aliases are read by the renderer rather than printed**, because which
column links and where a section breaks are decisions about output, not
relational operations:

| Alias      | What it does                                                           |
| ---------- | ---------------------------------------------------------------------- |
| `_ref`     | Makes the row's **first** rendered column a wikilink to that address.  |
| `_section` | Emits a headed table per distinct value, in the order the rows arrive. |

`_section` is why one query replaces the forty near-identical blocks a grouped
table used to need: the authored `ORDER BY` decides the section order too. The
heading level is `##`, or whatever `sql section-level=3` says.

`sql allow-empty` works exactly as its `dataview` counterpart does, and for the
same reason.

**Beware `folder`.** It is a note's _pack_ folder, not its directory — the
directory is `file.folder`.

```
:::secret
This is secret text
:::
```

A fenced off area of text may be marked as secret, indicating that the text will be treated as secret text. In FoundryVTT, this will be achieved with

```html
<section class="secret">
  <p>This is secret text</p>
</section>
```

On webpages, this will be achieved with the use of

```html
<details>
  <summary>Spoiler</summary>
  <p>This is secret text</p>
</details>
```

#### Actors

All actor types, including being and vehicle, have their entire markdown section processed as normal.

The following H1 headers are treated specially:

- `# ... {#appearance}`: The contents of this header become the `doc.appearance` property in sohl and `doc.description` in hm3.
- `# ... {#dossier}`: The contents of this header become the `doc.dossier` property in sohl and `doc.biography` in hm3.
- `# ... {#spoilers}`: The contents of this header are not written to the actor at all.

For JournalEntries, the following rules apply:

- `# ... {#spoilers}`: The contents of this header go into a page which is viewable only by the GM (`CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE`).
- The `portrait` frontmatter property will be added as a new JournalPage of type image with the name "Portrait" and anchor "portrait".

**Archetype** is often used to describe a character in broad terms. These are often useful when determining whether a character matches a particular adventure. The list of character archetypes are:

- warrior: Can hold a line and win a fight.
- skirmisher: Fights light — ambush, missile, mobility.
- infiltrator: Gets in unseen — locks, stealth, disguise.
- mage: Commands arcane practice.
- cleric: Commands religious practice and standing.
- healer: Treats wounds and illness.
- scholar: Reads, researches, and knows things.
- courtier: Navigates rank, negotiation, and intrigue.
- woodsman: Travels and survives wild country.
- mariner: Handles boats and blue water.
- artisan: Builds, repairs, and appraises craft work.
- trader: Moves goods, values them, and knows markets.

Note that archetypes are descriptive, not proscriptive, and a character may be described by multiple archetypes at once.

#### Items

All item types, including affiliation, affliction, armor, armorlocation, attribute, concoction, containergear, miscgear, mystery, mysticalability, projectile, skill, trauma, weapon, and lore, have their entire markdown section processed as normal.

The following H1 headers are treated specially:

- `# ... {#appearance}`: The contents of this header become the `doc.description` property in hm3. **SoHL has no Item `appearance` field** — none of its thirteen Item subtypes declares one (only Actors do), so this section is not written to a SoHL item.

### type: being

Generates a living (or undead, or spirit) being.

| `data` property             | Values                                         | Description                                                                                      |
| --------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `portrait`                  | `string`                                       | File path to the portrait image                                                                  |
| `templatePriority`          | `number`                                       | Template priority, _null_ = not a template                                                       |
| `archetypes`                | `Archetype[]`                                  | What sort of character this is. **Always an array** — `[]` where none apply; `null` is an error. |
| `occupation`                | `string`                                       | Name of the character's occupation                                                               |
| `stations`                  | `WikiLink[]`                                   | Name of the stations the character belongs to                                                    |
| `lore`                      | `WikiLink[]`                                   | Lore concerning this being — the people it is of, the standing it holds, the law it lives under  |
| `homes`                     | `WikiLink[]`                                   | Place the being calls home                                                                       |
| `affiliations`              | `WikiLink[]`                                   | Affilliations (e.g., arcane/divine traditions, polities, etc)                                    |
| `gender`                    | `male \| female \| other`                      | Gender of the character                                                                          |
| `species`                   | `WikiLink`                                     | Being's species (lore)                                                                           |
| `age`                       | `number`                                       | Age of the character                                                                             |
| `birthday`                  | `YYYY/MM/DD`                                   | Date of birth of the character                                                                   |
| `height`                    | `number`                                       | Height in meters                                                                                 |
| `weight`                    | `number`                                       | Weight in kilograms                                                                              |
| `frame`                     | `scant \| light \| medium \| large \| massive` | Relative frame size                                                                              |
| `appearance.eye_color`      | `string`                                       | Eye color                                                                                        |
| `appearance.hair_color`     | `string`                                       | Hair color                                                                                       |
| `appearance.skin_color`     | `string`                                       | Skin color                                                                                       |
| `appearance.complexion`     | `string`                                       | Complexion                                                                                       |
| `appearance.extra_features` | `string[]`                                     | Extra features                                                                                   |

If a `sohl` property is present, a SoHL actor of type "being" will be created.

If an `hm3` property is present, an HM3 actor is created. Its document type is **not** derived: `hm3.type` states it, and must be `character` or `creature`. A note that omits it is an error naming the note — see _The note vocabulary, and how it maps_.

A SoHL "being" document will be created, as will an "HM3" document.

| shared source           | → sohl                    | → hm3                        |
| ----------------------- | ------------------------- | ---------------------------- |
| `data.portrait`         | `system.portrait`         | `system.bioImage`            |
| `data.templatePriority` | `system.templatePriority` | `flags.hm3.templatePriority` |
| `data.species`          | NA                        | `system.species`             |
| `data.gender`           | NA                        | `system.gender`              |
| `data.occupation`       | NA                        | `system.occupation`          |

### type: homepage

A homepage for the module will be created.

The contents will be available in a page at `https://www.heroiclands.org/<package>/`.

It will also generate a single JournalEntry located at the top level of the "journals" compendium named "\_Introduction".

### type: vehicle

Represents a conveyance able to hold goods and people moving from one place to another.

| `data` property    | Values   | Description                                |
| ------------------ | -------- | ------------------------------------------ |
| `portrait`         | `string` | File path to the portrait image            |
| `templatePriority` | `number` | Template priority, _null_ = not a template |

If `sohl` is present, this becomes a `vehicle` actor.

| shared source           | → sohl                    | → hm3 |
| ----------------------- | ------------------------- | ----- |
| `data.portrait`         | `system.portrait`         | NA    |
| `data.templatePriority` | `system.templatePriority` | NA    |

### type: affiliation

Represents a related group of beings.

Note that affiliations may have multiple parent affiliations.

**A pantheon is not a subType.** It is a `faithtradition` carrying subordinate
faith traditions — the individual religions of that pantheon name it in
`parents`. There is no `pantheon` value, because every other subType answers
_what kind of body is this_ while a pantheon answers _where does it sit_, and an
enum that mixes the two makes a note choose between a kind and a level. The
hierarchy already carries the answer, so nothing is lost by deriving it: a faith
tradition with faith traditions beneath it is a pantheon.

The same reasoning is why the three traditions are siblings. `faithtradition`,
`arcanetradition` and `spirittradition` partition by _what a practice concerns_ —
the divine, magic, the spirit world — and that partition is load-bearing rather
than descriptive: a system filtering which mystical practices may associate with
an affiliation can only be as precise as the distinction it filters on.

subType

- guild: A sworn association of craftsmen holding monopoly over a trade within a locality.
- order: A body of members bound by vows or a rule of life to a shared purpose.
- polity: A sovereign body ordering the persons within a territory — states, city-states, tribal confederations. Its ranks apply to all who fall under its authority.
- faithtradition: A tradition of belief and practice concerning the divine, whether organized or not.
- arcanetradition: A tradition of belief and practice concerning magic and its practice, whether organized or not.
- spirittradition: A tradition of belief and practice concerning spirits — ancestors, totems, and the numinous world — whether organized or not.
- lineage: A body claiming common descent from a known ancestor, whose standing and obligations pass by birth — clans, houses, dynasties, septs.
- venture: A band bound by contract or shared undertaking rather than by vow or public authority — free companies, ships' crews, trading expeditions, adventuring parties.
- criminal: An association organized to profit from activity its host polity forbids, sustained by its own enforcement rather than by law.
- governmental: An organ constituted by a polity to exercise some portion of its authority — ministries, chanceries, courts, exchequers. Its ranks apply only to those who serve in it.
- fellowship: A voluntary association without vow, trade monopoly, or public authority — formed for mutual company, aid, or shared practice.

**GovernanceModel**

- Autocracy: a single person holds unchecked authority, however acquired
- Monarchy: one ruler legitimated by descent, election, or sacred office
- Oligarchy: a small closed group rules, whether by birth, wealth, or rank — membership is not
  conferred by election and its authority is not held for a term
- Republic: sovereignty rests in the citizen body and is exercised through offices held for a fixed
  term by election, which a ruling class supplies the holders of in practice
- Council: a deliberating body governs collectively with no single head
- Democracy: the general membership decides, directly or through representatives, and any member may
  hold office
- Theocracy: authority derives from divine mandate and rests with its clergy
- Meritocracy: position is earned by demonstrated skill, achievement, or expertise
- Stratocracy: the armed force is itself the government
- Feudal: authority flows through nested personal oaths rather than a central office
- Confederation: autonomous members retain sovereignty under a weak common center
- Anarchic: no formal governing authority — custom or force fills the gap

**Republic, Oligarchy and Democracy are three answers to one question**, and the
boundaries are testable rather than a matter of taste. Ask who fills the offices
and on what terms. If a closed group holds authority outright, with no election
and no term, it is an **Oligarchy**. If offices are elective and time-limited but
a propertied or senatorial order supplies nearly everyone who holds them, it is a
**Republic**. If any member may hold office and the general body decides, it is a
**Democracy**.

The distinction is not academic: it is the difference between a ladder whose top
rungs are a class one is born or bought into, and one whose top rungs are an
office one is voted into and then vacates. A republic's ladder therefore carries
**both** — the civic status (Citizen) and the standing in the governing body above
it (Senator) — because a citizen is not a member of the Senate, and conflating the
two is the commonest way to get a non-monarchy wrong.

**Rank**
Definition of a level within the organization (e.g., Priest, Layperson, Member, Gang Leader, Master, etc.)

| Property      | Values     | Description                                                                                                                          |
| ------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `level`       | number     | The ranking within the affiliation, increasing values starting with 1, 0 indicates intentional exclusion (expulsion/excommunication) |
| `title`       | string     | Title associated with the Rank                                                                                                       |
| `description` | string     | Description of the Rank                                                                                                              |
| `lore`        | `WikiLink` | The standing this rank _is_ — a `lore` note of subType `law`, shared with every other body that confers the same thing               |

**A rank's `lore` is shared; its `title` is not.** A Normen kingdom calls it
`Thrall` and a Vylarian province calls it `Slave`, and they mean one standing:
owned outright, with no standing at law except through an owner. The title is
what this body calls it and the description is how this body puts it, but the
obligations and rights belong to the standing itself, so they are written once
and cited by every ladder that confers it. In the authored corpus 237 distinct
titles across 2,602 rank entries resolve onto 43 standings.

That is also what makes a rank answerable across bodies. Without it, asking what
a `Naukrátissa` may do means reading the Bethûan fleet's ladder; with it, the
rank names the standing, and the standing says.

**Standing**: aligned, unaligned, rival, nemesis

| `data` property      | Values                    | Description                                                                                                |
| -------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `templatePriority`   | `number`                  | Template priority, _null_ = not a template                                                                 |
| `demonym`            | `string`                  | What a member of this affiliation is called (a Vylarian)                                                   |
| `epithet`            | `string`                  | The by-name it is known by — a god's, an order's, a company's                                              |
| `symbol`             | `string`                  | Its emblem in words: a feather atop a golden scale, a chisel carving a star                                |
| `governance.model`   | `GovernanceModel`         | Type of government structure, if applicable                                                                |
| `governance.summary` | `string`                  | summary of the governance situation                                                                        |
| `governance.ranks`   | `Rank[]`                  | The ranks available to members of the affiliation                                                          |
| `governance.offices` | `Map<name, description>`  | Official offices in the affiliation                                                                        |
| `commonSkills`       | `WikiLink[]`              | Common skills among members (languages, etc.)                                                              |
| `seat`               | `WikiLink`                | Where the affiliation's authority sits                                                                     |
| `domains`            | `WikiLink[]`              | Places over which this affiliation holds sway                                                              |
| `population`         | `number`                  | Number of people in the affiliation (precision 2 significant digits).                                      |
| `economy`            | `WikiLink[]`              | Any wikilink referring to the economic activity of the affiliation (produced goods, currency systems, etc) |
| `lore`               | `WikiLink[]`              | Lore concerning it — the peoples it draws on, the god a faith venerates, its law, its calendar             |
| `parents`            | `WikiLink[]`              | Affiliations that this affiliation is subordinate to                                                       |
| `relations`          | `Map<WikiLink, Standing>` | Relations with other affiliations                                                                          |

**A faith tradition is not its god.** An `affiliation` of subType
`faithtradition` is a _religion_ — a practice, with an ordained priesthood, a
calendar and a body of observance — and it can outlive belief in the god
entirely, while one god may be venerated by several religions that agree on
nothing else. So the god is `lore` of subType `deity`, cited from the faith
through `lore`, and never a property of it.

`epithet` and `symbol` stay with the religion for the same reason, and they are
not a faith's alone: they are what the members call the thing and what they
carve, so a guild has them as much as a cult does. What a god _is_ — its nature,
its domains, its aspects — belongs on the deity note, where every religion that
venerates it can point at one account.

**Every one of those describes the organisation.** A membership — which office a
being holds, what title it bears, where it stands on the ladder — is recorded on
the affiliation _as embedded on that being_, and nothing about it belongs in the
catalogue entry. That is the split `governance` draws: the organisation publishes
the ranks and offices that exist, and a membership names which of them it holds.

**Rank is the organisation's, not the member's.** A bare `level: 4` on a
membership says nothing on its own; it means _Knight_ only because the polity
declared that rung. So the ladder is authored once, on the body that confers it,
and a member's rank is an index into it. Level 0 is reserved for the excluded —
outlawed, expelled, excommunicated — which is a standing the organisation still
recognises, and so still has to define.

**Offices are named, not ranked.** A Chancellor and a Marshal are both great
officers and neither is above the other, so an office is a key with a
description rather than a rung — and a being may hold an office at any rank, or a
rank with no office at all.

**`domains` is territorial, and only territorial.** Seventy-seven divine
affiliations currently spell `domain:` the other way, holding a deity's sphere of
influence as prose — _Love, Beauty, and Prosperity_; _Fertility, Agriculture,
Peace, and Healing_. That sense **folds into `description`**, which those notes
leave empty in all but one case, and it does not become a field of its own.

A sphere is a characterisation, not a reference. Nothing compiles against it, no
other note points at it, and rendering it as a list would imply a vocabulary that
does not exist — whereas `description` is exactly the field for a one-line
statement of what a thing is. The fuller treatment already has a home: `lore` of
subType `deity` covers a god's nature, domains, epithets and aspects in prose.

That frees the name for the territorial sense, which earns it: every affiliation
subType holds sway somewhere, while the divine sense applies to one.

If `sohl` is present, this becomes an `affiliation` item.

| shared source    | → sohl             | → hm3 |
| ---------------- | ------------------ | ----- |
| `subType`        | `system.subType`   | NA    |
| `data.seat`      | `system.seat`      | NA    |
| `data.domains`   | `system.domain`    | NA    |
| `data.parents`   | `system.parents`   | NA    |
| `data.relations` | `system.relations` | NA    |

`governance` reaches no system field. Ranks and offices are the note's and the
web page's — SoHL's affiliation item has nowhere to put them, and inventing a
mapping for a field no schema declares is the drift these tables exist to catch.
`system.society`, `system.office`, `system.title` and `system.level` are
likewise absent here: they are filled on an embedded membership, never from a
catalogue note's `data:`.

**`system.title` is not the note's `title`.** The two are unrelated quantities
that share a spelling. A note's top-level `title` is _the title of the note_ —
the heading its page is published under; an affiliation's `system.title` is _the
style of address the office carries_, Ajaw or Warden, which a being holds by
virtue of its rank. So the top-level key is **not** a shared source for this
field, and a note that writes one is stating its own heading and nothing else
(#218). Author the style of address on the membership — the `system.title` of the
entry in a being's `sohl.items` — or, on a catalogue note that genuinely carries
one, at `sohl.system.title`.

### type: affliction

Represents an affliction.

**subType**

- disease: A biological affliction: an illness or parasite that infects the body or mind (e.g. typhoid, tuberculosis, river blindness)
- poisontoxin: A chemical affliction: a toxic substance or venom that impairs or kills the host (e.g. hemotoxin, mandrake, wasp venom)
- maladiction: A supernatural affliction: a curse, hex, or divine/spiritual blight that assails the body, mind, or aura by arcane, divine, or spirit means. The affliction is a metaphysical agent with a course and outcome

**TransmissionTypes**

- none: no transmission mode
- airborne: Transmission through the air, such as via droplets or aerosols
- contact: Transmission through direct physical (skin) contact
- bodyfluid: Transmission through bodily fluids: blood, saliva, etc.
- injested: Transmission through ingestion of contaminated substances
- proximity: Transmission through close proximity to an infected individual, but separate from airborne or direct contact modes.
- vector: Transmission through a vector, such as an insect or animal bite
- perception: Transmission through sensory perception, such as sight or sound
- arcane: Transmission through arcane means
- divine: Transmission through divine means
- spirit: Transmission through spirit means

| `data` property               | Values              | Description                                                                               |
| ----------------------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| `templatePriority`            | `number`            | Template priority, _null_ = not a template                                                |
| `transmission`                | `TransmissionTypes` | Method of transmission                                                                    |
| `outcome`                     | `death \| cured`    | Result after affliction has run its course                                                |
| `healingRate`                 | `number`            | Likelihood of positive outcome of healing test                                            |
| `contagionIndex`              | `number`            | how contagious the disease is                                                             |
| `outcomeTraumas`              | `SafeExpression`    | Expression returning traumas that result from affliction recovery                         |
| `onsetDurationFormula`        | `RollFormula`       | Formula to calculate duration until onset after contracting affliction                    |
| `healingCheckDurationFormula` | `RollFormula`       | Formula to calculate duration until next healing check (measured from last healing check) |
| `resolutionDurationFormula`   | `RollFormula`       | Formula to calculate duration after onset to resolution                                   |

If `sohl` is present, this becomes an `affliction` item.

| shared source                      | → sohl                               | → hm3 |
| ---------------------------------- | ------------------------------------ | ----- |
| `subType`                          | `system.subType`                     | NA    |
| `data.transmission`                | `system.transmission`                | NA    |
| `data.outcome`                     | `system.outcome`                     | NA    |
| `data.healingRate`                 | `system.healingRateBase`             | NA    |
| `data.contagionIndex`              | `system.contagionIndexBase`          | NA    |
| `data.outcomeTraumas`              | `system.outcomeTraumas`              | NA    |
| `data.onsetDurationFormula`        | `system.onsetDurationFormula`        | NA    |
| `data.healingCheckDurationFormula` | `system.healingCheckDurationFormula` | NA    |
| `data.resolutionDurationFormula`   | `system.resolutionDurationFormula`   | NA    |

### type: armorgear

Note: `data.quantity` may not be specified. Quantity is always 1.

| `data` property    | Values   | Description                                |
| ------------------ | -------- | ------------------------------------------ |
| `templatePriority` | `number` | Template priority, _null_ = not a template |
| `weight`           | `number` | Gear weight                                |
| `value`            | `number` | Gear value                                 |
| `quality`          | `number` | Gear quality                               |
| `durability`       | `number` | Gear durability                            |

If a `sohl` property is present, a SoHL item of type "armorgear" will be created.

if a `hm3` property is present, an HM3 item of type "armorgear" will be created.

| shared source     | → sohl                  | → hm3           |
| ----------------- | ----------------------- | --------------- |
| `data.weight`     | `system.weightBase`     | `system.weight` |
| `data.value`      | `system.valueBase`      | `system.value`  |
| `data.quality`    | `system.qualityBase`    | NA              |
| `data.durability` | `system.durabilityBase` | NA              |

### type: armorlocation

| `data` property    | Values   | Description                                |
| ------------------ | -------- | ------------------------------------------ |
| `templatePriority` | `number` | Template priority, _null_ = not a template |

if a `hm3` property is present, an HM3 item of type "armorlocation" will be created.

| shared source | → sohl | → hm3 |
| ------------- | ------ | ----- |
| `notes`       | NA     | NA    |

### type: attribute

| `data` property    | Values   | Description                                |
| ------------------ | -------- | ------------------------------------------ |
| `templatePriority` | `number` | Template priority, _null_ = not a template |

if a `sohl` property is present, a SoHL item of type "attribute" will be created.

| shared source | → sohl | → hm3 |
| ------------- | ------ | ----- |

### type: concoctiongear

**subType**:

- mundane: ordinary and common in everyday use, generally simple in composition (often a single dried or otherwise prepared ingredient)
- exotic: A complex and valuable concoction, often a mixture of different herbs and/or chemicals, with medicinal or other unique properties or effects, but not magical in nature.
- elixir: An arcane alchemical concoction of great power.

| `data` property    | Values                          | Description                                       |
| ------------------ | ------------------------------- | ------------------------------------------------- |
| `templatePriority` | `number`                        | Template priority, _null_ = not a template        |
| `weight`           | `number`                        | Gear weight                                       |
| `value`            | `number`                        | Gear value                                        |
| `quality`          | `number`                        | Gear quality                                      |
| `durability`       | `number`                        | Gear durability                                   |
| `quantity`         | `number`                        | Gear quantity (default: 1)                        |
| `potency`          | `na \| mild \| strong \| great` | Concoction Potency (mundane/exotic concoctions)   |
| `strength`         | `number`                        | Strength: higher the number, greater the strength |

if a `sohl` property is present, a SoHL item of type "concoctiongear" will be created.

| shared source     | → sohl                  | → hm3 |
| ----------------- | ----------------------- | ----- |
| `subType`         | `system.subType`        | NA    |
| `data.weight`     | `system.weightBase`     | NA    |
| `data.value`      | `system.valueBase`      | NA    |
| `data.quality`    | `system.qualityBase`    | NA    |
| `data.durability` | `system.durabilityBase` | NA    |
| `data.quantity`   | `system.quantity`       | NA    |

### type: containergear

Note: `data.quantity` may not be specified; quantity is always set to 1.

| `data` property    | Values   | Description                                |
| ------------------ | -------- | ------------------------------------------ |
| `templatePriority` | `number` | Template priority, _null_ = not a template |
| `weight`           | `number` | Gear weight                                |
| `value`            | `number` | Gear value                                 |
| `quality`          | `number` | Gear quality                               |
| `durability`       | `number` | Gear durability                            |
| `capacity`         | `number` | Container capacity (in lbs)                |

if a `sohl` property is present, a SoHL item of type "containergear" will be created.

if a `hm3` property is present, an HM3 item of type "containergear" will be created.

| shared source     | → sohl                   | → hm3                 |
| ----------------- | ------------------------ | --------------------- |
| `data.weight`     | `system.weightBase`      | `system.weight`       |
| `data.value`      | `system.valueBase`       | `system.value`        |
| `data.quality`    | `system.qualityBase`     | NA                    |
| `data.durability` | `system.durabilityBase`  | NA                    |
| `data.capacity`   | `system.maxCapacityBase` | `system.capacity.max` |

### type: miscgear

| `data` property    | Values   | Description                                |
| ------------------ | -------- | ------------------------------------------ |
| `templatePriority` | `number` | Template priority, _null_ = not a template |
| `weight`           | `number` | Gear weight                                |
| `value`            | `number` | Gear value                                 |
| `quality`          | `number` | Gear quality                               |
| `durability`       | `number` | Gear durability                            |
| `quantity`         | `number` | Gear quantity (default: 1)                 |

if a `sohl` property is present, a SoHL item of type "miscgear" will be created.

if a `hm3` property is present, an HM3 item of type "miscgear" will be created.

| shared source     | → sohl                  | → hm3             |
| ----------------- | ----------------------- | ----------------- |
| `data.weight`     | `system.weightBase`     | `system.weight`   |
| `data.value`      | `system.valueBase`      | `system.value`    |
| `data.quality`    | `system.qualityBase`    | NA                |
| `data.durability` | `system.durabilityBase` | NA                |
| `data.quantity`   | `system.quantity`       | `system.quantity` |

### type: mystery

**subType**:

- boon: A flat ±N modifier to an associated skill's mastery level, from any source.
- boost: One or more temporary mastery boosts to an associated skill (Mastery Boost table).
- fate: A mystery that quantifies the ability to alter destiny or fate.
- grace: A mystery that quantifies ability to call effectually on divine favor.
- birthsign: A mystery that describes the arcane sign under which the being was born.
- other: A mystery that does not fit into the other predefined categories.
- piety: A mystery that quantifies devotion to a religion.

**SkillAptitude**: either a single skill

| `data` property    | Values                                  | Description                                                    |
| ------------------ | --------------------------------------- | -------------------------------------------------------------- |
| `templatePriority` | `number`                                | Template priority, _null_ = not a template                     |
| `assocSkill`       | `WikiLink`                              | Associated skill                                               |
| `assocAffiliation` | `WikiLink`                              | Associated affiliation                                         |
| `skillAptitudes`   | `WikiLink` or `subType:<skill-subtype>` | Bonuses/penalties to skills (or types of skills)               |
| `level`            | `number`                                | Magnitude of the mystery                                       |
| `charges.value`    | `number`                                | Current number of charges available, _null_ = charges not used |
| `charges.max`      | `number`                                | Maximum number of charges, _null_ = no maximum                 |

if a `sohl` property is present, a SoHL item of type "mystery" will be created.

| shared source           | → sohl                        | → hm3 |
| ----------------------- | ----------------------------- | ----- |
| `subType`               | `system.subType`              | NA    |
| `data.assocSkill`       | `system.assocSkillCode`       | NA    |
| `data.assocAffiliation` | `system.assocAffiliationCode` | NA    |
| `data.skillAptitudes`   | `system.skillAptitudes`       | NA    |
| `data.level`            | `system.levelBase`            | NA    |
| `data.charges.value`    | `system.charges.value`        | NA    |
| `data.charges.max`      | `system.charges.max`          | NA    |

### type: mysticalability

**subType**:

- spiritrite: A prepared ceremony by which a practitioner petitions the spirit world.
- spiritaction: A discrete supernatural act performed through an allied or bound spirit.
- spiritpower: A standing power conferred on its bearer by a spirit.
- ritualaction: A prescribed ritual act performed to earn the favour of a deity.
- divineincantation: A spoken invocation channelling the power of a deity.
- arcaneincantation: A formally learned spell, invoked by word and gesture.
- arcanetalent: An innate arcane knack, possessed without formal training.
- spirittalent: An innate affinity for the spirit world, possessed without training.
- alchemy: The preparation of substances imbued with mystical potency.
- divination: The practice of obtaining hidden knowledge or foreknowledge by mystical means.

| `data` property    | Values     | Description                                                    |
| ------------------ | ---------- | -------------------------------------------------------------- |
| `templatePriority` | `number`   | Template priority, _null_ = not a template                     |
| `assocSkill`       | `WikiLink` | Associated skill                                               |
| `assocAffiliation` | `WikiLink` | Associated affiliation                                         |
| `masteryLevel`     | `number`   | Mastery Level                                                  |
| `level`            | `number`   | Magnitude of the mystery                                       |
| `charges.value`    | `number`   | Current number of charges available, _null_ = charges not used |
| `charges.max`      | `number`   | Maximum number of charges, _null_ = no maximum                 |

if a `sohl` property is present, a SoHL item of type "mysticalability" will be created.

If an `hm3` property is present, an HM3 item is created, and `hm3.type` states which — `psionic`, `spell` or `invocation`. It is **authored, not derived from `subType`**: the ten mystical-ability subtypes do not partition onto HM3's three documents (a `spiritrite`, an `alchemy` and a `divination` each answer to none of them), so a derivation would be a guess with a plausible shape. A note that omits it is an error naming the note.

| shared source           | → sohl                        | → hm3         |
| ----------------------- | ----------------------------- | ------------- |
| `subType`               | `system.subType`              | **see above** |
| `data.assocSkill`       | `system.assocSkillCode`       | NA            |
| `data.assocAffiliation` | `system.assocAffiliationCode` | NA            |
| `data.masteryLevel`     | `system.masteryLevelBase`     | NA            |
| `data.level`            | `system.levelBase`            | NA            |
| `data.charges.value`    | `system.charges.value`        | NA            |
| `data.charges.max`      | `system.charges.max`          | NA            |

### type: projectilegear

**subTypes**:

- none
- arrow
- bolt
- bullet
- dart
- other

| `data` property    | Values   | Description                                |
| ------------------ | -------- | ------------------------------------------ |
| `templatePriority` | `number` | Template priority, _null_ = not a template |
| `weight`           | `number` | Gear weight                                |
| `value`            | `number` | Gear value                                 |
| `quality`          | `number` | Gear quality                               |
| `durability`       | `number` | Gear durability                            |
| `quantity`         | `number` | Gear quantity (default: 1)                 |

if a `sohl` property is present, a SoHL item of type "projectilegear" will be created.

If an `hm3` property is present, then an HM3 item of type "missilegear" will be created.

Note that `weapon` can also produce an HM3 `missilegear`. Since `(type, shortcode)` is a
flat namespace, a `projectile` and a `weapon` sharing a shortcode would collide on the
HM3 side while remaining distinct on the SoHL side.

| shared source     | → sohl                  | → hm3             |
| ----------------- | ----------------------- | ----------------- |
| `subType`         | `system.subType`        | NA                |
| `data.weight`     | `system.weightBase`     | `system.weight`   |
| `data.value`      | `system.valueBase`      | `system.value`    |
| `data.quality`    | `system.qualityBase`    | NA                |
| `data.durability` | `system.durabilityBase` | NA                |
| `data.quantity`   | `system.quantity`       | `system.quantity` |

### type: skill

**subTypes**:

- social
- nature
- craft
- lore
- language
- script
- mystical
- physical
- combat
- combattechnique

| `data` property    | Values     | Description                                |
| ------------------ | ---------- | ------------------------------------------ |
| `templatePriority` | `number`   | Template priority, _null_ = not a template |
| `masteryLevel`     | `number`   | Mastery Level                              |
| `parentSkill`      | `WikiLink` | Parent skill this skill specializes        |

if a `sohl` property is present, a SoHL item of type "skill" will be created.

If an `hm3` property is present, then an HM3 item of type "skill" will be created.

Note: `hm3.system.type` (skill types) use the values "Craft", "Physical", "Communication", "Combat", "Magic", and "Ritual". These do not cleanly map to the `subType` values. Because of this, the `hm3.system.type` value must be specified with the appropriate value when defining HM3 skills.

| shared source       | → sohl                    | → hm3                 |
| ------------------- | ------------------------- | --------------------- |
| `subType`           | `system.subType`          | See notes above       |
| `data.masteryLevel` | `system.masteryLevelBase` | `system.masteryLevel` |
| `data.parentSkill`  | `system.parentSkillCode`  | NA                    |

### type: trauma

**subType**:

- injury: Physical harm caused by an external force.
- fear: Emotional response to a perceived threat or danger.
- morale: Emotional state affecting group cohesion and individual morale.
- pall: Influence of existential chaos, death, or life-draining forces.
- psycond: Mental and emotional disorder.
- physcond: A persistent physical condition of the body (descriptive; e.g. albinism, a limp, poor eyesight)
- auralshock: Severe shock to the aura, resulting in temporary loss of aura-related abilities.
- fatigue: Physical or mental exhaustion resulting from prolonged activity or stress.
- infection: Swelling or inflammation exacerbating an existing condition or injury, often fatal.
- shock: A prolonged physiological state of shock lasting hours or days, following severe trauma or blood loss — distinct from the transient combat-shock states.
- coma: A prolonged state of unconsciousness.

| `data` property    | Values   | Description                                |
| ------------------ | -------- | ------------------------------------------ |
| `templatePriority` | `number` | Template priority, _null_ = not a template |

if a `sohl` property is present, a SoHL item of type "trauma" will be created.

If an `hm3` property is present, an HM3 item is created. `hm3.type` must be specified as either `injury` or `trait`.

| shared source | → sohl           | → hm3 |
| ------------- | ---------------- | ----- |
| `subType`     | `system.subType` | NA    |

### type: weapongear

Note: `data.quantity` may not be specified. Quantity is always 1.

| `data` property    | Values   | Description                                |
| ------------------ | -------- | ------------------------------------------ |
| `templatePriority` | `number` | Template priority, _null_ = not a template |
| `weight`           | `number` | Gear weight                                |
| `value`            | `number` | Gear value                                 |
| `quality`          | `number` | Gear quality                               |
| `durability`       | `number` | Gear durability                            |

if a `sohl` property is present, a SoHL item of type "weapongear" will be created,
carrying every strike mode the weapon has — melee and missile alike — on
`system.strikeModes`.

If an `hm3` property is present, an HM3 item is created, and `hm3.type` states whether it is a `weapongear` or a `missilegear`. **`weapon` has no `subType`**: SoHL distinguishes a weapon's uses with strike modes rather than by kind, and HM3 has one document per usage, so nothing but the note can say which usage it describes. Every note carrying an `hm3:` block states it — the one carrying both blocks as well as the companion carrying only `hm3:`, which is usually a `missilegear` — see _One note is at most one document per system_.

| shared source     | → sohl                  | → hm3           |
| ----------------- | ----------------------- | --------------- |
| `data.weight`     | `system.weightBase`     | `system.weight` |
| `data.value`      | `system.valueBase`      | `system.value`  |
| `data.quality`    | `system.qualityBase`    | NA              |
| `data.durability` | `system.durabilityBase` | NA              |

### type: lore

In-world information about people, places, or concepts.

subType:

- cosmology: The structure of reality — planes, realms, creation, and the ordering of what exists.
- deity: Individual gods and their attributed natures, domains, epithets, and aspects.
- theology: How the divine is held to operate — worship, sacrifice, afterlife, sin and grace.
- arcana: How magic is held to operate — mechanism, traditions, and philosophies of practice.
- spirit: The non-divine numinous — spirits, celestials, fae, and their natures.
- economy: How wealth moves — barter, coinage, trade networks, credit, and measure.
- law: How obligation is ordered and enforced — citizenship, custom, courts, and tenure.
- calendar: How time is reckoned and marked — dating, seasons, festivals, and astrology.
- history: What has happened — eras, events, chronicles, and genealogies of rule.
- material: Substances and their properties — minerals, reagents, herbs, and preparations.
- folk: Related sapient beings of a single or tightly related species: kindreds, ancestries.
- culture: A social grouping of individuals with common beliefs, mores, and values.
- bestiary: A kind of creature that is not a people — beasts, monsters, and the made things
  that were never born. What `folk` covers for the sapient, this covers for everything else.

| `data` property | Values | Description |
| --------------- | ------ | ----------- |

### type: map

A map — the visual rendering of a place or an encounter, plus the pinned
locations described in its own body. Produces a Foundry **Scene**, and a web page carrying the map image
and its description.

A map is a note in its own right rather than a property of a `place`, for three
reasons. A place commonly has **several** maps — a floor per level of a keep, or
a feature's detail map alongside its local-area map — and a scene nested in a
place could only ever be one. A Scene is a substantial document in itself: walls,
doors, lights, tiles, sounds, region shapes and pins, authored in two deliberate
unit conventions. And a map has prose and named locations of its own, which makes
it a document rather than a field.

A map may also exist with no place at all — an ambush on a road is an encounter
map and not a named location.

**The place is named on the map, not the other way round.** A place commonly has
several maps, so listing them from the place is the end that goes stale; naming
the place from the map is the end that cannot, because a map is written once and
depicts what it depicts. A place's maps are therefore derived — every map whose
`place` is this one — and the relation exists in exactly one place.

subType:

- battlemap: Tactical scale, for a scene played out square by square.
- localmap: Roughly a kilometre across — a settlement, a holding, a small valley.
- regionalmap: Large scale, covering a region or a journey between places.

The three differ only in the canvas defaults derived for them, which is why they
are subTypes of one type rather than three types.

> The three were **types** until package-build#174, which is the shape the notes
> in the wild still carry. Both are read: a note still writing `type: battlemap`
> is reported and told what to write instead, exactly as a note writing
> `type: character` is (SoHL#1580). A consumer's `sections` config keys off the
> type, so it takes one `map` entry where it carried three.

**NoteLocation** is `[GridLocation, anchor]` where the `anchor` is an anchor identified in the body of the note, and `GridLocation` represents a particular grid location on the document.

The `data:` fields, of which three are required:

| `data` property   | Values           | Description                                                                                                                                                    |
| ----------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `img`             | `string`         | **Required.** The path to the map art. Becomes the level's `background.src` — what tokens stand on. Authored at the note's **top level**, not here — see below |
| `dimensions`      | `[int, int]`     | **Required.** `[width, height]` in whole pixels, the art's own size                                                                                            |
| `pxPerGrid`       | `integer`        | **Required.** Whole pixels per grid square; must match the art                                                                                                 |
| `navName`         | `string`         | Short name for Foundry's scene navigation bar                                                                                                                  |
| `levelName`       | `string`         | The name of the embedded level. Defaults to `Ground`                                                                                                           |
| `backgroundColor` | `ColorHexValue`  | Shown where the art does not reach. Defaults to `#999999`                                                                                                      |
| `overlay`         | `string`         | Path to **foreground** art                                                                                                                                     |
| `walls`           | `WallSegment[]`  | List of wall segments                                                                                                                                          |
| `doors`           | `Door[]`         | List of doors                                                                                                                                                  |
| `lights`          | `Light[]`        | List of lights                                                                                                                                                 |
| `tiles`           | `Tile[]`         | List of tiles                                                                                                                                                  |
| `sounds`          | `Sound[]`        | List of sounds                                                                                                                                                 |
| `regions`         | `SceneRegion[]`  | List of scene regions                                                                                                                                          |
| `place`           | `WikiLink`       | The place this map depicts. Optional, because an encounter map depicts no named place — but that is the exception, and a map without one is a map of nowhere   |
| `notes`           | `NoteLocation[]` | grid coordinates of note markers mapped to anchors in this document                                                                                            |

Everything else a Scene holds is **derived**, not authored: padding, grid type,
grid distance and units, token vision and fog mode all come from the subType, and
ids, ordering and elevation are synthesised. A map note carries the map's
essence, not a Scene's schema — the same division a weapon note makes against an
Item's.

**`levels:` is never authored, and must never be.** A Scene has to ship at least
one Level or it has no map at all, and nothing supplies one after the fact: the
client-side `_preCreate` that would create it does not run during offline pack
compilation, and the server-side migration shim is version-gated on
`_stats.coreVersion`, so a pack stamped 14.x or later skips it entirely. The
single Level is synthesised from `img`, `overlay`, `levelName` and
`backgroundColor`.

> **`img`, at the note's top level, as every other type's artwork is.** A map
> alone named it `image` and read it out of the `sohl:` block, so one idea had
> two spellings and this table had to hedge rather than state a rule
> ([package-build#142](https://github.com/HeroicLands/package-build/issues/142)).
> Art is not system-specific — a Scene is a core Foundry document, and a second
> system would want the identical art — so the field sits beside every other
> note's `img` rather than inside a system block.
>
> `image` is **retired in favour of it**, in the three steps `package:` took
> (#56), and this is the first: both spellings are read, `img` wins where a note
> carries both, and a note still writing `image` gets a located **warning**
> rather than a refusal. It compiles to the byte-identical document, so failing
> a build over it would red a tree that has done nothing wrong.

**Two unit conventions, deliberately.** Geometry — walls, doors, lights, tiles,
sounds, region shapes — is authored in **pixels**, Foundry's native storage,
because a traced battlemap's walls do not lie on grid intersections (measured:
97.8% do not). Map pins are authored in **grid squares**, commonly
half-integers, because that is how a person reads a position off a map. The two
are told apart by their key: `position:` and segment or shape coordinates are
pixels, `at:` is grid squares. Mixing them fails silently and visually in
Foundry, so the build refuses rather than resolving.

> **These fields are read from `sohl:` today, and should move to `data:`.** A
> Scene is a core Foundry document — nothing about a map's geometry is
> system-specific, and HM3 would want the identical Scene. Authoring it under
> `sohl:` means a map produces nothing for a system-agnostic build and carries a
> SoHL infobox implying a specificity it does not have. It is the same class of
> mistake as storing `archetype` in flags: the data went where the only available
> container was, rather than where it belongs. Three notes carry it today.

**A map is always a leaf.** Its frontmatter references nothing outside itself.
`notes:` is a list of `[anchor, GridLocation]`, and each anchor names a heading in
**this map note's own body** — never an external note. A pin therefore opens the
map's own journal page, so the prose describing a spot on the map lives with the
map that shows it.

That constraint is the point, not an accident of the format. A map that names no
other note can be reused by any place, any scenario and any package, and can be
moved between them without dragging references along. It also cannot carry a
dangling reference: only things pointing _at_ a map can break, which is the safe
direction for the failure to run.

**So the reference runs from the place.** A `place` names its maps through
`data.maps`; the map says nothing about which places it depicts. That is the
opposite of how the pins run, and deliberately so — the pins point inward to keep
the map self-contained, and the place points outward because it is the thing that
knows which maps belong to it. A keep with three floor plans is a place naming
three maps, and none of those maps needs to know it is a keep.

### type: place

subType:

- world: A self-contained whole in which places exist — a planet, plane, or realm.
- region: A bounded division of a world or larger region — continents, marches, uplands, provinces.
- settlement: A place where folk dwell together — cities, towns, villages, holdings, camps.
- site: A place significant by what was made or done there — ruins, monoliths, henges, works, battlefields.
- structure: A single building or habitation — halls, keeps, temples, inns, towers.
- feature: A place significant by its terrain — forests, rivers, falls, passes, fords.

| `data` property | Values       | Description                                                                  |
| --------------- | ------------ | ---------------------------------------------------------------------------- |
| `demonym`       | `string`     | What a person from this place is called — a Vylarian                         |
| `lore`          | `WikiLink[]` | Lore concerning this place — its peoples, its law, its calendar, its history |
| `parents`       | `WikiLink[]` | Enclosing places within which this place is located                          |
| `population`    | `number`     | Approximate population (precision 2 significant digits)                      |

**A place declares only what is true of ground.** Four properties were removed
because they were true of something else, and each removal has a home to go to.

**`languages` is a fact about a polity.** A place's languages change when its
ruler changes, which is what makes them the ruler's property — and
`affiliation.commonSkills` already holds them. The authored corpus agrees: of 206
places carrying `languages`, 190 were settlements and 16 were regions, and not one
was a site, a structure or a feature. A ruin has no language.

**`peoples` widens to `lore`.** It was the only lore-pointing property a place
had, so a place with a calendar, a body of law or a local history had nowhere to
cite it. Nothing is lost by widening: the target's own subType already
distinguishes a `folk` from a `law`, which is the same reason `affiliation`
carries no `pantheons`.

**`summary` duplicated `description`**, which every note already has and which is
what the page renders.

**`affiliations` and `maps` were the wrong end of a relation.** `affiliations` is
the inverse of `affiliation.domains`, and a relation authored from both ends
drifts the moment one is edited. `maps` moves onto the map, which now names the
place it depicts — see `type: map` below.

### type: scenario

Content prepared to be played — a situation with its cast, places, and possible outcomes.

subType:

- campaign: A long arc toward a goal, spanning many adventures — carries standing cast, factions, and its own timeline.
- adventure: A self-contained undertaking with a specific objective, playable in a few sessions.
- encounter: A single scene or challenge, reusable within an adventure or on its own.

| `data` property    | Values                                       | Description                                                                    |
| ------------------ | -------------------------------------------- | ------------------------------------------------------------------------------ |
| `parents`          | `WikiLink[]`                                 | List of parent scenarios of this scenario (campaigns, etc.)                    |
| `locations`        | `WikiLink[]`                                 | List of locations associated with this scenario                                |
| `cast`             | `WikiLink[]`                                 | individuals associated with this scenario                                      |
| `factions`         | `WikiLink[]`                                 | Affiliations associated with this scenario                                     |
| `follows`          | `WikiLink[]`                                 | Prerequisite scenarios that should be completed before beginning this scenario |
| `status`           | `draft \| playtested \| published`           | Playability status of this scenario                                            |
| `party.size`       | `solo \| small \| standard \| large \| host` | Suggested party size (solo=1, small=2-3, standard=4-6, large=6-7, host=7+)     |
| `party.archetypes` | `Archetype`                                  | Archetypes of characters suitable for completion                               |

### type: doc

subType:

- rules: The rules of the game, independent of medium — valid at a table with paper and dice.
- userguide: How to operate the Foundry implementation to play by the rules.
- reference: Out-of-world lookup material about the setting or system — correspondences, conversions, glossaries.

A `doc` declares no properties of its own.

**A page that introduces a type is an ordinary note, named by convention.**
Write `type: doc`, `subType: reference`, `shortcode: <type>` — so the
affiliations introduction is `doc-affiliation`, addressed and linked like
anything else, and typically carrying a generated table of what it introduces.
It has no build path of its own; the package's own front page already works this
way (`homepage-root`).

There is no landing page and no section. A `README.md` used to _be_ its
section's landing, and a `subType: collection` note with a top-level `section:`
key was a second way to say the same thing. All of it is retired — the second
rule in #202, the first in #204 — because a section appears in **no address**: a
page publishes at `/<package>/<type>-<shortcode>/`, which names no directory. A
section is what Hugo calls a content directory, and the note format does not
carry one.

So a `doc`'s `subType` is a **genre** and nothing else, closed to the three
values above. It briefly had to accept a content type as well, because a
landing's `subType` named the section it addressed; with no landings, one field
has one reading again.

### type: macro

A script offered on the macro bar, plus the prose explaining what it does and
when to reach for it. Produces a Foundry **Macro** and, from the same note, the
JournalEntry every note produces — so a macro's documentation is a document a
player can open, not a comment nobody reads.

**The script is a page of the note, addressed by an anchor.** The macro's
`command` is the first **language-tagged** JavaScript fence on the page whose
heading carries `{#script}`:

````markdown
# Script {#script}

```js
await CONFIG.SOHL.class.Utility.currentCombatantAttack();
```
````

Three rules follow, and each is deliberate. The anchor names the **page**, not
the heading text, so the heading may be worded freely and
`[[docmacro-autoattack#script]]` still opens exactly this page. The fence must
be **tagged** — an untagged fence is a code sample whose language nobody stated,
and treating it as executable would make an illustrative snippet the macro. And
only the **first** tagged fence counts, so a note may document its macro
with examples that are plainly not the macro. A note with no `{#script}` page,
or no tagged fence on it, is a **build error**: a macro with no command is a
macro-bar button that does nothing.

**The executable copy is read from the raw markdown.** The journal's copy of the
same fence has been through table expansion and wikilink conversion first, so
the two diverge on purpose — the journal renders prose _about_ the script, while
the macro runs exactly what the author typed.

**This is not compiling data into code.** A Macro's `command` is authored source
shipped as content and run by Foundry's own macro runner under the permission
model that governs every macro in a world. Nothing evaluates, compiles, or
revives anything; the compiler copies text from a fence into a JSON field.

**Both settings are `sohl` properties, not `data` ones.** The compiler reads
them with the same accessor every `sohl` field uses — the `sohl:` block first,
then the note's top level — so `data.macroType` is not read, and a macro is not
a journal-only note the way `place`, `lore` and `scenario` are: it produces a
Foundry **Macro**, and these two describe that document.

| `sohl` property | Values                      | Description                                                          |
| --------------- | --------------------------- | -------------------------------------------------------------------- |
| `macroType`     | `script`                    | The Foundry macro type. Defaults to `script`, and `chat` is an error |
| `macroScope`    | `global \| actors \| actor` | How far the macro reaches. Defaults to `global`                      |

> **These fields are read from `sohl:` today, and should move to `data:`.** A
> Macro is a core Foundry document — nothing about a script's type or scope is
> system-specific — so authoring them under `sohl:` puts them where the only
> available container was rather than where they belong. It is the same mistake
> the map fields make, and no authored note carries either field today, so the
> move costs nothing.

**`macroType: chat` is an error, not an unimplemented feature.** A chat macro's
`command` is chat text rather than source, so none of the `{#script}` fence
rules describe it, and compiling one through this path would ship a macro whose
body was a code block posted verbatim into chat. Chat macros as content would
need an authoring convention of their own.

The note's `img` is a content-relative path resolved the way every other note's
is; a note that authors none takes Foundry's own `icons/svg/dice-target.svg`.

### type: bundle

A bundle of notes to be taken as a single unit — an `Adventure` in Foundry VTT.

| `data` property | Values       | Description                                            |
| --------------- | ------------ | ------------------------------------------------------ |
| `contents`      | `WikiLink[]` | The documents the Adventure holds; `[]` when unstated. |

**The note's system blocks decide how many Adventures it makes**, exactly as they
do for every other type:

- With **no** system block, one Adventure is written, holding only the `contents`
  that are themselves of system `none`.
- With **one or more**, one Adventure is written **per system**, each holding
  every `none` document plus that system's own. A document of neither is
  silently left out.

Each Adventure is written to the pack the note's `pack` names — the shared
routing field every type uses, not one of the bundle's own — except that it
defaults to `adventures` rather than to the configured default pack.
`<system>.pack` overrides it for that system, as it does everywhere else.

An `Adventure` carries **copies** of what it holds, not references: importing one
creates or updates each document in the world, after which they live
independently. So a bundle is not a folder — a folder is a live grouping that
persists in the pack.

Note that an `Adventure` has no `system` field of its own. A bundle spanning two
systems therefore cannot be one document that knows it spans them; it is one
Adventure per system, and the pack each is written to is what carries the system.
