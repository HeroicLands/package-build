---
"@heroiclands/package-build": patch
---

**Specification** — the content format names an address an address:

- **A field that points at something is typed `Address`** — the
  `package-system-type-shortcode` tuple, written at any of its lengths.
- **A `Shortcode` is a type of its own**: one segment, resolved among one actor's
  own items and never expanded. An affiliation's `relations` keys and a mystery's
  `skillAptitudes` keys are typed that way.
- **A wikilink has its own section**, defined as `[[<Address>[#<anchor>]|<text>]]`
  — the brackets, the anchor and the label belong to the prose form.
