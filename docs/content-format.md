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
segment is alphanumeric — shortcodes are `^[A-Za-z0-9]+$`, types are bare words,
systems come from a closed registry, and `contentPackage` is alphanumeric — so
the hyphen is purely a separator. There is no longest-match against a roster and
no vocabulary check before splitting.

That is a guarantee rather than an observation, and it holds: of **4,456 distinct
shortcodes** across the four content trees, not one contains a character outside
`[A-Za-z0-9]`. It is load-bearing, so relaxing the charset later would break
resolution with nothing to say so.

`type/shortcode` with a slash is the legacy form, still resolved so links written
before the vault migrated do not silently die. A slash is _unconditionally_ an
address separator — pipe or no pipe — so an unknown type before one is an error
rather than a fallback to the alias index.

#### The pipe decides how a target resolves

There are two namespaces, and the pipe says which one to consult:

| written              | resolved as | displays                   |
| -------------------- | ----------- | -------------------------- |
| `[[Alias]]`          | an alias    | the alias, as written      |
| `[[WikiLink\|]]`     | an address  | the target note's own name |
| `[[WikiLink\|Text]]` | an address  | `Text`                     |

**No pipe means look this up in the alias index. A pipe means parse this as an
address.** The two never compete, and neither falls back to the other: a failure
in one namespace is a dead link, not an invitation to try the other.

That is what makes positional parsing safe. Note names contain hyphens —
`Grukar-ahk` is a name, not a `Grukar` of type `ahk` — and under a
resolve-by-shape rule the reader would have to consult the type vocabulary before
it dared split. Under the pipe rule it never faces the question: an unpiped
target is taken whole, hyphens and all, and only a piped target is ever split.

The empty label is not an oversight and not a way of writing no label. It says
_address this target, and show whatever it calls itself_ — so a note renamed later
takes its new name at every citation with no link edited. Omitting the pipe says
something else entirely: the phrase in the brackets is the alias, and the alias is
also what the reader sees.

So the two are worth keeping distinct even though both display a name: one is a
promise to follow the target, the other is a phrase the author chose.

#### An alias resolves only within its own type

A bare `[[awareness]]` in a `skill` note finds the `skill` whose alias is
`awareness` — not an `affliction` that happens to share the name. The alias index
is keyed by `(source note's type, alias)`, so the same word may be an alias in
several types without colliding.

Two notes of the **same** type claiming one alias is an error, and the report
names the claimants rather than the note that merely cited them. An ambiguous
alias never resolves to whichever was indexed first.

#### In frontmatter, a link is a bare address — never an alias

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

**Aliases are not permitted here.** A frontmatter value is always parsed by the
address grammar above, so a single-segment value such as `hexhodai` is a
_shortcode_, not an alias — the same spelling means different things in a
frontmatter field and in body prose, and this is the rule that says which.

The reason is that frontmatter is structure rather than prose. An alias is an
authorial convenience for writing a sentence that reads well; a field value is a
reference something else will compile against, and it should say exactly what it
points at. There is also nowhere to put the pipe: the distinction body text draws
with punctuation has no equivalent in a YAML scalar, so the region as a whole
picks one namespace and keeps it.

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

This also settles the alias question on its own. Aliases resolve within the
_source_ note's type, and a field almost always points at a different type — a
being's `stations` are `lore` notes — so an alias in a field would be looked up
in the wrong namespace even where one existed to find.

This is enforced rather than merely preferred: the build walks every frontmatter
value, reports each bracketed link it finds, each value that resolves only as an
alias, and each value whose qualification contradicts its field. A successful run says so — _no wikilink in frontmatter_ is part
of what `content-build links` reports when it passes.

Brackets belong in prose, where a link sits inside a sentence and needs marking
off from the words around it. A frontmatter value has nothing to be marked off
from.

#### Not yet implemented

Two rules in this section are settled but unbuilt, and describe the target rather
than current behaviour:

- **The `<system>` segment.** `readQualifier` reads package, type and shortcode;
  there is no system segment. A four-segment target today parses as
  `package-type-shortcode` with a hyphenated shortcode, or fails.
- **The pipe rule.** Today the pipe affects only the _label_: resolution runs the
  same either way, trying the address first and falling back to the alias — so a
  target is read by shape rather than by punctuation, and an author cannot say
  which of the two they meant.

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

