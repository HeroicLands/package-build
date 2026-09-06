---
"@heroiclands/package-build": patch
---

**An HM3 item records its template priority, as an HM3 actor already did**
(#283).

`data.templatePriority` is the shared statement that a note is a starting
template, and the specification states it as a row every type maps:
`system.templatePriority` in SoHL, `flags.hm3.templatePriority` in HM3. Only
HM3's **Actor** pass made that mapping. Its Item pass emitted whatever `flags`
the note itself authored and nothing more, so an item note declaring the
priority compiled into a SoHL item that knew it was a template and an HM3 item
that did not.

**It was silent on both sides of the build.** The note is well-formed and the
pack compiles; an omitted flag is exactly how this system says _not a template_,
so a lost priority and a deliberate one are the same output. Nor could the
emitted-key check see it — that compares what a pass writes against the
receiving **schema**, and a flag is declared by no schema. Every gear, skill and
trauma note in a tree carrying an `hm3:` block was affected, which is most of
them.

**The rule now lives in one place.** `hm3/template-priority.mjs` holds it and
both passes call it, rather than each carrying a copy — two copies being two
chances to diverge again, which is the failure being fixed. `SystemItemCompiler`
gains a `commonFlags()` hook alongside `commonSystem()`, defaulting to the
authored flags alone, so a system that keeps a shared fact in flags has a seam
to say so at.
