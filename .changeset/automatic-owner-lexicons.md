---
"@heroiclands/package-build": minor
---

- Language dictionaries and declared culture or affiliation glossaries appear automatically in journals, sites and books; remove SQL fences written for those default lists.
- Dictionaries use one alphabetical list with field tags and one key; glossary sections show only the owner's declared entries.
- Authored Dictionary, Lexicon or Glossary headings with the matching anchors keep their introductions and receive the generated list.
- Language notes with nonempty `data.words`, and cultures or affiliations with nonempty `data.glossary`, need no prose body because their generated sections provide content.
- Remove links to heading examples inside HTML comments or raw HTML; these examples do not publish sections or receive automatic lists.