**A companion note requires its system's type.** With one block and no
counterpart, nothing can derive whether `Spear (thrown)` is a `weapongear` or a
`missilegear` — there is no other system to infer from and no subType to read. So
`hm3.type` is _required_ on a single-block note, and is an override only on notes
that carry both.

The following special markdown sequences are recognized:

```
# Heading {#id .class1 .class2 attr="value"}
```

Any header can include curly braces. Inside the curly braces:

- `#id` represents an id anchor named `id` (only one allowed)
- `.class1` represents a CSS class named `class1` (any number of classes allowed)
- `attr="value"` represents an HTML attribute named `attr` whose value is `value` (any number of attr/value pairs allowed)

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

| `data` property             | Values                                         | Description                                                   |
| --------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| `portrait`                  | `string`                                       | File path to the portrait image                               |
| `templatePriority`          | `number`                                       | Template priority, _null_ = not a template                    |
| `archetypes`                | `Archetype[]`                                  | List of archtypical behaviors                                 |
| `occupation`                | `string`                                       | Name of the character's occupation                            |
| `stations`                  | `WikiLink[]`                                   | Name of the stations the character belongs to                 |
| `peoples`                   | `Wikilink[]`                                   | Name of the peoples the character belongs to                  |
| `homes`                     | `WikiLink[]`                                   | Place the being calls home                                    |
| `affiliations`              | `WikiLink[]`                                   | Affilliations (e.g., arcane/divine traditions, polities, etc) |
| `gender`                    | `male \| female \| other`                      | Gender of the character                                       |
| `species`                   | `WikiLink`                                     | Being's species (lore)                                        |
| `age`                       | `number`                                       | Age of the character                                          |
| `birthday`                  | `YYYY/MM/DD`                                   | Date of birth of the character                                |
| `height`                    | `number`                                       | Height in meters                                              |
| `weight`                    | `number`                                       | Weight in kilograms                                           |
| `frame`                     | `scant \| light \| medium \| large \| massive` | Relative frame size                                           |
| `appearance.eye_color`      | `string`                                       | Eye color                                                     |
| `appearance.hair_color`     | `string`                                       | Hair color                                                    |
| `appearance.skin_color`     | `string`                                       | Skin color                                                    |
| `appearance.complexion`     | `string`                                       | Complexion                                                    |
| `appearance.extra_features` | `string[]`                                     | Extra features                                                |

If a `sohl` property is present, a SoHL actor of type "being" will be created.

If an `hm3` property is present, an HM3 actor is created. Its document type is derived from the note's `subType`; `hm3.type` overrides that, and must be `character` or `creature`.

A SoHL "being" document will be created, as will an "HM3" document.

| shared source           | → sohl            | → hm3                        |
| ----------------------- | ----------------- | ---------------------------- |
| `data.portrait`         | `system.portrait` | `system.bioImage`            |
| `data.templatePriority` | `system.template` | `flags.hm3.templatePriority` |
| `data.species`          | NA                | `system.species`             |
| `data.gender`           | NA                | `system.gender`              |
| `data.occupation`       | NA                | `system.occupation`          |

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

| shared source           | → sohl            | → hm3 |
| ----------------------- | ----------------- | ----- |
| `data.portrait`         | `system.portrait` | NA    |
| `data.templatePriority` | `system.template` | NA    |

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
- Oligarchy: a small closed group rules, whether by birth, wealth, or rank
- Council: a deliberating body governs collectively with no single head
- Democracy: the general membership decides, directly or through representatives
- Theocracy: authority derives from divine mandate and rests with its clergy
- Meritocracy: position is earned by demonstrated skill, achievement, or expertise
- Stratocracy: the armed force is itself the government
- Feudal: authority flows through nested personal oaths rather than a central office
- Confederation: autonomous members retain sovereignty under a weak common center
- Anarchic: no formal governing authority — custom or force fills the gap

