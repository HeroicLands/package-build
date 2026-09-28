---
shortcode: authoringlinksandmarkup
name: { full: "Addresses, links, and body markup" }
type: doc
subType: howto
---

# Addresses, links, and body markup

An Address names content independently of its filename or folder. Its full form is `<package>-<system>-<type>-<shortcode>`. A regular prose link defaults to system `note`, and an asset embed defaults to system `none`. Omitted segments take their defaults from the writing context; a short form must still resolve unambiguously. Frontmatter fields that declare an Address contain the bare Address, without brackets.

```markdown
[[lore-harbor|Harbor]]
[[thalorna-note-lore-harbor|]]
![[icon-harbor|Harbor emblem]]{float=top-left size=medium}
```

The part after `|` is the displayed link text or an embed's alternative text. An empty label uses the target's current name in a regular link and marks an embed decorative. A missing pipe is an error. Search may use `name.full` and aliases; authored links use Addresses. The [Address reference](../reference/format-details.md#addresses) explains short forms, package qualification, and ambiguity diagnostics.

A link to a note tagged `draft` retains its target and carries a visible draft cue. In a book, the cue reads `(draft)` after the link. A link that resolves nowhere produces a diagnostic and reads `(unresolved link)` after its label in the book.

## Journal pages and anchors

Every H1 starts a JournalEntryPage. A lower-level heading with an explicit anchor starts a page too. Use `{#slug}` to make a stable target:

```markdown
# The Harbor {#harbor}

The harbor faces west.

## Customs House {#customs-house}

Travelers present their papers here. See [[#harbor|the harbor]].
```

Another note can link to `[[lore-harbor#customs-house|Customs House]]`. The special Actor anchors `{#appearance}` and `{#dossier}` feed the same authored sections to each system's Actor fields. For Items, `{#description}` selects the JournalEntryPage both systems reference. A map note can use an anchored heading for a scene pin; the compiler replaces the pin's exported JournalEntry and page IDs with the built note's IDs and uses the heading text as its label. See [map notes](../reference/format-details.md#type-map) for scene fields.

## Captions and numbered references

A caption fence labels the next Markdown block. Give it an ID so prose can refer to the block without hard-coding its number:

````markdown
Refer to [[#trade|]] for the market routes.

:::caption {#trade}
Regional trade routes
:::

```sql
SELECT name.full AS "Market" FROM notes WHERE type = 'place'
```
````

The table displays **Table 1: Regional trade routes**, and the reference displays **Table 1**. The number is assigned by the output. An explicit link label, such as `[[#trade|the trade table]]`, displays the written label. A caption can precede a code fence, table, image, or any prose block. An ordinary code fence is code; an SQL result is a table; an image is a figure; every other block is prose. Web pages and Foundry journals number each kind within the note. Books number each kind across the book in reading order. A caption needs a unique ID, nonempty text, a closing `:::`, and a following block.

## Images and protected content

An image or icon embed stands on its own line. `size` accepts `auto`, `small`, `medium`, `large`, and `xlarge`; the medium maps those names to suitable dimensions. `float` controls placement. The asset remains an Address, so moving the file within its asset root does not change the link. See [assets](assets.md) and [image directives](../reference/format-details.md#images).

A `:::secret` block marks GM material while keeping it in the same authored note:

```markdown
:::secret
The harbor master is working for the smugglers.
:::
```

Players who deliberately inspect source or generated output may see it; the block is a presentation distinction, not access control. The [detailed reference](../reference/format-details.md#what-a-note-produces) describes each medium's handling.

Use `:::info` for a neutral note and `:::warn` for a caution. Both render as
labelled, colored boxes on the web and in Foundry, and as print boxes in a book:

```markdown
:::warn
The bridge closes during the spring flood.
:::
```

An optional `{#id}` gives the box an HTML anchor. These blocks need a closing
`:::` and cannot be nested.

## Tables and expressions

Use a SQL fence to render a table from the content index. The table reads frontmatter from indexed notes. A zero-row result is an error unless the fence explicitly permits an empty result.

````markdown
```sql
SELECT name.full AS "Name" FROM notes WHERE type = 'lore' ORDER BY name.full
```
````

Inline expressions can read the note, format dates, combine values, or run scalar SQL:

```markdown
{{name.full}} was born on {{dateformat "vrcal" data.born}}.
There are {{sql "SELECT COUNT(*) FROM notes WHERE type = 'being'"}} beings.
{{and (gt 3 5) (lt 4 2)}}
```

Use `{{dateformat data.calendar data.born}}` when the note supplies a calendar Address. SQL fences produce tables; the `sql` helper returns a value for an inline expression. See [date rules](dates-and-calendars.md) and [SQL details](../reference/format-details.md#content-tables) for query options.
