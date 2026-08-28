---
"@heroiclands/package-build": minor
---

Compile an unopened skill's opening mastery level into the actor pack.

A skill embedded on a being carries `masteryLevelBase: null` when neither the
catalogue entry nor the note states one — `null` meaning _not yet opened_. The
client filled that in on import, at Skill Base × `initSkillMult`
(`SkillLogic.initialize`), so a compiled being said nothing about what its
skills open at. It materialised on import instead of being visible in the
document, reviewable in a diff, or testable without standing up Foundry.

The actors pass now computes it. `openUnopenedSkills` runs at the end of
`buildEmbeddedItems`, after the note's frontmatter has been merged onto the
catalogue skill and after the attribute items exist — the Skill Base formula
reads the actor's attributes, so it cannot run any earlier. Only nulls are
filled; a skill that states a `masteryLevelBase` keeps it.

Evaluating `skillBaseFormula` needs an expression evaluator, which this package
had none of. `sohl/skill-base.mjs` reproduces the part of SoHL's
`SafeExpression` that a Skill Base uses: numeric literals, `attr.<code>` reads
defaulting to `0`, arithmetic, and a small helper set including `sb()` — whose
rounding (a pair averages up only when the primary is the greater) and whose
`Math.max(0, n)` clamp are copied from SoHL deliberately and must not drift. A
formula outside that subset is reported, never guessed at.

Two build-side rules the client does not need, neither of which changes what a
client computes:

- A zero or absent `initSkillMult` leaves `masteryLevelBase` null. The
  multiplier is the switch for whether a skill opens at all, so writing the `0`
  the arithmetic yields would claim the skill opened at zero rather than that it
  never opened.
- A fractional product is an error, not a rounding. `masteryLevelBase` is an
  integer field, so there is no honest value to write — the same stance
  `resolveSkillAptitudes` takes on a fractional modifier.

The scores used are the `scoreBase` values the pass just wrote, where the client
resolves `attr.<code>` to an attribute's _effective_ score. They agree for a
being carrying no attribute-altering effects, which is every being in content
today; one that did carry such an effect would bake a Skill Base its client then
disagrees with.

Closes #46.
