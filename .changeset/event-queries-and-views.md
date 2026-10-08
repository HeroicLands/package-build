---
"@heroiclands/package-build": minor
---

**Events**

- Places, beings, peoples, affiliations and history notes now end with generated sections listing the events that concern them: a chronology, events taken part in, accounts given, and what followed.
- Writing your own section with the same anchor, such as `{#chronology}`, replaces the generated one.
- Content tables can read every note's events with `FROM events`, one row per event, ordered by date with `whenSort`.
- A note can print an event's date, kind, summary or name inline: `{{ref "place-ironfells#sack" field="when"}}`.
- Gear can name the event of its making and of its loss with `made` and `lost`, and a work of literature can name the event it concerns in `subjects`.

**Fixes**

- A heading marked `.secret` withholds its section in any note with frontmatter, rather than being refused as opening no page.
