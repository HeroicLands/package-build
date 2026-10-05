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

A leading caption starts a captioned-item JournalEntryPage in Foundry. A solitary image with a plain caption can be an image page; other captioned items become text pages. Websites and books keep captioned items in the surrounding flow.

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

## Captions and numbered references

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

Foundry gives a captioned item its own JournalEntryPage. A solitary image with a plain caption can use an image page; captions with inline markup and other items use text pages. On the website and in the book the item stays in the flow of the surrounding page.

**Migration:** `:::figure` is no longer supported. Move the former `///` caption before the item as `:@ Caption {#id}` and remove the figure wrapper. To caption a group or passage, put it inside a generic fenced div and caption that div with an explicit type if needed. `///` is no longer a caption delimiter.

## Images and protected content

An image or icon embed stands on its own line; one that does not is a lint error naming the line, because a width or a position means nothing applied to a word in the middle of a sentence. `size` accepts `auto`, `small`, `medium`, `large`, `xlarge` and `full-width`; the medium maps those names to suitable dimensions, and `full-width` is the full page in the book and the full content width elsewhere. `float` controls placement and takes `top-left`, `top-right`, `bottom-left`, `bottom-right` or `center`; on a page a float occupies the column measure, so only the vertical half of a corner position has an effect there. The asset remains an Address, so moving the file within its asset root does not change the link. See [assets](assets.md) and [image directives](../reference/format-details.md#images).

### Fenced divs

A bare `:::` opens a div section. An optional attribute block applies to the whole fenced area. A bare `:::` closes the section:

```markdown
::: {#harbor-note .border lang=en}
The harbor remains open through winter.

A second paragraph belongs to the same div.
:::
```

An attribute-bearing opener allows a nested div to be distinguished from the bare closer. Divs carry no automatic title or number; style their classes for the medium. Use a leading caption to caption the entire div. The same attribute grammar is available on named blocks; identifiers, classes and named attributes belong to the entire section. Headings that would start a Foundry journal page cannot split a fenced section.

### Inline spans

`[inline content]` represents a span. Follow it immediately with an optional attribute block to apply an identifier, classes and named attributes:

```markdown
The watch wears [a _blue_ sash]{#watch-sash .uniform lang=en}.
```

Inline Markdown remains active inside the span. Bracket spans have lower priority than URL links, image links, reference links, footnotes and wikilinks. A bracketed form immediately preceded by `!`, followed by `(` or another `[`, or beginning with `[[` is not a span, even when the link is unresolved. Ordinary links retain their existing syntax. Escape a bracket when it should be literal, or put examples inside a code span or fence. A span identifier addresses that point in the note; it does not start a journal page.

### Named blocks

Three named blocks set a passage apart from the prose around it. `:::secret`
marks GM material, `:::info` a neutral note, and `:::warn` a caution:

```markdown
:::warn
The bridge closes during the spring flood.
:::
```

Each heads itself with its own name — **Secret**, **Info**, **Warn** — and takes
a closing `:::`. Poetry uses a code-style fence below; other names are reported.

**A GM-only section holds a box.** A `:::secret` is a container for whatever the
GM reads, boxes included, and a box written inside one stays inside it. A box
holds no named block of its own, so a second box inside a box is reported. A captioned item or generic fenced div may appear inside these sections.

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
block or generic fenced div.** An H1, or a heading of any level
carrying an `{#anchor}`, is reported at its own line there — starting a page
would tear the fenced section in two, and a reader could open the second
half with none of the box around it. A lower heading with no anchor is
unaffected and is the ordinary way to structure a long box.

### Poetry

Use a code fence with the language `poetry` to preserve verse lines and stanzas. Every nonblank source line
is one verse line; blank lines separate stanzas. Inline emphasis, links and
footnotes work as they do in prose. The fence itself adds no title, caption or
number.

Leading spaces indent individual verse lines. The least-indented nonblank line
sets level zero for the whole poem, so a common indentation on every line has no
visual effect. Each additional two spaces adds one level, up to `i8`; an odd
extra space rounds down. Each medium sets the actual width of a level, with
every higher level wider than the preceding one. Tabs anywhere in the poem are
an error. Interior spaces are preserved on a best-effort basis.

| Extra leading spaces | Indent class |
| -------------------- | ------------ |
| 0–1                  | none         |
| 2–3                  | `i1`         |
| 4–5                  | `i2`         |
| 6–7                  | `i3`         |
| 8–9                  | `i4`         |
| 10–11                | `i5`         |
| 12–13                | `i6`         |
| 14–15                | `i7`         |
| 16 or more           | `i8`         |

For example, a line with four leading spaces and a line with six leading spaces
render at levels zero and `i1` respectively. This also works when the entire
fence is indented inside a list item. Poetry is upright by default; use normal
Markdown emphasis when italics are part of the poem.

````markdown
```poetry {form=ballad meter="common meter" rhyme=ABCB syllables="8,6,8,6" lang=en}
The lantern burns beside the gate,
The harbor sleeps below.

The keeper guards the road till dawn,
And keeps a light aglow.
```
````

The optional `form`, `meter` and `rhyme` attributes record the author's intent;
the build does not infer stress, rhyme or pronunciation. `syllables` gives a
positive count for each verse line in order, separated by commas, with blank
stanza lines omitted. The build checks the number of counts, not the syllables
spoken. `lang` is a language tag for the rendered HTML. An optional `#id`
addresses the poem itself. There are no `title` or `lines` attributes, and no
special punctuation for stress, pauses or refrains.

To number and caption a poem, put a leading numbered caption before the poetry fence:

````markdown
:@ A song sung by the harbor watch. {#watch-song}

```poetry {form=ballad}
The watch has gone to sea,
The lantern marks the shore.
```
````

This uses the **Poem** counter, so `{{ref "#watch-song"}}` reads **Poem 1**. Use `:` for a caption without a number. `:::poetry` is no longer supported.

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

| Helper       | Parameters                                 | What it gives you                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eq`         | `a b`                                      | True when both are the same value. Compares exactly, so 1 and "1" differ.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `gt`         | `a b`                                      | True when a is greater than b. Both must be finite numbers.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `gte`        | `a b`                                      | True when a is greater than or equal to b. Both must be finite numbers.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `lt`         | `a b`                                      | True when a is less than b. Both must be finite numbers.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `lte`        | `a b`                                      | True when a is less than or equal to b. Both must be finite numbers.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `not`        | `value`                                    | True when the value is false, zero, empty or absent.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `and`        | `value …`                                  | True when every value given is true. Takes two or more.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `or`         | `value …`                                  | True when any value given is true. Takes two or more.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `words`      | `number`                                   | The number spelled out for running prose — `1200` becomes one thousand two hundred. Whole numbers only; a decimal is a finding, and `digits` takes one.                                                                                                                                                                                                                                                                                                                            |
| `digits`     | `number`                                   | The number as a grouped numeral — `1200` becomes 1,200, and a fractional part is kept.                                                                                                                                                                                                                                                                                                                                                                                             |
| `sql`        | `"query"`                                  | The single value a query returns, for use inside a sentence. The query is a quoted string, the same SQL a table fence takes.                                                                                                                                                                                                                                                                                                                                                       |
| `dateformat` | `calendar date ["format"]`                 | A date written in a calendar. The calendar is an Address or its shortcode, the date is the value a note carries, and the optional third argument names an output pattern.                                                                                                                                                                                                                                                                                                          |
| `ref`        | `address [form="number"\|"full"\|"title"]` | A link to a captioned item, by its anchor — `"#thorn"` on this note, `"note-address#thorn"` on another. `form` is `number` (the default, and admitted explicitly), rendering "Figure 13"; `full`, the number and the caption; or `title`, the caption alone. Always renders as a link to the figure, and a link inside the caption contributes only its label text. The number rendered is the one the figure carries on the surface doing the rendering, whichever note names it. |

<!-- expression-helpers:end -->

A helper that is given the wrong kind of value reports it rather than printing something wrong: `words` refuses a decimal, the four comparisons refuse anything that is not a finite number, and `dateformat` refuses a date it cannot resolve in the calendar it was given.

See [date rules](dates-and-calendars.md) for what `dateformat` accepts and the patterns its third argument names.
