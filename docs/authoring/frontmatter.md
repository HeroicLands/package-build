---
shortcode: authoringfrontmatter
name: { full: "Frontmatter and system blocks" }
type: doc
subType: howto
---

# Frontmatter and system blocks

HeroicLands notes begin with YAML frontmatter. A file is recognized as a note when its opening frontmatter has nonempty `shortcode` and `type` values. Ordinary Markdown files need neither. Keep top-level keys in this order, omitting keys that do not apply: `shortcode`, `name`, `type`, `subType`, `description`, `tags`, `data`, `dnd5e`, `hm3`, `sohl`. Any other top-level key is an error at its own line, naming the closed vocabulary and the declared key it was most likely meant to be. The [note-type reference](../reference/note-types.md#top-level-keys) says what each one means.

```yaml
---
shortcode: harbor
name: { full: Harbor, aliases: [The Harbor] }
type: lore
subType: concept
description: A sheltered trading port.
tags: [draft]
data: {}
---
```

`name` is a map with a required, nonempty `full` display name. Every note may also use `aliases` for an ordered list of other names. The note infobox lists aliases directly beneath the full name. For a `being` with `subType: character`, `given` and `clan` are optional name components. The first alias of a character or NPC is its nickname. Omit optional keys when they do not apply; `given`, `clan`, and alias entries must be nonempty strings when present. No other keys are accepted under `name`.

`description` is the short page summary. `tags` hold draft state and descriptive labels. The note type's classification belongs in `subType` where it is declared. `data` holds facts about the subject shared by systems. A YAML comment is the place for an author-only note: commented values remain valid YAML but do not enter the content index or generated documents.

Use `tags: [gm]` for a note intended only for the GM. It is absent from the public website and book. Foundry includes it only when its document routes to a pack with `private: true`. A note with `gm` that also creates a prose JournalEntry needs a private JournalEntry pack. Links from untagged notes to GM notes are errors; GM notes may link to one another.

The formatter keeps a collection on one line when the full line is under 100 characters. Longer collections use full YAML block form. Run `package-build format --write` to apply key order and collection formatting.

## Shared facts and game mechanics

The [note-type reference](../reference/note-types.md) lists every field accepted under `data`, including the shared `id`, `pack`, `packFolder`, `harnworld`, `icon`, and `banner` fields. A type such as `being` also has its own fields, including `culture`, `homes`, and `affiliations`. A field absent from a type's vocabulary is a lint error; an unrelated field is not silently repurposed.

A being's `data.archetypes` names the roles it can fill in an adventure. Choose every specific role that fits, such as `entertainer` for a performer or `guildsperson` for someone whose professional training or connections matter. Use `[commoner]` when no specific archetype fits. `commoner` cannot share the list with another value. The [archetype reference](../reference/format-details.md#actors) defines the available roles.

A `sohl:`, `hm3:` or `dnd5e:` block holds values for that Foundry system. Its `system:` child contains values sent to the system's DataModel. The system block can override shared routing and art where the declared field permits it. `data.pack` and `data.packFolder` are shared routes; a system-specific route belongs in that system block. The [detailed mapping reference](../reference/format-details.md#mappings-every-type-shares) and [system-block explanation](../reference/format-details.md#frontmatter-has-three-regions) cover precedence and emitted fields.

One body describes the subject for both systems. A being's `{#appearance}` and `{#dossier}` sections feed SoHL Actor `system.appearance` and `system.dossier`, and HM3 Actor `system.description` and `system.biography`. An Item's `{#description}` page becomes a shared JournalEntryPage. Its resolved `@UUID[...]` pointer is stored in SoHL Item `system.docHtml` and HM3 Item `system.description`. An Item with no `{#description}` anchor uses its first page. Other H1 pages remain linkable.

## Place governments

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

These rules apply to every place subtype, including settlements, sites, structures, features, regions and worlds. Empty strings, numbers, lists, maps, references to another note type and unresolved references are errors. They do not declare anarchy. `domains`, `parents`, containment and capitals do not supply a government. The generated `governed_by` and `governed_places` lists use only explicit government references. Legacy affiliation `data.domains` is accepted temporarily but ignored; record any distinct ownership or influence in prose. See [government migration](../guides/government-migration.md).

## Publication and summaries

A note infobox draws from shared `data`. A being profile shows its top-level `subType` as `Type: Character`, `Type: NPC`, or `Type: Creature`. A system infobox draws from the system's fields, and a mapped system with no document says “Not available.” The same authored body appears in Foundry, on the website, and in the book; the book places boxes after the authored body, Foundry appends one page per box, and the website places boxes in its responsive side rail. [Infobox details](../reference/format-details.md#the-infobox) describe field order and empty values.
