---
"@heroiclands/package-build": minor
---

An affiliation records what it answers to, where it sits, and what it holds sway
over (SoHL#1781).

**`relation` is now `relations`.** The field holds a _map_ of standings, one per
affiliation — its own description said so, and `resolveRelation` has always read it
that way. The singular named the many as one.

The retired spelling is still read, underneath the current one, and reported through
`RETIRED_FIELD_ALIASES` — the same three steps `img`/`image` and
`templatePriority`/`archetype` take. `relations` wins wherever a note writes both,
and the thrown message names whichever spelling the note actually used. Only
`affiliation` declares the field, so `relation` stays an ordinary unknown key on
every other type.

**Three fields are new**, and each was unexpressible before: the content format
specified them and no declaration could receive them.

| authored  | emitted          |                                                                                                      |
| --------- | ---------------- | ---------------------------------------------------------------------------------------------------- |
| `parents` | `system.parents` | The bodies it is subordinate to. A list, because an affiliation may sit under more than one at once. |
| `seat`    | `system.seat`    | Where its authority sits.                                                                            |
| `domains` | `system.domain`  | The places it holds sway over.                                                                       |

`seat` is deliberately not `capital` or `headquarters` — each fits about half the
eleven subTypes, while a seat covers a polity, a guild, an order and a faith alike.

`domains` → `domain` is **authored plural, emitted singular**, which is what the
format's own mapping row states. The declaration carries both spellings so neither
side has to guess, and a note that authored `domain` would otherwise have compiled
to nothing.

`parents` and `domains` are separate because they are different relations —
_subordinate to_ against _holds sway over_ — and an earlier `parent.regions` grouped
the geographic one under the organisational one while also naming regions where a
guild's domain may be a single town.

Both lists ship `[]` rather than null: _refers to nothing_ is a value here — a
sovereign polity answers to nobody — not an absence. Blank rows, which a cleared
property editor leaves behind, are dropped rather than emitted.

**This needs the schema half to land with it.** SoHL declares `system.relations`,
`system.parents`, `system.seat` and `system.domain` in the same wave; an emitted key
the data model does not define is discarded at construction without a warning.
