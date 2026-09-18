---
"@heroiclands/package-build": patch
---

**Content format** — A being's portrait is a picture in its prose, not a field.
It is written as the first thing in the note's body — the **lead image** — and
`data.portrait` is gone:

```markdown
![[branwldrgr|Brànwâal Dôrgaar]]{float: top-left}
```

Nothing about that embed is special: it is an ordinary embedded image with an
ordinary directive, and the strictness is the convention that the portrait comes
first, so every being note reads the same way. An author can move it, caption it
or drop it like any other picture.

Four art slots remain — `icon`, `tokenIcon`, `bgImage` and `banner` — each
naming art that a document field needs. An embed also takes the same `{…}`
directive an image does, so a float or a width applies to either.
