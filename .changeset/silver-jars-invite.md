---
"@heroiclands/package-build": patch
---

**Content format** — A being's portrait is a picture in its prose, not a field.
It opens the note's `{#appearance}` section — the **lead image** — and
`data.portrait` is gone:

```markdown
# Appearance {#appearance}

![[branwldrgr|Brànwâal Dôrgaar]]{float: top-left}
```

Nothing about that embed is special: it is an ordinary embedded image with an
ordinary directive, and the strictness is the convention that the portrait opens
the section, so every being note reads the same way. The section matters as well
as the order — `{#appearance}` is what becomes an actor's appearance, so a
picture above that heading reaches no document. An author can move it, caption it
or drop it like any other picture.

Four art slots remain — `icon`, `tokenIcon`, `bgImage` and `banner` — each
naming art that a document field needs. An embed also takes the same `{…}`
directive an image does, so a float or a width applies to either.
