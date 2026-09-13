---
"@heroiclands/package-build": patch
---

**A frontmatter reference resolves in any package the tree can reach.**

A `ref:` field — `parentSkillCode`, `assocSkillCode`, `assocAffiliationCode` —
holds a shortcode, not an address. The system persists it as written and looks
it up at runtime among the items embedded on one actor, and an actor assembled
from several packages carries their items side by side. So the reference check
now asks only whether _any_ reachable package declares the `type`/`shortcode`
pair: local notes first, then the fetched dependency indexes, with package and
system wildcarded.

This is the rule for a reference alone. A wikilink is unchanged — its target is
a document to point at, so an omitted package still means this one, and reaching
another package still requires the fully qualified form.

A tree whose references name a parent in a dependency saw every one of them
reported:

| note                    | `sohl.parentSkillCode` | before       | after                      |
| ----------------------- | ---------------------- | ------------ | -------------------------- |
| a language skill        | `lang`                 | no such note | resolves in the dependency |
| a spirit specialisation | `spirit`               | no such note | resolves in the dependency |

A reference naming a shortcode no package declares is still an error, and the
value a note writes is still the value its document carries.

`buildLinkIndex` gains `referenceHit(target)`, which is what performs this
lookup.
