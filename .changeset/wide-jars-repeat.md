---
"@heroiclands/package-build": minor
---

A map note's background art is `img:`, and `image:` is retired (#142).

Every note type names its artwork `img` and carries it at the note's **top
level**. A map alone named it `image` and read it out of the `sohl:` block, so
one idea had two spellings with nothing to reconcile them — and the content
format specification had to hedge rather than state a rule.

**`img` is now the name, at the top level.** `buildScene` and the place index
read `img` through `sohlField`, so it resolves the way every other note's art
does: the `sohl:` block first, then the note's own top level, which is where it
belongs. Art is not system-specific — a Scene is a core Foundry document and a
second system would want the identical one — so the field has no business inside
a system block. `docs/content-format.md` states that rule now, in place of the
callout that recorded the disagreement and pointed at this issue.

**`image:` still compiles, and is reported.** This is the first of the three
steps `package:` took (#56): both spellings are read, `img` wins where a note
carries both, and a note still writing `image` gets a finding naming the file,
the line and the replacement. The sweep of the authored notes and the eventual
refusal are separate, later work — nothing has to be renamed to take this
release.

**The finding is a warning, not an error.** A note writing `image` compiles to
the byte-identical document, so failing a build over it would red a tree that
has done nothing wrong on a key that still works. It is emitted on both paths an
author meets — the **compile**, which every consumer runs, and `content-build
lint` — so it is not a lint-only notice a project might never see.

Two consequences worth knowing:

| what                     | before                 | after                                                  |
| ------------------------ | ---------------------- | ------------------------------------------------------ |
| `content-build lint`     | any finding set exit 1 | only an **error** does; warnings are reported and pass |
| a map with no art at all | "needs an `image`"     | "needs an `img`"                                       |

The exit-code change is `reportFindings`' existing rule applied to the lint
command rather than a second copy of it. Every finding was an error until now,
so it changed nothing the day it landed.

Verified against the `sohl` content tree, whose three map notes still write
`image`: 3,126 compiled documents, byte-identical before and after, plus the
three warnings.
