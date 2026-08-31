---
"@heroiclands/package-build": minor
---

Follow a spread of an imported schema function, and refuse a computed field name.

Two defects in `package-build schema`, both found by running it against real
content rather than by reading it.

**A shared base schema spread from another file was dropped, in silence.** A
concrete DataModel spreads a shared builder by name — `...defineSohlDataSchema()`
— and the resolver looked for that function only in the file doing the
spreading. When it was imported, the lookup found nothing and the spread
contributed nothing, with no error: a spread of a missing function read exactly
like a spread of an empty one.

The effect was not small. Every SoHL Item and Actor subtype lost `shortcode`,
`actionDefs`, `lastRun` and `scheduledActions` from the published schema. So
content correctly authoring `system.shortcode` — which SoHL requires to be
unique per `(type, shortcode)` on an actor, and which content therefore sets
deliberately — was reported as emitting a field no DataModel declares. The check
was accusing the content of the reader's own blind spot, which is worse than not
checking: it is a false accusation delivered with the same confidence as a true
one.

An imported spread is now resolved through the import, with a same-file
definition still taking precedence.

**A computed field name is now refused rather than published as source text.**
`[`${name}Date`]: worldTimeDateField()` takes its real name from an argument
this reader does not evaluate, and the previous behaviour handed back the source
text — putting a field called ``[`${name}Date`]`` into the schema. That field
matches nothing any builder could emit: absent for checking purposes while
looking present, and permanently reported as unemitted.

It now stops, naming the file and the key:

```text
temporal-fields.ts declares a schema field with a computed name,
`[`${name}DurationFormula`]`, whose value depends on an argument this reader
does not evaluate. Write the keys out so the published schema can name them.
```

Stopping is the same stance `compareFields` already takes on an artifact of the
wrong version: the schema is a contract other repositories read, so a contract
this cannot state is worth failing for rather than approximating. The fix
belongs at the source, where the names are actually decided.

**Bump**

_Minor._ Repositories whose schemas spread an imported builder will publish more
fields than before — which is the correction. A repository using computed field
names now fails where it previously produced a wrong artifact; none does today
except the one this was found on, and that is being fixed at the source.
