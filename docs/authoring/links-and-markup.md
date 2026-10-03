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

A link to a note tagged `draft` retains its target and carries a visible draft cue. In a book, the cue reads `(draft)` after the link.

**An address that resolves nowhere is an error on all three surfaces**, worded the same way by each. The pack build refuses the note and produces no pack from it. The site build and the book build write what they can and fail the run: a page marks the link for the reader, and a book sets `(unresolved link)` after its label. The book is written so the page carrying the mistake can be found, not because the mistake is tolerated there.

An HTML comment is an aside to whoever reads the note next, and no surface shows one — the packs and the website emit it into the HTML, where it stays a comment, and a book leaves it out. Write a `markdownlint` pragma or a note about a quoted passage freely. A comment inside a fence or a code span is an example and is printed as written, and a comment that is never closed is an error.

## Journal pages and anchors

Every H1 starts a JournalEntryPage. A lower-level heading with an explicit anchor starts a page too. Use `{#slug}` to make a stable target:

```markdown
# The Harbor {#harbor}

The harbor faces west.

## Customs House {#customs-house}

Travelers present their papers here. See [[#harbor|the harbor]].
```

A `:::figure` fence starts a JournalEntryPage too, in Foundry alone — the web and the book keep the fence in the flow of the page around it. A fence holding exactly one picture, captioned with plain text and nothing else, becomes a page of type `image`: the picture is its `src`, the caption is `image.caption`, and the page is named for the figure's own number, such as "Figure 3". A fence carrying no caption still takes the `image` type when it holds one picture, named the same way. Every other fence takes a page of type `text` instead — a grouped fence holding more than one picture, an audio embed, a fence whose caption carries emphasis, an icon, or a link, and a fence that shares its page with trailing prose before the next heading or fence.

The prose introducing a fence and the fence itself land on two different Foundry pages, so a reference such as `{{ref "#trade"}}` written just above a fence sends a Foundry reader to a different page than the one carrying the sentence. Give the introducing prose its own heading, or accept that following the reference leaves the page, before relying on a fence to sit inside a longer page's flow.

A heading's braces hold an attribute block, not an anchor alone: `#slug` names the anchor, `.class` adds a CSS class, and `key="value"` writes an attribute. The website and a Foundry journal carry all three onto the heading; a book keeps the anchor and drops the rest, because Typst has no stylesheet to name a class in. Braces holding anything but an attribute block — `# The set {a, b}` — are reported at the heading's line and set as written.

