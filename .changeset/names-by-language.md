---
"@heroiclands/package-build": minor
---

**Content and notes**

- A note lists its other names under the code of their language, beside the English `full`: `name: {full: Johnathan Lewis, en: [John], vyla: [juan juis]}`.
- A note states its language as `data.lang`, a code `languages:` declares or `en`; a note that states none takes its culture's, then its parents', then `en`.
- A culture that states no language, and inherits none from a parent culture, is an error wherever a note names it.
- Names match whatever their case, so `[arden vale]{.name}` names the note _Arden Vale_.

**Upgrading**

- Move each `aliases` entry under its language's code, or `en`, and write `data.lang: <code>` in place of `data.language: skill-…`; both old keys are refused.
