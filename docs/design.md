---
shortcode: design
name: { full: "Design of the package-build toolchain" }
type: doc
subType: concept
---

# Design of the package-build toolchain

This document records the reasoning behind the package boundaries. [Getting started](getting-started.md) is the entry point for using the toolchain; [configuration](configuration.md), [commands](commands.md), and the [API reference](api.md) describe its current interface.

## One authored source

A note is the source for its readable page, content-index record, and any Foundry document it describes. The shared body lives in one system-agnostic JournalEntry. Game-system blocks supply mechanics and document-specific overrides. This boundary prevents a character or Item description from diverging across compendiums, website pages, and books.

The repository's `package-build.config.yaml` is the source for its package kind, content namespace, packs, publishing choices, and Foundry manifest. The build derives transient output under `build/`. It does not rewrite authored notes, art, or configuration during an ordinary build.

## Address identity

An Address identifies a subject by package, system, type, and shortcode. It is independent of the note's folder and display name, so authors can reorganize prose without changing links. The `note` system identifies readable content; a game-system segment identifies its Actor or Item; `none` identifies systemless assets and documents. A dependency's published content index lets a build resolve foreign Addresses without compiling that dependency's packs.

The content index uses JSON Lines. A record can retain the note's full frontmatter, anchors, and outgoing links, and streams without loading one giant JSON array. It is derived, disposable, and stable for a fixed source tree and toolchain version. SQL queries and editor navigation read that index rather than guessing from filenames.

## Reference presentation and access

An indexed subject has one ordinary wikilink syntax regardless of its audience.
The renderer derives spoiler presentation from the actual destination, so an
author does not duplicate a privacy declaration on every mention. The `.show`
override reveals a particular reference without changing the destination's
audience. A separate inline `.secret` span marks authored text as a spoiler.

Concealment and access remain separate decisions. Public site and book builds
omit GM-only notes; a reference to an omitted destination carries no unusable
link. Foundry's private packs and page permissions govern destination access.
Web inline spoilers use a separate show/hide control beside their content, so
a revealed link is independently usable. Foundry inline spoilers use a CSS
redaction revealed on hover or keyboard focus; they have no native secret-section
permission behavior. Books ignore inline `.secret` and preserve normal text
formatting. A spoiler in published HTML remains readable in the source. See the
[authoring contract](authoring/links-and-markup.md#references-to-secret-subjects)
for syntax and surface presentation.

## Build boundaries

The content pass reads `assets/content/` and addressable assets. It emits the content index, page source, and Foundry documents. Site rendering and book typesetting consume those outputs; their layout decisions do not become fields of a Foundry DataModel. Packaging stages only the files a Foundry manifest declares. The build checks emitted fields against the target system schema because Foundry can otherwise discard an unknown field without an error.

Passes declare their inputs and outputs so compile order follows dependencies while pack order stays a choice for readers. A document's identity is derived once and reused across passes that cannot inspect one another's output. An Item's description pointer and its JournalEntryPage therefore agree on the page ID without shared mutable state.

## Verification

The command and API references have tests that derive their surfaces from source. The note-format contract lives in structured data and code declarations so editorial changes to Markdown do not change validation. Generated field references are checked against those declarations. Tests check emitted documents as well as input acceptance: a build that exits successfully but drops a value is still wrong. A consumer regression run compares `build/packs-json` across toolchain versions against a real content tree.

The SQL scaling guard runs `prepareTreeSqlTables` over two sizes of a synthetic
linked note tree, with rewritten shortcodes and references. It profiles each
executed query through the supplied database, including local and dependency
relations, inline expressions and generated event sections. DuckDB's JSON
`EXPLAIN ANALYZE` reports the actual cardinality of file-reader operators before
downstream filters; these source rows must stay at zero after database creation.
A direct JSON scan is the positive control for that measurement. In-memory
scans may grow with the corpus, and elapsed time is not an assertion. Schema
inspection through `DESCRIBE` has no execution profile and is excluded.

Run the guard with `npm test -- tests/sql-scaling.test.ts`. A controlled local
change from `CREATE TABLE` to `CREATE VIEW` in `createTableFromFile` must make
it fail as source rows read per query increase with the larger tree; restore
the implementation after the probe. The companion relation tests check that
queries survive source-file removal and enumerate file-reading views.

A compile retains parsed frontmatter, body, raw source and body coordinates in
its corpus. SQL preparation, document passes, folder pins, event anchors,
culture inheritance and prose-presence checks consume that shared result.
The compile guard counts actual Markdown reads and YAML parses for every file
in its fixture, including documentation and folder notes, and requires one of
each. Diagnostic positions consume retained source text when supplied.

Standing checks locate only findings they emit. YAML path lookups retain the
most recently located text's document and line counter; another text replaces
that single cache entry, so an edited note cannot inherit stale coordinates.
SQL preparation caches authored answers and stub-inclusive comparisons in
separate fields per query. Generated event fences read `entries` and `events`
and skip the comparison; their authored/generated boundary is recorded when
the sections are appended, independently of query text.
