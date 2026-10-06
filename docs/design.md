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

## Build boundaries

The content pass reads `assets/content/` and addressable assets. It emits the content index, page source, and Foundry documents. Site rendering and book typesetting consume those outputs; their layout decisions do not become fields of a Foundry DataModel. Packaging stages only the files a Foundry manifest declares. The build checks emitted fields against the target system schema because Foundry can otherwise discard an unknown field without an error.

Passes declare their inputs and outputs so compile order follows dependencies while pack order stays a choice for readers. A document's identity is derived once and reused across passes that cannot inspect one another's output. An Item's description pointer and its JournalEntryPage therefore agree on the page ID without shared mutable state.

## Verification

The command and API references have tests that derive their surfaces from source. The note-format contract lives in structured data and code declarations so editorial changes to Markdown do not change validation. Generated field references are checked against those declarations. Tests check emitted documents as well as input acceptance: a build that exits successfully but drops a value is still wrong. A consumer regression run compares `build/packs-json` across toolchain versions against a real content tree.
