---
"@heroiclands/package-build": patch
---

A script written entirely as glyph codes no longer fails the spelling check on a language's Roman words and names. English name lists go under `data.names.en` and are reached from a name pattern as `{en.epithet}`; they are never checked against the language's encoding.
