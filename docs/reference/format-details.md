---
shortcode: referenceformatdetails
name: { full: "Content format details" }
type: doc
subType: reference
---

## Content format: how a note becomes documents

### Documentation

Markdown generates a JournalEntry: content before the first H1 becomes its "Introduction" page, and each H1 begins another page. The document Address is `<package>-note-<note_type>-<shortcode>`.

Each emitted infobox becomes a separate page at the end of the JournalEntry,
after every authored page. The page names are **Properties Infobox**,
**SoHL Infobox**, and **HM3 Infobox**, in that order where emitted. Generated
page ids derive from the entry and box identity, separately from authored
heading names and anchors. An authored heading may share an infobox page name.
What the boxes hold is [the infobox](#the-infobox) below.

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

For web pages, the full Markdown body renders as HTML with its infoboxes.

### The infobox

**The toolchain settles what each box holds; each medium places it.**

| medium  | placement                                                                                                     | collapsing                |
| ------- | ------------------------------------------------------------------------------------------------------------- | ------------------------- |
| book    | after the note's authored body, before the next entry; flows in the column measure, breaking between sections | none                      |
| website | side rail on wide screens, inline on narrow screens                                                           | `<details>`, default open |
| Foundry | one page per emitted box, after all authored pages                                                            | `<details>`, default open |

Two columns are print-only. A scrolling page has no fixed viewport, so columns
make a reader travel down and back up, and a narrow screen collapses to one
column regardless.

**Six rules hold in every medium.**

1. **Placement belongs to the medium**, as described above. Authored images
   remain in the body in their authored order.
2. **It contains no image.** A picture is authored in the text with its own
   directive, and its position governs.
3. **A section is the unit that flows.** Sections are whole and unbreakable and
   the panel breaks _between_ them, which is what lets a long box cross a
   column or page boundary without splitting a stat grid down the middle.
4. **An absent field is absent, not empty.** A row with no value is not
   emitted, and neither is a section with no rows: a creature carrying no
   equipment has no `EQUIPMENT` heading rather than an empty one. A placeholder
   asserts a fact that is not there, and an empty heading asserts that something
   was expected here and is missing. A corpus writes an absence three ways and
   all three count: the key is omitted, it holds the field's own default, or it
   holds a **sentinel** — `na`, `none`, `not applicable` — which is the same
   absence written as a word. `Potency: Na` is not a fact about a potion.
5. **A system box is never an empty panel; it says which silence it is.** Rule
   4 governs rows, and a box is not a row — a heading over nothing asserts that
   something should have been there. See
   [the three states of a system box](#the-three-states-of-a-system-box).
6. **Order is the toolchain's.** A medium renders boxes, sections and rows in
   the order given.

A note profile begins with `Name`. For a being with a top-level `subType`, it
follows with `Type: Character`, `Type: NPC`, or `Type: Creature`. A being with
no subtype has no `Type` row.

The `Culture` row shows the note's resolved culture, so a place or an
affiliation shows the culture it inherits. A culture note has no `Culture` row:
its resolved culture is its own Address, whether it leaves the field out or
names itself. See [Culture in the index](#culture-in-the-index).

**Embedded models link to documentation in an infobox.** The model Address
continues to identify the native Item used for compilation. Its displayed link
uses that same package, type and Shortcode under `note`, which names the
corresponding documentation journal. A model with no published documentation
keeps its known name as plain text; the infobox does not substitute an Actor or
Item link.

#### What the note box holds

**The note box's fields are the type's own `data:` vocabulary, in its declared
order** — the very table each `### type:` section below states. There is no
second list, so a key added to a type appears in the book, on the website and
in a compendium journal with no further edit. A `Name` row stands first on
every note, because every note has one. An `Aliases` row follows it when the
note names any aliases, preserving their authored order.

A few keys carry no row, and the reason in each case is one of exactly three —
the key is **machinery**, steering a build or an interface rather than
describing the subject; it is an **image**, which rule 2 keeps out of the box;
or it is a **source system's own detail**, which no surface's box shows:

| key                                                                          | why it carries no row                                      |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `templatePriority`                                                           | template machinery, not a fact about the subject           |
| `color`                                                                      | sidebar machinery, not a fact about the subject            |
| `id`                                                                         | document identity machinery, not a fact about the subject  |
| `pack`, `packFolder`                                                         | compendium routing machinery, not a fact about the subject |
| `events`                                                                     | chronology machinery, not a summary row                    |
| a calendar's `months`, `weekdays`, `seasons`, `namedDays`, `eras`, `formats` | calendar machinery, not a summary row                      |
| a map's `scene`, `fixup`                                                     | canvas machinery, not a summary row                        |
| `harnworld`                                                                  | HârnWorld source detail, which no surface's box shows      |
| the art slots, and a map's `thumbnail`                                       | an image, which rule 2 keeps out of the box                |

**A field whose value holds maps is drawn by what its declaration says the
maps are**, and a map is never set as text:

- **A map with declared keys** takes one row per key that holds a value, in
  declared order, labelled by the key and carrying its value. A list of words under a key is one row of
  them, comma-joined. A key holding nothing — `null`, `""`, `[]` — takes no
  row, and a map with nothing to show takes none at all.
- **A map keyed by Address** relates the note to others: `socialTies` and an
  affiliation's `relations` take one row per term — `Patron`, `Rival`,
  `Aligned` — whose value is the targets, each linked.
- **A map keyed by Shortcode** weighs each thing it names: a mystery's
  `skillAptitudes` is one row, each skill linked with its weight beside it —
  `Sword (+5)`, `Combat skills (-2)`.
- **A list of maps** keeps the rendering its field was built for — a place's
  `borders` and `routes` as linked places with their bearings, an affiliation's
  `governance.ranks` and `governance.offices` as one row per rung or post — or
  is withheld above as machinery.

**A being's memberships are a section of their own**, titled
**Affiliations**, after the profile rows: one line per membership, in the
order the note writes them — `War Chief, Hárár (5), of Vrystwald Tribes`. See
[the bodies a being belongs to](#the-bodies-a-being-belongs-to-and-its-standing-in-each).

A being's `age`, `height`, `weight` and `appearance.*` compose into a single
**Appearance** clause rather than taking six rows of their own: _Age 34, 6′ 1″,
181 lbs, medium frame, brown eyes_.

#### What a system box holds

**A system box's fields are that system's own field declaration**, in its
order. There is no second list here either, so a field added to a type reaches
the box with no further edit.

Two things keep a fact off it:

- **A value the declaration would have supplied anyway.** A field answered by
  its own default is a fact about the compiler, not about the note — and that is
  true of the value, wherever it was written. A corpus writes its defaults out:
  `improveFlag: false` and `combatCategory: none` are typed into hundreds of
  notes that mean nothing by them.
- **A fact the note box already put on the page.** A gear item's weight is
  system-agnostic and belongs to the note. What counts is what the note box
  _shows_, not what its vocabulary declares — the same fact is written under
  `data:` on one note and at its destination path on another, and a system box
  that stood down on the declaration alone would leave it on no surface at all.

**A measured quantity carries its unit on its value** — `Price 160d`,
`Weight 1.1 lbs`. The unit belongs to the quantity rather than to the name of
the quantity, so it is not folded into the label: `Price (d)` beside `160` makes
a reader reassemble one fact from two cells, and reads worst in the book, whose
label column is a narrow small-caps rule. A medium cannot supply it either —
appending `d` to a price means knowing which row is the price, which is the one
thing a generic renderer must never know. A row carrying a unit is `text`,
because a number with a unit is text for presentation.

**What a field is called** is a **presentation overlay** on that same
declaration, per system. It carries two things a compiler's field list cannot,
because they are about a page rather than about a document: a reader's word
where the declaration's key is the compiler's — `assocSkillCode` is exactly
right in a DataModel and wrong in a panel somebody reads — and the handful of
keys that belong on no page at all, either because the box shows the same fact
whole somewhere else or because they steer a character sheet rather than
describe the subject. It is an overlay and not a list: a field it does not
mention still gets a row, under its own humanised name.

Four types are read differently, because their box is derived rather than read
field by field — a **being**, whose attributes, skills, mystical abilities and
carried gear are one flat `sohl.items` list; **armour**, whose protection is
shown for all four aspects with an unstated one rendered `0`; a **weapon**,
whose strike modes are shown one per line with an unstated value rendered `—`;
and a **projectile**, whose impact is three declared fields composing into the
one quantity a reader wants. Both of those placeholders are decided by the
toolchain and travel as data, so no renderer has to know which field it is
looking at.

A weapon's strike modes are authored either as a **list**, each mode carrying
its own `shortcode`, or as a **mapping** keyed by the mode's name. Both are
read, and both yield the same section.

#### The three states of a system box

A system box says something on every page that carries one. Which of the three
it says is decided here and travels as the box's `statement`, so a medium draws
one thing and decides none of it.

| state          | when                                                       | what the box says                       |
| -------------- | ---------------------------------------------------------- | --------------------------------------- |
| content        | the system holds something the note box has not shown      | its sections, and no `statement`        |
| not available  | the system maps this note's type but produced no document  | `statement: Not available`              |
| nothing to add | the system produced a document holding nothing new to show | `statement: Nothing beyond the profile` |

The third state is not the second. _Not available_ is a statement about this
note — the system has no document for it, and a reader can act on that. A
system that _does_ compile the note and holds only facts the note box has
already given says so instead, because a reader told "not available" would go
looking for a document that exists, and an empty panel tells them nothing at
all.

A system that does not map the note's type gets **no box**. A box reading
_Not available_ on every affiliation page would suggest a gap in the note when
the truth is about the system's scope.

Whether a document was produced is the compile's own answer rather than a
reading of the frontmatter. Three things must hold: the note must carry that
system's block, its type must map to the system, and it must route to a pack of
the document class that map names. The block is the first of them because a
system block is what makes a game document — see
[A system block is what makes a game document](#a-system-block-is-what-makes-a-game-document).
A pack declaring **no** system is compiled by the fallback pass, which reads one
system's block and no other, so the question is the same one whether or not the
pack answered it.

#### Four section layouts

A section says how it is arranged, and a renderer switches on that and on a
value's `kind` — never on a field name, which is what keeps a field list from
leaking back into a template.

| `layout` value | shape                           | what carries it | where it is used                          |
| -------------- | ------------------------------- | --------------- | ----------------------------------------- |
| `rows`         | label/value pairs, one per line | `rows`          | a profile                                 |
| `grid`         | short label/value cells         | `cells`         | attributes, armour aspects                |
| `runin`        | groups of comma-joined entries  | `groups`        | skills, equipment                         |
| `list`         | one entry per line              | `entries`       | mystical abilities, a being's memberships |

| `kind` value | the value is                    |
| ------------ | ------------------------------- |
| `text`       | a string                        |
| `number`     | a number                        |
| `link`       | `{text, url?, uuid?, address?}` |
| `links`      | a list of those                 |
| `list`       | a list of strings               |

A website renders a link by its `url`, a compendium journal by its `uuid`, and
the book by the `address`, which is the entry's own label in the volume. A
reference the index could not reach keeps its words rather than being dropped.
An entry of a `runin` group or a `list` section is a link, and may carry a
`lead`: plain text set before it, so a membership line — `Captain, Blade (4), of
The Silent Talon Company` — links the body's name and nothing else.

**Emitted shape**, as a page's front matter carries it:

```yaml
infoboxes:
  - id: note
    kind: note
    title: Profile
    sections:
      - id: profile
        layout: rows
        rows:
          - label: Name
            kind: text
            value: Brànwâal Dôrgaar
          - label: Homes
            kind: links
            value:
              - text: Vylar
                url: /thalorna/place-vylar/
      - id: affiliations
        label: Affiliations
        layout: list
        entries:
          - lead: "Captain, Blade (4), of "
            text: The Silent Talon Company
            url: /thalorna/affiliation-slntlncmpny/
  - id: sohl
    kind: system
    system: sohl
    title: SoHL
    available: true
    sections:
      - id: attributes
        label: Attributes
        layout: grid
        cells:
          - label: STR
            value: 14
      - id: skills
        label: Skills
        layout: runin
        groups:
          - label: Combat
            entries:
              - text: Melee 75
  - id: hm3
    kind: system
    system: hm3
    title: HM3
    available: false
    sections: []
    statement: Not available
```

### Frontmatter has three regions

A HeroicLands note has opening YAML frontmatter with nonempty `shortcode` and
`type` values. The opening and closing `---` delimiters accept LF or CRLF line
endings. Parsing keeps the original source text and diagnostic positions;
malformed YAML is an error with either line ending. The charset check recommends
LF and reports carriage returns as warnings. Other Markdown files are ordinary
Markdown. A note's frontmatter has three regions:

| Region               | Describes                                               | Unknown keys |
| -------------------- | ------------------------------------------------------- | ------------ |
| **Top level**        | The note's identity, name, description, and publication | An error     |
| **`data:`**          | The subject itself, shared by systems                   | An error     |
| **`hm3:` / `sohl:`** | The subject as one system's documents                   | An error     |
| **`dnd5e:`**         | A declared system block with no document field schema   | Unchecked    |

The complete top-level allowlist, in its required order, is `shortcode`, `name`,
`type`, `subType`, `description`, `tags`, `data`, `hm3`, `sohl`, `dnd5e`. The
address vocabulary recognizes three systems: `sohl`, `hm3`, and `dnd5e`. Omit
fields that do not apply. The first fields of a typical note look like this:

The `dnd5e` system id is accepted in configuration and addresses. No
dnd5e-specific document types are declared, so the block has no field
vocabulary for lint or a compiler to check.

```yaml
---
shortcode: example
name: { full: Example }
type: lore
subType: concept
description: A short page description.
tags: [draft]
data: {}
sohl: {}
---
```

Any other top-level key is an error. To keep an author-only note beside the
content, comment out its YAML lines with `#`. Comments remain valid YAML text
and do not become data in the JSONL index, generated pages, or Foundry documents.

`name` is a map with a required nonempty `full` string when present. It may
also contain `aliases`, an ordered list of nonempty strings. A being with
`subType: character` may additionally contain nonempty `given` and `clan`
strings. Other keys under `name` are errors. For a character or NPC, the first
alias is its nickname. A being's homes belong in `data.homes`.

There is no custom site metadata. `description` supplies the page's short
description; `tags` carries publication and classification tags.

Arrays and objects use one-line YAML flow form when the complete line is under
100 characters. At 100 characters or more, they use full block form. A multiline
flow collection is formatted into one of those forms; folded collections are
not used. `package-build format --write` applies this rule and the top-level
order without changing the Markdown body.

#### What checks a system block

A system block — `sohl:` or `hm3:` — is checked against that system's own
field schema: the fields the system declares for each document type, with
their shapes. None of the `data:` vocabulary applies inside it, the inner-key
rule included, and a key the system's schema does not declare is an error at
its own line.

A block is checked only where both of these hold:

- **The package declares the system** — under `systems:`, as a pack's
  `system:`, or as the system the package is or requires. A block for a system
  the package does not declare is not checked.
- **The system's fields are known.** The `sohl:` block is held to the note
  schemas the build carries; any other system's block is held to the
  `itemBuilders` registry that declares it. Where a declared system has
  neither, the lint says that system's block is unchecked, and a key inside it
  is discarded at compile.

A `dnd5e:` block has no field schema, so nothing checks it.

#### Dates and calendars

A canonical date is `<year>[.<day>[:HHMMSS]]`. The day is one-based within the world's year, bound against `data.year.days` on the world's `place` note. A tree whose notes declare no world year bounds no day: the value is read as written, however large. `720` covers the whole year; `720.136` covers that day; `720.136:143005` identifies one second. Negative years are valid. Prefix either form with `~` to express uncertainty beyond its written interval. `unknown` is allowed only in fields that accept an unknown occurrence.

**Quote a canonical date that states a day.** `born: "667.130"` is read as written; unquoted, YAML parses the scalar as a number and a trailing zero on the day is gone before any date reader sees it, so `667.130` and `667.13` arrive as one value. A number-valued date is an error wherever appending a zero to its day would still name a day inside the world's year — the message names the file, the line and both readings — and is read as written where no such day exists, since `675.2810` is no day of a 365-day year. A bare year loses nothing and needs no quotes.

A named date uses `datefrom <calendar> <date>`, where the final text follows the calendar's `data.formats.std` pattern, or its first named pattern when `std` is absent. For example, a calendar with `std: "MM/DD/Y GGG"` reads `datefrom commoncal 01/23/326 VR`, `datefrom commoncal 01/326 VR`, and `datefrom commoncal 326 VR`. Omitting the day or month retains month or year precision in frontmatter. The CLI `datefrom` command requires a day to produce one canonical day. The calendar argument is a shortcode or Address. A time follows the day only when specified in the pattern, or as a trailing `HH:mm:ss` when the pattern has no clock tokens. A named date with an era-relative year names its era.

`data.epoch` on a calendar is a canonical `<year>.<day>`: the day on which **calendar year 1, day 1** occurs. It cannot be year-only, approximate, or expressed through its own calendar. `data.moon.newOn` also locates a particular day. The `data.eras[].start` values are `null` or positive **calendar years**. Exactly one null era covers dates before calendar year 1, and exactly one era starts at year 1. Further era starts are distinct positive integers. Numeric start order determines era boundaries, regardless of array order. The null era numbers its years backwards; later eras begin at their own displayed year 1. An era may have a unique uppercase `marker` for resolving authored dates.

`package-build datefrom <calendar> <date>` reads the default calendar pattern and prints a canonical day. `package-build dateto <calendar> <canonical-date>` prints the day in the covering era; `--format <name>` chooses another named output pattern. The [authoring guide](../authoring/dates-and-calendars.md) gives a complete example.

Markdown prose accepts inline `{{...}}` expressions. A property path reads
the note's frontmatter, and `dateformat` converts a date to the reckoning used by a
specified calendar. The first argument names a calendar note by shortcode or
Address, or one of its eras by `<calendar>.<era>`. Use a full Address when a
short name is ambiguous. The second argument is a canonical date or a
frontmatter property holding a date. An optional third argument names an output
format from the calendar note. An explicit era that does not cover the date is an error.

```markdown
{{name.full}} was born on {{dateformat "vrcal" data.born}}.
{{dateformat data.calendar data.born}}
The event fell on {{dateformat "vrcal" "300.25"}}.
{{and (gt 3 5) (lt 4 2)}}
{{sql "SELECT COUNT(*) FROM notes WHERE type = 'being'"}}
{{words (sql "SELECT COUNT(*) FROM notes WHERE type = 'being'")}}
{{digits (sql "SELECT COUNT(*) FROM entries")}}
{{gt (sql "SELECT COUNT(*) FROM notes WHERE type = 'being'") 10}}
```

The comparison helpers `gt`, `gte`, `lt`, and `lte` take two numbers; `eq`
compares two values. `and`, `or`, and `not` combine Boolean results. Nested
helpers use Handlebars parentheses. These expressions are replaced on web,
Foundry, and book pages. Code spans and fences remain literal, as do Hugo
shortcodes such as `{{< glyph slug="bes" >}}`. Prefix `\{{` to show an
expression literally in prose. A missing property, unresolved
calendar, or invalid date produces a located build error.

`sql` runs a quoted SQL query against the same `notes` index used by SQL
tables. It returns one scalar value, so the query must produce exactly one
row and one column. It can be nested inside comparisons. A query returning
zero rows, several rows, several columns, or a null or empty value is an error
at the expression. `sql` preserves the value's numeric type for comparisons.
Wrap a whole number in `words` to write American cardinal prose, including
hyphenated compounds such as **forty-five**. Wrap a number in `digits` to
group thousands, such as **12,345**. A decimal can use `digits`; `words`
requires a whole number. An unwrapped `sql` result prints its ordinary value.
The query is evaluated once per unique SQL string in a note. The returned
value is the same in web, Foundry, and book output.
Dependency indexes are available through their attached package schemas,
just as they are in SQL tables.

**`data:` is closed.** It holds the type-specific facts about the
subject — a weapon's weight, an affliction's transmission, a being's species —
and every note type declares which keys it may carry. A misspelled key is a
finding in either region.

**So is every map inside it, at every depth.** A field whose value holds maps
— a map such as `harnworld`, a list of maps such as `borders` or `months`, a map
keyed by Address whose values are maps such as `affiliations` — declares the
keys those maps take, which of them are required, and what each holds. A key a
field does not declare is an error at that key's own line and column, however
deeply it is nested: `data.governance.offices.Chancellor.holders[0].stat` is
refused at `stat`, with the declared key it was probably meant to be. A
required key left out is an error at the map that should carry it, and a value
of the wrong kind is an error at the value. A dotted property such as
`appearance.eye_color` closes its container the same way, so `appearance`
takes only the keys the type's table lists. The
[note-type reference](note-types.md) tabulates every inner key, generated from
the same declarations the lint reads; an event's keys are tabulated under
[Events](#events). Two things are outside this rule. A system block follows its
own schema — see [What checks a system block](#what-checks-a-system-block). A
map note's `data.scene` is an exported Foundry Scene and keeps Foundry's own
keys; its table row says so, beginning **Keys not declared here:**.

Every note type may put a pinned document id in `data.id`, a shared compendium
route in `data.pack`, a shared folder Address in `data.packFolder`, and its
HârnWorld source details in `data.harnworld`. A system block's `pack` or
`packFolder` overrides the shared value for that system.

**Tags are open, except the ones that classify.** A tag naming a theme or a region — `underworld`,
`byzaria`, `riverlands` — is the author's own and this build has no opinion about it.
A tag that classifies the subject is different, because something queries it. A
settlement tagged `village` appears in the list of villages and an untagged one
does not, so `vilage` does not merely look wrong: it removes the note from an
index, silently, and the index still renders. That is the same failure a
misspelled `data:` key is, and it gets the same answer — the vocabulary
is declared, so a near miss is a finding that names what you probably meant.

| group               | applies to             | tags                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **place kind**      | `place` / `settlement` | `city`, `city-state`, `town`, `village`, `settlement`, `port`, `fortress`, `citadel`, `castle`, `stronghold`, `garrison`, `camp`, `oasis`, `waypoint`, `post`, `precinct`, `district`, `necropolis`, `hall`, `capital`                                                                                                                                  |
| **place character** | `place`                | `fortified`, `temple`, `market`, `trading`, `merchant`, `mining`, `fishing`, `naval`, `military`, `imperial`, `provincial`, `coastal`, `river`, `lakeside`, `hill`, `mountain`, `valley`, `forest`, `woodland`, `inland`, `island`, `frontier`, `border`, `craft`, `caravan`, `pilgrimage`, `holy`, `sacred`, `free`, `ford`, `portage`, `pass`, `well` |
| **place scale**     | `place` / `region`     | `continent`                                                                                                                                                                                                                                                                                                                                             |
| **being station**   | `being`                | `tradesfolk`, `common-folk`, `soldiery`, `administration`, `clergy`, `mages`, `underworld`, `dependents`, `guilded`, `unguilded`                                                                                                                                                                                                                        |
| **state**           | any                    | `draft`                                                                                                                                                                                                                                                                                                                                                 |
| **audience**        | any                    | `gm`                                                                                                                                                                                                                                                                                                                                                    |

`gm` marks a note for GM access. It is excluded from public site pages, SQL
tables on the public site, and the book. Foundry compiles it only to private
compendiums. Any note may reference it with an ordinary wikilink; the
reference is automatically a spoiler. The `.show` override reveals that
reference without changing the destination's audience or access permissions;
see [references to secret subjects](#references-to-secret-subjects).

**`draft` marks unfinished content.** It does two things and nothing
else: a link _into_ a draft note renders marked, and the note itself states that
it is unfinished wherever a reader meets it.

A link into it renders as
`<span class="sohl-draft-link" title="Draft — not yet written">…</span>` in a
compiled journal and on the website alike, with the appearance supplied by the
consuming system's stylesheet or the site theme.

The note's own statement is the **draft notice**, and it reads the same on every
surface:

> **Draft.** This entry is unfinished. What it states may change, and nothing in
> it is settled.

It leads the entry, before the authored content, because a reader
deciding whether to rely on an entry has to be told before they read it. Where
it lands:

| Surface      | What carries it                                                              |
| ------------ | ---------------------------------------------------------------------------- |
| JournalEntry | a `blockquote.sohl-draft-notice` at the head of the first page               |
| Actor        | the dossier the sheet draws — SoHL's `dossier`, HM3's `biography`            |
| The book     | a drawn mark and a left rule between the entry's plate and its authored body |
| The website  | the theme's own notice, above the infobox rail and the prose                 |

**An Actor carries it once.** A being's prose reaches two fields, and a document
saying the same thing twice teaches a reader to skip it — a printed sheet draws
both in turn — so the dossier carries the notice and the appearance is
untouched. The two systems pair by the authored section each field reads rather
than by its name, so `dossier` and `biography` carry it while `appearance` and
`description` do not.

**The mark is a notice, not a hazard** — `fa-circle-exclamation`, which Foundry
bundles, so a journal page carries it with no module stylesheet loaded. The book
draws its own, because a consumer declaring no icon family is the ordinary case
and a glyph a face lacks is silent in Typst. Stripped of mark and rule the
sentence still states the whole thing, which is the floor every surface is built
to.

**Nothing else changes**: the note compiles, validates, publishes and resolves
exactly as any other, and it stays in the packs, in the link manifest and on the
site. The `draft` tag marks the content for readers without making its Address unresolvable.

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

#### A being's subtype describes the subject

`being` accepts the optional top-level values `npc`, `character`, and `creature`.
The subtype classifies the note's subject; it does not select a Foundry Actor
document type.

| `subType`   | the subject is                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| `npc`       | A character meant to be encountered. It may describe a reusable template and need not be a singular individual. |
| `character` | A detailed, playable, singular individual.                                                                      |
| `creature`  | Any being that is neither a character nor an NPC.                                                               |

`hm3.type` remains the HM3 document selector and must be `character` or
`creature` when an HM3 being block is present. SoHL continues to compile beings
as `Actor.being`. The note subtype and each system's document type answer
different questions.

Tags remain open descriptive terms. A being may carry tags such as `undead`,
`soldiery`, or `draft`; those tags do not replace the `subType` classification.

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

**A shared source and an in-block key are separate declarations.**
`data.gender` is the shared source for HM3 gender; `hm3.gender` is its
in-block spelling, and `hm3.system.gender` is the native destination.
The native destination wins, followed by the in-block value and the shared
source. Field declarations name both source and destination explicitly.

**A field without a shared source reads its system declaration.** An
`affiliation` item's `system.title` is the style of address an office carries;
the note's heading reads `name.full`. The field reads
`<system>.system.<field>` and the in-block position, which describe the
document. Native species is independent of the shared lore Address in `data.species`.
`subType` has the same meaning at both levels.

**Some of a system's fields are runtime state, and a note may not write any of
them.** A data model declares everything a document stores, and part of that is
what _play_ writes: an affliction's `onsetDate` is the world time its onset
fired at. Writing `<system>.system.<field>` reaches such a field as directly as
any other — the block is a verbatim passthrough, and the field really is in the
schema — so a note left free to stamp one ships that world's play state to
every world that installs the compiled pack.

So a field the document writes for itself is **declared as such**, and the
declaration says both halves of the fact: authoring it is an error naming the
note, the key and what the field holds, and the compiled document leaves the key
out entirely so the data model's own initial value stands. This is a property of
the field rather than a list of names, so it covers every such field a system
adds later. The per-type tables below never list one — they are the vocabulary
an author writes — and each type that has any names them under its table.

**An `Address` becomes a `Shortcode` where the target field expects one.** SoHL
resolves a stored cross-reference among the items one actor holds, and packages do
not exist there, so the field holds a `Shortcode`. Three `affiliation` fields are
authored as Addresses and stored that way: `data.seat` becomes `system.seat`,
`data.parents` becomes `system.parents`,
and each authored key of `data.relations` becomes a key of `system.relations`. The
reduction happens at build time, and two things are errors naming the note: an
Address whose type the field does not accept, and two Addresses that reduce to one
shortcode, which the field cannot hold both of.

**A SoHL skill Address becomes a native Item UUID.** An affiliation's
`sohl.system.commonSkills` names skills in its own package or a declared
dependency. Its `system.commonSkills` contains the exact published Item UUIDs,
including each foreign module's own pack name. Native skill lookup uses those
UUIDs; the journal, website and book use documentation links for presentation.

**A `Code` suffix marks a different thing.** `system.assocSkillCode`,
`system.assocAffiliationCode` and `system.parentSkillCode` hold a `Shortcode` at
both ends — each is authored as one, under `<system>.system`, and emitted verbatim
— so no Address is reduced into them and none of them has a shared source. A value
carrying a separator is refused there by the shortcode charset rather than read as
an Address. `data.assocSkill`, `data.assocAffiliation` and `data.parentSkill` are
properties of the **page**: each is an Address naming the note an infobox row
links to, and none reaches a compiled document.

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

**A type's `subType` values are stated in one shape**, so that they can be read
and compared to the vocabulary that enforces them. Under the type's
heading, write `**subType**:` on a line of its own, then one bullet per value —
`- <value>` or `- <value>: <definition>` — and nothing else between the marker
and the list. A type that has no `subType`, or whose values are not enumerated
yet, writes no marker at all. Any other spelling is a build error naming the
line: five were in use, and a reader that accepted them all would keep accepting
the sixth by reading a section as declaring nothing, which is exactly the drift
the comparison exists to catch.

### Mappings every type shares

Eight rows were identical in all sixteen tables below, so they are stated once
here and omitted there. Each per-type table shows only what is particular to that
type.

| shared source           | → sohl                    | → hm3                        |
| ----------------------- | ------------------------- | ---------------------------- |
| `name.full`             | `name`                    | `name`                       |
| `data.icon`             | `img`                     | `img`                        |
| `data.id`               | `_id`                     | `_id`                        |
| `data.packFolder`       | `folder`                  | `folder`                     |
| `shortcode`             | `system.shortcode`        | NA                           |
| `data.templatePriority` | `system.templatePriority` | `flags.hm3.templatePriority` |
| `actionDefs`            | `system.actionDefs`       | NA                           |
| `notes`                 | `system.notes`            | `system.notes`               |

**A column reads NA wherever the type produces no document in that system.** An
`affiliation` has no HM3 form, so its whole HM3 column is NA; `armorlocation` has
no SoHL form, so its SoHL column is. Nothing else varies — which is why these
rows are worth stating once: repeated sixteen times they buried the differences
that matter.

**`data.icon` is declared only for the types whose document carries art.**
The row is not shared: `being`, every Item type, `macro` and `bundle` compile
into a document with an image, and only those declare `icon`. `doc`, `place`,
`lore` and `scenario` compile into a JournalEntry, which has no image of any
kind; a `map` compiles into a Scene whose art is its own; a `folder` compiles
into a Foundry `Folder`; and a `homepage` compiles into no compendium document
at all. On any of those `icon` is not a declared property, so the note is
refused at the key's own line rather than compiled with the value dropped.

**What a note writes is an address; what a document carries is a path.**
`data.icon` is an `Address` defaulting to type `icon`, so a being writes
`icon: anvil` and never a file name. The compiler resolves that address to the
file the owning package ships and writes the resulting path into `img`. The two
sides of this row are therefore in two different currencies, which is why the
row reads `data.icon → img` rather than naming one thing twice.

Which types declare `icon` is **not a list**. It is asked of the passes: a type
routes to a document, a document to the pass that compiles it, and each pass
declares the art it writes (`emitsArt`). A pass that emits `icon` is a type that
declares the key. Any other art key authored where no pass emits it, such as a
`tokenIcon` on an Item type, is a warning naming the note and the key, because
the note still compiles correctly and a site template may read there what no
document carries. `null` is never reported.

#### Deliberate cross-references

Every note type accepts `data.seeAlso`: an ordered list of maps with a required
`address` and an optional string `gloss`. The Address names a whole note,
defaults to the current package and the `note` system, and has no default type.
It may name a note in a declared dependency. A gloss is a short plain-text
phrase explaining the connection.

```yaml
data:
  seeAlso:
    - address: lore-harborhistory
      gloss: The founding of the port
    - address: place-breakwater
    - address: thalorna-note-lore-searoutes
      gloss: Routes beyond the bay
```

The vocabulary declares the closed entry shape. The note boundary decodes each
nested Address, and the frontmatter check locates unresolved, duplicate and
self references at `data.seeAlso.<index>.address`. Duplicate detection compares
resolved destinations, so alternative spellings of one target do not make two
entries. Anchors are not accepted.

On the website, `related.seeAlso` carries `{ title, url, type, gloss? }` entries
in authored order. The theme renders that group ahead of the inferred
backlinks and mentions, with duplicates removed by resolved URL. Deliberate
references can point outside the local site to declared dependency pages.
The field has no infobox row. Foundry journals append a See also page with
compendium links; books append a See also section with the book renderer's
normal internal or external links. An absent or empty list emits nothing.

#### The art slots

A note declares the art its document needs, and every other image in it is
inline. Every slot is an ordinary `Address` field declaring a default type,
exactly as `seat` declares `place` — a bare shortcode takes its type from the
declaration, and qualification climbs the same short-form ladder every other
link uses.

| field       | default type | accepts         | resolves into                 | on                                          |
| ----------- | ------------ | --------------- | ----------------------------- | ------------------------------------------- |
| `icon`      | `icon`       | `icon`, `image` | `document.img`                | `being`, every Item type, `macro`, `bundle` |
| `tokenIcon` | `icon`       | `icon`, `image` | `prototypeToken.texture.src`  | Actor types                                 |
| `banner`    | `image`      | `icon`, `image` | the site hero image, 1792×768 | any note; not a Foundry field               |

A map's `thumbnail` is not an art slot. It is a map field resolved into the
Scene's `thumb` as a fixup — see [the thumbnail](#the-thumbnail).

Every slot is authored under `data:`:

```yaml
data:
  icon: anvil
  banner: packagebuild-none-image-skillbnr
```

**An empty value is an error.** `icon: ""`, `tokenIcon: ""` and `banner: ""`
are each a finding at the key, in `data:` or in a system block. A slot names an
image, or the key is removed and the document takes its type's default;
`icon: null` says the same as removing it.

**Every slot accepts a second type beyond the one it defaults to**, and the two
defaults pair with the same accepted set: `icon` and `tokenIcon` default to
`icon`, `banner` defaults to `image`, and every slot accepts `icon` **and**
`image` regardless of which one it defaults to. A bare shortcode still
takes the slot's default — `icon: anvil` above names an `icon`, not an `image`
— and it is a **qualified** value, one that states its own type, that the
accepted set governs. `sohl-kethira-basic` writes an `icon` slot this way
twenty times, once per faith tradition, because a deity's profile art is a full
illustration rather than a game icon:

```yaml
data:
  icon: image-kpagrik
```

That value is accepted because `image` is in the slot's accepted set, not
because it matches the default — `icon` still defaults to `icon`. `audio` is
refused at every slot: a sound is not art, and a value naming one — `icon:
audio-thunder`, say — is an error naming the set the slot accepts, never a
silent fall back to the note's default art.

**These properties are legal on _every_ note**, whatever its type. `data:` is a
closed container and the per-type vocabularies below are the only lists there
are, so a key legal everywhere is stated once here rather than repeated in
twenty-five tables where the one that was mistyped would be the one nobody
noticed:

| shared `data` property | Values                        | Description                                                                                |
| ---------------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| `seeAlso`              | list of `{ address, gloss? }` | Deliberate cross-references in reading order, shown on the site, in journals and in books. |
| `seeAlso[].address`    | a note `Address`              | Required; the whole note to read next.                                                     |
| `seeAlso[].gloss`      | `string`                      | An optional short phrase saying why to follow the reference.                               |
| `id`                   | `string`                      | A pinned document identity.                                                                |
| `pack`                 | `string`                      | The shared compendium route.                                                               |
| `packFolder`           | `Address` or pack map         | The shared compendium folder Address.                                                      |
| `harnworld`            | `{ realm?, ritual? }`         | HârnWorld source details.                                                                  |
| `harnworld.realm`      | `string`                      | The HârnWorld realm the subject belongs to.                                                |
| `harnworld.ritual`     | `string[]`                    | The HârnWorld religions the subject observes.                                              |
| `banner`               | `Address`                     | The page's hero image — an `image` address, cut to 1792×768.                               |

`data.harnworld` takes two keys and nothing else: `realm`, a string naming the
HârnWorld realm the subject belongs to, and `ritual`, a list of strings naming
the religions it observes. Both are optional. The infobox does not show either.

```yaml
data:
  harnworld:
    realm: Kaldor
    ritual: [Larani, Peoni]
```

`icon` is declared only for the types whose document carries art; see
the art slots below. `banner` reaches no compiled document at
all, and a page is what every note publishes, so it is legal everywhere.

`tokenIcon` is narrower, and the Actor types' own tables name it. A map takes
no art slot: its Scene is exported from Foundry and names its own art.

**A portrait is not one of them.** A picture of the subject is a picture, so it
is authored in the prose that describes the subject, as an ordinary embedded
image — see [the lead image](#the-lead-image). A slot exists for art a
_document field_ needs; nothing else earns one.

**A reference carries no slashes and no extension.** That is what keeps it from
being read as a file name, and it is checked: a value shaped like a pathname is
an error naming the note and the key.

`tokenIcon` unset defaults to `icon`. A token has to read at grid scale and when
a map is zoomed out, so it is an `icon` rather than an `image`, and its fallback
has to be `icon`-typed too.

Actor types (`being`, `vehicle`) therefore add one row:

| shared source    | → sohl                       | → hm3                        |
| ---------------- | ---------------------------- | ---------------------------- |
| `data.tokenIcon` | `prototypeToken.texture.src` | `prototypeToken.texture.src` |

An actor's two pieces of art are two different questions. `data.icon` is the
profile art — what a directory listing shows beside the name and what the sheet
header carries. `data.tokenIcon` is what a token on the canvas wears. Both are
addresses and both resolve the same way; only the destination differs. An Item
has one piece of art, so this row applies to actor types alone.

**A `data:` source is authored in `data:` alone.** The same key written at the
top level is outside the closed top-level region, and written inside a system
block it is reported at its own line with the `data:` key it belongs to.

**No image key is one of those.** A top-level `img:` is not authored at all:
`data.icon` is a different key holding a different kind of value, and a note
writing `img:` is naming a file where an address belongs. `portrait:` is not authorable at any level; a portrait is an embed in the body.

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
The row states the mapping the format makes;
the gap is in the pass, not in the table.

#### A pathname names the package that owns the file

A note names a file once, and four surfaces have to serve it: a Foundry
install, this repository's own working tree, the website, and the book. Each
addresses the same file differently, so an authored pathname is a **statement
of ownership** and every surface derives its own address from it.

**The first segment names the package, when an `assets/` follows it.**
Everything after that `assets/` is the _suffix_ — the path inside the package's
`assets/` directory, and the one piece every derived form is built from. A
suffix under `icons/` or `images/` reaches Foundry and the website in the
deployed layout, by type root and basename alone. A pathname
that does not open `<package>/assets/` belongs to the package being compiled,
and the whole of it is the suffix.

```markdown
![A map of the Vale](images/maps/valeofthorns.webp) <!-- this package's -->
![A shield](sohl/assets/icons/noun/shieldnn.svg) <!-- the sohl package's -->
```

The four forms, for a `harnensemble` note (the `harnensemble` content package
ships as the Foundry module `harn-ensemble`) writing `images/map.webp`:

| Surface     | Address                                                    |
| ----------- | ---------------------------------------------------------- |
| **Foundry** | `modules/harn-ensemble/images/map.webp`                    |
| **Local**   | `assets/images/map.webp`                                   |
| **Web**     | `https://cdn.heroiclands.org/harnensemble/images/map.webp` |
| **Book**    | `assets/images/map.webp`, staged beside the Typst source   |

And for the same note writing `sohl/assets/icons/noun/shieldnn.svg`, a file the
system ships and this repository does not hold:

| Surface     | Address                                                       |
| ----------- | ------------------------------------------------------------- |
| **Foundry** | `systems/sohl/icons/shieldnn.svg`                             |
| **Local**   | `assets/icons/noun/shieldnn.svg`, in the `sohl` repository    |
| **Web**     | `https://cdn.heroiclands.org/sohl/icons/shieldnn.svg`         |
| **Book**    | not carried, unless a declared replacement carries it instead |

**The content package name and Foundry id are separate values.**
`harnensemble` is what the content is called, what a note writes, and what the
website serves it under.
`harn-ensemble` is what Foundry installs the module as, and it appears in the
Foundry form alone. The two values happen to match for `thalorna`, `sohl`, and
`hm3`.

Which packages a build can resolve is derived from its configuration: its own
`contentPackage`, every game system it compiles content for (`systems:`,
`packs[].system`, `requiresSystem`, `relationships.systems`), and every package
it declares under `relationships`, whose `contentPackage` names the content
where that differs from the Foundry id. A pathname naming a package the build
does not know still resolves on the website and in the book — those need only
the name and the suffix — and has no Foundry address, which is refused rather
than guessed.

An art package that replaces another package's images can declare
`packageBuild.assets[].bindsTo` on the relevant asset copy. Each file's basename
then acts as a shortcode for the declared package and type. The related
`relationships.requires[].contentIndex` supplies the address index; with that
index enabled, an asset with no matching note is a located build error. See
[asset bindings](../configuration.md#packagebuildstagedir-and-packagebuildassets)
for the configuration and cache requirements.

**A package declared as a replacement is carried into the book, from its
fetched archive, when it answers the address; every other foreign package
stays not carried.** A relationship declaring `assetReplacement: true` names a
dependency whose asset tree answers this package's own addresses first — see
[`relationships`](../configuration.md#relationships) — and the book is the one
surface that otherwise refuses a foreign file outright, so it is the one
surface this changes. A `thalorna` note embedding
`![[thalornaaltart-none-icon-anvil|An anvil]]` names `thalornaaltart`'s own
address, exactly as a note citing `sohl`'s shared bestiary art would; when
`thalornaaltart` is declared with `assetReplacement: true` and its fetched
archive carries `icon-anvil` under its own package, the book stages that file
from the archive instead of printing the caption with no picture. A note
citing a different package's own address this way — `sohl`'s bestiary art,
say — stays refused exactly as the row above states, because `sohl` was never
declared as a replacement: a package answers in place of another only when it
opted in, never because its archive happens to carry a file at the same type
and shortcode.

A relationship declaring `assetReplacement: true` whose archive was never
fetched is a configuration mistake, not an ordinary unresolved address: the
book reports a located error naming the relationship and instructing
`package-build deps fetch`, rather than printing a caption with no picture.

**The host is configuration.** `site.assets` in `package-build.config.yaml` is
the root the web form is joined onto, and a package-owned image on a page with
none set is an error naming that key.

**A pathname naming no package at all passes through on every surface** — an
absolute URL, a `data:` URI, a protocol-relative `//host/…`, or a `/`-rooted
path, which Foundry serves from its data root. That is how a note addresses
core Foundry art (`/icons/svg/mystery-man.svg`) or a package this build knows
nothing of (`/systems/dnd5e/icons/spell.webp`).

**A `systems/…` or `modules/…` pathname is refused**, with a finding naming the
replacement. It is a Foundry address written where an ownership statement
belongs: it resolves for Foundry and for nothing else, because neither the
website nor the book has any such directory. `systems/sohl/assets/ui/logo.webp`
is written `sohl/assets/ui/logo.webp`, and `systems/hm3/assets/icons/sword.svg` —
where the package serves its pictures from its own root — is written
`hm3/assets/icons/sword.svg`, because `assets/` is where a package's files sit
in every derived form.

`worlds/` is not a Foundry root for this purpose. A package may not ship files
out of a world, so a note writing one has made a different mistake and gets the
ordinary "this package owns it" reading — a plainly broken path rather than a
plausible one that 404s with nothing reporting it.

**The rule is about ownership, not a list of directories.** A package owns its
whole `assets/` tree and the directory names inside it are its own business:
`sohl-kethira-basic` keeps art under `assets/artwork/`, and `artwork/deity.webp`
is that package's by the same rule that claims `icons/…` and `images/…`.

**Where a pathname is still authored, it follows this rule.** That is the
address of an image in a note's body. The art fields do not: `icon`,
`tokenIcon` and `banner` name
addresses, and the path comes from the record the resolved address points at —
which already carries the owning package, so there is nothing for a first
segment to state.

#### `banner:` reaches no compiled document

`data.banner` is the page's hero image, and it is the one art slot with no
Foundry destination: searching a built `packs-json` tree for it turns up
nothing. It reaches the generated page and the book's section plates, and
nothing else.

**A hero image is 1792×768.** It fills one fixed strip wherever it is drawn, so
every banner is cut to that size and a picture of any other size is a finding
naming both sizes — resize the picture to match. The size is stated once, by the
slot itself, which is what gives an artist a figure to work to before any file
exists.

No other art slot states a size, and none of them asks anything of a picture's
dimensions. An `icon` is drawn at a nominal size per medium whatever its file
holds, and a picture written in prose is fitted to the room it has. Both accept
whatever they are given.

It is an `Address` all the same, defaulting to type `image`, so a section note
writes `banner: skillbnr` and a note borrowing another package's plate writes
`banner: packagebuild-none-image-skillbnr`. The resolved record carries the
owning package, and each surface joins the suffix onto its own root — the site
onto `site.assets`, the book onto the directory it stages banners into.

**`banner: none` is how a note declines its hero image.** The word is never
read as an Address: it resolves to no image, the page publishes a blank
`data.banner`, and the theme draws the band with no picture and no warning. An
Address that names no image is a finding at its own line and column, and `""`
is an error. `banner: null` names no art and the page takes its type's default.

#### The pack a note compiles into

`data.pack` names which configured compendium receives the note's document.

```yaml
data:
  pack: items-hm3
```

`contentPackage` in the repository configuration names the distribution that owns the note; `data.pack` names the compendium receiving its document.

**It names the pack for the note's _own_ document.** A document derived from it
— an item's prose compiling into a `JournalEntry` of its own — is not what the
author was addressing, and is routed by the pass that produces it.

**`<system>.pack` names the pack for one system's document.** Routing is per
system: each block the note carries sends its own document where that block
says, and a note carrying two blocks may place them in two packs.

```yaml
data:
  pack: items-sohl
hm3:
  pack: items-hm3
```

**Unstated, a system's document goes to that system's default pack of its
class** — the pack of the class declaring that `system:`, or, where none does,
the pack of the class marked `default: true`. Where nothing answers, the build
refuses rather than guessing, and names the candidates.

**`pack` and `packFolder` are different questions.** `pack` names _which
compendium_ receives a document; `packFolder` names the folder note whose
address the document is filed under _within_ whichever compendium that is. They
compose, and both are read per system, so a note may place its two systems'
documents in different packs and different folders:

```yaml
sohl:
  pack: characteristics
  packFolder: none-folder-miscgear
```

**`pack: none` compiles the note into no document.** The note is walked,
published as a page, present in the content index with an address and no
Foundry UUID, and addressable by wikilink like any other; every pack compiler
passes over it without a finding, and the check that reports a note nothing
compiles says nothing about it. Write it on a page that belongs on the website
and in no compendium — a page of developer documentation, a page about the
package itself:

```yaml
shortcode: architecture
type: doc
subType: concept
data:
  pack: none
```

A link to such a note resolves everywhere the note is addressable. On the web
it is an ordinary link to the page. In a compiled journal there is no document
to open, so the reader gets the link's text as prose and no `@UUID` — the
mirror of a link into a package that publishes documents and no pages.

It is accepted only on a type whose **sole document is the JournalEntry its
prose becomes** — `doc`, `place`, `lore` and `scenario`. On a type that
compiles an Item, an Actor, a Macro, a Scene or an Adventure it is refused by
name, because there it would drop the document the type exists to produce;
the message names that document. It is read per system like any other
`pack:`, so `<system>.pack: none` withholds one system's document while the
shared declaration names a pack for the rest, and a configured pack may not
be called `none`.

Four declarations are refused, each with the reason:

| written                                     | why it is refused                                                                            |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| a **companion** pack                        | A companion is written by another pack's pass, so no note may be routed into one.            |
| a pack **nothing answers to**               | The message lists the configured packs of that document type.                                |
| a pack of **another document type**         | A note's `pack:` names a pack of its own document type.                                      |
| **`none`** on a type with a second document | The Item, Actor, Macro, Scene or Adventure the type compiles into would be dropped, by name. |

#### Template priority: which template wins

A note can mark its document as a **starting template** the Create dialog offers
to clone from, so a new being or item is born populated rather than blank. The
value is a **priority**, and the priority is the whole mechanism — it decides
which of several competing templates a player is actually offered.

The shared mapping table above names it `data.templatePriority`, targeting
`system.templatePriority` in SoHL and `flags.hm3.templatePriority` in HM3.

> `archetypes` is a different field: specified above as the _sort_ a character
> is, and declared by a being's row. The priority that decides which template
> wins is always `templatePriority`, on all three sides.

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
`null` nothing reads. Both HM3 Item and Actor passes write their own flag when
the note declares a priority.

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
characters a Foundry id is. Nothing else feeds it.

**One type hashes under a different namespace, and a consumer must not assume
otherwise.** A `Folder` is a document of its own class, and its id is
`makeId("folder", <address>)` — a separate namespace so that a folder and an
item sharing a shortcode cannot derive one id, which Foundry would not report
because it keys folders and documents in separate collections. See
[`type: folder`](#type-folder).

**So the id is transported, not recomputed.** The content index publishes an
`id` on every entry it gives an identity to, beside the `uuid` that identity
ends in, and both are computed by whatever owns that entry's derivation — the
folder pass for a folder, the journals pass for a documentation journal, this
rule for everything else. Re-deriving one from the `canonical` key alone reads
correctly and is wrong for a folder, and wrong in a way nothing outside the
build can detect: the result is a plausible 16-character id that resolves to
nothing.

**The Address determines the default id.** `content-lint` refuses a duplicate
Address across the packs of a document type, so the derived id shares that
uniqueness scope. An author pins a document's identity with `data.id` when it
must remain stable across an Address change.

**An authored `data.id` wins**, and that is how a document's identity is
**pinned**:

```yaml
shortcode: bowlcer
type: miscgear
data:
  id: plaiQQm2T5zVK5mO # pinned: this document keeps this id
```

A blank `data.id:` is not a pin — it is a deleted value with the key left behind, and
is treated as absent.

**A rename moves the id, and that is the trade.** The address carries the
shortcode, so renaming a shortcode gives the document a new `_id`. Two things
make that acceptable: a shortcode rename already breaks every wikilink to the
note, so it is a breaking change either way; and a note that must keep its
identity across one pins its `id`, which is what the pin is for. One diagnostic
narrows — `package-build` tells a **rename** from a **withdrawal** by matching
document ids across releases, and for an unpinned note both sides now move
together. It never reports a _wrong_ successor, and it stays exact for a pinned
note; for the rest, the diff reports the vacated address.

**A note with no address gets no id, and no document.** `type` and `shortcode`
are what a note is addressed by, so a note missing either cannot be filed and
the build refuses it by that name rather than by a missing `id:`.

#### Address changes

`(type, shortcode)` is a published interface. Other packages can link to it or
use it as an Item model, so changing either part requires those references to
change too. `package-build addresses diff` compares the package with a released
baseline and reports addresses whose published documents are absent. A pinned
`data.id` preserves document identity across a shortcode change; it does not
keep the old address available for links.

#### The compendium folder

A note says which folder of its pack it lands in:

```yaml
data:
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

One folder note and one Address supply every pack that references it.
`data.packFolder` names a folder by Address.

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

### Addresses

Three types name one thing from another in a content tree, and they are not
lengths of one another:

| type        | written                                      | where it is met                                             |
| ----------- | -------------------------------------------- | ----------------------------------------------------------- |
| `Address`   | `<package>-<system>-<note_type>-<shortcode>` | a frontmatter field, a `model:`, an art slot, a link target |
| `Shortcode` | `<shortcode>`                                | a note's own identity, and a key a runtime resolves by      |
| `Wikilink`  | `[[<Address>[#<anchor>]\|<text>]]`           | body prose                                                  |

An **`Address`** is the tuple below, and it is what every field typed `Address`
in the tables that follow holds. It is equally what a `model:` names, what an art
slot points at and what a wikilink resolves through — so an address is the thing
being named, and the brackets around one in prose are a separate matter. Three
rules govern it, and the first three subsections below state them in turn: the
tuple is read by position, any suffix of it may be written, and each omitted
segment is supplied by a default the position declares.

A **`Shortcode`** is one segment, and nothing expands it — see _A shortcode is
one segment, and nothing expands it_ below.

A **`Wikilink`** is the prose form, which contains an Address — see _Wikilinks_
below.

#### The canonical address

```text
<package>-<system>-<note_type>-<shortcode>
```

The final segment is the shortcode, preceded by the note type, the system and
the package. Each segment has one position. The system says which kind of target
is named:

| system        | target                                                                      |
| ------------- | --------------------------------------------------------------------------- |
| `note`        | Readable note content: a web page, a book entry, or a Foundry JournalEntry. |
| `none`        | A systemless target such as an asset, Folder, Macro or Scene.               |
| `sohl`, `hm3` | A game system's Actor or Item document.                                     |

A note can publish more than one Address. A `being` note, for example, publishes
`thalorna-note-being-bctrncml` for its readable content and
`thalorna-sohl-being-bctrncml` for its SoHL Actor. An item note follows the same
pattern for its page and Item. The type segment remains the authored note type
in each Address.

#### Shorter forms

Authors may omit segments from the left. The complete Address states all four:

| form                            | expands to                                               |
| ------------------------------- | -------------------------------------------------------- |
| `package-system-type-shortcode` | itself                                                   |
| `system-type-shortcode`         | `<this package>-system-type-shortcode`                   |
| `type-shortcode`                | `<this package>-<this position's system>-type-shortcode` |
| `shortcode`                     | as above, with the type from the field's declaration     |

There is no `package-type-shortcode` form. A reference to another package states
its system as well as its package.

#### Authored references and generated references

Authored notes may use any permitted suffix. Builds leave source bytes unchanged.
Generated content indexes, SQL records, site frontmatter and generated
Wikilinks contain complete Addresses. For example, `data.parents: [north]` in
`thalorna` emits `data.parents: [thalorna-note-place-north]`.

SQL queries compare Address-valued fields to complete Addresses. A note's
`shortcode` is a distinct identity component, so it is not equal to an Address
stored in `data.parents`, `data.government` or a governance rank's `lore`. Use the
target's complete identity for that comparison. A stub has no published page
address; its note identity still contains the package, system, type and shortcode.

The toolchain holds parsed Addresses as complete tuples internally. Address-keyed
relation maps hold typed targets and standing values. Only generated output
serializes these properties to Address strings. Runtime Shortcodes, Foundry
UUIDs, file paths and URLs keep their own representations.

An Address-valued `data:` field must name a target in this package or a declared
dependency index. `package-build lint` reports a missing target at the value or
map key that names it. A stub counts as a target for data even though it
publishes no page. Art slots use their own missing-art warning and document
fallback.

#### An omitted segment defaults from where the link is written

An omitted segment is a default, not a wildcard. Every short form expands to one
complete Address before lookup.

- **Package:** the current package. A short address never falls through to a
  dependency.
- **System in `[[link|text]]`:** `note`, for every note type. Use an explicit
  game system to name its Actor or Item, or `none` to name a systemless target.
- **System in `![[link|text]]`:** `none`. An embed names an image or icon asset;
  it also supplies `image` as the type of a bare shortcode.
- **System in frontmatter:** a system block such as `sohl:` or `hm3:` supplies
  its game system. Other Address fields default to `note`, except fields
  declared for images, icons or folders, which default to `none`.

For example, `[[macro-autoattack|Automated Attack]]` names the readable macro
note, while `[[none-macro-autoattack|Automated Attack]]` names the Foundry Macro.
`![[icon-anvil|Anvil]]` names the systemless icon asset.

**A complete Address is lowercase throughout.** Every segment — package,
system, type and shortcode alike — contains only lowercase ASCII letters and
digits (`^[a-z0-9]+$`). Every Address is validated as written, whether a field
declares it or a wikilink or embed writes it, so a capital in any segment, the
shortcode included, is an error at the value or at the link. Nothing is
lowercased on the author's behalf. Where the lowercase spelling is a declared
shortcode, the error names it:

```text
Beings/Guard.md:8:15: error: `sohl.items.0.model` shortcode `LLeg` must be lowercase; the declared shortcode is `lleg`
```

A link is reported the same way, at its own line and column:

```text
Skills/Jumping.md:10:5: error: address [[skill-Clmb]] shortcode `Clmb` must be lowercase; the declared shortcode is `clmb`
```

Each such reference in a note's frontmatter is reported at its own position,
and the note is left out of the index, so the build fails rather than
compiling without it.

**Parsing is positional counting from the right, and nothing else.** Every
segment is lowercase alphanumeric — shortcodes, **types** and **subTypes** are
all `^[a-z0-9]+$`, systems come from a closed registry, and `contentPackage` is
`^[a-z0-9]+$` too — so the hyphen is purely a separator. There is no longest-match
against a roster and no vocabulary check before splitting.

**`type` and `subType` are held to that charset, not merely expected to meet
it**. A type is the first segment of every address, so a hyphen in one is
read back as a segment boundary that was never meant as one. A `subType` reaches no address, but it is a vocabulary term the toolchain keys on and follows the same charset rule. Both are checked
against the same constant a shortcode is checked against, and a note carrying a
hyphenated value is reported where it wrote it:

```text
Trauma/Blood_Loss.md:3:1: error: `subType` "blood-loss" is not a well-formed subType — a subType is lowercase letters and digits only (^[a-z0-9]+$), the same charset a type, a shortcode and a contentPackage are held to. It is a vocabulary term the whole toolchain keys on, and one closed set away from being an address segment again, so a charset that held for every term but this one would be a rule nobody could state in a sentence
```

The `doc` subType is **`userguide`**. A hyphenated `user-guide` is refused by
the shared charset check. Shortcodes likewise contain only lowercase letters
and digits, preserving one unambiguous Address grammar.

`type/shortcode` with a slash is accepted. A slash is _unconditionally_ an
address separator — pipe or no pipe — so an unknown type before one is an error
rather than something to guess at.

#### A shortcode is one segment, and nothing expands it

A **`Shortcode`** is a single segment of the same charset an address segment is
held to, and it is a type of its own rather than the shortest `Address`. It
names a thing's identity, or it is the key something resolves by where the other
three segments have nothing to say:

| where a `Shortcode` is written               | what it names                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| a note's own `shortcode:`                    | the note's identity — the name every address of it is built from                    |
| a custom embedded entry's `system.shortcode` | that entry's identity within the actor that holds it                                |
| an emitted `system.relations` key            | the other body this one has a standing towards                                      |
| a mystery's `skillAptitudes` keys            | the skill an aptitude weighs, where the key is not a `subType:` selector            |
| a `Code`-suffixed system field               | what the resolved address is stored as — see _The note vocabulary, and how it maps_ |

**The test is whether the position can take the full four-tuple.** An `Address`
accepts it by definition, and the positions above cannot: a `system.relations`
key is read at runtime as `relations[shortcode]`, among the items one actor
carries, where packages do not exist. So nothing defaults a `Shortcode` out to
four segments, and a value persisted there as an address names no standing at
all.

**The two halves of `relations` are two types.** The key an author writes is an
`Address` — a body in another package is named in full, and one in this package
by its shortcode alone — and the key the compiled Item carries is the
`Shortcode` that address names. The builder performs the reduction, exactly as
it does for a `Code`-suffixed field, and two authored keys reducing to one
emitted key is an error naming both addresses: a shortcode is unique within one
package's address space, so two packages may each declare one, and the compiled
field holds one of the two.

**A bare shortcode in an `Address` field is not a `Shortcode`.** It is an
Address written at its shortest, with the package, the system and the type all
supplied by the position — the same value as the full tuple, spelled shorter.
Which of the two a field holds is the field's own declaration, stated in the
`Values` column of the tables below and nowhere else.

#### Every address resolves, and every build says so the same way

An address that names no note **fails the build** — in the link checker,
in the pack compilers and in the site build alike.

A `draft` note exists, resolves, compiles and publishes; a link to it renders
visibly marked. An Address landing nowhere is a typo or an omission and earns
an error.

Each way a link can fail is one **error** with one message wherever it is met:

| finding                   | what it means                                                                                             | the fix                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `unlabelled`              | no `\|`, so the link addresses nothing                                                                    | write `[[type-shortcode\|Text]]`                       |
| `not-an-address`          | labelled, but the target is not an address                                                                | write the address, not the name                        |
| `not-lowercase`           | a package, system or type segment is capitalised                                                          | lowercase it — every segment is lowercase              |
| `shortcode-not-lowercase` | the shortcode is capitalised; the message names the declared shortcode when the lowercase spelling is one | lowercase it — a shortcode is lowercase                |
| `unknown-type`            | qualified, but names no type this build knows                                                             | correct the type segment                               |
| `unresolved`              | parses as an address; nothing publishes it                                                                | fix the shortcode, or qualify to reach another package |
| `ambiguous`               | _unreachable; kept for the manifest_                                                                      | —                                                      |
| `unknown-anchor`          | the address resolves; the `#section` does not                                                             | correct the anchor                                     |

`ambiguous` is a reserved reason in the result vocabulary. An omitted segment
defaults rather than wildcarding, so each written target expands to one
canonical Address and a lookup returns one entry or none.

The vocabulary and the messages live in one module (`engine/wikilink-syntax.mjs`)
precisely because an author meets whichever build ran first. Three resolvers read
one authored link; they must not describe the same mistake in three ways, and
they must never disagree about whether it is a mistake at all.

#### In frontmatter, the address is written bare

An **`Address` field** takes the address with no brackets:

```yaml
data:
  parents:
    - hexhodai
  seat: tashal
```

not `[[hexhodai]]`. The field is declared as an `Address`, so the schema knows
what the value is and reads it as one; brackets are a wikilink's punctuation,
which the reader would have to strip before it could do anything.

A frontmatter value is parsed by the address grammar above, so a single-segment
value such as `hexhodai` names the target by its shortcode alone, with every
other segment supplied by the position. Frontmatter is structure rather than
prose: a field value is a reference something else will compile against, and it
should say exactly what it points at.

**A field can supply the type.** A field naming one kind of note declares its
default — `seat` a `place`, `parents` an `affiliation`, `lore` a `lore` — so
the type segment defaults from the declaration and a bare shortcode is the
ordinary case, not an abbreviation of one. That is why the examples above read
`tashal` rather than `place-tashal`: the shorter form carries the same
information, because the field already said what kind of thing it points at.

The frontmatter lint checks scalar Addresses, entries in Address lists, and
Address map keys at the entry's own location. Segments contain lowercase ASCII
letters and digits; wikilink brackets, labels and spaces do not belong in these
fields, and an anchor belongs only in a field that accepts one — see _Anchors_
below. Optional null values and empty lists or maps express no
reference. Grammar and accepted types are checked independently of whether a
target exists.

An affiliation's `economy` accepts only `affiliation` and `lore` Addresses.
Each entry states its type: `affiliation-merchants` or `lore-tanvrcrncy`.
There is no default type; a bare shortcode is an error.
Bundle `contents` likewise requires a type for each document.

**The declaration constrains the type; it does not shorten the address.** A field
value may be written at any length, and every length is equally correct so long
as the type it names is the one the field declares. All four of these are valid
in a `seat` field:

```yaml
seat: tashal
seat: place-tashal
seat: none-place-tashal
seat: kethira-none-place-tashal
```

Each is a **suffix** of the canonical address, which is why the third one names
the system and the fourth cannot omit it — see [Shorter forms](#shorter-forms).

An `affiliation-` prefix there is an **error naming the field and both types** —
never a silent widening of what the field accepts. Where a field permits more
than one type with no default among them, a bare shortcode is refused
outright — an error naming the field and the types it accepts, never a
resolution across them.

**A position's default and its accepted set are two different declarations,
and most positions are not ambiguous at all.** The paragraph above is about a
position that permits more than one type with no default among them; `seat` is
the plainer case, permitting exactly one. Between those sits a third shape,
and it is the common one: a position that nominates one of its accepted types
as the default while accepting others besides. There a bare shortcode is never
a candidate to weigh — it takes the default outright, every time — and the
accepted set is what a value that states its own type is checked against
instead: naming any member of the set is as valid as naming the default
itself, and naming a type outside it is an error against the set, never
against the default alone. [The art slots](#the-art-slots) are
declared exactly this way — each one accepts a second type beyond the one a
bare shortcode takes.

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
frontmatter_ is part of what `package-build links` reports when it passes.

Brackets belong in prose, where a link sits inside a sentence and needs marking
off from the words around it. A frontmatter value has nothing to be marked off
from.

#### Anchors

An Address may end in `#<anchor>`, naming a place inside the note it addresses —
a section of its prose, or one of its events. Every written form takes one:

```text
thalorna-note-place-ironfells#sack   the full Address, anchored
place-ironfells#sack                 type and shortcode, anchored
ironfells#sack                       a bare shortcode, where the field supplies the type
```

The anchor is read the same way in a frontmatter field and in a wikilink: it is
everything after the first `#`, and what precedes it is an ordinary Address.

**Every anchor has one of two kinds**, from what declares it:

| anchor kind | declared by                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------- |
| `prose`     | any `{#slug}` in the note's body — on a heading, a caption, a block, an alert, a poem or a span |
| `event`     | the `id` of an entry in `data.events` — see [Events](#events)                                   |

**A note's anchors are one namespace.** An event's `id` that equals any other
anchor slug in the same note is an error at the `id`, as two equal headings
already are.

**A frontmatter field accepts an anchor only where it declares the kinds it
takes.** Every other Address field refuses `#<anchor>` with an error at that
value. A field keyed by Address takes none, so an Address map key is always a
plain Address. The fields that take one:

| field                                 | anchor kinds | without an anchor                                      |
| ------------------------------------- | ------------ | ------------------------------------------------------ |
| `events[].follows[].event`            | `event`      | names a note holding exactly one event                 |
| `events[].where.reach[].attributedTo` | `event`      | names a lore note, or a note holding exactly one event |
| `made`, `lost` (every gear type)      | `event`      | names a note holding exactly one event                 |
| `subjects` (a `literature` note)      | `event`      | names a note of any type, as every subject does        |

An anchored Address resolves when its note resolves, declares that anchor, and
the anchor's kind is one the field takes. Each failure has its own message: the
note does not resolve; the note declares no such anchor; or the anchor is a
`prose` anchor, not an `event` one.

**A wikilink names a `prose` anchor only.** `[[lore-crown#founding|the founding]]`
where `founding` is an event's `id` is an error at the link, on every surface:
prose links to the note, not to an event. Write `[[lore-crown|the founding]]`.

### Wikilinks

A **`Wikilink`** is how body prose names something:

```text
[[<Address>[#<anchor>]|<text>]]
```

The brackets, the `#<anchor>` and the `|<text>` label are the Wikilink's own.
What sits inside them is an `Address` like any other — read by the same grammar,
written at any of its lengths, and taking each omitted segment from where the
link is written, which for body prose is this package and system `note`. So
nothing about resolution belongs to the bracketed form: a wikilink and a
frontmatter field ask the same question of the same value, and the findings above
are the answers either of them gets.

The anchor is the Wikilink's, not the Address's. It names a section of the target
by the slug that section's heading declares — `[[place-tashal#market|the
market]]` — and one naming no section there is the `unknown-anchor` finding.
Written alone, `[[#slug|Text]]` addresses a section of the page the link sits on,
which is the one form carrying no address at all.

#### Every wikilink carries a label

There is one namespace, and the pipe is required:

| written             | resolved as | displays                   |
| ------------------- | ----------- | -------------------------- |
| `[[Address\|]]`     | an address  | the target note's own name |
| `[[Address\|Text]]` | an address  | `Text`                     |
| `[[Name]]`          | nothing     | a finding                  |

**A link written without a label addresses nothing**, and the correction
is always the same: write `[[type-shortcode|Text]]`.

The bare form does not resolve by display name or alias. `name.aliases` is
indexed for search and completion, while an authored link names an Address.

Requiring the label is also what makes positional parsing safe. Note names
contain hyphens — `Grukar-ahk` is a name, not a `Grukar` of type `ahk` — so a
target that does not parse as an address is reported as one that does not, rather
than split at an arbitrary place or quietly looked up somewhere else.

The **empty** label is not a way of writing no label. It says _address this
target, and show whatever it calls itself_ — so a note whose name changes takes its new
name at every citation with no link edited. `[[x|]]` is labelled; `[[x]]` is not.

It is the label that is required, not a target: the anchor-only form above
carries its pipe like every other link.

#### References to secret subjects

Use `[[doc-divineactn|The Truth of Divine Action]]` for an indexed subject,
including one with a GM-only audience. The renderer derives spoiler presentation
from the resolved destination and conceals the whole reference, including its
label. A public destination has no automatic concealment. An anchor inside secret
content is a secret destination, including a same-note anchor reference. A
link to the whole public note does not inherit a section's secrecy.

The website renders an inline show/hide spoiler; an omitted GM-only target
retains its reference as text without a dead link. A published secret section
retains its link. Foundry renders a visible inline spoiler with a **Secret:**
label, with access to its destination controlled by private packs and page
permissions. Books print secret styling and a **Secret:** label, retaining text
without a link when the GM-only destination is omitted. `.show` bypasses the
automatic spoiler presentation on each surface; an unavailable destination
still has no link.

An immediately following `.show` attribute explicitly reveals the reference:

```markdown
[[doc-divineactn|The Truth of Divine Action]]{.show}
[[doc-magictruth|The Truth of Magic]]{.show}
```

This override changes the reference's presentation only. It does not publish a
GM-only note, alter Foundry permissions or reveal the destination's content.
It is redundant for public destinations. `[text]{.secret}` separately marks
text itself as a spoiler; it declares no destination audience. See
[inline spans](#inline-spans) for inline spoiler syntax and surface behavior.

#### Marking names in prose

`package-build lint` reports name-marking warnings in authored body prose.
The warnings leave a valid package passing. Headings, frontmatter, tables,
infoboxes, code, comments and embeds are outside this check.

A name is explicit: a `[Name]{.name}` bracket span or an authored link label.
Use typed `.name` spans for unwritten subjects and ordinary wikilinks for
indexed subjects, including private ones. Introduce another subject with its
full canonical name at its first prose use; use plain text for the note's own
subject and for later mentions and aliases.
Plain prose is not searched for names. Wikilinks, ordinary Markdown links and
reference links all supply names; a resolved empty wikilink label uses the
note's full name. Images, code, footnote markers and bare autolinks without
authored labels supply none.

1. A `.name` span whose whole text matches an indexed `name.full` or
   `name.aliases` should be a link. Use `[[place-arden|Arden Vale]]` or
   `[[place-arden|]]` to introduce that note.
2. Mark or link each name at most once per note. An indexed full name and its
   declared aliases share one identity, including across different heading
   anchors. Other labels use their whole text as their identity: different
   labels linking to one page are separate names, and a label is not
   automatically an alias of its destination.
3. Introduce the full name before a short form or declared alias.
   Possessives and regular plurals count as uses; other indexed forms can be
   declared aliases.

Bold is emphasis. A whole bold span exactly matching an indexed full name or
alias receives one advisory to mark or link the name. It supplies no name
occurrence or introduction, and bold containing a marked or linked name
receives no such advisory. Unknown bold phrases supply no names.

Inline Markdown remains active inside name spans, and name spans remain
valid inside emphasis:

```markdown
**This is a phrase with [Joe Blow]{.name} in it**
```

The name is `Joe Blow`; the surrounding phrase is emphasis. Sites and books display
`.name` text in bold.

Each affected occurrence produces one warning at its authored
`file:line:column`, naming the full name or explicit label. A warning
can describe several marking problems at that occurrence.

An optional `data-type` on a `.name` span states what the named thing is:

```markdown
[Ravenmoor]{.name data-type="place/settlement"}
[Aldric Venn]{.name data-type="being/npc"}
```

Use a declared [note type](note-types.md), optionally followed by `/` and one
of that type's subtypes. An enumerated declaration requires a listed subtype;
an open declaration accepts a well-formed subtype, and an absent subtype
declaration admits none. An unknown or malformed supplied value is an error
at the `data-type` attribute's file, line and UTF-16 column. The same attribute
on a span without the exact `name` class is an ordinary attribute. An untyped
`.name` is valid; its type is not inferred from a matching note.

The index captures actual `.name` spans throughout the authored body, including
headings, tables, verse and spans within links. The prose-only marking checks
above keep their narrower scope. Frontmatter, literal code, escaped syntax,
unmarked link labels, bold, plain prose and generated content add no names.
The rendered visible text preserves its spelling and inline content.

Each own-note metadata record carries `names` in authored order. Every entry
has exactly `name`, `type`, `subType`, `line` and `column`; absent
classifications are explicit `null`, and no occurrences gives an empty array.
This is derived metadata, not frontmatter. Documentation mirrors and assets
do not duplicate a note's occurrences. The [`names` relation](#content-tables)
flattens these entries with their containing NOTE Address.

Lint groups names without an indexed full-name or alias match by supplied
classification and lists all their source uses. It also groups conflicting
annotations of the same visible name. Untyped uses do not conflict. A bare
type and its subtype agree; different supplied types or different supplied
subtypes conflict. One package advisory contains both groups and is located
at the earliest reported use. Advisory findings preserve a successful lint
exit status. Supplied-value errors prevent publication and compilation.

### Assets are types

`icon`, `image` and `audio` are types in the type vocabulary, and an address
reaches one exactly as it reaches a being or a skill. Their trees are
the one thing about them that differs: they sit beside `content/` rather than
inside it, because the thing a note is addressing is a file rather than a note.

**Three roots, one per type.** The directory is named for what it holds and the
type is named for what an address reaches, so the two differ by a letter and the
mapping is declared rather than derived from the name:

| root            | type    |
| --------------- | ------- |
| `assets/icons`  | `icon`  |
| `assets/images` | `image` |
| `assets/audio`  | `audio` |

**A file's extension decides whether it is an asset at all**, and its root
decides which type. Every image-extensioned file anywhere under `assets/icons`
is an icon, and every audio-extensioned file under `assets/audio` is an audio
asset, however deep it sits.

That filter is load-bearing rather than tidy-minded: `provenance.yaml` files
live **inside** these roots, at any level, and a walk that took every file would
read attribution records as assets. A directory under `assets/` that is not one
of the four holds no addressable asset — `assets/ui` is a package's own
furniture, and nothing addresses it.

**An asset type carries no system.** Its addresses keep the fourth segment, and
it is always `none` — `sohl-none-icon-anvil`, never `sohl-icon-anvil` — so key
parsing stays uniform across every type. The path shape is a property of the
type rather than a test on a value.

#### The filename is the shortcode

```text
assets/icons/game-icons/lorc/anvil.svg   →   <package>-none-icon-anvil
assets/images/beings/creatures/drake.webp →  <package>-none-image-drake
```

**The extension is not part of the address**, and neither are the directories
above the file. A root's shortcodes are one flat namespace however deeply the
tree nests, so two files under one root sharing a basename are two claims on one
address and a build error naming both. Across roots they are no such thing:
`icon-anvil` and `image-anvil` are different addresses.

Leaving the extension out is what makes a format change free. Changing an icon
from SVG to WebP is dropping a different file in place, and no note changes;
`abysdrksvg` and `abysdrkwebp` would be two addresses for one drake.

**Beneath the root the structure is arbitrary, exactly as it is under
`assets/content`.** A note's address does not depend on where its `.md` sits,
and an asset's address does not depend on where its file sits within its root.
Both trees are arranged for the people who maintain them —
`icons/game-icons/<contributor>/`, `images/beings/creatures/` — and either can be
rearranged wholesale without a single reference changing.

**That freedom is the point.** Whoever maintains a tree organises it however
makes sense to them — by contributor, by subject, by the source a set came from,
by whatever the next thousand files want — and the build has no opinion. A
layout that carried meaning would spend that freedom to buy nothing: moving a
file would become a breaking change, and the arrangement would answer to the
walk rather than to the person reading it.

**The root itself is the exception, and only because an asset root is
homogeneous.** `assets/content` is mixed: it holds beings, places, skills and
the rest side by side, and each note declares its own `type:`, so no directory
needs to. An asset root holds one type and nothing else — everything under
`assets/icons` is an icon — which is what lets the root supply the type. It has
to: a `.webp` carries no frontmatter and has nowhere to say what it is.

So the two trees follow one rule about layout and differ on exactly one point:
a note's type comes from the note, an asset's type comes from its root. That is
also why the three roots are a closed list rather than a convention — a fourth
directory under `assets/` declares nothing, so nothing in it is addressable.
`assets/ui` and `assets/fonts` fall out of that rule rather than needing an
exemption.

**A shortcode is lowercase alphanumerics.** A filename that is not — a version
string, a hyphen, a date stamp — cannot be addressed, and the build says so
rather than inventing a shortcode for it.

#### The asset record

An asset reaches the content index as a record of its own — one line per
addressable file, in the same JSON Lines index the notes publish into. It
carries no frontmatter, no anchors and no `foundry` block: a file declares
nothing about itself, compiles into no document, and publishes no page, so the
`address` holds the canonical key and no page slug.

| `asset` field | Source     | What it says                                                                                                                                                                                                                         |
| ------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `path`        | the walk   | Where the file sits inside the emitting package's asset directory.                                                                                                                                                                   |
| `attribution` | provenance | The person holding the rights, to whom attribution is legally due.                                                                                                                                                                   |
| `source`      | provenance | Where it came from — a URL, or a sentence.                                                                                                                                                                                           |
| `ai`          | provenance | Whether the file is machine-generated — strictly the YAML boolean `true` or `false`; any other value is a finding, never a stringified record. Required: a record that leaves it out is a finding, never read as `false`.            |
| `license`     | provenance | The licence it is used under — an SPDX identifier, or terms.                                                                                                                                                                         |
| `notes`       | provenance | Anything else a person reading the attribution needs.                                                                                                                                                                                |
| `role`        | provenance | What the picture is for — `portrait`, `emblem`, `banner`, `plate` or `map`. Absent for an ordinary picture; a value outside that set is a finding. The `image` type only — a value on an `icon` address is a finding and is dropped. |
| `width`       | the walk   | The file's pixel width, read from its own header. Blank for an SVG, which has no pixel dimensions.                                                                                                                                   |
| `height`      | the walk   | The file's pixel height, read from its own header. Blank for an SVG, which has no pixel dimensions.                                                                                                                                  |

Every field is present on every record, blank where nothing states one. A fixed
shape is what lets a consumer read `asset.license` without first asking whether
the package happened to record one.

**`path` is the source path.** The record is emitted by the package holding
the bytes, so the path is where the file sits in that package's repository. The
book stages from it; Foundry and the website serve the **deployed layout**, the
type root and the basename alone:

| Consumer | `thalorna-none-image-thorn` resolves to                     |
| -------- | ----------------------------------------------------------- |
| Web      | `<cdn base>/thalorna/images/thorn.webp`                     |
| Book     | `<asset base>/thalorna/images/beings/characters/thorn.webp` |
| Foundry  | `modules/thalorna/images/thorn.webp`                        |

Foundry and the website serve a picture under `icons/` or `images/` flat, by
type root and basename — see [what a package ships](#what-a-package-ships);
every other file keeps its path under `assets/`, and the local and book forms
keep the repository's arrangement. Foundry paths use the **Foundry package id**. The two values are both `thalorna`
for this image; `harnensemble` content uses `harn-ensemble` in its Foundry paths.

##### What a role declares

`role` names what the picture is for, from a closed set:

| Role       | What it names                                            |
| ---------- | -------------------------------------------------------- |
| `portrait` | A picture of a subject — a being, a building, an object. |
| `emblem`   | A device, arms, a sigil — a mark rather than a scene.    |
| `banner`   | A wide strip across the head of a page or a book plate.  |
| `plate`    | A full-measure illustration meant to be looked at.       |
| `map`      | A plan or chart, read by examining its detail.           |

An asset declaring no role is an ordinary picture: there is no default role
name, only the absence of one. A value outside this set is refused with a
finding naming the file, the key and the accepted values, and the record
carries no role rather than the one it was given. `role` belongs to the
`image` type only — an `icon` address carries one nominal size per medium
whatever the file holds, so a `role` declared there is a finding and is
dropped rather than carried through.

A declared role makes two checks possible. **Shape**, an error, flags an
asset whose aspect ratio departs from the median of every other asset
sharing its role — the expectation is derived from the role-sharing group
itself at build time, never from a second, hand-kept table. **Resolution**,
a warning, flags an asset whose pixel width falls short of what its role's
largest print slot needs. Both exempt a vector asset, which carries no pixel
dimensions and no aspect that survives being drawn at a nominal size.

`role: map` also selects a captioned image's counter — see
[captions and numbered references](../authoring/links-and-markup.md#captions-and-numbered-references).
A fence whose picture draws an address with that role counts as `Map` rather
than `Figure`, on every surface that numbers it, because the role is the one
fact the fence's own markup cannot state.

##### What a role draws at

A role names what a picture is for; it says nothing about how large one
draws. Deciding that is a medium's own job — the book owns a table mapping
each role to a maximum, and a website's or a Foundry system's stylesheet owns
the equivalent table for its own surface, keyed off the role class and the
`width`/`height` attributes the emitted markup carries (blank for a vector).
Changing a role's slot is one line in that table, not an edit to every note
drawing one.

**Every size is a maximum, never a target.** The drawn width is the smaller of
the role's slot and what the file's own pixels support at the medium's print
floor:

> drawn width = min(the role's slot, natural pixels ÷ the print floor)

A picture is never drawn larger than it was made: a 512px portrait stretched
across the slot a `plate` fills is a soft rectangle that reads as broken. A
vector carries no pixel count, so nothing narrows its role's slot; it always
draws at the slot. An `icon` address takes the medium's nominal icon size
whatever role it might otherwise have had — `role` never reaches one, since
the asset record refuses it there.

The book's table, and the print floor it reads from the same constant its page
geometry is set against (300 dpi):

| Role                        | The book's slot                   |
| --------------------------- | --------------------------------- |
| `portrait`, `emblem`        | half the page's text measure      |
| `banner`, `plate`, `map`    | the full page's text measure      |
| an `icon` address, any role | one inch, whatever the file holds |

On this book's US Letter page the text measure is about 7.00in, so a
`portrait` or an `emblem` draws at up to about 3.50in and a `banner`, a
`plate` or a `map` draws at up to about 7.00in — still the smaller of that
and what the file's pixels support.

**A worked example.** A `portrait`-role file measuring 900×1350px, drawn with
no named `size=`: at 300 dpi its pixels support 900 ÷ 300 = 3.00in, which is
narrower than the role's 3.50in slot, so the book draws it at 3.00in. The same
picture at 1200×1800px supports 4.00in, wider than the slot, so the book draws
it at its 3.50in slot instead — the slot bounds it, exactly as a maximum
should. Either way the emitted markup for the website and for a Foundry
journal carries `note-image-role-portrait` as a class and `900`/`1350` (or
`1200`/`1800`) as its `width`/`height` attributes, which is what a stylesheet
on either surface sizes a `portrait` from.

A named `size=` written beside the embed overrides a role's slot outright, the
same as it always has — a role decides the size nothing else states.

##### Where provenance comes from

A `provenance.yaml` states the provenance fields in the table above, and nothing
else: an unknown key is a finding rather than a silent drop, because `licence`
beside `license` is otherwise an attribution record that looks complete and
carries nothing.

One address resolves its record in this order:

1. A sibling `<filename.ext>.yaml`, which **replaces** an inherited record
   wholesale rather than merging over it. A sidecar exists precisely because the
   inherited answer is wrong for this one file, so carrying half of it forward
   would make the record's meaning depend on a directory two levels up.
2. Otherwise the nearest `provenance.yaml`, searching the file's own directory
   and then its ancestors, **stopping at the type root**. A record above the root
   would speak for trees it says nothing about.
3. Otherwise nothing, and that is a **finding at the file**: every asset is
   covered by a record, because the stage decides from the record whether the
   file ships.

Resolution is per file. One directory routinely holds files its own
`provenance.yaml` covers beside files a sidecar answers for, and each is
resolved on its own.

**The nearest record is the whole answer.** It is never merged with the one
above it, so a record states every key it means to claim — which is what lets a
reader open one file and know what the tree beneath it carries, instead of
resolving a chain by hand.

That is also why `attribution`, `license` and `ai` are **required in every
record**: a key left out is not inherited from above, it is simply absent, so a
record stating none leaves every file it covers with no rights holder, no terms,
or no statement of whether a machine made it. Omitting one is a finding at the
record, which an empty file is held to as well. An unstated `ai` is never read as
`false`. `source`, `notes` and `role` stay optional, because a blank is a
truthful answer for each of them.

##### What a package ships

The repository keeps every picture; the Foundry package carries a filtered copy.
`package-build assets` stages a file from `assets/icons/` or `assets/images/`
only when its resolved record says `ai: false` **and** its `license` is one of:

| Licence                      | Spelled                      |
| ---------------------------- | ---------------------------- |
| Public domain                | `LicenseRef-PublicDomain`    |
| Creative Commons Zero        | `CC0-1.0`, or `CC0`          |
| Creative Commons Attribution | `CC-BY-3.0`, `CC-BY-4.0`     |
| Attribution-ShareAlike       | `CC-BY-SA-4.0`               |
| Noun Project Pro             | `LicenseRef-NounProject-Pro` |

The spelling is matched exactly; nothing is normalised. A package adds licences
to this list with `packageBuild.shippingLicenses`, and ships under the list
together with its additions. `ai: true` is never shipped, whatever the
additions say. Audio is not filtered
and not laid out flat — a package stages it with an ordinary
`packageBuild.assets` row.

**The deployed layout is flat.** A shipped picture sits at the package root as
`icons/<basename>` or `images/<basename>`, whatever directories hold it in the
repository. The root is the type and the basename is the shortcode with its
extension, so the path follows from the address alone, and a root's shortcodes
being one namespace is what keeps the flattening collision-free. The same
layout serves Foundry (`modules/thalorna/images/thorn.webp`), the website's CDN
(`<cdn base>/thalorna/images/thorn.webp`), and every location a world copies
the pictures to.

**The package's asset set**, `asset-sets/default.json` under the package
root, lists what it ships. The name is fixed, so a world always finds the
package's own set there:

```json
{
  "name": "Thalorna — shipped art",
  "package": "thalorna",
  "assets": [
    {
      "address": "thalorna-none-icon-anvil",
      "source": "../icons/anvil.svg",
      "target": "icons/anvil.svg",
      "size": 412
    }
  ]
}
```

| Key       | What it says                                                                                                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`    | The set's display name: the package's manifest title with ` — shipped art` appended, or the content package without a title.                                                                    |
| `package` | The content package — the addresses' first segment, not the Foundry id.                                                                                                                         |
| `assets`  | One entry per file, in `target` order.                                                                                                                                                          |
| `address` | The file's canonical address.                                                                                                                                                                   |
| `target`  | The file's path relative to the location's root, in the deployed layout, extension included.                                                                                                    |
| `source`  | Where the file is fetched from, resolved against the URL of the set file holding it — `new URL(source, setUrl)`. The package's own set sits in `asset-sets/`, so its `source` is `../<target>`. |
| `size`    | The staged file's size in bytes.                                                                                                                                                                |

`target` is never the record's source `path`. Each release attaches
`icons.zip` and `images.zip` beside the package archive: one picture root of
the stage each, with `asset-sets/default.json`, for a GM placing the files by
hand.

##### Every reference states its address

A compiled document names a picture by its Foundry path, and beside each
reference it states the picture's canonical address, so a world can rebuild the
path for wherever it keeps the file:

- **HTML.** Each `<img>` whose `src` names an asset carries
  `data-asset="<address>"`.
- **Path fields.** The address sits in `flags.<system>.assets` on the document
  holding the field, as nested objects mirroring the field's path — never a
  dotted key, which Foundry's `expandObject` splits. `<system>` is the system
  the document is compiled for, its `_stats.systemId`.

| Document                                    | Flag on                | Keys          |
| ------------------------------------------- | ---------------------- | ------------- |
| Actor, Item, ActiveEffect, Macro, RollTable | the document           | `img`         |
| Actor token art                             | `prototypeToken.flags` | `texture.src` |
| Table result                                | the result             | `img`         |
| Journal image page                          | the page               | `src`         |

```json
"img": "modules/thalorna/icons/anvil.svg",
"flags": { "sohl": { "assets": { "img": "thalorna-none-icon-anvil" } } },
"prototypeToken": {
    "texture": { "src": "modules/thalorna/icons/anvil.svg" },
    "flags": { "sohl": { "assets": { "texture": { "src": "thalorna-none-icon-anvil" } } } }
}
```

Embedded documents — an actor's items and effects, a journal's pages, an
Adventure's contents — each carry their own. A path or an `<img>` naming no
asset is left as it is.

**A picture the package does not ship draws a stand-in.** A reference to an
excluded picture compiles to its package's own stand-in,
`<package>-none-icon-missing` or `<package>-none-image-missing` — a picture
under `icons/` or `images/` named `missing`, human-made and licensed to ship —
and keeps the excluded picture's address in its flag or `data-asset`. A
package that leaves out a picture a note references and ships no stand-in of
that type fails the build with an error at the referencing note.

##### A declared replacement resolves first

A package may declare, on a `relationships.<kind>[]` entry, that a
dependency's asset tree answers this package's own asset addresses ahead of
its local record — `assetReplacement: true` in `package-build.config.yaml`.
Once declared, an asset address resolves in this order:

1. **Every declared replacement, in declaration order.** The package segment
   of each relationship declaring `assetReplacement: true` is tried in the
   order those relationships are written, and the first one carrying the
   address wins.
2. **Falling through to the package's own record** when no declared
   replacement carries the address — the resolution this package already
   performs with no `assetReplacement` declared at all.

**This reaches asset types only.** A being, an item or a lore note is never
replaced this way, whatever a relationship declares: the rule tests the
address's type, not the relationship. A replacement answers only `icon`,
`image` and `audio` addresses whose package segment is this package's own; an
address naming any other type, or naming a different package, is untouched.

**A replacement's own output address is never itself looked up against
another replacement.** Resolving `thalornaaltart-none-image-thorn` never asks
whether something replaces `thalornaaltart` — resolution is a single pass over
the declared list, not a chain, which forecloses a cycle by construction.

This is distinct from a `foreign` lookup, which serves a declared dependency's
own content for an address this package's local index does not carry. A
replacement is consulted **before** the local address; a foreign lookup only
**after** it misses locally.

#### A font is not an asset

`assets/fonts` is not a root, and a font has no address.

**An asset type exists so a note can name a file and a package can substitute
it.** Nothing about a font answers to either half. No note names a typeface —
the art slots are `icon`, `tokenIcon` and `banner` — and substituting
one package's font for another's is not something anyone wants.

**Neither consumer of a font can use an address.** A stylesheet names a file
with `url()`, resolved relative to the stylesheet and never through the content
index. The book names a _family_ — `#set text(font: "Libertinus Serif")` — and
the typesetter matches that against a directory it is pointed at. One wants a
relative path, the other a family name; an address serves neither.

**And the model fits badly.** An address holds one file whose format is free to
change, which suits a picture. A font family is a matrix of family, weight and
style, and a filename already says which cell a file is — a shortcode would have
to re-encode that, worse.

So fonts stay ordinary files a package ships and points a tool at, and their
licences are recorded where a person reads them rather than in an index.

#### `icon` and `image` are two types, not one

An icon has to stay coherent drawn into a 32×32 slot, which is why icons are
SVG. An image is unbounded, expected to be large, and unreadable at that size.
That is a fitness property of the asset itself, and one merged type would leave
every consumer inferring the handling from the extension; two types let a guard
assert it instead.

So the two have **separate shortcode namespaces**. `icon-anvil` and
`image-anvil` are different addresses for different purposes, and a rewrite rule
reaches one without touching the other.

**An asset address is its own name.** `image-thorn` is an image called `thorn`;
any resemblance to `being-thorn` is coincidence, and nothing derives one from
the other.

#### `packagebuild` is a reserved package name

package-build is an npm package rather than a system or a module, and it ships
a set of images — section banners chiefly — that many packages draw on.
Addressing them as `packagebuild-none-image-<shortcode>` lets a note reach one
without declaring a dependency on some parent system or module it otherwise has
no relationship with.

**Its files reach the website and the book and no Foundry document.** Foundry
installs no package of that name and no relationship can be declared with one,
so `banner:` — the one art slot with no Foundry destination — is where a
`packagebuild` address belongs. A body image naming one, written either way, is
refused with the line and column it sits on.

`packagebuild` is reserved for this toolchain's assets and documentation. The
documentation package in this repository uses that namespace for its notes;
other repositories cannot claim it. Asset resolution remains special-cased
because no Foundry package is installed under that name.

#### An embedded image is a wikilink

```text
![[address|label]]
```

There is no image grammar. An embed is the wikilink above, with `!` meaning
_render it here_ rather than _link to it_, and the syntax supplying the default
type the way a field declaration does — `image`. The short-form ladder, the
package and system defaults, the lowercase rule, the ambiguity reporting and the
findings vocabulary all apply unchanged.

| written                             | means                                    |
| ----------------------------------- | ---------------------------------------- |
| `![[anvil\|]]`                      | decorative — the common case             |
| `![[anvil\|An anvil]]`              | alt text where it carries meaning        |
| `![[anvil]]`                        | unlabelled, and a finding like any other |
| `![[sohl-none-image-anvil\|Anvil]]` | qualified, reaching another package      |

The parser distinguishes a missing label from an empty one, so _deliberately
decorative_ and _not written_ differ without an exemption.

**The label is the alt text, and it stays with the referrer.** One image serves
many documents, and only the referrer knows what it means where it sits.

**An embed reaches asset types only.** The syntax invites the broader reading —
transclusion of an arbitrary note — so the restriction is a guard rather than a
convention.

**An embed takes the same directive an image does**, in the same place —
immediately after the closing `]]`, with no space:

```markdown
![[branwldrgr|Brànwâal Dôrgaar]]{float=top-left}
![[branwldrgr|Brànwâal Dôrgaar]]{size=medium float=top-left}
![[thalornamap|Map of Thalorna]]{.full-width}
![[thalornamap|Map of Thalorna]]{.full-width float=top-left}
![[thalornamap|Map of Thalorna]]{float=top-left .full-width}
```

**The same parser reads both**, so an embed takes a width class, a `size`, a
`float`, or a combination in any order, separated by spaces — everything
[an image's directive](#width-is-a-class-and-the-ordinary-width-carries-no-marker)
takes and nothing beyond it. The width, size, and position vocabularies are the ones
above, and they are closed here for the same reason: a directive that is quietly
ignored looks exactly like one that worked, and a directive holding a problem is
not honoured in part either.

**A being's portrait is one of these**, opening its `{#appearance}` section by
convention rather than declared in a field — see
[the lead image](#the-lead-image).

### Three states of a note

Nonempty `data.words` on a language note (`skill`/`language`), or `data.glossary`
on a culture or affiliation, supplies page content without an authored body.
Absent or empty arrays supply no such exemption. Every other typed note
requires a nonempty body after its closing frontmatter fence, including
`folder` and `homepage`. An empty or whitespace-only body is otherwise an error,
regardless of description or `tags: [draft]`. Untyped vault scaffolding is
excluded. A nonempty body with fewer than 25 prose words warns
unless tagged `draft`; the tag never exempts an empty body. A `folder` note is
held only to the nonempty rule: any body, a placeholder or a single line
included, passes with or without `draft`.

The `lint`, `content-index`, `package compile`, `site` and `pdf` commands enforce
body errors. Write a short beginning and tag it `draft` when work is unfinished.

The internal classification below describes records, including incomplete notes
that inspection APIs can still read. A **stub** has neither an authored body nor
automatic lexical content and must receive content before it can publish.

| State     | Content         | Marker          | Page         | Document                          | Link target |
| --------- | --------------- | --------------- | ------------ | --------------------------------- | ----------- |
| **stub**  | none            | none            | no           | yes, where one would not be empty | no          |
| **draft** | body or lexical | `tags: [draft]` | yes, noticed | yes, noticed                      | yes         |
| **full**  | body or lexical | none            | yes          | yes                               | yes         |

"Document" here is the document a note's frontmatter earns. A system's Actor or
Item is earned by that system's block, in every state —
[a system block is what makes a game document](#a-system-block-is-what-makes-a-game-document).

**Full is the absence of everything.** It is the default and carries no marker,
which is right: the overwhelming majority of a finished corpus should say
nothing about its own finishedness.

There is no new frontmatter key, no new filetype and no second parser. A stub is
a `.md` file the walk already finds, and the moment somebody writes a body it
becomes an ordinary note — nothing moves, nothing is deleted, and every inbound
link starts resolving.

#### A stub is a note with an empty body

> **The body is empty when everything after the closing frontmatter fence is
> whitespace.** Nothing else is empty.

The rule is that severe because the test has to be one you can apply by looking
at the file. Every softer rule makes two files that look different behave the
same. For a note without automatic lexical content:

| After the fence         | Empty? | What happens                                                    |
| ----------------------- | ------ | --------------------------------------------------------------- |
| Nothing, or blank lines | yes    | An error, with or without `draft`                               |
| An HTML comment         | no     | A note with a body that renders to nothing. The lint reports it |
| A horizontal rule       | no     | The same                                                        |
| A lone heading          | no     | The same                                                        |
| `_To be written._`      | no     | The same                                                        |

An HTML comment is deliberately not empty, but an invisible marker does not supply prose. Replace placeholder-only content with written text. A `folder` note is the exception: any of these bodies satisfies it, and the lint reports nothing.

#### What a stub emits

A stub's index record is its frontmatter plus the derived keys, **minus
`address` and `anchors`**. The absent address is the whole signal, and it is the
column a table renderer already reads.

It keeps everything else:

- **`file`**, which is what you edit and what every diagnostic names.
- **`id`**, which is the identity every diagnostic and every table reads.
- **`foundry`**, naming each document that was made.

#### A document that would be empty is not created

> **If the resulting document would be empty, it is not created** — and the
> index then names no artefact: `uuid`, `path` and `address` are `null`, which
> is how a record says one was not made.

The test is about the **output**. For a note with no generated Dictionary or
Glossary content:

| The note                           | The document                           | Made? |
| ---------------------------------- | -------------------------------------- | ----- |
| `place`, `lore`, `doc`, `scenario` | its JournalEntry, which _is_ the prose | no    |
| any item type, `macro`             | the Item or Macro, from `data:`        | yes   |
| the same note's documentation      | a JournalEntry of the same prose       | no    |
| `map`                              | the Scene, from `data:`                | yes   |

An unwritten arcane talent still compiles into its Item, because an Item is its
`data:` and that is not empty. What it has no documentation journal for is the
same thing an unwritten `place` has no journal for: there is nothing to put in
one.

**An infobox does not count as content.** The panel is a rendering of `data:`
that the index already publishes, so an entry holding nothing else would tell a
reader exactly what the record told them.

Nothing anywhere names a document that was not made: a compendium UUID for one
would send every consumer that resolves it to a document the pack does not hold.

What is suppressed with the page is the web address and the link target: a
wikilink into a stub is refused, and a table cell listing one prints its name as
plain text rather than as a link.

#### Structural classification does not exempt validation

A `folder` note's page is a generated section index, and the homepage is the
site's front door. The classification helpers retain their addresses and report
**full** even when their bodies are empty. Validation still rejects an empty
body for both types.

Nonempty `data.words` on a language, or `data.glossary` on a culture or
affiliation, supplies a generated Dictionary or Glossary page. These notes
need no authored body. A nonempty authored body still follows the placeholder
and short-prose rules.

Every type in the vocabulary declares whether an empty body suppresses its page,
so adding a type means answering the question rather than inheriting a default.

#### A stub is still referenceable as data

`borders.to` and `routes.to` name a place by `Address`, and those are **index
relations rather than page links**: a border with a stub on the far side is a
valid statement about the world and resolves. So does `parents` for the
containment tree and `government` for governance — a stub appears in its region's
**Within** and its governing body's **Governed places**, as plain text. What a stub
cannot be is the target of a wikilink, because a wikilink points at a page.

### What a note produces

Note types fall into two groups, and only the first has a mapping table.

**Types that _may_ produce a system document** — a SoHL or HM3 Actor or Item,
one per system, described by the tables further down.

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

#### A system block is what makes a game document

> **A note produces a system's Actor or Item only where it carries that
> system's block.** A note carrying no block for any system produces no Actor
> and no Item anywhere, whatever its packs declare.

The block is not a place to put optional detail — it is the statement that this
person or thing is meant to be played. Its absence is a statement too, and it is
made silently: the note is passed over by the Actor and Item passes exactly as
any note they do not own, with no finding.

**Prose is untouched by this.** A body with content still compiles into one
JournalEntry, one web page and one PDF page, however many blocks the note
carries and whether or not it carries any; without automatic lexical content,
an empty body compiles none of the three. For these notes, each state reaches the next by one edit in
one file, with its address, its id, its index record and every link into it
unchanged:

| The note carries           | Produces                                       |
| -------------------------- | ---------------------------------------------- |
| no block, empty body       | an index record — a name that can be queried   |
| no block, a written body   | a page, a PDF page and a JournalEntry          |
| a block, a written body    | all of those, plus that system's Actor or Item |
| two blocks, a written body | one document per system, and one of each other |

Write the person; add a system block when someone will need a token. A setting's
cast is mostly people nobody rolls dice against, and a note about one of them
carries no block and occupies no slot in a compendium a referee browses.

**A note carrying no document publishes no UUID for one.** Its address, its
page and its documentation journal are published as they are for any other note,
and the `foundry` entry that would name an Actor or an Item is absent — the same
statement [`pack: none`](#the-pack-a-note-compiles-into) makes about a pack,
made about a system.

**A block for a system this package ships no pack for is an error.** The
authored data would be discarded either way, so the build says so, once per note
per system, naming the system and the document class:

```
assets/content/People/Aelric.md:7:1: error: carries a `hm3:` block, and no Actor pack in this package compiles hm3 documents, so the block is discarded — declare `system: hm3` on one of the `packs:`, or remove the block.
```

A pack declaring no `system:` is compiled by the fallback pass, which reads one
system's block — so a systemless Actor pack serves that system and not every
system a note might write. A package shipping for a second system declares
`system:` on a pack of each class it compiles.

That includes actors. A being producing its Actor and nothing else would be
a system-bearing note with readable content, giving a prose link
naming it nowhere to land. It carries a documentation journal like every other
such note, addressed
`<package>-note-being-<shortcode>` beside the Actor's
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

Footnotes use `[^id]` references and `[^id]:` definitions. Identifiers are
local to a note; rendered markers are sequential numbers. A Foundry page
collects its referenced footnotes in a Footnotes section at the bottom of that
JournalEntryPage, while a book places them at the bottom of the page of
reference. A term followed by `: definition` lines creates a definition list.
After a blank line, indent continuation paragraphs and blocks by four spaces
to keep them in the same definition; indent a code block's opening fence,
contents and closing fence. Another `:` starts a separate definition for the
same term. See the [authoring examples](../authoring/links-and-markup.md#footnotes-and-definition-lists).

```
# Heading {#id .class1 .class2 attr="value"}
```

Any header can end with a braced attribute block, in the same grammar a
caption, fenced div, span and named block take. Inside the braces:

- `#id` names the anchor a link resolves to (only one allowed)
- `.class1` names a CSS class (any number of classes allowed)
- `attr="value"` names an HTML attribute whose value is `value` (any number of
  key/value pairs allowed)

The id is what every surface publishes; a class and an attribute reach only the
surfaces that have somewhere to put them.

|                 | an `#id`                                                    | a `.class`            | an `attr="value"`      |
| --------------- | ----------------------------------------------------------- | --------------------- | ---------------------- |
| Website         | the heading's `id`, and the target of `[[note#id\|…]]`      | the heading's `class` | written on the heading |
| Foundry journal | the anchor the page is addressed by, and the heading's `id` | the heading's `class` | written on the heading |
| Book            | the Typst label the heading is linked to                    | dropped               | dropped                |

**The book drops both**, because Typst has no stylesheet for a class to name
and no element for an attribute to sit on. A heading whose appearance matters in
print is set by the book's own template, not by a class an author writes.

An id contains letters, digits, `_` or `-`. A class and an attribute key begin
with a letter. Braces holding nothing the grammar recognises — a set, a die
expression, a measurement — are one finding at the heading's line, and the
heading is set as it was written so nothing is lost while the author reads the
message.

`id=` and `class=` are refused in favour of `#id` and `.class`, and an attribute
beginning `on` is refused as an event handler, exactly as on a named block: a
heading's attributes are written onto the element, so nothing authored in a note
becomes code on a published page.

#### A section withheld from players

The class `secret` on the heading that opens a section withholds that section.
The heading keeps its id, so the section stays linkable: secrecy is a property
of the section, not of the name a link resolves to.

```markdown
# The Cellar {#cellar .secret}

The contraband is behind the false wall.
```

The section runs from the heading to the next heading that opens a page, which
is the span Foundry makes one page of. A captioned item inside the section is
withheld with it in Foundry: its own page and the page that resumes the section
after it are visible to the GM alone.

| Surface | What a reader meets                                                                                               |
| ------- | ----------------------------------------------------------------------------------------------------------------- |
| Foundry | The journal page is visible to the GM alone — `ownership: { default: 0 }`, `CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE` |
| Website | The heading and everything under it sit inside the expandable `<details>` a `:::secret` block renders as          |
| Book    | The heading and everything under it are set in the labelled block a `:::secret` is set in                         |

**On the website this is a spoiler and not access control.** The withheld
section is in the published page, so a reader who opens the element or reads the
source reads it — exactly as a `:::secret` block is. Foundry is the only surface
that withholds anything from anybody. Write nothing in a `.secret` section that
would matter if a player read it on the web.

A `:::secret` block inside a withheld section is legal and renders as it does
anywhere else. `.secret` on a heading that opens **no** page covers no page, so
no surface can honour it: that is a finding at the heading's own line, answered
by giving the heading an anchor or raising it to the top level.

#### Images

An image is authored in the body, in the place it belongs, and every surface
renders it there — the book, the website and a Foundry Journal Page alike. One
authored statement, three renderers, which is the single-sourcing every other
part of this format follows.

```markdown
![[branwldrgr|Brànwâal Dôrgaar]]{float=top-left}
![[branwldrgr|Brànwâal Dôrgaar]]{size=medium float=top-left}

![Map of Thalorna](images/maps/thalorna.webp){.full-width}
```

**An image is a block.** It stands alone in its paragraph, with a blank line
either side of it, and every surface renders it as a figure. An image sharing a
paragraph with prose is refused, because a width and a position mean nothing
applied to a word in the middle of a sentence.

**Alt text renders as a caption on no surface.** On the website and in a
Foundry journal it stays on the `img` element's `alt` attribute alone, and the
book prints nothing beneath a picture that carries none. A visible label and
caption are drawn only for a picture preceded by [a caption](#captions-and-numbered-references), and the text drawn is always the fence's own
caption. A title — `![alt](src "title")` — is refused rather than dropped in
silence: there is one place for those words, the alt text, and a title is not
it.

##### Width is a class, and the ordinary width carries no marker

| `class` value | book                          | website            | Foundry journal |
| ------------- | ----------------------------- | ------------------ | --------------- |
| _(none)_      | natural width within a column | natural width      | natural width   |
| `.full-width` | page measure                  | full content width | full page width |

The simple case needs no spelling, which is why the ordinary width has no name.

**No pixel values, ever.** A number means something in a browser and nothing
coherent in print, and a directive carrying a class and a dimension at once
gives one question two answers with no rule for which wins. `{width=800}` is
refused.

##### Named size is `size`

| `size` value | website and Foundry | book         |
| ------------ | ------------------- | ------------ |
| `auto`       | natural size        | natural size |
| `small`      | 64 CSS pixels       | 1.6 cm       |
| `medium`     | 128 CSS pixels      | 3.2 cm       |
| `large`      | 256 CSS pixels      | 5.6 cm       |
| `xlarge`     | 512 CSS pixels      | 8 cm         |
| `full-width` | content measure     | page measure |

These are maximum display widths for Markdown images and embedded assets;
height follows the file's aspect ratio. The available column, page, or browser
measure caps every size, and print also caps image height within the page.
Omitting `size` means `auto`, which uses the file's natural dimensions within
those bounds. `full-width` spans the book's page rather than one column. The
`.full-width` class also grants page scope in print; when it accompanies a
bounded `size`, the image keeps that bounded width inside the page figure.
A `size` may sit before or after `float` in the same directive, and neither
changes the other's behavior.

##### Position is `float`

| `float` value  | book                 | website and Foundry journal     |
| -------------- | -------------------- | ------------------------------- |
| `top-left`     | top of the column    | floated left, text wraps        |
| `bottom-left`  | bottom of the column | floated left, text wraps        |
| `top-right`    | top of the column    | floated right, text wraps       |
| `bottom-right` | bottom of the column | floated right, text wraps       |
| `center`       | top of the column    | centred, with no text beside it |

**Print cannot wrap text around an arbitrary shape.** A Typst float occupies
the column measure, so in the book only the vertical half of a position has an
effect — top of the column or bottom of it — while the horizontal half does
not. The website and a Foundry journal get true CSS wrap from the same
directive. Expect the same statement, not the same page.

An image with no `float` is an ordinary block in the flow, where it was
written. A `.full-width` image is set at the **top of a new page**: the book is
set in two columns, only a float spans them both, and a float is placed where
the page has room rather than where it was written — so the page breaks before
the picture, and the prose that follows it runs below it on the same page. The
picture can therefore never print above the prose that introduces it or after
the prose that follows it, at the cost of the page before it ending short. A
picture taller than the page takes a page of its own.

A `.full-width` image that **also states a `float`** is asking for a float and
gets one, with no break before it. A float is placed where it fits, which may be
the next page.

##### All three vocabularies are closed

`{.fullwidth}`, `{.full_width}`, `{width=800}` and `{float=middle}` are
refused, located by file, line and column, and the build fails. An unrecognised
value rendering as the ordinary width is the failure worth preventing, because
it looks exactly like a directive that worked.

A directive holding anything this section does not name is not honoured at all,
even in the part that parsed: a half-honoured directive is the same silent
failure in a smaller costume. The image keeps its braces and renders them as
literal text, so the mistake is visible on the page as well as in the log.

**Nothing else reaches emitted markup.** The width and position classes and the
address are all that leave a note; there is no `style`, no `id` and no arbitrary
attribute, because data is never compiled into markup here. An address carries
a scheme of `http:` or `https:`, or none at all.

##### Where an address resolves

An image's address follows [the pathname rule](#a-pathname-names-the-package-that-owns-the-file)
— its first segment says which package owns the file — and each surface
resolves it to what that surface serves:

- **Foundry** is handed the path inside the install, so `images/map.webp`
  reaches a journal page as `modules/<package>/assets/images/map.webp`. An
  address with no such path — a package this build declares no relationship
  with, or `packagebuild`, which Foundry installs nothing of — is **refused,
  located by file, line and column**, and the build fails. Foundry is the one
  surface a correctly written pathname can be dead on while the other two
  resolve it, and a `src` that resolves against nothing looks exactly like an
  address that worked.
- **The book** is handed a copy of the file, staged out of this package's own
  asset tree into the build directory before the compiler runs. An address
  naming a file this package does not ship — another package's, or a URL —
  cannot be staged, and the book prints the caption alone and says so.
- **The website** passes the address through exactly as authored, because a
  site serves its imagery from its own asset host and this package is not told
  what that host is. An address that has to resolve there is written as a full
  URL.

#### Content tables

A fenced `sql` block renders a table from the content index. A query that
selects no rows is a build error unless its fence states `{allow-empty=true}`.

**An Address is a string in every relation**: the full canonical Address, with
`#<anchor>` where it carries one. A fence compares one as it is written —
`list_contains(data.parents, 'thalorna-note-place-xerathia')`,
`data.government = p.address.canonical` — in this package's `notes` and in each
dependency's alike, although the published index writes each as an object.

SQL fences query the content index through DuckDB. The SQL dialect is DuckDB's.

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
reads `NULL` rather than failing. `data.culture` is the one field that reads as
a derived value: the note's own culture, or the one it inherits. See
[Culture in the index](#culture-in-the-index).

**`notes` leaves out stubs; `entries` does not.** Both carry a derived `state`
column — `stub`, `draft` or `full` — and `notes` is exactly
`SELECT * FROM entries WHERE state <> 'stub'`. So every table already written
selects what it always selected, and gains `state` for free; a table that should
list the unwritten beside the written changes one word:

````markdown
```sql
SELECT address.slug    AS _ref,
       name.full       AS "Name",
       state           AS "State",
       m.name          AS "Market",
       data.population AS "People"
FROM entries
LEFT JOIN market m ON m.value = data.market
WHERE type = 'place' AND subType = 'settlement'
  AND list_contains(data.parents, 'place-aelwyth')
ORDER BY data.population DESC NULLS LAST, name.full COLLATE NOCASE
```
````

A written settlement renders as a link and a stub renders as plain text, from
one query with no branch in it: `_ref` is the stub's absent address, and the
renderer already prints a bare cell where it is null.

A fence selecting `FROM notes` that **would** gain rows from `FROM entries` is
warned about at the fence, with the count — so adopting stubs in a given table
stays a decision somebody makes rather than one they forget.

The ladder is what makes "how finished is this?" a query:

```sql
SELECT state, count(*) AS n FROM entries GROUP BY state ORDER BY state
```

**`events`** is one row per event — per entry of `data.events` on every
`lore`, `place` and `affiliation` note, stubs included — so a chronology is a
query rather than a list kept by hand:

````markdown
```sql
SELECT note AS _ref, "when" AS "When", summary AS "What happened"
FROM events
WHERE kind IN ('war', 'siege', 'battle')
ORDER BY whenSort
```
````

| Column                   | What it holds                                                                                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `note`                   | The canonical Address of the note the event is written on.                                                                                                                                                                  |
| `address`                | The event's own Address: `note#id` where the event has an `id`, the note's Address alone where it has none.                                                                                                                 |
| `id`, `kind`, `depth`, … | Every key of an event, each its own column under its own name — `id`, `kind`, `depth`, `when`, `until`, `recurs`, `summary`, `standing`, `names`, `where`, `who`, `follows`, `accounts`, `unresolved`, `sources`, `stated`. |
| `whenSort`, `untilSort`  | The date's position on the canonical axis: the canonical year, with a day as its fraction of the year where the calendar states the year's length. `ORDER BY whenSort` is date order.                                       |
| `whenYear`, `untilYear`  | The canonical year alone, for a filter such as `whenYear BETWEEN 200 AND 299`.                                                                                                                                              |

`when` and `until` read as the text the note wrote, `~` included. The sort
keys and years are positions on the canonical axis, which counts a year `0`
that written dates do not: a year written after zero keeps its number, and one
written before zero sits one higher, so `when: -250` has a `whenYear` of
`-249`. `_ref` takes a note's Address, never an anchored one, so a table links
each row through `note` rather than `address`. A key no
event writes is still a column, `NULL` in every row, and so is a sort key for
a date with no position on the axis — `unknown`, or a year-`0` day that recurs
every year. Every Address is a string, as in every other relation, and a list
stays a list: `list_contains("where".locus, 'thalorna-note-place-ironfells')`.
`when` and `where` are SQL keywords, so a query names those columns in double
quotes, `"when"` and `"where"`. A note tagged `gm` contributes no row on a
public surface.

**`words`** is one row per word — per entry of `data.words` on every
[language note](#a-languages-words), stubs included — in the order the note
states them:

| Column                      | What it holds                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `language`                  | The Address of the language note the word is written on, as another note names it: `thalorna-note-skill-provnzlng`.                         |
| `position`                  | Its place in the note's `data.words`, from `0`. `ORDER BY position` is the note's own order.                                                |
| `form`, `class`, `gloss`, … | Every key of a word, each its own column under its own name. `name_sort` reads as the form where the word states none.                      |
| `built_text`                | The `built` pieces joined with `+`, as `wulf- + -rith`; `NULL` for a root word.                                                             |
| `built_parts`               | The pieces as a list of `{ form, gloss }`, each glossed from a word or affix of the same language, with a `NULL` gloss where none is.       |
| `senses`                    | The word's senses as a list, one per entry of a `gloss` list, or the one `gloss` states; `gloss` itself reads as the senses joined by `; `. |
| `attested`                  | The Addresses of the notes whose prose cites the word, derived as [a language's words](#a-languages-words) says; `NULL` where none does.    |

A key no word writes is still a column, `NULL` in every row, and a word of a
language note tagged `gm` contributes no row on a public surface, nor does a
`gm` note among a word's `attested`. A row holds
the words its own note states, and nothing more: a daughter language's
inherited words are read through `language_lineage`.

**`affixes`** is one row per entry of `data.affixes` on every language note,
and **`fields`** one per entry of `data.fields`, in the order the note states
them. Each has `language` and `position` as `words` does, then every key of the
entry as its own column: `form`, `zero`, `kind`, `given`, `where`, `gloss`, `attaches`, `replaces`, `lengthens`, `front`, `examples`, `barredAfter`
and `tones` for an affix, then `written`, its form as a table prints it (`∅` for a zero affix), `name` and `holds` for a field. A key an entry does not state is
`NULL`, `examples` is a list, and a language note tagged `gm` contributes no
row on a public surface. An affix's `tones` is the tone pattern it carries,
written as a word's `tones` is; it is a key of its own and is never read out of
`attaches`.

**A language's register, sounds, history and names are each a relation**, one
row per entry of the key it is read from, in the order the note states them,
each with `language` (the language note's Address) and, for a list, `position`,
then every key of the entry as its own column. A key an entry does not state is
`NULL`, and a language note tagged `gm` contributes no row on a public surface.
See [a language's register, sounds and history](#a-languages-register-sounds-and-history)
for the keys.

| Relation         | Read from                       | Columns beyond `language` and `position`                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `register`       | `data.register`                 | `name`, `tongue`, `kind`, `built` (a list), `gloss`, `why`, `built_text` (the pieces joined with `+`), and `notes`: every note of the package carrying the name, derived from the index, `NULL` where none does                                                                                                                                                            |
| `tongues`        | `data.tongues`                  | `tag`, `meaning`, and `tongue_language`, the tongue's `language`                                                                                                                                                                                                                                                                                                           |
| `retired`        | `data.retired`                  | `form`, `instead` (always a list, `NULL` where nothing is written instead), `why`                                                                                                                                                                                                                                                                                          |
| `scope`          | `data.scope`                    | No `position`: `kind`, the key the value is under (`folders`, `cultures`, `lore`, `parents`, `addresses`, `paths`, `types` or `skip`), and `value`, an Address in its canonical form or a path or a type                                                                                                                                                                   |
| `letters`        | `data.sounds.letters`           | `letters` (a list), `kind`, `like`, `place`, `tongue` (a list, `NULL` for every tongue)                                                                                                                                                                                                                                                                                    |
| `edges`          | `data.sounds.edges`             | `edge`, `sounds` (a list: `[any]` for every sound, empty for none)                                                                                                                                                                                                                                                                                                         |
| `clusters`       | `data.sounds.clusters`          | No `position`: `max`, one row per language stating it                                                                                                                                                                                                                                                                                                                      |
| `stress`         | `data.sounds.stress`            | No `position`: `stress`, one row per language stating it                                                                                                                                                                                                                                                                                                                   |
| `finals`         | `data.sounds.finals`            | `final`, `like`                                                                                                                                                                                                                                                                                                                                                            |
| `syllables`      | `data.sounds.syllables`         | No `position`, one row per language stating it: `onsets`, `codas`, `finals`, `doubled`, `vowelPairs`, `neverInitial` and `signature` (lists, `any` a list of one), `initialVowel` and `finalVowel` (`true` or `false`), and the harmony as `harmony_back`, `harmony_front`, `harmony_neutral`, `harmony_neutralAs` and `harmony_partners` (a list of `{ vowel, partner }`) |
| `joining`        | `data.sounds.joining`           | `first` and `second` (lists), `written`, `example`                                                                                                                                                                                                                                                                                                                         |
| `joins`          | `data.sounds.joins`             | `meeting`, `rule`, `letters` (a list), `where`                                                                                                                                                                                                                                                                                                                             |
| `marks`          | `data.sounds.marks`             | `mark`, `letters` (a list), `kind`, `limit`                                                                                                                                                                                                                                                                                                                                |
| `skeleton`       | `data.sounds.skeleton`          | `second` (a list, `[any]` for every other), `between`                                                                                                                                                                                                                                                                                                                      |
| `frames`         | `data.sounds.frames`            | `frame`, `shape`, `class` (a list), `makes`, `examples` (a list of `{ root, form }`)                                                                                                                                                                                                                                                                                       |
| `read_past`      | `data.sounds.readPast`          | `written`, `readAs`, `what`                                                                                                                                                                                                                                                                                                                                                |
| `sound_changes`  | `data.soundChanges`             | One row per step: `position` (the set's), `name`, `from_language`, `to_language`, `takes`, `step_position` (the step's in its set), `step`, `change`, `where`                                                                                                                                                                                                              |
| `elements`       | `data.elements`                 | `form`, `variants` (a list), `element_position` (the element's `position`), `kind`, `sense`, `examples` (a list), `word`, `joining`                                                                                                                                                                                                                                        |
| `roots`          | `data.roots`                    | `root`, `sense`, `field`                                                                                                                                                                                                                                                                                                                                                   |
| `cognates`       | `data.cognates`                 | One row per form of a set: `position` (the set's), `gloss`, `proto`, `form_language` (the form's language note), `form`                                                                                                                                                                                                                                                    |
| `calling_names`  | `data.callingNames`             | One row per closing: `form`, `doubled` (`true` or `false`), `usual`, and the language's `min_syllables`                                                                                                                                                                                                                                                                    |
| `cluster_groups` | `data.sounds.clusters.groups`   | `what`, `clusters` (a list), `use`                                                                                                                                                                                                                                                                                                                                         |
| `mutations`      | `data.sounds.mutations`         | `mutation`, `sound`, `becomes`, `example`                                                                                                                                                                                                                                                                                                                                  |
| `older`          | `data.older`                    | `form`, `gloss`, `layer`                                                                                                                                                                                                                                                                                                                                                   |
| `negation`       | `data.negation`                 | No `position`: `particle`, `mutation`, one row per language stating it                                                                                                                                                                                                                                                                                                     |
| `name_shapes`    | `data.naming.shapes`            | `of`, `syllables_min`, `syllables_max`, `per_vowel_min`, `per_vowel_max`                                                                                                                                                                                                                                                                                                   |
| `name_edges`     | `data.naming.edges`             | `edge`, `sounds` (a list), `vowel` (`false` where unstated), `of` (`name` where unstated)                                                                                                                                                                                                                                                                                  |
| `name_draws`     | `data.naming.draws`             | `kind`, `elements` (a list)                                                                                                                                                                                                                                                                                                                                                |
| `held_from`      | `data.naming.heldFrom`          | `source`, `takes`, `clip`, `joining` and `elements` (lists)                                                                                                                                                                                                                                                                                                                |
| `near_names`     | `data.naming.nearName.examples` | `near`, `given`, and the language's `min_syllables`                                                                                                                                                                                                                                                                                                                        |

A register name is carried by a note in the language's `data.scope` — any
note of the package, for a language stating no scope — that has it as its full name, an alias,
or any other part of its `name`, by an affiliation that has it as a rank or an
office title, and by an anchor that has it as its name, which the row cites as
`note#anchor`; a folder note carries no name. `where`, `like`, `limit` and
`between` are SQL keywords, so a query names those columns in double quotes,
`"where"`, `"like"`, `"limit"` and `"between"`; an affix's `where` is quoted the same way. A frame's form for one root is
`list_filter(examples, e -> e.root = 'd-l-k')[1].form`. A cognate table is the forms of each set pivoted on
`form_language`:
`max(form) FILTER (WHERE form_language = 'thalorna-note-skill-helonclng') AS "Helonic"`,
grouped by `position` and `gloss`.

**`names`** is one row per actual `.name` span in an authored note body. Each
row has these columns, including on an empty relation:

| Column    | SQL type  | Meaning                                                                                      |
| --------- | --------- | -------------------------------------------------------------------------------------------- |
| `owner`   | `VARCHAR` | Containing authored page's canonical NOTE Address, or `NULL` when the record has no Address. |
| `name`    | `VARCHAR` | Rendered visible text, preserving its spelling.                                              |
| `type`    | `VARCHAR` | Supplied note type, or `NULL`.                                                               |
| `subType` | `VARCHAR` | Supplied subtype, or `NULL`.                                                                 |
| `line`    | `BIGINT`  | Original 1-based source line at the span's opening `[`.                                      |
| `column`  | `BIGINT`  | Original 1-based UTF-16 source column at that `[`.                                           |

```sql
SELECT owner, name, type, subType, line, "column"
FROM names
WHERE type = 'place'
ORDER BY owner, line, "column"
```

A native Item's source uses its NOTE page as `owner`. Declared dependency
metadata supplies `names` in that package's SQL schema. Public queries exclude
GM-only owners; all/native contexts retain them. Only authored occurrences
contribute rows, so generated queries and sections add no further names.

**`language_lineage`** is one row per language note and each language it
inherits words from through [`data.family`](#a-languages-words): `language`,
`ancestor` and `depth`, with the language itself at depth `0`, its parent at
`1`, and so on up the chain. Joining `words` on `words.language =
language_lineage.ancestor` gives a language's words with its inherited ones,
and `depth` says how far up each was found. A chain stops at a parent that is
no language note of the same package.

**`glossary`** is one row per entry of a culture's or an affiliation's
[`data.glossary`](#glossary-terms): `note` (the Address of the culture or
affiliation), `position`, and the entry's `name`, `name_sort` (the name where
the entry states none), `common` (`false` where it states none), `definition`,
`pronunciation` and `language`. `language` is the language the entry
resolves to, its own or the one its note gives it, and `NULL` only where it
resolves to none, which the lint refuses.

**`dictionary`** is one row per word per language it is listed under,
inherited words included, and **`terms`** one row per glossary term, rank or
office per note that owns it. See
[dictionaries and glossaries](#dictionaries-and-glossaries) for their columns
and how their rows are built.

**`market`** is the six-step market scale as a relation — `value`, `name`,
`trade` — so a table prints `village` beside the number a note wrote without a
second copy of the scale living in authored content.

**The state is derived, never stored.** No index record carries it, no note can
author it, and nothing in `data:` may claim it: the only authored signal is the
`draft` tag, which marks the one thing reading the body cannot reveal.

**Two aliases are read by the renderer rather than printed**, because which
column links and where a section breaks are decisions about output, not
relational operations:

| Alias      | What it does                                                           |
| ---------- | ---------------------------------------------------------------------- |
| `_ref`     | Makes the row's **first** rendered column a wikilink to that address.  |
| `_section` | Emits a headed table per distinct value, in the order the rows arrive. |

`_section` is why one query replaces the forty near-identical blocks a grouped
table would otherwise need: the authored `ORDER BY` decides the section order too.

**Beware `packFolder`.** It is a note's _pack_ folder, not its directory — the
directory is `file.folder`.

##### Culture parents and inherited fields

A `lore` note of `subType: culture` may list the larger cultures it belongs to
in `data.parents`. Each entry is an Address naming another culture lore note;
a missing target, a target of another type or subtype, and a parent cycle are
errors at the offending list entry. No other lore subtype accepts the key.

A culture inherits `data.language` and `data.appearanceProfile` independently
when it leaves either field out. A stated value wins for that field. The
profile is inherited as one complete object; its weights and ranges are not
merged with another profile. Parents are searched in listed order, depth-first:
the first parent's chain is searched before the next parent's chain. Sources
at the same depth that disagree on a field produce a finding. Nothing is
inherited through a broken parent address.

The emitted content-index JSONL carries the resolved fields in the child's
`data`, exactly as if the child had stated them. `package-build npc new` and
other consumers read those resolved values; they do not walk culture parents.
The child's `data.culture` remains its own Address. A being, place or
affiliation naming the parent in `data.culture` belongs to that named culture;
it does not match the parent's children.

These complete notes give Riverfolk their parent culture's tongue and profile:

```markdown
---
shortcode: reedfolk
name: { full: Reedfolk }
type: lore
subType: culture
data:
  language: skill-reedtongue
  appearanceProfile:
    frame: { medium: 1 }
    eye_color: { brown: 1 }
    hair_color: { black: 1 }
    skin_color: { tawny: 1 }
    complexion: { clear: 1 }
    height:
      female: { min: 1.5m, max: 1.7m }
      male: { min: 1.6m, max: 1.8m }
---

Reedfolk share the reed tongue and live along the marsh's waterways. Their
settlements trade by boat, hold seasonal gatherings and pass their stories
between families at those gatherings.
```

```markdown
---
shortcode: riverfolk
name: { full: Riverfolk }
type: lore
subType: culture
data:
  parents: [lore-reedfolk]
---

Riverfolk belong to the Reedfolk culture and share its tongue. They live
beside the river's deep channels, where their boats carry grain, timber and
woven reeds between settlements.
```

The parent names this language note, whose lists supply generated names:

```markdown
---
shortcode: reedtongue
name: { full: Reed Tongue }
type: skill
subType: language
data:
  pack: skills
  names:
    pattern: "{given} {kin}"
    given:
      female: [Nara]
      male: [Taro]
    kin: [Mori]
---

The reed tongue is spoken beside the marsh's waterways. Its speakers use a
given name followed by a family name, and carry those names between river
settlements with their trade.
```

In a package named `reedflats`, the Riverfolk index record carries the Reedfolk
profile and `data.language` as a published Address object:

```json
{ "address": "reedflats-note-skill-reedtongue", "anchor": null, "anchorKind": null }
```

Adding `language: skill-rivertongue` to Riverfolk's `data` selects that language
instead while retaining the inherited profile, provided the named language
note exists. Stating an `appearanceProfile` there replaces the inherited
profile while leaving the inherited tongue in place.

##### Culture in the index

`data.culture` in the index is the note's **resolved** culture, which is its
authored value where it states one and a derived value where it does not. The
resolved value is written into the index as a canonical Address string, such as
`reedflats-note-lore-reedfolk`, so a table selects by it directly.

The culture of a note, in order:

1. Its own `data.culture`, when it states one.
2. For a `lore` note of `subType: culture`: itself. A culture note may leave the
   field out or state it as its own Address, and its resolved culture is its own
   Address either way.
3. For a `place` or an `affiliation`: the resolved cultures of its
   `data.parents` — places through their parent places, affiliations through
   their parent affiliations — found recursively, so a culture stated three
   levels up reaches the bottom.
4. For an affiliation of `subType: polity` that still has none: the resolved
   cultures of its places, pooled as one set — its `data.seat` and every place
   whose `data.government` names the polity.
5. Otherwise none. A parent or place that resolves to nothing contributes
   nothing.

A `being` and a `doc` of `subType: settingguide` read as the value they state and
nothing more; every other `lore` note reads as its own value, and every other
note type reads as none.

Sources that agree give that culture. Sources that name different cultures, on a
note that states none of its own, are an **error**, and that note gets no
culture. The error is located at the `parents:` key; for the pooled places of a
polity it is located at the `seat:` key, or at the `data:` line when the polity
states no seat. Stating `data.culture` on the note settles the matter, because
an own value is never compared with its sources. A note whose parent raised the
error reads that parent as resolving to nothing, so one disagreement is reported
once, at the note where the sources meet.

Here a region states a culture and the places inside it carry it down:

```markdown
---
shortcode: reedflats
name: { full: Reed Flats }
type: place
subType: region
description: A marsh region.
data:
  culture: lore-reedfolk
---
```

```markdown
---
shortcode: saltmarsh
name: { full: Saltmarsh }
type: place
subType: district
description: A salt marsh.
data:
  parents: [place-reedflats]
---
```

```markdown
---
shortcode: eelwick
name: { full: Eelwick }
type: place
subType: settlement
description: A fishing village.
data:
  parents: [place-saltmarsh]
---
```

`saltmarsh` and `eelwick` state no culture and index as `reedflats-note-lore-reedfolk`.
Because the index carries the resolved value, one query selects the region and
everything beneath it, and `IS NULL` selects the notes that have no culture:

````markdown
```sql
SELECT address.slug AS _ref, name.full AS "Name"
FROM notes
WHERE type = 'place' AND data.culture = 'reedflats-note-lore-reedfolk'
ORDER BY name.full
```
````

````markdown
```sql
SELECT address.slug AS _ref, name.full AS "Name"
FROM notes
WHERE type = 'place' AND data.culture IS NULL
```
````

A place whose parents sit in different cultures must say which it belongs to.
With a second region `stonecrest` that states `culture: lore-hillfolk`, a place
on the border between the two:

```markdown
---
shortcode: causeway
name: { full: The Causeway }
type: place
subType: site
description: A road between marsh and ridge.
data:
  parents: [place-reedflats, place-stonecrest]
---
```

fails the content-index build with one located error per conflict:

```text
assets/content/Places/Causeway.md:8:3: error: data.parents resolve to different cultures (reedflats-note-lore-reedfolk via reedflats, reedflats-note-lore-hillfolk via stonecrest); state data.culture
```

The conflict fails the content-index build, and every other command that reads
the index without collecting problems, listing every conflict in one run. Adding
`culture: lore-reedfolk` under `data:` on `causeway` removes it. A fetched
dependency's index carries each note's resolved culture, so a parent in another
package contributes the culture that package resolved for it.

The index record carries the resolved culture, and every pass that reads the
record reads it too: lint, the pack compile and the site build all see a
place's inherited culture, and a culture note's own Address, as its
`data.culture`. A resolved value always passes the checks that scope the field,
because a culture note resolves to itself and an inherited value names a culture
note. The infobox shows a note's resolved culture, except a culture note's own.

##### Reading another package's notes

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

Its events are `sohl.events`, read exactly as this package's own `events`.
This package's own notes stay at the unqualified `notes`, and a query may read
both at once — joining your beings against the skills they cite is one `FROM`
clause. It needs no fetch and no configuration: a dependency's published index
is already cached when a compile starts, because resolving addresses across
packages needs it.

Which dataset a query reads is `FROM`'s job rather than a fence property. A
fence naming a file would write a build artifact's path into the corpus, so
renaming the artifact would mean sweeping every note that cited it.

##### Header arguments

Statements _about the directive_ use the shared braced attribute syntax after
the language name:

````markdown
```sql {section-level=3 allow-empty=true}
SELECT name.full AS "Name", sohl.kbcat AS _section
FROM notes WHERE type = 'affliction'
```
````

The language word stays first so Markdown readers recognize SQL. Attributes are
separated by spaces. An unquoted value cannot contain spaces or braces; quote a
value containing spaces with double quotes and escape an internal quote as
`\"`. Boolean values are exactly `true` or `false`; other spellings are
errors. Duplicate and unknown attributes are errors.

| Attribute                                   | What it does                                                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `allow-empty=true`                          | Permits a query selecting no rows. Default `false`.                                                                        |
| `section-level=1` through `section-level=6` | Sets the heading level for `_section`. Default `2`.                                                                        |
| `key=false`                                 | Omits the key and any dictionary verb head table, retaining entries. Default `true`. Refused on a table, as `key=true` is. |
| `key=only`                                  | Prints a dictionary's or a glossary's key for its rows, and no letter heading or entry. Refused on a table.                |

##### Page lists

A fenced `pagelist` block renders a list of the pages carrying a tag. It is the
companion of a content table and answers the other question: a table says what
a set of notes contains, a page list says which pages belong to a group.

````markdown
```pagelist {tag="key-concept" type=lore sort=type descriptions=true}

```
````

**The group is the tag, not an enumeration.** A hand-written list of links is
a second place the membership is recorded, and the two drift the moment a page
is written and nobody edits the landing that should name it. A page list reads
`tags:` instead, so tagging a page files it and untagging it removes it.

**The fence takes no body.** Every statement about the directive is an
attribute in the shared braced grammar, so there is one grammar to learn; text
written inside the fence is reported rather than printed, and a fence nobody
closed is reported rather than swallowing the rest of the note.

| Attribute           | What it does                                                              |
| ------------------- | ------------------------------------------------------------------------- |
| `tag=`              | Required. The tag a page carries to join the list.                        |
| `type=`             | Restricts the list to one note type. Every type by default.               |
| `sort=name`         | Alphabetical, case and accents folded, tiebroken on address. The default. |
| `sort=type`         | Groups the note types and orders by name within each.                     |
| `descriptions=true` | Follows each link with the page's `description`. Default `false`.         |
| `allow-empty=true`  | Permits a tag no page carries. Default `false`.                           |

The tag is matched the way `tags:` is read everywhere else — a leading `#`,
surrounding space and letter case are all insignificant, while the spelling of
the tag itself is exact. Nothing guesses at a near miss.

**What a list holds.** Every note of this package that carries the tag and
publishes a page. A **stub** publishes no page, so it holds no address and joins
no list. A documentation journal is not listed beside the note it documents,
because they are one page. A note tagged `gm` is listed in Foundry and left out
of the website and the book, which is the same audience rule a content table's
relations follow.

**Each entry is a link, resolved by the surface that is building.** The
directive is answered before the body is walked and spliced in where the fence
sat, so the list reaches a reader as compendium journal links in Foundry and
page links on the website and in the book — the same resolution an authored
`[[…]]` gets, including the cue on a link into a `draft` note.

**A tag no page carries is an error at the fence's line and column**, naming
the tag and, where the directive restricts one, the type. An empty list under
an authored heading is how a misspelled tag survives a build, so the
directive's silence is what is refused rather than its output.

##### Captions and numbered references

Write a caption on its own line **before** the item it describes, with a blank line before and after the caption. `:` produces an unnumbered caption; `:@` produces a numbered caption. One or more spaces separate the marker from its text. An optional attribute block at the end accepts an identifier, classes and named attributes:

```markdown
:@ Regional trade routes {#trade .border type=table}

| Route | Days |
| ----- | ---- |
| North | 4    |

Refer to {{ref "#trade"}} for the market routes.
```

This displays **Table 1: Regional trade routes**; the reference links to **Table 1**. An unnumbered `: Regional trade routes {#trade}` displays only its text, has an anchor, and does not consume a number. An item with no caption remains unnumbered.

The caption attaches to exactly the next supported block:

| Next item                            | Inferred type | Numbered label |
| ------------------------------------ | ------------- | -------------- |
| Markdown table                       | `table`       | Table          |
| Image, Markdown or wikilink          | `figure`      | Figure         |
| SQL fence, including backtick SQL    | `table`       | Table          |
| Poetry fence                         | `poetry`      | Poem           |
| Any other code fence                 | `code`        | Code           |
| Paragraph, quote block or fenced div | `prose`       | Prose          |

The optional `type` attribute overrides inference and accepts `figure`, `table`, `poetry`, `code`, `prose`, and `example`. `type=example` uses **Example 1**, **Example 2**, and so on. It does not allow an unsupported target. A heading, list, thematic break, another caption or end of document after a caption is an error. Caption markers without separating spaces or caption text are errors too.

Identifiers are optional and must be unique within the note. Classes are unrestricted; `.border` uses the shared border style, while other classes can be styled by the medium. Named attributes use `key=value`, with quoted values for text containing spaces. Use `#id` and `.class` rather than `id=` and `class=`; event-handler attributes are refused.

Each numbered type has its own counter. Websites and Foundry number within a note; books number across their reading order. Unnumbered captions neither display nor consume a number. A map image can retain its asset-derived **Map** classification when no type is specified.

`{{ref "#trade"}}` displays the numbered label as a link. `form="full"` includes caption text and `form="title"` displays the caption alone. Use title form for an unnumbered caption. Cross-note references can name the note address before the anchor, such as `{{ref "place-harbor#trade"}}`; the displayed number belongs to the target on the surface rendering it. Links inside caption text contribute their visible text to references, so the reference does not contain a nested link.

Foundry gives a captioned item a JournalEntryPage holding the item alone, named for its number or, unnumbered, for the caption's visible text — links and emphasis reduced to the words a reader sees. A solitary image with a plain caption can use an image page; captions with inline markup and other items use text pages. The body after the item resumes on a continuation page carrying the interrupted section's name, level and classes, with its title hidden; nothing is emitted when the next page begins straight after the item. On the website and in the book the item stays in the flow of the surrounding page.

To caption a group or passage, put it inside a generic fenced div and caption that div, with an explicit type where the inferred one does not fit.

##### Fenced divs

A bare `:::` opens a div section. An optional attribute block applies to the whole fenced area. A bare `:::` closes the section:

```markdown
::: {#harbor-note .border lang=en}
The harbor remains open through winter.

A second paragraph belongs to the same div.
:::
```

An attribute-bearing opener allows a nested div to be distinguished from the bare closer. Divs carry no automatic title or number; style their classes for the medium. Use a leading caption to caption the entire div. The same attribute grammar is available on named blocks; identifiers, classes and named attributes belong to the entire section. Headings that would start a Foundry journal page cannot split a fenced section.

##### Inline spans

`[inline content]` represents a span. Follow it immediately with an optional attribute block to apply an identifier, classes and named attributes:

```markdown
The watch wears [a _blue_ sash]{#watch-sash .uniform lang=en}.
```

The exact `.name` class marks a name, with optional `data-type="type/subType"`;
see [marking names in prose](#marking-names-in-prose) for the vocabulary and index.
The exact `.secret` class marks the enclosed text as an inline spoiler:

```markdown
[The hidden **passage**]{.secret}
[Aldric Venn]{.name .secret data-type="being/npc"}
```

The website provides an inline show/hide button and preserves interactive links
inside the revealed content. Foundry prints a visible inline `secret` span
with a **Secret:** label; the span does not withhold its text from players.
The book prints the text with secret styling and a **Secret:** label.
Inline emphasis and combined `.name` classification survive rendering. Published HTML retains the text, so opening
the spoiler or inspecting the source reveals it.

This span has no effect on a destination's audience. Ordinary wikilinks derive
spoilers from their resolved destinations; `.show` bypasses that automatic
concealment without cancelling an enclosing authored `.secret`. An inline span
does not change the scope of `.secret` headings or `:::secret` blocks, and it
does not start or withhold a JournalEntryPage.

Inline Markdown remains active inside the span. Bracket spans have lower priority than URL links, image links, reference links, footnotes and wikilinks. A bracketed form immediately preceded by `!`, followed by `(` or another `[`, or beginning with `[[` is not a span, even when the link is unresolved. Ordinary links retain their existing syntax. Escape a bracket when it should be literal, or put examples inside a code span or fence. A span identifier addresses that point in the note; it does not start a journal page.

##### Alerts

Alerts replace the former `:::info` and `:::warn` fences. Start with a special blockquote marker, optionally followed by an attribute block, then write the alert body as a standard blockquote:

```markdown
> [!NOTE]
> Useful information that users should know, even when skimming content.

> [!TIP]
> Helpful advice for doing things better or more easily.

> [!IMPORTANT]
> Key information users need to know to achieve their goal.

> [!WARNING]
> Urgent info that needs immediate user attention to avoid problems.
```

| Marker         | Label     | Appearance                                        |
| -------------- | --------- | ------------------------------------------------- |
| `[!NOTE]`      | Note      | Blue rule and `fa-regular fa-message`             |
| `[!TIP]`       | Tip       | Green rule and `fa-regular fa-lightbulb`          |
| `[!IMPORTANT]` | Important | Purple rule and `fa-solid fa-circle-info`         |
| `[!WARNING]`   | Warning   | Amber rule and `fa-solid fa-triangle-exclamation` |

The label and icon sit above the body. Alerts are visible callouts, not expandable sections. Inline Markdown, links, multiple paragraphs, lists and code examples remain available inside the quote. Prefix blank lines within the body with `>` to keep paragraphs in the same alert.

Attributes follow the marker and apply to the alert:

```markdown
> [!WARNING] {#flood-warning .seasonal lang=en title="Seasonal closure"}
> The eastern road closes during spring floods.
>
> Use the ridge path instead.
```

Use `#id`, `.class` and named attributes in the shared braced grammar. The marker determines the default label, icon and color. An authored `title` replaces the default **Note**, **Tip**, **Important** or **Warning** heading while preserving the alert type’s icon and color. Event-handler attributes, malformed attributes, unknown alert types and empty alert bodies are errors. Ordinary blockquotes and alert examples inside literal code remain unchanged. A leading caption can describe an alert as a quote block, normally with the `prose` type or an explicit `example` type.

##### Secret blocks

`:::secret` sets GM material apart. Its optional attributes accept an identifier, classes and named attributes. `title` supplies its heading; without a title the heading is **Secret**:

```markdown
:::secret {#harbor-secret title="For the GM"}
The harbor master is working for the smugglers.
:::
```

A secret block can contain alerts and general divs. It cannot contain another secret block. A heading that starts its own journal page cannot split a secret block or general div; use a lower heading without an anchor within the section.

Foundry renders a secret section; the website renders an expandable spoiler, and the book renders a labeled box. An untitled secret takes its normal default title, and a Foundry secret without an id receives an id derived from its body. The presentation does not make published HTML private: deliberately inspecting generated source can reveal its content. Use YAML comments for information that must never be published.

#### Actors

All actor types, including being and vehicle, have their entire markdown section processed as normal.

The following H1 headers are treated specially:

- `# ... {#appearance}`: The contents of this header become the `doc.appearance` property in sohl and `doc.description` in hm3.
- `# ... {#dossier}`: The contents of this header become the `doc.dossier` property in sohl and `doc.biography` in hm3.

**Archetypes** describe characters in broad terms and help match them to an adventure. The list is:

<!-- archetypes:start -->

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
- commoner: Fits no more specific archetype; handles ordinary work and daily life.
- entertainer: Performs for an audience through acting, music, comedy, or similar arts.
- guildsperson: Has professional training, standing, or connections that open doors.

<!-- archetypes:end -->

`character` and `npc` beings require at least one archetype. `creature` beings may omit archetypes or write an empty array. Values use the exact lowercase spellings above.

Note that archetypes are descriptive, not proscriptive, and a character may be described by multiple archetypes at once.
`commoner` stands alone: a being with another fitting archetype does not also carry `commoner`.
Guild membership alone does not require `guildsperson`; the being's training, standing, or connections must matter to the role.

#### Items

All item types, including affiliation, affliction, armor, armorlocation, attribute, concoction, containergear, miscgear, mystery, mysticalability, projectile, skill, trauma, weapon, and lore, have their entire markdown section processed as normal.

An Item can mark its readable description with `# ... {#description}`. That heading starts a JournalEntryPage even when other pages precede it. Its Address is `<package>-note-<type>-<shortcode>#description`; the compiler resolves it to one `@UUID[...]` pointer. SoHL stores that pointer in `system.docHtml`, and HM3 stores the same pointer in `system.description` for Item subtypes that declare the field. An Item without this anchor points to its first page. Other pages remain addressable by their own anchors.

### Events

An **event** is one dated, attributed record of something that happened in the setting — a founding, a war, a fall, a plague, a birth. It is an entry in `data.events`, and three types carry that list: `lore`, `place` and `affiliation`. There is no event note type. A note holds the events that belong to it: a history note holds the event it describes, a place holds its raising and its ruin, an affiliation its founding and its dissolution. The schema is the same on all three types and on every subType.

Every key of an entry is closed, and so is every key of each map nested in one. A key this section does not list is an error at that key, and a value outside a key's closed list is an error at that value. Every Address an entry writes resolves in this package or a declared dependency, or it is an error at that Address.

An event appears on its note's page and in its Foundry journal as prose the note's body writes, and in the [event views](#event-views) the build appends to the notes it concerns. Nothing derived from it reaches a system field, an infobox row or a page's front matter, which carries `data.events` only as the note wrote it. The content index carries each entry's resolved dates under `resolvedDates.events`, and the [`events`](#content-tables) relation holds one row per entry.

#### The keys of an event

| event key    | shape                                | required  | what it records                                                            |
| ------------ | ------------------------------------ | --------- | -------------------------------------------------------------------------- |
| `id`         | address segment                      | see below | The event's name within its note — lowercase letters and digits            |
| `kind`       | one `eventKind` value                | no        | What sort of thing happened                                                |
| `depth`      | one `depth` value                    | no        | How far the event's history reaches                                        |
| `when`       | a date, or `"0.<day>"`               | yes       | When it happened, or the anchor and first instance of an event that recurs |
| `until`      | a date                               | no        | When a continuous event ended, or where a recurring series stopped         |
| `recurs`     | `{ every }` or `{ on }`              | no        | How further occurrences are found; absent for an event that happened once  |
| `summary`    | string                               | yes       | What happened, stated plainly                                              |
| `standing`   | one `standing` value                 | no        | What the world's evidence supports                                         |
| `names`      | `{ name, by, gloss? }[]`             | no        | The event's names in the world, each with who uses it                      |
| `where`      | `{ locus?, reach? }`                 | no        | Where it happened, and where it was felt                                   |
| `who`        | `{ ref, role }[]`                    | no        | Who took part, and as what                                                 |
| `follows`    | `{ event, how, note? }[]`            | no        | The earlier events this one follows from                                   |
| `accounts`   | `{ by, says, agrees, withholds? }[]` | no        | What each people, polity, faith or place says about it                     |
| `unresolved` | string list                          | no        | What the world itself has not settled                                      |
| `sources`    | Address list                         | no        | The notes that state or support the event; each resolves                   |
| `stated`     | `{ calendar, text }`                 | no        | The date as one tradition writes it in its own reckoning                   |

The nested entries, each closed the same way:

| nested key                   | shape                                                                              | required | what it records                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `names[].name`               | string                                                                             | yes      | One name the event goes by in the world                                                   |
| `names[].by`                 | Address naming an `affiliation`, `lore`, `place`, `being` or `skill` note          | yes      | Who uses that name — a people, a polity, a faith, a place, a tongue; resolves             |
| `names[].gloss`              | string                                                                             | no       | What the name means, or how it is used                                                    |
| `where.locus`                | list of Addresses, each defaulting to `place`                                      | no       | Where the event physically happened; each must resolve to a place                         |
| `where.reach`                | `{ place, how, knowledge, attributedTo? }[]`                                       | no       | Where the event was felt, and whether each place knows why                                |
| `where.reach[].place`        | an Address, defaulting to `place`                                                  | yes      | A place where the event was felt; must resolve to a place                                 |
| `where.reach[].how`          | string                                                                             | yes      | One clause: a consequence someone in that place could notice                              |
| `where.reach[].knowledge`    | one `knowledge` value                                                              | yes      | Whether that place connects what it felt to this event                                    |
| `where.reach[].attributedTo` | Address, defaulting to `lore`, naming an event or a `lore` note                    | no       | Only beside `knowledge: misattributed` — the cause that place names instead; resolves     |
| `who[].ref`                  | Address naming a `being`, `affiliation` or `lore` note                             | yes      | A participant — a being, a people, an affiliation; resolves                               |
| `who[].role`                 | one `role` value                                                                   | yes      | What the participant was to the event                                                     |
| `follows[].event`            | Address, defaulting to `lore`, anchored to an `event` where its note holds several | yes      | The earlier event; resolves to exactly one event                                          |
| `follows[].how`              | one `followsHow` value                                                             | yes      | How this event follows from it                                                            |
| `follows[].note`             | string                                                                             | no       | One clause saying what connects the two                                                   |
| `accounts[].by`              | Address naming an `affiliation`, `lore`, `place` or `being` note                   | yes      | Who holds the account; resolves                                                           |
| `accounts[].says`            | string                                                                             | yes      | What they say happened, in their terms                                                    |
| `accounts[].agrees`          | one `agrees` value                                                                 | yes      | How far their account agrees with `summary`                                               |
| `accounts[].withholds`       | string                                                                             | no       | What they decline to say                                                                  |
| `stated.calendar`            | Address, or a lore shortcode                                                       | yes      | The calendar that tradition reckons in — a `lore` note with `subType: calendar`; resolves |
| `stated.text`                | string                                                                             | yes      | The date as that tradition writes it                                                      |
| `recurs.every`               | whole number of years, 1 or more                                                   | —        | A period counted on the canonical axis from `when`                                        |
| `recurs.on`                  | list of dates, strictly increasing, each later than `when`                         | —        | Recorded occurrences beyond the first, in place of a period                               |

`where.locus` and `where.reach[].place` default to `place`, so a bare shortcode there is read as one — `vale` is `place-vale` — and whatever the written form, the Address must resolve to a place note; one resolving to an affiliation, a lore note or anything else is an error at that key. `follows[].event`, `where.reach[].attributedTo` and `stated.calendar` default to `lore` in the same way, so `fallkhazturn` is `lore-fallkhazturn`. `who[].ref`, `accounts[].by` and `names[].by` state their type, and the type must be one their row names; a note of any other type is an error at that key naming the types it takes. `sources` takes a note of any type, written with its type: `lore-khazarfolk`, never `khazarfolk`. No Address is a bare name such as `The Vale`. `where.locus` in particular is never filled in from the note the event sits on — an event on a place is not assumed to have happened there, so a `locus` is written or absent.

#### Identity, and how an event is addressed

An event's `id` is an [anchor](#anchors) of kind `event`, in the one namespace the note's headings and blocks share. An event is addressed as its note's address when the note holds one event, and as `<note address>#<id>` when it holds several: `lore-thebargain`, `place-ironfells#sack`, `affiliation-crown#founding`.

- `id` is an address segment — lowercase ASCII letters and digits, nothing else.
- `id` is unique within its note, and differs from every heading, caption and block anchor the note declares.
- `id` is **required on every entry of a note holding two or more events**, and optional on a note holding one.

A note's prose prints one field of an event with an inline reference, `{{ref "place-ironfells#sack" field="when"}}`: the event's `when` or `until` as the note format prints a date, its `kind`, its `summary`, or the first of its `names`, as text and never a link, identically on every surface. The address names one event as a `follows[].event` does, or `"#<id>"` for one of the note's own. An address naming no event, a `prose` anchor, a `field` outside those five, or a field the event does not state is an error at the reference's position. The [authoring guide](../authoring/links-and-markup.md#an-events-date-inline) has examples.

A `follows[].event` resolves to exactly one event: a note holding one event, or `note#id`. Naming a note that holds several events without an `id` is an error, and so is naming an anchor the note does not declare or one that is not an event. An Address into another package is checked the same way against that package's published index, which carries each note's anchors with their kinds and each event's date.

#### Generated sections

The build supplies sections from a note's frontmatter and the content
relationships around it. Every surface receives the same text: the Foundry
journal, the website and the book. Relationship lists and event views follow
the authored text as H1 sections with fixed anchors, in this order:

| Section           | Anchor           | On                                                       | Content                                                                                                                               |
| ----------------- | ---------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Within            | `within`         | a `place`                                                | the places whose `data.parents` names it, one paragraph to each kind of place, in the order the place vocabulary lists its `subType`s |
| Governed by       | `governedby`     | a `place`                                                | the affiliation its `data.government` names, as a list entry with the affiliation's kind                                              |
| Governed places   | `governedplaces` | an `affiliation`                                         | the places whose `data.government` names it, grouped as **Within** groups them                                                        |
| Chronology        | `chronology`     | a `place`                                                | an [event view](#event-views)                                                                                                         |
| Events            | `events`         | a `being`, an `affiliation`, a `lore` note of `culture`  | an event view                                                                                                                         |
| Accounts          | `accounts`       | an `affiliation`, a `place`, a `lore` note of `culture`  | an event view                                                                                                                         |
| What followed     | `followed`       | a note holding events                                    | an event view                                                                                                                         |
| In song and story | `insongandstory` | any note                                                 | the `literature` works whose `data.subjects` name the note or one of its events, as list entries with each work's `data.form`         |
| From here         | `fromhere`       | a `place` that states, or is named in, a border or route | the map drawn from the place, as an image                                                                                             |

- **Relationship and event sections follow the author's text in the table's order.**
- **A section with nothing to show is not generated.**
- **An author's own relationship or event section replaces its generated one.** A note whose body declares a prose anchor with the section's slug — `# Within {#within}`, or a block or span with that `id` — gets no generated section for it, and its own section is left exactly as written. This is the one way to turn a section off, and the way to choose different contents for it.
- **A relationship list entry links to the note it names**, written `[[<address>|]]` so each surface resolves it and shows the note's current name. An entry naming a stub, which publishes no page, is its name as plain text. The lists take in the places, affiliations and works a fetched index carries.
- **The map is a drawing the build makes**, named `generated/from-<shortcode>.svg`. The website sets it inline so its place names are links, the Foundry compile stages it into the module at `assets/generated/`, and the book draws it beside its source. `generated/` is the build's: an authored image addressed there is an error. `site.maps: false` gives no place the section.
- A stub publishes no page and is given no section.

**Dictionary and Glossary sections come from the owner's declarations.** A
language with nonempty `data.words` receives its full alphabetical dictionary,
with letter headings, field tags and one key. A culture or affiliation with
nonempty `data.glossary` receives only its declared entries, including an
explicitly named rank or office. An absent or empty declaration produces no
section. An authored `{#dictionary}` or `{#lexicon}` heading receives the
Dictionary list after its introduction, and `{#glossary}` does the same for a
Glossary list. Without that heading, the build appends the section at the end
of the note. See [dictionaries and glossaries](#dictionaries-and-glossaries).

#### Event views

The build appends sections to the end of a note's body that list the events concerning it — a region's chronology, the events a being took part in, the accounts a people gives, what followed an event. Each is an H1 with a fixed anchor holding a `sql` fence over the `events` relation, the same Markdown an author could write, so every surface sets it as it sets an authored section: a page of the Foundry journal, a section of the website page in its table of contents, a section of the book.

| View          | Anchor       | On                                                               | Rows                                                                                                                                                                              | Columns                            |
| ------------- | ------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Chronology    | `chronology` | a `place`                                                        | events whose `where.locus` names the place or a place below it in `parents`; events whose `where.reach` names one, with that entry's `how`; every `depth: world` event as context | What happened, When, Felt here     |
| Events        | `events`     | a `being`, an `affiliation`, a `lore` note of `subType: culture` | events whose `who[].ref` names the note, with the role it played                                                                                                                  | What happened, When, Role          |
| Accounts      | `accounts`   | an `affiliation`, a `place`, a `lore` note of `subType: culture` | each `accounts[]` entry the note gives, with the event it concerns                                                                                                                | Event, When, What they say, Agrees |
| What followed | `followed`   | a note holding events                                            | events whose `follows[].event` names one of this note's events, with how                                                                                                          | What followed, When, How           |

- **The views follow everything the author wrote**, in the order of the [generated sections](#generated-sections).
- **A view with no rows is not generated.** A chronology is generated only where the place has rows of its own; the world events beside them are context and make no chronology by themselves.
- **An author's own section replaces a view.** A note whose body declares a prose anchor with the view's slug — `# Chronology {#chronology}`, or a block or span with that `id` — gets no generated section for it, and its own section is left exactly as written. This is the one way to turn a view off, and the way to choose a different table: write the section and its own `sql` fence.
- Places below a place are found by walking `parents` down from it, so an event felt in towns under two continents is in each continent's chronology and each region's.
- A stub publishes no page and gets no view. The views read this package's own events; a dependency's are read with a fence over `<package>.events`.

#### What sort of event: `kind`

`kind` is closed. The groups are for reading; the list is one list.

| `eventKind` value | the event is                                                                         |
| ----------------- | ------------------------------------------------------------------------------------ |
| `arrival`         | A people or group comes to live in a land it did not hold                            |
| `departure`       | A people or group leaves a land it held                                              |
| `migration`       | A people moves over a long span, through or across several lands                     |
| `contact`         | Two peoples meet for the first time, or after all memory of each other is lost       |
| `displacement`    | A people is driven from its land by force or by catastrophe                          |
| `founding`        | A polity, order, settlement or other body comes into being                           |
| `charter`         | A body's rights, bounds or constitution are granted or written                       |
| `accession`       | A ruler or a ruling house takes power                                                |
| `secession`       | A part breaks away from the body that held it                                        |
| `conquest`        | One power takes and holds another's land or people by force                          |
| `treaty`          | Powers bind themselves by agreement — a peace, a league, a lease, a bargain          |
| `dissolution`     | A body ceases to exist, by decision, absorption or decay                             |
| `battle`          | One engagement between armed forces                                                  |
| `war`             | A sustained armed conflict, spanning engagements                                     |
| `siege`           | A fortified place is invested and held under attack                                  |
| `revolt`          | Subjects rise against the power that rules them                                      |
| `fall`            | A city, people or power is destroyed or overthrown                                   |
| `catastrophe`     | A natural or magical disaster — a flood, an eruption, a working that escapes control |
| `plague`          | A sickness spreads through a population                                              |
| `famine`          | Food fails across a land                                                             |
| `raising`         | A structure or settlement is built — a city, a wall, a temple, a road                |
| `ruin`            | A structure or settlement falls into ruin or is razed                                |
| `making`          | An object, work or artefact is made                                                  |
| `loss`            | An object, work or body of knowledge is lost                                         |
| `discovery`       | Something is found or first learned — a land, a route, a secret, a working           |
| `schism`          | A faith, order or school divides                                                     |
| `law`             | A law, code or decree is made or abolished                                           |
| `council`         | An assembly meets and decides                                                        |
| `birth`           | A person is born                                                                     |
| `death`           | A person dies                                                                        |

A place's raising and its ruin are `raising` and `ruin` events on that place; an affiliation's founding and dissolution are `founding` and `dissolution` events on that affiliation.

#### How far it reaches: `depth`

| `depth` value | the event                                                 |
| ------------- | --------------------------------------------------------- |
| `world`       | Has to be accounted for by more than one region's history |
| `region`      | Is held by one region's history                           |
| `local`       | Belongs to one place, one being or one legend             |

`depth` is set by hand and never derived. The test for `world` is not importance but reach of accounting: an event is `world` when more than one region's history has to account for it, and anything a single region can hold is that region's. A `local` event is met on the page of the place, being or legend it belongs to.

#### What happened, and how sure the world is: `summary` and `standing`

`summary` states the event plainly, in one or two sentences, with no hedging — not "it is said that", not "may have", not "legend holds". Doubt does not go in the summary. It goes in `standing`, in `accounts` and in `unresolved`.

| `standing` value | the world's evidence                                                        |
| ---------------- | --------------------------------------------------------------------------- |
| `attested`       | More than one independent tradition records it                              |
| `single-source`  | One tradition records it, and nothing contradicts it                        |
| `reconstructed`  | No tradition states it; it is worked out from other records                 |
| `disputed`       | Traditions disagree that it happened, or on a particular the event turns on |
| `legendary`      | What is established is that a story exists, not that the thing happened     |

`legendary` changes what `summary` describes: on a `legendary` event the summary describes the story, truthfully, because the story existing is the fact.

`standing` is independent of how precisely the date is written. A well-attested event can carry an approximate century, and a reconstructed one can carry an exact year because the arithmetic that places it is exact. The date's grain is in how it is written — `280` is the year, `280.25` the twenty-fifth day, `~280` around 280.

#### Where: `where.locus` and `where.reach`

`locus` is where the event physically happened — usually one place, occasionally a few, such as a battle on a border or a treaty signed in two cities. It is not the region that owns the event; no region owns one.

`reach` is where the event was felt, and each entry has to earn its place. **A reach entry exists only when its `how` clause can state a consequence someone in that place could notice.** "It mattered there" is not a reach entry; "the holds lost half their smiths within a generation" is. A place that felt nothing has no entry — there is no value for "unaffected", because an absent row already says so.

| `knowledge` value | in that place                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `named`           | Its own record names this event as the cause of what it felt                                           |
| `misattributed`   | Its record names a different cause, given in `attributedTo` — the people there are wrong, not ignorant |
| `unlinked`        | The consequence is felt, and no tradition there connects it to anything                                |

`attributedTo` is written only beside `misattributed`, and names what that place blames instead: an event — a note holding one, or `note#id` — or a `lore` note, such as a people or a belief.

#### Who: `who`

`who` lives on the event, never on the participant, so a being's or a people's part in events is found by reading the events that name it rather than by listing them on its own note. A people is a legitimate participant: much of a deep past happens to peoples rather than to named individuals. An unnamed participant is not a row — a person the record cannot name is a clause in `summary` and, where who they were is open, a line in `unresolved`.

| `role` value | the participant                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `actor`      | Did it                                                                                         |
| `victim`     | Had it done to them                                                                            |
| `instrument` | Was the means by which it was done, without being its author — a host driven, a weapon wielded |
| `witness`    | Saw it, and is a source of what is known                                                       |
| `founder`    | Brought into being what the event founds                                                       |
| `ruler`      | Held the authority under which it happened, or the authority it confers                        |
| `author`     | Wrote or composed what the event makes — a law, a charter, a work                              |
| `signatory`  | Is a party bound by the agreement it records                                                   |

#### Names: one event, several names

An event known by several names in the world is one event with several names, never several events. The note's own `name` is the neutral name the chronology sorts by; `names` carries every in-world name with the people, polity, faith or place that uses it.

`names` and `accounts` vary independently, which is why they are two keys: a people can share an event's name and dispute what happened, or use a name of its own and agree entirely. A defeat in one chronicle and a deliverance in another is one event whose `names` differ and whose `accounts` differ.

#### What is believed: `accounts`, `withholds` and `unresolved`

Each `accounts` entry attributes one reading of the event: who holds it (`by`), what they say (`says`), how far they agree with `summary` (`agrees`), and what they decline to say (`withholds`).

| `agrees` value | the account                                                                      |
| -------------- | -------------------------------------------------------------------------------- |
| `full`         | Agrees with the summary                                                          |
| `partly`       | Agrees in substance and differs in particulars                                   |
| `disputes`     | Holds that it happened, and otherwise than the summary says                      |
| `denies`       | Holds that it did not happen                                                     |
| `silent`       | Says nothing of it where it could — a silence stated as a fact, not an ignorance |

**`withholds` and `unresolved` record different things.** `withholds` is a people declining to say, which is a fact about that people and sits on that people's account. `unresolved` is the world not having settled the question, which is a fact about the world and sits on the event. Who made a weapon is `unresolved`; that the people who used it will not discuss it is `withholds`. Each `unresolved` line is a plain statement of something open, not a hedge.

#### Consequence: `follows`

`follows` is written on the later event only, and names the earlier one. Whoever writes the later event is the one who knows what it follows from, and what followed from an event is found by reading the edges that name it, so nothing is lost by writing each edge once.

| `followsHow` value | this event                                      |
| ------------------ | ----------------------------------------------- |
| `caused`           | Would not have happened without the earlier one |
| `enabled`          | Was made possible by it, not inevitable         |
| `ended`            | Terminates a state the earlier one began        |
| `answered`         | Is a deliberate response to it                  |

Two rules hold the graph together, and both are errors when broken:

- **An edge points backward in time.** The event an edge names is no later than the event writing it, comparing the two `when` dates. Two dates that both state a day compare by day; otherwise they compare by year, so a year and a day inside it are never out of order. An edge touching a `when` with no position on the axis — `unknown`, or a year-`0` date — is not ordered.
- **The graph has no cycle.** No chain of edges leads from an event back to itself, across notes or within one.

A consequence is an edge, not a second event. A consequence with no date of its own is a `reach` entry, if it is felt somewhere, or a `follows` edge, if it is a later event's cause — never a new event recording the same thing twice.

#### Dates: `when`, `until` and `recurs`

An entry reads by what it authors beside `when`:

| authored                          | reads as                                        |
| --------------------------------- | ----------------------------------------------- |
| `when`                            | happened once                                   |
| `when` + `until`                  | ran continuously from then to then              |
| `when` + `recurs`                 | happened then and happens still                 |
| `when` + `until` + `recurs.every` | happened then, again on the period, and stopped |

`recurs.every` and `recurs.on` are exclusive — a period with named exceptions is written as an enumeration instead. `recurs` is refused beside a `when` of year `0`, and a being's `born` and `died` take no `recurs`. `until` is refused beside `recurs.on`, whose own last entry already bounds it.

**The period advances the canonical year, never the era-relative year.** There is no year `0` in era-relative numbering — era year `-1` sits immediately before era year `1` — but canonical year `0` is an ordinary integer on the continuous axis `canonicalYear` builds, so a period of whole years steps on it with no special case at an epoch crossing. Precision and approximation carry through untouched: a year-precision anchor yields year-precision occurrences, an approximate anchor's occurrences are approximate too, and an anchor inside a short intercalary month recurs on that same day in every occurrence, with no special case for the month being short. Each occurrence selects its own era by testing its position against the anchor's calendar, so a later occurrence may print in a different era than its anchor, or print bare where no count was proclaimed for that year — neither is ever a finding, since nobody authored the occurrence.

**Year `0` means any year.** An entry whose `when` states year `0` recurs on that day of every year — `when: "0.5"` is the fifth day of the year, in every year. The value must be quoted, for the reason every canonical date stating a day must be: an unquoted `<year>.<day>` reaches the check as a float, and a day's trailing zero is lost before a date is read. Beside a year-`0` entry, `recurs` is refused (the entry is already annual), `until` is allowed and bounds the series, and the entry carries no `canonicalYear`, era or `sort` — it cannot date its own note. A note's date is its first entry stating a real year.

```yaml
data:
  events:
    - id: anniversary
      when: "412.1"
      recurs: { every: 1 }
      summary: The city keeps the day of its founding.
    - id: harvestrite
      when: "0.286"
      until: "940.1"
      summary: The harvest rite is kept on the two-hundred-eighty-sixth day of the year.
```

The first entry is an anniversary counted from canonical day `412.1`, recurring every year with no end. The second is an autumn rite — the two-hundred-eighty-sixth day of every year — kept until canonical year 940.

`stated` records the date as one tradition writes it, beside the canonical `when` every event carries: `when` is what sorts and compares, and `stated.text` is what that tradition's own records say, in the calendar `stated.calendar` names.

#### A complete event

One `lore` note, `lore-fallkhazturn`, holding one event with every key written:

```yaml
shortcode: fallkhazturn
name: { full: The Fall of Khazarturn }
type: lore
subType: history
data:
  events:
    - kind: fall
      depth: world
      when: ~-2427
      summary: >-
        An outlaw takes up the Second Voice and drives the Grukar against
        Khazarturn. Every inhabitant is killed, and the Khazari seal the city as
        a tomb.
      standing: attested
      names:
        - name: The Sealing
          by: lore-khazarfolk
          gloss: what the Khazari call it
        - name: the Outlaw's Work
          by: lore-sinalefolk
      where:
        locus: [khazarturnvale]
        reach:
          - place: ironfells
            how: the holds lose half their smiths within a generation
            knowledge: named
          - place: place-grukarholm
            how: tribes arrive on the coast driven off ground they will not name
            knowledge: unlinked
          - place: place-aelwyth
            how: the joint kingdom's two peoples stop speaking
            knowledge: misattributed
            attributedTo: lore-oldcompact
      who:
        - { ref: lore-khazarfolk, role: victim }
        - { ref: lore-sinalefolk, role: actor }
        - { ref: lore-grukarfolk, role: instrument }
      follows:
        - event: place-khazarturn#raising
          how: ended
          note: the city stands two and a half millennia before it falls
      accounts:
        - by: lore-khazarfolk
          says: The Sinale did this; one of theirs held the Voice, and they never said it existed.
          agrees: partly
          withholds: whether anyone tends the city since it was sealed
        - by: lore-sinalefolk
          says: One of ours did it, and we hunted him down ourselves.
          agrees: partly
          withholds: the outlaw's name and his fate
        - by: lore-worldthalorna
          says: Something shattered the old peace in an age before memory.
          agrees: silent
      unresolved:
        - who made the Second Voice, and why neither people ever said it existed
        - what remains inside the sealed city
      sources: [lore-khazarfolk, lore-sinalefolk]
      stated: { calendar: khazarcal, text: "the 900th year of the Delving" }
```

#### A note holding two events

A place holds its own raising and its own fall, so each needs an `id`, and an event elsewhere names one of them by `note#id`:

```yaml
shortcode: khazarturn
name: { full: Khazarturn }
type: place
subType: settlement
data:
  events:
    - id: raising
      kind: raising
      depth: region
      when: ~-4900
      summary: The Khazari cut the first halls of Khazarturn into the valley wall.
      where: { locus: [place-khazarturn] }
    - id: sealing
      kind: ruin
      depth: local
      when: ~-2427
      summary: The Khazari seal the gates of the dead city.
      where: { locus: [place-khazarturn] }
      follows:
        - event: place-khazarturn#raising
          how: ended
        - event: lore-fallkhazturn
          how: caused
          note: the dead are laid in their own chambers before the gates are closed
```

`place-khazarturn#sealing` follows both the city's own raising, inside the same note, and `lore-fallkhazturn`, a note holding one event and so addressed by the note alone. Both edges point backward: the raising is millennia earlier, and the fall shares the sealing's year.

### type: being

Generates a living (or undead, or spirit) being.

**subType**:

- npc: A character meant to be encountered. It may describe a reusable template and need not be
  a singular individual.
- character: A detailed, playable, singular individual.
- creature: Any being that is neither a character nor an NPC.

See [a being's subtype describes the subject](#a-beings-subtype-describes-the-subject).

| `data` property                    | Values                                         | Description                                                                                                                                           |
| ---------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokenIcon`                        | `Address`                                      | What a token on the canvas wears — an `icon` address; defaults to `icon`                                                                              |
| `templatePriority`                 | `number`                                       | Template priority, _null_ = not a template                                                                                                            |
| `archetypes`                       | `Archetype[]`                                  | What sort of character this is. **Always an array** — character and npc require at least one; creature may omit it or write `[]`; `null` is an error. |
| `occupation`                       | `string`                                       | Name of the character's occupation                                                                                                                    |
| `lore`                             | `Address[]`                                    | Other lore concerning this being, such as social standing or law                                                                                      |
| `culture`                          | `Address`                                      | Primary culture, naming a lore note with `subType: culture`                                                                                           |
| `homes`                            | `Address[]`                                    | Place the being calls home                                                                                                                            |
| `affiliations`                     | `Map<Address, Membership>`                     | Bodies the being belongs to, keyed by Address, each entry the standing it holds there                                                                 |
| `affiliations.<Address>.rank`      | `integer`, required                            | The level on that body's own `governance.ranks` ladder; `1` is an ordinary member, `0` someone cast out                                               |
| `affiliations.<Address>.office`    | `string`                                       | A post that body names in its `governance.offices`, where the being holds one                                                                         |
| `affiliations.<Address>.societies` | `string[]`                                     | The societies the membership is held in, by name; SoHL carries the first as `system.society`                                                          |
| `socialTies`                       | `Map<Address, Tie>`                            | Defining support and opposition, directed from this being to others                                                                                   |
| `gender`                           | `male \| female \| nonbinary \| none \| other` | Gender of the being — see [a being's look](#a-beings-look)                                                                                            |
| `species`                          | `Address`                                      | Being's species (lore)                                                                                                                                |
| `born`                             | `date \| unknown`                              | When the being was born; absent, it was never born                                                                                                    |
| `calendar`                         | `Address`                                      | Calendar note that prints the being's dates                                                                                                           |
| `died`                             | `date \| unknown`                              | When the being died; absent, it is alive                                                                                                              |
| `age`                              | `34 \| ~34`                                    | Age in years, stated only to override what `born` says; `~` marks an estimate                                                                         |
| `ageYears`                         | `number`                                       | Written by the compiler beside an `age` estimate — the `~` stripped; a note never authors this                                                        |
| `height`                           | `1.91m \| 6' 3"`                               | Height in metres or feet and inches                                                                                                                   |
| `weight`                           | `85kg \| 187 lbs`                              | Body weight in kilograms or pounds                                                                                                                    |
| `frame`                            | `scant \| light \| medium \| heavy \| massive` | Relative frame — see [a being's look](#a-beings-look)                                                                                                 |
| `appearance.eye_color`             | a word                                         | Eye colour — see [a being's look](#a-beings-look)                                                                                                     |
| `appearance.hair_color`            | a word                                         | Hair colour — see [a being's look](#a-beings-look)                                                                                                    |
| `appearance.skin_color`            | a word                                         | Skin colour — see [a being's look](#a-beings-look)                                                                                                    |
| `appearance.complexion`            | `word[]`, required with `appearance`           | The skin's condition, a list of words — see [a being's look](#a-beings-look)                                                                          |
| `appearance.extra_features`        | `string[]`                                     | The visible physical marks no word covers — see [a being's look](#a-beings-look)                                                                      |

Author `data.height` as a string of decimal metres (`1.91m` or `1.91 m`) or
whole feet with optional inches (`6'`, `6'3"`, or `6' 3"`). Inches must be
between 0 and 11. Author `data.weight` as a string of decimal kilograms (`85kg`
or `85 kg`) or whole pounds (`187lbs` or `187 lbs`). The infobox prints both in
feet and inches and whole pounds, rounding metric input to the nearest inch or
pound. Numeric values are also accepted as metres and kilograms during content
conversion; explicit units make an authored value unambiguous. These fields
describe a being's body. Item gear weight remains a numeric `data.weight`.

`data.culture` names the culture in which a character belongs. It is one
Address to a `type: lore`, `subType: culture` note. A named character with a
known culture states it here; generic beings and templates can omit it.
`data.lore` holds the law the being lives under, the customs it is subject to
and the traditions it was raised in. Record the primary culture in
`data.culture` only, and a standing in `data.affiliations`.

```yaml
data:
  culture: lore-vedyariclt
  lore: [lore-marchlaw]
```

#### A being's look

**A being's gender, frame and appearance are stated in words from one closed
vocabulary**, so every package describes a face in the same terms and a
misspelt or invented word is caught. `data.gender`, `data.frame`,
`data.appearance.eye_color`, `data.appearance.hair_color` and
`data.appearance.skin_color` each take one word from their own list.
Any other value — a word from another field's list, a variant spelling such as
`gray` for `grey`, or an empty string — is an error at the value, naming the
words the field takes. Leave a field out when the fact is unrecorded.

**`data.appearance.complexion` is a list, and a being that states an appearance
must state it.** A face carries more than one condition at once, so the field
is always a list of complexion words: `[weathered, freckled]`, `[clear]` for
skin with nothing remarkable about it, or `[]` where no condition is
established. A single word written outside a list, such as `complexion: clear`,
is an error that asks for the list, and so is an `appearance` map with no
`complexion` or a `complexion` of `null`.

**`data.appearance.extra_features` lists the visible physical marks no word
covers** — a scar and where it is, a missing finger, a tattoo, a limp. Each
entry is a short plain description of one mark. The closed fields above carry
everything else, so an entry is an error at that entry when it:

- states a hair, eye or skin colour or a skin condition, which belong in
  `hair_color`, `eye_color`, `skin_color` and `complexion` — `auburn hair`,
  `red eyes`, `milky white eyes`, `brown and black hair`, `pale skin`,
  `weathered complexion`, `freckled`;
- names gear, clothing or a weapon — `a mail shirt kept oiled`,
  `carries a heavy battleaxe`;
- describes a voice or speech — `speaks with a lisp`;
- describes behaviour, manner or temperament — `fidgets constantly`,
  `an infectious grin`, `hyperactive`;
- gives an impression of looks or presence — `startlingly beautiful`,
  `a commanding presence`, and `a beautiful tattoo of a crane` too, mark or not;
- states handedness, sterility or an apparent age — `left handed`, `sterile`,
  `a boyish face that makes him look younger`;
- carries any punctuation, apart from a hyphen or an apostrophe between two
  letters. `ink-stained fingers` and `a lion's mane` are marks; `Scar: left
cheek` and `a scar on the cheek, from a duel` are not.

A mark that names the skin it sits on is still a mark: `a burn scar on the left
forearm` and `a brand scarred into the skin above the heart` are features. A
tattoo, scar or brand may show gear or a gesture, as in `a tattoo of a knight's
helmet`, and stands; the voice, impression, handedness, sterility and age rules
hold even for a mark.

A condition is a feature only through what it shows. Its visible sign is a mark
— `trembling hands`, `one eye missing`, `a withered left arm` — and a skin sign
the complexion words cover goes in `complexion`, so healed pox is `pockmarked`
and acne scarring `scarred`. A condition with no visible sign, such as epilepsy,
haemophilia or a parasite, stays in the being's prose and is not an appearance
fact at all.

```yaml
data:
  gender: female
  frame: light
  appearance:
    eye_color: dark_brown
    hair_color: greying_black
    skin_color: olive
    complexion: [weathered, freckled]
    extra_features:
      - a burn scar across the back of the left hand
      - ink-stained fingers
```

The words, and what each means:

<!-- being-look:start -->

**`data.gender`**

| Word        | Label     | Meaning                                                            |
| ----------- | --------- | ------------------------------------------------------------------ |
| `female`    | Female    | Female.                                                            |
| `male`      | Male      | Male.                                                              |
| `nonbinary` | Nonbinary | Neither male nor female.                                           |
| `none`      | None      | The being has no gender, as against one that is simply unrecorded. |
| `other`     | Other     | A gender none of these words fits.                                 |

**`data.frame`**

| Word      | Label   | Meaning                                       |
| --------- | ------- | --------------------------------------------- |
| `scant`   | Scant   | Very thin, with little flesh over the bone.   |
| `light`   | Light   | Slender, narrow through shoulder and hip.     |
| `medium`  | Medium  | The ordinary build, neither slight nor heavy. |
| `heavy`   | Heavy   | Broad and solid, in muscle or in flesh.       |
| `massive` | Massive | Exceptionally large in frame.                 |

**`data.appearance.eye_color`**

| Word         | Label      | Meaning                                                                            |
| ------------ | ---------- | ---------------------------------------------------------------------------------- |
| `amber`      | Amber      | Golden or coppery, with no grey or green in it; the honey-toned eye.               |
| `black`      | Black      | An iris that cannot be told from the pupil in any light, darker than `dark_brown`. |
| `blue`       | Blue       | Unmixed blue, from pale ice to deep sea.                                           |
| `brown`      | Brown      | Mid-brown, the iris pattern still legible in ordinary light.                       |
| `dark_brown` | Dark Brown | Brown so deep the iris barely separates from the pupil.                            |
| `gold`       | Gold       | A bright metallic yellow iris, brighter and colder than `amber`.                   |
| `grey`       | Grey       | Grey or grey-blue, cool and without green.                                         |
| `green`      | Green      | Green dominant, with no brown ring worth naming.                                   |
| `hazel`      | Hazel      | Brown and green together, often shifting with the light; the commonest mixed eye.  |
| `red`        | Red        | An iris that is red, as in some undead and elder folk.                             |
| `pink`       | Pink       | A pale pink or rose iris, as in albinism.                                          |
| `silver`     | Silver     | A grey iris with a bright metallic sheen rather than a dull cast.                  |
| `violet`     | Violet     | The pink-violet of an iris carrying no pigment.                                    |
| `white`      | White      | An iris white or near-white, so that the eye reads pale throughout.                |
| `yellow`     | Yellow     | A pale, flat yellow iris without the warmth of `amber`.                            |

**`data.appearance.hair_color`**

| Word                       | Label                    | Meaning                                                                                                                      |
| -------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `auburn`                   | Auburn                   | Red-brown with the red dominant.                                                                                             |
| `black`                    | Black                    | True black, with no brown cast in sunlight.                                                                                  |
| `blonde`                   | Blonde                   | Light yellow, from near-white to wheat.                                                                                      |
| `brown`                    | Brown                    | Mid-brown, neither dark nor reddish.                                                                                         |
| `chestnut`                 | Chestnut                 | Mid-brown with a red cast, the brown dominant — between brown and auburn.                                                    |
| `dark_blonde`              | Dark Blonde              | Blonde darkened towards light brown.                                                                                         |
| `dark_brown`               | Dark Brown               | Brown approaching black, still brown in sunlight.                                                                            |
| `grey`                     | Grey                     | Grey throughout, with nothing of the original colour left to read.                                                           |
| `greying_auburn`           | Greying Auburn           | Auburn still dominant, grey coming in.                                                                                       |
| `greying_black`            | Greying Black            | Black still dominant, grey coming in.                                                                                        |
| `greying_blonde`           | Greying Blonde           | Blonde still dominant, grey coming in.                                                                                       |
| `greying_brown`            | Greying Brown            | Brown still dominant, grey coming in.                                                                                        |
| `greying_chestnut`         | Greying Chestnut         | Chestnut still dominant, grey coming in.                                                                                     |
| `greying_dark_blonde`      | Greying Dark Blonde      | Dark Blonde still dominant, grey coming in.                                                                                  |
| `greying_dark_brown`       | Greying Dark Brown       | Dark Brown still dominant, grey coming in.                                                                                   |
| `greying_light_brown`      | Greying Light Brown      | Light Brown still dominant, grey coming in.                                                                                  |
| `light_brown`              | Light Brown              | Brown lightened toward dark blonde: paler than `brown`, darker than `dark_blonde`.                                           |
| `greying_red`              | Greying Red              | Red still dominant, grey coming in.                                                                                          |
| `greying_strawberry_blond` | Greying Strawberry Blond | Strawberry Blond still dominant, grey coming in.                                                                             |
| `red`                      | Red                      | Ginger or copper, the red unmixed with brown.                                                                                |
| `silver`                   | Silver                   | A bright metallic pale between white and grey: the silver of great age, or the natural silver some elder folk are born with. |
| `strawberry_blond`         | Strawberry Blond         | Pale red-gold: blonde with a red cast, lighter than red.                                                                     |
| `white`                    | White                    | Wholly white, whether from age or from carrying no pigment.                                                                  |

**`data.appearance.skin_color`**

| Word         | Label      | Meaning                                                                                     |
| ------------ | ---------- | ------------------------------------------------------------------------------------------- |
| `pale`       | Pale       | The lightest skin, which burns rather than browns; also skin carrying no pigment.           |
| `fair`       | Fair       | Light with a pink cast, burning before it browns.                                           |
| `light`      | Light      | Light and neutral, browning without burning readily.                                        |
| `medium`     | Medium     | Neither light nor dark, with no strong cast either way.                                     |
| `olive`      | Olive      | Medium with a green-grey cast.                                                              |
| `tawny`      | Tawny      | Light brown, warm rather than olive.                                                        |
| `golden`     | Golden     | Light to medium with a yellow cast.                                                         |
| `tanned`     | Tanned     | Medium, darkened by sun rather than by birth.                                               |
| `swarthy`    | Swarthy    | Dark with an olive or sallow cast, between olive and brown.                                 |
| `brown`      | Brown      | Mid-brown.                                                                                  |
| `dark`       | Dark       | Darker than brown with no particular cast; the general word where no finer shade is stated. |
| `dark_brown` | Dark Brown | Deep brown.                                                                                 |
| `ebony`      | Ebony      | The darkest skin, near-black.                                                               |

**`data.appearance.complexion`**

| Word          | Label       | Meaning                                                                                                                                             |
| ------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ashen`       | Ashen       | Grey and drained; the skin of serious illness, shock or terror.                                                                                     |
| `blotchy`     | Blotchy     | Uneven in colour, patched red or pale.                                                                                                              |
| `chapped`     | Chapped     | Reddened and cracked by cold and wind.                                                                                                              |
| `clear`       | Clear       | Free of blemish, mark or broken vessel.                                                                                                             |
| `freckled`    | Freckled    | Freckled, in patches or across the whole face.                                                                                                      |
| `jaundiced`   | Jaundiced   | Yellowed, the colour a failing liver gives.                                                                                                         |
| `leathery`    | Leathery    | Thickened and toughened by years of exposure.                                                                                                       |
| `oily`        | Oily        | Carrying a greasy sheen.                                                                                                                            |
| `pasty`       | Pasty       | Pale and doughy; the skin of indoor work and poor feeding.                                                                                          |
| `pimpled`     | Pimpled     | Presently broken out, with pimples at brow, cheek or jaw.                                                                                           |
| `pockmarked`  | Pockmarked  | Pitted by pox, or by deep pimples long since healed.                                                                                                |
| `rough`       | Rough       | Coarse in texture, without the wear of outdoor work.                                                                                                |
| `ruddy`       | Ruddy       | High colour at cheek and nose, from weather, drink or constitution.                                                                                 |
| `sallow`      | Sallow      | Yellowish and bloodless.                                                                                                                            |
| `scabrous`    | Scabrous    | Rough and scaling, the skin of a lasting complaint such as eczema.                                                                                  |
| `scarred`     | Scarred     | Marked by healed wounds. `extra_features` says where and from what.                                                                                 |
| `smooth`      | Smooth      | Even in texture, whatever marks it carries.                                                                                                         |
| `sun_kissed`  | Sun-Kissed  | Browned by sun on skin not naturally that dark.                                                                                                     |
| `sunburnt`    | Sunburnt    | Presently burned, red and peeling.                                                                                                                  |
| `translucent` | Translucent | So pale the vessels show through.                                                                                                                   |
| `vitiligo`    | Vitiligo    | Patched with white where the skin has lost its colour, most often at face, hands and mouth. The tone it has lost is still what `skin_color` states. |
| `wan`         | Wan         | Pale and drained; the skin of exhaustion or convalescence.                                                                                          |
| `weathered`   | Weathered   | Worn and lined by sun and wind; the skin of outdoor work.                                                                                           |
| `wrinkled`    | Wrinkled    | Deeply lined by age.                                                                                                                                |

<!-- being-look:end -->

#### Appearance profiles

**A culture states what its people look like in `data.appearanceProfile`**, and
`package-build npc new` draws a person of that culture from it — see
[the command](../commands.md#package-build-npc-new). Only a `lore` note of
`subType: culture` takes the key; on any other note it is an error at the key.

The profile has six keys, all required:

- `frame`, `eye_color`, `hair_color`, `skin_color` and `complexion` each map
  words of that field's [vocabulary](#a-beings-look) to positive weights. A
  word's chance of being drawn is its weight over the sum of the weights in its
  map; a word left out is never drawn.
- `height` maps a `gender` word to a range, `{min, max}`, each a height in
  metres or feet and inches as `data.height` takes it. `female` and `male` are
  required. A gender with no range of its own draws from the span of every
  range the profile states.

Weight is not in the profile. It follows from the height and frame drawn: each
frame word means a band of body-mass index, so a heavy frame always weighs more
than a light one of the same height.

| Frame     | Body-mass index (kg/m²) |
| --------- | ----------------------- |
| `scant`   | 16.5 to 19              |
| `light`   | 19 to 21.5              |
| `medium`  | 21.5 to 24.5            |
| `heavy`   | 24.5 to 28              |
| `massive` | 28 to 33                |

```yaml
shortcode: khelathi
name: { full: The Khelâthi }
type: lore
subType: culture
data:
  appearanceProfile:
    frame: { light: 2, medium: 5, heavy: 2 }
    eye_color: { brown: 6, dark_brown: 3, hazel: 1 }
    hair_color: { black: 6, dark_brown: 3 }
    skin_color: { tawny: 5, olive: 3, brown: 2 }
    complexion: { clear: 3, weathered: 2, smooth: 2 }
    height:
      female:
        min: 4' 11"
        max: 5' 8"
      male:
        min: 5' 4"
        max: 6' 3"
```

`package-build lint` checks the profile, with a finding at the word, weight or
key at fault: a word outside its field's vocabulary or from another field's
list, a weight that is not a positive number, a word map with no words, a
missing key, a missing `female` or `male` range, a height that does not read,
a range whose `min` is above its `max`, and a `height` key that is not a
gender.

`package-build npc new` refuses a culture with no resolved profile, naming the
culture note. A culture may obtain the complete profile from its
[parents](#culture-parents-and-inherited-fields).

#### Name lists

**A language states how its speakers are named in `data.names`**, and
`package-build npc new` draws a person's name from it, or checks a name it is
given against it — see [the command](../commands.md#package-build-npc-new).
Only a `skill` note of `subType: language` takes the key; on any other skill it
is an error at the key. A culture reaches the lists through `data.language`,
which names the language skill note its people speak, so cultures sharing a
tongue share its lists.

The lists have two required keys, and any number of lists named by the
language:

- `pattern` is the name's shape: placeholders such as `{given}` and `{clan}`,
  each naming a list, with the text around them written as it stands. Text may
  sit directly against a placeholder, as `sen` does in `"{given.male}sen"`.
  `"{given} {clan}"` puts the given name first, `"{family} {given}"` puts the
  family name first, and `"{given} yra {clan}"` joins the two with a particle.
  A pattern takes one of three forms:
  - **one pattern**, which every name takes;
  - **a list of patterns**, for a tongue whose people are named in several
    forms — by standing, by place, or by given name alone. A name may take any
    of them, and a drawn name takes one of them;
  - **a map of `gender` words** to a pattern or a list of them, for a tongue
    whose forms differ by gender. A gender with no pattern of its own takes
    every pattern stated.
- `given` maps a `gender` word to a list of given names. `female` and `male`
  are required. `{given}` draws from the list for the person's gender, or from
  every given list together where that gender has none. `{given.<gender>}`
  draws from that gender's list whatever the person's gender, as a patronymic
  draws a father's name.
- Every other key is a list of names that the placeholder of the same name
  draws from. A list name is letters, digits and underscores, beginning with a
  letter.

Each placeholder draws one name from its list, each name as likely as any
other, and a drawn name takes one of its gender's patterns, each as likely as
any other.

A tongue whose people are named by standing states each form in a list:

```yaml
shortcode: khelathilng
name: { full: Khelâthi Language }
type: skill
subType: language
data:
  names:
    pattern: ["{given} {house}", "{given} ez {place}", "{given}"]
    given:
      female: [Rethutê, Agosi, Ahmuzê]
      male: [Aguri, Khelemûr, Gezebari]
    house: [Reth'el'Lêru, Uqa'el'Lêru]
    place: [Zileti, Iqu, Lut-Psaqa]
```

A Khelâthi culture names its tongue with `language: skill-khelathilng`. A
person drawn from these lists is called something like _Rethutê Reth'el'Lêru_,
_Khelemûr ez Iqu_ or _Ahmuzê_, and a name an author gives in any of the three
forms fits. A name fits when it takes one of the gender's patterns with every
placeholder filled by a name of its list, the given name from the list for the
person's gender: _Agosi ez Zileti_ fits a woman and not a man, and _Aguri ez
Lut_ fits nobody, because _Lut_ is not in `place`. Names compare in Unicode
NFC, so a precomposed and a decomposed accent are the same letter.

A tongue whose people carry a parent's name, with an ending that depends on
their own gender, keys its patterns by gender:

```yaml
shortcode: northlng
name: { full: Northern Language }
type: skill
subType: language
data:
  names:
    pattern:
      male: "{given} {given.male}sen"
      female: "{given} {given.male}dóttir"
    given:
      female: [Sigrid, Astrid, Ragna]
      male: [Ulf, Harald, Torvald]
```

A man drawn from these lists is called something like _Ulf Torvaldsen_ and a
woman _Astrid Ulfdóttir_: the second name is a man's given name either way,
with the ending the pattern for the person's gender gives it. _Ulf
Haralddóttir_ does not fit a man, because it has the form of the women's
pattern.

`package-build lint` checks the lists, with a finding at the pattern, list,
name or key at fault: a pattern with an unmatched brace or no placeholder, a
placeholder that names no list, a `{given.<gender>}` whose gender has no given
list, a dotted placeholder on a list other than `given`, a list that no pattern
names, a list name a placeholder cannot spell, an empty list of patterns or of
names, an empty name, a missing `pattern` or `given`, a missing `female` or
`male` list, and a `pattern` or `given` key that is not a gender.

#### The bodies a being belongs to, and its standing in each

**Membership**: `{rank: number, office: string, societies: string[]}` — `rank`
required, `office` and `societies` not.

`data.affiliations` is a **map keyed by the body's Address**, and each entry is
the standing the being holds in that body. The key is what makes the pair
expressible: a being in two bodies holds a standing in each, and two bodies may
call a rung the same word.

An entry carries three keys and nothing else:

- **`rank`** — **required**, a **number**, the level on that body's own
  `governance.ranks` ladder. The body declares `{level, title, description}` for
  every rung, so a number indexes into it and the body stays the single source
  for what its level 5 is called.
- **`office`** — optional, a **string**, matched against the keys of that body's
  `governance.offices` map.
- **`societies`** — optional, a **list of names**, the societies the membership
  is held in. It is always a list, even with one name; a bare string is an
  error at the key.

**Every entry states a `rank`**, because belonging to a body is holding some
standing in it. Where nothing more is known the rung is `1`, the ordinary
member; `0` is the rung for someone cast out, which is a real answer rather than
a default — the ladders carry `0 Níding`, `0 Outlaw` and `0 Struck from the
Roll`. Between them the two ends cover every standing a member can hold, so an
entry that states no rank is an **error** at the entry's own line, and the
message names both numbers rather than only the gap.

An entry carrying an **office and no rank** is that same error and not a second
one, reported once: an office distinguishes a person within a standing rather
than standing in for one, so such an entry puts a person in a post in nothing.
An entry carrying a rank and no office is complete.

```yaml
data:
  affiliations:
    affiliation-vrystwldtrbs: { rank: 5, office: War Chief, societies: [Vrystwald] }
    affiliation-greenwardens: { rank: 1 }
    affiliation-silverguild: { rank: 0 }
```

Both values are checked against the body the entry is keyed by. A `rank` that
is not a level the body confers and an `office` that is not one of its keys are
each an error naming the file, line and column — so a rung or a post that does
not exist fails on every being pointing at it. Naming one body twice, by its short
and full Address, still names one body and is an error.

The infobox prints one line per membership, in the order the note writes them,
in a section of its own titled **Affiliations**: the office where one is held, then the rung's
title with its level in parentheses, then the body — `War Chief, Hárár (5), of
Vrystwald Tribes`, or `Hárár (5), of Vrystwald Tribes` with no office. The title
is read from the body's own `governance.ranks`; where the body declares no rung
at that level, or its ladder is not available, the rung reads as `Rank 5` —
`Rank 5, of Vrystwald Tribes`. The body's name links to its page, and is plain
text where it publishes none. A membership stating no
standing is the body's name alone. The lines are the same on the website, in
a Foundry journal and in the book. On the body's own page each office is a row
anchored by its name, so the post a being holds is described where the body
declares it.

For SoHL, a being embeds one affiliation item per entry: `rank` **is** that
item's `system.level`, `office` its `system.office`, and the first name in
`societies` its `system.society`. The SoHL item holds one society, so only the
first name reaches it. A standing is a fact
about the setting rather than about one system, so the `sohl:` block states
none of it.

#### The people who matter to a being

`data.socialTies` records relationships that define the subject's dossier, not
everyone the subject knows. An absent entry says nothing about that relationship.
An acquaintance belongs here when, for example, a guard will recognize the
subject at a gate. A father and an independent adult son can have no tie in
either note; a daughter who relies on her father may be his `dependent`.

The keys are bare Addresses with an explicit `being` or `affiliation` type.
Values are `patron`, `friend`, `dependent`, `acquaintance`, `rival`, or
`nemesis`. A patron supports the subject from greater power or status; a
friend supports them from goodwill; a dependent relies on their protection;
an acquaintance knows them without a strong disposition; a rival opposes them
without implacable hostility; a nemesis opposes them personally and
implacably. The infobox groups targets by term and links to their notes.

```yaml
data:
  socialTies:
    being-kaldor: patron
    being-alys: dependent
    affiliation-silverguild: nemesis
    kethira-note-being-kaldas: rival
```

The full Address names a target in another package. Each target has one tie:
writing its short and full Address in the same map still names one target and is
an error.

Each tie is one-sided. The target need not name the subject back, even when
`patron` and `dependent` would describe opposite ends of the same support.
Kinship, household membership, organizational membership, rank, and office are
distinct facts. Their relevant effects may appear as ties, while a membership
and the standing held in it belong in `data.affiliations`. A tie has no
mechanical modifier.

#### When a being was born, when it died, and how old it is

**Absence asserts a fact rather than recording a gap**, and that is what these
three fields are built around.

- **`born` absent** says the being was **never born** — a construct, a spirit,
  an elemental, a thing that was made. **`born: unknown`** says it was born and
  the date is unrecorded, which is the commonest shape in a tree.
- **`died` absent** says the being is **alive**, which is the common case and so
  takes the cheapest form. **`died: unknown`** says it is dead and the date is
  unrecorded. Both spellings of `died` mean dead.
- **`age` is optional and is an override.** Written, it wins over anything the
  dates say. Unwritten beside a dated `born`, it is the age that follows from
  the date and the package's declared present — see below. Unwritten beside
  `born: unknown` or an absent `born`, the age is unknown.

Most people in a setting do not know their own birth date, so an age beside
`born: unknown` is an ordinary complete record and not a note working around the
schema. Where the number is somebody's estimate rather than a fact, write it
`~34` — the same `~` a date carries. The estimate string is kept exactly as
written; the compiler adds `ageYears` beside it, the plain number with the `~`
stripped, for anything that needs to sort or filter on the age rather than
read it.

#### The age a dated `born` computes to

A package states the day its setting stops on `data.present`, on its own
`world` or `celestial` `place` note — see _What a body states about itself_
under `type: place`. Against that date, a being with a dated `born` and no
authored `age` compiles the age it implies: the two dates compared, not the
two years subtracted, so a birthday that falls later in the year than the
present counts one less than the years alone would say. A package that
declares no present computes no age and says nothing about it — the same
silence a package with no calendar mechanism meets.

**An authored `age` beside a dated `born` is expected to agree with what the
date computes.** Where it does not, `package-build lint` raises a warning
naming both values, so a stale age left behind after a `born` was corrected
does not go unnoticed. The warning is silent beside `born: unknown` or an
absent `born` — there is nothing there to disagree with — and silent wherever
the package declares no present, for the same reason no age is computed at
all.

Use `born:` for a being's birth date.

#### The lead image

**A being's portrait is the first thing inside its `{#appearance}` section,
always.**

```markdown
# Appearance {#appearance}

![[<address>|<the being's full name>]]{float=top-left}
```

**Nothing about that embed is special.** It is an ordinary embedded image with
an ordinary directive, and no pass treats it differently for sitting where it
sits. What is strict is the convention: the portrait opens the appearance
section, so a reader opening any being note finds the picture in the same place,
and an author writing one never has to decide where it goes.

**The section is the part that is not a convention.** `{#appearance}` is what
becomes an actor's `system.appearance`, so a picture written above that heading
is outside the section and reaches no document. The heading carries the anchor
at **H1** — a deeper heading is not matched, and its whole section is extracted
as empty rather than reported.

The label is the being's full name. That is what a reader needs when the picture
does not load, and what a screen reader announces in its place.

**There is no `portrait` field**, at any level. A portrait is a picture of the
subject, and a picture of the subject belongs in the prose that describes it —
where an author can see it, move it, caption it or remove it, as with any other
image. A field puts it somewhere only a template can reach, and every template
then has to agree about where that is.

Later images are ordinary images too — a second picture of the being, a coat of
arms, a map of its holding — and they sit wherever the prose wants them,
including in `{#dossier}`.

**A being with no portrait writes no lead image.** There is no empty form and no
placeholder.

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
| `data`   | no       | Art this entry names — see _An entry's art_ below             |

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

An embedded custom item writes its identity in `system.shortcode`; a top-level `shortcode` key in the embedded entry is invalid.

#### An entry's art

An entry is an item in every respect but where it is written, so it carries art
by the two rules [an item note](#the-art-slots) does. It names an `icon`
address under its own `data:`, and that resolves into the embedded document's
`img`:

```yaml
sohl:
  items:
    - name: Quiver (leather)
      type: miscgear
      data:
        icon: quiver
      system:
        shortcode: quiver
```

`icon` is the only slot an entry has. The other three belong to a note: two
describe an Actor or a map, and `banner` is a page's hero image, which an
embedded document has no page for.

**Naming none is the common case, and it takes a default.** An entry copying a
`model:` carries the catalogue item's art, and an entry copying nothing takes
the default its type pairs in `itemBuilders` — the same default an item note of
that type compiles with. An entry naming an address of its own overrides either.
An empty `icon: ""` is an error, as it is on a note.

**`data:` reaches no compiled document.** It is where a note names art, and a
compiled Item has `img` instead; the container is read and goes no further.

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

**Reordering the list moves no id.** A key carrying the entry's position
so inserting an item renumbered every id after it and a re-import created new
documents beside the old ones — while nothing about those documents had changed,
only their neighbours. The same is now true of a note's journal pages: an
unanchored page is keyed on its heading, so inserting a heading leaves every
other page's id where it was. Two sibling pages sharing a heading is likewise a
build error, matching the `MD024` lint rule that already refuses it.

A `sohl` block produces a SoHL actor of type `being`. An `hm3` block produces an HM3 actor. Its document type is **not** derived: `hm3.type` states it, and must be `character` or `creature`. A note that omits it is an error naming the note — see _The note vocabulary, and how it maps_.

A SoHL "being" document is created, as will an "HM3" document.

| shared source     | → sohl | → hm3               |
| ----------------- | ------ | ------------------- |
| `data.species`    | NA     | NA                  |
| `data.gender`     | NA     | `system.gender`     |
| `data.occupation` | NA     | `system.occupation` |

`data.species` is a lore Address describing the being's species. HM3's
`hm3.system.species` is independent native text; it does not inherit from
`data.species`. The in-block `hm3.species` spelling is also accepted, with
`hm3.system.species` taking precedence.

### type: homepage

The package's front page, published at `https://www.heroiclands.org/<package>/`.
Exactly one note in a content tree declares this type, and it compiles into
no Foundry document: it is a page and nothing else.

It declares a `shortcode` — conventionally `root` — because that is what a
link is written with: `[[homepage-root|Text]]` is an ordinary wikilink, and it
resolves to `/<package>/`. The shortcode names the page in links; its address
is the package root. The page heading reads `name.full` and defaults to
`packageBuild.manifest.title`. `description` supplies the page's short
description.

In a compiled Foundry journal, a wikilink to the homepage prints its label
as text. The homepage has no compendium document to open.

The page is its body, published verbatim: no wikilink is resolved on it and
no table expanded, so its links are markdown links, package-relative
(`kb/rules/`) or external. An index of what the package publishes is not
written here and is not generated anywhere — it is a `doc` note carrying a
content table, linked from this page like any other.

The homepage uses the same top-level allowlist as every addressed note. It has
no Foundry document id; a pinned `data.id` has no role on this type.

### type: vehicle

Represents a conveyance able to hold goods and people moving from one place to another.

| `data` property    | Values    | Description                                                              |
| ------------------ | --------- | ------------------------------------------------------------------------ |
| `tokenIcon`        | `Address` | What a token on the canvas wears — an `icon` address; defaults to `icon` |
| `templatePriority` | `number`  | Template priority, _null_ = not a template                               |

If `sohl` is present, this becomes a `vehicle` actor.

It maps nothing beyond the shared rows above, actor row included: a vehicle
carries a template priority and no field of its own.

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

**subType**:

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
rungs are a class one is born or bought into, and a body whose highest posts are
offices one is voted into and then vacates. A republic's ladder therefore carries
**both** standings — the civic status (Citizen) and the standing in the governing
body above it (Senator) — because a citizen is not a member of the Senate, and
conflating the two is the commonest way to get a non-monarchy wrong. The
magistracies held for a term are offices, not rungs.

**Rank**
Definition of a level within the organization (e.g., Priest, Layperson, Member, Gang Leader, Master, etc.)

| Property      | Required | Values    | Description                                                                                                                          |
| ------------- | -------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `level`       | yes      | integer   | The ranking within the affiliation: 0 those it excludes (expelled, excommunicated), 1 its ordinary members, higher values above them |
| `title`       | yes      | string    | Title associated with the Rank                                                                                                       |
| `description` | yes      | string    | Description of the Rank                                                                                                              |
| `lore`        | no       | `Address` | The standing this rank _is_ — a `lore` note of subType `law`, shared with every other body that confers the same thing               |

**`level`, `title` and `description` together are a complete statement of a
rung**, and nothing further is required for a ladder to be correct. Each is an
**error** when it is missing or empty, and a `level` that is not a whole number
is an error too: the ladder is what a member's `rank` indexes into, so a rung
with no title makes a standing that resolves to nothing, and one with no
description ships a rung that says nothing on a sheet or a page. A rung accepts
only these four keys, and each problem on a rung is reported separately, so a
ladder with three is fixed in one pass rather than three builds.

**A level belongs to one rung.** Two rungs claiming one level is an **error** on
the second, naming the first, because the ladder is read by level: a member whose
`rank` is that level answers to whichever rung is written higher in the file, and
moving two lines renames the standing. A body that confers two titles at one
standing writes them as one rung — `title: Knight or Dame` — or gives each its
own level.

**Every ladder has rung 0 and rung 1.** Level 1 is the ordinary member, and level
0 names those the body excludes. A body that can name its members can name those
it shuts out, whether or not it ever does, so an affiliation whose
`governance.ranks` lacks either is an **error** at the `ranks` key, as is one
with no ladder at all. The level-0 title is the body's own word for the excluded
— Outlaw, Apostate, Níðing — never a generic "Excluded".

Those two rungs are the minimum. Add rungs above level 1 only where the body
truly has them, generally no more than five. **A rung is a standing, what a member
is; an office is a post, what a member does.** Leadership is normally an office
held by the top rank rather than a rank above it, and a rank never falls when an
office is left: a bishop stays a bishop after being Presiding Bishop.

```yaml
data:
  governance:
    ranks:
      - { level: 0, title: Apostate, description: Put out of the communion. }
      - { level: 1, title: Layman, description: A baptised member of the faith. }
      - { level: 2, title: Priest, description: Ordained to serve a parish. }
      - { level: 3, title: Bishop, description: Consecrated to oversee a diocese. }
    offices:
      Presiding Bishop: Chairs the synod of bishops for a term.
```

```yaml
data:
  governance:
    ranks:
      - { level: 0, title: Vrystrith, description: Kinless and owed nothing. }
      - { level: 1, title: Kinsman, description: Born or adopted into a household. }
      - { level: 4, title: Fródrád, description: A householder whose word carries. }
      - level: 5
        title: Hárár
        description: First among them, by the assent of the householders.
        lore: lore-harar-standing
```

**Reach for `lore` only where the standing needs more said about it than a
description can hold** — obligations, rights, what it takes to enter it, what
ends it. Most rungs do not: a description that states what the standing is has
already said the whole of it, and a note that restates the rung it hangs off
costs a reader a click and tells them nothing.

**A rank's `lore` is shared; its `title` is not.** A Normen kingdom calls it
`Thrall` and a Vylarian province calls it `Slave`, and they mean one standing:
owned outright, with no standing at law except through an owner. The title is
what this body calls it and the description is how this body puts it, but the
obligations and rights belong to the standing itself, so they are written once
and cited by every ladder that confers it.

That is also what makes a rank answerable across bodies. Without it, asking what
a `Naukrátissa` may do means reading the Bethûan fleet's ladder; with it, the
rank names the standing, and the standing says.

**Standing**: aligned, unaligned, rival, nemesis

| `data` property                                 | Values                                                                    | Description                                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `templatePriority`                              | `number`                                                                  | Template priority, _null_ = not a template                                                                                            |
| `events`                                        | event entries — see [Events](#events)                                     | What happened to or at this subject: dated, attributed events                                                                         |
| `demonym`                                       | `string`                                                                  | What a member of this affiliation is called (a Vylarian)                                                                              |
| `epithet`                                       | `string`                                                                  | The by-name it is known by — a god's, an order's, a company's                                                                         |
| `symbol`                                        | `string`                                                                  | Its emblem in words: a feather atop a golden scale, a chisel carving a star                                                           |
| `governance.model`                              | `GovernanceModel`                                                         | Type of government structure, if applicable                                                                                           |
| `governance.summary`                            | `string`                                                                  | summary of the governance situation                                                                                                   |
| `governance.ranks`                              | `Rank[]`                                                                  | The ranks the affiliation confers; level 0 and level 1 are required                                                                   |
| `governance.ranks[].level`                      | `integer`, required                                                       | The rung's position on this body's ladder; a member's `rank` names it                                                                 |
| `governance.ranks[].title`                      | `string`, required                                                        | What the standing is called                                                                                                           |
| `governance.ranks[].description`                | `string`, required                                                        | What the standing is                                                                                                                  |
| `governance.ranks[].lore`                       | `Address`                                                                 | The `law` lore note stating what the standing is, shared with every body that confers it                                              |
| `governance.offices`                            | `Map<name, description \| {description, holders}>`                        | Official offices and their dated holders                                                                                              |
| `governance.offices.<name>`                     | `string` or `{ description, holders }`                                    | One office, keyed by its name: its description, or a map of description and holders                                                   |
| `governance.offices.<name>.description`         | `string`, required                                                        | What the office is                                                                                                                    |
| `governance.offices.<name>.holders`             | `{ being, start?, end?, contested? }[]`, required                         | Who has held the office, each with the dates of the term                                                                              |
| `governance.offices.<name>.holders[].being`     | `Address`, required                                                       | The `being` who held it                                                                                                               |
| `governance.offices.<name>.holders[].start`     | `date`                                                                    | When the term began; omitted, it began before anything recorded                                                                       |
| `governance.offices.<name>.holders[].end`       | `date`                                                                    | When the term ended; omitted, the being holds the office now                                                                          |
| `governance.offices.<name>.holders[].contested` | `boolean`                                                                 | `true` where the term may overlap another holder's                                                                                    |
| `seat`                                          | `Address`                                                                 | Where the affiliation's authority sits                                                                                                |
| `population`                                    | `number`                                                                  | Number of people in the affiliation (precision 2 significant digits).                                                                 |
| `economy`                                       | `Address[]`                                                               | Economic life: `affiliation` or `lore` Addresses, with an explicit type and no default                                                |
| `lore`                                          | `Address[]`                                                               | Lore concerning it — the peoples it draws on, the god a faith venerates, its law, its calendar                                        |
| `parents`                                       | `Address[]`                                                               | Affiliations that this affiliation is subordinate to                                                                                  |
| `culture`                                       | `Address`                                                                 | The people this affiliation belongs to, naming a lore note with `subType: culture`                                                    |
| `language`                                      | `Address`                                                                 | The trade, temple or order tongue it keeps, naming a skill note with `subType: language`                                              |
| `glossary`                                      | `{ name, name_sort?, common?, definition?, pronunciation?, language? }[]` | Its own glossary terms — see [glossary terms](#glossary-terms)                                                                        |
| `glossary[].name`                               | `string`, required                                                        | The headword                                                                                                                          |
| `glossary[].name_sort`                          | `string`                                                                  | Its sort key; the matching word's, else the name, when unstated                                                                       |
| `glossary[].common`                             | `boolean`                                                                 | `true` for a term in this owner's core vocabulary; `false` when unstated                                                              |
| `glossary[].definition`                         | `string`                                                                  | Its context meaning or own gloss; unstated, a matching dictionary word supplies its senses                                            |
| `glossary[].pronunciation`                      | `string`                                                                  | A respelling, as `sol-MEH-reh`: letters, apostrophes and hyphens, at most one syllable in capitals                                    |
| `glossary[].language`                           | `Address`                                                                 | The language the term is in, naming a skill note with `subType: language`; unstated, the affiliation's, its parents' or its culture's |
| `relations`                                     | `Map<Address, Standing>`                                                  | Standing with other affiliations, keyed by the other body's Address                                                                   |
| `relations.<Address>`                           | `aligned`, `unaligned`, `rival` or `nemesis`                              | The standing this body holds toward that one; any other value is an error at the value                                                |

**An affiliation names the people it belongs to in `data.culture`.** An
affiliation that names none takes its culture from its `data.parents`. A
`polity` that still has none takes the culture of its places: its `data.seat`
together with every place whose `data.government` names it. See
[Culture in the index](#culture-in-the-index).

**An affiliation may keep a tongue of its own.** A trade cant, a temple
language or an order's tongue is named in the affiliation's `data.language`, and
it supplies the language of the affiliation's own
[glossary terms](#glossary-terms) where an entry names none. A culture can
select a word of that tongue for its own glossary by naming the language on
the entry. In a tree that holds at least one culture note, an
affiliation that reaches no culture — naming none, inheriting none through
`data.parents`, and, for a `polity`, taking none from its places — is a warning
at its `type:` line, because its ranks and offices have no culture associations
for term queries.

A language needs no culture and no affiliation. A dead language, or one kept
only by a church, is a language note like any other, and nothing requires a
culture or an affiliation to name it.

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
and a member's rank is an index into it. Level 0 is the excluded — outlawed,
expelled, excommunicated — which is a standing the organisation still
recognises, and so every ladder defines it beside level 1.

**Offices are named, not ranked.** A Chancellor and a Marshal are both great
officers and neither is above the other, so an office is a key with a
description rather than a rung — and a being may hold an office at any rank, or a
rank with no office at all. The head of a body is usually an office of this kind,
held by a member of the top rank, who keeps that rank when the term ends.

An office may remain a string description or declare a `description` and a
`holders` list. Each holder names a `being` Address; optional `start` and `end`
use the date forms above. Omit `end` for a current holder. Set `contested: true`
when a holder's term may overlap another's. The build checks addresses, term
order, and unmarked overlaps. A being with any `died` value, including
`unknown`, cannot be named as a current holder. Office entries accept only
`description` and `holders`; holder rows accept only `being`, `start`, `end`,
and `contested`.

```yaml
data:
  governance:
    offices:
      Chancellor:
        description: Keeps the seal.
        holders:
          - being: being-aran
            start: "datefrom vrcal 14 Vulcar 720 VR"
            end: "datefrom vrcal 1 Lusenar 725 VR"
          - { being: being-mara, start: "datefrom vrcal 2 Lusenar 725 VR" }
```

**Governed places are derived from place notes.** Each place names one governing affiliation in `data.government`. The affiliation's **Governed places** [generated section](#generated-sections) lists the places whose explicit references resolve to it, across local notes and fetched indexes, grouped by kind; with none, it has no such section. No affiliation-side list supplies government, and neither geographic containment nor organizational parents expands it.

If `sohl` is present, this becomes an `affiliation` item.

| shared source    | → sohl             | → hm3 |
| ---------------- | ------------------ | ----- |
| `subType`        | `system.subType`   | NA    |
| `data.seat`      | `system.seat`      | NA    |
| `data.parents`   | `system.parents`   | NA    |
| `data.relations` | `system.relations` | NA    |

An affiliation writes SoHL common skills under `sohl.system.commonSkills` as a
list of skill Addresses. An abbreviated value names a skill in the authoring
package; a skill in the SoHL system package uses its complete Address:

```yaml
sohl:
  system:
    commonSkills:
      - herb
      - sohl-sohl-skill-law
```

The compiled SoHL Item stores the exact published Item UUIDs in
`system.commonSkills`. An empty or absent list emits `[]`. A foreign target must
come from a declared `relationships.systems` or `relationships.requires` content
index. Each UUID uses the module and pack named by that target's published index;
a missing skill Item or Item UUID is an error at the authored Address. The
content index retains complete Addresses. Journal, web and book infoboxes link
to a skill's published documentation journal when one exists and otherwise show
its name as plain text.

`governance` reaches no system field. Ranks and offices are the note's and the
web page's — SoHL's affiliation item has nowhere to put them, and inventing a
mapping for a field no schema declares is the drift these tables exist to catch.
`system.society`, `system.office`, `system.title` and `system.level` are
likewise absent here: they are filled on an embedded membership, never from a
catalogue note's `data:`.

**`system.title` is the style of address the office carries**, Ajaw or Warden,
which a being holds by virtue of its rank. The note's page heading reads
`name.full`. Author the style of address on the membership — the `system.title`
of the entry in a being's `sohl.items` — or, on a catalogue note that carries
one, at `sohl.system.title`.

### type: affliction

Represents an affliction.

**subType**:

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
| `onsetDurationBase`           | `number`            | That duration in seconds, stated outright instead of rolled                               |
| `healingCheckDurationFormula` | `RollFormula`       | Formula to calculate duration until next healing check (measured from last healing check) |
| `healingCheckDurationBase`    | `number`            | That duration in seconds, stated outright instead of rolled                               |
| `resolutionDurationFormula`   | `RollFormula`       | Formula to calculate duration after onset to resolution                                   |
| `resolutionDurationBase`      | `number`            | That duration in seconds, stated outright instead of rolled                               |

If `sohl` is present, this becomes an `affliction` item.

| shared source                      | → sohl                               | → hm3 |
| ---------------------------------- | ------------------------------------ | ----- |
| `subType`                          | `system.subType`                     | NA    |
| `data.transmission`                | `system.transmission`                | NA    |
| `data.outcome`                     | `system.outcome`                     | NA    |
| `data.contagionIndex`              | `system.contagionIndexBase`          | NA    |
| `data.outcomeTraumas`              | `system.outcomeTraumas`              | NA    |
| `data.onsetDurationFormula`        | `system.onsetDurationFormula`        | NA    |
| `data.onsetDurationBase`           | `system.onsetDurationBase`           | NA    |
| `data.healingCheckDurationFormula` | `system.healingCheckDurationFormula` | NA    |
| `data.healingCheckDurationBase`    | `system.healingCheckDurationBase`    | NA    |
| `data.resolutionDurationFormula`   | `system.resolutionDurationFormula`   | NA    |
| `data.resolutionDurationBase`      | `system.resolutionDurationBase`      | NA    |

**A timed phase is a triplet, and a note writes two thirds of it.** SoHL stores
each phase as `{…DurationFormula, …DurationBase, …Date}`, and the three are
authored differently:

| third              | who writes it | what it says                                             |
| ------------------ | ------------- | -------------------------------------------------------- |
| `…DurationFormula` | the note      | what is **rolled** to get the interval                   |
| `…DurationBase`    | the note      | the interval **outright**, in seconds, instead of a roll |
| `…Date`            | play          | _when the phase actually fired_                          |

Write the **formula** for a phase whose length varies — `"2d6*86400"` for an
incubation of two-to-twelve days — and the **base** for one that does not. Both
are intervals in **seconds**, and a bare number is a valid formula, so
`onsetDurationFormula: 86400` and `onsetDurationBase: 86400` differ only in
whether a roll is attempted.

**Omitting either omits the key**, rather than writing a default over it. That
matters because the data model's own `null` is what several phases fall back on:
a trauma that sets no `healingCheckDuration*` takes the world's configured
healing-check interval, and one that sets no `bloodLossAdvanceDurationBase` does
not bleed at all. A compile-time `null` is still a value, and would answer those
questions for every note in every world.

**The `…Date` third is never authored.** It records when the phase fired, which
only play can know, so `system.contractDate`, `system.onsetDate`,
`system.treatmentDate` and `system.resolutionDate` are runtime state and a note
that writes one fails the build. They are world times, and `0` is a valid one,
so there is no blank a note could write either; leave them out and the data
model's `null` stands.

`data.healingRate` is page data. SoHL reads an affliction's base healing rate
from `sohl.healingRateBase`. `data.outcomeTraumas` supplies the SoHL expression
for traumas produced by the affliction's outcome. The optional
`sohl.onsetMacroUuid` names a macro run when symptoms begin.

### type: armorgear

Note: `data.quantity` may not be specified. Quantity is always 1.

| `data` property    | Values           | Description                                                                   |
| ------------------ | ---------------- | ----------------------------------------------------------------------------- |
| `templatePriority` | `number`         | Template priority, _null_ = not a template                                    |
| `weight`           | `number`         | Gear weight                                                                   |
| `value`            | `number`         | Gear value                                                                    |
| `quality`          | `number`         | Gear quality                                                                  |
| `durability`       | `number`         | Gear durability                                                               |
| `made`             | an event Address | The event in which it was made — `lore-forging`, or `place-ironfells#raising` |
| `lost`             | an event Address | The event in which it was lost — `lore-flood`, or `place-ironfells#sack`      |

If a `sohl` property is present, a SoHL item of type "armorgear" is created.

The note type is `armorgear` in both systems.

| shared source     | → sohl                  | → hm3           |
| ----------------- | ----------------------- | --------------- |
| `data.weight`     | `system.weightBase`     | `system.weight` |
| `data.value`      | `system.valueBase`      | `system.value`  |
| `data.quality`    | `system.qualityBase`    | NA              |
| `data.durability` | `system.durabilityBase` | NA              |

Every gear type — `armorgear`, `concoctiongear`, `containergear`, `miscgear`,
`projectilegear` and `weapongear` — may name the events of the thing's history:
`made`, the event in which it was made, and `lost`, the event in which it was
lost. Each is an Address of exactly one [event](#events): `note#id`, or a note
holding one event. A bare shortcode is read as a `lore` note, so
`made: forging` is `lore-forging`. Naming a note that holds several events
without an `id`, a note holding none, an anchor the note does not declare, or
a `prose` anchor is an error at that key. Neither reaches a system field, an
infobox row or a page: each is a fact a content table can read.

### type: armorlocation

| `data` property    | Values   | Description                                |
| ------------------ | -------- | ------------------------------------------ |
| `templatePriority` | `number` | Template priority, _null_ = not a template |

if a `hm3` property is present, an HM3 item of type "armorlocation" is created.

| shared source | → sohl | → hm3 |
| ------------- | ------ | ----- |
| `notes`       | NA     | NA    |

### type: attribute

| `data` property    | Values   | Description                                |
| ------------------ | -------- | ------------------------------------------ |
| `templatePriority` | `number` | Template priority, _null_ = not a template |

if a `sohl` property is present, a SoHL item of type "attribute" is created.

| shared source | → sohl | → hm3 |
| ------------- | ------ | ----- |

### type: concoctiongear

**subType**:

- mundane: ordinary and common in everyday use, generally simple in composition (often a single dried or otherwise prepared ingredient)
- exotic: A complex and valuable concoction, often a mixture of different herbs and/or chemicals, with medicinal or other unique properties or effects, but not magical in nature.
- elixir: An arcane alchemical concoction of great power.

| `data` property    | Values                          | Description                                                                   |
| ------------------ | ------------------------------- | ----------------------------------------------------------------------------- |
| `templatePriority` | `number`                        | Template priority, _null_ = not a template                                    |
| `weight`           | `number`                        | Gear weight                                                                   |
| `value`            | `number`                        | Gear value                                                                    |
| `quality`          | `number`                        | Gear quality                                                                  |
| `durability`       | `number`                        | Gear durability                                                               |
| `made`             | an event Address                | The event in which it was made — `lore-forging`, or `place-ironfells#raising` |
| `lost`             | an event Address                | The event in which it was lost — `lore-flood`, or `place-ironfells#sack`      |
| `quantity`         | `number`                        | Gear quantity (default: 1)                                                    |
| `potency`          | `na \| mild \| strong \| great` | Concoction Potency (mundane/exotic concoctions)                               |
| `strength`         | `number`                        | Strength: higher the number, greater the strength                             |

if a `sohl` property is present, a SoHL item of type "concoctiongear" is created.

| shared source     | → sohl                  | → hm3 |
| ----------------- | ----------------------- | ----- |
| `subType`         | `system.subType`        | NA    |
| `data.weight`     | `system.weightBase`     | NA    |
| `data.value`      | `system.valueBase`      | NA    |
| `data.quality`    | `system.qualityBase`    | NA    |
| `data.durability` | `system.durabilityBase` | NA    |

`data.quantity` is page data for a concoction. SoHL sets `system.quantity` to
`1` for each compendium item.

### type: containergear

Note: `data.quantity` may not be specified; quantity is always set to 1.

| `data` property    | Values           | Description                                                                   |
| ------------------ | ---------------- | ----------------------------------------------------------------------------- |
| `templatePriority` | `number`         | Template priority, _null_ = not a template                                    |
| `weight`           | `number`         | Gear weight                                                                   |
| `value`            | `number`         | Gear value                                                                    |
| `quality`          | `number`         | Gear quality                                                                  |
| `durability`       | `number`         | Gear durability                                                               |
| `made`             | an event Address | The event in which it was made — `lore-forging`, or `place-ironfells#raising` |
| `lost`             | an event Address | The event in which it was lost — `lore-flood`, or `place-ironfells#sack`      |
| `capacity`         | `number`         | HM3 container capacity (in lbs)                                               |

if a `sohl` property is present, a SoHL item of type "containergear" is created.

if a `hm3` property is present, an HM3 item of type "containergear" is created.

| shared source     | → sohl                  | → hm3                 |
| ----------------- | ----------------------- | --------------------- |
| `data.weight`     | `system.weightBase`     | `system.weight`       |
| `data.value`      | `system.valueBase`      | `system.value`        |
| `data.quality`    | `system.qualityBase`    | NA                    |
| `data.durability` | `system.durabilityBase` | NA                    |
| `data.capacity`   | NA                      | `system.capacity.max` |

SoHL reads a container’s capacity in pounds from `sohl.maxCapacity`.

### type: miscgear

| `data` property    | Values           | Description                                                                   |
| ------------------ | ---------------- | ----------------------------------------------------------------------------- |
| `templatePriority` | `number`         | Template priority, _null_ = not a template                                    |
| `weight`           | `number`         | Gear weight                                                                   |
| `value`            | `number`         | Gear value                                                                    |
| `quality`          | `number`         | Gear quality                                                                  |
| `durability`       | `number`         | Gear durability                                                               |
| `made`             | an event Address | The event in which it was made — `lore-forging`, or `place-ironfells#raising` |
| `lost`             | an event Address | The event in which it was lost — `lore-flood`, or `place-ironfells#sack`      |
| `quantity`         | `number`         | HM3 gear quantity (default: 1)                                                |

if a `sohl` property is present, a SoHL item of type "miscgear" is created.

if a `hm3` property is present, an HM3 item of type "miscgear" is created.

| shared source     | → sohl                  | → hm3             |
| ----------------- | ----------------------- | ----------------- |
| `data.weight`     | `system.weightBase`     | `system.weight`   |
| `data.value`      | `system.valueBase`      | `system.value`    |
| `data.quality`    | `system.qualityBase`    | NA                |
| `data.durability` | `system.durabilityBase` | NA                |
| `data.quantity`   | NA                      | `system.quantity` |

SoHL sets `system.quantity` to `1` for each compendium item.

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

| `data` property    | Values                                                                             | Description                                                    |
| ------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `templatePriority` | `number`                                                                           | Template priority, _null_ = not a template                     |
| `assocSkill`       | `Address`                                                                          | Associated skill                                               |
| `assocAffiliation` | `Address`                                                                          | Associated affiliation                                         |
| `skillAptitudes`   | `Map<Shortcode, number>`, the key a skill's shortcode or `subType:<skill-subtype>` | Bonuses and penalties, per skill or per kind of skill          |
| `level`            | `number`                                                                           | Magnitude of the mystery                                       |
| `charges.value`    | `number`                                                                           | Current number of charges available, _null_ = charges not used |
| `charges.max`      | `number`                                                                           | Maximum number of charges, _null_ = no maximum                 |

if a `sohl` property is present, a SoHL item of type "mystery" is created.

`system.assocSkillCode` and `system.assocAffiliationCode` are authored under
`sohl.system` as shortcodes and have no shared source; `data.assocSkill` and
`data.assocAffiliation` name the same two notes as Addresses, for the page.

| shared source         | → sohl                  | → hm3 |
| --------------------- | ----------------------- | ----- |
| `subType`             | `system.subType`        | NA    |
| `data.skillAptitudes` | `system.skillAptitudes` | NA    |
| `data.charges.value`  | `system.charges.value`  | NA    |
| `data.charges.max`    | `system.charges.max`    | NA    |

`data.level` is page data for a mystery. SoHL reads the item’s level from
`sohl.levelBase`.

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

| `data` property    | Values    | Description                                                    |
| ------------------ | --------- | -------------------------------------------------------------- |
| `templatePriority` | `number`  | Template priority, _null_ = not a template                     |
| `assocSkill`       | `Address` | Associated skill                                               |
| `assocAffiliation` | `Address` | Associated affiliation                                         |
| `masteryLevel`     | `number`  | Mastery Level                                                  |
| `level`            | `number`  | Magnitude of the mystery                                       |
| `charges.value`    | `number`  | Current number of charges available, _null_ = charges not used |
| `charges.max`      | `number`  | Maximum number of charges, _null_ = no maximum                 |

if a `sohl` property is present, a SoHL item of type "mysticalability" is created.

If an `hm3` property is present, an HM3 item is created, and `hm3.type` states which — `psionic`, `spell` or `invocation`. It is **authored, not derived from `subType`**: the ten mystical-ability subtypes do not partition onto HM3's three documents (a `spiritrite`, an `alchemy` and a `divination` each answer to none of them), so a derivation would be a guess with a plausible shape. A note that omits it is an error naming the note.

`system.assocSkillCode` and `system.assocAffiliationCode` are authored under
`sohl.system` as shortcodes and have no shared source; `data.assocSkill` and
`data.assocAffiliation` name the same two notes as Addresses, for the page.

| shared source        | → sohl                 | → hm3         |
| -------------------- | ---------------------- | ------------- |
| `subType`            | `system.subType`       | **see above** |
| `data.charges.value` | `system.charges.value` | NA            |
| `data.charges.max`   | `system.charges.max`   | NA            |

`data.masteryLevel` and `data.level` are page data for an ability. SoHL reads
the item’s base mastery and level from `sohl.masteryLevelBase` and
`sohl.levelBase`.

### type: projectilegear

**subType**:

- none
- arrow
- bolt
- bullet
- dart
- other

| `data` property    | Values           | Description                                                                   |
| ------------------ | ---------------- | ----------------------------------------------------------------------------- |
| `templatePriority` | `number`         | Template priority, _null_ = not a template                                    |
| `weight`           | `number`         | Gear weight                                                                   |
| `value`            | `number`         | Gear value                                                                    |
| `quality`          | `number`         | Gear quality                                                                  |
| `durability`       | `number`         | Gear durability                                                               |
| `made`             | an event Address | The event in which it was made — `lore-forging`, or `place-ironfells#raising` |
| `lost`             | an event Address | The event in which it was lost — `lore-flood`, or `place-ironfells#sack`      |
| `quantity`         | `number`         | HM3 gear quantity (default: 1)                                                |

if a `sohl` property is present, a SoHL item of type "projectilegear" is created.

If an `hm3` property is present, an HM3 item of type "missilegear" is created.

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
| `data.quantity`   | NA                      | `system.quantity` |

SoHL sets `system.quantity` to `1` for each compendium item.

### type: skill

**subType**:

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

| `data` property                            | Values                                                                                                                         | Description                                                                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `templatePriority`                         | `number`                                                                                                                       | Template priority, _null_ = not a template                                                                                                                                           |
| `masteryLevel`                             | `number`                                                                                                                       | HM3 mastery level                                                                                                                                                                    |
| `parentSkill`                              | `Address`                                                                                                                      | Parent skill this skill specializes                                                                                                                                                  |
| `names`                                    | `{ pattern, given, <name>... }`                                                                                                | `language` only: how its speakers are named, for `package-build npc new` — see [name lists](#name-lists)                                                                             |
| `names.pattern`                            | `string`, `string[]` or map of `gender` words to either, required                                                              | Placeholders such as `{given}`, `{given.male}` and `{clan}`, each naming a list, with literal text around them; a list states several forms, a map each gender's forms               |
| `names.given`                              | map of `gender` words to lists of names, required                                                                              | Given names by gender; `female` and `male` are required                                                                                                                              |
| `names.given.<name>`                       | `string[]`                                                                                                                     | The given names of one gender                                                                                                                                                        |
| `names.<name>`                             | `string[]`                                                                                                                     | A list the placeholder of the same name draws from                                                                                                                                   |
| `family`                                   | `Address`                                                                                                                      | `language` only: the parent language, naming a skill note with `subType: language`; this language reads the parent's words as its own — see [a language's words](#a-languages-words) |
| `abbreviation`                             | `string`                                                                                                                       | `language` only: the tag a dictionary prints for it, as `Prov.`; its full name where unstated — see [dictionaries and glossaries](#dictionaries-and-glossaries)                      |
| `grammar`                                  | `{ plural?, verbs? }`                                                                                                          | Optional dictionary noun plurals and one verb pattern; supplied shapes only are checked                                                                                              |
| `grammar.plural`                           | `{ ending, becomes }[]`                                                                                                        | Literal suffix replacements in authored order; the first match wins                                                                                                                  |
| `grammar.plural[].ending`                  | `string`, required, may be empty                                                                                               | Bare suffix to replace; empty matches every noun                                                                                                                                     |
| `grammar.plural[].becomes`                 | `string`, required, may be empty                                                                                               | Bare replacement; empty deletes the matching suffix                                                                                                                                  |
| `grammar.verbs`                            | `{ invariant: true }` or `{ persons: { I, you, heShe, we, youAll, they } }`                                                    | One regular present pattern, printed once at the dictionary head                                                                                                                     |
| `grammar.verbs.invariant`                  | `true`                                                                                                                         | Verbs do not change; excludes `persons`                                                                                                                                              |
| `grammar.verbs.persons`                    | a map of all six ending strings                                                                                                | Each ending is added to the citation form; excludes `invariant`                                                                                                                      |
| `grammar.verbs.persons.I`                  | `string`, required, may be empty                                                                                               | Ending for I                                                                                                                                                                         |
| `grammar.verbs.persons.you`                | `string`, required, may be empty                                                                                               | Ending for you                                                                                                                                                                       |
| `grammar.verbs.persons.heShe`              | `string`, required, may be empty                                                                                               | Ending for he/she                                                                                                                                                                    |
| `grammar.verbs.persons.we`                 | `string`, required, may be empty                                                                                               | Ending for we                                                                                                                                                                        |
| `grammar.verbs.persons.youAll`             | `string`, required, may be empty                                                                                               | Ending for you all                                                                                                                                                                   |
| `grammar.verbs.persons.they`               | `string`, required, may be empty                                                                                               | Ending for they                                                                                                                                                                      |
| `classModifiers`                           | `string[]`                                                                                                                     | `language` only: the word class modifiers the language uses, each from the [master word classes](#word-classes); empty when unstated                                                 |
| `fields`                                   | `{ name, holds }[]`                                                                                                            | `language` only: the fields its words are grouped under                                                                                                                              |
| `fields[].name`                            | `string`, required                                                                                                             | The field's name, which a word's `field` names                                                                                                                                       |
| `fields[].holds`                           | `string`, required                                                                                                             | What the field holds                                                                                                                                                                 |
| `words`                                    | `{ form, class, field, gloss, … }[]`                                                                                           | `language` only: its words in authored order; its automatic dictionary sorts them alphabetically — see [a language's words](#a-languages-words)                                      |
| `words[].form`                             | `string`, required                                                                                                             | The word as cited, bare: no backticks                                                                                                                                                |
| `words[].variants`                         | `string[]`                                                                                                                     | Its other forms, as a short form beside a long one; a marked use of one cites the word                                                                                               |
| `words[].name_sort`                        | `string`                                                                                                                       | Its sort key; the form when unstated                                                                                                                                                 |
| `words[].class`                            | `string`, required                                                                                                             | A class from the master word classes, base first: `n I f`                                                                                                                            |
| `words[].plural`                           | `string`                                                                                                                       | Optional explicit noun plural; the dictionary uses it before the language rule                                                                                                       |
| `words[].field`                            | `string`, required                                                                                                             | One of the note's `fields` names                                                                                                                                                     |
| `words[].gloss`                            | `string` or `string[]`, required                                                                                               | The meaning, in brief; a list states one sense per entry, which a dictionary numbers                                                                                                 |
| `words[].source`                           | `{ kind, language?, form? }`                                                                                                   | Where the word comes from                                                                                                                                                            |
| `words[].source.kind`                      | `inherited`, `borrowed`, `kept`, `worn`, `coined`, `substrate` or `island`, required                                           | How the word came into the language                                                                                                                                                  |
| `words[].source.language`                  | `Address`                                                                                                                      | The language a `borrowed` word came from, naming a skill note with `subType: language`; required for `borrowed`                                                                      |
| `words[].source.form`                      | `string`                                                                                                                       | The form the word had in its source, bare                                                                                                                                            |
| `words[].built`                            | `string[]`                                                                                                                     | The pieces the word is built from, in order, as the note's words and affixes write them; absent for a root word                                                                      |
| `words[].note`                             | `string`                                                                                                                       | What a source says of the word beyond its pieces, as a cognate it is read with                                                                                                       |
| `words[].pronunciation`                    | `string`                                                                                                                       | A respelling, as `sol-MEH-reh`: letters, apostrophes and hyphens, at most one syllable in capitals                                                                                   |
| `words[].tones`                            | `string`                                                                                                                       | A tone pattern, as `LHL`                                                                                                                                                             |
| `words[].root`                             | `string`                                                                                                                       | A consonantal skeleton, as `d-l-k`                                                                                                                                                   |
| `words[].frame`                            | `string`                                                                                                                       | The frame a root is set in, named in `sounds.frames` of the language or an ancestor                                                                                                  |
| `affixes`                                  | `{ form?, zero?, kind?, given?, where?, gloss, attaches?, examples?, barredAfter?, tones? }[]`                                 | `language` only: the affixes a word's `built` pieces may name; each states a `form` or `zero: true`                                                                                  |
| `affixes[].form`                           | `string`                                                                                                                       | The affix as a `built` piece names it, as `-rith`; absent on a zero affix                                                                                                            |
| `affixes[].zero`                           | `boolean`                                                                                                                      | The affix is written as nothing, as a case with no ending; it states no `form`, prints as `∅`, and no `built` piece names it                                                         |
| `affixes[].kind`                           | `case`, `derivation`, `tense`, `aspect`, `mood`, `voice`, `name` or `lineage`                                                  | What it makes: a case, a derived word, a verb's tense, aspect, mood or voice, a given name's ending or a lineage name's ending                                                       |
| `affixes[].given`                          | `man`, `woman` or `either`                                                                                                     | Who a given name closing on it belongs to; only on an affix of kind `name`                                                                                                           |
| `affixes[].where`                          | `string`                                                                                                                       | Where this form stands, for an affix written two ways, as `before a stop`; everywhere where absent                                                                                   |
| `affixes[].gloss`                          | `string`, required                                                                                                             | What it means                                                                                                                                                                        |
| `affixes[].attaches`                       | `string`                                                                                                                       | How it attaches, as `replaces a closing vowel`                                                                                                                                       |
| `affixes[].examples`                       | `string[]`                                                                                                                     | The names it is read from                                                                                                                                                            |
| `affixes[].barredAfter`                    | `string[]`                                                                                                                     | The sounds a stem may not close on to take the affix, as `[n]`                                                                                                                       |
| `affixes[].tones`                          | `string`                                                                                                                       | The tone pattern it carries, as `L`                                                                                                                                                  |
| `affixes[].replaces`                       | `string`                                                                                                                       | What it takes the place of at the close of the stem: `vowel` for any closing vowel, or the letters, as `a`; added to the whole stem where absent                                     |
| `affixes[].lengthens`                      | `boolean`                                                                                                                      | Whether the stem's last vowel lengthens before it; `false` where unstated, and never beside `replaces`                                                                               |
| `affixes[].front`                          | `string`                                                                                                                       | Its form after front vowels, where the language keeps vowel harmony, as `-ür`                                                                                                        |
| `tongues`                                  | `{ tag, meaning, language? }[]`                                                                                                | `language` only: the tags a register row's `tongue` names — see [a language's register, sounds and history](#a-languages-register-sounds-and-history)                                |
| `tongues[].tag`                            | `string`, required                                                                                                             | Lowercase letters and digits, as `dunhari`, or a tag closing on `:<tongue>`, as `exonym:<tongue>`, which declares `exonym:vylari` and every tag like it                              |
| `tongues[].meaning`                        | `string`, required                                                                                                             | What a name of this tongue is                                                                                                                                                        |
| `tongues[].language`                       | `Address`                                                                                                                      | The language note the tag names, where it is one                                                                                                                                     |
| `register`                                 | `{ name, tongue?, kind?, built?, why? }[]`                                                                                     | `language` only: every name the setting gives in the language's reach; the notes carrying each are derived                                                                           |
| `register[].name`                          | `string`, required                                                                                                             | The name, as the setting writes it                                                                                                                                                   |
| `register[].tongue`                        | `string`                                                                                                                       | A tag `tongues` declares, or `translation`; a row states a `tongue`, a `kind`, or both                                                                                               |
| `register[].kind`                          | `byname`, `given` or `place`                                                                                                   | What kind of name it is, in a language that sorts its names by kind                                                                                                                  |
| `register[].built`                         | `string[]`                                                                                                                     | The pieces the name is built from, as a word's `built` writes them                                                                                                                   |
| `register[].gloss`                         | `string`                                                                                                                       | What the name means, where the pages give its sense                                                                                                                                  |
| `register[].why`                           | `string`                                                                                                                       | Why the name stands outside the pattern the language's names are built by                                                                                                            |
| `retired`                                  | `{ form, instead?, why }[]`                                                                                                    | `language` only: the forms the setting does not write                                                                                                                                |
| `retired[].form`                           | `string`, required                                                                                                             | The form the setting does not write                                                                                                                                                  |
| `retired[].instead`                        | `string` or `string[]`                                                                                                         | What is written in its place; absent where nothing is                                                                                                                                |
| `retired[].why`                            | `string`, required                                                                                                             | Why the setting does not write it                                                                                                                                                    |
| `scope`                                    | `{ folders?, cultures?, lore?, parents?, addresses?, paths?, types?, skip? }`                                                  | `language` only: the notes the register covers                                                                                                                                       |
| `scope.folders`                            | `Address[]`                                                                                                                    | Every note whose `packFolder` is one of these folders                                                                                                                                |
| `scope.cultures`                           | `Address[]`                                                                                                                    | Every note whose `culture` is one of these cultures                                                                                                                                  |
| `scope.lore`                               | `Address[]`                                                                                                                    | Every note whose `lore` names one of these notes                                                                                                                                     |
| `scope.parents`                            | `Address[]`                                                                                                                    | Every note whose `parents` names one of these notes                                                                                                                                  |
| `scope.addresses`                          | `Address[]`                                                                                                                    | These notes themselves                                                                                                                                                               |
| `scope.paths`                              | `string[]`                                                                                                                     | Every note whose file sits below one of these content paths, as `Regions/Aelwyth/`                                                                                                   |
| `scope.types`                              | `string[]`                                                                                                                     | The note types covered; a note of another type is out of scope whatever else catches it                                                                                              |
| `scope.skip`                               | `Address[]`                                                                                                                    | Notes out of scope whatever else catches them                                                                                                                                        |
| `sounds`                                   | `{ letters?, edges?, clusters?, stress?, finals?, syllables?, joining?, joins?, marks?, skeleton?, frames?, readPast? }`       | `language` only: the letters it writes and the rules its words keep                                                                                                                  |
| `sounds.letters`                           | `{ letters, kind, like?, place?, tongue? }[]`                                                                                  | The letters and the sounds they stand for                                                                                                                                            |
| `sounds.letters[].letters`                 | `string[]`, required                                                                                                           | The letters or digraphs the row describes                                                                                                                                            |
| `sounds.letters[].kind`                    | `string`, required                                                                                                             | What kind of sound they write, as `consonant` or `long vowel`                                                                                                                        |
| `sounds.letters[].like`                    | `string`                                                                                                                       | What they sound like; absent where the row states only their kind and place                                                                                                          |
| `sounds.letters[].place`                   | `string`                                                                                                                       | Where in the mouth they are made, as `lips` or `tongue-tip`                                                                                                                          |
| `sounds.letters[].tongue`                  | `string` or `string[]`                                                                                                         | The tongues that write them, as tags `tongues` declares; every one where absent                                                                                                      |
| `sounds.edges`                             | `{ edge, sounds }[]`                                                                                                           | The sounds that may stand at each edge of a word, one entry per edge                                                                                                                 |
| `sounds.edges[].edge`                      | `openConsonant`, `openCluster`, `closeConsonant`, `closeCluster`, `innerCluster`, `vowelPair`, `glide` or `syllabic`, required | Which edge the sounds stand at                                                                                                                                                       |
| `sounds.edges[].sounds`                    | `string[]` or `any`, required                                                                                                  | The sounds; `any` for every one, an empty list for none                                                                                                                              |
| `sounds.clusters`                          | `{ max, groups? }`                                                                                                             | How many consonants may stand together                                                                                                                                               |
| `sounds.clusters.max`                      | `integer`, required                                                                                                            | The most consonants that stand together inside a word                                                                                                                                |
| `sounds.clusters.groups`                   | `{ what, clusters, use }[]`                                                                                                    | The clusters that may stand inside a word, in groups; a language stating them states no `innerCluster` edge                                                                          |
| `sounds.clusters.groups[].what`            | `string`, required                                                                                                             | What the group's clusters are made of, as `a nasal and a fricative`                                                                                                                  |
| `sounds.clusters.groups[].clusters`        | `string[]`, required                                                                                                           | The clusters, as written; no cluster stands in two groups                                                                                                                            |
| `sounds.clusters.groups[].use`             | `common` or `sparing`, required                                                                                                | How often the group's clusters stand inside a word                                                                                                                                   |
| `sounds.stress`                            | `first syllable`, `penultimate or final`, `by weight` or `as marked`                                                           | Where a word's stress falls                                                                                                                                                          |
| `sounds.finals`                            | `{ final, like }[]`                                                                                                            | The syllable finals, for a language whose syllables are parsed by them                                                                                                               |
| `sounds.finals[].final`                    | `string`, required                                                                                                             | The final, as `ang`                                                                                                                                                                  |
| `sounds.finals[].like`                     | `string`, required                                                                                                             | What it sounds like                                                                                                                                                                  |
| `sounds.syllables`                         | map of syllable rules                                                                                                          | What a syllable and a word may open and close on                                                                                                                                     |
| `sounds.syllables.onsets`                  | `single`                                                                                                                       | What a syllable opens on: a single consonant                                                                                                                                         |
| `sounds.syllables.codas`                   | `string[]` or `any`                                                                                                            | The consonants that may close a syllable                                                                                                                                             |
| `sounds.syllables.finals`                  | `string[]` or `any`                                                                                                            | The consonants that may close a word                                                                                                                                                 |
| `sounds.syllables.doubled`                 | `string[]`                                                                                                                     | The doubled consonants a word may hold; none where empty                                                                                                                             |
| `sounds.syllables.vowelPairs`              | `string[]`                                                                                                                     | The vowels that may stand together; none where empty                                                                                                                                 |
| `sounds.syllables.initialVowel`            | `boolean`                                                                                                                      | Whether a word may open on a vowel                                                                                                                                                   |
| `sounds.syllables.finalVowel`              | `boolean`                                                                                                                      | Whether a word may close on a vowel; `true` where unstated                                                                                                                           |
| `sounds.syllables.neverInitial`            | `string[]`                                                                                                                     | The letters that never open a word                                                                                                                                                   |
| `sounds.syllables.signature`               | `string[]`                                                                                                                     | The letters that mark a word as the language's own                                                                                                                                   |
| `sounds.syllables.harmony`                 | `{ back, front, neutral?, neutralAs?, partners? }`                                                                             | The vowel harmony a word keeps                                                                                                                                                       |
| `sounds.syllables.harmony.back`            | `string[]`, required                                                                                                           | The back vowels                                                                                                                                                                      |
| `sounds.syllables.harmony.front`           | `string[]`, required                                                                                                           | The front vowels                                                                                                                                                                     |
| `sounds.syllables.harmony.neutral`         | `string[]`                                                                                                                     | The vowels of neither set                                                                                                                                                            |
| `sounds.syllables.harmony.neutralAs`       | `back` or `front`                                                                                                              | The set a word of neutral vowels alone counts as                                                                                                                                     |
| `sounds.syllables.harmony.partners`        | map of vowels to front vowels                                                                                                  | The front vowel each vowel turns to in an affix's front form, keyed by the vowel                                                                                                     |
| `sounds.syllables.harmony.partners.<name>` | `string`                                                                                                                       | One vowel's partner, one of the harmony's `front` vowels; the key is a vowel of the harmony                                                                                          |
| `sounds.joining`                           | `{ first, second, written, example? }[]`                                                                                       | How two parts are written where the first closes and the second opens on the given sounds                                                                                            |
| `sounds.joining[].first`                   | `string[]`, required                                                                                                           | The sounds the first part closes on                                                                                                                                                  |
| `sounds.joining[].second`                  | `string[]`, required                                                                                                           | The sounds the second part opens on                                                                                                                                                  |
| `sounds.joining[].written`                 | `string`, required                                                                                                             | What is written where they meet, as `â`; a join closing on `+`, as `y+`, keeps both and sets it between                                                                              |
| `sounds.joining[].example`                 | `string`                                                                                                                       | A word joined so                                                                                                                                                                     |
| `sounds.joins`                             | `{ meeting, rule, letters?, where? }[]`                                                                                        | What happens where two parts of a word meet, one entry per meeting                                                                                                                   |
| `sounds.joins[].meeting`                   | `C+C`, `V+C` or `V+V`, required                                                                                                | Which sounds meet: a consonant or a vowel closing the first part, then opening the second                                                                                            |
| `sounds.joins[].rule`                      | `merge`, `insert`, `drop` or `double`, required                                                                                | What happens: one is written, `letters` are set between, the first is lost, or the consonant is doubled                                                                              |
| `sounds.joins[].letters`                   | `string[]`                                                                                                                     | The letters `insert` sets between or `double` doubles                                                                                                                                |
| `sounds.joins[].where`                     | `string`                                                                                                                       | Where it holds, as `between stems`; everywhere where absent                                                                                                                          |
| `sounds.marks`                             | `{ mark, letters, kind, limit }[]`                                                                                             | The marks the language writes on its letters                                                                                                                                         |
| `sounds.marks[].mark`                      | `string`, required                                                                                                             | The mark's name, as `acute`                                                                                                                                                          |
| `sounds.marks[].letters`                   | `string[]`, required                                                                                                           | The letters that carry it                                                                                                                                                            |
| `sounds.marks[].kind`                      | `stress` or `length`, required                                                                                                 | What it says of its letter                                                                                                                                                           |
| `sounds.marks[].limit`                     | `one` or `any`, required                                                                                                       | How many a word may carry                                                                                                                                                            |
| `sounds.skeleton`                          | `{ second, between? }[]`                                                                                                       | The vowel set between a root's second and third consonants                                                                                                                           |
| `sounds.skeleton[].second`                 | `string[]` or `any`, required                                                                                                  | The second consonants the row holds for; `any` for every other                                                                                                                       |
| `sounds.skeleton[].between`                | `string`                                                                                                                       | The vowel set between; nothing where absent or empty                                                                                                                                 |
| `sounds.frames`                            | `{ frame, shape, class, makes, examples? }[]`                                                                                  | The patterns a root is set in                                                                                                                                                        |
| `sounds.frames[].frame`                    | `string`, required                                                                                                             | The frame's name, which a word's `frame` names                                                                                                                                       |
| `sounds.frames[].shape`                    | `string`, required                                                                                                             | The pattern, the root's consonants numbered, as `K1aK2K3`                                                                                                                            |
| `sounds.frames[].class`                    | `string[]`, required                                                                                                           | The classes of word it makes, each a base of the [master word classes](#word-classes)                                                                                                |
| `sounds.frames[].makes`                    | `string`, required                                                                                                             | What it makes of a root                                                                                                                                                              |
| `sounds.frames[].examples`                 | map of roots to forms                                                                                                          | The form a root takes in the frame, keyed by the root                                                                                                                                |
| `sounds.frames[].examples.<name>`          | `string`                                                                                                                       | One root's form, bare                                                                                                                                                                |
| `sounds.readPast`                          | `{ written, readAs?, what }[]`                                                                                                 | Marks and spellings a word is read through before the sound rules hold it                                                                                                            |
| `sounds.readPast[].written`                | `string`, required                                                                                                             | The mark or spelling the pages write                                                                                                                                                 |
| `sounds.readPast[].readAs`                 | `string`                                                                                                                       | What the word is read with in its place; absent where it is read as nothing                                                                                                          |
| `sounds.readPast[].what`                   | `string`, required                                                                                                             | What the mark or spelling is                                                                                                                                                         |
| `sounds.mutations`                         | `{ mutation, sound, becomes, example? }[]`                                                                                     | The sounds a word changes where a named mutation holds, one entry per sound                                                                                                          |
| `sounds.mutations[].mutation`              | `string`, required                                                                                                             | The mutation's name, as `wearing`; its rows share it                                                                                                                                 |
| `sounds.mutations[].sound`                 | `string`, required                                                                                                             | The sound where the mutation does not hold, as `p`; once per mutation                                                                                                                |
| `sounds.mutations[].becomes`               | `string`, required                                                                                                             | What it becomes where the mutation holds, as `v`                                                                                                                                     |
| `sounds.mutations[].example`               | `string`                                                                                                                       | A word that shows it                                                                                                                                                                 |
| `soundChanges`                             | `{ name, from?, to?, steps }[]`                                                                                                | `language` only: named sets of ordered changes, each making one tongue's words from another's                                                                                        |
| `soundChanges[].name`                      | `string`, required                                                                                                             | The set's name, which no other set of the note shares                                                                                                                                |
| `soundChanges[].from`                      | `Address`                                                                                                                      | The language note whose words the steps start from                                                                                                                                   |
| `soundChanges[].to`                        | `Address`                                                                                                                      | The language note whose words the steps make                                                                                                                                         |
| `soundChanges[].takes`                     | `string`                                                                                                                       | The form of the older word the steps start from, as `accusative`; its citation form where absent                                                                                     |
| `soundChanges[].steps`                     | `{ step, change, where? }[]`, required                                                                                         | The steps, in the order they apply                                                                                                                                                   |
| `soundChanges[].steps[].step`              | `string`, required                                                                                                             | The step's label, as `A1` or `"1"`; no label stands twice in a set                                                                                                                   |
| `soundChanges[].steps[].change`            | `string`, required                                                                                                             | The change in arrow notation, as `` `ph` > `f`; `kh` > `h` ``, or the operation it names in words                                                                                    |
| `soundChanges[].steps[].where`             | `string`                                                                                                                       | Where it holds, as `word end`; everywhere where absent                                                                                                                               |
| `elements`                                 | `{ form, variants?, position?, kind?, sense, examples?, word?, joining? }[]`                                                   | `language` only: the elements its names are built from                                                                                                                               |
| `elements[].form`                          | `string`, required                                                                                                             | The element, as `arn-`                                                                                                                                                               |
| `elements[].variants`                      | `string[]`                                                                                                                     | The element's other forms, as `aldr-` beside `ald-`                                                                                                                                  |
| `elements[].position`                      | `opening`, `closing`, `either` or `link`                                                                                       | Where in a name it stands                                                                                                                                                            |
| `elements[].kind`                          | `byname`, `given` or `place`                                                                                                   | The kind of name it builds, in a language that keeps one set of elements per kind; every kind where absent                                                                           |
| `elements[].sense`                         | `string`, required                                                                                                             | What it means                                                                                                                                                                        |
| `elements[].examples`                      | `string[]`                                                                                                                     | The names it is read from                                                                                                                                                            |
| `elements[].word`                          | `string`                                                                                                                       | The word it is the stem of, a form of `words` of the language or an ancestor                                                                                                         |
| `elements[].joining`                       | `string`                                                                                                                       | The element's joining form, as `-borgar`, when it qualifies another word                                                                                                             |
| `roots`                                    | `{ root, sense, field? }[]`                                                                                                    | `language` only: the consonantal roots its words are set from                                                                                                                        |
| `roots[].root`                             | `string`, required                                                                                                             | The root, as `d-l-k`                                                                                                                                                                 |
| `roots[].sense`                            | `string`, required                                                                                                             | What it means                                                                                                                                                                        |
| `roots[].field`                            | `string`                                                                                                                       | The field it belongs to, as `stone`                                                                                                                                                  |
| `cognates`                                 | `{ forms, proto?, gloss }[]`                                                                                                   | `language` only: sets of forms one older word takes in several languages, stated on the eldest                                                                                       |
| `cognates[].forms`                         | map of language Addresses to forms, required                                                                                   | The form the set takes in each language, keyed by the language note                                                                                                                  |
| `cognates[].forms.<name>`                  | `string`                                                                                                                       | One language's form, bare                                                                                                                                                            |
| `cognates[].gloss`                         | `string`, required                                                                                                             | What the forms mean                                                                                                                                                                  |
| `cognates[].proto`                         | `string`                                                                                                                       | The reconstructed form the set descends from, in no attested language; printed with an asterisk                                                                                      |
| `callingNames`                             | `{ closings, minSyllables }`                                                                                                   | `language` only: the short name a long given name is called by                                                                                                                       |
| `callingNames.closings`                    | `{ form?, doubled?, usual }[]`, required                                                                                       | What a calling name closes on                                                                                                                                                        |
| `callingNames.closings[].form`             | `string`                                                                                                                       | The ending, as `-u`; a row states `form` or `doubled`, never both                                                                                                                    |
| `callingNames.closings[].doubled`          | `boolean`                                                                                                                      | The calling name doubles the first syllable instead of taking an ending                                                                                                              |
| `callingNames.closings[].usual`            | `man`, `woman` or `either`, required                                                                                           | Whose name it usually makes                                                                                                                                                          |
| `callingNames.minSyllables`                | `integer`, required                                                                                                            | The fewest syllables a given name has that the pages give a calling name                                                                                                             |
| `older`                                    | `{ form, gloss?, layer? }[]`                                                                                                   | `language` only: the words and names older than its rules, which no sound or name rule holds                                                                                         |
| `older[].form`                             | `string`, required                                                                                                             | The form as the setting writes it; no form stands twice                                                                                                                              |
| `older[].gloss`                            | `string`                                                                                                                       | What it means                                                                                                                                                                        |
| `older[].layer`                            | `string`                                                                                                                       | The historical layer it belongs to, as `Primordial`                                                                                                                                  |
| `negation`                                 | `{ particle, mutation? }`                                                                                                      | `language` only: how a verb is negated                                                                                                                                               |
| `negation.particle`                        | `string`, required                                                                                                             | The particle that stands before the verb, a form of `words` of the language or an ancestor                                                                                           |
| `negation.mutation`                        | `string`                                                                                                                       | The mutation the negated verb takes, named in `sounds.mutations`                                                                                                                     |
| `naming`                                   | `{ shapes?, edges?, draws?, heldFrom?, nearName? }`                                                                            | `language` only: the shapes, edges and sources its names keep beyond its words' rules                                                                                                |
| `naming.shapes`                            | `{ of, syllables?, perVowel? }[]`                                                                                              | How long each class of name runs                                                                                                                                                     |
| `naming.shapes[].of`                       | `name`, `given`, `clan`, `bound` or `compound`, required                                                                       | The class of name; once per class                                                                                                                                                    |
| `naming.shapes[].syllables`                | `{ min, max }`                                                                                                                 | How many syllables a name of the class runs to                                                                                                                                       |
| `naming.shapes[].syllables.min`            | `integer`, required                                                                                                            | The fewest                                                                                                                                                                           |
| `naming.shapes[].syllables.max`            | `integer`, required                                                                                                            | The most; never below `min`                                                                                                                                                          |
| `naming.shapes[].perVowel`                 | `{ min, max }`                                                                                                                 | How many consonants a name of the class carries to each vowel; a shape states this, `syllables`, or both                                                                             |
| `naming.shapes[].perVowel.min`             | `number`, required                                                                                                             | The fewest                                                                                                                                                                           |
| `naming.shapes[].perVowel.max`             | `number`, required                                                                                                             | The most; never below `min`                                                                                                                                                          |
| `naming.edges`                             | `{ edge, sounds, vowel?, of? }[]`                                                                                              | The sounds a name may open and close on, where names keep edges ordinary words do not                                                                                                |
| `naming.edges[].edge`                      | an `edge` of `sounds.edges`, required                                                                                          | Which edge of a name the sounds stand at; once per class of name                                                                                                                     |
| `naming.edges[].sounds`                    | `string[]` or `any`, required                                                                                                  | The sounds; `any` for every one, an empty list for none                                                                                                                              |
| `naming.edges[].vowel`                     | `boolean`                                                                                                                      | Whether a vowel may stand at the edge too; `false` where unstated                                                                                                                    |
| `naming.edges[].of`                        | `name`, `given`, `clan`, `bound` or `compound`                                                                                 | The class of name the edge holds for; `name`, every name, where absent                                                                                                               |
| `naming.draws`                             | `{ kind, elements }[]`                                                                                                         | The element kinds each kind of name is built from                                                                                                                                    |
| `naming.draws[].kind`                      | `byname`, `given` or `place`, required                                                                                         | The kind of name; once per kind                                                                                                                                                      |
| `naming.draws[].elements`                  | list of `byname`, `given` or `place`, required                                                                                 | The element kinds, as `elements[].kind` states them                                                                                                                                  |
| `naming.heldFrom`                          | `{ source, takes, clip?, joining?, elements? }[]`                                                                              | What a place name takes first, by what the place is held from                                                                                                                        |
| `naming.heldFrom[].source`                 | `string`, required                                                                                                             | What the place is held from, as `a founder`                                                                                                                                          |
| `naming.heldFrom[].takes`                  | `stem`, `godName`, `givenName` or `element`, required                                                                          | What stands first: a name-stem in any grade, a god's name, a founder's given name, or one of `elements`                                                                              |
| `naming.heldFrom[].clip`                   | `first`                                                                                                                        | How the name is clipped: to its first element; whole where absent. A name row only                                                                                                   |
| `naming.heldFrom[].joining`                | `string[]`                                                                                                                     | The joining endings, one of which stands at the seam after the name. A name row only                                                                                                 |
| `naming.heldFrom[].elements`               | `string[]`                                                                                                                     | The elements that may stand first; required on, and only on, a row that takes an `element`                                                                                           |
| `naming.nearName`                          | `{ minSyllables, examples? }`                                                                                                  | The near name a long given name carries                                                                                                                                              |
| `naming.nearName.minSyllables`             | `integer`, required                                                                                                            | The fewest syllables a given name has that carries a near name                                                                                                                       |
| `naming.nearName.examples`                 | `{ near, given }[]`                                                                                                            | Worked near names                                                                                                                                                                    |
| `naming.nearName.examples[].near`          | `string`, required                                                                                                             | The near name                                                                                                                                                                        |
| `naming.nearName.examples[].given`         | `string`, required                                                                                                             | The given name it is the near name of                                                                                                                                                |

#### A language's words

A language note states its words in frontmatter, beside its
[name lists](#name-lists), so every surface reads them from the content index
rather than from a table in the body. Each word is one flow-style line of
`data.words`, and the language of a word is the note it sits on:

```yaml
---
shortcode: provnzlng
name: { full: Provenzal Language }
type: skill
subType: language
data:
  classModifiers: [f, m]
  fields:
    - { name: Love and its conduct, holds: "Longing, courtship and the courts of love." }
  affixes:
    - { form: -ère, gloss: "one who", attaches: replaces a closing vowel }
  words:
    - {
        form: solmère,
        class: n m,
        pronunciation: sol-MEH-reh,
        field: Love and its conduct,
        gloss: "longing; the ache for a person, a place or a time that is gone",
        source: { kind: borrowed, language: skill-elvndrlng, form: sólmerë },
      }
    - {
        form: amère,
        variants: [amèra],
        class: n f,
        field: Love and its conduct,
        gloss: ["a beloved", "a sweetheart, in the songs"],
        built: [am-, -ère],
        note: "read with the Élavendri amarë in the older songs",
      }
---
```

`data.*` never reaches the compiled Item: the Item takes only the `sohl` block,
so a language's words, however many, add nothing to it.

**A class is a base and its modifiers**, from the
[master word classes](#word-classes), separated by spaces: `n I f` is a noun of
class I, feminine. A language declares the modifiers it uses in
`data.classModifiers`, and a word may carry only those.

##### Optional noun and verb forms

A noun may carry gender through its existing class: `n m`, `n f` or `n n`,
printed as _n. m._, _n. f._ or _n. nt._. It may state `plural` where its
plural differs from the language's default. Neither is required.

```yaml
data:
  classModifiers: [m]
  fields:
    - { name: People, holds: People and their everyday words }
  grammar:
    plural:
      - { ending: os, becomes: oi }
    verbs:
      persons: { I: o, you: es, heShe: "", we: om, youAll: et, they: on }
  words:
    - { form: marendos, class: n m, field: People, gloss: an example noun }
```

The dictionary entry begins **marendos** _n. m., pl. marendoi_. An entry's
nonempty explicit `plural` wins; otherwise the first matching
`grammar.plural` replacement supplies its noun plural. Endings are bare,
literal strings: `os` replaces the closing letters, with no regular
expression or hyphen notation. An empty `ending` appends `becomes`; an empty
`becomes` removes the ending. A noun matching no rule prints no plural.
The raw `words` relation retains only the authored `plural`; the
`dictionary` relation carries the displayed one.

`grammar.verbs` is either `{ invariant: true }`, where no verb changes, or
the `persons` map shown above. A supplied `persons` map has all six string
endings, each added to the citation form; `""` leaves that form unchanged.
The dictionary prints the pattern once in a small table before its letter
headings. A custom dictionary's default or `key=true` prints that table even
when no abbreviation key is needed. `key=false` fragments omit both the key
and table; `key=only` prints the abbreviation key alone. Separate results
with their heads enabled each print their own tables.
A language uses only its own stated grammar, including for words
listed from an ancestor; an inherited word retains its explicit plural.
Grammar is not inherited through `family`.

All grammar is optional. Only a supplied key's shape is checked: no language
must supply a pattern, no noun must supply gender or plural, and no word is
checked against a rule or required to provide an exception. There are no
additional cases, tenses, moods or irregular verb forms. With none of these
optional fields, dictionary output is unchanged. Grammar alone does not
create a Dictionary section.

**A word's source** is closed to seven kinds. `borrowed` names the language the
word came from in `language`, a language Address; `inherited`, `kept` and
`worn` give the ancient `form` where the note knows it; `coined`, `substrate`
and `island` give neither. A form is written bare: a renderer supplies its own
italics and its own asterisk.

**`built` names the pieces a word is made of**. Each piece resolves against
words, then affixes, then elements of its language, followed by each ancestor
in `data.family` order. An element matches its `form` or an entry in `variants`
and supplies its `sense` as the gloss. A piece written with different joining
hyphens still matches (`am-` finds the word `am`); an exact spelling is checked
first. An affix also matches its declared front-vowel form, `front`. Case and
accents remain significant.

**A gloss is one sense or a list of them.** A list states one sense per entry,
and a dictionary numbers them: `zethu` glossed `[writing, a scribe]` prints
**1** Writing. **2** A scribe. A list states at least one sense. `variants`
names a word's other forms, as a short form beside its long one, and `note`
says what a source says of the word beyond its pieces.

**A word's citations are derived from the prose of the package's notes.** A
note cites a word when its body marks the word in italics, `_amère_` or
`*amère*`: an italic span holding text alone, no link and no code, whose text
is the word's form or one of its `variants`, compared with diacritics taken off
and case folded, so `_Amere_` cites `amère` too. A note also cites a word its
frontmatter names whole, under the same folding: a full name or an alias that
spells the word, or an affiliation's rank or office title that does. An italic
span or a name that spells no word cites nothing, and neither does a word
found only inside a longer name. A language note never cites its own words,
and its body cites none of the words it describes. The index records each
word's citing notes by Address, and the `attested` column of the `words`
relation and the `usage` of a dictionary entry read them, so a note is listed
beside a word by marking the word where it uses it, or by bearing it as a name
or a title, and by nothing else.

**A daughter language names its parent in `data.family`**, and reads the
parent's words as its own, and the parent's parent's in turn. The words a
family shares sit on the parent's note once; each daughter states only its own:

```yaml
# Skills/Languages/Byzarian.md — a daughter of Helonic
type: skill
subType: language
data:
  family: skill-helonclng
  words:
    - { form: kyma, class: n, field: Sea, gloss: "a wave" }
```

**`data.abbreviation` is the tag a dictionary prints for the language**,
beside an entry's class and in an etymology: `Prov.` for Provenzal. A language
that states none is tagged with its full name. It is stated only on a language
note, and a blank value is an error.

`data.family` is stated only on a language note, and names a language note.
Following it from note to note never returns to where it started: a chain
that does is a cycle, and an error on every note in it.

Each finding is located at the key at fault:

| Finding                                                                | Severity |
| ---------------------------------------------------------------------- | -------- |
| A word key or `data.family` on a skill of another subType, at the key  | error    |
| A `data.family` naming no language note, at the value                  | error    |
| A `data.family` chain that returns to its start, at the value          | error    |
| An unknown, missing or wrongly shaped key in an entry                  | error    |
| A class whose base or modifier is not in the master set                | error    |
| A modifier `data.classModifiers` does not declare                      | error    |
| A declared modifier no word uses, at the modifier                      | warning  |
| A `field` not among `data.fields`                                      | error    |
| A `borrowed` source with no `language`                                 | error    |
| A form standing twice in one language, at the second                   | error    |
| A `gloss` list with no sense                                           | error    |
| A language Address that does not resolve                               | error    |
| A language Address naming something other than a language skill        | error    |
| A pronunciation that is not a respelling                               | error    |
| A `frame` that no `sounds.frames` of the language or an ancestor names | error    |
| A `built` piece no word, affix or element in its lineage glosses       | warning  |

The `words` relation holds one row per word — see
[Content tables](#content-tables) — and a table of them is an `sql` fence over
it. A dictionary reads [the `dictionary` relation](#dictionaries-and-glossaries) instead. A daughter's words with its inherited ones join `words` to
`language_lineage`:

````markdown
```sql
SELECT w.form AS "Form", w.gloss AS "Gloss"
FROM words w JOIN language_lineage l ON w.language = l.ancestor
WHERE l.language = 'thalorna-note-skill-byzarnlng'
ORDER BY w.name_sort
```
````

A single language's own words are a fence over `words` alone:

````markdown
```sql
SELECT form AS "Form", class AS "Class", gloss AS "Gloss", built_text AS "Built from"
FROM words
WHERE language = 'thalorna-note-skill-provnzlng' AND field = 'Love and its conduct'
ORDER BY position
```
````

#### A language's register, sounds and history

A language note states in frontmatter every fact a check reads about its
names, its sounds and its history, beside its words, and each is a relation an
`sql` fence sets back on the page. All of it is optional, and all of it is
stated only on a language note:

```yaml
---
shortcode: dunharlng
name: { full: Dunhari Language }
type: skill
subType: language
data:
  tongues:
    - { tag: dunhari, meaning: a Dunhari name, language: skill-dunharlng }
    - { tag: sovidur, meaning: "a Sovidur name, carried by a wanderer" }
    - { tag: "exonym:<tongue>", meaning: "a name another people gives, in the tongue named" }
  register:
    - { name: Belgogâr, tongue: dunhari, built: [belg-, -ogâr] }
    - { name: Bondsman, tongue: translation }
    - { name: Dunhara, tongue: "exonym:vylari" }
    - { name: Aldous, kind: given, why: "a short name no element builds" }
  retired:
    - { form: Qadi, instead: Vazhmadêr, why: "an Earth word, the judge of a city" }
    - { form: Khalid, instead: [Kheldûn, Bezdûn], why: "an Earth given name" }
  scope:
    folders: [dunhara, amradad]
    cultures: [dunhariclt]
    parents: [dunharargn]
    addresses: [lore-dunhariclt, affiliation-kngdmmrdd]
  sounds:
    letters:
      - { letters: [kh, gh], kind: consonant, like: "a rasp at the back of the throat" }
      - { letters: [â, ê, î, ô, û], kind: long vowel, like: "father, fête, machine, note, boot" }
    edges:
      - { edge: closeConsonant, sounds: [n, r, d, z, sh, kh] }
      - { edge: closeCluster, sounds: [nd, rd] }
      - { edge: vowelPair, sounds: [ai, au, ei] }
    clusters: { max: 2 }
    stress: penultimate or final
    syllables:
      onsets: single
      codas: [b, d, k, sh]
      finals: any
      vowelPairs: [aa, ee]
      initialVowel: true
      harmony: { back: [a, o, u], front: [e, ö, ü], neutral: [i], neutralAs: front }
    joining:
      - { first: [a, â], second: [a, â], written: â, example: "méga + andáhr = mégândáhr" }
    joins:
      - { meeting: V+V, rule: insert, letters: [y] }
    marks:
      - { mark: acute, letters: [á, é, í], kind: stress, limit: one }
    skeleton:
      - { second: [l, r, m, n, s] }
      - { second: any, between: a }
    frames:
      - {
          frame: bare,
          shape: K1aK2K3,
          class: [n],
          makes: the thing itself,
          examples: { d-l-k: dalk },
        }
    readPast:
      - { written: á, readAs: a, what: "the acute, a stress mark" }
    mutations:
      - { mutation: wearing, sound: p, becomes: v, example: "pelvai > velvai" }
      - { mutation: wearing, sound: t, becomes: s }
  soundChanges:
    - name: From Helonic to Byzarian
      from: skill-helonclng
      to: skill-byzarnlng
      takes: nominative
      steps:
        - { step: "1", change: "`th` > `t`", where: anywhere }
        - { step: "2", change: "`dh` > `d`", where: anywhere }
  elements:
    - { form: ald-, variants: [aldr-, aldar-], position: opening, sense: an age }
    - { form: arn-, position: opening, sense: an eagle, examples: [Arnthúl, Arnhelm] }
  roots:
    - { root: d-l-k, sense: "stone; to cut stone", field: stone }
  cognates:
    - { forms: { skill-dunharlng: zevr, skill-sowideslng: zever }, proto: zevrâ, gloss: wind }
  callingNames:
    minSyllables: 4
    closings:
      - { form: -u, usual: man }
      - { doubled: true, usual: either }
  older:
    - { form: Dunharan, gloss: "the people's own name", layer: Primordial }
  negation: { particle: ahi, mutation: wearing }
  naming:
    shapes:
      - { of: given, syllables: { min: 3, max: 4 } }
      - { of: compound, perVowel: { min: 1.0, max: 5.0 } }
    edges:
      - { edge: closeConsonant, sounds: [d, g, k], vowel: true }
      - { edge: closeConsonant, sounds: [kh], of: clan }
    draws:
      - { kind: byname, elements: [byname, place] }
    heldFrom:
      - { source: a god, takes: godName, clip: first }
      - { source: a founder, takes: givenName, joining: ["-s", "-a"] }
      - { source: the ting and its law, takes: element, elements: ["ting-", "lög-"] }
    nearName:
      minSyllables: 4
      examples:
        - { near: Anlâ, given: Anlagherhafu }
---
```

**`tongues` declares the tags a register row may name**, each with what a
name of it is, and `language` where the tag is a language of its own. A tag is
lowercase letters and digits, or closes on `:<tongue>` to declare a family:
`exonym:<tongue>` declares `exonym:vylari`, `exonym:khazari` and every tag like
them. `translation`, a name given in the language of the pages, is accepted
everywhere without being declared.

**`register` lists every name the setting gives in the language's reach**,
with its tongue, its kind (`byname`, `given` or `place`) in a language that
sorts its names so, or both, and, for a name built from the language's words
and affixes, its pieces as a word's `built` writes them; `gloss` says what the
name means where the pages give its sense, and `why` says why a name stands
outside the pattern. Which notes carry a name is not
written: the `register` relation derives it from the index — every note in
`scope` having it as its full name, an alias or a part of its name, every
affiliation in `scope` having it as a rank or office title, and every anchor of
a note in `scope` having it as its name. A folder note carries no name, and a
language that states no `scope` reads every note of the package.

**`retired` lists the forms the setting does not write**, each with what is
written in its place, one form or several, and why. A form nothing replaces
states no `instead`.

**`scope` names the notes the register covers.** A note is in scope when one
of `folders`, `cultures`, `lore`, `parents`, `addresses` or `paths` catches it,
unless `types` is stated and leaves its type out, or `skip` names it.

**`sounds` states the letters and the rules a word keeps.** `letters` gives
each letter or group of letters, the kind of sound it writes, what it sounds
like, where in the mouth it is made and, in a language whose tongues write
differently, the tongues that write it. A row that states only a kind and a
place — one cell of a grid of consonants by manner and place — states no
`like`. `edges` gives the sounds that may stand at each edge of a word, one
entry per edge, the edge from a closed list:

| `edge`           | The sounds that…                                     |
| ---------------- | ---------------------------------------------------- |
| `openConsonant`  | may open a word alone, where not every consonant may |
| `openCluster`    | may open a word together                             |
| `closeConsonant` | may close a word                                     |
| `closeCluster`   | may close a word together                            |
| `innerCluster`   | may stand together inside a word                     |
| `vowelPair`      | are vowels that may stand together                   |
| `glide`          | are glides that may follow a consonant               |
| `syllabic`       | are consonants that may carry a syllable             |

`sounds: any` stands for every sound, and `sounds: []` for none.
`clusters.max` is the most consonants that stand together inside a word, and
`clusters.groups` lists the clusters that may stand there in groups, each with
what its clusters are made of and whether they are `common` or `sparing`. No
cluster stands in two groups, and a language stating groups states no
`innerCluster` edge, since both say which clusters stand inside a word.
`readPast` lists the marks and spellings a word is read through before the
rules hold it, each with what it is read as, or nothing.

The rest of `sounds` states what a language's own rules read, each from a
closed list where its values are words:

- `stress`: `first syllable`, `penultimate or final`, `by weight` or
  `as marked`.
- `finals`: the syllable finals, each with what it sounds like, for a language
  whose syllables are parsed by them.
- `syllables`: what a syllable opens on (`single`, a single consonant), the
  `codas` that close a syllable and the `finals` that close a word (a list, or
  `any`), the `doubled` consonants and `vowelPairs` a word may hold (none where
  empty), whether a word may open or close on a vowel, the letters that never
  open one, the `signature` letters, and the vowel `harmony`: its `back`,
  `front` and `neutral` vowels, the set a word of neutral vowels alone counts
  as, and the `partners` each vowel turns to in an affix's front form, keyed
  by a vowel of the harmony, each partner one of its `front` vowels. A
  language's diphthongs are its `vowelPairs`, each in the harmony set it
  belongs to.
- `joining`: how two parts are written where the first closes and the second
  opens on the given sounds — the one sound that stands for both, or a join
  closing on `+` set between them.
- `joins`: what happens where a consonant or a vowel meets another (`C+C`,
  `V+C`, `V+V`): `merge`, `insert` the `letters` between, `drop` the first, or
  `double` the consonant, everywhere or `where` stated.
- `marks`: the marks written on letters, each saying `stress` or `length`, and
  whether a word carries `one` at most or `any`.
- `skeleton`: the vowel set between a root's second and third consonants, by
  the second consonant; nothing where none is stated.
- `frames`: the patterns a root is set in, each with its shape, the word
  classes it makes, what it makes, and the form each root takes in it.
- `mutations`: the sounds a word changes where a named mutation holds — a stop
  worn to a fricative where a word leans on another, a consonant voiced inside
  a compound, a digraph doubled — one entry per sound, each with what it
  `becomes` and a word that shows it. The rows of one mutation share its
  name, and a sound stands once in each.

**`soundChanges` lists named sets of ordered changes**, each making one
tongue's words from another's: the set's `name`, unique in the note, the
language notes it leads `from` and `to` where they are notes, and its `steps`
in the order they apply — each a `step` label, unique in its set, the `change`
in arrow notation (`` `sources` > `targets` `` rules separated by `;`, or an
operation named in words) and `where` it holds. A step is a string, so a
numbered step is written `"1"`. Two sets may number their steps alike, as a
parent's changes to each daughter do. `takes` names the form of the older word
the steps start from, as `accusative`, where it is not the citation form. A
daughter's table of its parent's daughters is derived: each daughter names
its parent in `data.family` and its inheriting set says what it `takes`.

**`elements` lists what the language's names are built from**: each element's
form and its other forms, where in a name it stands (`opening`, `closing`,
`either` or `link`), its sense and the names it is read from. In a language
that keeps one set of elements for each kind of name, `kind` says which
(`byname`, `given` or `place`). `word` names the word of `words` the element is
the stem of, the language's or an ancestor's, and `joining` gives its form
when it qualifies another word. An element that is also a word stays a word.

**`roots` lists consonantal roots**, each with its sense and the field it
belongs to. **`cognates`** lists, on the eldest language of a set, the form one
older word takes in each language, keyed by the language note, what they mean
and, where it is reconstructed, the `proto` form they descend from, which a
fence prints with an asterisk. A form whose language is no language note is a
finding.

**`callingNames` states the short name a long given name is called by**: its
`closings`, each an ending (`form`) or the first syllable doubled
(`doubled: true`), with whose name it usually makes (`man`, `woman` or
`either`), and `minSyllables`, the fewest syllables a given name has that the
pages give a calling name.

**`older` lists the words and names older than the language's rules**, which
keep shapes the rules do not make and which no sound or name rule holds:
each form once, with what it means and the historical layer it belongs to,
where the pages say. **`negation` states how a verb is negated**: the
`particle` that stands before it, a word of the language or an ancestor, and
the `mutation` the negated verb takes, named in `sounds.mutations`.

**`naming` states what a language's names keep beyond the rules its words
keep.** `shapes` gives how long each class of name runs — `name` for every
name, `given`, `clan`, `bound` for a stem and an ending, `compound` for
elements alone — as a `syllables` range, a `perVowel` range of consonants to
each vowel, or both, each `min` no higher than its `max`. `edges` gives the
sounds a name may open and close on where those are not a word's, from the
same edge list as `sounds.edges`, with `vowel: true` where a vowel may stand
there too and `of` where the edge holds for one class of name only; an edge
stands once for each class. `draws` gives the element kinds each kind of name
is built from. `heldFrom` gives what a place name takes first by what the
place is held from: a name-stem, a god's name, a founder's given name — that
name `clip`ped to its `first` element, or followed by one of its `joining`
endings — or one of the `elements` listed. `nearName` states the fewest
syllables a given name has that carries a near name, with worked examples.

**An affix states its `kind`** — `case`, `derivation`, a verb's `tense`,
`aspect`, `mood` or `voice`, `name` for a given name's ending and `lineage`
for a lineage name's — and an affix of kind `name` states who the name is
`given` to: `man`, `woman` or `either`. `given` on an affix of any other kind,
or of none, is an error. An affix written two ways states each form as an
entry of its own, the conditioned one saying `where` it stands, as
`before a stop`. A zero affix — a case with no ending — states `zero: true` and
no `form`; it prints as `∅`, which the `affixes` relation's `written` column
carries so a fence names no character outside the content charset, and no
`built` piece names it. `barredAfter` lists the sounds a stem may not close on
to take the affix.

**An affix states `replaces`** where it takes the place of the stem's close —
`vowel` for any closing vowel, or the letters, as `a` — and is added to the
whole stem where it states none. An affix states `lengthens: true` where the
stem's last vowel lengthens before it, and never beside `replaces`. A language
that keeps vowel harmony gives an affix's form after front vowels in `front`.

Each finding is located at the key at fault:

| Finding                                                                                                                                                                                                                                                                                                                                                                  | Severity |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Any of these keys on a skill of another subType, at the key                                                                                                                                                                                                                                                                                                              | error    |
| An unknown, missing or wrongly shaped key in an entry                                                                                                                                                                                                                                                                                                                    | error    |
| A value outside its closed list — an `edge`, an element `position` or `kind`, a register `kind`, `stress`, a join's `meeting` or `rule`, a mark's `kind` or `limit`, `onsets`, `neutralAs`, a closing's `usual`, a cluster group's `use`, an affix's `kind` or `given`, a naming class `of`, a draw's `kind` or `elements`, a held-from `takes` or `clip` — at the value | error    |
| A `sounds` word other than `any`, at the value                                                                                                                                                                                                                                                                                                                           | error    |
| A tongue tag that is not lowercase letters and digits, at the tag                                                                                                                                                                                                                                                                                                        | error    |
| A tongue tag stated twice, at the second                                                                                                                                                                                                                                                                                                                                 | error    |
| A register or letter tongue `tongues` does not declare, at the tag                                                                                                                                                                                                                                                                                                       | error    |
| An edge stated twice, at the second                                                                                                                                                                                                                                                                                                                                      | error    |
| A sound stated twice in one mutation, at the second                                                                                                                                                                                                                                                                                                                      | error    |
| A cluster stated in two groups, at the second                                                                                                                                                                                                                                                                                                                            | error    |
| An `innerCluster` edge beside `clusters.groups`, at the edge                                                                                                                                                                                                                                                                                                             | error    |
| A vowel partner keyed by no vowel of the harmony, at the key, or naming no `front` vowel, at the value                                                                                                                                                                                                                                                                   | error    |
| A form stated twice in `older`, at the second                                                                                                                                                                                                                                                                                                                            | error    |
| A negation `mutation` that `sounds.mutations` does not name, at the value                                                                                                                                                                                                                                                                                                | error    |
| A negation `particle` or an element `word` that is no word of the language or an ancestor, at the value                                                                                                                                                                                                                                                                  | error    |
| An affix's `given` where its `kind` is not `name`, at the key                                                                                                                                                                                                                                                                                                            | error    |
| An affix with `zero: true` beside a `form`, at `zero`, or with neither, at the entry                                                                                                                                                                                                                                                                                     | error    |
| A naming shape stated twice for one class of name, at the second                                                                                                                                                                                                                                                                                                         | error    |
| A naming shape with neither `syllables` nor `perVowel`, at the entry                                                                                                                                                                                                                                                                                                     | error    |
| A naming range whose `min` is above its `max`, at the range                                                                                                                                                                                                                                                                                                              | error    |
| A naming edge stated twice for one class of name, at the second                                                                                                                                                                                                                                                                                                          | error    |
| A kind of name whose draws are stated twice, at the second                                                                                                                                                                                                                                                                                                               | error    |
| A held-from row that takes an `element` and names no `elements`, at the row                                                                                                                                                                                                                                                                                              | error    |
| `elements` on a held-from row that takes no element, or `clip` or `joining` on one that takes no name, at the key                                                                                                                                                                                                                                                        | error    |
| A `scope` Address that does not resolve, or a type that is no note type                                                                                                                                                                                                                                                                                                  | error    |
| A tongue `language` or a cognate form's language that is no language note                                                                                                                                                                                                                                                                                                | error    |
| A register row with neither a `tongue` nor a `kind`, at the row                                                                                                                                                                                                                                                                                                          | error    |
| A sound-change set's name stated twice, at the second                                                                                                                                                                                                                                                                                                                    | error    |
| A step label stated twice in one set, at the second                                                                                                                                                                                                                                                                                                                      | error    |
| A set's `from` or `to` that is no language note, at the value                                                                                                                                                                                                                                                                                                            | error    |
| A frame class that is no word class base, at the class                                                                                                                                                                                                                                                                                                                   | error    |
| An affix stating both `replaces` and `lengthens: true`, at `lengthens`                                                                                                                                                                                                                                                                                                   | error    |
| A calling-name closing with both or neither of `form` and `doubled`                                                                                                                                                                                                                                                                                                      | error    |

A fence sets each table back from its relation:

````markdown
```sql
SELECT '`' || tag || '`' AS "Tongue", meaning AS "Meaning"
FROM tongues WHERE language = 'thalorna-note-skill-dunharlng' ORDER BY position
```

```sql
SELECT '**' || name || '**' AS "Name",
       coalesce(array_to_string(list_transform(notes, n -> '[[' || n || '|' || name || ']]'), ', '), '—') AS "Notes",
       tongue AS "Tongue", coalesce(built_text, '—') AS "Built from"
FROM register WHERE language = 'thalorna-note-skill-dunharlng' ORDER BY position
```

```sql
SELECT form AS "Form", coalesce(array_to_string(instead, ', '), '—') AS "Written instead",
       why AS "Why"
FROM retired WHERE language = 'thalorna-note-skill-dunharlng' ORDER BY position
```

```sql
SELECT array_to_string(letters, ', ') AS "Letter", kind AS "Kind", "like" AS "Sounds like"
FROM letters WHERE language = 'thalorna-note-skill-dunharlng' ORDER BY position
```

```sql
SELECT edge AS "Edge", array_to_string(sounds, ', ') AS "Sounds"
FROM edges WHERE language = 'thalorna-note-skill-dunharlng' ORDER BY position
```
````

`clusters`, `cluster_groups`, `stress`, `finals`, `syllables`, `joining`,
`joins`, `marks`, `skeleton`, `frames`, `read_past`, `mutations`, `scope`,
`sound_changes`, `elements`, `roots`, `calling_names`, `older`, `negation`,
`name_shapes`, `name_edges`, `name_draws`, `held_from`, `near_names` and
`cognates` read the same way; [content tables](#content-tables) gives every
relation's columns.

if a `sohl` property is present, a SoHL item of type "skill" is created.

If an `hm3` property is present, an HM3 item of type "skill" is created.

Note: `hm3.system.type` (skill types) use the values "Craft", "Physical", "Communication", "Combat", "Magic", and "Ritual". These do not cleanly map to the `subType` values. Because of this, the `hm3.system.type` value must be specified with the appropriate value when defining HM3 skills.

`system.parentSkillCode` is authored under `sohl.system` as the shortcode of the
skill this one specializes, and has no shared source; `data.parentSkill` names that
skill as an Address, for the page.

| shared source       | → sohl           | → hm3                 |
| ------------------- | ---------------- | --------------------- |
| `subType`           | `system.subType` | See notes above       |
| `data.masteryLevel` | NA               | `system.masteryLevel` |

SoHL reads a skill’s base mastery from `sohl.masteryLevelBase`.

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

| `data` property                   | Values        | Description                                                            |
| --------------------------------- | ------------- | ---------------------------------------------------------------------- |
| `templatePriority`                | `number`      | Template priority, _null_ = not a template                             |
| `healingCheckDurationFormula`     | `RollFormula` | Formula for the interval between healing checks                        |
| `healingCheckDurationBase`        | `number`      | That interval in seconds, stated outright instead of rolled            |
| `bloodLossAdvanceDurationFormula` | `RollFormula` | Formula for the interval between blood-loss advances                   |
| `bloodLossAdvanceDurationBase`    | `number`      | That interval in seconds. Setting it is what makes the wound bleed     |
| `courseDurationFormula`           | `RollFormula` | Formula for the interval between course tests — shock, coma, infection |
| `courseDurationBase`              | `number`      | That interval in seconds, stated outright instead of rolled            |

if a `sohl` property is present, a SoHL item of type "trauma" is created.

If an `hm3` property is present, an HM3 item is created. `hm3.type` must be specified as either `injury` or `trait`.

| shared source                          | → sohl                                   | → hm3 |
| -------------------------------------- | ---------------------------------------- | ----- |
| `subType`                              | `system.subType`                         | NA    |
| `data.healingCheckDurationFormula`     | `system.healingCheckDurationFormula`     | NA    |
| `data.healingCheckDurationBase`        | `system.healingCheckDurationBase`        | NA    |
| `data.bloodLossAdvanceDurationFormula` | `system.bloodLossAdvanceDurationFormula` | NA    |
| `data.bloodLossAdvanceDurationBase`    | `system.bloodLossAdvanceDurationBase`    | NA    |
| `data.courseDurationFormula`           | `system.courseDurationFormula`           | NA    |
| `data.courseDurationBase`              | `system.courseDurationBase`              | NA    |

**A trauma's three timed phases follow the triplet rule** stated under
`affliction`: write the formula or the base, both in seconds, and omitting each
leaves the key out so the data model answers. Two of them fall back to a **world
setting** when the trauma sets neither half — the healing check and the course —
which is why a default written here would be wrong rather than merely
redundant. `bloodLossAdvanceDurationBase` is the switch that makes a wound
bleed: a trauma that sets it bleeds, one that leaves it unset does not.

**`system.contractDate` and `system.treatmentDate` are never authored.** They
are the world times the injury was taken and last treated — runtime state, for
the reason `affliction`'s four dates are — so a note that writes one fails the
build.

### type: weapongear

Note: `data.quantity` may not be specified. Quantity is always 1.

| `data` property    | Values           | Description                                                                   |
| ------------------ | ---------------- | ----------------------------------------------------------------------------- |
| `templatePriority` | `number`         | Template priority, _null_ = not a template                                    |
| `weight`           | `number`         | Gear weight                                                                   |
| `value`            | `number`         | Gear value                                                                    |
| `quality`          | `number`         | Gear quality                                                                  |
| `durability`       | `number`         | Gear durability                                                               |
| `made`             | an event Address | The event in which it was made — `lore-forging`, or `place-ironfells#raising` |
| `lost`             | an event Address | The event in which it was lost — `lore-flood`, or `place-ironfells#sack`      |

if a `sohl` property is present, a SoHL item of type "weapongear" is created,
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

In-world knowledge a sage in the setting could study or know. A lore note describes
the setting itself, rather than instructions or other apparatus for the GM.

**subType**:

- cosmology: The structure of reality — planes, realms, creation, and the ordering of what exists.
- deity: Individual gods and their attributed natures, domains, epithets, and aspects.
- theology: How the divine is held to operate — worship, sacrifice, afterlife, sin and grace.
- arcana: How magic is held to operate — mechanism, traditions, and philosophies of practice.
- spirit: The non-divine numinous — spirits, celestials, fae, and their natures.
- economy: How wealth moves — barter, coinage, trade networks, credit, and measure.
- law: How obligation is ordered and enforced — citizenship, custom, courts, and tenure.
- calendar: How time is reckoned and marked — dating, seasons, festivals, and astrology.
- history: What has happened — eras, events, chronicles, and genealogies of rule.
- material: A physical constituent, such as mithril, buckram, or silk, and its qualities,
  including durability, value, and regional varieties.
- folk: Related sapient beings of a single or tightly related species: kindreds, ancestries.
- culture: A social grouping of individuals with common beliefs, mores, and values.
- custom: How a people does a thing — a rite, observance, or usage.
- bestiary: A kind of creature that is not a people — beasts, monsters, and the made things
  that were never born. What `folk` covers for the sapient, this covers for everything else.
- gathering: A scheduled public occasion people travel to — a tournament or martial games, a
  great market or fair, a religious festival, a ceremony or rite. What these share is assembly
  on a cycle: a place, a time, and something contested or observed. Held apart from `calendar`,
  which covers the _reckoning_ — a festival's date is calendar and the festival is not, and a
  tournament is not a matter of time-reckoning at all — and from `culture`, which is a grouping
  of people rather than an occasion they attend.
- literature: A work a people composes and keeps — an epic, saga, poem, legend, hymn or
  chronicle, told, sung or written. Held apart from `history`, which states what happened: a
  legend is literature whether or not its events took place, and a chronicle is literature as a
  work even where its events are also history.

Each note a work names in `data.subjects` lists that work on its own site page, under **In
song and story**, with the work's `form` beside its title; the subject note writes nothing.
Each subject may name one event, as `place-ironfells#sack`: the anchor must be an `event` anchor
the note declares, and the work lists on the page of the note that holds the event.
A work in a fetched index lists on this package's pages when that index carries its
`subjects`.

```yaml
shortcode: burningsaga
name: { full: The Saga of the Burning }
type: lore
subType: literature
data:
  culture: lore-ironfolk
  form: saga
  subjects: [place-ironfells#sack, place-east, lore-fords]
  language: skill-ironspeech
```

The saga lists under **In song and story** on `place-ironfells`, which holds the
sack, on `place-east` and on `lore-fords`.

Calendar fields are written only on a `calendar` note, `form` and `subjects`
only on a `literature` note, `language` only on `literature` and `culture`, and
`parents` only on `culture`. Written on any other lore subtype, each is an
error at its own key.
`culture` may be written on any lore subType. A culture note is itself the culture, so it
leaves the field out or names itself, by its shortcode or by any longer form of its Address;
naming any other note is an error at the value. A `lore` note that states no culture has
none; a culture note reads as its own Address in the index, including when it
names parent cultures. Culture parents supply language and appearance fields,
not a different cultural identity. See
[Culture parents](#culture-parents-and-inherited-fields) and
[Culture in the index](#culture-in-the-index).

| `data` property                       | Values                                                                        | Description                                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `epoch`                               | canonical `<year>.<day>`                                                      | The canonical day that equals calendar year 1, day 1                                                                                                                                                                                                                                                          |
| `months`                              | `{ name, abbreviation?, days }[]`                                             | Ordered months; their days sum to the world's year                                                                                                                                                                                                                                                            |
| `months[].name`                       | `string`, required                                                            | The month's name                                                                                                                                                                                                                                                                                              |
| `months[].abbreviation`               | `string`                                                                      | Its short form, for a compact date                                                                                                                                                                                                                                                                            |
| `months[].days`                       | `integer`, required                                                           | How many days the month holds                                                                                                                                                                                                                                                                                 |
| `weekdays`                            | `{ name, abbreviation? }[]`                                                   | Ordered week days, indexed from zero; weeks run continuously                                                                                                                                                                                                                                                  |
| `weekdays[].name`                     | `string`, required                                                            | The day's name                                                                                                                                                                                                                                                                                                |
| `weekdays[].abbreviation`             | `string`                                                                      | Its short form, for a compact date                                                                                                                                                                                                                                                                            |
| `seasons`                             | `{ name, abbreviation?, start }[]`                                            | Seasons starting on one-based days of year                                                                                                                                                                                                                                                                    |
| `seasons[].name`                      | `string`, required                                                            | The season's name                                                                                                                                                                                                                                                                                             |
| `seasons[].abbreviation`              | `string`                                                                      | Its short form, for a compact date                                                                                                                                                                                                                                                                            |
| `seasons[].start`                     | `integer`, required                                                           | The one-based day of the year it begins; starts increase down the list                                                                                                                                                                                                                                        |
| `namedDays`                           | `{ name, abbreviation?, day }[]`                                              | Names assigned to one-based days of year                                                                                                                                                                                                                                                                      |
| `namedDays[].name`                    | `string`, required                                                            | The day's name                                                                                                                                                                                                                                                                                                |
| `namedDays[].abbreviation`            | `string`                                                                      | Its short form, for a compact date                                                                                                                                                                                                                                                                            |
| `namedDays[].day`                     | `integer`, required                                                           | The one-based day of the year it names, distinct within the calendar                                                                                                                                                                                                                                          |
| `eras`                                | `{ shortcode, name, abbreviation?, marker?, proclaimedBy?, start, label? }[]` | Year counts; `start` is `null` or an in-calendar year                                                                                                                                                                                                                                                         |
| `eras[].shortcode`                    | `string`, required                                                            | The era's own segment of `<calendar>.<era>`, unique within the calendar                                                                                                                                                                                                                                       |
| `eras[].name`                         | `string`, required                                                            | The era's name                                                                                                                                                                                                                                                                                                |
| `eras[].marker`                       | `string`                                                                      | Uppercase letters and digits, beginning with a letter, unique across the corpus; an authored date names the era by it                                                                                                                                                                                         |
| `eras[].abbreviation`                 | `string`                                                                      | Its short form, for a compact date                                                                                                                                                                                                                                                                            |
| `eras[].proclaimedBy`                 | `Address`                                                                     | The body that began the reckoning                                                                                                                                                                                                                                                                             |
| `eras[].start`                        | `null` or `integer`, required                                                 | The calendar year the era begins; `null` for the era before year 1                                                                                                                                                                                                                                            |
| `eras[].label`                        | `string` or `{ after?, before? }`                                             | How a date in the era reads, around one `{date}` slot; a string is `after`                                                                                                                                                                                                                                    |
| `eras[].label.after`                  | `string`                                                                      | How a date from the era's start reads, with exactly one `{date}`                                                                                                                                                                                                                                              |
| `eras[].label.before`                 | `string`                                                                      | How a date before the era's start reads, with exactly one `{date}`                                                                                                                                                                                                                                            |
| `formats`                             | map of names to Calendaria patterns                                           | Named date formats; `std` is the preferred default                                                                                                                                                                                                                                                            |
| `culture`                             | `Address`                                                                     | The people this lore belongs to — for a `literature` note, the people whose work it is — naming a lore note with `subType: culture`; not on a `culture` note                                                                                                                                                  |
| `form`                                | `string`                                                                      | `literature` only: the kind of work in its people's own terms — `epic`, `saga`, `praise-song`, `elegy`. Free text                                                                                                                                                                                             |
| `subjects`                            | `Address[]`                                                                   | `literature` only: the beings, places, gods and other notes the work concerns, and any event, as `note#id`                                                                                                                                                                                                    |
| `parents`                             | `Address[]`                                                                   | `culture` only: the larger cultures this one belongs to; each target is a culture lore note — see [culture parents](#culture-parents-and-inherited-fields)                                                                                                                                                    |
| `language`                            | `Address`                                                                     | `literature` and `culture` only: the tongue a work is composed in, or a culture's people speak, naming a skill note with `subType: language`; `package-build npc new` draws a culture's names from that language's [name lists](#name-lists); glossary entries whose own `language` is unstated resolve to it |
| `events`                              | event entries — see [Events](#events)                                         | What happened to or at this subject: dated, attributed events                                                                                                                                                                                                                                                 |
| `appearanceProfile`                   | `{ frame, eye_color, hair_color, skin_color, complexion, height }`            | `culture` only: what its people look like, for `package-build npc new` — see [appearance profiles](#appearance-profiles)                                                                                                                                                                                      |
| `appearanceProfile.frame`             | map of `frame` words to positive weights, required                            | How often each frame is drawn                                                                                                                                                                                                                                                                                 |
| `appearanceProfile.eye_color`         | map of `eye_color` words to positive weights, required                        | How often each eye colour is drawn                                                                                                                                                                                                                                                                            |
| `appearanceProfile.hair_color`        | map of `hair_color` words to positive weights, required                       | How often each hair colour is drawn                                                                                                                                                                                                                                                                           |
| `appearanceProfile.skin_color`        | map of `skin_color` words to positive weights, required                       | How often each skin colour is drawn                                                                                                                                                                                                                                                                           |
| `appearanceProfile.complexion`        | map of `complexion` words to positive weights, required                       | How often each complexion is drawn                                                                                                                                                                                                                                                                            |
| `appearanceProfile.height`            | map of `gender` words to `{ min, max }`, required                             | Height ranges by gender; `female` and `male` are required                                                                                                                                                                                                                                                     |
| `appearanceProfile.height.<name>.min` | height in metres or feet and inches, required                                 | The shortest height drawn for that gender                                                                                                                                                                                                                                                                     |
| `appearanceProfile.height.<name>.max` | height in metres or feet and inches, required                                 | The tallest height drawn for that gender                                                                                                                                                                                                                                                                      |
| `glossary`                            | `{ name, name_sort?, common?, definition?, pronunciation?, language? }[]`     | `culture` only: the culture's own glossary terms — see [glossary terms](#glossary-terms)                                                                                                                                                                                                                      |
| `glossary[].name`                     | `string`, required                                                            | The headword                                                                                                                                                                                                                                                                                                  |
| `glossary[].name_sort`                | `string`                                                                      | Its sort key; the matching word's, else the name, when unstated                                                                                                                                                                                                                                               |
| `glossary[].common`                   | `boolean`                                                                     | `true` for a term in this owner's core vocabulary; `false` when unstated                                                                                                                                                                                                                                      |
| `glossary[].definition`               | `string`                                                                      | Its context meaning or own gloss; unstated, a matching dictionary word supplies its senses                                                                                                                                                                                                                    |
| `glossary[].pronunciation`            | `string`                                                                      | A respelling, as `sol-MEH-reh`: letters, apostrophes and hyphens, at most one syllable in capitals                                                                                                                                                                                                            |
| `glossary[].language`                 | `Address`                                                                     | The language the term is in, naming a skill note with `subType: language`; unstated, the note's language                                                                                                                                                                                                      |

`data.events` is available on every `lore` subType, and is described in full under [Events](#events).

#### Glossary terms

**A dictionary belongs to a language; a glossary belongs to a culture or an
affiliation.** A language note with nonempty `data.words` receives its full Dictionary
section automatically, with grammar, senses, etymology and pronunciation,
field tags, letter headings and one key in a single alphabetical list. A
culture or affiliation with nonempty `data.glossary` receives a Glossary section
containing only its explicitly declared entries. Ranks and offices stand in
the affiliation's own sections; the glossary selects one only through an
explicit entry. A note without the relevant frontmatter receives no such
section. These sections appear on the site, in the Foundry journal and in
the book. Dictionaries and glossaries have no setting-wide pages.

A glossary entry belongs for one of three reasons:

1. **A common word** is part of the owner's core vocabulary, the words a
   player needs to adventure there. It states `common: true` and takes the
   dictionary's senses when it gives no `definition`.
2. **A dictionary word with a context meaning** states that meaning in
   `definition`.
3. **A term outside the dictionary** — a phrase, a hyphenated compound or a
   term of art — states its gloss in `definition`.

`common` belongs to an entry in its owner's glossary. A culture and an
affiliation using the same language choose independently: a word may be
common in one glossary and absent from another. A language's dictionary
marks nothing common.

This culture glossary uses the words from [the Provenzal language
example](#a-languages-words). `solmère` is a common word with its dictionary
sense, `amère` takes the context's song sense, and `blood-field` is a term
outside the dictionary. `Knight-Captain` names a rank that reaches the
culture:

```yaml
shortcode: provenzianclt
name: { full: Provenzia }
type: lore
subType: culture
data:
  language: skill-provnzlng
  glossary:
    - { name: solmère, common: true }
    - { name: amère, definition: "a sweetheart, in the songs" }
    - {
        name: blood-field,
        definition: "ground where a battle tore the boundary with the spirit world, and it did not close",
      }
    - { name: Knight-Captain, common: true }
```

**An entry naming a word of its resolved language, without a `definition`,
carries that word's senses and class.** Its headword links to the word's
entry in the language's dictionary. An entry with a `definition` carries that
meaning instead, keeping its word link and class when it names a dictionary
word.

**Every entry resolves to a language**, and the first match wins:

1. the entry's own `language`;
2. on an affiliation, its own `data.language`, then the nearest parent
   affiliation's, nearest first and parents in the order `data.parents` lists
   them, then its culture's `data.language`;
3. on a culture, its own `data.language`.

On lore and affiliation notes, `data.language` and
`data.glossary[].language` name language notes. Use `skill-provnzlng` for a
language in this package, or `<pkg>-note-skill-provnzlng` for its complete
NOTE Address. Any other system segment, including `sohl`, is an error at the
authored value. A SOHL skill Address names a compiled Item.

An affiliation's culture is the one it states or inherits, as
[Culture in the index](#culture-in-the-index) describes, and a culture's
`data.language` includes one it inherits from its
[parent cultures](#culture-parents-and-inherited-fields). An entry in another
tongue names that language explicitly:

```yaml
# Affiliations/Wardens.md — an order with a cant of its own
type: affiliation
subType: order
data:
  culture: lore-sinaleclt
  language: skill-tradelng
  glossary:
    - { name: zarq, common: true } # a word of the cant
    - { name: gate-oath, definition: "the oath sworn at the gate" } # in the cant
    - { name: dòrwen, definition: "the warden's oath-sister", language: skill-sinalelng } # in the culture's tongue
```

Each finding is located at the entry's key:

- `data.glossary` on a lore note that is not a culture is an error at the key.
  On any type but `lore` and `affiliation` it is an unknown key.
- Two entries of one name in one glossary are an error at the second. Names are
  compared after NFC normalisation, with case kept.
- An entry that resolves to no language is an error at the entry: state its
  `language`, or `data.language` on the note.
- An entry's `language` that names no language skill is an error at the value.
- An entry with no `definition` naming neither a word of its resolved
  language, including inherited words, nor a rank or office that reaches its
  owner is an error at its `name`. State the word's `language`, or give the
  term its own `definition`.
- A pronunciation that is not a respelling is an error at the value.
- A `definition` that only repeats the one sense it replaces is a warning at the
  definition, because the entry changes nothing.

The `glossary` relation holds one row per entry as authored, with the language
it resolves to. The `terms` relation supplies its senses and class for a
`layout=glossary` fence — see [Content tables](#content-tables).

#### Dictionaries and glossaries

**A language's dictionary sets its words**, with their class, field,
etymology, pronunciation, senses and citations. A language note with
`data.words` receives that full dictionary automatically as one alphabetical
list, with letter headings and one key. **A culture's or an affiliation's
Glossary section sets its explicit `data.glossary` entries only**: common
words, dictionary words with a context meaning, and phrases, compounds or
terms of art with their own glosses. A note with absent or empty `data.words` or
`data.glossary`, respectively, receives no such section. The site, Foundry
journals and the book show the same sections.

An authored heading with `{#dictionary}` or `{#lexicon}` receives the
Dictionary list after its authored text; `{#glossary}` does the same for a
Glossary list. The heading and its introduction stay in place, with a single
list under it. Otherwise the build appends a **Dictionary** or **Glossary**
heading and its entries at the end of the note. There are no setting-wide
dictionary or glossary pages.

`layout=dictionary` and `layout=glossary` remain available for custom SQL
views of the same relations. The `terms` relation holds governance rows as
well as declared glossary entries; the default Glossary section selects only
the owner's explicitly declared entries. See [dictionaries and
glossaries](../authoring/links-and-markup.md#dictionaries-and-glossaries) for
the layouts and custom queries.

**`dictionary`** is one row per word per language it is listed under. A
language lists its own words at `depth` 0 and the words it inherits through
`data.family` above that, nearest first, so `WHERE language = '<Address>'` is
that language's full dictionary. Where a daughter and a parent state the same
form, the daughter's own word is the one listed. Words of class `name`, `stem`
and `pref` are no entry. Nonempty `data.words` containing only these classes
still supplies the Dictionary heading, with no entries or key; a stated verb
pattern still supplies its head table. A word's sort
key and pronunciation come from its declaration; a glossary's choices belong
to its own entries.

| Column          | What it holds                                                                                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `language`      | The language the word is listed under.                                                                                                                                                                               |
| `language_tag`  | That language note's `data.abbreviation`, or its full name where it states none.                                                                                                                                     |
| `name`          | The word's form.                                                                                                                                                                                                     |
| `name_sort`     | The word's sort key, or its form where unstated.                                                                                                                                                                     |
| `letter`        | The heading letter: the first letter of `name_sort`, accents taken off and apostrophes skipped, in capitals.                                                                                                         |
| `pronunciation` | The word's respelling; `NULL` where unstated.                                                                                                                                                                        |
| `class`         | The word's class, as written.                                                                                                                                                                                        |
| `plural`        | The noun's explicit plural, else its listed language's first matching replacement; `NULL` where unavailable or not a noun.                                                                                           |
| `field`         | The word's field, printed as a tag beside the entry; `NULL` where unstated.                                                                                                                                          |
| `etymology`     | `{ kind, language, language_tag, form, parts, root, frame }` from the word's `source`, `built`, `root` and `frame`; an inherited word's is `inherited` from the language that states it. `NULL` where there is none. |
| `senses`        | A list of `{ text, bodies }`: one per sense of the word's gloss, with no bodies. A dictionary numbers a word's senses where it has more than one.                                                                    |
| `usage`         | The Addresses of the notes whose prose cites the word, as the language that states it records them.                                                                                                                  |
| `verbs`         | The listed language's stated `{ invariant: true }` or six-person pattern, repeated as metadata for one head table; `NULL` where unstated.                                                                            |
| `depth`         | How far up the language's lineage the word is stated: `0` for its own.                                                                                                                                               |

A daughter language with no own words has no automatic Dictionary section.
A glossary word in that resolved language links to its visible defining
ancestor's dictionary entry. The glossary's `language` remains the resolved
daughter language.

**`terms`** is one row per term per note that owns it: an entry of a culture's
or an affiliation's `data.glossary`, or an affiliation's rank or office.

| Column          | What it holds                                                                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `owner`         | The Address of the culture or affiliation that owns the term.                                                                                                                    |
| `owner_kind`    | `culture` or `affiliation`.                                                                                                                                                      |
| `language`      | The language the term is in: a glossary entry's, as it resolves; a rank's or office's, the language its body's glossary resolves to. `NULL` where none resolves.                 |
| `language_tag`  | That language note's `data.abbreviation`, or its full name where it states none.                                                                                                 |
| `name`          | The headword.                                                                                                                                                                    |
| `name_sort`     | The glossary entry's sort key, else the dictionary word's, else the headword.                                                                                                    |
| `letter`        | The heading letter, as for a word.                                                                                                                                               |
| `pronunciation` | The glossary entry's respelling, else the dictionary word's; `NULL` where neither states one.                                                                                    |
| `class`         | The matching dictionary word's class, as written; `NULL` where no word matches.                                                                                                  |
| `word`          | The matching word's anchored dictionary entry: the resolved language's when it has own words, else the visible defining language's; `NULL` where no word matches.                |
| `senses`        | A list of `{ text, bodies }`: a dictionary word's gloss senses with no bodies, or the entry's definition with its owner, or a rank's or office's descriptions with their bodies. |
| `usage`         | Citation Addresses: governance usage, inherited dictionary usage or the defining owner; a copied reached title also cites its selecting owner.                                   |
| `common`        | Whether this owner's glossary entry marks the term part of its core vocabulary.                                                                                                  |
| `origins`       | Which sources gave it: `rank`, `office`, `glossary`.                                                                                                                             |
| `cultures`      | The cultures associated through the owner and its parents, as a list of Addresses for selecting reached ranks and offices.                                                       |

A standalone word entry without a definition uses the dictionary's
citations; an explicit term cites its owner. A rank or office keeps its
body's and members' or holders' citations, including when its owner's
glossary names a matching word or supplies a definition. An owner selecting
a reached title also joins its own Address to that title's citations.

**A term reaches the cultures its owner reaches.** A culture's own terms reach
the culture. An affiliation's terms — its ranks, its offices and its own
glossary entries alike — reach its culture, its own or one the index resolves
for it, and the culture of every affiliation above it through `data.parents`.
`cultures` records those associations for custom queries. The default
Glossary section selects its own owner's declared `data.glossary` entries;
it adds no other rows from this reach. A custom view that includes reached
governance rows can select `origins` containing `rank` or `office` and prints
`common` only for the owner's own rows. An affiliation that reaches no culture
has an empty list.

**A rank and an office of one title in one body are one row**, the rank's
sense first, and where their descriptions are identical, one sense.

**A rank or office title of one word** — no space and no hyphen in it, as
`Subject` or `Member` — is a term only where a glossary entry of its body, or
of a culture it reaches, names it, or where it is a word of its language,
compared without case. A title of several words, as `Knight-Captain` or
`Lord Steward`, always is.

**A glossary entry with a `definition`** carries that definition instead of a
matching dictionary word's senses. It replaces the senses of its owner's own
rank or office of that name. Otherwise it is a term of its owner's own, cited
from the owner, so a culture's definition of a rank one of its affiliations
holds is a second row beside the rank's. A glossary of that culture combines
the senses under one headword where the rows share a language.

**A glossary entry without a `definition`** names a word of its resolved
language, or a rank or office that reaches its owner. A dictionary word gives
the entry all its senses, its class and a link to its entry on the language
page; a rank or office gives its descriptions. Where the owner has a rank or
office of the same title as the word, its distinct descriptions follow the
dictionary senses. The glossary entry can state its own `name_sort` or
`pronunciation`. Names are compared after NFC normalisation, with case kept. Its `common` value belongs to its owner, so a
culture entry naming an affiliation's rank does not mark the affiliation's
entry common. Naming the rank also admits a title of one word.

**The datafiles.** `package-build content-index` writes each relation beside
the index: `<package>-dictionary.jsonl`, sorted by `language`, `name_sort` and
`name`, and `<package>-terms.jsonl`, sorted by `owner`, `name_sort` and
`name`. Each holds one row per line, keys sorted at every depth, and is
byte-identical between two builds of an unchanged tree. They hold every note's
rows, GM notes' included, as the index does. Nothing in the build reads them;
they are there for `jq`, an editor or another package.

#### Calendar note structure

The calendar keys belong to `subType: calendar`. A calendar declares `months`, `epoch`, and `eras`. The world's `place` note declares the year length; the calendar's months sum to that length. A calendar with no week omits `weekdays`.

```yaml
shortcode: commoncal
name: { full: The Common Calendar }
type: lore
subType: calendar
data:
  epoch: "1.1"
  months:
    - { name: Floralis, abbreviation: Flor, days: 30 }
    - { name: Lusenar, abbreviation: Luse, days: 31 }
    - { name: Murkas, abbreviation: Murk, days: 30 }
    - { name: Taranis, abbreviation: Tara, days: 31 }
    - { name: Vulcar, abbreviation: Vulc, days: 30 }
    - { name: Menaris, abbreviation: Mena, days: 31 }
    - { name: Venuris, abbreviation: Venu, days: 30 }
    - { name: Karnavar, abbreviation: Karn, days: 30 }
    - { name: Morveth, abbreviation: Morv, days: 31 }
    - { name: Thanaris, abbreviation: Than, days: 30 }
    - { name: Aetheris, abbreviation: Aeth, days: 31 }
    - { name: Janar, abbreviation: Jana, days: 30 }
  weekdays:
    - { name: Newday, abbreviation: New }
    - { name: Tillday, abbreviation: Til }
    - { name: Growday, abbreviation: Gro }
    - { name: Harvestday, abbreviation: Hrv }
    - { name: Reapday, abbreviation: Rep }
    - { name: Slowday, abbreviation: Slo }
    - { name: Setday, abbreviation: Set }
  seasons:
    - { name: Spring, abbreviation: Spr, start: 1 }
    - { name: Summer, abbreviation: Sum, start: 92 }
    - { name: Fall, abbreviation: Fal, start: 183 }
    - { name: Winter, abbreviation: Win, start: 274 }
  namedDays:
    - { name: New Years Day, abbreviation: NY, day: 1 }
  formats:
    std: "MM/DD/Y GGG"
    long: "D MMMM Y GGG"
  eras:
    - { shortcode: bvr, name: Before Vylarian Reckoning, abbreviation: BVR, start: null }
    - { shortcode: vr, name: Vylarian Reckoning, abbreviation: VR, start: 1 }
    - { shortcode: later, name: Later Reckoning, abbreviation: LR, start: 701 }
```

`data.epoch` anchors calendar year 1, day 1 to a canonical day. An epoch of `1.91` makes the calendar's first day canonical `1.91`: calendar day 1 can begin anywhere in the canonical year. The epoch is day-precise and uses canonical spelling, never `datefrom`.

`data.eras` contains exactly one `start: null` row and one `start: 1` row. Other starts are distinct positive integer calendar years; fractional starts such as `1.1` are invalid. `start: 1` is the canonical day declared by `epoch`. Starts are sorted numerically, irrespective of array order. Each era ends before the next start. The null era covers earlier years and counts them backwards; package-build prints a positive historical year for its `Y`, `YY`, and `YYYY` tokens. It is omitted from Calendaria emission, which has no backwards-counting era. At calendar year 701, a later era begins at its own era-relative year 1, exposed by `[yearInEra]`; `Y` still prints the calendar year. An era's `shortcode` is unique within the note; `marker` is unique across the corpus and uses uppercase letters and digits, beginning with a letter. `proclaimedBy` may identify the body that began a reckoning.

Each weekday's zero-based index is its position in the array. The weekday cycle starts with the first day of calendar year 1 and continues through month and year boundaries. Each month is in year order, including short festival months. Seasons start on one-based days of year in increasing array order; each ends immediately before the next begins, and the last wraps through the start of the next year if needed. A named day identifies one day of year and can appear in a date pattern through `[namedDay]` or `[namedDayAbbr]`.

`formats` holds any number of named patterns. `std` is the default for `datefrom`, `dateto`, and `dateformat`; when no `std` is present, the first pattern is the default. `dateto --format <name>` and `{{dateformat "commoncal" data.born "long"}}` select another output pattern. The default must identify one day: it needs `Y`, `YYYY`, or `[yearInEra]`; `DDD` or both a month and day token; and an era label if it uses `[yearInEra]`. `YY` alone cannot identify a year. The default may use clock tokens. Display-only tokens are valid in other named patterns, but package-build's date printer raises an error for tokens that require Calendaria runtime state, such as a moon phase, cycle, or climate zone.

When printing a year or month without a day, package-build omits finer fields from the selected pattern. A year-only date does not acquire the weekday, month, day, or time of its first day merely because the pattern names them.

The default pattern is sent to Calendaria as `dateFormats.short`; named `long` and `full` patterns fill those display slots. The names `time`, `time12`, `weekHeader`, `yearHeader`, `yearLabel`, and `crossCalendar` also fill Calendaria's matching slots. Other names remain available to package-build's `dateto --format` and `dateformat`.

The emitted Calendaria definition contains the eras with numeric starts.

#### Calendar format tokens

Patterns use [Calendaria's format vocabulary](https://wiki.3deathsaves.com/calendaria/format-tokens/). Case matters. The parser chooses the longest matching token: `QQ` is one padded season number, not two `Q` values. Bare tokens are substituted; unmatched characters pass through unchanged. Put literal words in square brackets or braces, as in `[Year] YYYY`. Fixed-width tokens need no separator (`YYYYMMDD`); variable-width numeric tokens need a separator or fixed-width neighbor in a readable default pattern. Bracketed and braced names that match custom tokens are substituted; other bracketed text is literal, with the enclosing marks removed. `[[]` prints a left bracket. A custom token can include a fallback after `|`, such as `[namedDay|Do]`; the fallback prints when the primary value is empty. Empty or unbalanced brackets and braces are errors.

| Token                                                             | Calendaria value                                                                                                                                         |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Y`, `YY`, `YYYY`                                                 | Calendar year; final two digits; year padded to four digits. For the package-build-only null-start era, the historical year prints without a minus sign. |
| `M`, `MM`, `Mo`                                                   | Month number; padded month number; ordinal month number                                                                                                  |
| `MMM`, `MMMM`                                                     | Abbreviated and full month name                                                                                                                          |
| `D`, `DD`, `Do`                                                   | Day of month; padded day; ordinal day                                                                                                                    |
| `DDD`                                                             | Day of year, padded to three digits                                                                                                                      |
| `E`, `EE`, `EEE`, `EEEE`, `EEEEE`                                 | Abbreviated weekday; full weekday for `EEEE`; initial for `EEEEE`                                                                                        |
| `e`, `d`, `dd`, `ddd`, `dddd`                                     | Zero-based weekday index; two-letter, abbreviated, or full weekday name                                                                                  |
| `w`, `ww`, `W`                                                    | Week of year; padded week of year; week of month                                                                                                         |
| `G`, `GG`, `GGG`, `GGGG`                                          | Abbreviated era; full era name for `GGGG`                                                                                                                |
| `Q`, `QQ`, `QQQ`, `QQQQ`                                          | Season number; padded number; abbreviation; full name                                                                                                    |
| `z`, `zzzz`                                                       | Active climate-zone abbreviation and name                                                                                                                |
| `H`, `HH`, `h`, `hh`                                              | 24-hour hour, padded; 12-hour hour, padded                                                                                                               |
| `m`, `mm`, `s`, `ss`                                              | Minute or second, plain and padded                                                                                                                       |
| `A`, `a`                                                          | Meridiem abbreviation, uppercase or lowercase                                                                                                            |
| `[yearName]`                                                      | Name assigned to the calendar year                                                                                                                       |
| `[namedWeek]`, `[namedWeekAbbr]`                                  | Named week and its abbreviation                                                                                                                          |
| `[namedDay]`, `[namedDayAbbr]`                                    | Named day and its abbreviation                                                                                                                           |
| `[era]`, `[eraAbbr]`                                              | Full era name and abbreviation                                                                                                                           |
| `[yearInEra]`, `[yearInEraOrdinal]`                               | Era-relative year and its ordinal spelling                                                                                                               |
| `[era=N]`, `[eraAbbr=N]`, `[yearInEra=N]`, `[yearInEraOrdinal=N]` | The named value from zero-based matching era index `N`                                                                                                   |
| `[season]`, `[seasonAbbr]`                                        | Full season name and abbreviation                                                                                                                        |
| `[meridiemFull]`                                                  | Full meridiem name                                                                                                                                       |
| `[moon]`, `[moonIcon]`                                            | Moon phase name and icon for the default moon                                                                                                            |
| `[moon=selector]`, `[moonIcon=selector]`                          | Moon phase name or icon for a selected moon                                                                                                              |
| `[ch]`, `[chAbbr]`                                                | Canonical hour name and abbreviation                                                                                                                     |
| `[cycle]`, `[cycleName]`, `[cycleRoman]`, `[cycleYear]`           | Calendar cycle number, name, Roman numeral, and cycle year                                                                                               |
| `[cycle=N]`, `[cycleName=N]`, `[cycleRoman=N]`                    | Values from zero-based cycle index `N`                                                                                                                   |
| `[approxTime]`, `[approxDate]`                                    | Calendaria's approximate time and date wording                                                                                                           |

Braced custom forms such as `{era}` are equivalent to bracketed custom forms. A bare `M` is the month, while lowercase `m` is the minute; lowercase `d` is the zero-based weekday index, while uppercase `D` is the day of month. The tokens in a readable default pattern are restricted to calendar year, era, month, day, and clock tokens so the compiler can parse an authored `datefrom` value without runtime state.

### type: map

A map note has its own prose and a Foundry Scene. A map can depict a place or an encounter. Several maps can depict the same place; the map names that place with `data.place`, while the place note does not list its maps.

**The Scene is made in Foundry.** Walls, lights, sounds, regions, levels and pins are drawn in Foundry's Scene editor, exported, and carried by the note at `data.scene`. The build passes the Scene through: it applies the fixups — `data.fixup` and `data.thumbnail` — binds pins marked `#anchor` to this note's pages, and checks nothing else inside it.

**subType**:

- `battlemap`: A tactical encounter map.
- `localmap`: A settlement or local-area map.
- `regionalmap`: A large-scale chart.
- `totm`: A single picture for theatre-of-the-mind play.

A subtype says what kind of map the note is. Every subtype carries an exported Scene.

| `data` property | Values                    | Description                                                                                                                                                                                                                                                          |
| --------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scene`         | object                    | **Keys not declared here:** the Foundry Scene document, as exported. Its keys are Foundry's Scene schema and are not checked; the build passes the Scene through, and the book reads its levels' background images — see [Exporting the Scene](#exporting-the-scene) |
| `fixup`         | `{ path, type, value }[]` | Asset address replacements in the exported Scene                                                                                                                                                                                                                     |
| `fixup[].path`  | `string`, required        | The exported field to replace, as a property path from `data.scene`                                                                                                                                                                                                  |
| `fixup[].type`  | `address`, required       | What `value` is                                                                                                                                                                                                                                                      |
| `fixup[].value` | `Address`, required       | The asset Address whose path replaces the exported one                                                                                                                                                                                                               |
| `thumbnail`     | Address                   | The map's thumbnail, an `image` Address written into the Scene's `thumb` as a fixup — see [The thumbnail](#the-thumbnail)                                                                                                                                            |
| `place`         | Address                   | Depicted place, when one exists                                                                                                                                                                                                                                      |

`data.scene` must be an object, and that is the only check made of it: its keys
are Foundry's Scene schema. A map note declares nothing under its system block.

#### Exporting the Scene

Build the Scene in Foundry, export it, convert the export to YAML, and put the
resulting object at `data.scene`. Its walls, lights, tiles, sounds, regions,
levels, environment, flags and canvas settings are preserved as exported. The
export can name art from another Foundry package; that path is used as authored
in Foundry. The build derives the top-level Scene `_id` from the map note, adds
compendium keys to each embedded document that carries an `_id`, adds build
metadata, and otherwise preserves the exported fields.

A pin's `text` can contain `#anchor`, where the map note has a heading such as `# Big Bad Wolf {#myanchor1}`. With `text: '#myanchor1'`, the compiled pin opens the JournalEntry and page generated from this map note and displays **Big Bad Wolf**. Its position, icon, other settings, and embedded `_id` remain as exported. A missing anchor is a build error. Pins whose text does not use `#anchor` retain their exported text and references.

`data.fixup` replaces exported asset paths without editing the Scene object by
hand. Each entry has `path`, `type: address`, and `value`, an asset Address in
the local or a fetched content index. Paths start at `data.scene` and use a
property path with array indices or stable embedded `_id` selectors. A path
must name one existing string or null field, and the address must resolve; any
mistake fails the build. An `_id` selector remains stable when Foundry reorders
an array on export.

```yaml
data:
  fixup:
    - { path: ".notes[NNNNNNNNNNNNNNNN].texture.src", type: address, value: sohl-none-icon-book }
    - { path: ".sounds[0].path", type: address, value: sohl-none-audio-forest }
```

Fixups change the compiled copy only. The exported Scene in the note stays
intact, and pin anchor binding runs after fixups. A package name such as
`fvtt` is an ordinary address package name: it needs published asset records
before its addresses can resolve.

```yaml
shortcode: wolfden
name: { full: The Wolf's Den }
type: map
subType: battlemap
data:
  scene:
    name: Wolf Den Scene
    width: 1900
    height: 2600
    grid: { type: 1, size: 100, distance: 5, units: ft }
    initialLevel: defaultLevel0000
    levels:
      - { _id: defaultLevel0000, background: { src: modules/maps/den.webp } }
    notes:
      - { _id: NNNNNNNNNNNNNNNN, text: "#myanchor1", x: 950, y: 2350 }
---
# Big Bad Wolf {#myanchor1}
```

#### The thumbnail

`data.thumbnail` names the picture Foundry shows for the Scene in its
directory and compendium lists. It is an `image` Address, and a bare shortcode
reads as one: `thumbnail: wolfdenthumb` names `image-wolfdenthumb`. An Address
of any other type, `icon` included, is an error at the key.

The thumbnail is a fixup the note does not have to spell. The map vocabulary
declares that `thumbnail` belongs in the Scene's `thumb`, so the build adds
`{ path: ".thumb", type: address, value: <thumbnail> }` to the note's fixups
and applies it with the rest: the Address must resolve, and the exported Scene
must carry `thumb`, as every Foundry export does. A `data.fixup` entry whose
`path` is also `.thumb` is an error, because one would overwrite the other.
The thumbnail is independent of the background art, which keeps its exported
path or its own fixup.

```yaml
data:
  thumbnail: wolfdenthumb
  scene:
    name: Wolf Den Scene
    thumb: null
    levels:
      - { _id: defaultLevel0000, background: { src: modules/maps/den.webp } }
```

When the Scene has pins, its Adventure bundle carries the Scene and the JournalEntry generated from its Markdown. Importing that bundle preserves the IDs the pins address. The maps naming one `data.place` share one Adventure.

#### A map in the book

A PDF book that selects a map note prints each of its Scene's level backgrounds
on a landscape page after the entry, titled with the map's name and the level's
name. The picture is the level's `background.src` with `data.fixup` applied, so
a level whose background is fixed up to a local asset prints that asset. A
level with no background prints nothing.

### type: place

**subType**:

- world: A self-contained whole in which places exist — a planet, plane, or realm.
- region: A bounded division of a world or larger region — continents, marches, uplands, provinces.
- settlement: A place where folk dwell together — cities, towns, villages, holdings, camps.
- site: A place significant by what was made or done there — ruins, monoliths, henges, works, battlefields.
- structure: A single building or habitation — halls, keeps, temples, inns, towers.
- feature: A place significant by its terrain — forests, rivers, falls, passes, fords.
- celestial: A body observed from a world rather than located on one — a sun, a planet, a comet.

| `data` property                   | Values                                                                           | Description                                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `events`                          | event entries — see [Events](#events)                                            | What happened to or at this subject: dated, attributed events                                             |
| `calendar`                        | `Address`                                                                        | Calendar note that prints this place's dates                                                              |
| `demonym`                         | `string`                                                                         | What a person from this place is called — a Vylarian                                                      |
| `purpose`                         | `placeCharacter` tag                                                             | The reason a settlement, site, or structure exists                                                        |
| `lore`                            | `Address[]`                                                                      | Lore concerning this place — its peoples, its law, its calendar, its history                              |
| `parents`                         | `Address[]`                                                                      | Enclosing places within which this place is located                                                       |
| `culture`                         | `Address`                                                                        | The people this place belongs to, naming a lore note with `subType: culture`                              |
| `population`                      | `number`                                                                         | Approximate population (precision 2 significant digits)                                                   |
| `government`                      | `Address` or `null` (default type: `affiliation`)                                | Governing affiliation; explicit null means complete anarchy. Omission warns only for positive population. |
| `market`                          | `number`                                                                         | Market class, 1 to 6 — what trade a settlement supports                                                   |
| `borders`                         | `{ to, bearing }[]`                                                              | Places sharing a frontier with this one, and where each lies from here                                    |
| `borders[].to`                    | `Address`, required                                                              | The other place; the type defaults to `place`                                                             |
| `borders[].bearing`               | `N`, `NE`, `E`, `SE`, `S`, `SW`, `W` or `NW`, required                           | Where the other place lies from here                                                                      |
| `routes`                          | `{ to, bearing, mode, days, terrain?, leagues? }[]`                              | Journeys from this place's centre to another place                                                        |
| `routes[].to`                     | `Address`, required                                                              | The other place; the type defaults to `place`                                                             |
| `routes[].bearing`                | `N`, `NE`, `E`, `SE`, `S`, `SW`, `W` or `NW`, required                           | Where the destination lies from here                                                                      |
| `routes[].mode`                   | `land`, `boat` or `ship`, required                                               | How the journey is travelled                                                                              |
| `routes[].days`                   | `1`, `2`, `3`, `5`, `10`, `20`, `30`, `45`, `60`, `90`, `180` or `360`, required | About how many days the journey takes, under normal conditions                                            |
| `routes[].terrain`                | terrain names, in travel order                                                   | The terrains crossed, each crossable by the mode                                                          |
| `routes[].leagues`                | `number`                                                                         | The distance, in leagues                                                                                  |
| `world.equatorialCircumferenceKm` | `number`                                                                         | The distance round the body at its equator, in kilometres                                                 |
| `world.surfaceGravityG`           | `number`                                                                         | Surface gravity, as a multiple of Earth's                                                                 |
| `world.axialTiltDegrees`          | `number`                                                                         | The tilt of the axis, in degrees                                                                          |
| `year.days`                       | `number`                                                                         | How many days the body's year holds                                                                       |
| `year.hoursPerDay`                | `number`                                                                         | How many hours the day divides into                                                                       |
| `year.minutesPerHour`             | `number`                                                                         | How many minutes the hour divides into                                                                    |
| `year.secondsPerMinute`           | `number`                                                                         | How many seconds the minute divides into                                                                  |
| `present`                         | `date`                                                                           | The day the setting stops and play begins                                                                 |
| `body.diameterKm`                 | `number`                                                                         | The body's diameter, in kilometres                                                                        |
| `body.orbitalRadiusKm`            | `number`                                                                         | How far it orbits from the body it circles, in kilometres                                                 |
| `body.orbit`                      | `string`                                                                         | The orbit's shape — `circular` means the cycle never varies                                               |
| `body.inclined`                   | `boolean`                                                                        | Whether the orbit is inclined to the plane the world orbits in                                            |
| `moon.cycle`                      | `number`                                                                         | How many days it takes to return to the same phase                                                        |
| `moon.newOn`                      | day-precision `date`                                                             | A day it was new, written in the reference calendar                                                       |
| `moon.eclipses`                   | `string`                                                                         | `never`, `rare`, `occasional` or `frequent`                                                               |

#### Why a place exists

`data.purpose` selects one of the place's own `placeCharacter` tags. It is
optional on settlements, sites, and structures. A mining settlement on a coast
can carry `tags: [mining, coastal]` and `data.purpose: mining`: the coast locates
it; the mine explains its existence. The value must belong to the declared
`placeCharacter` vocabulary and also appear among that note's tags. The tags
include `ford`, `portage`, `pass`, and `well` for places founded around a crossing,
a break in navigation, a mountain route, or scarce water. The body explains the
specific history; the selected tag gives tables a consistent grouping value.

#### What a body states about itself

**The four groups above are the world's own facts, and they are legal on a
`world` or a `celestial` note and nowhere else.** A region, a settlement, a
site, a structure or a feature is somewhere _within_ a world and says nothing
about the world's year.

```yaml
# the world — type: place, subType: world
data:
  world: { equatorialCircumferenceKm: 40000, surfaceGravityG: 1.0, axialTiltDegrees: 23.5 }
  year: { days: 365, hoursPerDay: 24, minutesPerHour: 60, secondsPerMinute: 60 }
  present: 720

# its moon — a note of its own, because a moon is a body and not a property
data:
  body: { diameterKm: 3800, orbitalRadiusKm: 388600, orbit: circular, inclined: true }
  moon: { cycle: 30, newOn: "720.1", eclipses: rare }
```

**`year.days` is where the year's length lives, and every calendar in the
package is compiled against it.** A package whose notes state no `year` has no
calendar mechanism at all: no sum is checked, and nothing is emitted. That is
the right answer for a package building a setting whose world facts somebody
else wrote down.

**One year and one moon to a package.** Two years is two settings and nothing
can say which one a calendar divides; a `moon` with no `year` anywhere is
refused, because a cycle counted in days has no year to be measured against.

**`present` is the day an age is computed against**, written in the grammar a
note's dates are written in, so a setting whose present is best said in an era
says it that way.

**`world.axialTiltDegrees`, the circumference, the gravity, the moon's diameter
and its orbital radius are read by nobody.** They are there so a reader knows
what kind of world this is. What the build consumes is the year, the day's
divisions, the present, the moon's cycle and epoch, and whether its orbit is
circular and inclined.

#### What a settlement's market supports

`population` states how many people a settlement holds; `market` states what a
traveller can buy there. Those are different questions — two settlements of
eight hundred are a different proposition when one holds a weekly market and
the other a chartered fair with a moneylender — so a note states both, either,
or neither.

The value is a **class**, not a measurement. The numbers order six steps and do
nothing else: a `5` is not a market two fifths larger than a `3`, it is a city
rather than a town. `package-build lint` refuses a value off the scale instead
of rounding it onto one, so a reader can trust that a number means the same
thing on every page.

| `market` value | the settlement is | what can be had there                                                                             |
| -------------- | ----------------- | ------------------------------------------------------------------------------------------------- |
| `1`            | a hamlet          | no market — what neighbours trade among themselves                                                |
| `2`            | a village         | a weekly market: staples, a smith, what a household cannot make                                   |
| `3`            | a town            | a regular market, most common goods, several trades working full time                             |
| `4`            | a market town     | a chartered fair, goods carried from a week away, a moneylender                                   |
| `5`            | a city            | anything ordinary, in quantity; foreign goods; a guild structure                                  |
| `6`            | a great city      | the rare and the imported as a matter of course; banking; the market from which other markets buy |

The key is meaningful on a settlement, and the lint checks no `subType`
condition — as it checks none for `population`. Which places a fact says
something about is the author's judgement, and the `data:` container is closed
per type rather than per subType.

#### Where a place is, in relation to other places

`parents` states what a place is **within**. Two more properties state what
it is **next to** and what it is **reachable from**, as data rather than as
prose, so that two notes describing one frontier cannot quietly disagree about
which side of it each is on:

```yaml
data:
  borders: # places sharing a frontier
    - { to: dunharargn, bearing: NE } # both required
    - { to: bethuargn, bearing: W }
  routes: # journeys from this place's centre
    - { to: steinmark, bearing: SW, mode: land, days: 3, terrain: [road, mountains] }
    - { to: denizara, bearing: W, mode: ship, days: 5 }
    - { to: kethramir, bearing: E, mode: land, days: 30, terrain: [dunes], leagues: 90 }
```

- `to` — required; an `Address` naming the other place. Its type segment defaults
  to `place` and `place` is the whole of its accepted set, so `vylar`,
  `place-vylar` and `thalorna-none-place-vylar` name one place and a `to` naming
  anything else is an error. **A bare shortcode names a place in this package**,
  which is what the fully qualified form is for: naming a place in a declared
  dependency's index, so two packages using one shortcode never answer for each
  other.
- `bearing` — required; where the neighbour or the destination lies from here.
- `mode` — required on a route; how the journey is travelled.
- `days` — required on a route; a marker meaning "about this, under normal
  conditions", from the scale below. Any other value is an error.
- `terrain` — optional on a route; the terrains crossed, in travel order, from
  the registry below. Each terrain names the modes that cross it, so open sea
  on a land route — or a road on a ship route — is an error.
- `leagues` — optional on a route; a distance, only where the note states one.

**A border is a shared frontier between areas.** Regions commonly state one;
a settlement does so only when it actually shares a frontier with another
place. Most settlements use `parents` for where they sit and `routes` for
journeys between them. A pair appears in `routes` once per `mode` — a port and its
neighbour may be three days by land and one by ship — and in `borders` once.
**A place never borders its own parent or child**: containment is `parents`,
and restating it as adjacency makes the two contradict each other.

**Both ends state the relation, and `package-build lint` checks that they
agree.** A border at `NE` from one side is a border at `SW` from the other; a
route stated by land in three days from one side is stated by land in three
days from the other, at the opposite bearing. A neighbour that states nothing
back is a warning naming both notes — the pair is half-written, not wrong. A
neighbour that states a different bearing, a different `days` or a different
`mode` is an error, because one of the two notes is wrong and a reader cannot
tell which. Every `to` must resolve to a place, every value must come from its
closed set, and each finding is located at the entry that states it.

The terrain names form one shared registry in package-build. A route crossing
a package boundary uses the same terrain and mode rules at both ends.

For every place that participates in a border or route, the map builder draws
an itinerary from that place. A site page carries it as a linked SVG. A PDF
book that includes the place gives its map a separate full page after the
entry. Places with no relations create no itinerary output.

**A relation that crosses a package boundary is written in full at both ends.**
An omitted `<package>` segment is the package being built, in whatever note the
value is read from — a note of this package's own, or a record a consumer fetched
out of a dependency's index — so a short `to` names a different place in a
different build. Only the fully qualified form names one place everywhere, which
is why the long form is not optional for a border or a route between packages,
and why a short `to` in a fetched record names the package being built rather
than the package that wrote it.

| `bearing` value | where the other place lies |
| --------------- | -------------------------- |
| `N`             | north                      |
| `NE`            | north-east                 |
| `E`             | east                       |
| `SE`            | south-east                 |
| `S`             | south                      |
| `SW`            | south-west                 |
| `W`             | west                       |
| `NW`            | north-west                 |

| `mode` value | travelled                    |
| ------------ | ---------------------------- |
| `land`       | on foot, mounted, or by cart |
| `boat`       | on a river or a lake         |
| `ship`       | on open sea                  |

| `days` value | meaning                                      |
| ------------ | -------------------------------------------- |
| `1`          | a day                                        |
| `2`          | two days                                     |
| `3`          | three days                                   |
| `5`          | about five days                              |
| `10`         | a ten-day week                               |
| `20`         | two ten-day weeks                            |
| `30`         | three ten-day weeks                          |
| `45`         | a month and a half                           |
| `60`         | two months                                   |
| `90`         | a season                                     |
| `180`        | many months                                  |
| `360`        | who knows — a journey nobody reckons in days |

| `terrain` value | crossed by         |
| --------------- | ------------------ |
| `road`          | land               |
| `track`         | land               |
| `plain`         | land               |
| `steppe`        | land               |
| `hills`         | land               |
| `mountains`     | land               |
| `forest`        | land               |
| `jungle`        | land               |
| `marsh`         | land               |
| `dunes`         | land               |
| `desert`        | land               |
| `ice`           | land               |
| `coast`         | land, boat or ship |
| `open-sea`      | ship               |
| `river`         | boat               |
| `lake`          | boat               |

#### What lies within a place

`parents` states what a place is within. The website reads this across the package and every fetched index and writes `contains`: every place whose `parents` names this one, sorted by `subType` then `title`. Each entry is `{ title, url, type, subType }`; the list is omitted when empty. A region lists its settlements, sites, structures and features; a settlement lists its structures. Government never changes this geographical containment.

#### Who governs a place

A place may state its governing affiliation in `data.government`. The field type is `Address`, with `affiliation` as the default target type when the type is omitted. Use either a local shortcode or a fully qualified affiliation Address from this package or a fetched dependency:

```yaml
data:
  population: 1200
  government: crown
```

Write `government: null` for **complete anarchy**. Omitting the key leaves government unspecified. Null is retained in published metadata and displayed as “Complete anarchy” in website, Foundry and book infoboxes; an omitted key has no Government row. A reference displays a link to the governing affiliation.

| Population            | Government          | Governance advisory              |
| --------------------- | ------------------- | -------------------------------- |
| Positive              | Omitted             | Warning at `data.population`     |
| Missing, zero or null | Omitted             | None                             |
| Any                   | Explicit `null`     | None; complete anarchy           |
| Any                   | Affiliation Address | None; the reference must resolve |

These rules apply to every place subtype, including settlements, sites, structures, features, regions and worlds. Empty strings, numbers, lists, maps, references to another note type and unresolved references are errors. They do not declare anarchy. `parents`, containment and capitals do not supply a government.

#### Population figures

`population` is an approximate count, written to two significant digits. A
place states one, and so does an affiliation — how many people it counts,
wherever they are. `package-build lint` reads those figures against each other
and reports three warnings, each named by the phrase its message begins with.

- **`over-full region`** — the regions whose `parents` name a place count more
  people than the place states. A region naming both its parent and its
  grandparent counts under the nearer of the two, so a place written into two
  levels of the hierarchy is not counted at both.
- **`oversized settlement`** — a settlement states more people than a place
  containing it does, whether its own region or any place above that.
- **`disputed figure`** — a `doc` note carries a figure beside a wikilink to
  the place or affiliation it belongs to, and the two disagree. The finding is
  located at the number the page wrote, and a figure written twice is located
  twice.

The first two are reported on the note's own `data.population`; the third
on the citation.

**A figure is read as a population only where it carries `~`.** That marker is
what separates a population from the other numbers a table puts beside a place
— a distance, a stage count, a tally of days — so `| [[place-rgn\|X]] | ~2,000 |`
is a claim about people and `| [[place-rgn\|X]] | 3 |` is not.

**Rounding is admitted.** Two significant digits carry a half-unit of error,
widest at the bottom of a decade, so a place whose figure falls up to five per
cent below what it contains is not a finding.

**An unstated figure is silent.** A place or affiliation with no `population`
contributes nothing to a sum and is never the subject of a finding, so a
half-written region is quiet rather than noisy. A fetched index carries
`population` alongside `parents` and `government` when its author stated a
figure. An older fetched index with no figure remains silent.

**There is deliberately no urban-share rule.** The share of a region's people
living in its named settlements cannot be measured from the notes: the
settlement layer names the notable places and is complete nowhere, so the ratio
reports how much of a region has been written rather than how much of it is
urban.

**A place declares what is true of its ground.** It names its governing affiliation
in `data.government`; maps name the place they depict through `data.place`.
A place may name the people it belongs to in `data.culture`. A place that names
none takes its culture from its `data.parents`, so a region states the culture
once and the districts and settlements inside it carry it without repeating it;
[Culture in the index](#culture-in-the-index) gives the rule and a worked
example.
The place's `lore` links cover its peoples, calendar, law and history. Political
languages belong to a polity's `sohl.system.commonSkills`, while the note's
`description` provides its page summary.

#### A region's settlements table

A region lists its settlements in a table on its own note: one row for each
settlement, stating what its market is, how many people it holds and who holds
it. **A row is the whole record of a settlement that has no note.** Where a
note exists the row links it, and the two must agree. A package that writes no
such table is not affected by anything in this section.

The table is a markdown table under a level-two `## Settlements` heading on the
region's `place` note. Its header is exactly these columns, in this order. `For`
may be left out; the header carries no other column:

| Name | Market | People | Held by | For |
| ---- | ------ | ------ | ------- | --- |

- **Name** — the settlement. Where it has a note, a link to it with the pipe
  escaped for the table, `[[place-ashford\|Ashford]]`; otherwise plain text.
- **Market** — the market class as its number and its name, lower case:
  `1 hamlet`, `2 village`, `3 town`, `4 market town`, `5 city`, `6 great city`.
  The scale is the one [`data.market`](#what-a-settlements-market-supports)
  states.
- **People** — the population, a whole number, grouped with commas or not:
  `60`, `420`, `3,400`.
- **Held by** — who holds it, written in the region's holding model. Link the
  holder where it has a note.
- **For** — a short phrase saying why the place is there: the ford, the mine,
  the shrine.

At least one sentence of prose follows the table, before the next heading,
saying what the table leaves out. A section filled by an `sql` fence is
generated from the notes and is not read as a settlements table.

**The region names its holding model as a tag.** A note carrying a settlements
table carries at least one of these tags; a region whose countryside is held
two ways carries both. Tags stay open, so a misspelled model is not reported as
such: the table's note is reported for naming no model.

| `holdingModel` value | the Held by cell names |
| -------------------- | ---------------------- |
| `held`               | a person or a house    |
| `endowed`            | an institution         |
| `registered`         | an office              |
| `kin`                | a kindred              |
| `polis`              | the city               |

A linked holder is an `affiliation` or a `being`, and a `being` is a person: it
may hold land only in a region tagged `held`.

**A settlement belongs to one table** — that of the nearest place above it, by
`parents`, that carries a settlements table. Every `settlement` note that table
covers has a row there and nowhere else.

A worked example. `Vale.md`:

```markdown
---
shortcode: vale
name: { full: The Vale }
type: place
subType: region
tags: [region, held]
data:
  population: 100000
  government: crown
---

## Settlements

| Name                       | Market        | People | Held by                                  | For                        |
| -------------------------- | ------------- | -----: | ---------------------------------------- | -------------------------- |
| [[place-ashford\|Ashford]] | 4 market town |  3,400 | [[affiliation-crown\|the Crown]]         | the ford on the drove road |
| Weyshott                   | 2 village     |    420 | [[being-aldwyn\|Sir Aldwyn of Brynwold]] | the manor's mill           |
| Cold Hatch                 | 1 hamlet      |     60 | Sir Aldwyn of Brynwold                   | the sheepwalk              |

Some four hundred further villages lie in the vale, none of them named here.
```

`Ashford.md` states `parents: [vale]`, `population: 3400` and `market: 4`, so its
row agrees with it. Weyshott and Cold Hatch have no notes; their rows are their
whole record. Change Ashford's row to `3,000` and `package-build lint` reports:

```text
assets/content/Vale.md:16:49: error: figure disagrees: Ashford is carried at 3,000 here and 3,400 on its own note
```

`package-build lint` reports each of these as an error, each named by the
phrase its message begins with:

- **`settlements columns`** — the header is not the declared columns in
  order. The table's rows are not read until it is.
- **`no holding model`** — the note carries a settlements table and none of
  the holding-model tags. Reported at its `tags`.
- **`market class`** — a Market cell is not a class written as its number and
  its name.
- **`people figure`** — a People cell is not a positive whole number.
- **`no holder`** — a Held by cell is empty.
- **`not a holder`** — a Held by link names a note that is neither an
  affiliation nor a being.
- **`holder out of model`** — a Held by link names a being in a region not
  tagged `held`.
- **`not a settlement`** — a Name link names a note that is not a place.
- **`figure disagrees`** — a linked row's People differs from its note's
  `data.population`, or the note states none.
- **`market disagrees`** — a linked row's Market differs from its note's
  `data.market`, or the note states none.
- **`unlinked settlement`** — an unlinked Name is the name or an alias of a
  settlement note the table covers. The finding gives the link to write.
- **`missing row`** — a settlement note the table covers has no row. Reported
  at the table's header.
- **`duplicate settlement`** — a settlement has a second row in one table, or
  a row in a table other than the one covering it.
- **`no tail`** — no sentence follows the table before the next heading.
  Reported at the table's last row.

A cell's finding is located at the cell. A link in a cell that resolves to no
note is reported by the link check, once, and not again here.

### type: scenario

Content prepared to be played — a situation with its cast, places, and possible outcomes.

**subType**:

- campaign: A long arc toward a goal, spanning many adventures — carries standing cast, factions, and its own timeline.
- adventure: A self-contained undertaking with a specific objective, playable in a few sessions.
- encounter: A single scene or challenge, reusable within an adventure or on its own.

| `data` property    | Values                                       | Description                                                                    |
| ------------------ | -------------------------------------------- | ------------------------------------------------------------------------------ |
| `parents`          | `Address[]`                                  | List of parent scenarios of this scenario (campaigns, etc.)                    |
| `locations`        | `Address[]`                                  | List of locations associated with this scenario                                |
| `cast`             | `Address[]`                                  | individuals associated with this scenario                                      |
| `factions`         | `Address[]`                                  | Affiliations associated with this scenario                                     |
| `follows`          | `Address[]`                                  | Prerequisite scenarios that should be completed before beginning this scenario |
| `status`           | `draft \| playtested \| published`           | Playability status of this scenario                                            |
| `party.size`       | `solo \| small \| standard \| large \| host` | Suggested party size (solo=1, small=2-3, standard=4-6, large=6-7, host=7+)     |
| `party.archetypes` | `Archetype[]`                                | Archetypes of characters suitable for completion                               |

### type: doc

**subType**:

- rules: The rules of the game, independent of medium — valid at a table with paper and dice.
- userguide: How to operate the Foundry implementation to play by the rules.
- reference: Out-of-world lookup material about the setting or system — correspondences, conversions, glossaries.
- howto: A task with an outcome, written as the steps that reach it.
- concept: An explanation of how something works and why it is shaped that way, read to understand rather than to follow.
- settingguide: A culture's guide to the setting, which names its culture in `data.culture`. It orients a reader to a setting or region, bringing its places, peoples, institutions, and daily life into one usable frame with links to detailed notes.

| `data` property | Values    | Description                                                                                                           |
| --------------- | --------- | --------------------------------------------------------------------------------------------------------------------- |
| `culture`       | `Address` | `settingguide` only, and required there: the culture the guide introduces, naming a lore note with `subType: culture` |

A setting guide introduces one culture's view of the setting, so it names that
culture, and a `doc` of any other `subType` has no culture of its own to name.
A setting guide without `data.culture` is an error at its `subType:` line;
`data.culture` on any other `doc` subType is an error at its key. The value
names a `lore` note of `subType: culture`, and a setting guide's culture is the
one it states: it inherits nothing, because a `doc` has no `data.parents`. The
other notes that may state a culture are described under
[`place`](#type-place), [`affiliation`](#type-affiliation) and
[`lore`](#type-lore), and [Culture in the index](#culture-in-the-index) gives
the value each one reads as.

Choose `settingguide` for an entry point that stands on its own while guiding
players and GMs into a setting. A `concept` explains one subject, a `reference`
supports lookup, and a `userguide` explains how to operate the Foundry
implementation. The setting guide can use ordinary SQL content tables and
`:::secret` passages; its genre does not change its Address, journal, or page
rendering.

```markdown
---
shortcode: reedflatsguide
name: { full: The Reed Flats Guide }
type: doc
subType: settingguide
description: A starting point for adventures in the Reed Flats.
data:
  culture: lore-reedfolk
---

The Reed Flats are a network of marsh settlements linked by river trade.
Their routes, customs, and rival groups shape everyday journeys.

:::secret
The old ferry route is known to the local guides.
:::
```

The field is a genre and only a genre: it says what kind of page this is, never
who reads it. A page written for a developer is a `howto` or a `concept` like
any other, and the audience is the section it sits in.

**A page that introduces a type is an ordinary note, named by convention.**
Write `type: doc`, `subType: reference`, `shortcode: <type>` — so the
affiliations introduction is `doc-affiliation`, addressed and linked like
anything else, and typically carrying a generated table of what it introduces.
It has no build path of its own, and it is the only kind of index there is: a
site is its homepage and its pages, and nothing is generated between them.

There is no landing page and no section. A section appears in **no address**: a
page publishes at `/<package>/<type>-<shortcode>/`, which names no directory. A
section is what Hugo calls a content directory, and the note format does not
carry one.

So a `doc`'s `subType` is a **genre** and nothing else, closed to the values
above.

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
`[[macro-autoattack#script]]` still opens exactly this page. The fence must
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

**`macroType: chat` is an error, not an unimplemented feature.** A chat macro's
`command` is chat text rather than source, so none of the `{#script}` fence
rules describe it, and compiling one through this path would ship a macro whose
body was a code block posted verbatim into chat. Chat macros as content would
need an authoring convention of their own.

The note's `data.icon` resolves the way every other note's does; a note that
authors none takes Foundry's own `icons/svg/dice-target.svg`.

### type: bundle

A bundle of notes to be taken as a single unit — an `Adventure` in Foundry VTT.

| `data` property | Values      | Description                                            |
| --------------- | ----------- | ------------------------------------------------------ |
| `contents`      | `Address[]` | The documents the Adventure holds; `[]` when unstated. |

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
bundle when the bundle names its `note` Address:
`sohl-miscgear-bowlcer` is the Item, `miscgear-bowlcer` its description page.

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

Foundry's `Folder` groups compiled documents. A folder note supplies its name, parent, and color. Packs name folder notes by Address.

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

| `data` property | Values                                    | Description                                                                    |
| --------------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| `parent`        | `Address`, or a map of them keyed by pack | The folder this one sits in — one address, or one per pack. Unset at the root. |
| `color`         | `"#RRGGBB"`, a string                     | The folder's colour. Unset for Foundry's default.                              |

A folder is addressed `<package>-none-folder-<shortcode>` — **`none`**, because a
`Folder` is a core Foundry document like a `JournalEntry` or a `Scene`, not a
system's. Its shortcode is [an address segment](#the-canonical-address) like
every other, so it is strictly lowercase alphanumeric: `possessionscooking`,
never `possessions-cooking`, which would read as two segments and resolve to
nothing.

**`color` must be quoted**, and YAML gives no third option: `color: #7a4b2a`
parses as `null` (a `#` after a space opens a comment) and `color: 000000` parses
as the number `0`. Write `"#RRGGBB"` to retain the string.

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

**A folder note requires a body.** Its body does not
produce a documentation journal or take part in `docEntryTypes`.
In a compiled Foundry journal, a wikilink to a folder prints its label as text:
the folder can materialise in several packs and has no single compendium UUID.

**It declares no pack.** Which packs a folder materialises in is derived from
[what references it](#the-compendium-folder), and its ancestors materialise with
it; a folder nothing references materialises nowhere.

**Its Foundry `_id` is derived from its address**, stable across runs, so a new
folder needs no invented id. An authored `id` is kept where one is present —
which is what lets a tree sweep its folder YAML into notes without a world that
already holds those folders losing them. Two folders claiming one id is a build
error.

The derivation is `makeId("folder", "<package>-none-folder-<shortcode>")`, and
the namespace is **`folder`**, not the `document` one [every other note hashes
under](#the-document-id): a folder and an item sharing a shortcode would
otherwise derive the same id, and Foundry keys the two in separate collections
so neither would complain. The content index publishes this value, so a consumer
reads a folder's id rather than recomputing one.

### Word classes

A word names its word class as a base followed by zero or more
modifiers, separated by spaces: `n I f` is a noun of class I, feminine. The
first token is always the base, so `n n` is a neuter noun. A hyphen does not
separate tokens, and `n-coll` is refused; the collective noun is `n coll`.

A base is one of these. A base marked `no` never prints in the glossary.

| Base   | Abbreviation | Expansion       | In the glossary |
| ------ | ------------ | --------------- | --------------- |
| `n`    | n.           | noun            | yes             |
| `v`    | v.           | verb            | yes             |
| `adj`  | adj.         | adjective       | yes             |
| `adv`  | adv.         | adverb          | yes             |
| `pron` | pron.        | pronoun         | yes             |
| `num`  | num.         | numeral         | yes             |
| `part` | ptcl.        | particle        | yes             |
| `art`  | art.         | article         | yes             |
| `conj` | conj.        | conjunction     | yes             |
| `dem`  | dem.         | demonstrative   | yes             |
| `rel`  | rel.         | relative marker | yes             |
| `call` | call         | call            | yes             |
| `name` | —            | proper name     | no              |
| `stem` | —            | bound stem      | no              |
| `pref` | —            | prefix          | no              |

A modifier is one of these. The neuter prints `nt.`, because `n. n.` would show
the base and the gender identically. An expansion beginning `of` follows its
base without a comma, so `n I f` reads "noun of class I, feminine".

| Modifier | Group       | Abbreviation | Expansion                 |
| -------- | ----------- | ------------ | ------------------------- |
| `m`      | gender      | m.           | masculine                 |
| `f`      | gender      | f.           | feminine                  |
| `n`      | gender      | nt.          | neuter                    |
| `an`     | animacy     | anim.        | animate                   |
| `in`     | animacy     | inan.        | inanimate                 |
| `coll`   | number      | coll.        | collective                |
| `I`      | declension  | I            | of class I                |
| `II`     | declension  | II           | of class II               |
| `III`    | declension  | III          | of class III              |
| `IV`     | declension  | IV           | of class IV               |
| `V`      | declension  | V            | of class V                |
| `hal`    | declension  | hal.         | of the hallowed class     |
| `â`      | conjugation | â            | of the first conjugation  |
| `ê`      | conjugation | ê            | of the second conjugation |
| `i`      | conjugation | i            | of the third conjugation  |
| `c`      | conjugation | c            | of the fourth conjugation |
| `dep`    | voice       | dep.         | deponent                  |
