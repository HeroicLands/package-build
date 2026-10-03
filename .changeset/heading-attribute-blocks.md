---
"@heroiclands/package-build": patch
---

**Headings**

- A heading carrying classes or attributes beside its anchor now anchors on the
  anchor alone, so a link written to it resolves on every surface.
- A Foundry journal and a web page carry a heading's classes and attributes onto
  the heading, and no surface prints the braces.
- A heading whose braces hold something other than an attribute block is
  reported at its own line instead of being typeset.
- `.secret` on the heading that opens a section withholds that section: the
  Foundry page is the GM's alone, and the web page and the book set it in the
  spoiler and the labelled block a secret block already gets. On the web it is a
  spoiler and not access control.
