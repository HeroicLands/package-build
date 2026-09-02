---
"@heroiclands/package-build": minor
---

Commit the content format specification as `docs/content-format.md`, and add
`content-build content-format` to check it.

The specification — how a note becomes a Foundry document and a web page: three
frontmatter regions, a note vocabulary with its own `type` and `subType`, the
declared map onto each system's document fields, the precedence between a shared
source and a system's override, and the wikilink address grammar — lived in a
gitignored draft. Nothing could link to it, it had no history, and it was
invisible to everyone but its author while four other issues were being
implemented against it. It is this package's contract: `content-build` is what
reads notes and writes documents, so the format belongs beside the code that
honours it.

**The document is checkable, and two throwaway scripts written while drafting it
are now real commands.**

`content-build content-format schema --schema <system>=<path>` resolves every
`system.*` target the document names against the naming system's published
`schema.json`, in the `version: 1` shape `package-build schema` emits. This is
the emitted-versus-declared idea pointed at prose rather than at code: the format
does not define the `sohl:` or `hm3:` schemas — each system does, and its
artifact is the authority — so a mapping row is a claim, and a claim naming a
field no schema declares means the two disagree. There are 88 such claims today.

`content-build content-format notes` measures a content tree against the
per-type `data` tables, counting findings in four classes: a note type the
document declares no section for, an unknown key in the closed `data:` region, a
declared shared source written at top level instead, and one written straight
into a system block.

**Both read the document's own tables.** A transcribed list of targets and
vocabularies would be a second copy of the specification, free to drift from the
first the moment either was edited — the exact failure these checks exist to
prevent, moved one level up. No type name, field name or system name is written
in the code; editing the specification changes what the checks assert.

**A target resolves against the union of a system's subtypes.** The mapping
tables say which field a shared source reaches; _which document subtype receives
it_ is the note-type → subtype map, which is not built yet. Resolving per subtype
before that map exists would mean inferring it from the prose around each table,
which is the transcription the whole design avoids. It narrows when that map
lands.

**A system with no schema supplied is counted unchecked, not passed.** HM3
publishes no artifact today, so that is the ordinary case for 18 of the 88
claims, and a check skipping them in silence would read exactly like one that
passed.

**The corpus meter is a report, and `--strict` is the opt-in.** All ~6,210
authored notes predate the format, so a failing check would be red in every
repository on the day it landed and would stay red for the length of the
migration — a check nobody can act on and everybody learns to skip. The counts
are the migration's progress bar instead, and each class is promoted to fatal, by
turning the flag on, as it reaches zero.

Part of HeroicLands/package-build#127; closes HeroicLands/package-build#130.

**Bump**

_Minor._ A new command group, a document added to the published files, and no
change to any existing behaviour.
