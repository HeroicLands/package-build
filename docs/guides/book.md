---
shortcode: guidesbook
name: { full: "Build a PDF book" }
type: doc
subType: howto
---

# Build a PDF book

`package-build pdf` selects notes from a content package and sets them as a
PDF. The website can publish the whole content tree; the book follows the
ordered document tree each book declares. This makes the book's contents
an editorial choice. A note outside every selection remains in the content
package and on its site, but it has no book entry.

The build writes Typst source under `pdf.out` and invokes the Typst binary to
produce the PDF. Typst must be available on `PATH`, or named with `pdf.binary`.
The [command reference](../commands.md) lists the CLI options; the
[configuration reference](../configuration.md) lists the `pdf` keys.

## Declare the books

`pdf.books` lists one entry per PDF. A package that publishes one book lists
one; a package that publishes a world book and a book for each culture lists
them all, and `package-build pdf` builds every one. Each book needs an `id`, a
`title` and its tree of contents:

```yaml
pdf:
  out: build/pdf
  books:
    - id: guide
      title: The Setting Guide
      subtitle: A Reader's Companion
      document: book.yaml
      out: setting
```

A tree containing only a homepage has no content pages for a book. With no
`pdf` block or no content tree, the command has nothing to build and exits 0.

### The tree: `document` or `contents`

The tree is an ordered list of sections. Each section contains prose files,
note filters, or nested sections. A book gives its tree in exactly one of two
ways: `document` names a file that holds it, and `contents` writes it inline
in the configuration. A file suits a long tree; inline suits a short book that
reads best beside the other books it shares a package with.

`book.yaml` holds the tree under a `contents:` key:

```yaml
contents:
  - sectionName: Introduction
    contents:
      - file: prose/introduction.md
  - sectionName: Places
    contents:
      - filter: "type = 'place'"
      - sectionName: Settlements
        contents:
          - filter: "type = 'place' AND subType = 'settlement'"
```

The same tree written inline sits under the book's own `contents`, without the
outer key:

```yaml
pdf:
  books:
    - id: guide
      title: The Setting Guide
      contents:
        - sectionName: Introduction
          contents:
            - file: prose/introduction.md
        - sectionName: Places
          contents:
            - filter: "type = 'place'"
```

A finding about an inline tree names `package-build.config.yaml` at the line
of the offending key; a finding about a tree file names that file.

The build keeps the order of prose and subsections as written. Notes selected
by a filter are ordered by their folded display name. The filter is a SQL
`WHERE` clause over this package's `notes` table; the build supplies
`SELECT * FROM notes`. A filter cannot choose another package's notes. A
book's `front` lists Markdown files placed before its contents.

### The file stem and `--book`

A book's PDF is named `<out>-<version>.pdf`, where `out` is the book's **file
stem**. Without an `out`, the stem is `<package>-<id>`. A stem is one path
segment with no directory, and two books may not resolve to the same stem. The
version comes from `--book-version`; with none, the file is `<out>.pdf`. Every
book is written into the directory `pdf.out` names. A package that publishes
one book and keeps a file name of the form `<package>-<version>.pdf` declares
`out: <package>`.

`package-build pdf` builds every declared book in the order declared. `--book
<id>` builds the one book with that `id`:

```bash
package-build pdf --book vedyara
```

Coverage and home books, described below, are computed over every declared
book even when `--book` renders only one.

### Sections that select nothing

A section whose filters select no printable note is left out of the book
without a finding. A tree can therefore carry a section for a culture or a
period before any note belongs to it, and the book prints nothing for it.

A section that holds prose and no selected notes, such as a preface, prints
its prose. A **book** whose filters select no note at all, whatever prose it
holds, is an error at its `id`, and that book is not built while the others
are:

```text
package-build.config.yaml:9:15: error: book `sinale` selects no note
```

## Coverage and home books

Several books draw on one content package, so the question "is every note in
some book?" belongs to the set of books, not to any one of them. After every
book's filters have run against the one corpus, the build reports each
printable note that no book selects. A **printable** note is a note that is
neither a stub nor tagged `gm`, and that `pdf.unprinted` does not name.

Two shared keys under `pdf` control the report:

