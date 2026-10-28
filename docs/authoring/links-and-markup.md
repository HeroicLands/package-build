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

The part after `|` is the displayed link text or an embed's alternative text. An empty label uses the target's current name in a regular link and marks an embed decorative. A missing pipe is an error. Search may use `name.full` and the forms a note's `name` lists; authored links use Addresses. The [Address reference](../reference/format-details.md#addresses) explains short forms, package qualification, and ambiguity diagnostics.

A link to a note tagged `draft` retains its target and carries a visible draft cue. In a book, the cue reads `(draft)` after the link.

**An address that resolves nowhere is an error on all three surfaces**, worded the same way by each. The pack build refuses the note and produces no pack from it. The site build and the book build write what they can and fail the run: a page marks the link for the reader, and a book sets `(unresolved link)` after its label. The book is written so the page carrying the mistake can be found, not because the mistake is tolerated there.

An HTML comment is an aside to whoever reads the note next, and no surface shows one — the packs and the website emit it into the HTML, where it stays a comment, and a book leaves it out. Write a `markdownlint` pragma or a note about a quoted passage freely. A comment inside a fence or a code span is an example and is printed as written, and a comment that is never closed is an error.

## References to secret subjects

Use an ordinary wikilink for an indexed subject, including a GM-only note:

```markdown
[[doc-divineactn|The Truth of Divine Action]]
```

The renderer reads the destination's audience and conceals the entire reference,
including its label, as a spoiler. Authors do not repeat that audience at each
reference. A reference to a public subject stays visible. A link to an anchor inside secret content
conceals its reference too, including a same-note `[[#anchor|label]]`.
Linking to the public note as a whole does not inherit a section's secrecy.

| Surface | Reference to a secret destination                                                                                                                                      |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Website | An inline show/hide spoiler conceals its label. An omitted GM-only destination produces text without an unusable link. A published secret heading can still be linked. |
| Foundry | A CSS-redacted inline spoiler reveals the reference on hover or keyboard focus. Private pack and page permissions govern whether its destination can be opened.        |
| Book    | The reference prints normally, preserving emphasis and name styling. An omitted GM-only destination produces text without a link.                                      |

`.show` removes automatic spoiler presentation on the website and in Foundry.
Book references already print normally. Where the target is unavailable the
reference still produces text without a link.

To intentionally reveal this reference, add `.show` immediately after the link:

```markdown
[[doc-divineactn|The Truth of Divine Action]]{.show}
[[doc-magictruth|The Truth of Magic]]{.show}
```

