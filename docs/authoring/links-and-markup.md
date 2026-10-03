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

An image or icon embed stands on its own line. `size` accepts `auto`, `small`, `medium`, `large`, `xlarge` and `full-width`; the medium maps those names to suitable dimensions, and `full-width` is the full page in the book and the full content width elsewhere. `float` controls placement and takes `top-left`, `top-right`, `bottom-left`, `bottom-right` or `center`; on a page a float occupies the column measure, so only the vertical half of a corner position has an effect there. The asset remains an Address, so moving the file within its asset root does not change the link. See [assets](assets.md) and [image directives](../reference/format-details.md#images).

### Named blocks

Three named blocks set a passage apart from the prose around it. `:::secret`
marks GM material, `:::info` a neutral note, and `:::warn` a caution:

```markdown
:::warn
The bridge closes during the spring flood.
:::
```

Each heads itself with its own name — **Secret**, **Info**, **Warn** — and takes
a closing `:::`. A name that is not one of the three is reported.

**A GM-only section holds a box.** A `:::secret` is a container for whatever the
GM reads, boxes included, and a box written inside one stays inside it. A box
holds no named block of its own, so a second box inside a box is reported. A
`:::caption` belongs to the caption construct and may be written inside any of
them.

**An attribute block follows the name.** It is the same braced grammar the other
body extensions use, so it carries an id, classes, and any attribute the element
should have. `title` is reserved and supplies the heading in place of the default:

```markdown
:::secret {#harbor title="For the GM" .wide data-stage="two"}
The harbor master is working for the smugglers.
:::
```

That block carries the classes `secret wide`, the id `harbor`, and
`data-stage="two"`, and it heads **For the GM**. A title carries emphasis of its
own — `title="The *Genzet* only"` — and nothing else: a tag written there is
shown rather than obeyed. Set the id with `#id` and classes with `.class` rather
than through an `id=` or `class=` key, and note that an event handler such as
`onclick=` is refused rather than written.

**The name is the first class on the element, and the appearance belongs to a
stylesheet.** No block is emitted with an inline `style`, so a package restyles
one from its own sheet. `info` and `warn` are styled by the base stylesheet;
`secret` is left to Foundry, which styles `section.secret` itself and owns the
reveal control on it.

Each surface renders the same block its own way:

| Surface | Output                                                                             |
| ------- | ---------------------------------------------------------------------------------- |
| Foundry | `<section class="secret" id="harbor">` with the title as its first line            |
| Web     | `<details class="secret" id="harbor">` the reader opens, titled in its `<summary>` |
| Book    | a coloured print box headed by the title                                           |

A `secret` with no id of its own is given one derived from its body on the
Foundry surface, because Foundry remembers a revealed section by its id.

**A secret is a presentation distinction, not access control.** Players who
deliberately inspect source or generated output may see it. The
[detailed reference](../reference/format-details.md#what-a-note-produces)
describes each medium's handling.

**One malformed block does not silence the others.** A block whose attributes do
not parse is reported at its own line and left as written; every well-formed
block in the same note still renders.

## Footnotes and definition lists

Write a footnote reference as `[^id]` and its definition as `[^id]: text`.
The ID can be a number or word without spaces or tabs. It connects the
reference to its definition within one Markdown note; another note can reuse
the same ID for a different footnote. Rendered markers are numbers assigned in
the order of first reference, including when the authored ID is a word.

```markdown
The road is passable in summer.[^season] The bridge has a toll.[^2]

[^season]: Spring flooding closes it for several weeks.

[^2]: The toll is collected at the eastern gate.
```

Definitions can appear anywhere at the top level of the note. Indent a
following paragraph or code block by four spaces to include it in the same
footnote. Keep definitions outside lists, block quotes, and tables. On the web,
linked footnotes appear in a Footnotes section at the bottom of the HTML page.
In Foundry, each JournalEntryPage places its referenced footnotes in a Footnotes
section at the bottom of that page; definitions remain available across pages
of the same note. In a book, footnotes appear in smaller type at the bottom of
the page that contains their reference.

A definition list gives a term one or more definitions:

```markdown
Janapada
: A territorial community with its own institutions.
: Also the land associated with that community.
```

The web and Foundry render a definition list with HTML `<dl>`, `<dt>`, and
`<dd>` elements. The book renders it as a term list.

## Tables and expressions

Use a SQL fence to render a table from the content index. The table reads frontmatter from indexed notes. A zero-row result is an error unless the fence permits an empty result with `{allow-empty=true}`.

````markdown
```sql
SELECT name.full AS "Name" FROM notes WHERE type = 'lore' ORDER BY name.full
```
````

Inline expressions can read the note, format dates, combine values, or run scalar SQL:

```markdown
{{name.full}} was born on {{dateformat "vrcal" data.born}}.
There are {{words (sql "SELECT COUNT(*) FROM notes WHERE type = 'being'")}} beings.
The index contains {{digits (sql "SELECT COUNT(*) FROM entries")}} entries.
{{and (gt 3 5) (lt 4 2)}}
```

Use `{{dateformat data.calendar data.born}}` when the note supplies a calendar Address. A third argument selects a named output pattern, as in `{{dateformat data.calendar data.born "long"}}`. SQL fences produce tables; the `sql` helper returns one value for an inline expression. Wrap a numeric result in `words` for running prose or `digits` for a grouped numeral. See [date rules](dates-and-calendars.md) and [SQL details](../reference/format-details.md#content-tables) for query options.
