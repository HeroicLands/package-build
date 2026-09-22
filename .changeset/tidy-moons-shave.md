---
"@heroiclands/package-build": minor
---

**Three states of a note** — a note with no body is now a **stub**: it carries
its facts and appears in tables and indexes, but has no page of its own, and
nothing links to it until somebody writes it. A note tagged `draft` publishes as
before, marked. Everything else is finished, and says nothing about it.

- A page's settlements, deities or characters can be listed with the unwritten
  ones beside the written, and counted by how finished they are — select
  `FROM entries` rather than `FROM notes`, which leaves stubs out as it always
  has.
- A folder note and the homepage are complete with no body, and keep their pages.
- An unwritten note still compiles the compendium document its facts describe.
- `content-build lint` asks a stub for a description, refuses one tagged
  `draft`, and reports a body that says only "TBD".
- Every build now prints how many of a package's notes are full, draft and stub.
