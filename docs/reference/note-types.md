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

Most of them are required. `name.aliases` and `tags` need only be written — an empty list satisfies either — while `shortcode`, `name.full`, `type` and `description` must carry a value. `subType` is required of every type that declares subtypes and refused by every type that declares none; the per-type sections below say which is which.

| Key           | Required                         | Meaning                                                                                   |
| ------------- | -------------------------------- | ----------------------------------------------------------------------------------------- |
| `shortcode`   | Yes                              | The note's own address segment, unique within its type.                                   |
| `name`        | Yes, with `full` and `aliases`   | The display names — a `full` the note publishes under, and its `aliases`.                 |
| `type`        | Yes                              | What the note is about, which decides its vocabulary and its document.                    |
| `subType`     | Where the type declares subtypes | The type's own genre, required of every type that declares one.                           |
| `description` | Yes                              | The short page summary.                                                                   |
| `tags`        | Yes, may be empty                | Draft state, GM routing, and the descriptive labels a page list reads.                    |
| `data`        | No                               | The facts about the subject itself, shared by every system.                               |
| `dnd5e`       | No                               | What the `dnd5e` system makes of the subject — its document's mechanics, routing and art. |
| `hm3`         | No                               | What the `hm3` system makes of the subject — its document's mechanics, routing and art.   |
| `sohl`        | No                               | What the `sohl` system makes of the subject — its document's mechanics, routing and art.  |

## Shared `data` fields

These fields are accepted by every note type. A field's value can still be irrelevant to a particular output; the build reports that where it can.

| Field             | Shape                                           | Meaning                                                                   |
| ----------------- | ----------------------------------------------- | ------------------------------------------------------------------------- |
| `data.id`         | string                                          | A fixed document identity when the derived identity is unsuitable.        |
| `data.pack`       | string                                          | The shared compendium route, with a system block overriding it.           |
| `data.packFolder` | an Address, or a map of Addresses keyed by pack | The shared compendium folder Address, with a system block overriding it.  |
| `data.harnworld`  | map                                             | HârnWorld source details shared by every system.                          |
| `data.icon`       | an Address                                      | The document's profile art — an `icon` address, resolved into `img`.      |
| `data.banner`     | an Address                                      | The page's hero image — an `image` address. Reaches no compiled document. |

## Type-specific fields

### being

**Subtypes:** `npc`, `character`, `creature`.

