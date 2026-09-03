---
"@heroiclands/package-build": patch
---

**A frontmatter reference resolves as an address, never as an alias.**

The resolver's third argument chooses the namespace and has no fallback (#131,
#144). The frontmatter lint's `ref:` check omitted it, so every reference was
looked up as an _alias_ — and `type-shortcode` is never an alias, so every
value a `ref:` field carried was reported as naming a note nothing declares:

```
Spirit.md:7:60: error: `sohl.assocSkillCode` names skill "spirit", and no note
  or vendored manifest declares it
```

The skill existed, in the same tree, with exactly that shortcode.

A frontmatter reference is a bare address by construction — there is no pipe to
read intent from, and the field supplies the type — so the check now says so.

The suite stayed green because its index stub ignored the argument and resolved
whatever it was handed. It no longer does, which is the part that keeps this
fixed.

Closes #176
