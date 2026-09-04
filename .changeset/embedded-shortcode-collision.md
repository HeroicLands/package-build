---
"@heroiclands/package-build": major
---

**Two embedded items on one actor may no longer share `(type, shortcode)`.**
`content-build lint` reports each collision as an error, at the later entry.

SoHL treats `(type, shortcode)` as a **logical identity** rather than a lookup
convenience: two documents of one type bearing one shortcode denote _the same
entity_, whatever their `_id`s or field values. It is unique within four scopes,
one of which is an actor's own embedded items — and the invariant exists to keep
that identity well-defined. Two colliding entries make "the same thing"
ambiguous, and every match that resolves by it — compendium↔world
reconciliation, archetype shadowing, `fvttFindItemByShortcode`, cohort
membership, expression and effect references — becomes unsound.

Nothing caught it. The compiler resolves each entry independently and
distinguishes the two only when seeding `_id`, so a collision compiled to two
documents with distinct ids and shipped unremarked:

```yaml
items:
  - { shortcode: swim, type: skill, system: { masteryLevelBase: 30 } }
  - { shortcode: swim, type: skill, initSkillMult: 1 }
```

Neither entry overrides `system.shortcode`, so both inherit `swim` from the
template and compile to two `skill` items keyed `swim` on one actor.

**The rule is decidable from frontmatter alone**, which is why it is a lint and
not a compile step. An entry's effective key is `system.shortcode ?? shortcode`:
a top-level `shortcode` merely selects the template the entry is written from
and never reaches the document, while a template's own `system.shortcode` is its
address by construction. Neither the catalogue nor a compile is needed to know
what an entry will carry.

Two entries written from one template are still fine when the second says which
entity it is — `{ shortcode: Dgr, type: weapongear, name: "Dagger 2", system: { shortcode: Dgr2 } }`.
The key is the _pair_, so two different types may share a shortcode, and an
entry naming no key at all is left to the compiler, which already reports it.

**Major**, because a tree carrying a collision goes red on adoption. Known at
the time of writing: `Song-of-Heroic-Lands-FoundryVTT` 1 actor,
`sohl-thalorna` 15, `sohl-kethira-basic` 0.
