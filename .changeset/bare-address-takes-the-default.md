---
"@heroiclands/package-build": patch
---

**Specification** — _In frontmatter, the address is written bare_ states one
rule where it stated two that could not both hold: where a field accepts more
than one type, a bare shortcode takes the field's declared default, and a
field with no default among its accepted types refuses a bare shortcode
outright, naming the types it accepts. The type segment always comes from the
field's own declaration, never from what the rest of the tree happens to
contain.
