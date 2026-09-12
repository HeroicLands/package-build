---
"@heroiclands/package-build": minor
---

**A pack default is resolved per system, so one note compiles into one pack per
system without declaring anything.**

This is the routing half of #58, and until now it made the documented
two-system layout impossible to build. A default was computed per document
_type_: a type with exactly one pack is that type's default implicitly, and a
type with several designates one with `default: true`. A tree shipping one Actor
pack per system has two, so it had neither — and a note feeding both systems
declares no `pack:` by design, since a block's `pack:` exists to say where one
system's document goes only when that _differs_.

So every note routed nowhere. On `harn-ensemble` that was all 2,519 of them, the
build failing on each in turn with a message saying the configuration was wrong
when it was the question being asked that was.

|                                              | before                                                                                                    | now                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| one Actor pack per system, no flag           | every note routes nowhere; build fails                                                                    | each system's document routes to its own pack                   |
| a type-wide `default: true` on `actors-sohl` | returned to the HM3 pass too, which saw a name that was not its own and **skipped every note in silence** | the HM3 pass gets `actors-hm3`                                  |
| `hm3.pack:` naming a SoHL pack               | routed there, and the HM3 document was lost without a word                                                | refused, naming the note and the pack                           |
| a shared `pack:` naming a SoHL pack          | the HM3 document was lost without a word                                                                  | does not answer for HM3, which falls through to its own default |

**A system is never answered with another system's pack.** That is the rule the
four rows share, and the second is the one worth stating twice: it failed
silently. The pack compiled zero entries, which a build reports only because a
pack that compiles nothing from a non-empty tree is itself an error.

**Marking a default still means what it says** — it designates that _system's_
default where a system has several packs of one type — and every single-system
configuration is untouched, since a pack declaring no system belongs to all of
them and the type-wide default answers exactly as before.

On `harn-ensemble` this takes `actors-sohl` from 0 compiled actors to 2,497, and
`actors-hm3` from routing nothing to claiming every note and reporting what each
still needs: `hm3.type`, which `being` requires because it is one-to-many into
`character` and `creature`.
