---
"@heroiclands/package-build": minor
---

An icon can now carry attributes, and `affiliation` joins the registry.

`:icon-affiliation:{size: 2x}` — `key: value` pairs in a trailing brace, the
shape `markdown-it-attrs` and remark-directive already use. Attributes rather
than a bare size because `size` is only the first one anybody needed: a
fixed-width flag, a rotation, a title override are the same shape of thing, and
a syntax that could only express size would have to be replaced to gain any of
them.

Size is a closed vocabulary — `lg`, `xl`, `2x`, `3x` — mapping to Font Awesome's
own classes on the web and the same multiples in a PDF. It exists because the
icon legend enlarges its glyphs so a reader can tell them apart, which makes the
size part of what that page says rather than styling applied to it. A free-form
`font-size` would have been CSS, which reaches two surfaces of three.

An attribute that cannot be honoured is reported rather than ignored, and the
icon still renders: hiding a good icon over a bad size would be the worse answer.

`affiliation` is `fa-certificate` — a charter under seal. It replaces a
`fa-duotone fa-handshake` that was reaching for Font Awesome Pro because the
interlocking hands washed out at small sizes; the fix for a silhouette problem
is a bolder silhouette, not a paid tier.
