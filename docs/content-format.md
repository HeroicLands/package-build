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

| note type                                                             | system boxes shown                                 |
| --------------------------------------------------------------------- | -------------------------------------------------- |
| `weapon`, `skill`, `being`, `armorgear`, `containergear`, `miscgear`… | SoHL **and** HM3 — either may read _Not available_ |
| `affiliation`, `affliction`, `attribute`, `concoctiongear`, `mystery` | SoHL only                                          |
| `armorlocation`                                                       | HM3 only                                           |

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

**A shared source and the key a system block still carries are two
declarations.** The mapping tables name the shared source — `data.species` — and
the corpus writes the same fact inside the block it has always written it in —
`hm3.species`. Those are two positions for one field, and both are read while
the corpus moves, with the block winning. A field says so by naming each: its
shared source, and the legacy in-block key it is being swept off. Reading it
from the legacy position is _reported_, so the sweep has a progress signal, and
the note compiles to the identical document either way — the same read-both,
report-one shape every other retirement in this format uses. Until #305 the two
were one declaration, so a field could name only one of them, and a row this
table stated was reachable only by a note that had already moved.

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

| shared source           | → sohl                    | → hm3                        |
| ----------------------- | ------------------------- | ---------------------------- |
| `name.full`             | `name`                    | `name`                       |
| `img`                   | `img`                     | `img`                        |
| `id`                    | `_id`                     | `_id`                        |
| `packFolder` / `folder` | `folder`                  | `folder`                     |
| `shortcode`             | `system.shortcode`        | NA                           |
| `data.templatePriority` | `system.templatePriority` | `flags.hm3.templatePriority` |
| `actionDefs`            | `system.actionDefs`       | NA                           |
| `notes`                 | `system.notes`            | `system.notes`               |

**A column reads NA wherever the type produces no document in that system.** An
`affiliation` has no HM3 form, so its whole HM3 column is NA; `armorlocation` has
no SoHL form, so its SoHL column is. Nothing else varies — which is why these
rows are worth stating once: repeated sixteen times they buried the differences
that matter.

Actor types (`being`, `vehicle`) add one more:

| shared source   | → sohl            | → hm3             |
| --------------- | ----------------- | ----------------- |
| `data.portrait` | `system.portrait` | `system.bioImage` |

An actor carries `img` (its token art) and `portrait` (its sheet portrait)
independently, which is why this is a row of its own rather than a second
spelling of the one above. An Item has no second image, so the row applies to
actor types alone. Note the asymmetry in where the two are authored: `img` stays
at the note's top level and `portrait` moved under `data:`, because a note's
token art is a fact about the _note as a published artefact_ while the portrait
is a fact about the _subject_.

