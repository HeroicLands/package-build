---
"@heroiclands/package-build": patch
---

**New npcs**

- `package-build npc new` writes a complete npc note from a culture and a gender, filling every other field, an Appearance paragraph and a name; the same spec always gives the same person, and `--seed` draws another.
- Give any field yourself, inline or from a JSON or YAML file, including the name and the Appearance and Dossier text, and it is written exactly as you gave it.
- A culture describes its people in `data.appearanceProfile`, with weighted eye, hair and skin colours, complexions, frames and height ranges, and names the tongue they speak in `data.language`.
- A language skill note lists its speakers' names in `data.names`: one or several patterns such as `{given} {clan}` or `{given} {given.male}sen`, by gender where forms differ, and the lists they draw on; a name you give must fit one.
- `package-build lint` checks a profile's words, weights and ranges, and a language's pattern and lists.
