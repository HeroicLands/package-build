---
"@heroiclands/package-build": minor
---

**A note whose type the format specifies but nothing compiles gets a finding of
its own.**

The unclaimed-type check had two messages, and a third thing can be wrong — the
only one that is not the author's fault. `docs/content-format.md` documents the
type and the vocabulary declares its properties, so a note written against the
published specification is correct; this toolchain simply has not implemented it
yet.

It earns its own wording because the other two both mislead there. Naming a
missing pack or registry sends an author to `package-build.config.yaml`, where
nothing they can write will help; saying the type is unknown flatly contradicts
the specification they read it in.

The message is chosen from the vocabulary rather than from a list of types, so
each specified-but-unimplemented type is covered as it is declared.
