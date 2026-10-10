---
shortcode: referencenotetypes
name: { full: "Note types and fields" }
type: doc
subType: reference
---

# Note types and fields

Choose a note's `type` for the subject it describes. Use `subType` when its type declares a more specific genre. Field rules are declared in `engine/note-vocabulary.mjs`; mapping claims and closed vocabularies are recorded in `engine/content-format.yaml`. This page is checked against both declarations.

The [first-note guide](../authoring/first-note.md) teaches the shape of a note. [Frontmatter](../authoring/frontmatter.md) explains shared and system-specific values. The [detailed reference](format-details.md) gives the full behavior and examples.

## Top-level keys

These are the only keys a note writes at its top level, in the order the formatter puts them. A key absent from this table is a lint error at its own line: the region is closed, so the key reaches no document and no page. Facts about the subject belong under `data`, and values for one game system belong inside that system's block.

| Key           | Meaning                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------- |
| `shortcode`   | The note's own address segment, unique within its type.                                   |
| `name`        | The display names — a required `full`, and any `aliases`.                                 |
| `type`        | What the note is about, which decides its vocabulary and its document.                    |
| `subType`     | The type's own genre, where it declares one.                                              |
| `description` | The short page summary.                                                                   |
| `tags`        | Draft state, GM routing, and the descriptive labels a page list reads.                    |
| `data`        | The facts about the subject itself, shared by every system.                               |
| `dnd5e`       | What the `dnd5e` system makes of the subject — its document's mechanics, routing and art. |
| `hm3`         | What the `hm3` system makes of the subject — its document's mechanics, routing and art.   |
| `sohl`        | What the `sohl` system makes of the subject — its document's mechanics, routing and art.  |

## Shared `data` fields

These fields are accepted by every note type. A field's value can still be irrelevant to a particular output; the build reports that where it can.

| Field             | Shape                                           | Meaning                                                                                    |
| ----------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `data.id`         | string                                          | A fixed document identity when the derived identity is unsuitable.                         |
| `data.pack`       | string                                          | The shared compendium route, with a system block overriding it.                            |
| `data.packFolder` | an Address, or a map of Addresses keyed by pack | The shared compendium folder Address, with a system block overriding it.                   |
| `data.harnworld`  | `{ realm?, ritual? }`                           | HârnWorld source details shared by every system — `realm` and `ritual`.                    |
| `data.icon`       | an Address                                      | The document's profile art — an `icon` address, resolved into `img`.                       |
| `data.banner`     | an Address                                      | The page's hero image — an `image` address, cut to 1792×768. Reaches no compiled document. |

**Inner keys** — a key a field's value does not declare is an error at its own line and column.

| Key                     | Shape           | Required | Meaning                                       |
| ----------------------- | --------------- | -------- | --------------------------------------------- |
| `data.harnworld.realm`  | a string        | no       | The HârnWorld realm the subject belongs to.   |
| `data.harnworld.ritual` | list of strings | no       | The HârnWorld religions the subject observes. |

## Type-specific fields

### being

**Subtypes:** `npc`, `character`, `creature`.

