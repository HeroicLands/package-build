---
"@heroiclands/package-build": minor
---

**Names and languages**

- A note lists its other names under the code of their language, beside the English `full`: `name: {full: Johnathan Lewis, en: [John], vyla: [juan juis]}`. `aliases` is refused; move each alias under its language's code, or `en`.
- A note states its language as `data.lang`, a code `languages:` declares or `en`, in place of `data.language`. A culture writes `data.lang: vyla` where it wrote `data.language: skill-vylarilng`.
- A note that states no language takes its culture's, then its parents', then `en`. A culture that states none, and inherits none from a parent culture, is an error wherever a note names it.
- Names match whatever their case, so `[arden vale]{.name}` names the note _Arden Vale_.
