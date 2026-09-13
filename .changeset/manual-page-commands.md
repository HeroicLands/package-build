---
"@heroiclands/package-build": patch
---

`docs/commands.md` reads as a manual page. Every command carries the same
labelled sections — **NAME**, **SYNOPSIS**, **DESCRIPTION**, **OPTIONS**,
**EXIT STATUS**, **EXAMPLES**, **SEE ALSO** — in the same order, so jumping to
the right command means jumping to the right label. **SEE ALSO** cross-links
the commands that answer a related question, and every command that emits
findings or reads a configuration key now points at _Diagnostics_ or
_Configuration_ directly.

`package-build lang check` / `coverage` / `hardcoded` and
`content-build content-format schema` / `fields` / `notes` each get their own
section, rather than sharing one.
