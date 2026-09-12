---
"@heroiclands/package-build": patch
---

A registry entry can now name an icon family, so a package that draws from two
of them can say so.

The SoHL icon legend states in its own prose that it uses Font Awesome plus
Game-Icons.net "for the arms, gear, and condition glyphs that Font Awesome does
not cover" — eighteen `ginf-*` classes the registry had no way to express. They
differ in more than a prefix: Game-Icons has no weights, so a `style` on such an
entry names something that does not exist, and it resolves to a different font,
which a PDF has to embed separately.

`family` defaults to `fontawesome`, so every existing entry is unchanged. A
style on an unstyled family is reported rather than silently ignored, because it
means the author expected a filled and hollow pair the family cannot spell.

Also adds `gem` and `gem-outline`, and repoints `diamond` at them. `fa-diamond`
is Font Awesome's playing-card suit and ships in solid only, so it could not
spell the hollow half of the Success Value scale it was being used for.
