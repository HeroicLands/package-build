---
"@heroiclands/package-build": patch
---

**Languages and scripts**

- A `doc` note lists a setting's core concepts in `data.concepts`, a language with `core: true` must cover them, words name theirs in `concept`, and `package-build core` lists the gaps.
- Emphasis in a script reads as its own mark, a red rubric or an overline, stated in `data.script` or a language's `data.emphasis`; `_…_` and `__…__` work as `*…*` and `**…**` do.
- A mapping with `logographic: true` writes each word from the lexicon by its own writing or its parts', and a word with neither is an error.
- A verse fence's `scan=` names a metre declared in `data.metres`, and a line that cannot have its beats is a warning; a word's `variants` take the language's endings.
