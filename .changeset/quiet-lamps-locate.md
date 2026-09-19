---
"@heroiclands/package-build": patch
---

**A lint finding opens where it says it is** — Every path a content lint prints
is relative to the directory the command was run from, so one `content-build
lint` run reports every finding in the same shape and each one opens in an
editor, a CI annotation or a `$EDITOR +line` jump.

- _Characters, icons, raw HTML and image directives_ report the note's path the
  way the address and frontmatter rules beside them already do.
