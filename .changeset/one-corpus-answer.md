---
"@heroiclands/package-build": minor
---

**The walk's scope is stated by its caller, never resolved from the working
directory** (#243).

`walkMarkdownTree` defaulted `skipDirectories` to `loadPackConfig()`'s — so an
unscoped caller read whichever configuration resolved from the working directory
rather than the one it was working under. **Six of its twelve callers were on
that default**, which means two passes over one tree could disagree about which
files they were reading. In an ordinary build those are the same object and
nothing shows; they are not the same when a test injects a configuration, when
`PACKAGE_BUILD_CONFIG` names one, or when a command runs from a worktree.

This is the defect class #240 fixed for `entriesForNote` reading `docEntryTypes`
from the ambient config — found only because a fixture had been passing on the
leak for as long as it existed.

The parameter is now **required**, so the omission is an error rather than a
quiet second answer, and `BasePackCompiler` requires it too: a pass that omitted
it would walk whatever the working directory said, including — in a tree
configured to skip `Templates`, as `Song-of-Heroic-Lands-FoundryVTT` is — the
template notes that configuration exists to keep out of the packs.

`Scenes` was dropping it between its own constructor and `super`, which is
exactly the kind of silent gap a default hides and a requirement does not.

_No consumer calls `walkMarkdownTree`, so this is internal despite the signature
change._