- `pdf.unprinted` is a `WHERE` clause over `notes` that names notes belonging
  in no book, such as folder notes: `unprinted: "type = 'folder'"`. Coverage
  skips them. It has no default, so set it for any note type that has no place
  in a book.
- `pdf.coverage` is `warning` (the default), `error` or `off`. A printable note
  no book selects is reported at that severity, at the note's `type:` line.
  `off` reports nothing. `error` makes the command exit 1.

The finding carries the standard shape, `file:line:column: severity: message`,
with the path of the note relative to the working directory:

```text
assets/content/Guides/Fieldcraft.md:2:1: warning: no book selects this note; add it to a book's query or to `pdf.unprinted`
```

To clear the finding, add the note to a book's query or name it in
`pdf.unprinted`.

### A note several books select

A note may be selected by more than one book, and it prints in each. Its
**home book** is the first book in `pdf.books` that selects it. A note a book
selects twice counts as that one book's and prints at each position.

The home is a property of the order the books are listed in and the queries
they hold. To move a note's home, reorder the books, or narrow the query of the
book that currently holds it so that it does not select the note. Nothing
else sets a home.

### A reference to a note in another book

A PDF link cannot reach into another file, so a wikilink to a note that another
book is home to is not a link. It prints the words the link carried, then the
home book's title and the page the note's entry starts on there:

```text
the Lyrebird Inn (The Tenebrae Volume, p. 214)
```

Which form a wikilink takes depends on where its target is printed:

| The target is                                                 | The link prints                                                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| An entry of the same book, including a note the book reprints | An internal destination                                                                                                                    |
| An entry of another book, and not of this one                 | `Name (_Book title_, p. N)`, or `Name (Aelw. pN)` with an abbreviation, with no link; inside a bracket the text closes, `(Name, Aelw. pN)` |
| A note in no book                                             | The web address of the note's page                                                                                                         |

The page is the page the PDF itself numbers, which is the number printed in the
footer and used by the contents and the index, so the printed `p. N` is the
physical page of the PDF. A note the book reprints, or prints in two places,
has one page in its home book: a reference from a third book names the home
book and the page of the home book's first entry for it. Infobox links and
generated sections follow the same table.

The page is read from the laid-out book, so the build makes two passes:

1. **Pass one** renders every declared book, with `p. ?` in place of each
   cross-book page, lays each out with `typst eval`, and writes
   `pages.json` beside the books in `pdf.out`:

   ```json
   {
     "sohl-thalorna-place-lyrebird-inn": { "book": "tenebrae", "page": 214 }
   }
   ```

   The keys are the notes' canonical addresses in sorted order; the file is
   identical across builds of unchanged sources.

2. **Pass two** renders every book again with those pages and lays them out
   again. The words `(The Tenebrae Volume, p. 214)` are wider than `p. ?`, so a
   page can move. When no page moved, pass two is the output. When one did, the
   build renders once more with the new pages and reports every note whose page
   still differs from the page printed for it, as a warning at the note's file.

A build that prints no cross-book reference, such as a package with one book,
is laid out once. Rendering and laying out every book happens for each build
with `--book` too, because a page in one book is read from another; only the
requested books are compiled. `--no-compile` runs neither pass: the source
prints `p. ?` for each cross-book reference and no `pages.json` is written.

Two builds produce identical PDFs only when Typst embeds the same creation
time. Set `SOURCE_DATE_EPOCH` for a reproducible build.

### Worked example: two culture books and a World book

A package publishes a book for each of two cultures and a World book that
gathers every region:

```yaml
pdf:
  out: build/pdf
  unprinted: "type = 'folder'"
  books:
    - id: vedyara
      title: Vedyara
      contents:
        - sectionName: Vedyara
          contents:
            - filter: "data.culture = 'thalorna-note-lore-vedyariclt'"
    - id: okharin
      title: Okharin
      contents:
        - sectionName: Okharin
          contents:
            - filter: "data.culture = 'thalorna-note-lore-okharinclt'"
    - id: world
      title: The World of Thalorna
      contents:
        - sectionName: Regions
          contents:
            - filter: "type = 'place' AND subType = 'region'"
```

The content tree holds these notes:

| Note                   | Type and subtype  | Culture | Selected by      |
| ---------------------- | ----------------- | ------- | ---------------- |
| `Places/Ashmere.md`    | place, region     | Vedyara | `vedyara`, world |
| `Places/Fordholm.md`   | place, settlement | Vedyara | `vedyara`        |
| `Places/Stormhaven.md` | place, settlement | Okharin | `okharin`        |
| `Places/The Reach.md`  | place, region     | none    | `world`          |
| `Guides/Fieldcraft.md` | doc, howto        | none    | no book          |
| `Folders/Places.md`    | folder            | none    | `pdf.unprinted`  |

`Ashmere` is a region of the Vedyara culture, so both the `vedyara` book and
the `world` book select it. `vedyara` is listed first, so it is Ashmere's home.
`Fieldcraft` matches no filter, so it is the one coverage finding. The folder
note is named by `pdf.unprinted` and is not a candidate at all.

Running `package-build pdf` first reports one finding on stderr:

```text
assets/content/Guides/Fieldcraft.md:2:1: warning: no book selects this note; add it to a book's query or to `pdf.unprinted`
```

then, for each book, a line counting its entries, prose files and sections and
the path of its Typst source (and of its PDF when Typst compiles it), and then
the summary:

```text
vedyara: 2 entries, 2 notes, 0 without a culture
okharin: 1 entry, 1 note, 0 without a culture
world: 2 entries, 2 notes, 1 without a culture
5 printable notes, 1 in no book, 1 in pdf.unprinted
Ashmere (Places/Ashmere.md) is printed by vedyara, world; home: vedyara
```

Each book line gives its entries (a note printed at two positions is two
entries), its distinct notes, and how many of those carry no `data.culture`.
The `world` book's count of one is `The Reach`. The note path in the summary is
relative to the content root, while a finding's path is relative to the working
directory. The totals line counts the
printable notes that are not in `pdf.unprinted`, the ones among them that no
book selects, and the notes `pdf.unprinted` names. A final line appears for
every note that several books select, in book order and then path order,
naming the books that print it and its home.

To make `world` the home of Ashmere, list it before `vedyara`. To keep
`vedyara` first and still have `world` own the region, narrow the `vedyara`
filter with `AND NOT (type = 'place' AND subType = 'region')`; Ashmere is then
selected by `world` alone, its home is `world`, and its summary line
disappears.

## The cover page and the title page

A book opens on a **cover page** when it declares a `coverImage`, a path
resolved against the directory the configuration sits in:

```yaml
books:
  - id: world
    title: The World of Thalorna
    subtitle: A Song of Heroic Lands Sourcebook
    coverImage: assets/images/covers/world.webp
    document: world.yaml
```

The image fills the page, cropped to fit, and is page 1. The book's title and
subtitle are centred in white in the upper third, over a translucent dark band
so they read over any art. The cover carries no running footer and no page
number. A book without `coverImage` begins on its title page.

The **title page** shows the book's title, subtitle and version, then the
package's people, one per line. The people come from the top-level `authors`
list, shared by every book, each entry a `name` and an optional `role`:

```yaml
authors:
  - name: Tom Rodriguez
    role: author
  - name: Tom Rodriguez
    role: artist
  - name: Ada Quill
```

A person with a role prints as `Name, Role` with the role in title case, and
one without prints as `Name`. The role is one of `author`, `designer`,
`developer`, `editor`, `proofreader`, `artist`, `cartographer`, `layout`,
`playtester` and `translator`. A person who holds two roles is listed twice.

```text
Tom Rodriguez, Author
Tom Rodriguez, Artist
Ada Quill
```

At the foot of the title page sit the copyright and licence statements, set
under `pdf` and shared by every book:

```yaml
pdf:
  copyright: © 2026 Tom Rodriguez
  license: |
    Text is licensed under CC BY-SA 4.0.
    Code is licensed under GPL-3.0-or-later.
```