`.show` reveals only this reference. It does not publish the destination, change
its audience or grant Foundry access. It is redundant for a public target.
Use `[text]{.secret}` when the text itself is a spoiler, independently of any
destination; see [inline spoilers](#inline-spoilers).

## Marking names in prose

Mark a name with a link or a `.name` span. Link a name that has a note,
including a private subject, and add `.name` to the wikilink so it counts as
the name: `[[place-arden|Arden Vale]]{.name}`. An empty link label uses the
indexed full name. Use `[Name]{.name}` for a name that has no indexed note.
Keep the note's own subject in plain text. Plain text, including capitalized
words, is not searched for names.

Inside a language run, a `.name` child contributes `{` + its text + `}` to the
chosen encoding. Write `[Name]{.name}` in Markdown; the build supplies the
standard name boundaries.

```markdown
[[place-arden|Arden Vale]]{.name} stands beside the river. Arden Vale has two gates.
[Hidden Hand]{.name} keeps watch over the crossing.
```

To name something that has no note yet, mark it with its type instead of
creating a placeholder note:

```markdown
[Ravenmoor]{.name data-type="place/settlement"}
[Aldric Venn]{.name data-type="being/npc"}
```

`data-type` is optional. It names a declared [note type and
subtype](../reference/note-types.md), written as `type` or `type/subType`.
Enumerated subtypes must belong to that type's list; an open declaration
accepts a well-formed note subtype, and a type without a subtype declaration
takes only the bare type. An invalid supplied value is an error at the
attribute. Site and Foundry spans retain the classes and attribute values;
the attribute adds no book presentation.

A `ref` ties each spelling of a person, place or thing to the one note that
describes it, without linking it. The address implies the type, so `data-type`
is only for a name with no note:

```markdown
[Tom Rodriguez]{.name ref=being-tomr} met [Tom]{.name ref=being-tomr} again.
[Tom]{.name ref=sohl-note-being-tomr}
```

The value is a note address: this package's (`being-tomr`) or a declared
dependency's, written with its package prefix (`sohl-note-being-tomr`). A
`ref` is not a link, so the span stays plain text and the page links the note
once, with a wikilink, wherever the author chooses. A `ref` span names the note
however it is spelled, so it draws no warning to link the name, and it shares
the note's key for the [first-use bold](#the-first-use-is-bold).
A `ref` that resolves to no note is an error at its value. `data-type` beside
`ref` is an error at `data-type`, and `ref` on a span without `.name` is an
error at `ref`. A wikilink never takes `ref`, because its address is its ref.
Use `#id` for the HTML anchor only; it is never a ref.

A subject with no note takes a page-local key instead, written with a leading
`#` and quoted when it stands alone as a value:

```markdown
[Jane Doe]{.name ref="#jane"} arrives. [Miss Gorgeous]{.name ref="#jane"} is Jane.
```

The key ties _Jane Doe_ and _Miss Gorgeous_ to one person within the page. It
resolves to no note and is never a finding for that reason. It is the
attribute's value, never the span's `{#id}` anchor.

### The first use is bold

The first use of each name in a page is bold when the page renders, on the
website, in the Foundry journal and in the book, and every later use reads as
plain text. Bold an author writes is the author's choice.

Each use of a name is counted under a key:

- a name wikilink, `[[place-harbor|the harbor]]{.name}`, under its address;
- a `.name` span with a `ref`, under the `ref`, whether an address or a
  page-local `#key`;
- any other `.name` span under its label, ignoring case, and its `lang`, which
  is `en` when the span states none.

Every spelling of one address is one key, so `[[place-arden|the vale]]{.name}`
and `[Vale]{.name ref=place-arden}` are one name. A `ref` is how a full name,
a short name and a nickname become one name:

```markdown
[Jane Doe]{.name ref="#jane"} keeps the ferry to [[place-harbor|the harbor]]{.name}.
[Jane]{.name ref="#jane"} rows it alone, and the river folk call her
[Miss Gorgeous]{.name ref="#jane"}. [Old Tam]{.name} mends the nets at
[[place-harbor|the harbor]]{.name}, and [old tam]{.name} sells them.
```

Here _Jane Doe_, the first _the harbor_ and _Old Tam_ are bold. _Jane_ and
_Miss Gorgeous_ share _Jane Doe_'s key, the second _the harbor_ shares the
first's address, and _old tam_ is _Old Tam_ in another case.

Only body prose counts, in the order it is written: paragraphs, list items,
quotations and footnotes. A name in a heading, a table, a caption, raw HTML,
code or verse, in the sections the build generates from frontmatter, or inside
a run that states `lang`, `font` or `enc` neither takes the bold nor counts, so
the first use in the prose after a heading or table that names someone is
still bold. A wikilink without `.name` is a link, not a name: it takes no bold
and does not count.

A name span can sit inside emphasis:

```markdown
**This is a phrase with [Joe Blow]{.name} in it**
```

The marked name is `Joe Blow`. A name inside authored bold counts as that
name's first use and takes no second bold. Bold itself is never a name: a bold
label such as `**Strength**:` draws no warning, whatever names the index holds.

### What lint reports

`package-build lint` warns when an indexed name or listed form uses a `.name`
span with no `ref`, which a link or a `ref` ties to its note. A `.name` span
with a `data-type` is compared only with notes of that type (and subtype, when
it names one), so a lineage that shares its name with a place note is marked
`[Theinuvael]{.name data-type="affiliation/lineage"}` and draws no warning to
link the place. Names match whatever their case, so `[arden]{.name}` names the
same note as `[Arden]{.name}`.

This is a warning at each occurrence's `file:line:column`; it does not make a
valid package fail. The check reads authored prose outside headings,
tables, infoboxes, code, frontmatter, comments and embeds. See the
[complete name-marking rules](../reference/format-details.md#marking-names-in-prose).

The index records every actual `.name` span in the authored body, including
headings, tables, verse and spans inside links. The `names` SQL relation holds
its visible text, optional type/subtype and source location. Plain prose, bold,
unmarked link labels and generated content add no rows.

Lint also gives one grouped package advisory for names without a matching
indexed full name or listed form, and for conflicting supplied classifications. It
lists every use and starts at the earliest reported span. Untyped uses do not
conflict, and `place` agrees with `place/settlement`; different supplied types
or different supplied subtypes conflict. These advisories do not fail lint.

## Journal pages and anchors

Every H1 starts a JournalEntryPage. A lower-level heading with an explicit anchor starts a page too. Use `{#slug}` to make a stable target:

```markdown
# The Harbor {#harbor}

The harbor faces west.

## Customs House {#customs-house}

Travelers present their papers here. See [[#harbor|the harbor]].
```

A leading caption gives its item a JournalEntryPage of its own in Foundry, and the body after the item resumes on a continuation of the surrounding section. A solitary image with a plain caption can be an image page; other captioned items become text pages. Websites and books keep captioned items in the surrounding flow.

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

A captioned item inside the section is withheld with it: in Foundry the item's own page, and the page that resumes the section after it, are the GM's alone. A `:::secret` block inside the section is legal and renders as it does anywhere else. `.secret` on a heading that opens no page — a lower-level heading with no anchor — covers no page, and is reported at its own line: give that heading an anchor, or raise it to the top level.

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
| Verse div                            | `verse`       | Poem           |
| Any other code fence                 | `code`        | Code           |
| Paragraph, quote block or fenced div | `prose`       | Prose          |

The optional `type` attribute overrides inference and accepts `figure`, `table`, `verse`, `code`, `prose`, and `example`. `type=example` uses **Example 1**, **Example 2**, and so on. It does not allow an unsupported target. A heading, list, thematic break, another caption or end of document after a caption is an error. Caption markers without separating spaces or caption text are errors too.

Identifiers are optional and must be unique within the note. Classes are unrestricted; `.border` uses the shared border style, while other classes can be styled by the medium. On a captioned table or SQL fence, `.full-width` sets the table across the page in a PDF book instead of in one column (`: Regional trade routes {.full-width}`); the other surfaces ignore it. Named attributes use `key=value`, with quoted values for text containing spaces. Use `#id` and `.class` rather than `id=` and `class=`; event-handler attributes are refused.

Each numbered type has its own counter. Websites and Foundry number within a note; books number across their reading order. Unnumbered captions neither display nor consume a number. A picture whose asset declares the `map` role counts as a **Map** when no type is specified, and a reference to it reads **Map 1** on every surface: in the note's own page, in a journal, and from another note's page. The editor preview knows the role when it has the package's content index; without one it numbers the picture a **Figure**.

`{{ref "#trade"}}` displays the numbered label as a link. `form="full"` includes caption text and `form="title"` displays the caption alone. Use title form for an unnumbered caption. Cross-note references can name the note address before the anchor, such as `{{ref "place-harbor#trade"}}`; the displayed number belongs to the target on the surface rendering it. Links inside caption text contribute their visible text to references, so the reference does not contain a nested link.

Foundry gives a captioned item a JournalEntryPage holding the item alone, named for its number or, unnumbered, for the caption's visible text — links and emphasis reduced to the words a reader sees. A solitary image with a plain caption can use an image page; captions with inline markup and other items use text pages. The body after the item resumes on a continuation page carrying the interrupted section's name, level and classes, with its title hidden; nothing is emitted when the next page begins straight after the item. On the website and in the book the item stays in the flow of the surrounding page.

To caption a group or passage, put it inside a generic fenced div and caption that div, with an explicit type where the inferred one does not fit.

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

Use `[Ravenmoor]{.name data-type="place/settlement"}` to mark a name with its
optional declared type; see [marking names](#marking-names-in-prose).

Inline Markdown remains active inside the span. Bracket spans have lower priority than URL links, image links, reference links, footnotes and wikilinks. A bracketed form immediately preceded by `!`, followed by `(` or another `[`, or beginning with `[[` is not a span, even when the link is unresolved. Ordinary links retain their existing syntax. Escape a bracket when it should be literal, or put examples inside a code span or fence. A span identifier addresses that point in the note; it does not start a journal page.

### Inline spoilers

Mark text itself as a spoiler with `.secret`. It can contain inline Markdown or
combine with a typed name for an unwritten subject:

```markdown
The key is [under the **third** stair]{.secret}.
The informant is [Aldric Venn]{.name .secret data-type="being/npc"}.
```

This marks only the enclosed text; it does not declare a target's audience.
For indexed subjects, use the ordinary wikilink and let the destination decide
whether the reference needs a spoiler. `.show` on a wikilink bypasses automatic
reference concealment; an enclosing authored `.secret` still marks its text.

On the website an inline spoiler has a button to show or hide its content.
It stays within the surrounding sentence, and links inside it can be followed
after revealing it. Foundry redacts inline `secret` spans with a solid cover;
hover the span or focus it with the keyboard to reveal its text, links and
images. A visible focus outline and a spoiler cue identify the interaction.
This does not change native Foundry secret-section controls. The book ignores
`.secret` on inline spans and prints their text normally, preserving emphasis,
links, anchors and a name's first-use bold. Secret sections and `:::secret` fences
retain their visible labelled boxes.

Published web HTML contains the spoiler's text. Revealing the spoiler or reading
the page source exposes it; this is presentation, not access control. GM-only
destination notes remain absent from public site and book output.

A `.secret` span does not start a journal page or change surrounding text.
Use a [secret heading](#a-section-players-must-not-read) to withhold a whole
Foundry page or a [secret block](#secret-blocks) for a passage in a labelled
section; those retain their own scope and presentation.

### Alerts

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

### Secret blocks

`:::secret` sets GM material apart. Its optional attributes accept an identifier, classes and named attributes. `title` supplies its heading; without a title the heading is **Secret**:

```markdown
:::secret {#harbor-secret title="For the GM"}
The harbor master is working for the smugglers.
:::
```

Leave a blank line between a blockquote or alert and the closing `:::`. Without it, Markdown treats the fence as part of the quote and leaves the enclosing block unclosed:

```markdown
:::secret {title="For the GM"}
Hidden information.

> [!TIP]
> Advice for the GM.

:::
```

`lint`, `markdown` and `format` refuse malformed block and alert syntax, including unclosed divs and unknown alert types. `format` leaves a malformed file unchanged so you can correct the reported opening line before formatting it.

A secret block can contain alerts and general divs. It cannot contain another secret block. A heading that starts its own journal page cannot split a secret block or general div; use a lower heading without an anchor within the section.

Foundry renders a secret section; the website renders an expandable spoiler, and the book renders a labeled box. An untitled secret takes its normal default title, and a Foundry secret without an id receives an id derived from its body. The presentation does not make published HTML private: deliberately inspecting generated source can reveal its content. Use YAML comments for information that must never be published.

### Verse

A `.verse` div sets a version of a work, whether poetry or prose. `/` ends a
logical line. Source newlines otherwise join with whitespace, so prose can wrap
across source lines. A blank line or `//` ends a stanza (a paragraph); a line
of `--- {.canto}`, preceded by a blank line, ends a canto (a section). The last line before either
boundary needs no `/`. A literal slash in text is written `\/`; slashes inside
Markdown syntax, such as a link destination, remain syntax.

Leading periods at the beginning of a logical line set indentation, one `.` per
level, and are removed from the display. They may follow `/` on the same source
line. Leading spaces do not set indentation. A period beginning a continuation
source line is literal text when the preceding text has no logical line ending.
Periods inside the first inline span can set indentation; periods in later spans
are literal. Tabs inside a verse div are errors. The div body is opaque to Markdown block syntax:
lines beginning `- `, `1. `, `# `, `> ` or four spaces stay verse text.

These two bodies have the same lines and indentation:

```markdown
::: {.verse lang=en}
To be or not to be,/
..that is the question!
:::

::: {.verse lang=en}
To be or not to be,/..that is the question!
:::
```

Verse is upright by default. English text accepts Markdown emphasis; other
languages use their declared [script emphasis](#emphasis-in-a-script). Inline
links, names, language spans and footnotes keep their ordinary meanings.
The optional `form=` records the author's literary form, `lang=` identifies the
language, and `font=` selects a face. `enc=` selects an encoding document. An
optional `#id` addresses the div. `scan=` checks a declared metre.

On a div, a concrete `enc=` draws the original in its script on the left and the same text
in Roman on the right. Write the original once, with no column prefixes. Each
logical line aligns with its counterpart at full weight; indentation and breaks
match. `⟦…⟧` codage draws glyphs on the left and remains codage on the right.
Names, nested language choices and `lang=zxx` gaps retain their scope. A div
with no `enc=`, or with `enc=default`, has one Roman column. The content index's
`runs` relation records the authored original once, in its language and encoding.

#### Metre

`scan=` names a metre declared once in the package, as an entry of a `doc`
note's `data.metres`:

```yaml
data:
  metres:
    - { name: hexameter, beats: 6, kind: accentual }
```

`name` is lowercase letters, digits and `-`, unique in the package. `beats` is
the beats of one line, a whole number above zero. `kind` is `accentual`, the
only kind: a beat falls on a stressed syllable, and the length of a syllable
is not counted.

A verse div that states `scan=` with the declared name, and `lang=` with a
language whose `note` names a language note stating
[`data.sounds.stress`](../reference/format-details.md#a-languages-register-sounds-and-history),
is counted line by line. A line that cannot have the metre's beats is a warning
at that line:

```markdown
::: {.verse form=epic scan=hexameter lang=vyl}
Thiruthriman sorimamen, ul alathas kedis alatha valmazor,
:::
```

> ``this line has 4 beats (5 with secondary beats); the metre `hexameter` has 6``

`scan=` uses the div's one language to count beats. If a verse line contains
a run in another language, the build does not scan that run with the fence
language's stress rules; it reports an error at the line:

> `` `scan=` counts one language’s beats; this verse line contains another language ``

Beats are counted this way:

- **Syllables** are vowel groups. A vowel is a letter whose base is `a`, `e`,
  `i`, `o` or `u`, and a pair the language lists in
  `data.sounds.syllables.vowelPairs` is one syllable.
- **Every word of two or more syllables has one beat**, on its stressed
  syllable. The language's stress rule places it: `two` for a word of two
  syllables, `longer` for a word of three or more, and a vowel carrying the
  rule's `mark` is stressed wherever it sits.
- **A one-syllable noun, verb, adjective, numeral or name has a beat.** A
  one-syllable particle, preposition, conjunction, adverb or pronoun has none.
  The `class` of the lexicon entry decides, so the language's lexicon is read
  through `lang=` as it is for the word check, and a form the language's rules
  derive takes its word's class. A word whose entries differ in class is a
  beat that may be left out.
- **A one-syllable word the lexicon does not hold is a content word** and has a
  beat. The word check reports the word separately.
- **A word of four or more syllables may take a second, lighter beat on its
  first syllable** where the line needs it, unless its stress is already
  there. A line scans when its count can be the metre's, choosing second beats
  as needed; the warning gives the count without them and, in brackets, with
  all of them.
- The caesura is not written.

`scan=` is refused where it cannot mean anything: a name no `data.metres`
declares, a div with no `lang=`, a language without a stress rule. A div with no `scan=` is not counted. Readers see nothing of the
count; the div carries `data-scan` with the metre's name.

To number and caption a poem, put a leading numbered caption before the verse div:

```markdown
:@ A song sung by the harbor watch. {#watch-song}

::: {.verse form=ballad}
The watch has gone to sea,/
The lantern marks the shore.
:::
```

This uses the **Poem** counter, so `{{ref "#watch-song"}}` reads **Poem 1**. Use `:` for a caption without a number.

#### Versions and stanza labels

`work=<key>` names a work within the page. Every div with that key is a version
of the same work. Each stanza opens with its automatically counted label: `1`,
`2`, and so on for a work with no canto break, or `1:1`, `1:2`, `2:1`, and so on
when the div contains cantos. Stanza numbering starts at one in each canto.
The website, Foundry journals and book show the same labels. A paired original
has one label shared by both presentations. A div without `work=` has no label.

Versions must have the same number of cantos and the same number of stanzas in
each canto. Their line counts can differ. A work with only one version is a
finding. Shape disagreements are findings at the opening lines of the versions,
naming the canto and the counts. A canto break at the edge of a div, or beside another
canto break with no intervening stanza, is a finding at the break itself.
Authored `***` inside verse is a finding.

This poem's English version and Sinale original share stanza `1`. The original
is authored once and displays as script beside Roman:

```markdown
::: {.verse form=lay work=asking lang=en}
A child comes up the hill at night/
.and leaves a loaf beneath the birch./
.She does not wait. She does not search/
the dark for us. We stand in sight.
:::

::: {.verse form=lay work=asking lang=sina enc=sinaveldikkoenc}
irtal nysse auldiho nalduho/
.penvai onsa tarnevinu halpi polpeho/
.ahi sennevi onsa ahi syltete onsa/
ehii nalduho setty ehii nelkis yinserseho
:::
```

Prose uses the same div and omits line-ending marks. Source lines join into
paragraphs. Both versions below have stanzas `1` and `2`; the original's paragraphs
also appear beside their Roman text:

```markdown
::: {.verse work=walking lang=en}
He walks the oath road.

I walk the oath road.
:::

::: {.verse work=walking lang=vyl enc=vylsemaronenc}
Lokazor lonak zaron.

Lokamen lonak zaron.
:::
```

See [work shape diagnostics](../diagnostics.md#a-worked-case-versions-of-a-work)
for how findings locate a disagreement.

#### Inline quotations

Quoted verse inside a prose paragraph uses a `.verse` span:

```markdown
The reply is [to be or not to be/..that is the question!//]{.verse} in the telling.
```

A quotation uses `/` for line endings and `//` for stanza endings, with the same
indentation and source-line joining as a div. It takes ordinary span attributes,
including `lang=` and `enc=`. An unencoded quotation draws Roman text with its
line and stanza layout. A concrete encoding draws only its script, continuously
inside the surrounding prose, like any encoded span. Its `/` and `//` reach the
encoder as verse controls, so a script with verse signs draws them. Only divs
have paired script and Roman columns.
Inline verse has no `work=`, `form=`, `scan=`, stanza labels or canto breaks.
Directions, speaker labels, links, names and shared note footnotes work inside it.

#### Footnotes in works and encoded spans

Footnote references are valid after a line or word inside verse. Their definitions
sit below the work, as ordinary note footnotes:

```markdown
::: {.verse work=walking lang=en}
He walks the oath road.[^image]
:::

::: {.verse work=walking lang=vyl enc=vylsemaronenc}
Lokazor lonak[^oath] zaron.
:::

[^image]: The road names the obligation as well as the route.

[^oath]: This word carries the oath image in the original.
```

The English reference renders normally. In the encoded original, the reference
appears only in the Roman column, beside the word it follows. The script column
has no marker. Displaying a line twice adds no duplicate number, definition or
backlink. References never add lines, stanzas or labels and never affect work
shape.

This rule also applies to every encoded span, whether or not it carries
`.verse`. A footnote marker is removed before encoding and restored after the
span's text, outside its script font, as an ordinary reference:

```markdown
The inscription reads [Lokazor lonak[^word] zaron.]{lang=vyl enc=vylsemaronenc}.
The reply is [Lokazor lonak[^reply] zaron./Lokamen lonak zaron.//]{.verse lang=vyl enc=vylsemaronenc}.

[^word]: A note about the inscription's wording.

[^reply]: A note about the reply's wording.
```

Markers never reach an encoder, draw a script glyph or cause an encoding finding.
The website, Foundry journals and book share the note's footnote numbering and
definitions.

#### Canto headings

A canto break stands alone after a blank line, with a stanza on both sides.
Its optional `title` appears as a heading and its optional `#id` is an anchor
within the work, without starting a separate Foundry journal page:

```markdown
::: {.verse lang=en}
The watch crosses the shore.

--- {.canto #choosing title="The Choosing"}
The captain raises the lamp.
:::
```

The heading appears once across an encoded div's presentations. Its title is
heading text, separate from the letters passed to the encoder. A valid break
supplies the encoder's standard Roman `***` canto control. `package-build format`
leaves each complete verse div and quotation byte for byte, including its
delimiters and attributes, while formatting surrounding prose.

#### Directions and speakers

A `.direction` span identifies an instruction or stage direction; `.speaker`
identifies the person speaking. Either can fill a logical line or sit within it.
Each version writes its own directions and speaker names in its own language.
Write ordinary case; these classes do not rewrite the text. The classes are
valid outside verse as well.

```markdown
::: {.verse form=rite work=weighing lang=en}
Let the household enter. Let the creditor enter./
[The reader names the year of the reign, the season, the day, and the dead.]{.direction}/
One person of this household goes down to the West.
:::

::: {.verse form=rite work=weighing lang=khel enc=khelqalezuenc}
galun garqen. galun zeqatar./
[zethul nemar …]{.direction}/
yarul genar lazen elu garqen nizar ez ithnar.
:::

::: {.verse form=roll work=thresholds lang=en}
[The Captain]{.speaker}/
Is the stone here?
:::

::: {.verse form=roll work=thresholds lang=tarv enc=tarvsemaronenc}
[thrumar]{.speaker}/
eza goitsa ared ir denon sedon.
:::
```

Their text is encoded normally. The classes themselves are presentation hooks;
they add no emphasis, encoding controls or stanza boundaries. A direction alone
between blank lines is a stanza like any other. HTML preserves `direction` and
`speaker` classes. Typst preserves those classes through `book-span` and provides
plain `book-direction` and `book-speaker` hooks. The default appearance is plain.

### Scrolls

Some scripts are written in vertical columns, top to bottom, with the columns
read from the right, as on a handscroll. A `scroll` fence sets a passage in one
of these scripts:

````markdown
```scroll {rows=25 cols=12 lang=tsu enc=tsutengchouenc}
chen teng chou hing
tan tsou dou rou

gen chei chou tsuen
```
````

A scroll fence is a real code fence, so Markdown never reformats its body.

- **Paragraphs.** The lines of a paragraph are joined into one text. Where
  the source breaks a line makes no difference to where a column breaks. A
  blank line starts a new paragraph, flush at the top of a fresh column, with
  no indent and no mark between paragraphs. This follows classical practice.
- **`rows=`** is the number of characters in a column, and **`cols=`** the
  number of columns in a panel. Each is a whole number above zero, and either
  may be left out.
- **`lang=`, `font=` and `enc=`** work as they do on a verse div. See
  [marking language, font and encoding](#marking-language-font-and-encoding).
  The text is encoded before layout. Own and composed lexical spellings precede
  rows; a written separator follows the selected definition. An explicit `enc=`
  selects the document's language and font; explicit values must agree.

**On the site, in the preview and in Foundry**, a scroll is a `<div
class="scroll">` with one `<p>` for each paragraph. The stylesheet sets it
with `writing-mode: vertical-rl`. A column is one em wide, with half an em
between columns, so the column pitch is 1.5em.

| Attribute | Stated                                                                      | Left out                                                    |
| --------- | --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `rows=N`  | Each column is N ems tall: `inline-size: calc(var(--scroll-rows) * 1em)`    | Each paragraph is a single column, as long as the paragraph |
| `cols=M`  | The panel is M columns wide: `block-size: calc(var(--scroll-cols) * 1.5em)` | The panel is as wide as its text                            |

The sizes are carried as `data-rows` and `data-cols`, and as the custom
properties `--scroll-rows` and `--scroll-cols` in the element's `style`. A
panel wider than its page, or than `cols` columns, scrolls sideways. It opens
at the right, where the text begins, and unrolls to the left like a
handscroll.

**In the book**, Typst has no vertical writing, so the build draws each panel
as an image from the face's own TrueType outlines. Each panel is an SVG of at
most `rows` × `cols` characters, with its columns read from the right. Its alt
text is the roman text it was written from. Panels follow one another from
right to left and wrap down the page. Emphasis follows the script's convention:
rubric characters are drawn in the book's red, and an overline is a rule to the
right of the column.

| Attribute | Stated                           | Left out                                                                                     |
| --------- | -------------------------------- | -------------------------------------------------------------------------------------------- |
| `rows=N`  | Each column holds N characters   | Each column holds as many characters as the longest paragraph, up to 40                      |
| `cols=M`  | Each panel holds up to M columns | Each column is a panel of its own, so as many columns sit side by side as the measure allows |

In the book, a space that a map leaves in the text takes up a whole cell.

**Errors.** Each of these is an error at its line and column, reported by
`lint`, the site build, the Foundry compile and the book:

| Message                                                                                                                                                                                          | Fix                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `` `rows=0` is not a number of characters: `rows=` is a whole number above zero ``                                                                                                               | Write a whole number above zero, or leave the key out.     |
| `` `cols=two` is not a number of columns: `cols=` is a whole number above zero ``                                                                                                                | Write a whole number above zero, or leave the key out.     |
| `` `width=` is not a scroll attribute; a scroll takes `rows=`, `cols=`, `lang=`, `font=` and `enc=` ``                                                                                           | Remove the key.                                            |
| ``a `scroll` fence sets a script written in columns, and the script of `semaron-kuriale` is written in lines; set it in a face whose script note states `direction: vertical-rl`, or use a div`` | Set the text in a script written in columns, or use a div. |
| `scroll fence is empty`, `scroll fence needs a closing code fence`, `` a scroll fence takes no `#id` ``                                                                                          | Write the text, close the fence, or remove the id.         |

A fence with an error in its opening line is shown as code. A fence whose text
has an error is set exactly as written.

## Standard Roman punctuation

Every configured language's text uses the shared Roman punctuation standard.
The language note's `data.roman` adds its letters, accents, catch and digits;
it does not repeat the shared marks. An uppercase letter is accepted only
where the language's additions include it. Roman display retains the spelling
and case the author typed.

| Mark  | Meaning                                                           |
| ----- | ----------------------------------------------------------------- |
| `.`   | ends a declarative sentence                                       |
| `?`   | ends an interrogative sentence                                    |
| `‼`   | ends an imperative sentence                                       |
| `!`   | ends an exclamative sentence                                      |
| `,`   | pauses within a sentence                                          |
| `«…»` | quotes an outer passage                                           |
| `‹…›` | quotes inside that passage; alternate the pairs at further depths |
| `—`   | interrupts a sentence                                             |
| `…`   | resumes a sentence at its start, or abandons it later             |
| `/`   | separates verse lines when verse is written inline                |
| `^`   | indents at the beginning of a line; repeat for further levels     |
| `{…}` | marks a name in the text handed to an encoding                    |
| `⟦…⟧` | encloses literal codes interpreted by the chosen encoding         |

A terminal is optional: a run without one is accepted as written. Within a
run, an interruption or abandoning ellipsis is immediately followed by a
terminal. At the end of the run it can stand alone. Closing a quotation does
not terminate the surrounding sentence. Quote pairs balance, including across
presentation-only `.emph` children.

Use `,` instead of `;` or `:` for a pause, and `.` between complete sentences.
Use the guillemet pairs instead of English double quotation marks or `<<` and
`>>`; write `…` instead of three periods.

Whitespace is every Unicode space-separator (`Zs`) and U+0009 through U+000D.
A contiguous run of that whitespace is one word separator, written as the
chosen encoding specifies. A source newline joins as whitespace. In verse,
`/` ends a logical line, blank lines or `//` end stanzas, and `--- {.canto}` after a blank line
ends a canto. Visual indentation at a logical line boundary stays layout,
outside the encoded letters. Write `\/` for a literal slash.

Native characters in a language run are written through literal codage:
`⟦U+F0230⟧`, or a name the encoding defines between `⟦` and `⟧`. Directly
pasting a setting-script character is a finding even when the selected font
draws it. Inside the markers, only the encoding's codes and notation apply.
Markdown escapes are resolved before encoding; a refusal still points at the
original character. Write a literal backslash as `\\`.

`!` immediately before `[` is Markdown image syntax. Leave a space, or escape
that `!`, when an exclamative terminal immediately precedes another span.

## Marking language, font and encoding

`enc=` names an encoding document, with `doc` as its default Address type:
`[say.]{enc=aelwsemaronenc}` selects `doc-aelwsemaronenc`. That document supplies
its configured `language` and single `font`; an explicit `lang=` must identify
the same language, and an explicit `font=` must be that font. Another face is
a separate encoding document.

`enc=default` leaves Roman text as written and is the default when no encoding
is selected. `lang=` still identifies the text and selects its language's
vocabulary; `font=mono`, `serif`, `sans` or an installed font selects its face
without encoding it. Language identification does not select an encoding.

```markdown
[say.]{enc=aelwsemaronenc}
[say.]{enc=doc-aelwsemaronenc lang=aelw font=semaron-kuriale}
[say.]{lang=aelw enc=default}
```

Class-only emphasis and name children belong to the parent's complete logical
text; encoding preserves their rendered wrappers. A child with its own run
keys makes a separate presentation choice. `enc=default` inside an encoded
parent keeps the inherited language but does not inherit its inferred script
face. An explicitly authored font remains a font choice.

A name's braces use the shared name controls. Resolved references encode only
their visible labels, retaining URLs and presentation cues. These keys apply
to spans, divs and scroll fences. A scroll's selected font must
belong to a script whose note declares `direction: vertical-rl`.

### A language's script

The encoding document states the language and font for one written form.

### What `lang=` takes

`lang=` is read in this order:

1. **A name declared in [`languages`](../configuration.md#languages).**
   `lang=vyl` is Vylari, tagged with the configured `art-x-vyl`.
2. **Otherwise, a BCP 47 language tag** for a real language: `la`, `grc`,
   `en-GB`. The tag is checked for its form alone, by the rules of RFC 5646
   that need no registry; whether each subtag is registered is not checked.

A declared name wins over a tag spelled the same way. A value that is neither is
an error. Because a tag is checked only for its form, a misspelled name that is
still a well-formed tag, such as `vly` for `vyl`, is read as the tag of a real
language. When such a value is within one edit of a declared name (a letter
added, dropped or changed, two neighbours swapped, or a different case), `lint`
warns and names the declared language. A configured language with a `note`
checks its words whether the run stays Roman or opts into native presentation;
see [a mapped run's words](#an-encoded-runs-words).

### What `font=` takes

`font=` is one of:

- **a face of the `@heroiclands/fonts` package this package installs**, named
  by its class without `hl-`: the face whose class is `hl-semaron-kuriale` is
  `font=semaron-kuriale`. package-build does not depend on the fonts package;
  a package that sets text in a face adds it to its own `devDependencies`:

  ```bash
  npm install --save-dev @heroiclands/fonts
  ```

- **`mono`, `serif` or `sans`**, the generic families. On the site `serif` and
  `mono` are the site's own body and code faces and `sans` is the reader's
  sans-serif; in Foundry they are the reader's generic families; in a book
  they are the book's own serif, sans and mono, as `pdf.fonts` names them.

**A face draws only the code points its `fonts.json` lists**, and whitespace.
After the map, every other character in text set in a face is an error at the
character it came from, so a box never reaches a reader. The generic families
are not checked.

### What `enc=` takes

An encoding is a `doc` note. Its `data.language` is a configured language
alias, `data.font` is one installed font slug, and `data.mappings` maps Roman
strings to a font glyph code or a sequence of codes. `data.rules` holds the
closed executable rules. Optional `data.accepts` states accepted characters
or ranges and `data.vowels` states contextual vowels. The note body explains
the spelling to a reader.

The font supplies each glyph's `code` beside its `codepoint` in `fonts.json`.
Codes belong to the selected font; the note never repeats a code table.
Unknown fields, glyph codes, languages and fonts are positioned findings.
An encoding's output must decode unambiguously, including across adjacent
mappings and spaces. The compiler refuses indistinguishable spellings rather
than choosing a guessed reading. See [the executable rules](../encoding-core.md).

Mappings match longest first; contextual before-vowel rules precede their
unconditional alternatives. A case rule may allow lowercase and initial-capital
groups while refusing other mixed or uppercase group spellings. Encoding keeps
authored case and never rewrites a word's Roman spelling.

Outside literal markers, a run of Unicode Zs characters or U+0009 through
U+000D writes one space. Other whitespace needs an explicit mapping. Standard
Roman punctuation, verse and name controls are inherited from the shared
standard; an explicit mapping can give a standard source its font glyph.

#### Literal codes

Inside an encoded run, `⟦…⟧` writes the selected font's glyph codes or exact
Unicode scalars: `[⟦MAN⟧]{enc=khelzethuenc}` where `MAN` is defined, and
`[⟦U+00E1⟧]{enc=vylsemaronenc}` for an exact character. A Unicode code takes four to
six uppercase hexadecimal digits, U+0000 through U+10FFFF excluding
surrogates. Codes come only from the font; Unicode database
names are not inferred. Whitespace between codes writes nothing. Nested or
unmatched markers, unknown codes and standard marks absent from the font
code table are errors. Without an encoding, a literal marker is a finding.

Each outer marker writes its own invisible control. Payload occurrences of
those controls or the literal escape are quoted with U+E0115. Decoding
unquotes the payload before reading code rows and uses `U+XXXX` for scalars
with no code name. Variation selectors U+E0100 through U+E01EF are valid
encoded characters and carry distinctions the visible font does not draw.

### The lexicon under an encoding

Every encoding uses the same order for a language word: its own `native`
entry for that encoding and face; otherwise the writings of all its parts;
otherwise the encoding's rows. A face-specific entry precedes an entry for no
face. Exact lexical forms precede folded lookup, so separately authored
capitalized spellings keep their own native text. A flat variant is a lexical
form; it does not assign a grammatical role by itself.

```yaml
words:
  - form: halzi
    class: n
    gloss: heart
    field: Words
    native:
      - { enc: zethu, text: "\U0001EABB" }
  - form: halzunet
    class: n
    gloss: the account
    field: Words
    built: [halzi, -unet]
affixes:
  - form: -unet
    gloss: a thing made of
    native:
      - { enc: zethu, text: "\U0001EBC7" }
```

A built part is an exact word or affix, then the same form with joining
hyphens removed. Parts can themselves be built. A plural or present form can
use the stem's writing followed by its explicitly named ending from
`grammar.native`, whose entries use `{ending, enc, font?, text}`. These
writings work under every encoding. Missing parts do not invent signs, and
recursive parts terminate without a writing. Entries with genuinely different
writings remain an ambiguity naming every matching gloss.

An encoding accepting no letters, such as `zethu` or `chalish-pilam`, needs a
lexical writing or literal codes for a word. The refusal names the word,
language and encoding and points to that word.

`package-build lexicon vyl --enc vylsemaronenc` lists lexical spellings.
`package-build encode --enc vylsemaronenc "zaron"` converts through the bare
encoding; the browser API also reads language vocabulary.
See [the command reference](../commands.md#package-build-encode-text).

### An encoded run's words

**Every word of a run with `lang=` is a word of its language**, where
the language's [`note`](../configuration.md#languages) names its language note.
Each word, case folded, is one of:

1. **a lexicon word**: a `data.words[].form` of the language, or one of its
   `variants`, which takes every rule below as its word does;
2. **a word of a registered name**: a word of a `name` in the language note's
   own `data.register`, under any `tongue` but `translation`. A name of several
   words is checked word by word, so `Revothar Baremzator` admits `Revothar`
   and `Baremzator`. A foreign name the run uses is listed in the language's
   own register first, as `other:<tongue>` (`{ name: Epistémion, tongue:
"other:helonic" }` in Vylari's), and that row is checked against the Helonic
   register in turn; see
   [a language's register](../reference/format-details.md#a-languages-register-sounds-and-history);
3. **a regular form of a lexicon word**, made by one rule the language states:
   - the plural `data.grammar.plural` gives a noun, or the noun's own `plural`;
   - a verb's form with one ending of `data.grammar.verbs.persons`, which
     takes the place of a closing `data.grammar.verbs.replaces` where the
     pattern states one, so `lokathen` with `replaces: then` gives `lokazor`;
   - a suffix of `data.affixes` that states `replaces`, or its `front` form.
     `replaces: vowel` takes the place of a closing vowel (a letter whose base
     is `a`, `e`, `i`, `o` or `u`), letters such as `replaces: a` take the
     place of those letters, and a stem that closes otherwise takes the suffix
     whole. An affix that states no `replaces` makes no form here, whatever its
     `attaches` says, because `attaches` is prose. A suffix stating
     `attachesTo: [n, adj]` attaches only to words of those classes, and one
     stating no `attachesTo` attaches to a word of every class;
   - an agreeing form, where the language states `data.grammar.agreement`: a
     word of one of its `classes` closing on one of its `endings` takes each
     other ending in its place, and each form takes the `plural` rule;
   - a participle, where the language states `data.grammar.participles`: a
     verb closing on one of its `root` endings drops it, and each suffix it
     names attaches to the root, agreeing where it closes on an agreement
     ending.

**Agreement and participles, worked through in Vylari.** Vylari's adjectives
and pronouns agree with their noun by its endings, and its participles are
suffixes on the verb root. Its note states both beside its plural rule:

```yaml
affixes:
  - form: "-andar"
    gloss: "doing it: the present participle"
    replaces: vowel
  - form: "-thos"
    gloss: "done, suffered: the past participle"
grammar:
  plural:
    - { ending: os, becomes: oi }
    - { ending: on, becomes: oi }
    - { ending: a, becomes: ai }
  agreement:
    classes: [adj, pron]
    endings: [os, a, on]
  participles:
    root: [athen, ethen]
    affixes: ["-andar", "-thos"]
```

With those, a run accepts:

| Lexicon word      | Rule        | Forms accepted                                    |
| ----------------- | ----------- | ------------------------------------------------- |
| _alathos_, pron.  | agreement   | _alatha_, _alathon_, _alathoi_, _alathai_         |
| _dokathen_, v.    | participles | _dokandar_ (_dok-_ + _-andar_), _dokthos_         |
| _dokathen_, v.    | both        | _doktha_, _dokthon_, _dokthoi_, _dokthai_         |
| _marendos_, n. m. | neither     | _marendoi_ by the plural rule alone; no _marenda_ |
| _solkatora_, v.   | participles | none: the verb closes on no `root` ending         |

_-andar_ closes on no agreement ending, so _dokandar_ does not agree. A
near miss such as _alathe_ or _dokendar_ is still an unknown word.
`package-build lexicon vyl --enc vylsemaronenc --derived` lists every form the rules
give, each beside the word it comes from, so a puzzling finding can be checked
against what the rules produce.

A compound that is not a word whole is split at its hyphens and en dashes, and
each part is checked, so `zaron-lonak` passes when `zaron` and `lonak` do. An
apostrophe joins a word: `k'aralzon` is one word, and `’` reads as `'`. A word
with no letter, such as a numeral, is not checked.

Any other word is an error at its first character, reported once per run and
naming the language as `lang=` writes it:

> `` `thiruthrimar` is not a word of the `vyl` lexicon, a registered name, or a regular form of one; coin it in the lexicon (or register the name) first ``

The check recognises a form and never requires one: a noun stated with its own
plural and the plural the rule gives both pass, and nothing checks that a word
takes the right ending.

**To coin a word**, add it to the language note's `data.words` with its class,
field and gloss:

```yaml
words:
  - form: thiruthrimar
    class: n
    field: "Law, the court and the written act"
    gloss: a sworn witness
```

**To register a name**, add a row to the `data.register` of the language it is
in, with its tongue:

```yaml
register:
  - { name: Revothar Baremzator, tongue: vylari }
```

A bare BCP 47 tag and a declared language with no `note` are not
checked.

### Native spellings and parts

Every encoding uses the same order for a language word: its own `native`
entry for that encoding and face; otherwise the writings of all its parts;
otherwise the encoding's rows. A face-specific entry precedes an entry for no
face. Exact lexical forms precede folded lookup, so separately authored
capitalized spellings keep their own native text. A flat variant is a lexical
form; it does not assign a grammatical role by itself.

```yaml
words:
  - form: halzi
    class: n
    gloss: heart
    field: Words
    native:
      - { enc: zethu, text: "\U0001EABB" }
  - form: halzunet
    class: n
    gloss: the account
    field: Words
    built: [halzi, -unet]
affixes:
  - form: -unet
    gloss: a thing made of
    native:
      - { enc: zethu, text: "\U0001EBC7" }
```

A built part is an exact word or affix, then the same form with joining
hyphens removed. Parts can themselves be built. A plural or present form can
use the stem's writing followed by its explicitly named ending from
`grammar.native`, whose entries use `{ending, enc, font?, text}`. These
writings work under every encoding. Missing parts do not invent signs, and
recursive parts terminate without a writing. Entries with genuinely different
writings remain an ambiguity naming every matching gloss.

An encoding accepting no letters, such as `zethu` or `chalish-pilam`, needs a
lexical writing or literal codes for a word. The refusal names the word,
language and encoding and points to that word.

#### Reading script text

Without a language, decoding is exactly the encoding's longest-output match.
With a language, explicit native and composed writings are tried first,
longest first; a shared writing uses the first listed sense. Literal marker
spans decode through their inline codes. Unknown unmarked signs in a script
accepting no letters become `⟦codes⟧` with a finding.

For an unmarked word, the lexicon can recover its unwritten sounds from the
plain decoded skeleton. A unique skeleton gives its form; a shared skeleton
gives the first authored form. Each word's citation precedes its variants and derived forms, before the next word's citation. Registered names retain their authored order. Complete names are matched longest first across word separators and receive one pair of braces. A known ordinary word keeps its encoded case without a false unknown-word finding. An unknown skeleton keeps the
plain decoding and produces a located finding. This is decided per word: a
passage can mix typed words with encoded words. A word carrying any invisible
mark keeps exact decoding without skeleton recovery; an explicit authored
native exception still has precedence. Stress marks are preserved by exact
rows. Names are represented with braces according to the language's rules.

### Emphasis in a script

Mark a stressed word inside a language run with `[word]{.emph}`:

```markdown
[the milk cow is all [dried up]{.emph}]{lang=aelw}
```

The inner span inherits the language and presentation of the surrounding text.
In a native run its letters are encoded by the same rules. Emphasis changes
presentation, while the script's characters stay the same.

In English, `[word]{.emph}` equals `*word*`, and `[word]{.strong}` equals
`**word**`. A non-English span accepts `.emph` only: Markdown stars and
underscores, and `.strong`, are findings. A span takes one emphasis class.
The build sets accepted emphasis by the language's or script's convention:

| Convention | On the site and in Foundry                         | In the book           |
| ---------- | -------------------------------------------------- | --------------------- |
| `rubric`   | `<em class="emph-rubric">`, in red                 | in the book's red ink |
| `overline` | `<em class="emph-overline">`, with a line above it | under an overline     |
| none       | `<em>` with no class, in the face's Regular        | in the face's Regular |

`**…**` gives a `<strong>` in the same way. The element stays an `<em>` or a
`<strong>`, so a screen reader and a copied passage keep the emphasis.

**The convention is the language's, else the script's.** A run's `lang=`
language, through the note its [`languages.<name>.note`](../configuration.md#languages)
names, may state `data.emphasis`; otherwise the script note listing the run's
face states it in `data.script`; otherwise there is none. A script note:

```yaml
---
shortcode: semaronscrpt
name: { full: Semaron Script }
type: skill
subType: script
data:
  script:
    fonts: [semaron-kuriale]
    emphasis: rubric
---
```

A tongue that states nothing takes its script's convention. `.emph` uses that
convention in a non-English span, including when the language is inherited.

**A language may mark emphasis with a word** instead of a mark:
`data.emphasis: words` on its language note. Emphasis in a run of that language
is an error, including `.emph`. A language may instead state `rubric` or
`overline`, which `.emph` takes in every script it is written in.

`_…_` is emphasis equal to `*…*`, and `__…__` equal to `**…**`, so a note keeps
its meaning when a formatter rewrites one pair to the other. A strikethrough is
an error in a face; an escaped `\*`, or a star that pairs with none, is a character the map and the
face are checked for. A stressed word is best enclosed whole: a star inside a
word splits it, so a map's row or a lexicon word that crosses the star is not
matched.

### Errors

Each of these is an error at its line and column, reported by `lint`, the site
build, the Foundry compile and the book, except the last row, which is a warning
that `lint` reports and that fails nothing:

| Message                                                                                                                                                   | Fix                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `` `q` is not a declared language (`languages` in package-build.config.yaml) or a BCP 47 tag ``                                                           | Declare the name, or write a real language's tag. A near name is suggested.                                               |
| `` `semaron-kurial` is not a font: `font=` names an installed face, or `mono`, `serif` or `sans`; did you mean `semaron-kuriale`? ``                      | Write an installed face or a generic family.                                                                              |
| `` `semaron-kuriale` is not a font: `font=` names `mono`, `serif` or `sans`, or a face of @heroiclands/fonts, which this package has not installed ``     | Install `@heroiclands/fonts`.                                                                                             |
| `` `semron` is not an encoding document ``                                                                                                                | Write the name an installed encoding declares.                                                                            |
| `` `ch` encodes to U+F0299 in `semaron`, which the font `semaron-kuriale` does not draw ``                                                                | Select a compatible face or correct the encoding row.                                                                     |
| `` `zaron` is written U+F0299 by the lexicon of `vyl` for the encoding `semaron`, which the font `semaron-kuriale` does not draw ``                       | Correct the word's `native` text.                                                                                         |
| ``The encoding cannot capitalize the native writing of `orlan`; author `Orlan` with its own native entry``                                                | Record the capitalized word with its own native writing.                                                                  |
| `` `thiruthrimar` is not a word of the `vyl` lexicon, a registered name, or a regular form of one; coin it in the lexicon (or register the name) first `` | Coin the word in the language note's `data.words`, register the name in its own `data.register`, or correct the spelling. |
| `` `thuravark-carved` is not a font of encoding `semaron`; it is for `semaron-kuriale` ``                                                                 | Set the run in a face the encoding lists, or list the face in the encoding definition's `fonts`.                          |
| ``a span in non-English language `vyl` holds no bold or italic markup``                                                                                   | Remove the markup, or escape its delimiter characters.                                                                    |
| `` `vyl` marks emphasis with a word, not a mark; write the word ``                                                                                        | Remove the emphasis marks and write the word the language stresses with.                                                  |
| ``a div marked `lang=vyl font=semaron-kuriale enc=vylsemaronenc` holds paragraphs and line breaks only, not a list``                                      | Move the list out of the div.                                                                                             |
| `` `font=` is read on a span, a div or a verse div, not on a secret block ``                                                                              | Put a marked div inside the secret block.                                                                                 |
| `` `vly` is read as a BCP 47 tag; did you mean the declared language `vyl`? `` (a warning)                                                                | Write the declared name, or ignore it when the tag is meant.                                                              |

A character the face does not draw is reported once per run, at its first
place; through a map it is located at the start of the matched `from`.

### Finding marked text

Every marked span, div and fence is a row of the `runs` relation, so a table can
list them:

````markdown
```sql
SELECT owner, kind, tag, font, line FROM runs WHERE lang = 'vyl' ORDER BY owner, line
```
````

Its columns are `owner`, `kind` (`span`, `block`, `verse` or `scroll`), `lang` as written,
the `tag` it resolves to (`NULL` when it resolves to none), `font`, `map`, `line`
and `column`. A run inside a div or a fence records the keys it inherits. See
[the `runs` relation](../reference/format-details.md#content-tables).

### Tying words to the core vocabulary

A setting can name the concepts every language of it has a word for, and measure
each language against them without reading a gloss. Three things state it:

1. **A concept list** in the `data.concepts` of a `doc` note: each concept has
   an `id` (lowercase letters, digits and `-`, unique in the package), a short
   `gloss` and a `group` the report lists it under.
2. **`core: true`** in the `data` of each language note that must cover the list.
3. **`concept`** on each word that serves a concept: one id, or a list of ids
   for a word that serves several.

```yaml
# Docs/Core_Concepts.md
type: doc
subType: reference
data:
  concepts:
    - { id: see-verb, gloss: to see, group: senses }
    - { id: smell-noun, gloss: "a smell; a scent", group: senses }
    - { id: knee, gloss: the knee, group: body }

# Skills/Vylari.md
type: skill
subType: language
data:
  core: true
  words:
    - { form: veda, class: n, field: Senses, gloss: a sight, concept: see-verb }
```

A `concept` that names no entry of the list is an error at the id, with the
nearest id offered: `` `smel-noun` is not a core concept; did you mean
`smell-noun`? ``. A language reads the words of its `data.family` chain as its
own, so a parent's tagged word covers the daughter's concept.

`package-build core` lists, for each language that states `core: true`, the
concepts it has no word for, by group with counts. A missing concept is never an
error: the report is the work list, and `--language <name> --json` serves an
agent working through one language. See
[the command reference](../commands.md#package-build-core).

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

To continue the same definition, leave a blank line and indent the next
paragraph or block by four spaces. For a fenced code block, indent both fences
and its contents:

````markdown
Harbour due
: A toll on every hull that ties up.

    The harbourmaster collects it before unloading begins.

    ```text
    One hull: two silver pieces.
    ```

Anchorage
: A sheltered place where a ship can lie at anchor.
````

The continuation paragraph and code block belong to the same definition.
Repeat `:` only when starting a separate definition for the same term, as in
the first example. The next unindented term starts a new entry.

Definition lists use a dictionary hanging indent in the website, Foundry,
preview and book. A bold term begins the row, followed by its normally styled
definition. Short terms share a definition column 150px from the row's left
edge; browser viewports of 600px or less use 100px. The gap after a term is
`.75em`, with `.5em` between entries. A long term stays on one line and pushes
the first definition farther right; wrapped lines return to the common column.
The book uses the equivalent print dimensions.

HTML surfaces preserve the semantic `<dl class="dictionary">`, `<dt>` and `<dd>`
elements, with one grouping `<div>` for each term and all its definitions.
Multiple definitions, continuation paragraphs, nested lists and footnotes keep
their normal Markdown meaning. Infobox profiles retain their own layout.

## Lists

A list item's text begins right after its marker. `[ ]` and `[x]` there are
plain words, not a checkbox — write what is done into the item itself:

```markdown
- the harbor toll: paid
- the ferry crossing: owed
```

## Fenced code

A fence that names a language highlight.js knows is highlighted when the page is built, so a Foundry journal and the editor preview show a listing with its keywords, strings and comments coloured. The colours follow the light or dark scheme the page is in. A fence with no language, or a language highlight.js does not know, is shown as plain text.

````markdown
```js
const lantern = "lit"; // the harbor light
```
````

A fence named `sql` or `pagelist` is a query. Verse uses a `.verse` div or quotation.

## SQL generated tables

A fence marked `sql` is replaced by a table built from the content index. The query reads the frontmatter of every indexed note, so a table is written once and stays true as notes are added.

````markdown
```sql
SELECT name.full AS "Name" FROM notes WHERE type = 'lore' ORDER BY name.full
```
````

A column's heading is its SQL alias, so `AS "Name"` is what a reader sees. A cell that is absent prints an em dash. A `|` or a line break inside a value is escaped, so neither breaks the table.

### What a query can read

| Relation           | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notes`            | Every note except a stub. This is the one to use unless a stub is wanted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `entries`          | Every note, stubs included.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `events`           | One row per event a `lore`, `place` or `affiliation` note writes in `data.events`, with `whenSort` to order them by date.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `names`            | Each authored `.name` span, with its containing NOTE Address, visible text, optional type/subtype and source line/column.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `runs`             | Each span, div and verse div marked with `lang=`, `font=` or `enc=`, with its containing NOTE Address, its `kind`, `lang` as written, the `tag` it resolves to, the `font` and `enc` it is set with (its own, inherited, or its language's [script](#a-languages-script)), and source line/column. See [marking language, font and encoding](#marking-language-font-and-encoding).                                                                                                                                                                                                                                                     |
| `natives`          | One row per native form a language note's word states in `native`, with that note as its `language`, the word's place as `word`, its `form`, the entry's place as `native`, and its `enc`, `font` and `"text"`. See [what `enc=` takes](#what-enc-takes).                                                                                                                                                                                                                                                                                                                                                                              |
| `words`            | One row per word a language note writes in `data.words`, with that note as its `language`, its `position` and what it is built from.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `affixes`          | One row per affix a language note writes in `data.affixes`, with that note as its `language`, its `position`, and each key the affix states: `form` (`NULL` on a zero affix), `zero`, `kind`, `given`, `"where"`, `gloss`, `attaches`, `replaces`, `attachesTo`, `lengthens`, `front`, `examples`, `barredAfter` and `tones`, then `written`, the form as a table prints it, `∅` for a zero affix.                                                                                                                                                                                                                                     |
| `fields`           | One row per field a language note writes in `data.fields`, with that note as its `language`, its `position`, and the field's `name` and what it `holds`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `glossary`         | One row per entry a culture or an affiliation writes in `data.glossary`, with the `note` it belongs to and the `language` it resolves to.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `language_lineage` | One row per language note and each language it inherits words from through `data.family`, itself included at `depth` 0. Join it to `words` for a language's words with inherited ones.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `dictionary`       | One row per word per language it is listed under, inherited words included, with its `depth`. See [dictionaries and glossaries](#dictionaries-and-glossaries).                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `terms`            | One row per glossary entry, rank or office per note that owns it, with its `cultures` associations. See [dictionaries and glossaries](#dictionaries-and-glossaries).                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `register`         | One row per name a language note writes in `data.register`, with its `tongue`, `kind`, `gloss` and `why`, its pieces as `built_text`, and the `notes` carrying the name, derived from the index.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `tongues`          | One row per tag a language note writes in `data.tongues`: `tag`, `meaning` and `tongue_language`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `retired`          | One row per form a language note writes in `data.retired`: `form`, `instead` as a list, and `why`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `scope`            | One row per value of a language note's `data.scope`: the `kind` it is under and the `value`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `letters`          | One row per entry of a language note's or a spelling guide's `data.sounds.letters`: `letters` as a list, `kind`, `like`, `place`, `ipa` and `tongue`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `edges`            | One row per entry of a language note's `data.sounds.edges`: the `edge` and its `sounds` as a list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `clusters`         | One row per language note stating `data.sounds.clusters`, with its `max`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `cluster_groups`   | One row per group of a language note's `data.sounds.clusters.groups`: `what`, `clusters` as a list, and `use`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `stress`           | One row per language note stating `data.sounds.stress`, with its `two`, `longer` and `mark` (`NULL` where unstated).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `finals`           | One row per entry of a language note's `data.sounds.finals`: `final`, `like` and `ipa`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `syllables`        | One row per language note stating `data.sounds.syllables`: each rule a column, the harmony as `harmony_back`, `harmony_front`, `harmony_neutral`, `harmony_neutralAs` and `harmony_partners`, a list of `{ vowel, partner }`.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `joining`          | One row per entry of a language note's `data.sounds.joining`: `first`, `second`, `written` and `example`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `joins`            | One row per entry of a language note's `data.sounds.joins`: `meeting`, `rule`, `letters` and `"where"`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `marks`            | One row per entry of a language note's or a spelling guide's `data.sounds.marks`: `mark`, `letters`, `kind` and `"limit"`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `skeleton`         | One row per entry of a language note's `data.sounds.skeleton`: `second`, `third` and `between`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `frames`           | One row per frame of a language note's `data.sounds.frames`: `frame`, `shape`, `class`, `makes` and `examples` as `{ root, form }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `read_past`        | One row per entry of a language note's `data.sounds.readPast`: `written`, `readAs` and `what`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `mutations`        | One row per entry of a language note's `data.sounds.mutations`: `mutation`, `sound`, `becomes` and `example`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `sound_changes`    | One row per step of each set in a language note's `data.soundChanges`: the set's `position`, `name`, `from_language`, `to_language` and `takes`, then `step_position`, `step`, `change` and `"where"`.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `elements`         | One row per element of a language note's `data.elements`: `form`, `variants`, `element_position`, `kind`, `sense`, `examples`, `word` and `joining`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `roots`            | One row per root of a language note's `data.roots`: `root`, `sense` and `field`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `cognates`         | One row per form of each set in a language note's `data.cognates`: the set's `position`, `gloss` and `proto`, the `form_language` and the `form`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `calling_names`    | One row per closing of a language note's `data.callingNames`: `form`, `doubled`, `usual` and the language's `min_syllables`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `older`            | One row per form of a language note's `data.older`: `form`, `gloss` and `layer`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `negation`         | One row per language note stating `data.negation`: its `particle` and `mutation`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `name_shapes`      | One row per entry of a language note's `data.naming.shapes`: `of`, `syllables_min`, `syllables_max`, `per_vowel_min` and `per_vowel_max`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `name_edges`       | One row per entry of a language note's `data.naming.edges`: `edge`, `sounds` as a list, `vowel` and `of`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `name_draws`       | One row per entry of a language note's `data.naming.draws`: `kind` and `elements` as a list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `held_from`        | One row per entry of a language note's `data.naming.heldFrom`: `source`, `takes`, `clip`, and `joining` and `elements` as lists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `near_names`       | One row per worked example of a language note's `data.naming.nearName`: `near`, `given` and the language's `min_syllables`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `market`           | The market scale as three columns — `value`, `name`, `trade` — so a table can print `village` beside the number a note wrote.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `<package>.notes`  | The same relations — `notes`, `entries`, `events`, `names`, `runs`, `maps`, `natives`, `words`, `affixes`, `fields`, `glossary`, `language_lineage`, `dictionary`, `terms`, `register`, `tongues`, `retired`, `scope`, `letters`, `edges`, `clusters`, `stress`, `finals`, `syllables`, `joining`, `joins`, `marks`, `skeleton`, `frames`, `read_past`, `mutations`, `cluster_groups`, `sound_changes`, `elements`, `roots`, `cognates`, `calling_names`, `older`, `negation`, `name_shapes`, `name_edges`, `name_draws`, `held_from` and `near_names` — for each package this one declares a dependency on, in a schema named for it. |

The `natives.enc` SQL column preserves the authored reference. Conversion
inputs resolve native encoding references to canonical Addresses in each
source note's own package.

Nested frontmatter is addressed exactly as a note writes it: `name.full`, `sohl.weight`, `data.born`. Every Address is a string — the full canonical Address, as in `list_contains(data.parents, 'thalorna-note-place-xerathia')` — whichever package published it. Every note carries a computed `state` column of `full`, `draft` or `stub`, and a `nameSort` column holding its `name.sort` or, without one, its `name.full`, to `ORDER BY`. Notes tagged `gm` are absent from the relations on public surfaces.

### Sections the build adds

The build adds sections to the end of a note, after everything you wrote, listing what other notes say about it. Each appears only where it has something to list, under a fixed anchor:

| Section           | Anchor           | Lists                                                                |
| ----------------- | ---------------- | -------------------------------------------------------------------- |
| Within            | `within`         | on a place, the places whose `parents` name it, grouped by kind      |
| Governed by       | `governedby`     | on a place, the affiliation its `government` names                   |
| Governed places   | `governedplaces` | on an affiliation, the places naming it as their `government`        |
| In song and story | `insongandstory` | the works of literature whose `subjects` name the note or its events |
| From here         | `fromhere`       | on a place with borders or routes, the map drawn from it             |

The event sections below sit among them, and the [format reference](../reference/format-details.md#generated-sections) gives the order. Each entry links to the note it names; a note with no page of its own is named in plain text. Replace a section the way you replace an event view, by writing your own with the same anchor:

```markdown
# Within {#within}

The vale holds three villages, of which only [[place-ford|Ford]] is walled.
```

### Sections the build adds about events

A note's events are listed for you on the notes they concern: a place gets a **Chronology** of what happened there and below it, with every `depth: world` event as context, a being, affiliation or people the **Events** it took part in, an affiliation, place or people the **Accounts** it gives, and a note holding events **What followed** them. Each is a section appended after everything you wrote, with a fixed anchor — `chronology`, `events`, `accounts`, `followed` — and it appears only where it has something to list. Each lists the date first, written in the setting's calendar, followed by what happened; a Chronology adds a **Felt here** column only where some event is felt in the place, and a PDF book prints it across the full page width.

To replace one, write the section yourself with the same anchor. The build then adds nothing for it and leaves yours exactly as written:

````markdown
# Chronology {#chronology}

The fells keep no reckoning before the raising.

```sql
SELECT summary AS "What happened", whenText AS "When"
FROM events
WHERE list_contains("where".locus, 'thalorna-note-place-ironfells')
ORDER BY whenSort
```
````

The [format reference](../reference/format-details.md#event-views) lists what each view selects.

### A century view

A view of what happened in one century is a fence an author writes, on whatever note should carry it. Filter `events` on `whenYear`, leave out events of local reach, and order by `whenSort`:

````markdown
# The Third Century {#third-century}

```sql
SELECT note                                   AS _ref,
       summary                                AS "What happened",
       "when"                                 AS "When",
       array_to_string("where".locus, ', ')   AS "Where"
FROM events
WHERE whenYear BETWEEN 200 AND 299
  AND depth <> 'local'
ORDER BY whenSort, address
```
````

Each row is one event, linked to the note that records it, with its date as the note wrote it and the Addresses of the places it happened at:

| What happened                                      | When | Where                                              |
| -------------------------------------------------- | ---- | -------------------------------------------------- |
| [Ironfells is sacked.](/thalorna/place-ironfells/) | ~280 | thalorna-note-place-ironfells                      |
| [The fords are bridged.](/thalorna/lore-fords/)    | ~291 | thalorna-note-place-east, thalorna-note-place-west |

`depth <> 'local'` also leaves out an event that states no `depth`; write `depth IS DISTINCT FROM 'local'` to keep those. `whenYear` is the year on the canonical axis, which counts a year `0` that written dates skip: a year written after zero keeps its number, and one written before zero sits one higher. So `whenYear BETWEEN -299 AND -200` selects the events written `-300` to `-201`.

To print each place by its name rather than its Address, join `notes` on the place's Address. The `GROUP BY` keeps one row per event when it happened in several places:

````markdown
```sql
SELECT e.note                          AS _ref,
       e.summary                       AS "What happened",
       e."when"                        AS "When",
       string_agg(p.name.full, ', ')   AS "Where"
FROM events e
LEFT JOIN notes p ON list_contains(e."where".locus, p.address.canonical)
WHERE e.whenYear BETWEEN 200 AND 299
  AND e.depth <> 'local'
GROUP BY e.note, e.address, e.summary, e."when", e.whenSort
ORDER BY e.whenSort, e.address
```
````

| What happened                                      | When | Where      |
| -------------------------------------------------- | ---- | ---------- |
| [Ironfells is sacked.](/thalorna/place-ironfells/) | ~280 | Ironfells  |
| [The fords are bridged.](/thalorna/lore-fords/)    | ~291 | East, West |

An event with no `where.locus` keeps its row with an empty **Where** cell.

### A language's affixes and fields

`affixes` and `fields` hold the entries of a language note's `data.affixes` and `data.fields`, so a page can set them as tables. A Suffixes table is a `layout=table` fence over `affixes`; the `tones` key is the tone pattern an affix carries:

````markdown
```sql
SELECT form AS "Suffix", attaches AS "Stem", gloss AS "Makes", array_to_string(examples, ', ') AS "Example", tones AS "Tones"
FROM affixes
WHERE language = 'thalorna-note-skill-ekpelulng' AND form LIKE '-%'
ORDER BY position
```
````

| Suffix | Stem  | Makes                                        | Example | Tones |
| ------ | ----- | -------------------------------------------- | ------- | ----- |
| -ndo   | added | the keeper of it: one who tends and holds it | luwando | L     |
| -ma    | added | the child of it: one who is fed by it        | yesoma  | H     |

`ORDER BY position` keeps the order the note states them in. The same shape serves `fields`, with `name` and `holds`.

An affix's `kind` picks one table out of the list. A table of case suffixes in a language with vowel harmony sets the back form beside its `front` form:

````markdown
```sql
SELECT gloss AS "Case", '_' || form || '_' AS "Back", '_' || coalesce(front, form) || '_' AS "Front",
       array_to_string(list_transform(examples, x -> '_' || x || '_'), ', ') AS "Example"
FROM affixes
WHERE language = 'thalorna-note-skill-sinalelng' AND kind = 'case'
ORDER BY position
```
````

A given name's endings say who each is `given` to, and an affix written two ways keeps each form on its own row, the conditioned one saying `"where"` it stands; `string_agg` sets the two back on one line:

````markdown
```sql
SELECT given AS "Given to", string_agg('`' || form || '`', ', ' ORDER BY position) AS "Ending"
FROM affixes
WHERE language = 'thalorna-note-skill-nordmalng' AND kind = 'name'
GROUP BY given ORDER BY min(position)
```

```sql
SELECT gloss AS "Prefix",
       coalesce(max('`' || form || '`') FILTER (WHERE "where" = 'before a stop'), max('`' || form || '`')) AS "Before a stop",
       max('`' || form || '`') FILTER (WHERE "where" IS NULL) AS "Otherwise", kind AS "Kind"
FROM affixes
WHERE language = 'thalorna-note-skill-khazarlng' AND kind IN ('aspect', 'voice')
GROUP BY gloss, kind ORDER BY min(position)
```
````

### A language's register, sounds and history

A language note states its register, tongues, the forms it does not write, scope, letters, sound rules, mutations, sound changes, name elements, roots, cognates, the forms older than its rules and its negation in frontmatter, and each is a relation, so the page sets every table back with a fence. Each row carries the note as its `language`, and a list's entries their `position`, so `WHERE language = '…' ORDER BY position` keeps the order the note states. A list column, such as `sounds` or `instead`, prints its entries joined by commas; `array_to_string` and `list_transform` set them otherwise.

The tags the register uses:

````markdown
```sql
SELECT '`' || tag || '`' AS "Tongue", meaning AS "Meaning"
FROM tongues WHERE language = 'thalorna-note-skill-dunharlng' ORDER BY position
```
````

| Tongue    | Meaning                                                               |
| --------- | --------------------------------------------------------------------- |
| `dunhari` | a Dunhari name                                                        |
| `sovidur` | a Sovidur name, carried by a Khazryn wanderer living among the tribes |

The register, each name with the notes in the language's scope that carry it, each linked under the name itself. `notes` is derived, so a name no note carries prints `—`:

````markdown
```sql
SELECT '**' || name || '**' AS "Name",
       coalesce(array_to_string(list_transform(notes, n -> '[[' || n || '|' || name || ']]'), ', '), '—') AS "Notes",
       '`' || tongue || '`' AS "Tongue", coalesce(built_text, '—') AS "Built from"
FROM register WHERE language = 'thalorna-note-skill-dunharlng' ORDER BY position
```
````

The forms the setting does not write, a form with several replacements joined:

````markdown
```sql
SELECT '`' || form || '`' AS "Form",
       coalesce(array_to_string(list_transform(instead, x -> '`' || x || '`'), ', '), '—') AS "Written instead",
       why AS "Why"
FROM retired WHERE language = 'thalorna-note-skill-dunharlng' ORDER BY position
```
````

The scope, one row per kind:

````markdown
```sql
SELECT kind AS "Kind", string_agg('`' || value || '`', ' ') AS "Value"
FROM scope WHERE language = 'thalorna-note-skill-dunharlng' GROUP BY kind ORDER BY kind
```
````

The letters, the word edges and the cluster limit. `like` is an SQL keyword, so it is named in double quotes:

````markdown
```sql
SELECT array_to_string(list_transform(letters, x -> '`' || x || '`'), ', ') AS "Letter",
       kind AS "Kind", "like" AS "Sounds like"
FROM letters WHERE language = 'thalorna-note-skill-dunharlng' ORDER BY position
```

```sql
SELECT edge AS "Edge", coalesce(nullif(array_to_string(list_transform(sounds, x -> '`' || x || '`'), ', '), ''), '—') AS "Sounds"
FROM edges WHERE language = 'thalorna-note-skill-dunharlng' ORDER BY position
```

```sql
SELECT 'Most consonants together inside a word' AS "Rule", max AS "Count"
FROM clusters WHERE language = 'thalorna-note-skill-dunharlng'
```
````

A letter that states its `place` sets a grid of consonants back by manner and place, one `kind` to a row:

````markdown
```sql
SELECT '**' || kind || '**' AS " ",
       coalesce(string_agg(array_to_string(list_transform(letters, x -> '_' || x || '_'), ', '), ', ') FILTER (WHERE place = 'lips'), '') AS "lips",
       coalesce(string_agg(array_to_string(list_transform(letters, x -> '_' || x || '_'), ', '), ', ') FILTER (WHERE place = 'tongue-tip'), '') AS "tongue-tip",
       coalesce(string_agg(array_to_string(list_transform(letters, x -> '_' || x || '_'), ', '), ', ') FILTER (WHERE place = 'back'), '') AS "back"
FROM letters WHERE language = 'thalorna-note-skill-sinalelng' AND place IS NOT NULL
GROUP BY kind ORDER BY min(position)
```
````

The groups of clusters that stand inside a word, and the diphthongs by harmony set. A diphthong is a `vowelPairs` entry, and the set it belongs to is the harmony list holding it:

````markdown
```sql
SELECT what AS "Kind", array_to_string(list_transform(clusters, x -> '_' || x || '_'), ', ') AS "Clusters", use AS "Use"
FROM cluster_groups WHERE language = 'thalorna-note-skill-sinalelng' ORDER BY position
```

```sql
SELECT 'back' AS "Set", array_to_string(list_transform(list_filter(vowelPairs, p -> list_contains(harmony_back, p)), x -> '_' || x || '_'), ', ') AS "Diphthongs"
FROM syllables WHERE language = 'thalorna-note-skill-sinalelng'
UNION ALL
SELECT 'neutral', array_to_string(list_transform(list_filter(vowelPairs, p -> list_contains(harmony_neutral, p)), x -> '_' || x || '_'), ', ')
FROM syllables WHERE language = 'thalorna-note-skill-sinalelng'
UNION ALL
SELECT 'front', array_to_string(list_transform(list_filter(vowelPairs, p -> list_contains(harmony_front, p)), x -> '_' || x || '_'), ', ')
FROM syllables WHERE language = 'thalorna-note-skill-sinalelng'
```
````

The vowel partners an affix's front form takes. `harmony_partners` is a list of `{ vowel, partner }`, so `unnest` sets it out one row to a vowel:

````markdown
```sql
SELECT '_' || p.vowel || '_' AS "Vowel", '_' || p.partner || '_' AS "In a suffix's front form"
FROM (SELECT unnest(harmony_partners) AS p FROM syllables WHERE language = 'thalorna-note-skill-sinalelng')
```
````

A mutation, one table per name. `mutation` picks the rows:

````markdown
```sql
SELECT '_' || sound || '_' AS "Radical", '_' || becomes || '_' AS "Worn", coalesce(example, '—') AS "Example"
FROM mutations WHERE language = 'thalorna-note-skill-sinalelng' AND mutation = 'wearing' ORDER BY position
```
````

The marks and spellings a word is read through:

````markdown
```sql
SELECT '`' || written || '`' AS "Written", coalesce('`' || readAs || '`', '—') AS "Read as", what AS "What it is"
FROM read_past WHERE language = 'thalorna-note-skill-dunharlng' ORDER BY position
```
````

The sound changes, one table per set. `where` is an SQL keyword, so it is named in double quotes; `name` picks the set:

````markdown
```sql
SELECT step AS "Step", change AS "Change", coalesce("where", '—') AS "Where"
FROM sound_changes
WHERE language = 'thalorna-note-skill-helonclng' AND name = 'From Helonic to Byzarian'
ORDER BY step_position
```
````

The stress rule, the syllable rules and the finals. A rule of `syllables` is a column, so a `Rule | Forms` table is one `SELECT` per row joined with `UNION ALL`:

````markdown
```sql
SELECT 'Stress falls on' AS "Rule", two || ' of two syllables, ' || longer || ' of more' AS "Value"
FROM stress WHERE language = 'thalorna-note-skill-vylarilng'
```

```sql
SELECT 'Codas' AS "Rule", array_to_string(codas, ' ') AS "Forms" FROM syllables WHERE language = 'thalorna-note-skill-sowideslng'
UNION ALL
SELECT 'Finals', array_to_string(finals, ' ') FROM syllables WHERE language = 'thalorna-note-skill-sowideslng'
UNION ALL
SELECT 'Initial vowel', CASE WHEN initialVowel THEN 'yes' ELSE 'no' END FROM syllables WHERE language = 'thalorna-note-skill-sowideslng'
```

```sql
SELECT '`' || final || '`' AS "Final", "like" AS "Sounds like"
FROM finals WHERE language = 'thalorna-note-skill-tantsoulng' ORDER BY position
```
````

The joining of vowels, the joins of parts and the marks. `limit` is an SQL keyword, so it is named in double quotes:

````markdown
```sql
SELECT array_to_string(first, ', ') AS "First closes on", array_to_string(second, ', ') AS "Second opens on",
       '`' || written || '`' AS "Written", coalesce(example, '—') AS "Example"
FROM joining WHERE language = 'thalorna-note-skill-vedyarilng' ORDER BY position
```

```sql
SELECT '`' || meeting || '`' AS "Meeting", '`' || rule || '`' AS "Rule",
       array_to_string(letters, ' ') AS "Letters", coalesce("where", 'anywhere') AS "Where"
FROM joins WHERE language = 'thalorna-note-skill-khazrilng' ORDER BY position
```

```sql
SELECT mark AS "Mark", array_to_string(letters, ' ') AS "Letters", kind AS "Kind", "limit" AS "Limit"
FROM marks WHERE language = 'thalorna-note-skill-atarzadilng' ORDER BY position
```
````

A root's vowel and its frames. A frame's form for one root is read out of `examples`:

````markdown
```sql
SELECT array_to_string(second, ' ') AS "Second consonant of the skeleton",
       coalesce(nullif("between", ''), 'nothing') AS "Between the second and third"
FROM skeleton WHERE language = 'thalorna-note-skill-khazrilng' ORDER BY position
```

```sql
SELECT '**' || frame || '**' AS "Frame", '`' || shape || '`' AS "Shape", array_to_string(class, ', ') AS "Class",
       makes AS "What it makes", list_filter(examples, e -> e.root = 'd-l-k')[1].form AS "On d-l-k"
FROM frames WHERE language = 'thalorna-note-skill-khazrilng' ORDER BY position
```
````

The calling names, a doubled first syllable named in words:

````markdown
```sql
SELECT coalesce('`' || form || '`', 'the first syllable doubled') AS "Closing", usual AS "Usual for"
FROM calling_names WHERE language = 'thalorna-note-skill-vedyarilng' ORDER BY position
```
````

The name elements, the roots and the cognates. A cognate set is one row per form, so a table of them pivots on `form_language`, and its reconstructed `proto` form takes its asterisk in the query:

````markdown
```sql
SELECT '`' || form || '`' AS "Element", element_position AS "Stands", sense AS "Sense",
       array_to_string(examples, ', ') AS "Example"
FROM elements WHERE language = 'thalorna-note-skill-aelwthlng' ORDER BY position
```

```sql
SELECT '`' || root || '`' AS "Skeleton", sense AS "Sense", field AS "Field"
FROM roots WHERE language = 'thalorna-note-skill-khazrilng' ORDER BY position
```

```sql
SELECT '*' || max(proto) AS "Ancient",
       max(form) FILTER (WHERE form_language = 'thalorna-note-skill-helonclng') AS "Helonic",
       max(form) FILTER (WHERE form_language = 'thalorna-note-skill-byzarnlng') AS "Byzarian",
       gloss AS "Gloss"
FROM cognates WHERE language = 'thalorna-note-skill-helonclng'
GROUP BY position, gloss ORDER BY position
```
````

An element's `kind` keeps one set of elements apart from another, and a place's generic gives its `joining` form:

````markdown
```sql
SELECT '`' || form || '`' AS "Generic", sense AS "What it names", coalesce('`' || joining || '`', '—') AS "Joining form"
FROM elements WHERE language = 'thalorna-note-skill-nordmalng' AND kind = 'place' ORDER BY position
```
````

A daughter's inheriting set says what it `takes`, so a parent's table of its daughters is read from `language_lineage`, which follows each daughter's `data.family`, and from that set. An empty label after the `|` prints the daughter's own name:

````markdown
```sql
SELECT '[[' || l.language || '|]]' AS "Daughter", l.depth AS "Generations",
       coalesce(max(s.takes), 'nominative') AS "Takes"
FROM language_lineage l LEFT JOIN sound_changes s ON s.language = l.language AND s.takes IS NOT NULL
WHERE l.ancestor = 'thalorna-note-skill-vylarilng' AND l.depth > 0
GROUP BY l.language, l.depth ORDER BY l.depth, l.language
```
````

A zero affix has no `form`; `written` is the form as a table prints it, `∅` for a zero affix. Sinalë's case table, nominative first:

````markdown
```sql
SELECT gloss AS "Case", '_' || written || '_' AS "Back", '_' || coalesce(front, written) || '_' AS "Front"
FROM affixes WHERE language = 'thalorna-note-skill-sinalelng' AND kind = 'case' ORDER BY position
```
````

A language's names keep shapes and edges its words do not. A name's openings split by length, and `vowel` adds the row for a name that opens on a vowel; the shapes set a band table back, one row per class of name:

````markdown
```sql
SELECT consonants AS "consonants", openings AS "the openings" FROM (
    SELECT CASE WHEN edge = 'openConsonant' THEN 'one sound' WHEN max(length(s)) = 2 THEN 'two' ELSE 'three' END AS consonants,
           string_agg('`' || s || '`', ' ') AS openings, min(position) * 10 + max(length(s)) AS ord
    FROM (SELECT edge, position, unnest(sounds) AS s FROM name_edges
          WHERE language = 'thalorna-note-skill-nordmalng' AND edge IN ('openConsonant', 'openCluster') AND of = 'name')
    GROUP BY edge, CASE WHEN edge = 'openCluster' THEN length(s) END
    UNION ALL
    SELECT 'none', 'a vowel stands first', 1000 FROM name_edges
    WHERE language = 'thalorna-note-skill-nordmalng' AND edge = 'openConsonant' AND of = 'name' AND vowel
) ORDER BY ord
```

```sql
SELECT of AS "class of name", '`' || printf('%.1f', per_vowel_min) || '` to `' || printf('%.1f', per_vowel_max) || '`' AS "consonants per vowel",
       coalesce('`' || syllables_min || '` to `' || syllables_max || '`', '—') AS "syllables"
FROM name_shapes WHERE language = 'thalorna-note-skill-nordmalng' ORDER BY position
```
````

The sources a place name is held from, and the near names:

````markdown
```sql
SELECT source AS "held from",
       CASE takes WHEN 'stem' THEN 'a name-stem, in any of its three grades'
                  WHEN 'element' THEN array_to_string(list_transform(elements, x -> '`' || x || '`'), ', ')
                  ELSE (CASE takes WHEN 'godName' THEN 'that god''s name' ELSE 'that founder''s given name' END)
                       || coalesce(', clipped to its ' || clip || ' element', '')
                       || coalesce(', with a joining ending ' || array_to_string(list_transform(joining, x -> '`' || x || '`'), ' or '), '')
       END AS "what stands first"
FROM held_from WHERE language = 'thalorna-note-skill-nordmalng' ORDER BY position
```

```sql
SELECT '`' || near || '`' AS "Near name", '`' || given || '`' AS "Given name"
FROM near_names WHERE language = 'thalorna-note-skill-khelathlng' ORDER BY position
```
````

The forms older than the rules, and the negative particle:

````markdown
```sql
SELECT '_' || form || '_' AS "Form", coalesce(gloss, '—') AS "Gloss", coalesce(layer, '—') AS "Layer"
FROM older WHERE language = 'thalorna-note-skill-sinalelng' ORDER BY position
```

```sql
SELECT '_' || particle || '_' AS "Particle", coalesce(mutation, '—') AS "The verb takes"
FROM negation WHERE language = 'thalorna-note-skill-sinalelng'
```
````

See [a language's register, sounds and history](../reference/format-details.md#a-languages-register-sounds-and-history) for every key and what the lint holds it to.

### Fence attributes

A braced list may follow the language on the opening fence. Four attributes are accepted, and anything else is reported by name.

| Attribute       | Value                               | Default | What it does                                                                                                                                                                                          |
| --------------- | ----------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allow-empty`   | `true` or `false`                   | `false` | Whether a query selecting no rows is allowed. A zero-row result is a finding otherwise, because a table that silently prints nothing is the commonest way a query goes wrong unnoticed.               |
| `section-level` | an integer from 1 through 6         | `2`     | The heading level given to each group a `_section` column creates, and to each letter of a dictionary or a glossary.                                                                                  |
| `key`           | `true`, `false` or `only`           | `true`  | Whether a dictionary or a glossary prints its key. `false` omits the key and any dictionary verb table; `only` prints the key for the fence's rows and no table, letter or entry. Refused on a table. |
| `layout`        | `table`, `dictionary` or `glossary` | `table` | How the result is set: as a table, as a dictionary of words, or as a glossary of terms — see [dictionaries and glossaries](#dictionaries-and-glossaries).                                             |

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

### Dictionaries and glossaries

The build supplies a note's dictionary or glossary from its frontmatter on
every surface: the site, the Foundry journal and the book.

- **A language note with nonempty `data.words` receives a Dictionary section.** It
  contains the language's full dictionary as one alphabetical list, with
  letter headings, each word's field beside it and the key printed once. A
  language with absent or empty `data.words` receives no Dictionary section.
- **A culture or affiliation with nonempty `data.glossary` receives a Glossary
  section.** It contains only the entries that owner declares. Ranks and
  offices stand in the affiliation's own sections; they enter its glossary
  only when an explicit glossary entry names them. A note with absent or
  empty `data.glossary` receives no Glossary section.

The sections follow the note's authored text. An existing heading with
`{#dictionary}` or `{#lexicon}` receives the dictionary after its authored
text; `{#glossary}` does the same for a glossary. The heading and its
introduction stay in place, with one generated list under it:

```markdown
## Lexicon {#lexicon}

The tongue of Provenzia, whose _solmère_ is its own word.
```

A dictionary belongs to a language; a glossary belongs to one culture or
affiliation. A glossary entry belongs for one of three reasons: a common word
in the owner's core vocabulary, a dictionary word with a context meaning,
or a phrase, compound or term of art outside the dictionary with its own
gloss. The [worked culture glossary](../reference/format-details.md#glossary-terms)
selects `solmère` as a common word, gives `amère` a context meaning and glosses
`blood-field` as a term outside the dictionary. Its frontmatter supplies the
whole default Glossary section. There are no setting-wide dictionary or
glossary pages.

A dictionary noun prints its gender from its existing class and its plural
where one is available: **marendos** _n. m., pl. marendoi_. An explicit
word plural wins; otherwise the language's optional `grammar.plural` rule
replaces the first matching literal ending. The language's optional
`grammar.verbs` pattern prints once as a small head table, after the key and
before the letters. Each ending is added to the citation form, or, where the
pattern states `replaces`, takes the place of those closing letters, and the
table's heading says which. Empty verb endings print as "unchanged", or as
the letters they drop. Grammar is
never inherited through `family`, and absent grammar leaves the dictionary
unchanged. The [worked noun and verb example](../reference/format-details.md#optional-noun-and-verb-forms)
shows both declarations. Only supplied shapes are checked; words are never
checked against the rule, and no language must state grammar.

An entry naming a word of its resolved language without a `definition`
carries the word's dictionary senses and class, with a link to the word's
entry on its language page. An entry with a `definition` carries that meaning
instead, retaining its word link and class when it names a dictionary word.
Ranks, offices and definitions carry their source body or culture beside
their senses. Common choices belong to each owner: a culture and an
affiliation using the same language choose independently, and a word may be
common in one glossary and absent from another. Dictionaries mark nothing
common.

Public dictionaries omit citations to GM-only notes. `links` checks generated
tables in the source note's audience: public notes use public rows, and GM
notes retain GM citations. An authored wikilink from a public note to a GM-only
note is valid and follows the [secret-reference rules](#references-to-secret-subjects).

#### Custom views

An `sql` fence with `layout=dictionary` or `layout=glossary` sets a custom view
of the same relations. A dictionary view reads `dictionary`; a glossary view
reads `terms`. Each needs the `name`, `senses` and `usage` columns; a query
that leaves one out is reported, naming the column.

The optional `plural` and `verbs` columns supply noun plurals and the head
table in a custom dictionary view; `SELECT *` includes both. A projection
that omits these columns omits that presentation, as omitting `class` omits
word classes. With the default or `key=true`, each selected language's pattern
appears once per dictionary result, even when no abbreviation key is needed.
`key=false` omits both the key and the verb table from a fragment;
`key=only` prints only the abbreviation key. Separate head-enabled fences
each print their own tables.

For a custom list of one culture's common entries:

````markdown
## Words Everyone Knows {#common-words}

```sql {layout=glossary section-level=3}
SELECT * FROM terms WHERE owner = 'thalorna-note-lore-provenzianclt' AND common
```
````

A custom dictionary view can select one field from the language's dictionary:

````markdown
## Love and its conduct

```sql {layout=dictionary section-level=3}
SELECT * FROM dictionary
WHERE language = 'thalorna-note-skill-provnzlng' AND field = 'Love and its conduct'
```
````

A custom view with several fences can print its key once: a `key=only` fence
over all selected rows, then `key=false` on each fence below it. The
`key=only` fence prints only the abbreviation key. `key`, whatever its value,
is refused on a fence set as a table. The automatic Dictionary section
prints its own key once for the full alphabetical list.

Either layout prints, in order:

- **a key**, once, unless the fence sets `key=false`, and nothing else where
  it sets `key=only`, listing the abbreviations the result uses — a language's
  tag, a word's class or a modifier — each with its expansion; a glossary also
  explains the common mark where an entry carries it;
- **a heading per letter**, at `section-level`, accents taken off and
  apostrophes skipped, so `'ostal` files under O and `Écuyer` under E;
- **one paragraph per entry**: a glossary's `•` for a common entry, the
  headword in bold, its pronunciation between slashes, its language tag and
  word class in italics where present, its senses, and after a dash the notes
  it is cited from, as links.

A dictionary entry gives its field in italic parentheses and its etymology
in brackets:

```markdown
**solmère** /sol-MEH-reh/ _n. m._ (_Love and its conduct_) [fr. Élav. _sólmerë_] Longing; the ache for a person, a place or a time that is gone. — [[thalorna-note-lore-lastshrine|The Song of the Last Shrine]]
```

A glossary entry naming a dictionary word uses the word's senses when
`definition` is absent; a list of dictionary glosses supplies every sense.
Those senses carry no body label. An entry with a `definition` uses that
meaning and labels it with the owner, retaining its word link and class
where it names a dictionary word. On the owner's own page, a sense attributed
only to that owner omits the repeated label; other bodies and shared senses
keep their labels. A glossary sets the rows sharing a headword
and a language as one entry, numbering their senses in query order and
printing a sense several bodies give once, with all of them:

```markdown
**Sworn Knight** **1** (_Duchy of Aubrac_) Holds land of the duke. **2** (_Kingdom of Provenzia_) Holds land of the crown. **3** A knight bound by oath to a lord. — [[thalorna-note-affiliation-duchy|Duchy of Aubrac]], [[thalorna-note-affiliation-kingdom|Kingdom of Provenzia]], [[thalorna-note-lore-provenzianclt|Provenzia]]
```

The layout orders entries by letter, then by `name_sort`. **The language tag
prints where the entry's language is not the page's own**: a language note's
own language, or the note of any other note's [language](../reference/format-details.md#a-notes-language). It is the language note's `data.abbreviation`, or its
full name where unstated. Etymology never repeats the entry's own language:
a borrowed word prints `[fr. Élav. _sólmerë_]`, a built word its pieces each
with its gloss, `[_am-_ "love" + _-ère_ "one who"]`, an inherited word its
older form, `[*_hur_]` or `[Hel. *_thalass_]`, and a root word its root and
pattern. A citation of a note with no published page prints as its name.

A built piece can name a language element by its `form` or one of its
`variants`; its `sense` prints beside the piece. An affix can also be named by
its `front` form. Words and affixes take precedence over elements in the same
language, and the language is searched before its ancestors. Exact spellings
are checked before ignoring joining hyphens; case and accents are preserved.

A glossary entry may give its own sort key or respelling. A reference to a
rank or office inherits its descriptions and admits a title of one word; its
`common` value belongs to the entry's owner. A definition replaces the senses
of the owner's own rank or office, or supplies an entry of the owner's own.
The [format reference](../reference/format-details.md#dictionaries-and-glossaries)
gives every column and rule.

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

A page list names this package's own pages. A **stub** — a note with neither an authored body nor automatic lexical content — publishes no page, so it joins no list. A note tagged `gm` is listed in Foundry and left out of the website and the book, exactly as it is left out of a content table's relations.

See [page-list details](../reference/format-details.md#page-lists) for the directive's full behaviour.

## Signs: glyphs and cartouches

A **glyph** is a small picture set in a line of text, such as the sign that writes a deity's name. A **cartouche** is a framed seal set among the words around it. Both are pictures the package ships, and both render on every surface: the Foundry journals, the website, the editor preview and the book.

Each is a bracket span: a glyph has the `.glyph` class and a cartouche has the `.cartouche` class.

```markdown
The name [Ra]{.glyph slug=ra} is written with one sign.

| God    | Sign                                              |
| ------ | ------------------------------------------------- |
| Anubis | [Anubis, jackal]{.glyph slug=anubis frame=tablet} |

The seal [Au'Khelathu]{.cartouche slug=aukhelathu height=10rem align=right caption="Au'Khelathu"} is cut above the gate.
```

Each picture is named by `slug` and is a file the package ships: a glyph is `assets/icons/<slug>.svg` and a cartouche is `assets/images/cartouches/<slug>.svg`. Each surface serves the file at the address it serves every other [image](#images-and-protected-content) at. Draw the SVG with `stroke="currentColor"` and `fill="none"` to take the colour of the surface it appears on.

### `glyph`

The label between the brackets is the picture's text alternative, read aloud by a screen reader and printed in the book when the package ships no file for the sign. An empty label takes the humanized slug.

| Attribute | Value               | Default    | What it does                                                                                                  |
| --------- | ------------------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| `slug`    | the SVG's basename  | required   | Names the file `icons/<slug>.svg`.                                                                            |
| `frame`   | `tablet`            | none       | Sets the glyph inside a limestone rectangular frame, so rows of different intrinsic width line up in a table. |
| `size`    | `inline` or `block` | 1.8em tall | `inline` is small and flows with the text. `block` centers the glyph as a standalone line.                    |

A glyph takes no `#id`, no other class and no other attribute. Write the alternative text as the label; an `alt=` attribute is refused, as is any attribute the glyph does not take. A glyph with a finding is drawn as an ordinary span, and the finding names the line and column of the span.

This is a separate construct from the `:icon name:` font glyphs of the [icon guide](../guides/icons.md), which every surface renders from the package's declared `icons` registry.

### `cartouche`

The label between the brackets is the picture's text alternative, read aloud by a screen reader and printed in the book when the package ships no file for the seal. An empty label takes the humanized slug. The seal is drawn as a figure at the place the span stands in the sentence.

| Attribute | Value              | Default          | What it does                                                                                                                           |
| --------- | ------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `slug`    | the SVG's basename | required         | Names the file `images/cartouches/<slug>.svg`.                                                                                         |
| `align`   | `left` or `right`  | centered         | Floats the figure on the website and in Foundry so prose wraps around it. The book sets it at that side of its own line.               |
| `height`  | a length           | set by the theme | Sets the image's height, a number followed by `rem`, `em`, `px`, `pt`, `cm`, `mm` or `in`. The width follows the image's aspect ratio. |
| `caption` | text               | none             | A caption under the image.                                                                                                             |

```markdown
The seal [Ta Kheperu]{.cartouche slug=takheperu} is cut above the gate.

The seal of [Anpu]{.cartouche slug=anubis caption="Anpu"} is cut below it.
```

The first span centers the `takheperu` seal and takes its alternative text from the label. The second adds a caption under the `anubis` seal. A cartouche takes no `#id`, no other class and no other attribute; write the alternative text as the label, because an `alt=` attribute is refused, as is `size=`. A cartouche with a finding is drawn as an ordinary span, and the finding names the line and column of the span. A `:::cartouche` fence is not a cartouche: it is reported like any other unknown block and draws nothing.

## Expressions

An expression in `{{ }}` is replaced by a value, inline in a sentence. The note's own frontmatter is the context, so a field is read by the path a note writes it at.

```markdown
{{name.full}} was born on {{dateformat data.born}}.
There are {{words (sql "SELECT COUNT(*) FROM notes WHERE type = 'being'")}} beings.
```

### The rules of the construct

- **A field that the note does not carry is a finding, not a blank.** Expressions are compiled strictly, so a misspelled path is reported rather than quietly printing nothing.
- **An expression is one line.** It may not contain a line break or a brace.
- **A failed expression leaves its own text in the page** and reports the line and column it is written on, so the page is readable and the fault is locatable.
- **`\{{` writes an expression without evaluating it**, for an example in prose.
- **`{{{…}}}` is left alone.**
- **An expression inside a code fence is left alone.**
- Helpers nest, with the inner call in parentheses: `{{words (sql "…")}}`.

### Helpers

<!-- expression-helpers:start -->

| Helper       | Parameters                                                                                             | What it gives you                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `eq`         | `a b`                                                                                                  | True when both are the same value. Compares exactly, so 1 and "1" differ.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `gt`         | `a b`                                                                                                  | True when a is greater than b. Both must be finite numbers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `gte`        | `a b`                                                                                                  | True when a is greater than or equal to b. Both must be finite numbers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `lt`         | `a b`                                                                                                  | True when a is less than b. Both must be finite numbers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `lte`        | `a b`                                                                                                  | True when a is less than or equal to b. Both must be finite numbers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `not`        | `value`                                                                                                | True when the value is false, zero, empty or absent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `and`        | `value …`                                                                                              | True when every value given is true. Takes two or more.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `or`         | `value …`                                                                                              | True when any value given is true. Takes two or more.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `words`      | `number`                                                                                               | The number spelled out for running prose — `1200` becomes one thousand two hundred. Whole numbers only; a decimal is a finding, and `digits` takes one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `digits`     | `number`                                                                                               | The number as a grouped numeral — `1200` becomes 1,200, and a fractional part is kept.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `sql`        | `"query"`                                                                                              | The single value a query returns, for use inside a sentence. The query is a quoted string, the same SQL a table fence takes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `dateformat` | `[calendar] date ["format"]`                                                                           | A date written in a calendar. The calendar is an Address or its shortcode; left out, it is the note's own calendar — its `data.calendar`, else its culture's, else for a place its parents', else the configured `defaultCalendar` — and a note with none prints the date as written. The date is the value a note carries, and the optional last argument names an output pattern.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `ref`        | `address [form="number"\|"full"\|"title"] \| address field="when"\|"until"\|"kind"\|"summary"\|"name"` | A link to a captioned item, by its anchor — `"#thorn"` on this note, `"note-address#thorn"` on another. `form` is `number` (the default, and admitted explicitly), rendering "Figure 13"; `full`, the number and the caption; or `title`, the caption alone. Always renders as a link to the figure, and a link inside the caption contributes only its label text. The number rendered is the one the figure carries on the surface doing the rendering, whichever note names it. With `field` in place of `form`, the address names an event — `"place-ironfells#sack"`, `"#sack"` on this note, or `"lore-founding"` for a note holding one event — and the reference prints that event's `when`, `until`, `kind`, `summary` or `name` as plain text, never a link; a date prints as the note format prints any date. |

<!-- expression-helpers:end -->

A helper that is given the wrong kind of value reports it rather than printing something wrong: `words` refuses a decimal, the four comparisons refuse anything that is not a finite number, and `dateformat` refuses a date it cannot resolve in the calendar it was given.

See [date rules](dates-and-calendars.md) for what `dateformat` accepts, the calendar it uses when none is named, and the patterns its last argument names.

### An event's date, inline

`ref` with `field` in place of `form` prints one field of an [event](../reference/format-details.md#events) as plain text, so a sentence states a date from the one place the event records it rather than typing it a second time:

```markdown
Ironfells fell in {{ref "place-ironfells#sack" field="when"}}, in what the fells call {{ref "place-ironfells#sack" field="name"}}.
The chronicle records the founding in one line: {{ref "lore-founding" field="summary"}}
Our own sack was a {{ref "#sack" field="kind"}}.
```

The address names one event: `"<note>#<id>"` for an event of another note, `"#<id>"` for one of this note, or a note's Address alone when that note holds exactly one event. An event a declared dependency publishes is named by its full Address, as any cross-package link is.

| `field`   | What prints                                                        |
| --------- | ------------------------------------------------------------------ |
| `when`    | The event's date, as the note format prints any date — `~` is kept |
| `until`   | The date it ended, printed the same way                            |
| `kind`    | Its `kind`, such as `siege`                                        |
| `summary` | Its `summary`; a link written inside it prints as its label        |
| `name`    | The first name its `names` list gives                              |

The value is text and never a link, on the website, in the Foundry journal and in the book alike. `field` is a quoted string, like `form`, and a reference takes one or the other.

Each of these is an error at the reference's own line and column, and the reference's text stays in the page: an address naming no note, an anchor the note does not declare, an anchor that is a heading or another `prose` anchor rather than an event, a note holding several events or none named without an `#id`, a `field` outside the five above, and a field the event does not state — `field="until"` on an event with no `until`, or `field="name"` on one with no `names`.
