---
"@heroiclands/package-build": minor
---

**The HM3 pass reads the template priority wherever a note states it** (#266).

`flags.hm3.templatePriority` was resolved as an ordinary declared field, whose
shared source is a **single** position — so only a bare top-level
`templatePriority` ever answered. The one position that did not work was
`data.templatePriority`: the specified home, the target of the settled mapping
table, and the home this pass's own docstring already claimed to read.

**It failed silently, and could only fail silently.** A note that is not a
template writes no flag, so an omitted flag is how "not a template" is spelled —
which makes a priority that was lost and a priority that was deliberately
withheld the same output. There is no tri-state left for a diagnostic to notice,
and nothing downstream can tell the two apart.

The priority is a **shared, note-level fact** — one statement both systems
record, SoHL as `system.templatePriority` and HM3 as
`flags.hm3.templatePriority` — so it is now read through the same resolver the
SoHL passes use, against the block being compiled: `data:`, this system's block,
the top level, and the retiring `archetype` spelling in the latter two. A note
carrying both spellings with different values is refused here exactly as it is
for SoHL, so the two systems cannot disagree about what a note said.

**It is read against _this_ block, not the `sohl:` one.** A tree still stating
the priority in `sohl:` writes no HM3 flag — `harn-ensemble` is that tree, on
2,502 notes — and gets one when it sweeps to `data:`, which is step 2 of #266's
migration. This change is the prerequisite for that sweep rather than a
substitute for it: without it, a tree that swept to the specified home would
have gone from a flag that worked by accident to no flag at all.

`resolveTemplatePriority` takes the block as an option, and
`statedTemplatePriority` is its tolerant sibling for a system that treats an
unstated priority as "not a template" rather than as an authoring error.
