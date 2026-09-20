---
"@heroiclands/package-build": patch
---

**`content-build docs item-fields`.** The note written under the content tree
carries a blank line between the frontmatter and the H1, so the page passes a
consumer's `lint:format` and `lint:item-fields` guards as written, rather than
leaving the two in permanent disagreement over one file.
