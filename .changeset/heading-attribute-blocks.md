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
- `.secret` on the heading that opens a section makes its Foundry page the
  GM's alone.
- A withheld section reads as a spoiler on the web and a labelled block in the
  book, which conceal it rather than withhold it.
- A heading refuses `id=`, `class=` and any key beginning `on`, as a named block
  does, so no note writes an event handler onto a page.
