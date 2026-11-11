---
"@heroiclands/package-build": patch
---

**Content and notes**

- A WebP or SVG image can be marked with `hl:derived` as a rendering of a PNG or SVG master with the same address; its properties are the master's, and it carries the address and the copyright, license and attribution.
- The image provenance check reports a derivative with no master, an address with two masters, a WebP without the mark, a PNG with it, and a derivative property that differs from or is missing on its master.
