---
"@heroiclands/package-build": minor
---

Add `package-build schema`, so a system publishes its DataModel field sets from
here rather than from its own copy of an extractor.

The consuming half of this contract shipped in 7.0.0: `content-build lint`
subtracts what a package's builders emit from what a document will actually
receive, because Foundry discards an unknown `system` key at construction and
says nothing about it. The producing half lived in the first system that needed
it, which meant the second system to need it would have copied 491 lines — and,
worse, would have copied a hardcoded `SCHEMA_ARTIFACT_VERSION`, a constant this
package owns. Two producers stamping a third repository's constant by hand is
the drift worth removing before it happens rather than after: the version is now
imported by the producer, not restated.

**Why here and not in each system.** A DataModel's schema is only introspectable
inside Foundry — `defineSchema()` returns field classes that do not exist in
Node — so the field sets have to be read out of the source as an AST.
TypeScript's parser reads plain JavaScript too, and this package already pins
that compiler for `coverage.mjs`. Putting the reader here means a
JavaScript-only system does not acquire a TypeScript pin merely to describe its
own data models.

**Declared, because the two layouts in use disagree.**

```yaml
packageBuild:
  schema:
    Item: { from: module/data/item-models.js, registry: itemModels }
    Actor: { from: module/data/actor-models.js, registry: actorModels }
```

One system keeps both registries in a single configuration module; the other
keeps one per file. Neither layout is more correct, and a convention guessing
between them would fail by reading _nothing_ rather than by complaining — which
is the worst failure available here, since an empty schema passes every check.
A registry that maps nothing is refused for the same reason.

**Four spellings of inheritance, all followed.** `...Super.defineSchema()`,
`...super.defineSchema()`, `Object.assign(super.defineSchema(), {…})`, and a
subclass with no `defineSchema()` at all. The last is a real and complete
declaration — `class MiscGearModel extends GearModel {}` — and reading it as
"declares nothing" would make every field of a whole subtype look undeclared.
`SchemaField` nesting is recorded as dotted paths whether written bare or as
`fields.SchemaField`, since both spellings are in use.

**A schema with nothing to compare against now says so.** The emitted side of
the check is the `fields:` of `itemBuilders`, so a package whose compendium
content is committed JSON rather than built from field declarations has an empty
one — and every field the system declares would have been reported as unemitted.
That is hundreds of findings whose only content is that the package does not
build documents that way, which is not news and not a defect. It is announced
once instead, for the same reason the absent-schema case is: a check that quietly
does nothing reads exactly like one that passed. The moment a builder declares
`fields:`, the comparison starts running on its own.

**Bump**

_Minor._ A new command, a new optional configuration key, and a `lint` that
reports strictly less than before.