| Field                            | Shape                                                   | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data.tokenIcon`                 | an Address                                              | What a token on the canvas wears — an `icon` address; unset, it follows `icon`.                                                                                                                                                                                                                                                                                                                                                     |
| `data.templatePriority`          | number                                                  | Template priority; unset means the note is not a template.                                                                                                                                                                                                                                                                                                                                                                          |
| `data.archetypes`                | list of strings                                         | Archetypal behaviours the being fits.                                                                                                                                                                                                                                                                                                                                                                                               |
| `data.occupation`                | string                                                  | What the being does for a living.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `data.stations`                  | list of Addresses                                       | Stations the being holds.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `data.lore`                      | list of Addresses                                       | Lore concerning this being — the law it lives under, the customs it is subject to, the traditions it was raised in.                                                                                                                                                                                                                                                                                                                 |
| `data.culture`                   | an Address                                              | The being's primary culture, as a culture lore note.                                                                                                                                                                                                                                                                                                                                                                                |
| `data.homes`                     | list of Addresses                                       | Places the being calls home.                                                                                                                                                                                                                                                                                                                                                                                                        |
| `data.affiliations`              | a standing map keyed by Address, or a list of Addresses | Bodies the being belongs to, keyed by Address, each entry holding the standing it holds there — `rank`, required, a level on that body's own ladder, and `office`, optional, a post that body names.                                                                                                                                                                                                                                |
| `data.socialTies`                | a map keyed by Address                                  | Defining ties directed from this being to others: `patron` (Supports the subject from greater power, wealth, or status.); `friend` (Supports the subject out of goodwill.); `dependent` (Relies on the subject's support or protection.); `acquaintance` (Knows the subject without a strong disposition.); `rival` (Opposes the subject without implacable hostility.); `nemesis` (Opposes the subject personally and implacably.) |
| `data.gender`                    | string                                                  | One of `male`, `female`, `nonbinary`, `none` or `other`. `none` says the being has no gender; an absent field says its gender is unrecorded.                                                                                                                                                                                                                                                                                        |
| `data.species`                   | an Address                                              | The being's species, as a lore note.                                                                                                                                                                                                                                                                                                                                                                                                |
| `data.born`                      | string                                                  | When the being was born — a date, or `unknown` where the birth is unrecorded. Absent, the being was never born.                                                                                                                                                                                                                                                                                                                     |
| `data.calendar`                  | an Address                                              | Calendar used to display this being's dates.                                                                                                                                                                                                                                                                                                                                                                                        |
| `data.died`                      | string                                                  | When the being died — a date, or `unknown` where the death is unrecorded. Absent, the being is alive.                                                                                                                                                                                                                                                                                                                               |
| `data.age`                       | string                                                  | Age in years, stated only to override what `born` says — `34`, or `~34` for an estimate. Unstated beside a dated `born` it is computed; unstated beside an unknown or absent `born` the age is unknown.                                                                                                                                                                                                                             |
| `data.ageYears`                  | number                                                  | Written by the compiler beside an `age` estimate — the `~` stripped, the magnitude alone. A note never authors this.                                                                                                                                                                                                                                                                                                                |
| `data.height`                    | metres or feet and inches                               | Height in metres or feet and inches.                                                                                                                                                                                                                                                                                                                                                                                                |
| `data.weight`                    | kilograms or pounds                                     | Body weight in kilograms or pounds.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `data.frame`                     | string                                                  | Relative frame — one of `scant`, `light`, `medium`, `heavy` or `massive`.                                                                                                                                                                                                                                                                                                                                                           |
| `data.appearance.eye_color`      | string                                                  | Eye colour.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `data.appearance.hair_color`     | string                                                  | Hair colour.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `data.appearance.skin_color`     | string                                                  | Skin colour.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `data.appearance.complexion`     | string or list                                          | The skin's condition — one value, or several, because a face carries more than one at once. A single value means a list of one.                                                                                                                                                                                                                                                                                                     |
| `data.appearance.extra_features` | list of strings                                         | Anything else a stranger would notice.                                                                                                                                                                                                                                                                                                                                                                                              |

**Inner keys** — a key a field's value does not declare is an error at its own line and column.

| Key                                  | Shape                                                                                                                        | Required | Meaning                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------- |
| `data.affiliations.<Address>.rank`   | the level on that body's own ladder, as a whole number — an ordinary member is `1`, and `0` is the rung for someone cast out | yes      | The level on the body's own `governance.ranks` ladder.                |
| `data.affiliations.<Address>.office` | a post from that body's `governance.offices`                                                                                 | no       | A post the body names in its `governance.offices`, where one is held. |

**System mappings**

| Source            | System | Target              |
| ----------------- | ------ | ------------------- |
| `data.gender`     | hm3    | `system.gender`     |
| `data.occupation` | hm3    | `system.occupation` |

### homepage

**Subtypes:** None.

| Field | Shape | Meaning                         |
| ----- | ----- | ------------------------------- |
| —     | —     | No type-specific `data` fields. |

### vehicle

**Subtypes:** Open vocabulary.

| Field                   | Shape      | Meaning                                                                         |
| ----------------------- | ---------- | ------------------------------------------------------------------------------- |
| `data.tokenIcon`        | an Address | What a token on the canvas wears — an `icon` address; unset, it follows `icon`. |
| `data.templatePriority` | number     | Template priority; unset means the note is not a template.                      |

### affiliation

**Subtypes:** `guild`, `order`, `polity`, `faithtradition`, `arcanetradition`, `spirittradition`, `lineage`, `venture`, `criminal`, `governmental`, `fellowship`.

| Field                     | Shape                                          | Meaning                                                                                                                              |
| ------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `data.templatePriority`   | number                                         | Template priority; unset means the note is not a template.                                                                           |
| `data.events`             | list of event entries                          | What happened to or at this subject — each entry one dated, attributed event: a founding, a war, a fall, or an occasion that recurs. |
| `data.demonym`            | string                                         | What one member is called — a Vylarian.                                                                                              |
| `data.epithet`            | string                                         | The by-name it is known by — a god's, an order's, a company's.                                                                       |
| `data.symbol`             | string                                         | Its emblem in words: a feather atop a golden scale, a chisel carving a star.                                                         |
| `data.governance.model`   | string                                         | How the affiliation is governed, where it is.                                                                                        |
| `data.governance.summary` | string                                         | A sentence on how the governance actually works.                                                                                     |
| `data.governance.ranks`   | list of `{ level, title, description, lore? }` | The ladder of ranks the body confers — level, title, description.                                                                    |
| `data.governance.offices` | a map of named offices                         | Named offices, each with a description and optional dated holders.                                                                   |
| `data.seat`               | an Address                                     | Where the affiliation's authority sits.                                                                                              |
| `data.population`         | number                                         | How many people it counts.                                                                                                           |
| `data.economy`            | list of Addresses                              | What its economic life runs on — currencies, banking bodies, goods.                                                                  |
| `data.lore`               | list of Addresses                              | Lore concerning it — the peoples it draws on, the god a faith venerates, its law, its calendar.                                      |
| `data.parents`            | list of Addresses                              | Affiliations it is subordinate to.                                                                                                   |
| `data.culture`            | an Address                                     | The people this affiliation belongs to, as a culture lore note.                                                                      |
| `data.relations`          | a map keyed by Address                         | Standing with other affiliations — aligned, unaligned, rival, nemesis.                                                               |

**Inner keys** — a key a field's value does not declare is an error at its own line and column.

| Key                                                  | Shape                                                                                 | Required | Meaning                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `data.events[].id`                                   | an address segment                                                                    | no       | The event's name within its note — lowercase letters and digits.                 |
| `data.events[].kind`                                 | one `eventKind` value                                                                 | no       | What sort of thing happened.                                                     |
| `data.events[].depth`                                | one `depth` value                                                                     | no       | How far the event's history reaches.                                             |
| `data.events[].when`                                 | a date, or `"0.<day>"`                                                                | yes      | When it happened, or the anchor and first instance of an event that recurs.      |
| `data.events[].until`                                | a date                                                                                | no       | When a continuous event ended, or where a recurring series stopped.              |
| `data.events[].recurs`                               | `{ every }` or `{ on }`                                                               | no       | How further occurrences are found; absent for an event that happened once.       |
| `data.events[].recurs.every`                         | a whole number of years, 1 or more                                                    | no       | A period counted on the canonical axis from `when`.                              |
| `data.events[].recurs.on`                            | a list of dates, strictly increasing, each later than `when`                          | no       | Recorded occurrences beyond the first, in place of a period.                     |
| `data.events[].summary`                              | a string                                                                              | yes      | What happened, stated plainly.                                                   |
| `data.events[].standing`                             | one `standing` value                                                                  | no       | What the world's evidence supports.                                              |
| `data.events[].names`                                | `{ name, by, gloss? }[]`                                                              | no       | The event's names in the world, each with who uses it.                           |
| `data.events[].names[].name`                         | a string                                                                              | yes      | One name the event goes by in the world.                                         |
| `data.events[].names[].by`                           | an Address naming an `affiliation`, `lore`, `place`, `being` or `skill` note          | yes      | Who uses that name — a people, a polity, a faith, a place, a tongue.             |
| `data.events[].names[].gloss`                        | a string                                                                              | no       | What the name means, or how it is used.                                          |
| `data.events[].where`                                | `{ locus?, reach? }`                                                                  | no       | Where it happened, and where it was felt.                                        |
| `data.events[].where.locus`                          | a list of Addresses, each defaulting to `place`                                       | no       | Where the event physically happened; each resolves to a place.                   |
| `data.events[].where.reach`                          | `{ place, how, knowledge, attributedTo? }[]`                                          | no       | Where the event was felt, and whether each place knows why.                      |
| `data.events[].where.reach[].place`                  | an Address, defaulting to `place`                                                     | yes      | A place where the event was felt.                                                |
| `data.events[].where.reach[].how`                    | a string                                                                              | yes      | One clause: a consequence someone in that place could notice.                    |
| `data.events[].where.reach[].knowledge`              | one `knowledge` value                                                                 | yes      | Whether that place connects what it felt to this event.                          |
| `data.events[].where.reach[].attributedTo`           | an Address, defaulting to `lore`, naming an event or a `lore` note                    | no       | Only beside `knowledge: misattributed` — the cause that place names instead.     |
| `data.events[].who`                                  | `{ ref, role }[]`                                                                     | no       | Who took part, and as what.                                                      |
| `data.events[].who[].ref`                            | an Address naming a `being`, `affiliation` or `lore` note                             | yes      | A participant — a being, a people, an affiliation.                               |
| `data.events[].who[].role`                           | one `role` value                                                                      | yes      | What the participant was to the event.                                           |
| `data.events[].follows`                              | `{ event, how, note? }[]`                                                             | no       | The earlier events this one follows from.                                        |
| `data.events[].follows[].event`                      | an Address, defaulting to `lore`, anchored to an `event` where its note holds several | yes      | The earlier event; it resolves to exactly one event.                             |
| `data.events[].follows[].how`                        | one `followsHow` value                                                                | yes      | How this event follows from it.                                                  |
| `data.events[].follows[].note`                       | a string                                                                              | no       | One clause saying what connects the two.                                         |
| `data.events[].accounts`                             | `{ by, says, agrees, withholds? }[]`                                                  | no       | What each people, polity, faith or place says about it.                          |
| `data.events[].accounts[].by`                        | an Address naming an `affiliation`, `lore`, `place` or `being` note                   | yes      | Who holds the account.                                                           |
| `data.events[].accounts[].says`                      | a string                                                                              | yes      | What they say happened, in their terms.                                          |
| `data.events[].accounts[].agrees`                    | one `agrees` value                                                                    | yes      | How far their account agrees with `summary`.                                     |
| `data.events[].accounts[].withholds`                 | a string                                                                              | no       | What they decline to say.                                                        |
| `data.events[].unresolved`                           | a list of strings                                                                     | no       | What the world itself has not settled.                                           |
| `data.events[].sources`                              | a list of Addresses                                                                   | no       | The notes that state or support the event; each resolves.                        |
| `data.events[].stated`                               | `{ calendar, text }`                                                                  | no       | The date as one tradition writes it in its own reckoning.                        |
| `data.events[].stated.calendar`                      | an Address, or a lore shortcode                                                       | yes      | The calendar that tradition reckons in — a `lore` note with `subType: calendar`. |
| `data.events[].stated.text`                          | a string                                                                              | yes      | The date as that tradition writes it.                                            |
| `data.governance.ranks[].level`                      | a whole number — the rung's position on this body's own ladder                        | yes      | The rung's position on the ladder; a member's `rank` names it.                   |
| `data.governance.ranks[].title`                      | what the standing is called                                                           | yes      | What the standing is called.                                                     |
| `data.governance.ranks[].description`                | what the standing is                                                                  | yes      | What the standing is.                                                            |
| `data.governance.ranks[].lore`                       | a lore Address                                                                        | no       | Lore saying more about the standing than a description holds.                    |
| `data.governance.offices.<name>.description`         | a string                                                                              | yes      | What the office is.                                                              |
| `data.governance.offices.<name>.holders`             | a list of `{ being, start?, end?, contested? }`                                       | yes      | Who has held it, each with the dates of the term.                                |
| `data.governance.offices.<name>.holders[].being`     | a being Address                                                                       | yes      | Who held the office.                                                             |
| `data.governance.offices.<name>.holders[].start`     | a date                                                                                | no       | When the term began; unstated, it began before anything recorded.                |
| `data.governance.offices.<name>.holders[].end`       | a date                                                                                | no       | When the term ended; unstated, the being holds the office now.                   |
| `data.governance.offices.<name>.holders[].contested` | `true` or `false`                                                                     | no       | The term may overlap another holder's.                                           |

**System mappings**

| Source           | System | Target             |
| ---------------- | ------ | ------------------ |
| `subType`        | sohl   | `system.subType`   |
| `data.seat`      | sohl   | `system.seat`      |
| `data.parents`   | sohl   | `system.parents`   |
| `data.relations` | sohl   | `system.relations` |

### affliction

**Subtypes:** `disease`, `poisontoxin`, `maladiction`.

| Field                              | Shape  | Meaning                                                        |
| ---------------------------------- | ------ | -------------------------------------------------------------- |
| `data.templatePriority`            | number | Template priority; unset means the note is not a template.     |
| `data.transmission`                | string | How it passes from one host to another.                        |
| `data.outcome`                     | string | Where it ends once it has run its course — `death` or `cured`. |
| `data.healingRate`                 | number | How readily a healing test goes well.                          |
| `data.contagionIndex`              | number | How contagious it is.                                          |
| `data.outcomeTraumas`              | string | Expression returning the traumas recovery leaves behind.       |
| `data.onsetDurationFormula`        | string | Roll formula for the delay between contraction and onset.      |
| `data.onsetDurationBase`           | number | That delay in seconds, stated outright instead of rolled.      |
| `data.healingCheckDurationFormula` | string | Roll formula for the interval between healing checks.          |
| `data.healingCheckDurationBase`    | number | That interval in seconds, stated outright instead of rolled.   |
| `data.resolutionDurationFormula`   | string | Roll formula for the time from onset to resolution.            |
| `data.resolutionDurationBase`      | number | That time in seconds, stated outright instead of rolled.       |

**System mappings**

| Source                             | System | Target                               |
| ---------------------------------- | ------ | ------------------------------------ |
| `subType`                          | sohl   | `system.subType`                     |
| `data.transmission`                | sohl   | `system.transmission`                |
| `data.outcome`                     | sohl   | `system.outcome`                     |
| `data.contagionIndex`              | sohl   | `system.contagionIndexBase`          |
| `data.onsetDurationFormula`        | sohl   | `system.onsetDurationFormula`        |
| `data.onsetDurationBase`           | sohl   | `system.onsetDurationBase`           |
| `data.healingCheckDurationFormula` | sohl   | `system.healingCheckDurationFormula` |
| `data.healingCheckDurationBase`    | sohl   | `system.healingCheckDurationBase`    |
| `data.resolutionDurationFormula`   | sohl   | `system.resolutionDurationFormula`   |
| `data.resolutionDurationBase`      | sohl   | `system.resolutionDurationBase`      |

### armorgear

**Subtypes:** None.

| Field                   | Shape                   | Meaning                                                                                                      |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `data.templatePriority` | number                  | Template priority; unset means the note is not a template.                                                   |
| `data.weight`           | number                  | What the thing weighs.                                                                                       |
| `data.value`            | number                  | What the thing is worth.                                                                                     |
| `data.quality`          | number                  | How well it is made.                                                                                         |
| `data.durability`       | number                  | How much wear it takes before it fails.                                                                      |
| `data.made`             | an Address of one event | The event in which the thing was made — `lore-forging`, or one event of a note as `place-ironfells#raising`. |
| `data.lost`             | an Address of one event | The event in which the thing was lost — `lore-flood`, or one event of a note as `place-ironfells#sack`.      |

