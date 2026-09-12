---
"@heroiclands/package-build": minor
---

**The icon registry belongs to the consumer, not to the toolchain.**

`DEFAULT_ICONS` and `ICON_FAMILIES` are gone. A package declares both halves —
the fonts it ships and the names it draws from them — in its own `icons:`
configuration, and a package that declares neither names no icons at all.

A registry entry is a promise that a glyph will render, and only the package
shipping the font can keep it: the Game-Icons webfont is built by a consumer
from its own templates, and Font Awesome reaches neither the knowledgebase nor a
printed page unless somebody puts it there. A shipped table would also be one
game system's vocabulary — `victory-star-tester` means nothing to another system
compiled by this same toolchain. What is shared is the mechanism: the `:icon-…:`
syntax, resolution, rendering, and the checks.

The value is either the registry inline or a **path to a file holding it**:

```yaml
icons: assets/icon-registry.yaml
```

The file form is what a real package wants, because a registry is derived from
what the interface actually draws — so it is generated, and a generated document
inlined into a hand-edited configuration conflicts on every regeneration.

A **family** declares its class prefix and the weights it ships. A style is
checked against that list rather than against Font Awesome's three, so a font
with five weights or none is describable. An entry may declare `fixedWidth`,
which emits `fa-fw`: whether a glyph needs a full advance to sit in a column of
controls is a fact about that glyph, so it belongs to the table rather than to a
note's use of it.

**Migrating.** Move your icon names into `icons:`, declaring the families they
draw from. A tree that names no icons needs no change.
