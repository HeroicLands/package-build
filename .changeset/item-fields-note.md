---
"@heroiclands/package-build": patch
---

**`content-build docs item-fields`.** A destination under the content tree
(`assets/content/`) now writes a complete note — `type: doc`,
`subType: reference`, a derived `shortcode`, `name.full` and `pack: none` —
rather than a typeless page the content walk silently drops. A consumer
declares further note frontmatter under `docs.itemFields.frontmatter`,
deep-merged over the generated envelope; `--check` compares the whole file.
A destination outside the content tree is unaffected.