**System mappings**

| Source            | System | Target                  |
| ----------------- | ------ | ----------------------- |
| `data.weight`     | sohl   | `system.weightBase`     |
| `data.weight`     | hm3    | `system.weight`         |
| `data.value`      | sohl   | `system.valueBase`      |
| `data.value`      | hm3    | `system.value`          |
| `data.quality`    | sohl   | `system.qualityBase`    |
| `data.durability` | sohl   | `system.durabilityBase` |

### armorlocation

**Subtypes:** Open vocabulary.

| Field                   | Shape  | Meaning                                                    |
| ----------------------- | ------ | ---------------------------------------------------------- |
| `data.templatePriority` | number | Template priority; unset means the note is not a template. |

### attribute

**Subtypes:** None.

| Field                   | Shape  | Meaning                                                    |
| ----------------------- | ------ | ---------------------------------------------------------- |
| `data.templatePriority` | number | Template priority; unset means the note is not a template. |

### concoctiongear

**Subtypes:** `mundane`, `exotic`, `elixir`.

| Field                   | Shape                   | Meaning                                                                                                      |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `data.templatePriority` | number                  | Template priority; unset means the note is not a template.                                                   |
| `data.weight`           | number                  | What the thing weighs.                                                                                       |
| `data.value`            | number                  | What the thing is worth.                                                                                     |
| `data.quality`          | number                  | How well it is made.                                                                                         |
| `data.durability`       | number                  | How much wear it takes before it fails.                                                                      |
| `data.made`             | an Address of one event | The event in which the thing was made — `lore-forging`, or one event of a note as `place-ironfells#raising`. |
| `data.lost`             | an Address of one event | The event in which the thing was lost — `lore-flood`, or one event of a note as `place-ironfells#sack`.      |
| `data.quantity`         | number                  | How many of the thing there are; one when unstated.                                                          |
| `data.potency`          | string                  | Potency — `na`, `mild`, `strong` or `great`.                                                                 |
| `data.strength`         | number                  | Strength; the higher, the stronger.                                                                          |

