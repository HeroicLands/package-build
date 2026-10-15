---
"@heroiclands/package-build": patch
---

- A content table can be set as a dictionary of words with `layout=dictionary`, or as a glossary of terms with `layout=glossary`: bold headwords under letter headings, a key of only the abbreviations used, numbered senses and citations.
- One query lists a language's words with the words it inherits, its common words on any page, a culture's or an affiliation's glossary with its ranks and offices, or the whole setting's dictionary and glossary.
- A culture's or an affiliation's glossary entries mark words and ranks common, give them respellings, let in single-word titles, and add or replace definitions of their own.
- A language can state the tag a dictionary prints for it in `data.abbreviation`, such as `Prov.`.
- `package-build content-index` also writes the dictionary and the glossary beside the index, for reading with `jq` or an editor.
