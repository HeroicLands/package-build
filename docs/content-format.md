---
shortcode: contentformat
name: { full: "Authoring HeroicLands content" }
type: doc
subType: userguide
---

# Authoring HeroicLands content

A content package begins with Markdown notes under `assets/content/`. Each note has YAML frontmatter describing its identity and data, followed by prose. Folder names beneath `assets/content/` are for authors; `type`, `subType`, and Addresses determine what the build creates.

Every typed note requires a nonempty body, including drafts, folders and homepages. An empty or whitespace-only body is an error. A nonempty body with fewer than 25 prose words warns unless tagged `draft`; the tag never exempts an empty body. A `folder` note needs only a nonempty body: any content passes, with or without `draft`.

Start with [your first note](authoring/first-note.md). It explains the smallest valid note and shows the JournalEntry, web page, book entry, and content-index record made from it. Then use the chapters below in the order your note needs them.

| Need                                                      | Read                                                        |
| --------------------------------------------------------- | ----------------------------------------------------------- |
| Frontmatter, `data`, system blocks, and infoboxes         | [Frontmatter](authoring/frontmatter.md)                     |
| Addresses, links, anchors, fences, and inline expressions | [Links and markup](authoring/links-and-markup.md)           |
| Images, icons, audio, provenance, and sidecars            | [Assets](authoring/assets.md)                               |
| Canonical dates, calendars, eras, and conversions         | [Dates and calendars](authoring/dates-and-calendars.md)     |
| All accepted note types, subtypes, and fields             | [Note type reference](reference/note-types.md)              |
| Exact format details and system mappings                  | [Detailed reference](reference/format-details.md)           |
| Optional readability and wording suggestions              | [Prose analysis](commands.md#package-build-prose-lint-path) |

## The shared note

A nonempty note body creates one system-agnostic Foundry JournalEntry. Content before the first H1 becomes an introduction page; every H1 starts another JournalEntryPage. A lower-level heading with an explicit `{#anchor}` starts a page too, so a link can address it. The same prose becomes a web page and can be selected for a book. The content index records the note and its frontmatter for queries and navigation.

Leading `:` captions describe the next supported block; `:@` captions also number it. The optional type accepts `figure`, `table`, `poetry`, `code`, `prose`, and `example`. Captions support identifiers, classes and named attributes; unsupported following blocks are errors. See [captions and numbered references](authoring/links-and-markup.md#captions-and-numbered-references).

A code fence with language `poetry` keeps verse lines, stanza breaks and relative indentation. Its numbered caption uses the **Poem** label. Generic `:::` divs and `[inline spans]{.class}` accept attributes. See [poetry](authoring/links-and-markup.md#poetry), [fenced divs](authoring/links-and-markup.md#fenced-divs) and [inline spans](authoring/links-and-markup.md#inline-spans).

Body extensions use braces with space-separated `key=value` attributes:
`![[icon-harbor|Harbor]]{float=top-left size=medium}` and an SQL fence with
`{allow-empty=true}` are examples. Inline font glyphs use the package's icon
registry, as in `:icon warning:{size=lg}`; image icons use asset Addresses.
`:::info` and `:::warn` add labelled boxes within the prose. A
`pagelist` fence renders the pages carrying a tag as a list of links, so a
landing page states a group by intent rather than enumerating it. The
[links and markup guide](authoring/links-and-markup.md) gives the complete syntax.
Footnotes use `[^id]` references and `[^id]:` definitions, with numeric output
markers scoped to each note. Definition lists use a term followed by one or
more `: definition` lines. See [footnotes and definition lists](authoring/links-and-markup.md#footnotes-and-definition-lists)
for examples and placement in journals, web pages, and books.

An inline `{{sql "SELECT COUNT(*) FROM notes"}}` expression inserts one scalar query result. Use `{{words (sql "SELECT COUNT(*) FROM notes")}}` for a count in running prose, or `{{digits (sql "SELECT COUNT(*) FROM entries")}}` for grouped numerals. The query must return exactly one row and one column with a nonempty value; a mismatch is a located build error. Prefix `\{{` to show the syntax literally. The [expression reference](reference/format-details.md#dates-and-calendars) describes the helpers and the available SQL relations.

Add `gm` to `tags` for a GM-only note. Public site and book builds omit it;
Foundry compiles it only into private compendiums. An untagged note cannot link
to it. The [frontmatter guide](authoring/frontmatter.md#frontmatter-and-system-blocks)
explains routing for documents and their prose journals.

A note can also produce a system document: an Actor, Item, Scene, or Macro according to its type and system blocks. The `sohl:` and `hm3:` blocks supply game-specific mechanics and overrides; they do not create separate prose. The JournalEntry is shared between systems.

An `affiliation` note declares `data.governance.ranks` with at least one rung at
`level: 1`. Each rung states `level`, `title`, and `description`. A being's
`data.affiliations` entry names a rank on that body's ladder; level 1 is the
ordinary standing when no higher rank applies. A single level-1 rung is enough
when the body expresses its hierarchy through `governance.offices` instead.
Missing ranks, an empty list, or a ladder without level 1 are build errors.

| Authored section | SoHL Actor          | HM3 Actor            |
| ---------------- | ------------------- | -------------------- |
| `{#appearance}`  | `system.appearance` | `system.description` |
| `{#dossier}`     | `system.dossier`    | `system.biography`   |

An Item's `{#description}` page is its readable description. The note Address `<package>-note-<type>-<shortcode>#description` resolves to a JournalEntryPage UUID. The build writes the same `@UUID[...]` pointer to SoHL Item `system.docHtml` and HM3 Item `system.description`. An Item note without that anchor uses its first page as the description. Other pages and anchors remain available for links.

## A complete minimal note

Place this at `assets/content/Places/Harbor.md`:

```markdown
---
shortcode: harbor
name: { full: Harbor }
type: lore
subType: concept
---

# Harbor

A sheltered place where ships load and unload.
```

The note's readable Address is `<package>-note-lore-harbor`. In prose, link to it with `[[lore-harbor|Harbor]]`. The package segment comes from `package-build.config.yaml`; a regular wikilink defaults to the readable `note` system. An image embed such as `![[icon-harbor|Harbor]]` defaults to `none` instead.

The [first-note guide](authoring/first-note.md) shows the build commands and how to add a system document. Use the [command reference](commands.md) for exact flags and the [diagnostics guide](diagnostics.md) for located errors.

Place notes may declare a governing affiliation with `data.government`, or explicit `null` for complete anarchy. Positive population with an omitted government produces an advisory. See [place governments](authoring/frontmatter.md#place-governments).

Blockquote alerts use `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, or `[!]`, with optional attributes after the marker. They replace the former info and warn div fences; secret blocks remain supported. See [alerts](authoring/links-and-markup.md#alerts).
