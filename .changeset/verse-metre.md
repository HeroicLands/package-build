---
"@heroiclands/package-build": patch
---

**Verse**

- A verse fence may state `scan=` with the name of a metre a `doc` note declares in `data.metres`, such as `{ name: hexameter, beats: 6, kind: accentual }`.
- With `lang=`, each line is counted and a line that cannot have the metre's beats is a warning at that line.
- Beats follow the language's stress rule and the lexicon's word classes; readers see nothing of the count.

**Languages**

- A language states its stress rule as `stress: { two: first, longer: penultimate, mark: acute }` in place of a sentence; the sentence form is refused. The `stress` relation has the columns `two`, `longer` and `mark`.
