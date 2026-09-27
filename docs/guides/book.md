# Build a PDF book

`package-build pdf` selects notes from a content package and sets them as a
PDF. The website can publish the whole content tree; the book follows the
ordered document tree named by `pdf.document`. This makes the book's contents
an editorial choice. A note outside every selection remains in the content
package and on its site, but it has no book entry.

The build writes Typst source under `pdf.out` and invokes the Typst binary to
produce the PDF. Typst must be available on `PATH`, or named with `pdf.binary`.
The [command reference](../commands.md) lists the CLI options; the
[configuration reference](../configuration.md) lists the `pdf` keys.

## Declare the book

Set `publish.site: content` and give the book a title and document tree:

```yaml
publish:
  site: content
pdf:
  title: The Setting Guide
  document: book.yaml
  out: build/pdf
```

`publish.site: homepage` keeps the content surfaces closed, including the
book. With no `pdf` block or no content tree, the command has nothing to
build. `pdf.title` and `pdf.document` are required together when `pdf` is
declared.

`book.yaml` contains an ordered list of sections. Each section contains prose
files, note filters, or nested sections:

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

The build keeps the order of prose and subsections as written. Notes selected
by a filter are ordered by their folded display name. The filter is a SQL
`WHERE` clause over this package's `notes` table; the build supplies
`SELECT * FROM notes`. A filter cannot choose another package's notes. It is
an error when a filter selects no printable note, while notes that no filter
selects are simply outside this volume. A note selected more than once prints
at each selected position; inbound book links reach its first occurrence.

The document tree can include a section with prose and no selected notes, for
example a preface. Empty sections do not print. `pdf.front` lists Markdown
files placed before the book's contents.

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
columns; a table too tall for one page takes pages of its own. Maps attached
to selected places use full pages after those entries. The
[content format](../content-format.md) describes image sizes, floats, and
links as they are authored in notes.

## Set fonts and icon fonts

The build supplies its default book fonts and searches its own font directory
for them. A package can choose families and add a font directory:

```yaml
pdf:
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
successfully. The [icons guide](icons.md) covers the names written in notes
and the font registry.

## Build and inspect

```bash
package-build pdf
package-build pdf --no-compile
package-build pdf --out build/book
```

`--no-compile` emits the Typst source and staged images without invoking
Typst. The source and assets sit under the output directory, because Typst
reads paths relative to its compilation root. An authored image from this
package can be staged into the book. A remote image or one owned by another
package cannot be read by this build; the build reports that limitation.

Wikilinks between selected notes become internal PDF destinations. A link to
a note outside the selection or another package remains a web address.
Anchors on headings are scoped to their entries, so two entries can use the
same heading anchor. The build reports an unresolved destination while
keeping the source available for inspection.
