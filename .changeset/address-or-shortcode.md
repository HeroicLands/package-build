---
"@heroiclands/package-build": patch
---

**A shortcode field now refuses a value that carries the address separator.** `assocSkillCode`, `assocAffiliationCode` and `parentSkillCode` each name another item by its bare shortcode, resolved at runtime among one actor's own embedded items rather than by address — so a qualified value can never resolve there. The finding now says exactly that, instead of reporting the value as a dead reference. No authored value in any tree carries the separator today, so nothing that lints clean now fails.
