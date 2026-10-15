---
"@heroiclands/package-build": patch
---

**Language tables in `sql` fences**

- A language note's affixes and fields can be queried as `affixes` and `fields`, so a Suffixes or Fields table can be set from frontmatter.
- An affix can state a `tones` pattern of its own, beside its form, gloss and examples.
- A dictionary or glossary fence takes `key=false` to leave out its key, so a page with one fence per heading states the key once.
