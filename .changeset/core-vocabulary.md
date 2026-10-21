---
"@heroiclands/package-build": patch
---

**Core vocabulary**

- A `doc` note lists a setting's core concepts in `data.concepts`, and a language note says it must cover them with `core: true`.
- A word names the concepts it serves in `concept`; an id no list declares is an error that offers the nearest id.
- `package-build core` lists the concepts each covering language has no word for, by group, with `--language` and `--json`.
- A daughter language counts its parent's tagged words as its own.
