---
"@heroiclands/package-build": minor
---

**State the shared mapping rows, and let the checker reach them (#275).**

`docs/content-format.md` § _Mappings every type shares_ promised eight rows that
every one of the sixteen per-type tables omits "on the stated grounds that they
appear here", and then stated none: both tables were header-only, from the commit
that first committed the specification. The fields they cover were therefore
specified nowhere, and the note pointing at them pointed at nothing.

Both tables now carry their rows. The shared table states `name.full`, `img`,
`id`, `packFolder` / `folder`, `shortcode`, `data.templatePriority`, `actionDefs`
and `notes`; the actor-types table states `data.portrait`. `being` and `vehicle`
had restated `data.portrait` and `data.templatePriority` in their own tables, and
no longer do — that duplication is what the section exists to remove.

**The rows are confirmed rather than asserted.** `parseContentFormat` read
mapping tables only inside a `### type:` section, so a table standing before the
first one was invisible and its rows were checked by nothing. A mapping table in
that position is now the shared one — position is the whole distinction, since
the document's own argument for stating these once is that they belong to no type
in particular — and its rows become claims like any other.
`npm run lint:content-format:schema` confirms 86 where it confirmed 84, the seven
new ones being the shared tables' `system.*` targets.

A shared claim carries `shared: true` and is scoped to `the shared mappings`
rather than to a type, which keeps it out of the per-type field-drift check (it
has no field declaration to drift from) and reads as prose in a diagnostic:
_the format maps `shortcode` in the shared mappings to `system.notAField` in
sohl_.

Two asymmetries the rows exposed are stated beside them rather than smoothed
over: `actionDefs` and `notes` are declared on every SoHL Item subtype and on no
SoHL Actor, and SoHL's `system.docHtml` is an Item mapping with no shared source
to be a row of. A third — HM3 carrying `flags.hm3.templatePriority` on an Actor
and not on an Item — is a gap in the pass rather than in the table, and is
tracked as #283.