**System mappings**

| Source            | System | Target                  |
| ----------------- | ------ | ----------------------- |
| `subType`         | sohl   | `system.subType`        |
| `data.weight`     | sohl   | `system.weightBase`     |
| `data.value`      | sohl   | `system.valueBase`      |
| `data.quality`    | sohl   | `system.qualityBase`    |
| `data.durability` | sohl   | `system.durabilityBase` |

### containergear

**Subtypes:** None.

| Field                   | Shape                   | Meaning                                                                                                      |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `data.templatePriority` | number                  | Template priority; unset means the note is not a template.                                                   |
| `data.weight`           | number                  | What the thing weighs.                                                                                       |
| `data.value`            | number                  | What the thing is worth.                                                                                     |
| `data.quality`          | number                  | How well it is made.                                                                                         |
| `data.durability`       | number                  | How much wear it takes before it fails.                                                                      |
| `data.made`             | an Address of one event | The event in which the thing was made — `lore-forging`, or one event of a note as `place-ironfells#raising`. |
| `data.lost`             | an Address of one event | The event in which the thing was lost — `lore-flood`, or one event of a note as `place-ironfells#sack`.      |
| `data.capacity`         | number                  | How much it holds.                                                                                           |

**System mappings**

| Source            | System | Target                  |
| ----------------- | ------ | ----------------------- |
| `data.weight`     | sohl   | `system.weightBase`     |
| `data.weight`     | hm3    | `system.weight`         |
| `data.value`      | sohl   | `system.valueBase`      |
| `data.value`      | hm3    | `system.value`          |
| `data.quality`    | sohl   | `system.qualityBase`    |
| `data.durability` | sohl   | `system.durabilityBase` |
| `data.capacity`   | hm3    | `system.capacity.max`   |

### miscgear

**Subtypes:** None.

| Field                   | Shape                   | Meaning                                                                                                      |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `data.templatePriority` | number                  | Template priority; unset means the note is not a template.                                                   |
| `data.weight`           | number                  | What the thing weighs.                                                                                       |
| `data.value`            | number                  | What the thing is worth.                                                                                     |
| `data.quality`          | number                  | How well it is made.                                                                                         |
| `data.durability`       | number                  | How much wear it takes before it fails.                                                                      |
| `data.made`             | an Address of one event | The event in which the thing was made — `lore-forging`, or one event of a note as `place-ironfells#raising`. |
| `data.lost`             | an Address of one event | The event in which the thing was lost — `lore-flood`, or one event of a note as `place-ironfells#sack`.      |
| `data.quantity`         | number                  | How many of the thing there are; one when unstated.                                                          |

**System mappings**

| Source            | System | Target                  |
| ----------------- | ------ | ----------------------- |
| `data.weight`     | sohl   | `system.weightBase`     |
| `data.weight`     | hm3    | `system.weight`         |
| `data.value`      | sohl   | `system.valueBase`      |
| `data.value`      | hm3    | `system.value`          |
| `data.quality`    | sohl   | `system.qualityBase`    |
| `data.durability` | sohl   | `system.durabilityBase` |
| `data.quantity`   | hm3    | `system.quantity`       |

### mystery

**Subtypes:** `boon`, `boost`, `fate`, `grace`, `birthsign`, `other`, `piety`.

| Field                   | Shape                                        | Meaning                                                                    |
| ----------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| `data.templatePriority` | number                                       | Template priority; unset means the note is not a template.                 |
| `data.assocSkill`       | an Address                                   | The skill it is associated with.                                           |
| `data.assocAffiliation` | an Address                                   | The affiliation it is associated with.                                     |
| `data.skillAptitudes`   | a map keyed by Shortcode or subType selector | Bonuses and penalties, each naming a skill or a `subType:<skill-subtype>`. |
| `data.level`            | number                                       | The magnitude of the mystery.                                              |
| `data.charges.value`    | number                                       | Charges available now; unset means charges are not used.                   |
| `data.charges.max`      | number                                       | Most charges it can hold; unset means no maximum.                          |

**System mappings**

| Source                | System | Target                  |
| --------------------- | ------ | ----------------------- |
| `subType`             | sohl   | `system.subType`        |
| `data.skillAptitudes` | sohl   | `system.skillAptitudes` |
| `data.charges.value`  | sohl   | `system.charges.value`  |
| `data.charges.max`    | sohl   | `system.charges.max`    |

### mysticalability

**Subtypes:** `spiritrite`, `spiritaction`, `spiritpower`, `ritualaction`, `divineincantation`, `arcaneincantation`, `arcanetalent`, `spirittalent`, `alchemy`, `divination`.

| Field                   | Shape      | Meaning                                                    |
| ----------------------- | ---------- | ---------------------------------------------------------- |
| `data.templatePriority` | number     | Template priority; unset means the note is not a template. |
| `data.assocSkill`       | an Address | The skill it is associated with.                           |
| `data.assocAffiliation` | an Address | The affiliation it is associated with.                     |
| `data.masteryLevel`     | number     | Mastery before any modifier.                               |
| `data.level`            | number     | The magnitude of the ability.                              |
| `data.charges.value`    | number     | Charges available now; unset means charges are not used.   |
| `data.charges.max`      | number     | Most charges it can hold; unset means no maximum.          |

**System mappings**

| Source               | System | Target                 |
| -------------------- | ------ | ---------------------- |
| `subType`            | sohl   | `system.subType`       |
| `data.charges.value` | sohl   | `system.charges.value` |
| `data.charges.max`   | sohl   | `system.charges.max`   |

### projectilegear

**Subtypes:** `none`, `arrow`, `bolt`, `bullet`, `dart`, `other`.

| Field                   | Shape                   | Meaning                                                                                                      |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `data.templatePriority` | number                  | Template priority; unset means the note is not a template.                                                   |
| `data.weight`           | number                  | What the thing weighs.                                                                                       |
| `data.value`            | number                  | What the thing is worth.                                                                                     |
| `data.quality`          | number                  | How well it is made.                                                                                         |
| `data.durability`       | number                  | How much wear it takes before it fails.                                                                      |
| `data.made`             | an Address of one event | The event in which the thing was made — `lore-forging`, or one event of a note as `place-ironfells#raising`. |
| `data.lost`             | an Address of one event | The event in which the thing was lost — `lore-flood`, or one event of a note as `place-ironfells#sack`.      |
| `data.quantity`         | number                  | How many of the thing there are; one when unstated.                                                          |

