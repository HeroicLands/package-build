---
"@heroiclands/package-build": patch
---

Allow encoding notes to select before-consonant and source-position mappings,
and explicitly request canonical round trips for orthographies with inherent
vowels, deleted markers or shared glyphs. Exact encoding integrity remains the
default; canonical decoding returns authored conventional spellings without
recovery metadata.

Let accent permission blocks explicitly allow or forbid their characters without adding mappings or changing pronunciation.

Preserve explicit word dividers through shared word spaces, and exclude
translation-only register labels from own-language spelling checks.
