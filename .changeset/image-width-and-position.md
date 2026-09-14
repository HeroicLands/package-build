---
"@heroiclands/package-build": minor
---

**An image says how wide it is and where it sits, once, in the note.** A
markdown image can carry a directive in the curly-attribute convention Pandoc
and Kramdown use, and the book, the website and a Foundry journal page each
honour it:

```markdown
![Brànwâal Dôrgaar](images/beings/branwldrgr-portrait.webp){float: top-left}

![Map of Thalorna](images/maps/thalorna.webp){.full-width}
```

- **Width is a class**, and the ordinary width carries no marker — `.full-width`
  is the only one there is. One column in the book, the text measure on the
  website and in a journal page.
- **Position is `float:`**, taking `top-left`, `bottom-left`, `top-right`,
  `bottom-right` or `center`. The website and Foundry wrap text around it; print
  cannot wrap around a shape, so a float there occupies the measure and only the
  top-or-bottom half of a position has an effect.
- **An image is a block** — it stands alone in its paragraph — and its **alt
  text is the caption**, drawn under the picture on every surface.
- Both vocabularies are **closed**. `{.fullwidth}`, `{width=800}` and
  `{float: middle}` are refused by `content-build lint`, located by file, line
  and column, and they fail the run: an unrecognised value rendering as the
  ordinary width looks exactly like a directive that worked. Nothing beyond the
  two vocabularies and the address reaches emitted markup.

**The book prints pictures.** An image authored in a note is copied into the
output directory and set at the measure its class names, where it used to reach
the page as italic alt text. An address naming a file the package does not ship
prints its caption alone and is reported.

**A body image's address follows the `img:` rule** — its first segment says
which package owns the file — so `images/map.webp` reaches a journal page as
`modules/<package>/assets/images/map.webp`. The website passes an address
through as authored; one that has to resolve there is written as a full URL.

_Styling the two HTML surfaces is each surface's own: a figure carries
`note-image`, plus `note-image-full-width` and `note-image-float-…` from the
vocabularies._