**A `data:` source is still read at the top level, for now.** `data:` (#128) did
not invent the facts it holds — it gathered them out of the top level, where
`portrait:` sat beside `img:` — so every key it collected has a **pre-`data:`
spelling** that is read after the declared one and reported as retiring. Write
`data.portrait`; a tree still on `portrait:` compiles to the identical document
and gets a warning naming the line, until a later release removes the position.
This is the shared level's counterpart to the in-block `<system>.<key>`
retirement, and the two are separate: a note may have moved one and not the
other.

**Two of the eight are Item-only in SoHL.** `actionDefs` and `notes` are declared
on every SoHL Item subtype and on no SoHL Actor, so on a `being` or a `vehicle`
the SoHL column of both reads NA.

`notes` is also the one row that is emitted rather than mapped: SoHL writes
`system.notes` empty on every Item, and no note-level key fills it yet. The row
states where such a key would land, which is what makes `armorlocation`'s
exception below sayable at all.

**A third SoHL Item mapping has no shared source, so it is not a row.** SoHL
writes `system.docHtml` on every Item from the note's own prose — the UUID of the
JournalEntry that prose compiled into, which is derived rather than authored.
HM3's data model has nowhere to put such a pointer, so the same prose reaches an
HM3 item only as its own journal.

**One exception.** HM3's `armorlocation` declares no `notes` — it is the one
subtype that extends the Foundry base directly with no templates — so `notes` is
NA on both sides for that type, and its table says so.

**And one divergence, tracked rather than specified away.** HM3 records a
template priority on an Actor and not on an Item: `hm3/actors.mjs` writes
`flags.hm3.templatePriority`, and HM3's Item pass writes no equivalent, so an HM3
item compiled from a template note loses the fact that it is one
(`HeroicLands/package-build#283`). The row states the mapping the format makes;
the gap is in the pass, not in the table.

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

> **`archetype` is the retiring spelling.** It is still read, in the `sohl:`
> block and at the top level, so a tree sweeps on its own schedule
> (`HeroicLands/package-build#266`) — but the frontmatter linter refuses it, and
> what is compiled and emitted is `templatePriority` on all three sides.
>
> It is more than a rename, and the collision is **already live** rather than
> pending: `archetypes` is specified above as the _sort_ a character is, and a
> being's row declares it. So a number deciding which template wins and a list of
> what sort of character this is would otherwise be distinguished **only by a
> plural `s`**.
>
> A note carrying both spellings with **different** values is refused rather than
> resolved quietly — `templatePriority: null` and `archetype: 0` say opposite
> things, and picking either silently would decide it on the author's behalf.

```yaml
data:
  templatePriority: 0 # a template, at the priority SoHL's own ship at
```

```yaml
data:
  templatePriority: null # not a template
```

**Every note SoHL compiles into an Item or an Actor must state it.** Absent, the
build refuses: "not a template" has to be _said_, not left out, or an omission
and a decision look identical. The value is a number or `null`, and **`0` is a
real priority** — the one SoHL's own templates ship at — not an absence.

**Where it lands differs by system, because HM3's data model has no field for
it.** SoHL records it in `system`; HM3 keeps it under its own flag scope,
`flags.hm3`, and a note that is not a template writes nothing there rather than a
`null` nothing reads. Both of HM3's passes write it — an Item's flag was missing
until `HeroicLands/package-build#283`, which made an item note's priority reach
SoHL and stop at HM3, with nothing said on either side.

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

#### The document id

A note's Foundry `_id` is **derived from its canonical address**, and no note
needs to write one:

```yaml
type: miscgear
shortcode: bowlcer
# no `id:` — the document is filed under makeId("document", "sohl-none-miscgear-bowlcer")
```

The derivation is exactly:

```
_id = makeId("document", "<package>-<system>-<type>-<shortcode>")
```

— the note's canonical address, hashed with SHA-1 and truncated to the 16 hex
characters a Foundry id is. Nothing else feeds it. A consumer holding a
content-index entry can therefore recompute a document's id, and so its
compendium UUID, from the `canonical` key alone; it is not a value the index has
to transport.

**Why the address and not an authored string.** A note used to declare an
opaque 16-character `id` — 6,343 of them across the four content trees — which
said nothing its address did not, could not be read or reviewed, and was
guaranteed by nothing: `content-lint` refuses a **duplicate address** across
every pack of a document type, which is exactly the scope a primary document's
id must be unique within, and it said nothing at all about a duplicate `id`. So
the derived id inherits a guard that already exists, where the authored one had
none. It is the same principle that turned `folder: ONXsqZAIZr2qzxTb` into
`packFolder: <path>` above: an opaque derived identity does not belong in
authored content.

**An authored `id` still wins**, and that is how a document's identity is
**pinned**:

```yaml
type: miscgear
shortcode: bowlcer
id: plaiQQm2T5zVK5mO # pinned: this document keeps this id
```

A blank `id:` is not a pin — it is a deleted value with the key left behind, and
is treated as absent.

**A rename moves the id, and that is the trade.** The address carries the
shortcode, so renaming a shortcode gives the document a new `_id`. Two things
make that acceptable: a shortcode rename already breaks every wikilink to the
note, so it is a breaking change either way; and a note that must keep its
identity across one pins its `id`, which is what the pin is for. One diagnostic
narrows — `content-build` tells a **rename** from a **withdrawal** by matching
document ids across releases, and for an unpinned note both sides now move
together. It never reports a _wrong_ successor, and it stays exact for a pinned
note; for the rest, the note **declares** the rename (below).

**A note with no address gets no id, and no document.** `type` and `shortcode`
are what a note is addressed by, so a note missing either cannot be filed and
the build refuses it by that name rather than by a missing `id:`.

#### Declaring a rename

A note names the shortcode it used to be published under:

```yaml
type: weapongear
shortcode: Taburi
renamedFrom: Tabri
```

`(type, shortcode)` is a **published interface** — every satellite that declares
`itemCatalog: true` assembles its beings out of those addresses — so renaming a
shortcode breaks other repositories, and `content-build addresses diff` exists to
say so before a release does. To be useful it has to name where the address
_went_, and since ids are derived it can no longer work that out for an unpinned
note: both sides of the match move together, and the rename reads as a
withdrawal.

**Pinning an `id` needs foresight; a declaration needs only hindsight.** A pin
has to be written _before_ the rename, by an author who does not yet know they
will make one. An author who has just renamed a shortcode knows exactly what the
old one was, and that is the only moment anyone does — so this is the key to
reach for, and `id:` stays what it is for: keeping a document's identity across
the rename, which is a different question from explaining it.

**It takes one shortcode or a list**, because renames chain: the diff runs
against a released baseline, and a shortcode may have been renamed more than once
since. List every name the baseline might still know it by.

```yaml
shortcode: Taburin
renamedFrom:
  - Tabri
  - Taburi
```

**It is transient.** Once every baseline a build is compared against post-dates
the rename, the declaration has nothing left to say and should be deleted. That
is what separates it from an `id:` pin, which is permanent.

**One key per note, at the top level**, however many systems the note compiles
into: a shortcode is the note's rather than a system block's, so a note carrying
`sohl:` and `hm3:` blocks compiles two documents that share one shortcode, and
one declaration covers both.

**What a declaration changes is what the diagnostic can say, not what it says
about you.** A finding reports which of the two joins it had, because they are
not equally checkable — a matched id is a fact a reader can verify in both
artefacts, while a declaration is the author's word:

```text
since sohl@0.8.2, weapongear:Tabri is no longer published; the note now
published as weapongear:Taburi declares it was renamed from Tabri. Every
package that resolves weapongear:Tabri breaks when it moves past sohl@0.8.2
```

A rename that is neither pinned nor declared is still reported as a
**withdrawal**. Nothing infers a successor from a similar-looking string: a wrong
one sends the reader to the wrong fix, which is worse than saying nothing.

`content-lint` holds a declaration to the same rules a current address is held
to. An entry must be a well-formed shortcode, must not be the note's own, and
must name an address the package actually **vacated** — an entry naming an
address some note still publishes is refused, as are two notes claiming one
predecessor, since an address had one holder and so has one successor. A repeat
of the same entry is a warning; the declaration still works.

#### The compendium folder

A note says which folder of its pack it lands in:

```yaml
packFolder: poisonsandtoxins # a folder note's address
```

**`packFolder` is a folder note's address** — an ordinary address, resolved the
way every other reference is, and written in any form [the grammar
admits](#shorter-forms). The field supplies the type, so a bare shortcode is a
complete address here; `folder-poisonsandtoxins` and the fully qualified
`sohl-none-folder-poisonsandtoxins` name the same folder. An address no folder
note answers to is a build error naming the folders the package does declare.

Note this is the _pack_ folder, not the note's directory. The directory is
`file.path` / `file.folder`, which a content table reads separately.

**Where a folder materialises is derived from what references it.** Every pack
holding a document that names a folder gets that folder, and its ancestors with
it — so a documentation journal is filed beside the item it describes without
the journals pack having to declare anything. A folder nothing references
materialises nowhere.

That derivation is what makes a whole class of defect unrepresentable. The
folder used to be declared twice, once per pack, in two files free to disagree:
`sohl-thalorna` was missing 57 of its item folders from its journal folder file
and `sohl-kethira-basic` had no journal folder file at all, so both emitted
documentation journals into folders their own pack never declared — silently.
With one folder note and one address there is no second file to disagree with
the first.

> **`packFolder` was a path** for one release (`Possessions/Misc_Gear/Cooking`).
> A path encoded the hierarchy in the value, so reparenting a folder made every
> note naming it wrong — a structural edit became a corpus-wide rewrite. The
> path form is **removed**, not deprecated: nothing authored it yet, which is
> the whole reason the change was cheap enough to make.

> **`folder:` was a Foundry id**, resolved against a per-pack
> `*-folders.yaml` — five files per tree. Both halves are **retired** together
> (#260): the id spelling has nothing left to resolve against once the YAML is
> gone, and the YAML has no reader once the spelling is refused. A note that
> still writes `folder:` fails the build, naming `packFolder` and the line to
> rewrite, rather than being ignored — a retired field left ignored reads to
> its author as though it still works.

#### The knowledgebase category

`kbcat` names the group a note is listed under on the knowledgebase and the
website. It is written in the system block:

```yaml
sohl:
  kbcat: poisontoxin
```

**It compiles into no document.** No pack compiler reads it and no `system`
field receives it. It reaches a published page because a note's frontmatter is
copied onto that page, where a list layout groups by `sohl.kbcat` — so `kbcat`
is the one key in this section that answers _where does this appear_ for the
web rather than for Foundry. `pack` and `packFolder` place a document in a
compendium; `kbcat` places a page in a list.

That is also why it is specified here rather than in a type's table. A type's
fields say what the **builder** compiles, and `kbcat` is never compiled — but
what a note **may write** is broader than what any one consumer reads, and a
check that equated the two reported thousands of correctly authored properties
as unknown.

**It is editorial, and deliberately independent of `subType`.** The two are not
alternative spellings of one classification and neither is derived from the
other. `kbcat` both _subdivides_ a subtype — `trauma`/`physcond` is listed as
`physdisability`, `physfeature` or `physprivations` — and _renames_ one for
display, as `trauma`/`fear` listed under `phobias`. Most notes that carry a
`kbcat` declare no `subType` at all. So the two are stated separately where both
apply, and a reviewer should not read a disagreement between them as an error.

**The value is free-form, and nothing validates it.** There is no configured
list of categories. The frontmatter check knows `kbcat` is a key every type may
write and says nothing whatever about its value. A layout supplies display
titles and an explicit order for the values it knows about, and appends any
other value as its own group, titled by humanizing it.

The consequence is worth stating plainly, because it is the failure mode this
key has: **a misspelled category is not a build error and is not dropped — it
silently becomes a group of one**, sorted in after the known ones.

**A note that writes none is dropped from the list entirely.** Grouping is by
the key, so a page carrying no value falls in no group and is absent from the
list page — not listed last, not listed under a fallback heading, absent, with
nothing reported at either build. Every note of a listed type in SoHL's tree
carries one today, and nothing in this package enforces that; the content index
is where the question _which notes carry no `kbcat`?_ is answered.

**It is also what a content table sections on.** `sohl.kbcat AS _section` in a
`sql` fence is the ordinary case of _Content tables_ below, and the same
free-form value decides the headings there.

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

| form                            | expands to                                               |
| ------------------------------- | -------------------------------------------------------- |
| `package-system-type-shortcode` | itself                                                   |
| `system-type-shortcode`         | `<this package>-system-type-shortcode`                   |
| `type-shortcode`                | `<this package>-<this block's system>-type-shortcode`    |
| `shortcode`                     | as above, with the type from the field's own declaration |

There is no `package-type-shortcode`: the forms are exactly the **suffixes** of
the canonical address, so naming another package means naming its system too.
`kethira-place-tashal` is three segments, which reads as system `kethira`, and
fails.

#### An omitted segment defaults from where the link is written

It is **not** a wildcard and resolution is not a search. Every short form expands
to exactly one canonical address before anything is looked up, so a lookup either
finds one entry or none — there is no candidate set, and a cross-package
ambiguity is impossible by construction.

- **package** omitted → the current package. A short address therefore names
  _this_ package and never falls through to a dependency; reaching another one is
  the fully qualified form's job.
- **system** omitted → **the system block the link is written under**. Anywhere
  under `sohl:` is `sohl`; anywhere under `hm3:` is `hm3`; **anywhere else** —
  top-level frontmatter, `data:`, and body prose — is `none`. The enclosing block
  decides at any depth, so `sohl.items[3].model` and `sohl.system.body.structure`
  default alike; the field has no say.

**Under `none`, a system-bearing type addresses its documentation.** A note's
`none` address _is_ its `doc<type>` journal — the Item is the one with a system —
so a prose `[[affiliation-sirvadar|Sirvadar]]` names the page, which is what
prose almost always means. A prose link that means the **Item** states the
system: `[[sohl-affiliation-sirvadar|…]]`.

Only a type whose own document carries a system is redirected this way. A
`macro` and the map types have documentation journals too, but their own
documents are core ones already at `none`, so `macro-autoattack` names the Macro
and `docmacro-autoattack` its journal — two live addresses.

**An address capitalises nothing but its shortcode.** Package, system and type
are closed vocabularies with one spelling each, so a capital in any of them is an
error naming the lowercase form. A shortcode is case-sensitive and routinely
mixed — `Clb`, `LtShoe`, `HsTunic` — and keeps whatever the note declares.

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

| finding          | what it means                                    | the fix                                                |
| ---------------- | ------------------------------------------------ | ------------------------------------------------------ |
| `unlabelled`     | no `\|`, so the link addresses nothing           | write `[[type-shortcode\|Text]]`                       |
| `not-an-address` | labelled, but the target is not an address       | write the address, not the name                        |
| `not-lowercase`  | a package, system or type segment is capitalised | lowercase it; only the shortcode keeps its case        |
| `unknown-type`   | qualified, but names no type this build knows    | correct the type segment                               |
| `unresolved`     | parses as an address; nothing publishes it       | fix the shortcode, or qualify to reach another package |
| `ambiguous`      | _unreachable since #336; kept for the manifest_  | —                                                      |
| `unknown-anchor` | the address resolves; the `#section` does not    | correct the anchor                                     |

`ambiguous` no longer fires. An omitted segment defaults rather than wildcarding,
so a written target expands to one canonical address and a lookup returns one
entry or none — two claimants is a state the grammar can no longer reach. The
reason is retained so a consumer switching on it does not break, and because a
vendored manifest built by an older toolchain may still carry the finding.

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

That has been true of actors only since #337. A being used to produce its Actor
and nothing else, which left it the one system-bearing note with no address at
`none` — so a prose link naming it had nowhere to land. It now carries a
documentation journal like every other such note, addressed
`<package>-none-docbeing-<shortcode>` beside the Actor's
`<package>-<system>-being-<shortcode>`.

**A being keeps its prose inline as well.** `system.appearance` and
`system.dossier` are still the rendered text, where an item's description is an
`@UUID` pointer into its journal. The difference is deliberate and is about
size: one item is embedded across hundreds of beings, so baking its description
into every copy bloats the compendium by the length of the prose times the
number of carriers, and the pointer buys that back. An actor is singular, so the
same indirection would cost a reader a click and save nothing.

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
table used to need: the authored `ORDER BY` decides the section order too.

**Beware `packFolder`.** It is a note's _pack_ folder, not its directory — the
directory is `file.folder`. (The `folder` field it replaced is retired; a query
naming it matches nothing.)

###### Reading another package's notes

Each package this one **depends on** is attached as a schema named after it, so
a satellite can tabulate what it builds on:

````markdown
```sql
SELECT name.full AS "Name", sohl.skillBase AS "Base"
FROM sohl.notes
WHERE type = 'skill'
ORDER BY name.full
```
````

This package's own notes stay at the unqualified `notes`, and a query may read
both at once — joining your beings against the skills they cite is one `FROM`
clause. It needs no fetch and no configuration: a dependency's published index
is already cached when a compile starts, because resolving addresses across
packages needs it.

Which dataset a query reads is `FROM`'s job rather than a fence property. A
fence naming a file would write a build artifact's path into the corpus, so
renaming the artifact would mean sweeping every note that cited it.

###### Header arguments

Statements _about the directive_ — as opposed to the query — are written after
the language as **org-babel header arguments**:

````markdown
```sql :section-level 3 :allow-empty
SELECT name.full AS "Name", sohl.kbcat AS _section
FROM notes WHERE type = 'affliction'
```
````

The language word stays first and stays plain, so GitHub, Prettier and every
other markdown reader still highlight the block as SQL and simply ignore what
follows.

| Argument               | What it does                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `:allow-empty`         | A table selecting nothing is intended, not a stale query. Without it, empty is an error. |
| `:section-level <1-6>` | The heading level `_section` emits. Default `2`.                                         |

The grammar is org's, so it extends without inventing a spelling per property:

- a key is `:name` **starting a word**, so a colon inside or ending one is text
  — `:caption Gear: the tables` is a single argument;
- a value runs to the next key or the end of the line, spaces included;
- a key with no value means `true`, which is what `:allow-empty` is;
- a value may be `"quoted"` to hold a word that would otherwise read as a key;
- a repeated key takes its last value.

`dataview` keeps its own bare `allow-empty`; it is the retiring language and its
grammar is frozen.

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

#### A being's embedded items

`<system>.items` is a list, and each entry compiles into one embedded Item. An
entry takes one of two shapes.

**A copy of a catalogue item** names it with `model:` — an address, read by the
same grammar every wikilink is. The entry's remaining keys are merged over the
model, so it carries the model's values except where it says otherwise.

```yaml
sohl:
  items:
    - { model: skill-wpnc, system: { masteryLevelBase: 52 } }
    - { model: sohl-sohl-weapongear-whmr }
    - { model: sohl-sohl-weapongear-dgr, system: { shortcode: dgr2, name: Offhand dagger } }
```

| key      | required | meaning                                                       |
| -------- | -------- | ------------------------------------------------------------- |
| `model`  | yes      | The address of the item this entry is a copy of               |
| `system` | no       | Values that override the model's                              |
| `name`   | no       | A name of this entry's own, where it differs from the model's |

**`type:` is not written beside a `model`.** The address already names the type,
so a second statement of it is a place to be wrong, and it is refused.

**The address is written at whatever length says what it means.** Within this
package `type-shortcode` is enough; reaching another package means the full
`package-system-type-shortcode`, since the forms are suffixes of the canonical
address. The system segment defaults from the block the entry sits in — an entry
under `sohl.items` defaults to `sohl` — which is why the short form names an
**Item** here while the same string in body prose names a page.

**A custom item** — one that copies nothing — states `name`, `type` **and**
`system.shortcode`, all three required, plus whatever else its data model needs.
It is written in **block form**, never inline, so the two kinds of entry are
distinguishable at a glance:

```yaml
sohl:
  items:
    - name: Whetstone
      type: miscgear
      system:
        shortcode: whetstone
        weight: 1
        value: 5
        durability: 0
```

**A top-level `shortcode:` is retired** (#334). It selected a template, while the
`system.shortcode` beside it was the compiled item's identity — one word for two
things — and it could not say which package a template came from, so an address
resolved into a dependency only because no local pack claimed it and would have
retargeted silently the day one did.

#### Identifying a being's embedded items

Each entry in `sohl.items` compiles into one embedded Item, and its `_id` is
derived from **what the entry is**, never from where it sits in the list:

```
_id = makeId(<the actor's id>, "<subType>:<system.shortcode>")
```

An entry's identity is its **own `system.shortcode`**. The `model:` is not it —
a model names the item this entry is a _copy of_, and is never written to the
document — so two entries may share one model and are then two embodiments, each
stating its own identity:

```yaml
sohl:
  items:
    - model: weapongear-dgr # the catalogue's dagger
      name: Dagger 1
      system:
        shortcode: dgr1 # this dagger's own identity
    - model: weapongear-dgr
      name: Dagger 2
      system:
        shortcode: dgr2
```

**Two entries resolving to one identity are a build error naming both.** Without
their own `system.shortcode`, both daggers above carry the model's `dgr`,
which makes them the same entity to everything that resolves by `(type,
shortcode)` — compendium/world reconciliation, template shadowing, cohort
membership, effect and expression references. A `name` cannot stand in: it is
presentation, free to be localized or to diverge.

**Reordering the list moves no id.** The key used to carry the entry's position,
so inserting an item renumbered every id after it and a re-import created new
documents beside the old ones — while nothing about those documents had changed,
only their neighbours. The same is now true of a note's journal pages: an
unanchored page is keyed on its heading, so inserting a heading leaves every
other page's id where it was. Two sibling pages sharing a heading is likewise a
build error, matching the `MD024` lint rule that already refuses it.

If a `sohl` property is present, a SoHL actor of type "being" will be created.

If an `hm3` property is present, an HM3 actor is created. Its document type is **not** derived: `hm3.type` states it, and must be `character` or `creature`. A note that omits it is an error naming the note — see _The note vocabulary, and how it maps_.

A SoHL "being" document will be created, as will an "HM3" document.

| shared source     | → sohl | → hm3               |
| ----------------- | ------ | ------------------- |
| `data.species`    | NA     | `system.species`    |
| `data.gender`     | NA     | `system.gender`     |
| `data.occupation` | NA     | `system.occupation` |

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

It maps nothing beyond the shared rows above, actor row included: a vehicle
carries a portrait and a template priority and no field of its own.

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

The note type is `armorgear` in both cases. The `gear` suffix was briefly renamed away on the argument that it named a SoHL document subtype rather than the thing the note is about; that rename is reversed. Nothing had adopted the bare spelling — every note in every tree still writes the suffix — and dropping it from three of the five gear types while `weapongear` and `containergear` kept theirs cost more consistency than the argument bought.

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
flat namespace, a `projectilegear` and a `weapon` sharing a shortcode would collide on the
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
- gathering: A scheduled public occasion people travel to — a tournament or martial games, a
  great market or fair, a religious festival, a ceremony or rite. What these share is assembly
  on a cycle: a place, a time, and something contested or observed. Held apart from `calendar`,
  which covers the _reckoning_ — a festival's date is calendar and the festival is not, and a
  tournament is not a matter of time-reckoning at all — and from `culture`, which is a grouping
  of people rather than an occasion they attend.

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
> mistake as storing the template priority in flags: the data went where the only
> available container was, rather than where it belongs. Three notes carry it today.

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

```yaml
---
type: bundle
shortcode: hegovynvale
name:
  full: The Hegóvyn Vale
data:
  contents:
    - map-hegovynvale
    - miscgear-bowlcer
    - being-aurochs
---
Prose describing what the bundle is for.
```

An `Adventure` carries **copies** of what it holds, not references: importing one
creates or updates each document in the world, after which they live
independently. So a bundle is not a folder — a folder is a live grouping that
persists in the pack.

**Each address names the note's own document.** That is the same rule `pack:`
follows, so there is one answer and not two. A note that compiles into _two_
documents — an item and the JournalEntry its prose became — puts the second in a
bundle only when the bundle names it by its own `doc…` address:
`miscgear-bowlcer` is the item, `docmiscgear-bowlcer` its description page.

**An address that resolves to nothing fails the build.** A `folder` address is
refused with a message of its own: a folder materialises in every pack holding
something filed in it, so it belongs to no one pack and there is no single copy
to take.

**The note's prose becomes the Adventure's `description`**, which is what
Foundry renders on the import card. A bundle is something you hand someone, so
its prose belongs on the document itself — which is why, unlike an item, a
bundle earns no separate documentation journal.

Each Adventure is written to the pack the note's `pack` names — the shared
routing field every type uses, not one of the bundle's own — defaulting to the
configured `Adventure` pack, conventionally `adventures`. `<system>.pack`
overrides it for that system, as it does everywhere else.

**It cannot be the `adventures` companion**, though, where a repository also
compiles map notes: that pack is written by the scenes pass, and a companion is
written by its parent pass rather than routed to. A repository that authors
bundles declares an Adventure pack of its own, and one that declares none is
told so by name.

**A pack's `system:` constrains what its Adventures may hold.** An `Adventure`
has no `system` field, so a bundle spanning two systems cannot be one document
that knows it spans them: it is one Adventure per system, and the pack each is
written to is what carries the system. A pack declaring `system: hm3` sees the
HM3 packs and the system-neutral ones, so a member that publishes no HM3
document is **left out rather than failing** — and named, because an installer
that quietly ships half its contents is worse than one that fails. A pack
declaring no system scopes nothing away, and a member it cannot find is a dead
address.

**The bundles pass runs last**, after every pass producing what a bundle can
hold — Item, Actor, JournalEntry, Macro and Scene. That ordering is derived from
what the pass declares it reads, not from the order `packs:` happens to list, so
an Adventure pack declared first still compiles last.

### type: folder

Foundry's `Folder` — the grouping documents are filed in, and the last document
this package compiled from bespoke configuration (`*-folders.yaml`, five files
per tree) rather than from a note. Those files are retired (#260); a pack that
still names one is refused.

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

| `data` property | Values                                     | Description                                                                    |
| --------------- | ------------------------------------------ | ------------------------------------------------------------------------------ |
| `parent`        | `WikiLink`, or a map of them keyed by pack | The folder this one sits in — one address, or one per pack. Unset at the root. |
| `color`         | `"#RRGGBB"`, a string                      | The folder's colour. Unset for Foundry's default.                              |

A folder is addressed `<package>-none-folder-<shortcode>` — **`none`**, because a
`Folder` is a core Foundry document like a `JournalEntry` or a `Scene`, not a
system's. Its shortcode is [an address segment](#the-canonical-address) like
every other, so it is strictly alphanumeric: `possessionscooking`, never
`possessions-cooking`, which would read as two segments and resolve to nothing.

**`color` must be quoted**, and YAML gives no third option: `color: #7a4b2a`
parses as `null` (a `#` after a space opens a comment) and `color: 000000` parses
as the number `0`. All 639 colour values across the five trees are already
written `"#RRGGBB"`.

`parent` is an address, so a dangling one is an ordinary dead-address finding
rather than a special-cased `Unknown folder id`, and a cycle is refused. Both are
reported when the tree is read, not when something happens to reference the
folder that carries them.

**`parent` may be a map keyed by pack**, because a folder's _identity_ is one
thing and its _hierarchy_ is another. The same folder is deliberately filed
under different parents in different packs: an item compendium is browsed by
kind, a journal compendium is read by subject.

```yaml
data:
  parent:
    default: ~ # at the root of the items pack
    journals: descriptions # under Rules/Descriptions in the journals pack
```

`default` is every pack that is not named; an explicit `~` under a pack key means
_at the root there_, which is a different statement from saying nothing. A plain
scalar — the everyday spelling, and the right one wherever the hierarchies agree
— is exactly `{ default: <value> }`. The folder keeps **one id** across every
pack it materialises in, which is what files a documentation journal beside the
item it describes; only its parent differs.

Every key but `default` names a **pack the package declares**, and one that names
none is a finding of its own. It cannot be a harmless surplus: the compile asks
the map for the pack it is writing and falls back to `default` when there is no
such key, so a mistyped `journal:` files the folder wherever the default puts it
— exactly the hierarchy the key was written to override, and silently.

**A folder note carries no prose.** It is structure, not content, so it produces
no documentation journal and takes no part in `docEntryTypes`.

**It declares no pack.** Which packs a folder materialises in is derived from
[what references it](#the-compendium-folder), and its ancestors materialise with
it; a folder nothing references materialises nowhere.

**Its Foundry `_id` is derived from its address**, stable across runs, so a new
folder needs no invented id. An authored `id` is kept where one is present —
which is what lets a tree sweep its folder YAML into notes without a world that
already holds those folders losing them. Two folders claiming one id is a build
error.
