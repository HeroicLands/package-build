---
"@heroiclands/package-build": minor
---

Close the gaps in the content format specification that the compiler can answer,
and add `content-build content-format fields` so the hand-written per-type tables
cannot drift from the declarations that compile them.

**A `### type: macro` section, written from what the compiler does.** `macro` was
named in the note vocabulary with no section of its own, so
`content-build content-format notes` reported every authored macro note as an
unknown type — a false finding caused by the document being incomplete rather
than by the note being wrong. The section states the `{#script}` anchor and its
three fence rules, why the executable copy is read from the raw markdown, why
`macroType: chat` is an error, and the two fields (`macroType`, `macroScope`) the
compiler reads from `sohl:` today and that belong in `data:` for the same reason
the map fields do. Measured against SoHL's tree, the `unknown-type` count falls
from 435 to 434 and no new finding appears.

**`government.model`, not `governance.model`.** The `affiliation` table carried
two roots for one concept — `governance.model` beside `government.summary`.
`government` is the established spelling: `engine/web-wikilinks.mjs` documents
`government.summary` as its example key path, `tests/web-wikilinks.test.ts`
fixtures it, and 79 authored notes in `sohl-thalorna` write `government:` while
none writes `governance:`. Only the odd root moved; `GovernanceModel` remains the
name of the value's vocabulary.

**A map note's art is `image:`, and the document now says so.** The table said
`img` and a standing note admitted the compiler disagreed. It does:
`map-notes.mjs` and `scenes.mjs` both read `image`, and all three authored map
notes write it. Which of the two spellings survives is a decision rather than a
documentation fix, so the document states what the build reads and points at the
issue that will settle it.

**Two stale counts corrected.** Twenty-seven fields take a `WikiLink`, not
"roughly forty"; thirteen of an `affiliation`'s properties describe the
organisation, not four. The "sixteen tables" the shared-mapping section speaks of
is exact — there are sixteen per-type mapping tables — and is left alone.

**The drift guard.** The specification hand-writes a `data` table under most of
its type sections, which is ground `engine/field-reference.mjs` already generates
from the `fields` on each `itemBuilders` entry. Generating the document is not
available: its vocabulary spans note types that produce Scenes, Macros and
JournalEntries, which no item registry covers. So the two are **checked** where
they both speak — a mapping row saying `data.weight` reaches `system.weightBase`
and a declaration writing `weight` to `weightBase` are one statement made twice,
and a rename that moves only one of them now fails, positioned at the cell in the
specification that makes the claim.

Everything else is reported rather than asserted, because the two vocabularies
differ by design until the corpus migration lands: fields only one side names come
back as coverage, and types only one side describes are **named** as out of reach
rather than skipped in silence. Against the shipped SoHL declarations it compares
9 types and 26 field pairs, names the 14 the format declares that no
`itemBuilders` entry covers and the 4 declared types the format has no section
for, and finds no disagreement. Wired into `npm run lint:content-format`.
