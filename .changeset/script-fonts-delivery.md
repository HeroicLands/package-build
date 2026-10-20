---
"@heroiclands/package-build": patch
---

**Writing in the setting's languages and scripts**

- Text can be marked with its language and set in one of the HeroicLands fonts, or in plain serif, sans or monospace, on the site, in Foundry and in books.
- Roman spelling converts into a script through a mapping note, which takes a word from the language's dictionary when the dictionary spells it differently.
- `package-build transliterate` and `package-build lexicon` show a passage or a word exactly as a build sets it.
- Converted text is checked against its language, and an unknown word or unregistered name is reported where it is written.
- A language's present endings can replace its infinitive ending, as Vylari's do.
