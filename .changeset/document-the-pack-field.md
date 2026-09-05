---
"@heroiclands/package-build": patch
---

**`pack` and the template priority are documented** (#264).

`docs/content-format.md` is the published statement of what a note may write, and
`pack` — one of the five universal keys, which every note type may write and the
router has always read — appeared in it only as one incidental sentence inside
another type's section.

It is now described where it belongs, beside the compendium folder: what it
names, that `<system>.pack` overrides it for one system, that an unstated one
falls back to the pack of its type marked `default: true`, and the three
declarations that are refused — a companion pack, a pack nothing answers to, and
a pack of another document type.

The **template priority** is documented too, and it needed more than a field
description: it is a priority, and priorities only mean something against the
ranges that divide them. Opening a Create dialog gathers candidates from the
world and every matching compendium — other modules' included — filters them to
the `(type, subType)` being created, dedups by `shortcode`, and takes the highest
priority, breaking ties by nearest source and then a stable UUID. So the
specification now states the reserved ranges: `0`–`98` for SoHL and HM3, `99`–`999`
for other HeroicLands packages, `1000`+ for everyone else. Since the highest wins,
anyone else's template always beats content shipped from here — which is the point.

It also records what the tri-state costs: the field is **required** on every note
SoHL compiles into an Item or an Actor, because "not a template" has to be said
rather than left out, and `0` is a real priority — the one SoHL's own templates
ship at — rather than an absence. And that HM3 keeps it in `flags.hm3`, its data
model having no field for it, where SoHL keeps it in `system`.

**The name is now `templatePriority` on all three sides** — the authored key,
`system.templatePriority` and `flags.hm3.templatePriority`. It had been three
different things: a note writes `archetype`, the mapping table said
`data.templatePriority`, and the SoHL target said `system.template`. The
specification and the schema fixture are normalized here; the build reads both
spellings through the transition (#266), and the system's own rename is
`Song-of-Heroic-Lands-FoundryVTT#1836`. That is more than a rename — it frees the
word, because `archetype` is being repurposed for a different idea entirely: the
_sort_ a character is, which is a kind and not a priority.

`kbcat` remains, and #264 tracks it: read 51 times across SoHL's knowledgebase
layouts, and the specification has never mentioned it.