**System mappings**

| Source            | System | Target                  |
| ----------------- | ------ | ----------------------- |
| `subType`         | sohl   | `system.subType`        |
| `data.weight`     | sohl   | `system.weightBase`     |
| `data.weight`     | hm3    | `system.weight`         |
| `data.value`      | sohl   | `system.valueBase`      |
| `data.value`      | hm3    | `system.value`          |
| `data.quality`    | sohl   | `system.qualityBase`    |
| `data.durability` | sohl   | `system.durabilityBase` |
| `data.quantity`   | hm3    | `system.quantity`       |

### skill

**Subtypes:** `social`, `nature`, `craft`, `lore`, `language`, `script`, `mystical`, `physical`, `combat`, `combattechnique`.

| Field                   | Shape      | Meaning                                                    |
| ----------------------- | ---------- | ---------------------------------------------------------- |
| `data.templatePriority` | number     | Template priority; unset means the note is not a template. |
| `data.masteryLevel`     | number     | Mastery before any modifier.                               |
| `data.parentSkill`      | an Address | The skill this one specialises.                            |

**System mappings**

| Source              | System | Target                |
| ------------------- | ------ | --------------------- |
| `subType`           | sohl   | `system.subType`      |
| `data.masteryLevel` | hm3    | `system.masteryLevel` |

### trauma

**Subtypes:** `injury`, `fear`, `morale`, `pall`, `psycond`, `physcond`, `auralshock`, `fatigue`, `infection`, `shock`, `coma`.

| Field                                  | Shape  | Meaning                                                             |
| -------------------------------------- | ------ | ------------------------------------------------------------------- |
| `data.templatePriority`                | number | Template priority; unset means the note is not a template.          |
| `data.healingCheckDurationFormula`     | string | Roll formula for the interval between healing checks.               |
| `data.healingCheckDurationBase`        | number | That interval in seconds, stated outright instead of rolled.        |
| `data.bloodLossAdvanceDurationFormula` | string | Roll formula for the interval between blood-loss advances.          |
| `data.bloodLossAdvanceDurationBase`    | number | That interval in seconds. Setting it is what makes the wound bleed. |
| `data.courseDurationFormula`           | string | Roll formula for the interval between course tests.                 |
| `data.courseDurationBase`              | number | That interval in seconds, stated outright instead of rolled.        |

**System mappings**

| Source                                 | System | Target                                   |
| -------------------------------------- | ------ | ---------------------------------------- |
| `subType`                              | sohl   | `system.subType`                         |
| `data.healingCheckDurationFormula`     | sohl   | `system.healingCheckDurationFormula`     |
| `data.healingCheckDurationBase`        | sohl   | `system.healingCheckDurationBase`        |
| `data.bloodLossAdvanceDurationFormula` | sohl   | `system.bloodLossAdvanceDurationFormula` |
| `data.bloodLossAdvanceDurationBase`    | sohl   | `system.bloodLossAdvanceDurationBase`    |
| `data.courseDurationFormula`           | sohl   | `system.courseDurationFormula`           |
| `data.courseDurationBase`              | sohl   | `system.courseDurationBase`              |

### weapongear

**Subtypes:** None.

| Field                   | Shape                   | Meaning                                                                                                      |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `data.templatePriority` | number                  | Template priority; unset means the note is not a template.                                                   |
| `data.weight`           | number                  | What the thing weighs.                                                                                       |
| `data.value`            | number                  | What the thing is worth.                                                                                     |
| `data.quality`          | number                  | How well it is made.                                                                                         |
| `data.durability`       | number                  | How much wear it takes before it fails.                                                                      |
| `data.made`             | an Address of one event | The event in which the thing was made — `lore-forging`, or one event of a note as `place-ironfells#raising`. |
| `data.lost`             | an Address of one event | The event in which the thing was lost — `lore-flood`, or one event of a note as `place-ironfells#sack`.      |

**System mappings**

| Source            | System | Target                  |
| ----------------- | ------ | ----------------------- |
| `data.weight`     | sohl   | `system.weightBase`     |
| `data.weight`     | hm3    | `system.weight`         |
| `data.value`      | sohl   | `system.valueBase`      |
| `data.value`      | hm3    | `system.value`          |
| `data.quality`    | sohl   | `system.qualityBase`    |
| `data.durability` | sohl   | `system.durabilityBase` |

### lore

**Subtypes:** `cosmology`, `deity`, `theology`, `arcana`, `spirit`, `economy`, `law`, `calendar`, `history`, `material`, `folk`, `culture`, `custom`, `bestiary`, `gathering`, `literature`.