| Field                            | Shape                                                   | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data.social`                    | map                                                     | The being's social profile.                                                                                                                                                                                                                                                                                                                                                                                                         |
| `data.tokenIcon`                 | an Address                                              | What a token on the canvas wears — an `icon` address; unset, it follows `icon`.                                                                                                                                                                                                                                                                                                                                                     |
| `data.templatePriority`          | number                                                  | Template priority; unset means the note is not a template.                                                                                                                                                                                                                                                                                                                                                                          |
| `data.archetypes`                | list                                                    | Archetypal behaviours the being fits.                                                                                                                                                                                                                                                                                                                                                                                               |
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
| `data.appearance.extra_features` | list                                                    | Anything else a stranger would notice.                                                                                                                                                                                                                                                                                                                                                                                              |

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

| Field                     | Shape                  | Meaning                                                                                         |
| ------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------- |
| `data.templatePriority`   | number                 | Template priority; unset means the note is not a template.                                      |
| `data.demonym`            | string                 | What one member is called — a Vylarian.                                                         |
| `data.epithet`            | string                 | The by-name it is known by — a god's, an order's, a company's.                                  |
| `data.symbol`             | string                 | Its emblem in words: a feather atop a golden scale, a chisel carving a star.                    |
| `data.governance.model`   | string                 | How the affiliation is governed, where it is.                                                   |
| `data.governance.summary` | string                 | A sentence on how the governance actually works.                                                |
| `data.governance.ranks`   | list                   | The ladder of ranks the body confers — level, title, description.                               |
| `data.governance.offices` | as authored            | Named offices, each with a description and optional dated holders.                              |
| `data.seat`               | an Address             | Where the affiliation's authority sits.                                                         |
| `data.domains`            | list of Addresses      | Places over which it holds sway.                                                                |
| `data.population`         | number                 | How many people it counts.                                                                      |
| `data.economy`            | list of Addresses      | What its economic life runs on — currencies, banking bodies, goods.                             |
| `data.lore`               | list of Addresses      | Lore concerning it — the peoples it draws on, the god a faith venerates, its law, its calendar. |
| `data.parents`            | list of Addresses      | Affiliations it is subordinate to.                                                              |
| `data.relations`          | a map keyed by Address | Standing with other affiliations — aligned, unaligned, rival, nemesis.                          |

**System mappings**

| Source           | System | Target             |
| ---------------- | ------ | ------------------ |
| `subType`        | sohl   | `system.subType`   |
| `data.seat`      | sohl   | `system.seat`      |
| `data.domains`   | sohl   | `system.domain`    |
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

| Field                   | Shape  | Meaning                                                    |
| ----------------------- | ------ | ---------------------------------------------------------- |
| `data.templatePriority` | number | Template priority; unset means the note is not a template. |
| `data.weight`           | number | What the thing weighs.                                     |
| `data.value`            | number | What the thing is worth.                                   |
| `data.quality`          | number | How well it is made.                                       |
| `data.durability`       | number | How much wear it takes before it fails.                    |

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

| Field                   | Shape  | Meaning                                                    |
| ----------------------- | ------ | ---------------------------------------------------------- |
| `data.templatePriority` | number | Template priority; unset means the note is not a template. |
| `data.weight`           | number | What the thing weighs.                                     |
| `data.value`            | number | What the thing is worth.                                   |
| `data.quality`          | number | How well it is made.                                       |
| `data.durability`       | number | How much wear it takes before it fails.                    |
| `data.quantity`         | number | How many of the thing there are; one when unstated.        |
| `data.potency`          | string | Potency — `na`, `mild`, `strong` or `great`.               |
| `data.strength`         | number | Strength; the higher, the stronger.                        |

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

| Field                   | Shape  | Meaning                                                    |
| ----------------------- | ------ | ---------------------------------------------------------- |
| `data.templatePriority` | number | Template priority; unset means the note is not a template. |
| `data.weight`           | number | What the thing weighs.                                     |
| `data.value`            | number | What the thing is worth.                                   |
| `data.quality`          | number | How well it is made.                                       |
| `data.durability`       | number | How much wear it takes before it fails.                    |
| `data.capacity`         | number | How much it holds.                                         |

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

| Field                   | Shape  | Meaning                                                    |
| ----------------------- | ------ | ---------------------------------------------------------- |
| `data.templatePriority` | number | Template priority; unset means the note is not a template. |
| `data.weight`           | number | What the thing weighs.                                     |
| `data.value`            | number | What the thing is worth.                                   |
| `data.quality`          | number | How well it is made.                                       |
| `data.durability`       | number | How much wear it takes before it fails.                    |
| `data.quantity`         | number | How many of the thing there are; one when unstated.        |

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

| Field                   | Shape  | Meaning                                                    |
| ----------------------- | ------ | ---------------------------------------------------------- |
| `data.templatePriority` | number | Template priority; unset means the note is not a template. |
| `data.weight`           | number | What the thing weighs.                                     |
| `data.value`            | number | What the thing is worth.                                   |
| `data.quality`          | number | How well it is made.                                       |
| `data.durability`       | number | How much wear it takes before it fails.                    |
| `data.quantity`         | number | How many of the thing there are; one when unstated.        |

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

| Field                   | Shape  | Meaning                                                    |
| ----------------------- | ------ | ---------------------------------------------------------- |
| `data.templatePriority` | number | Template priority; unset means the note is not a template. |
| `data.weight`           | number | What the thing weighs.                                     |
| `data.value`            | number | What the thing is worth.                                   |
| `data.quality`          | number | How well it is made.                                       |
| `data.durability`       | number | How much wear it takes before it fails.                    |

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

**Subtypes:** `cosmology`, `deity`, `theology`, `arcana`, `spirit`, `economy`, `law`, `calendar`, `history`, `material`, `folk`, `culture`, `custom`, `bestiary`, `gathering`.

Lore records in-world knowledge. A `culture` describes a people; a `custom` describes how they practice a rite, observance, or usage. A `material` describes a physical constituent and its qualities, which may vary by region. See the [lore subtype definitions](format-details.md#type-lore) for the complete vocabulary.

| Field            | Shape                                                                               | Meaning                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `data.epoch`     | a canonical `<year>.<day>`                                                          | Canonical day when calendar year 1, day 1 begins — `1.1`.                                                                            |
| `data.months`    | list of `{ name, abbreviation?, days }`                                             | The months this calendar keeps, in order — position in the list is position in the year, and the day counts sum to the world's year. |
| `data.weekdays`  | list of `{ name, abbreviation? }`                                                   | The days of the week this calendar names, in order. A calendar with no week writes none.                                             |
| `data.seasons`   | list of `{ name, abbreviation?, start }`                                            | The seasons this calendar marks, starting on numbered days of the year.                                                              |
| `data.namedDays` | list of `{ name, abbreviation?, day }`                                              | Names assigned to particular days of the year.                                                                                       |
| `data.eras`      | list of `{ shortcode, name, marker?, abbreviation?, proclaimedBy?, start, label? }` | The year-counts kept in this calendar. A marker names one era and uses these months.                                                 |
| `data.formats`   | map of named Calendaria format strings                                              | Named patterns for reading and writing this calendar's dates.                                                                        |
| `data.event`     | event metadata map                                                                  | A dated occurrence and its relationships to other events and places.                                                                 |

### map

**Subtypes:** `battlemap`, `localmap`, `regionalmap`, `totm`.

| Field                  | Shape       | Meaning                                                                                                                    |
| ---------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| `data.scene`           | as authored | A Foundry Scene export with all its authored fields.                                                                       |
| `data.fixup`           | list        | Asset address replacements in an exported Scene.                                                                           |
| `data.bgImage`         | an Address  | The map's background art — an `image` address.                                                                             |
| `data.scale`           | as authored | Regional map distance per grid unit: {distance, unit}.                                                                     |
| `data.dimensions`      | list        | `[width, height]` in whole pixels — the art's own size.                                                                    |
| `data.pxPerGrid`       | number      | Whole pixels per grid square; must match the art.                                                                          |
| `data.navName`         | string      | Short name for the navigation bar.                                                                                         |
| `data.levelName`       | string      | Name of the embedded level.                                                                                                |
| `data.backgroundColor` | string      | Colour shown where the art does not reach.                                                                                 |
| `data.overlay`         | string      | Path to the foreground art.                                                                                                |
| `data.walls`           | as authored | Wall segments.                                                                                                             |
| `data.doors`           | as authored | Doors.                                                                                                                     |
| `data.lights`          | as authored | Light sources.                                                                                                             |
| `data.tiles`           | as authored | Tiles.                                                                                                                     |
| `data.sounds`          | as authored | Ambient sounds.                                                                                                            |
| `data.regions`         | as authored | Regions and their behaviours.                                                                                              |
| `data.notes`           | as authored | Map pins, each a grid location and an anchor in this note's own body.                                                      |
| `data.place`           | an Address  | The place this map depicts. Named here and not on the place, because a place has several maps and a map depicts one place. |

### place

**Subtypes:** `world`, `region`, `settlement`, `site`, `structure`, `feature`, `celestial`.

| Field                                  | Shape                                                             | Meaning                                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `data.calendar`                        | an Address                                                        | Calendar used to display this place's dates.                                                                             |
| `data.demonym`                         | string                                                            | What a person from this place is called — a Vylarian.                                                                    |
| `data.purpose`                         | string                                                            | The reason this settlement, site, or structure exists, selected from its placeCharacter tags.                            |
| `data.lore`                            | list of Addresses                                                 | Lore concerning this place — its peoples, its law, its calendar, its history.                                            |
| `data.parents`                         | list of Addresses                                                 | Enclosing places this one sits within.                                                                                   |
| `data.population`                      | number                                                            | Approximate population, to two significant digits.                                                                       |
| `data.market`                          | number                                                            | What trade the settlement supports, on a scale of six: 1 hamlet, 2 village, 3 town, 4 market town, 5 city, 6 great city. |
| `data.borders`                         | list of `{ to, bearing }` entries                                 | Places sharing a frontier with this one — each the other's shortcode and where it lies from here.                        |
| `data.routes`                          | list of `{ to, bearing, mode, days, terrain?, leagues? }` entries | Journeys from this place's centre — where the destination lies, how it is travelled, and about how many days it takes.   |
| `data.world.equatorialCircumferenceKm` | number                                                            | The distance round the body at its equator, in kilometres.                                                               |
| `data.world.surfaceGravityG`           | number                                                            | Surface gravity, as a multiple of Earth's.                                                                               |
| `data.world.axialTiltDegrees`          | number                                                            | The tilt of the axis, in degrees — what makes the body have seasons.                                                     |
| `data.year.days`                       | number                                                            | How many days the body's year holds. Every calendar's months sum to it.                                                  |
| `data.year.hoursPerDay`                | number                                                            | How many hours the day divides into.                                                                                     |
| `data.year.minutesPerHour`             | number                                                            | How many minutes the hour divides into.                                                                                  |
| `data.year.secondsPerMinute`           | number                                                            | How many seconds the minute divides into.                                                                                |
| `data.present`                         | a date                                                            | The day the setting stops and play begins — what an age is computed against.                                             |
| `data.body.diameterKm`                 | number                                                            | The body's diameter, in kilometres.                                                                                      |
| `data.body.orbitalRadiusKm`            | number                                                            | How far the body orbits from the one it circles, in kilometres.                                                          |
| `data.body.orbit`                      | string                                                            | The orbit's shape — `circular` means the cycle never varies.                                                             |
| `data.body.inclined`                   | boolean                                                           | Whether the orbit is inclined to the plane the world orbits in.                                                          |
| `data.moon.cycle`                      | number                                                            | How many days the body takes to return to the same phase.                                                                |
| `data.moon.newOn`                      | a day-precision date                                              | A day the body was new, written in the reference calendar.                                                               |
| `data.moon.eclipses`                   | string                                                            | How often the body eclipses or is eclipsed — `never`, `rare`, `occasional` or `frequent`.                                |

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
| `data.party.archetypes` | list              | Archetypes the scenario is written for.          |

### doc

**Subtypes:** `rules`, `userguide`, `reference`, `howto`, `concept`, `settingguide`.

| Field | Shape | Meaning                         |
| ----- | ----- | ------------------------------- |
| —     | —     | No type-specific `data` fields. |

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
