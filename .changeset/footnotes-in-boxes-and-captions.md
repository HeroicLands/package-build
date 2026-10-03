---
"@heroiclands/package-build": patch
---

**Footnotes**

- A footnote referenced inside an info, warning or GM-only box, inside a
  caption, or trailing an image in a figure caption, now numbers and prints
  with the rest of the note instead of showing as literal `[^id]` text.
- A footnote definition written inside a list or a block quote, a reference
  with no definition at the top level of the note, and a definition no
  reference uses, are now each reported as an error instead of rendering
  differently — or disappearing outright — on each surface.

**Named blocks and captions**

- A heading that would start its own page — an H1, or a heading of any level
  carrying an anchor — is now reported as an error when written inside an
  info, warning or GM-only box, or inside a caption, instead of tearing a
  GM-only passage out of its box and publishing it as an ordinary page. A
  lower heading with no anchor is unaffected.
