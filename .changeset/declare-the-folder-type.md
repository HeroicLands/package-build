---
"@heroiclands/package-build": minor
---

**The `folder` note type is declared, so the specification and the
implementation agree again** (#256).

`docs/content-format.md` gained a `### type: folder` section, and the guard added
in #245 immediately failed: a documented type must have a schema and a
vocabulary, or `lintNote` reports "no schema is declared" and returns — the note
is not merely mis-reported, it goes wholly unchecked.

A folder declares **no system-block fields**. A `Folder` is a core Foundry
document like a `JournalEntry` or a `Scene`, not a game system's, which is why
its canonical address carries `none`; everything it says is a `data` property.

- `parent` — another folder note's **address**, not an id, so reparenting one
  folder does not rewrite every note that names it.
- `color` — `#RRGGBB`. **The `#` is required**, and not for consistency: YAML
  reads a bare all-digit value as a number, so `000000` would arrive as `0`. All
  639 colour values across the five trees already carry it.

**Nothing compiles a folder note yet, and authoring one says so.** A third
finding joins the two the unclaimed-type check already had, because neither
fitted: naming a missing pack sends an author to `package-build.config.yaml`
where nothing they write will help, and calling the type unknown flatly
contradicts the specification they read it in. The new one says the format
specifies the type, the note is not wrong, and this toolchain has not implemented
it yet.