Another note can link to `[[lore-harbor#customs-house|Customs House]]`. For Items, `{#description}` selects the JournalEntryPage both systems reference, and accepts a heading at any level. A map note can use an anchored heading for a scene pin; the compiler replaces the pin's exported JournalEntry and page IDs with the built note's IDs and uses the heading text as its label. See [map notes](../reference/format-details.md#type-map) for scene fields.

### A section players must not read

Write `.secret` on the heading that opens the section:

```markdown
# The Cellar {#cellar .secret}

The contraband is behind the false wall.
```

The section runs from that heading to the next heading that opens a page. In Foundry the page is the GM's alone. On the website and in the book the section sits inside the same expandable spoiler and the same labelled block a `:::secret` block gets. The heading keeps its id, so `[[lore-inn#cellar|the cellar]]` still resolves to it.

**On the website this is a spoiler, not access control.** The withheld section is in the published page, so anyone who opens the element or reads the page source reads it. Foundry is the only surface that withholds anything. Write nothing in a `.secret` section that would matter if a player read it on the web.

A `:::secret` block inside the section is legal and renders as it does anywhere else. `.secret` on a heading that opens no page — a lower-level heading with no anchor — covers no page, and is reported at its own line: give that heading an anchor, or raise it to the top level.

The special Actor anchors `{#appearance}` and `{#dossier}` feed the same authored sections to each system's Actor fields, and take an H1 only — not the lower-level heading a journal page may otherwise start from. The section runs to the next H1, nested headings included. An anchor declared on a lower heading is still found, and is a build error rather than a quietly empty field: move the heading to the top level, or drop the anchor if the section is meant to stay unaddressed prose.

## Figures and numbered references

A `:::figure` fence numbers whatever it holds and, written with an id, makes it a target `{{ref}}` can point to:

````markdown
:::figure {#trade}

```sql
SELECT name.full AS "Market" FROM notes WHERE type = 'place'
```

///
Regional trade routes
:::

Refer to {{ref "#trade"}} for the market routes.
````

The fence displays **Table 1: Regional trade routes**, and `{{ref "#trade"}}` displays **Table 1** as a link. **A figure is numbered because it is a fence, not because it carries caption text** — an ordinary table or picture written outside any fence is numbered not at all.

**The construct is `:::figure`**, with an optional `{#id .border}` attribute block, closed by `:::`. Everything between the opening line and the closing `:::` is the captioned thing.

**The first `///` at the top level of the fence separates the captioned thing from its caption.** A second `///` at the top level is an error — a figure holds one caption. A `///` written inside a nested code fence is content, not a separator, so a captioned code listing can carry `///` as a comment of its own.

**The caption is optional.** A fence with no `///` draws its label alone, with nothing under it. So the counter and the label come from the fence itself, whether or not an author writes a caption.

**`{#id}` is optional too.** A fence that declares none is still numbered and drawn; it carries no anchor, so nothing can refer to it. Give a figure an id only when prose needs to point at it.

**`.border` draws the figure and its label inside a border.** It is the only class the construct accepts — any other class, such as `.wide`, is an error naming the class. `key="value"` is refused outright: a figure takes an id and classes, nothing else.

**The counter is derived from the fence's contents, never authored.** A table is a table; an `sql` fence is a table, because its rendered output is one; any other fence or code block is code; pictures alone, one or several, are a figure; everything else is prose. A fence around prose with `.border` is a numbered, referable boxed aside — the `Prose` counter's whole purpose. The counters are `Code`, `Table`, `Figure`, and `Prose`. The website and a Foundry journal number each counter within the note; a book numbers each counter across the book in reading order.

**A reference is written `{{ref "#thorn"}}`**, rendering as a link reading "Figure 13". `form="full"` renders the number and the caption; `form="title"` renders the caption alone; `form="number"` is the default, and may be written explicitly. A link written inside the caption contributes only its label text to a `full` or `title` reference, because the reference is itself a link and an anchor cannot nest inside another.

**A reference may name another note's figure**, writing the note's address before the anchor: `{{ref "place-thornford#trade"}}` points at the figure `#trade` in `place-thornford`. It renders the number that figure carries **on the surface doing the rendering** — its own count within `place-thornford` on the website and in a Foundry journal, and its place in the book's reading order in the book, which may differ from the number it carries on its own page. An anchor matching no figure in the addressed note is refused, and so is an address naming no note at all.

In a Foundry journal, a reference resolves to the figure's own JournalEntryPage — the `image` page a solitary, plainly captioned picture becomes, or the `text` page any other fence becomes — addressed exactly as an authored `[[#anchor|Text]]` link to the same anchor would be. A reference naming another note's figure is not resolved there: a journal addresses a page by UUID, and has none for a note outside the one compiling.

**A figure needs contents and a closing `:::`.** Its id, when one is given, must be unique in the note; its caption, when one is given, is the one `///` section the fence carries.

A few worked examples. A captioned picture:

```markdown
:::figure {#thorn}
![[being-foobar|The Great Beast]]
///
The great beast, as drawn by [[person-havard|Havard]].
:::
```

This draws **Figure 1**, labelled "Figure 1: The great beast, as drawn by Havard." beneath the picture.

A grouped fence holding two pictures as one figure — a plate rather than two separate plates:

```markdown
:::figure {#passes}
![[image-northpass|Northern approach]]
![[image-southpass|Southern approach]]
///
The two approaches to the pass.
:::
```

Both pictures draw together under one label, **Figure 2**, because the fence is the unit the counter numbers — not the pictures inside it.

A fence with no caption:

```markdown
:::figure {#anvil}
![[icon-anvil|A worn anvil]]
:::
```

This draws **Figure 3**, with no caption line beneath it, and still carries the anchor `#anvil`.

A reference in running prose:

```markdown
See {{ref "#thorn"}} for the plate, or {{ref "#thorn" form="full"}} for the full description.
```

This displays as "See [Figure 1](#thorn) for the plate, or [Figure 1: The great beast, as drawn by Havard.](#thorn) for the full description," each bracketed phrase a link to the figure.

A reference to a figure in another note:

```markdown
The market routes are drawn in {{ref "place-thornford#trade"}}.
```

On the website this links into `place-thornford`'s own page, reading "Table 1" — the number that fence carries there, whatever number it carries in the book or in a note of its own.

## Images and protected content

An image or icon embed stands on its own line; one that does not is a lint error naming the line, because a width or a position means nothing applied to a word in the middle of a sentence. `size` accepts `auto`, `small`, `medium`, `large`, `xlarge` and `full-width`; the medium maps those names to suitable dimensions, and `full-width` is the full page in the book and the full content width elsewhere. `float` controls placement and takes `top-left`, `top-right`, `bottom-left`, `bottom-right` or `center`; on a page a float occupies the column measure, so only the vertical half of a corner position has an effect there. The asset remains an Address, so moving the file within its asset root does not change the link. See [assets](assets.md) and [image directives](../reference/format-details.md#images).

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
`:::figure` fence may be written inside any of them. The two draw a box for
different reasons: a named block says what kind of aside a passage is, while a
`:::figure` fence makes a passage numbered and referable — nesting one inside
the other gives a passage both.

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

**A heading that would start its own journal page cannot be written inside a
block, or inside a `:::figure` fence.** An H1, or a heading of any level
carrying an `{#anchor}`, is reported at its own line there — starting a page
would tear the block or the figure in two, and a reader could open the second
half with none of the box around it. A lower heading with no anchor is
unaffected and is the ordinary way to structure a long box.

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

A reference may be written anywhere prose can be written — a word in a
quotation, a bullet, a table cell, a heading, a named block, a figure's
caption. A
definition belongs at the top level of the note: indent a following paragraph
or code block by four spaces to include it in the same footnote, but never
inside a list, a block quote, or a table. A definition written there, or a
reference with none at the top level to resolve against, is reported at its
own line rather than rendered. On the web, linked footnotes appear in a
Footnotes section at the bottom of the HTML page. In Foundry, each
JournalEntryPage places its referenced footnotes in a Footnotes section at the
bottom of that page; definitions remain available across pages of the same
note. In a book, footnotes appear in smaller type at the bottom of the page
that contains their reference.

A definition list gives a term one or more definitions:

```markdown
Janapada
: A territorial community with its own institutions.
: Also the land associated with that community.
```

The web and Foundry render a definition list with HTML `<dl>`, `<dt>`, and
`<dd>` elements. The book renders it as a term list.

## Lists

A list item's text begins right after its marker. `[ ]` and `[x]` there are
plain words, not a checkbox — write what is done into the item itself:

```markdown
- the harbor toll: paid
- the ferry crossing: owed
```

## SQL generated tables

A fence marked `sql` is replaced by a table built from the content index. The query reads the frontmatter of every indexed note, so a table is written once and stays true as notes are added.

````markdown
```sql
SELECT name.full AS "Name" FROM notes WHERE type = 'lore' ORDER BY name.full
```
````

A column's heading is its SQL alias, so `AS "Name"` is what a reader sees. A cell that is absent prints an em dash. A `|` or a line break inside a value is escaped, so neither breaks the table.

### What a query can read

| Relation          | What it holds                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `notes`           | Every note except a stub. This is the one to use unless a stub is wanted.                                                     |
| `entries`         | Every note, stubs included.                                                                                                   |
| `market`          | The market scale as three columns — `value`, `name`, `trade` — so a table can print `village` beside the number a note wrote. |
| `<package>.notes` | The same two relations for each package this one declares a dependency on, in a schema named for it.                          |

Nested frontmatter is addressed exactly as a note writes it: `name.full`, `sohl.weight`, `data.born`. Every note carries a computed `state` column of `full`, `draft` or `stub`. Notes tagged `gm` are absent from the relations on public surfaces.

### Fence attributes

A braced list may follow the language on the opening fence. Two attributes are accepted, and anything else is reported by name.

| Attribute       | Value                       | Default | What it does                                                                                                                                                                            |
| --------------- | --------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allow-empty`   | `true` or `false`           | `false` | Whether a query selecting no rows is allowed. A zero-row result is a finding otherwise, because a table that silently prints nothing is the commonest way a query goes wrong unnoticed. |
| `section-level` | an integer from 1 through 6 | `2`     | The heading level given to each group a `_section` column creates.                                                                                                                      |

````markdown
```sql {allow-empty=true section-level=3}
SELECT name.full AS "Name" FROM notes WHERE type = 'being' AND data.gender = 'none'
```
````

A zero-row result reports which relation was queried: a query over `notes` that would have found rows in `entries` says so, so the fix is `FROM entries` rather than `{allow-empty=true}`.

### Two column names the renderer reads

Two aliases are instructions rather than columns, and neither is printed.

| Alias      | What it does                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `_ref`     | The note a row points at, written as the `type-shortcode` address a wikilink resolves. The row's first column becomes a link to that note.                         |
| `_section` | Partitions the result into separate tables, each under a heading of its own. Order the query by the same expression, because a group ends where the value changes. |

```sql
SELECT type AS "_section", name.full AS "Name", address.slug AS "_ref"
FROM notes WHERE type IN ('lore', 'place') ORDER BY type, name.full
```

See [SQL details](../reference/format-details.md#content-tables) for query options.

## Page lists

A fence marked `pagelist` is replaced by a list of the pages carrying a tag. Where a content table answers "what do these notes say?", a page list answers "which pages belong to this group?" — and the group is expressed by intent rather than enumerated, so a page joins it by being tagged and leaves it by being untagged.

````markdown
```pagelist {tag="key-concept"}

```
````

**The fence holds nothing.** Everything the directive says about itself is written in the braced attribute block, in the same grammar every other body extension uses. Text written inside the fence is reported rather than printed.

Each page comes out as a link to the note, so one authored directive reaches a reader as a compendium link in Foundry, a page link on the website, and a page reference in the book. A link into a note tagged `draft` carries the same cue an authored link to it would.

### Page-list attributes

<!-- page-list-attributes:start -->

| Attribute      | Value             | Default    | What it does                                                                                                                                              |
| -------------- | ----------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tag`          | a tag             | required   | The tag a page carries to join the list. Matched the way `tags:` is read — case and a leading `#` are not significant, the spelling of the tag itself is. |
| `type`         | a note type       | every type | Restricts the list to one note type. A page's address is `<type>-<shortcode>`, so the type is what divides the corpus into kinds of page.                 |
| `sort`         | `name` or `type`  | `name`     | The order the pages come out in. `name` is alphabetical; `type` groups the note types and orders by name within each.                                     |
| `descriptions` | `true` or `false` | `false`    | Whether each page's `description` follows its link. A page that states none carries its link alone.                                                       |
| `allow-empty`  | `true` or `false` | `false`    | Whether a tag carried by no page is allowed. It is a finding otherwise, because a heading with nothing under it is how a misspelled tag goes unnoticed.   |

<!-- page-list-attributes:end -->

````markdown
```pagelist {tag="key-concept" type=lore sort=type descriptions=true}

```
````

That list names the `lore` notes tagged `key-concept`, grouped by type and alphabetical within each, with every page's `description` after its link. A page that states no description carries its link alone.

**A tag no page carries is a finding** at the fence's own line, naming the tag it looked for. A misspelled tag is the whole of what goes wrong here, and a heading with an empty list under it is how one goes unnoticed. Write `{allow-empty=true}` where a group that is genuinely empty is intended; the directive then leaves nothing behind rather than an empty list.

A page list names this package's own pages. A **stub** — a note with an empty body — publishes no page, so it joins no list. A note tagged `gm` is listed in Foundry and left out of the website and the book, exactly as it is left out of a content table's relations.

See [page-list details](../reference/format-details.md#page-lists) for the directive's full behaviour.

## Expressions

An expression in `{{ }}` is replaced by a value, inline in a sentence. The note's own frontmatter is the context, so a field is read by the path a note writes it at.

```markdown
{{name.full}} was born on {{dateformat data.calendar data.born}}.
There are {{words (sql "SELECT COUNT(*) FROM notes WHERE type = 'being'")}} beings.
```

### The rules of the construct

- **A field that the note does not carry is a finding, not a blank.** Expressions are compiled strictly, so a misspelled path is reported rather than quietly printing nothing.
- **An expression is one line.** It may not contain a line break or a brace.
- **A failed expression leaves its own text in the page** and reports the line and column it is written on, so the page is readable and the fault is locatable.
- **`\{{` writes an expression without evaluating it**, for an example in prose.
- **`{{{…}}}`, `{{<…}}` and `{{%…}}` are left alone.** A Hugo shortcode is not an expression.
- **An expression inside a code fence is left alone.**
- Helpers nest, with the inner call in parentheses: `{{words (sql "…")}}`.

### Helpers

<!-- expression-helpers:start -->

| Helper       | Parameters                                 | What it gives you                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eq`         | `a b`                                      | True when both are the same value. Compares exactly, so 1 and "1" differ.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `gt`         | `a b`                                      | True when a is greater than b. Both must be finite numbers.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `gte`        | `a b`                                      | True when a is greater than or equal to b. Both must be finite numbers.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `lt`         | `a b`                                      | True when a is less than b. Both must be finite numbers.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `lte`        | `a b`                                      | True when a is less than or equal to b. Both must be finite numbers.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `not`        | `value`                                    | True when the value is false, zero, empty or absent.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `and`        | `value …`                                  | True when every value given is true. Takes two or more.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `or`         | `value …`                                  | True when any value given is true. Takes two or more.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `words`      | `number`                                   | The number spelled out for running prose — `1200` becomes one thousand two hundred. Whole numbers only; a decimal is a finding, and `digits` takes one.                                                                                                                                                                                                                                                                                                                               |
| `digits`     | `number`                                   | The number as a grouped numeral — `1200` becomes 1,200, and a fractional part is kept.                                                                                                                                                                                                                                                                                                                                                                                                |
| `sql`        | `"query"`                                  | The single value a query returns, for use inside a sentence. The query is a quoted string, the same SQL a table fence takes.                                                                                                                                                                                                                                                                                                                                                          |
| `dateformat` | `calendar date ["format"]`                 | A date written in a calendar. The calendar is an Address or its shortcode, the date is the value a note carries, and the optional third argument names an output pattern.                                                                                                                                                                                                                                                                                                             |
| `ref`        | `address [form="number"\|"full"\|"title"]` | A link to a `:::figure` fence, by its anchor — `"#thorn"` on this note, `"note-address#thorn"` on another. `form` is `number` (the default, and admitted explicitly), rendering "Figure 13"; `full`, the number and the caption; or `title`, the caption alone. Always renders as a link to the figure, and a link inside the caption contributes only its label text. The number rendered is the one the figure carries on the surface doing the rendering, whichever note names it. |

<!-- expression-helpers:end -->

A helper that is given the wrong kind of value reports it rather than printing something wrong: `words` refuses a decimal, the four comparisons refuse anything that is not a finite number, and `dateformat` refuses a date it cannot resolve in the calendar it was given.

See [date rules](dates-and-calendars.md) for what `dateformat` accepts and the patterns its third argument names.
