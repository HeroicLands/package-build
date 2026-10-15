---
"@heroiclands/package-build": patch
---

- A language note can list its words in `data.words`, with the class modifiers, fields and affixes they use; the compiled Item is unchanged.
- A language can name its parent language in `data.family`, and reads the parent's words as its own; lint reports a parent that is no language or a family that loops.
- Cultures and affiliations can list their own glossary terms in `data.glossary`, and each term can name the language it belongs to.
- A glossary term that names no language takes its affiliation's, a parent affiliation's or its culture's; lint reports a term that ends up with none.
- Lint warns about an affiliation that belongs to no culture, since its ranks and offices reach no glossary.
- Content tables can list a language's words and every glossary term, with the language each is in.
