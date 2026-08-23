---
"@heroiclands/package-build": minor
---

**`package-build bundle check` — the last capability that had no command.**

The bundle-loading check was exported as a library function and reachable no
other way, so a consumer that wanted it had to write the script the command line
exists to remove: read the manifest, read the bundle, call the function, decide
how to print findings, choose an exit code. It now runs from configuration like
every other job.

It catches three ways a package builds successfully and still does not load,
none of which a bundler can see, because each is a disagreement between two
files rather than a fault in either:

| The manifest says                                                         | What Foundry does                                                                  |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| the entry under both `esmodules` and `scripts`                            | loads the bundle twice                                                             |
| the entry under neither                                                   | never loads it at all                                                              |
| the entry under `esmodules`, but the file only parses as a classic script | fails at load, naming whichever `import` came first and nothing about the manifest |

Both files are read from the stage, because the stage is what ships.

**The entry is derived, not stated.** `packageBuild.bundle.entry` defaults to
`<packageId>.mjs`, which is already derived from `package.json` `name`; a
repository states it only when its bundler emits something else. It is
deliberately _not_ read back out of the generated manifest — a value taken from
there would agree with itself by construction, and the check's whole question is
whether the manifest declares this file the way Foundry needs it.

**Reporting is now decided once.** `lang check` had the diagnostic contract —
`file:line:column: severity: message`, the path starting the line, a field
dropped rather than guessed — spelled out inline in its handler. Both commands
now report through one seam that maps findings onto the format
`@heroiclands/content-build` already owns, so the two packages cannot drift into
two nearly-identical formats. `lang check`'s output is unchanged.

**The command surface has a stated shape.** A capability with a single operation
is a bare command (`clean`, `assets`, `manifest`, `release`, `deploy <stage>`);
one with more than a single operation takes a positional action, so a second can
be added without renaming the first (`lang check`, `bundle check`).

Closes #12