Lore records in-world knowledge. A `culture` describes a people; a `custom` describes how they practice a rite, observance, or usage. A `material` describes a physical constituent and its qualities, which may vary by region. See the [lore subtype definitions](format-details.md#type-lore) for the complete vocabulary.

| Field            | Shape                                                                               | Meaning                                                                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data.epoch`     | a canonical `<year>.<day>`                                                          | Canonical day when calendar year 1, day 1 begins — `1.1`.                                                                                                                     |
| `data.months`    | list of `{ name, abbreviation?, days }`                                             | The months this calendar keeps, in order — position in the list is position in the year, and the day counts sum to the world's year.                                          |
| `data.weekdays`  | list of `{ name, abbreviation? }`                                                   | The days of the week this calendar names, in order. A calendar with no week writes none.                                                                                      |
| `data.seasons`   | list of `{ name, abbreviation?, start }`                                            | The seasons this calendar marks, starting on numbered days of the year.                                                                                                       |
| `data.namedDays` | list of `{ name, abbreviation?, day }`                                              | Names assigned to particular days of the year.                                                                                                                                |
| `data.eras`      | list of `{ shortcode, name, marker?, abbreviation?, proclaimedBy?, start, label? }` | The year-counts kept in this calendar. A marker names one era and uses these months.                                                                                          |
| `data.formats`   | map of named Calendaria format strings                                              | Named patterns for reading and writing this calendar's dates.                                                                                                                 |
| `data.culture`   | an Address                                                                          | The people this lore belongs to — for a work of literature, the people whose work it is — as a culture lore note. A culture note does not state it: it is itself the culture. |
| `data.form`      | string                                                                              | The kind of work in its people's own terms — an epic, a saga, a praise-song, an elegy. Free text.                                                                             |
| `data.subjects`  | list of Addresses                                                                   | The beings, places, gods and other notes the work concerns, and each event it concerns, named as `place-ironfells#sack`.                                                      |
| `data.language`  | an Address                                                                          | The tongue the work is composed in, as a language skill note.                                                                                                                 |
| `data.events`    | list of event entries                                                               | What happened to or at this subject — each entry one dated, attributed event: a founding, a war, a fall, or an occasion that recurs.                                          |

**Inner keys** — a key a field's value does not declare is an error at its own line and column.

| Key                                        | Shape                                                                                                            | Required | Meaning                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `data.months[].name`                       | a string                                                                                                         | yes      | What it is called.                                                               |
| `data.months[].abbreviation`               | a string                                                                                                         | no       | Its short form, for a compact date.                                              |
| `data.months[].days`                       | a whole number of days                                                                                           | yes      | How many days the month holds.                                                   |
| `data.weekdays[].name`                     | a string                                                                                                         | yes      | What it is called.                                                               |
| `data.weekdays[].abbreviation`             | a string                                                                                                         | no       | Its short form, for a compact date.                                              |
| `data.seasons[].name`                      | a string                                                                                                         | yes      | What it is called.                                                               |
| `data.seasons[].abbreviation`              | a string                                                                                                         | no       | Its short form, for a compact date.                                              |
| `data.seasons[].start`                     | a one-based day of the year, as a whole number                                                                   | yes      | The day of the year the season begins.                                           |
| `data.namedDays[].name`                    | a string                                                                                                         | yes      | What it is called.                                                               |
| `data.namedDays[].abbreviation`            | a string                                                                                                         | no       | Its short form, for a compact date.                                              |
| `data.namedDays[].day`                     | a one-based day of the year, as a whole number                                                                   | yes      | The day of the year it names.                                                    |
| `data.eras[].shortcode`                    | the era's own shortcode, unique within the calendar — an era is addressed `<calendar shortcode>.<era shortcode>` | yes      | The era's own segment of `<calendar>.<era>`.                                     |
| `data.eras[].name`                         | a string                                                                                                         | yes      | What it is called.                                                               |
| `data.eras[].marker`                       | uppercase letters and digits, beginning with a letter                                                            | no       | The marker an authored date names the era by, unique across the corpus.          |
| `data.eras[].abbreviation`                 | a string                                                                                                         | no       | Its short form, for a compact date.                                              |
| `data.eras[].proclaimedBy`                 | an Address                                                                                                       | no       | The body that began the reckoning.                                               |
| `data.eras[].start`                        | `null`, or the calendar year the era begins, as a whole number                                                   | yes      | The calendar year the era begins; `null` for the era before year 1.              |
| `data.eras[].label`                        | a string, or an `{ after, before }` map                                                                          | no       | How a date in the era reads, around one `{date}` slot.                           |
| `data.eras[].label.after`                  | a string with one `{date}` slot                                                                                  | no       | How a date in the era reads.                                                     |
| `data.eras[].label.before`                 | a string with one `{date}` slot                                                                                  | no       | How a date before the era's start reads.                                         |
| `data.events[].id`                         | an address segment                                                                                               | no       | The event's name within its note — lowercase letters and digits.                 |
| `data.events[].kind`                       | one `eventKind` value                                                                                            | no       | What sort of thing happened.                                                     |
| `data.events[].depth`                      | one `depth` value                                                                                                | no       | How far the event's history reaches.                                             |
| `data.events[].when`                       | a date, or `"0.<day>"`                                                                                           | yes      | When it happened, or the anchor and first instance of an event that recurs.      |
| `data.events[].until`                      | a date                                                                                                           | no       | When a continuous event ended, or where a recurring series stopped.              |
| `data.events[].recurs`                     | `{ every }` or `{ on }`                                                                                          | no       | How further occurrences are found; absent for an event that happened once.       |
| `data.events[].recurs.every`               | a whole number of years, 1 or more                                                                               | no       | A period counted on the canonical axis from `when`.                              |
| `data.events[].recurs.on`                  | a list of dates, strictly increasing, each later than `when`                                                     | no       | Recorded occurrences beyond the first, in place of a period.                     |
| `data.events[].summary`                    | a string                                                                                                         | yes      | What happened, stated plainly.                                                   |
| `data.events[].standing`                   | one `standing` value                                                                                             | no       | What the world's evidence supports.                                              |
| `data.events[].names`                      | `{ name, by, gloss? }[]`                                                                                         | no       | The event's names in the world, each with who uses it.                           |
| `data.events[].names[].name`               | a string                                                                                                         | yes      | One name the event goes by in the world.                                         |
| `data.events[].names[].by`                 | an Address naming an `affiliation`, `lore`, `place`, `being` or `skill` note                                     | yes      | Who uses that name — a people, a polity, a faith, a place, a tongue.             |
| `data.events[].names[].gloss`              | a string                                                                                                         | no       | What the name means, or how it is used.                                          |
| `data.events[].where`                      | `{ locus?, reach? }`                                                                                             | no       | Where it happened, and where it was felt.                                        |
| `data.events[].where.locus`                | a list of Addresses, each defaulting to `place`                                                                  | no       | Where the event physically happened; each resolves to a place.                   |
| `data.events[].where.reach`                | `{ place, how, knowledge, attributedTo? }[]`                                                                     | no       | Where the event was felt, and whether each place knows why.                      |
| `data.events[].where.reach[].place`        | an Address, defaulting to `place`                                                                                | yes      | A place where the event was felt.                                                |
| `data.events[].where.reach[].how`          | a string                                                                                                         | yes      | One clause: a consequence someone in that place could notice.                    |
| `data.events[].where.reach[].knowledge`    | one `knowledge` value                                                                                            | yes      | Whether that place connects what it felt to this event.                          |
| `data.events[].where.reach[].attributedTo` | an Address, defaulting to `lore`, naming an event or a `lore` note                                               | no       | Only beside `knowledge: misattributed` — the cause that place names instead.     |
| `data.events[].who`                        | `{ ref, role }[]`                                                                                                | no       | Who took part, and as what.                                                      |
| `data.events[].who[].ref`                  | an Address naming a `being`, `affiliation` or `lore` note                                                        | yes      | A participant — a being, a people, an affiliation.                               |
| `data.events[].who[].role`                 | one `role` value                                                                                                 | yes      | What the participant was to the event.                                           |
| `data.events[].follows`                    | `{ event, how, note? }[]`                                                                                        | no       | The earlier events this one follows from.                                        |
| `data.events[].follows[].event`            | an Address, defaulting to `lore`, anchored to an `event` where its note holds several                            | yes      | The earlier event; it resolves to exactly one event.                             |
| `data.events[].follows[].how`              | one `followsHow` value                                                                                           | yes      | How this event follows from it.                                                  |
| `data.events[].follows[].note`             | a string                                                                                                         | no       | One clause saying what connects the two.                                         |
| `data.events[].accounts`                   | `{ by, says, agrees, withholds? }[]`                                                                             | no       | What each people, polity, faith or place says about it.                          |
| `data.events[].accounts[].by`              | an Address naming an `affiliation`, `lore`, `place` or `being` note                                              | yes      | Who holds the account.                                                           |
| `data.events[].accounts[].says`            | a string                                                                                                         | yes      | What they say happened, in their terms.                                          |
| `data.events[].accounts[].agrees`          | one `agrees` value                                                                                               | yes      | How far their account agrees with `summary`.                                     |
| `data.events[].accounts[].withholds`       | a string                                                                                                         | no       | What they decline to say.                                                        |
| `data.events[].unresolved`                 | a list of strings                                                                                                | no       | What the world itself has not settled.                                           |
| `data.events[].sources`                    | a list of Addresses                                                                                              | no       | The notes that state or support the event; each resolves.                        |
| `data.events[].stated`                     | `{ calendar, text }`                                                                                             | no       | The date as one tradition writes it in its own reckoning.                        |
| `data.events[].stated.calendar`            | an Address, or a lore shortcode                                                                                  | yes      | The calendar that tradition reckons in — a `lore` note with `subType: calendar`. |
| `data.events[].stated.text`                | a string                                                                                                         | yes      | The date as that tradition writes it.                                            |

### map

**Subtypes:** `battlemap`, `localmap`, `regionalmap`, `totm`.

| Field        | Shape                                            | Meaning                                                                                                                                                                                     |
| ------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data.scene` | an object — a Foundry Scene document as exported | The Foundry Scene as exported, passed through unchanged apart from `data.fixup` and its pins marked `#anchor`. Nothing inside it is checked; the book prints its levels' background images. |
| `data.fixup` | list of `{ path, type, value }`                  | Asset address replacements in an exported Scene.                                                                                                                                            |
| `data.place` | an Address                                       | The place this map depicts. Named here and not on the place, because a place has several maps and a map depicts one place.                                                                  |

**Inner keys** — a key a field's value does not declare is an error at its own line and column.

| Key                  | Shape                             | Required | Meaning                                                 |
| -------------------- | --------------------------------- | -------- | ------------------------------------------------------- |
| `data.fixup[].path`  | a property path into `data.scene` | yes      | The exported field to replace, from `data.scene`.       |
| `data.fixup[].type`  | `address`                         | yes      | What `value` is: `address`.                             |
| `data.fixup[].value` | an asset Address                  | yes      | The asset Address whose path replaces the exported one. |

### place

**Subtypes:** `world`, `region`, `settlement`, `site`, `structure`, `feature`, `celestial`.

| Field                                  | Shape                                                             | Meaning                                                                                                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data.events`                          | list of event entries                                             | What happened to or at this subject — each entry one dated, attributed event: a founding, a war, a fall, or an occasion that recurs.                                                |
| `data.calendar`                        | an Address                                                        | Calendar used to display this place's dates.                                                                                                                                        |
| `data.demonym`                         | string                                                            | What a person from this place is called — a Vylarian.                                                                                                                               |
| `data.purpose`                         | string                                                            | The reason this settlement, site, or structure exists, selected from its placeCharacter tags.                                                                                       |
| `data.lore`                            | list of Addresses                                                 | Lore concerning this place — its peoples, its law, its calendar, its history.                                                                                                       |
| `data.parents`                         | list of Addresses                                                 | Enclosing places this one sits within.                                                                                                                                              |
| `data.culture`                         | an Address                                                        | The people this place belongs to, as a culture lore note.                                                                                                                           |
| `data.population`                      | number                                                            | Approximate population, to two significant digits.                                                                                                                                  |
| `data.government`                      | an Address or null                                                | The governing affiliation Address; the default target type is affiliation. Explicit null means complete anarchy. A positive population with no government key produces an advisory. |
| `data.market`                          | number                                                            | What trade the settlement supports, on a scale of six: 1 hamlet, 2 village, 3 town, 4 market town, 5 city, 6 great city.                                                            |
| `data.borders`                         | list of `{ to, bearing }` entries                                 | Places sharing a frontier with this one — each the other's shortcode and where it lies from here.                                                                                   |
| `data.routes`                          | list of `{ to, bearing, mode, days, terrain?, leagues? }` entries | Journeys from this place's centre — where the destination lies, how it is travelled, and about how many days it takes.                                                              |
| `data.world.equatorialCircumferenceKm` | number                                                            | The distance round the body at its equator, in kilometres.                                                                                                                          |
| `data.world.surfaceGravityG`           | number                                                            | Surface gravity, as a multiple of Earth's.                                                                                                                                          |
| `data.world.axialTiltDegrees`          | number                                                            | The tilt of the axis, in degrees — what makes the body have seasons.                                                                                                                |
| `data.year.days`                       | number                                                            | How many days the body's year holds. Every calendar's months sum to it.                                                                                                             |
| `data.year.hoursPerDay`                | number                                                            | How many hours the day divides into.                                                                                                                                                |
| `data.year.minutesPerHour`             | number                                                            | How many minutes the hour divides into.                                                                                                                                             |
| `data.year.secondsPerMinute`           | number                                                            | How many seconds the minute divides into.                                                                                                                                           |
| `data.present`                         | a date                                                            | The day the setting stops and play begins — what an age is computed against.                                                                                                        |
| `data.body.diameterKm`                 | number                                                            | The body's diameter, in kilometres.                                                                                                                                                 |
| `data.body.orbitalRadiusKm`            | number                                                            | How far the body orbits from the one it circles, in kilometres.                                                                                                                     |
| `data.body.orbit`                      | string                                                            | The orbit's shape — `circular` means the cycle never varies.                                                                                                                        |
| `data.body.inclined`                   | boolean                                                           | Whether the orbit is inclined to the plane the world orbits in.                                                                                                                     |
| `data.moon.cycle`                      | number                                                            | How many days the body takes to return to the same phase.                                                                                                                           |
| `data.moon.newOn`                      | a day-precision date                                              | A day the body was new, written in the reference calendar.                                                                                                                          |
| `data.moon.eclipses`                   | string                                                            | How often the body eclipses or is eclipsed — `never`, `rare`, `occasional` or `frequent`.                                                                                           |

**Inner keys** — a key a field's value does not declare is an error at its own line and column.

| Key                                        | Shape                                                                                 | Required | Meaning                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `data.events[].id`                         | an address segment                                                                    | no       | The event's name within its note — lowercase letters and digits.                 |
| `data.events[].kind`                       | one `eventKind` value                                                                 | no       | What sort of thing happened.                                                     |
| `data.events[].depth`                      | one `depth` value                                                                     | no       | How far the event's history reaches.                                             |
| `data.events[].when`                       | a date, or `"0.<day>"`                                                                | yes      | When it happened, or the anchor and first instance of an event that recurs.      |
| `data.events[].until`                      | a date                                                                                | no       | When a continuous event ended, or where a recurring series stopped.              |
| `data.events[].recurs`                     | `{ every }` or `{ on }`                                                               | no       | How further occurrences are found; absent for an event that happened once.       |
| `data.events[].recurs.every`               | a whole number of years, 1 or more                                                    | no       | A period counted on the canonical axis from `when`.                              |
| `data.events[].recurs.on`                  | a list of dates, strictly increasing, each later than `when`                          | no       | Recorded occurrences beyond the first, in place of a period.                     |
| `data.events[].summary`                    | a string                                                                              | yes      | What happened, stated plainly.                                                   |
| `data.events[].standing`                   | one `standing` value                                                                  | no       | What the world's evidence supports.                                              |
| `data.events[].names`                      | `{ name, by, gloss? }[]`                                                              | no       | The event's names in the world, each with who uses it.                           |
| `data.events[].names[].name`               | a string                                                                              | yes      | One name the event goes by in the world.                                         |
| `data.events[].names[].by`                 | an Address naming an `affiliation`, `lore`, `place`, `being` or `skill` note          | yes      | Who uses that name — a people, a polity, a faith, a place, a tongue.             |
| `data.events[].names[].gloss`              | a string                                                                              | no       | What the name means, or how it is used.                                          |
| `data.events[].where`                      | `{ locus?, reach? }`                                                                  | no       | Where it happened, and where it was felt.                                        |
| `data.events[].where.locus`                | a list of Addresses, each defaulting to `place`                                       | no       | Where the event physically happened; each resolves to a place.                   |
| `data.events[].where.reach`                | `{ place, how, knowledge, attributedTo? }[]`                                          | no       | Where the event was felt, and whether each place knows why.                      |
| `data.events[].where.reach[].place`        | an Address, defaulting to `place`                                                     | yes      | A place where the event was felt.                                                |
| `data.events[].where.reach[].how`          | a string                                                                              | yes      | One clause: a consequence someone in that place could notice.                    |
| `data.events[].where.reach[].knowledge`    | one `knowledge` value                                                                 | yes      | Whether that place connects what it felt to this event.                          |
| `data.events[].where.reach[].attributedTo` | an Address, defaulting to `lore`, naming an event or a `lore` note                    | no       | Only beside `knowledge: misattributed` — the cause that place names instead.     |
| `data.events[].who`                        | `{ ref, role }[]`                                                                     | no       | Who took part, and as what.                                                      |
| `data.events[].who[].ref`                  | an Address naming a `being`, `affiliation` or `lore` note                             | yes      | A participant — a being, a people, an affiliation.                               |
| `data.events[].who[].role`                 | one `role` value                                                                      | yes      | What the participant was to the event.                                           |
| `data.events[].follows`                    | `{ event, how, note? }[]`                                                             | no       | The earlier events this one follows from.                                        |
| `data.events[].follows[].event`            | an Address, defaulting to `lore`, anchored to an `event` where its note holds several | yes      | The earlier event; it resolves to exactly one event.                             |
| `data.events[].follows[].how`              | one `followsHow` value                                                                | yes      | How this event follows from it.                                                  |
| `data.events[].follows[].note`             | a string                                                                              | no       | One clause saying what connects the two.                                         |
| `data.events[].accounts`                   | `{ by, says, agrees, withholds? }[]`                                                  | no       | What each people, polity, faith or place says about it.                          |
| `data.events[].accounts[].by`              | an Address naming an `affiliation`, `lore`, `place` or `being` note                   | yes      | Who holds the account.                                                           |
| `data.events[].accounts[].says`            | a string                                                                              | yes      | What they say happened, in their terms.                                          |
| `data.events[].accounts[].agrees`          | one `agrees` value                                                                    | yes      | How far their account agrees with `summary`.                                     |
| `data.events[].accounts[].withholds`       | a string                                                                              | no       | What they decline to say.                                                        |
| `data.events[].unresolved`                 | a list of strings                                                                     | no       | What the world itself has not settled.                                           |
| `data.events[].sources`                    | a list of Addresses                                                                   | no       | The notes that state or support the event; each resolves.                        |
| `data.events[].stated`                     | `{ calendar, text }`                                                                  | no       | The date as one tradition writes it in its own reckoning.                        |
| `data.events[].stated.calendar`            | an Address, or a lore shortcode                                                       | yes      | The calendar that tradition reckons in — a `lore` note with `subType: calendar`. |
| `data.events[].stated.text`                | a string                                                                              | yes      | The date as that tradition writes it.                                            |
| `data.borders[].to`                        | the other place — its shortcode, or its Address                                       | yes      | The other place, by Address; the type defaults to `place`.                       |
| `data.borders[].bearing`                   | one of N, NE, E, SE, S, SW, W, NW                                                     | yes      | Where the other place lies from here.                                            |
| `data.routes[].to`                         | the other place — its shortcode, or its Address                                       | yes      | The other place, by Address; the type defaults to `place`.                       |
| `data.routes[].bearing`                    | one of N, NE, E, SE, S, SW, W, NW                                                     | yes      | Where the other place lies from here.                                            |
| `data.routes[].mode`                       | one of land, boat, ship                                                               | yes      | How the journey is travelled.                                                    |
| `data.routes[].days`                       | one of 1, 2, 3, 5, 10, 20, 30, 45, 60, 90, 180, 360                                   | yes      | About how many days the journey takes, under normal conditions.                  |
| `data.routes[].terrain`                    | a list of terrains in travel order                                                    | no       | The terrains crossed, in travel order, each crossable by the mode.               |
| `data.routes[].leagues`                    | a distance in leagues                                                                 | no       | The distance, in leagues.                                                        |

### scenario

**Subtypes:** `campaign`, `adventure`, `encounter`.

| Field                   | Shape             | Meaning                                          |
| ----------------------- | ----------------- | ------------------------------------------------ |
| `data.parents`          | list of Addresses | Scenarios this one sits within.                  |
| `data.locations`        | list of Addresses | Places the scenario takes place in.              |
| `data.cast`             | list of Addresses | Beings who appear in it.                         |
| `data.factions`         | list of Addresses | Affiliations with a stake in it.                 |
| `data.follows`          | list of Addresses | Scenarios that should be played before this one. |
| `data.status`           | string            | `draft`, `playtested` or `published`.            |
| `data.party.size`       | string            | `solo`, `small`, `standard`, `large` or `host`.  |
| `data.party.archetypes` | list of strings   | Archetypes the scenario is written for.          |

### doc

**Subtypes:** `rules`, `userguide`, `reference`, `howto`, `concept`, `settingguide`.

| Field          | Shape      | Meaning                                                                                                                 |
| -------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| `data.culture` | an Address | The culture a setting guide introduces, as a culture lore note. Required on `settingguide`; no other subType states it. |

### macro

**Subtypes:** None.

| Field | Shape | Meaning                         |
| ----- | ----- | ------------------------------- |
| —     | —     | No type-specific `data` fields. |

### bundle

**Subtypes:** None.

| Field           | Shape             | Meaning                                                                                                                                                           |
| --------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data.contents` | list of Addresses | The documents the Adventure holds, as addresses. Empty when unstated. A document of neither `none` nor the system being compiled is left out rather than failing. |

### folder

**Subtypes:** None.

| Field         | Shape                                           | Meaning                                                                                                                                                                                                             |
| ------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data.parent` | an Address, or a map of Addresses keyed by pack | The folder this one sits in, as an address — or one address per pack, keyed by pack name with `default` for the rest. Unset at the root. A dead address is a dead-address finding and a cycle is refused, per pack. |
| `data.color`  | string                                          | The folder's colour, as a CSS hex code. Unset for Foundry's default.                                                                                                                                                |

## Shared system mappings

| Source                  | System | Target                    |
| ----------------------- | ------ | ------------------------- |
| `shortcode`             | sohl   | `system.shortcode`        |
| `data.templatePriority` | sohl   | `system.templatePriority` |
| `actionDefs`            | sohl   | `system.actionDefs`       |
| `notes`                 | sohl   | `system.notes`            |
| `notes`                 | hm3    | `system.notes`            |
