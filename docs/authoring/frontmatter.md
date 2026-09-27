---
shortcode: authoringfrontmatter
name: { full: "Frontmatter and system blocks" }
type: doc
subType: howto
---

# Frontmatter and system blocks

HeroicLands notes begin with YAML frontmatter. A file is recognized as a note when its opening frontmatter has nonempty `shortcode` and `type` values. Ordinary Markdown files need neither. Keep top-level keys in this order, omitting keys that do not apply: `shortcode`, `name`, `type`, `subType`, `description`, `tags`, `data`, `hm3`, `sohl`. Any other top-level key is an error.

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

`name.full` is the displayed name; `name.aliases` helps search. `description` is the short page summary. `tags` hold draft state and classification. `data` holds facts about the subject shared by systems. A YAML comment is the place for an author-only note: commented values remain valid YAML but do not enter the content index or generated documents.

The formatter keeps a collection on one line when the full line is under 100 characters. Longer collections use full YAML block form. Run `package-build format --write` to apply key order and collection formatting.

## Shared facts and game mechanics

The [note-type reference](../reference/note-types.md) lists every field accepted under `data`, including the shared `id`, `pack`, `packFolder`, `harnworld`, `icon`, and `banner` fields. A type such as `being` also has its own fields, including `culture`, `homes`, and `affiliations`. A field absent from a type's vocabulary is a lint error; an unrelated field is not silently repurposed.

A `sohl:` or `hm3:` block holds values for that Foundry system. Its `system:` child contains values sent to the system's DataModel. The system block can override shared routing and art where the declared field permits it. `data.pack` and `data.packFolder` are shared routes; a system-specific route belongs in that system block. The [detailed mapping reference](../reference/format-details.md#mappings-every-type-shares) and [system-block explanation](../reference/format-details.md#frontmatter-has-three-regions) cover precedence and emitted fields.

One body describes the subject for both systems. A being's `{#appearance}` and `{#dossier}` sections feed SoHL Actor `system.appearance` and `system.dossier`, and HM3 Actor `system.description` and `system.biography`. An Item's `{#description}` page becomes a shared JournalEntryPage. Its resolved `@UUID[...]` pointer is stored in SoHL Item `system.docHtml` and HM3 Item `system.description`. An Item with no `{#description}` anchor uses its first page. Other H1 pages remain linkable.

## Publication and summaries

A note infobox draws from shared `data`. A system infobox draws from the system's fields, and a mapped system with no document says “Not available.” The same authored body appears in Foundry, on the website, and in the book; presentation adapts to each medium. [Infobox details](../reference/format-details.md#the-infobox) describe field order and empty values.
