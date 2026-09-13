---
"@heroiclands/package-build": minor
---

**A guide to reading this toolchain's diagnostics**

`docs/diagnostics.md` explains the `file:line:column: severity: message` form
every warning and error carries: why a field is dropped rather than guessed,
why both severities print to stderr, how a configuration error is located,
and which commands fail a run on an error-severity finding. It closes with a
runnable example that parses a command's output programmatically.
