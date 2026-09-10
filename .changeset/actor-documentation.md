---
"@heroiclands/package-build": minor
---

**An actor note now publishes documentation, like every other note that compiles
into a system-bearing document** (#337).

A being used to produce its Actor and nothing else. That left it the one
system-bearing note with no address at `none` — its only address named the
Actor — so a prose link written `[[being-<shortcode>|Text]]` had no page to land
on. `sohl-thalorna` alone carries 772 such links.

`docEntryTypes` is now `itemTypes` plus the actor types the shipped subtype maps
declare (derived from those maps, not listed again), plus `macro` and the map
types. Only `doc` stays outside it, for the reason that actually applies to it:
its single document _is_ the prose.

**What a consumer sees**

| Before                                | After                                                                |
| ------------------------------------- | -------------------------------------------------------------------- |
| `<pkg>-<system>-being-<shortcode>`    | that, **and** `<pkg>-none-docbeing-<shortcode>`                      |
| a being's prose reachable only inline | also a JournalEntry, and a page the site publishes                   |
| `[[docbeing-x\|Text]]` unresolved     | resolves, in the link checker, the pack compilers and the site build |

Packs gain one JournalEntry per being **carrying prose**; a being with an empty
body compiles no entry, exactly as an item with an empty body does. No existing
document changes.

**A being keeps its prose inline as well**, and the asymmetry with items is
deliberate. `system.appearance` and `system.dossier` stay as rendered text, where
an item's description is an `@UUID` pointer into its journal. One item is
embedded across hundreds of beings, so baking its description into every copy
bloats the compendium by the length of the prose times the number of carriers,
and the pointer buys that back. An actor is singular, so the same indirection
would cost a reader a click and save nothing.
