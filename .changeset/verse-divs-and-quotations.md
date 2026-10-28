---
"@heroiclands/package-build": minor
---

**Verse**

- Works use verse divs with aligned native/Roman text; encoded quotations flow in prose as script only, while Roman quotations keep verse layout.
- Canto breaks can show a heading and anchor within the work.
- The formatter preserves complete verse divs and quotations untouched.

**Upgrading**

- Write each work as `::: {.verse ...}` or `:::verse {...}`, keep its attributes, and close the div with `:::`.
- Replace authored `***` with `--- {.canto}` on its own line after a blank line, with a stanza on both sides.
