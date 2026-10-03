---
"@heroiclands/package-build": patch
---

**Footnotes**

- A footnote referenced inside a box or a caption now prints and numbers with
  the rest of the note instead of showing as literal text.
- A definition written below the top level of a note is reported, as is a
  reference nothing defines.
- A definition no reference uses is reported rather than dropped from the page.

**Named blocks and captions**

- A heading that would open a page of its own is reported when it is written
  inside a box or a caption.
