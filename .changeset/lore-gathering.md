---
"@heroiclands/package-build": minor
---

**`lore` declares `gathering`, a genre for a scheduled public occasion** (#333).

A tournament or martial games, a great market or fair, a religious festival, a
ceremony or rite: something that happens at a place and a time, on a cycle, and
that people travel to. The genre had no value, and neither neighbour fitted.

| genre       | what it covers                                                   |
| ----------- | ---------------------------------------------------------------- |
| `calendar`  | the _reckoning_ — the cycle, the seasons, the dating system      |
| `culture`   | a social grouping of people                                      |
| `gathering` | the occasion itself — who attends, what is contested or observed |

A festival's **date** is `calendar`; the festival is not. A tournament is not a
matter of time-reckoning at all, and a great market is not a grouping of people.

**Why it matters beyond labelling.** `site.sections` narrows a section with
`listSubType`, so a subType is what makes a genre browsable. Without one, a
consumer declaring a Gatherings section would sweep in the castes, Marriage and
Personal Names alongside the games — the notes could not be listed as what they
are.

**On the name.** `festival` is too narrow: a tournament is not a festival, a
great market is a fair, and a rite is not a celebration. `event` is avoided
because it already names something else in SoHL — the event queue and
`system.scheduledActions`, where an event is a timed thing that fires in play.
`gathering` covers the whole set, and matches how the other `lore` genres are
named: a single lowercase noun for a kind of thing.

Nothing existing changes. A note already filed under `lore/culture` keeps
compiling until its author moves it; `subType` is not an address, so nothing
resolves through it.