Both are optional, and the foot prints whichever is given. `copyright` is one
line; `license` may run to several. The [configuration
reference](../configuration.md#authors) lists the `authors` keys and the
closed role list.

## Control a section's page

Sections can provide a running footer and page presentation:

```yaml
contents:
  - sectionName: Places
    footer: The Atlas
    page:
      banner: assets/images/banners/atlas.webp
      kicker: The Atlas
      columns: 2
    contents:
      - filter: "type = 'place'"
```

`page.columns` accepts one through four columns. The ordinary page uses two.
`page.banner` names an image the package ships, and `page.kicker` supplies the
line above an entry title. A subsection inherits presentation from its
ancestors; a declared `page` block replaces the inherited block as a whole,
so it states every page option that subsection wants. A section without a
banner still has a title plate. A banner path that cannot be read is a
finding.

Each section and each selected entry starts on its own page. The PDF has a
contents page and an outline for section and entry navigation. A note's
`description` appears as an epigraph when present. Wider tables span both
columns; a wide table outside a figure fence starts on a new page so it stays
after its introduction. A wide table inside one may float to the page top, and
its label stays with it. A table too tall for one page takes pages of its own.
A figure's number runs through the whole book in reading order, counted within
its own kind. A place on a border or a route prints the map drawn from it in
its **From here** section, inside its own entry and nowhere else. A map note prints
each of its exported Scene's level backgrounds on its own landscape page.
The
[content format](../content-format.md) describes image sizes, floats, and
links as they are authored in notes.

The book stages raster art at up to 300 dpi for its largest printed use.
Ordinary images fit their column, full-width images fit the page's text width,
and map backgrounds fit the landscape map area. An image smaller than that
target keeps its authored pixels and still fills its allotted space on the
page. SVG art stays vector. The build never changes authored image files.

## The index

A book that prints at least one note ends with an **Index** chapter, grouped
under letter headings. Nothing configures it: the build derives it from the
notes the book prints.

| Term                     | Source                        | Shown as                                                                           |
| ------------------------ | ----------------------------- | ---------------------------------------------------------------------------------- |
| A note's name            | `name.sort`, else `name.full` | the page of the note's entry in **bold**, then the pages of every authored mention |
| A name without its head  | `name.full`                   | the same pages as the note's entry, filed as `Targud, Kingdom of`                  |
| An alias                 | `name.aliases`                | _see_ the note's name                                                              |
| An event's in-world name | `data.events[].names`         | _see_ the name of the note that holds the event                                    |

A name that opens with a generic word a reader would not look under, such as
`Kingdom of Targud` or `Ritual: Blessing`, is also filed under the rest of the
name when [`pdf.indexHeads`](../configuration.md) lists that opening: with
`indexHeads: ["Kingdom of ", "Ritual:"]` the index lists `Targud, Kingdom of`
and `Blessing, Ritual`, each with the pages of the note's entry. No alias is
needed to find the note under its distinctive word. An inverted entry that would
print the same as another note's term is told apart by the note's subtype, then
its parent place, as any two equal terms are.

To get a term into the index, give the note a `name.full`, add an alias or an
event name, or link to the note from prose with a wikilink. A wikilink to a note
the book prints adds the page it appears on. A term mentioned several times on
one page lists that page once, and a note printed under more than one section
is listed once, with every page it occupies.

**An index lists the notes its own book is home to.** A note's home is the
first book in `pdf.books` that selects it. In a package of several books:

- A note a book reprints from another book's home has no entry in the
  reprinting book. Its term, with its aliases and event names, is in its home
  book's index, and a link to it from the reprinting book adds nothing there.
- The pages an index lists are those of its own book, taken from the same table
  as the cross-book references (`pages.json`), so the page a reference prints
  for a note is the page its home book's index lists for the note's own entry.
- A mention of a note another book prints is not a term of the mentioning
  book. The mention reads `Name (_Book title_, p. N)` in the text (`Name (Aelw. pN)` when the home book declares an `abbreviation`), and the note's
  entry and its page are in the other book's index.

Set [`pdf.indexSeeAlso`](../configuration.md) to `true` to list those mentions
too. Each note another book prints that this book mentions in authored prose
then has a line, filed under its name:

> Sword: _Book A_, p. 12

A home book with an `abbreviation` files the line as `Sword: BkA. p12`.

Two kinds of link add nothing:

- **Links in generated sections** such as "Within" or "Governed by". They name
  notes the build chose rather than the author, and would add a page to nearly
  every place and bury the authored mentions. They print the page of the note's
  entry beside the name instead, as
  described under [Build and inspect](#build-and-inspect).
- **Links to a note the book does not print.** There is no page to point to.

Terms sort on the ASCII fold the content index derives for names (`nameAscii`),
ignoring case, so an accented name files under its base letter and the order
matches the table of contents. A note's own entry reads as its `name.sort` when it declares one, in index form such as `Black Flame, The` or `Hilvan, Doran`, and as its `name.full` otherwise; it files, and takes its letter heading, from that form. A note that declares a `sort` is not also filed under `pdf.indexHeads`. A term that does not begin with a letter files
first, under `#`. An alias or event name that folds to the same text as the
note's own name is not listed again.

Two notes that print the same name are told apart. Each is qualified with the
note's subtype, or its type where it has none, as in `Ashkabel (settlement)` and
`Ashkabel (character)`. Where that still collides, the name of the place the
note is within is added: `Ashkabel (settlement, Harn)`. An alias or event name
that points at a qualified name prints the qualifier too.

Page numbers come from the typeset book, so they stay correct however the pages
reflow, and each is a link to its page in the PDF. The Index is reached from the
Contents and the bookmarks like any other chapter.

## Set fonts and icon fonts

The build supplies its default book fonts and searches its own font directory
for them. A package can choose families and add a font directory:

```yaml
pdf:
  books:
    - id: guide
      title: The Setting Guide
      document: book.yaml
  fonts:
    serif: Libertinus Serif
    sans: Libertinus Sans
    mono: DejaVu Sans Mono
    path: assets/fonts
  iconFonts:
    fontawesome: assets/fonts/fa-solid-900.ttf
```

The `fonts` values are family names; `fonts.path` is a directory to search.
`iconFonts` maps an icon family to the file carrying its glyphs. The Typst
invocation ignores system-installed fonts, so a machine's font collection
does not silently change the book. Check a chosen font's coverage for the
characters in the notes: Typst can substitute a face and still exit
successfully. The [content format](../content-format.md) covers icon names
written in notes; the [configuration reference](../configuration.md) covers
the font registry.

## Build and inspect

```bash
package-build pdf
package-build pdf --no-compile
package-build pdf --out build/book
package-build pdf --book vedyara
```

`--no-compile` emits the Typst source and staged images without invoking
Typst, and so without measuring pages. The source and assets sit under the output directory, because Typst
reads paths relative to its compilation root. An authored image from this
package can be staged into the book. A remote image or one owned by another
package cannot be read by this build; the build reports that limitation.

Wikilinks between selected notes become internal PDF destinations. A link to
a note outside the selection or another package remains a web address.
Anchors on headings are scoped to their entries, so two entries can use the
same heading anchor. The build reports an unresolved destination while
keeping the source available for inspection.

A reference to a GM-only note or secret heading prints normally. GM-only notes
remain omitted, and references to them print as text without a link. `.show`
does not add an omitted destination to the book. Inline `[text]{.secret}` spans
print as ordinary text, preserving emphasis, links, anchors and `.name` bold
styling; the book ignores their `.secret` class.

Secret sections and `:::secret` fences keep their visible contents in pale
lavender boxes (`#f2eefb`) with a purple left border and title (`#5c4b8a`). The
default title is **! Secret**; a fence can supply its own title. See
[secret references](../authoring/links-and-markup.md#references-to-secret-subjects).

The [generated sections](../reference/format-details.md#generated-sections)
an entry carries — **Within**, **Governed by**, **In song and story**, the
event views and the rest — name notes the build chose rather than the author,
so their links follow their own rule, because a book is often a selection:

- A name whose note is in the book is an internal link followed by the page
  that note's entry starts on, printed as the contents prints it:
  `Ford (p. 12)`. The number is Typst's own, read after layout.
- A name whose note is printed by another book is followed by that book and
  page, `Ford (_The Tenebrae Volume_, p. 12)`, with no link; see
  [a reference to a note in another book](#a-reference-to-a-note-in-another-book).
- A name whose note is in no book is printed as plain text, with no link, no
  page and no finding.

Links an author wrote keep the rules above and carry no page number.
