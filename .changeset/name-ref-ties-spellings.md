---
"@heroiclands/package-build": patch
---

A `.name` span can carry `ref=` to tie a spelling to its note without linking it, so every spelling of a person, place or thing is known to be the same one: `[Tom]{.name ref=being-tomr}`. A `ref` may also be a page-local key such as `ref="#jane"` for a subject with no note. An address that matches no note is an error, and the `names` relation gains a `ref` column.