| `data` property      | Values            | Description                                                               |
| -------------------- | ----------------- | ------------------------------------------------------------------------- |
| `templatePriority`   | `number`          | Template priority, _null_ = not a template                                |
| `demonym`            | `string`          | What a member of this affiliation is called (a Vylarian)                  |
| `government.model`   | `GovernanceModel` | Type of government structure, if applicable                               |
| `government.summary` | `string`          | summary of the governance situation                                       |
| `languages`          | `WikiLink[]`      | Official languages (skills)                                               |
| `seat`               | `WikiLink`        | Where the affiliation's authority sits                                    |
| `domain`             | `WikiLink[]`      | Places over which this affiliation holds sway                             |
| `population`         | `number`          | Number of people in the affiliation                                       |
| `pantheons`          | `WikiLink[]`      | Official or dominant religious pantheons (affiliations)                   |
| `peoples`            | `WikiLink[]`      | People (lore) who are associated with the affiliation                     |
| `parents`            | `WikiLink[]`      | Affiliations that this affiliation is subordinate to                      |
| `relations`          | `Relation[]`      | Relations with other affiliations                                         |
| `society`            | `string`          | The kind of social order the affiliation operates within (feudal, tribal) |
| `office`             | `string`          | **Membership.** The office a member holds within it                       |
| `title`              | `string`          | **Membership.** The title a member bears (Veteran, Sir)                   |
| `level`              | `number`          | **Membership.** The member's rank within it                               |

Thirteen of those describe the **organisation**; three describe a **membership**.
`office`, `title` and `level` have no value on an affiliation as a catalogue
entry — they are filled when the affiliation is embedded on a being to record
that being's standing in it. That is why the 199 authored affiliation notes leave
all three null.

**`domain` is territorial, and only territorial.** Seventy-seven divine
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
| `data.domain`    | `system.domain`    | NA    |
| `data.parents`   | `system.parents`   | NA    |
| `data.relations` | `system.relations` | NA    |
| `data.society`   | `system.society`   | NA    |
| `data.office`    | `system.office`    | NA    |
| `data.title`     | `system.title`     | NA    |
| `data.level`     | `system.level`     | NA    |

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

### type: armor

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

### type: concoction

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

If an `hm3` property is present, an HM3 item is created. The following mappings are performed:

- if `subType` === `arcaneinvocation`, `hm3.type` = `spell`
- if `subType` === `divineinvocation`, `hm3.type` = `invocation`
- if `subType` === `arcanetalent`, `hm3.type` = `psionic`

If `hm3.type` is specified, it must be `psionic`, `spell` or `invocation`.

| shared source           | → sohl                        | → hm3         |
| ----------------------- | ----------------------------- | ------------- |
| `subType`               | `system.subType`              | **see above** |
| `data.assocSkill`       | `system.assocSkillCode`       | NA            |
| `data.assocAffiliation` | `system.assocAffiliationCode` | NA            |
| `data.masteryLevel`     | `system.masteryLevelBase`     | NA            |
| `data.level`            | `system.levelBase`            | NA            |
| `data.charges.value`    | `system.charges.value`        | NA            |
| `data.charges.max`      | `system.charges.max`          | NA            |

### type: projectile

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

### type: weapon

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

If an `hm3` property is present, an HM3 item is created. **`weapon` has no `subType`**: SoHL distinguishes a weapon's uses with strike modes rather than by kind, and HM3's document type follows from which of those the note describes. A note carrying both blocks is a `weapongear` in each; a companion note carrying only `hm3:` states `hm3.type` itself, and is usually a `missilegear` — see _One note is at most one document per system_.

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

subType:

- battlemap: Tactical scale, for a scene played out square by square.
- localmap: Roughly a kilometre across — a settlement, a holding, a small valley.
- regionalmap: Large scale, covering a region or a journey between places.

The three differ only in the canvas defaults derived for them, which is why they
are subTypes of one type rather than three types.

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

| `data` property | Values       | Description                                                                              |
| --------------- | ------------ | ---------------------------------------------------------------------------------------- |
| `demonym`       | `string[]`   | The name for a person from a particular place                                            |
| `peoples`       | `WikiLink[]` | The peoples (lore) who populate the place — kindreds and cultures, not individuals       |
| `parents`       | `WikiLink[]` | Enclosing places within which this place is located                                      |
| `maps`          | `WikiLink[]` | Maps associated with this place                                                          |
| `summary`       | `string`     | Summary description of the place                                                         |
| `population`    | `number`     | approximate population of the place                                                      |
| `languages`     | `WikiLink[]` | Languages (skill) spoken in the place                                                    |
| `affiliations`  | `WikiLink[]` | Affilliations associated with this place (e.g., arcane/divine traditions, polities, etc) |

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
- user-guide: How to operate the Foundry implementation to play by the rules.
- reference: Out-of-world lookup material about the setting or system — correspondences, conversions, indexes, glossaries.

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

| `data` property | Values                      | Description                                                          |
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
