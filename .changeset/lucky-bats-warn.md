---
"@heroiclands/package-build": patch
---

The charset and icon checks now report warnings rather than errors, so neither
can fail a build.

Both emitted `severity: "error"`, and `reportFindings` fails a run on an error —
so adopting the charset check turned consumers' builds red for content that was
already correct. A character outside the charset does not make a note wrong: it
compiles to the same document and publishes the same page, and only a book that
does not exist yet cares. An undeclared icon name is the same shape of thing,
visible on the page as literal text.

The NFC rule is a warning too, despite having the best claim to being an error,
because a lint that fails a build for one of its rules and not the others is one
nobody can predict.
