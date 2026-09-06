---
"@heroiclands/package-build": minor
---

**A note the content index cannot record is reported, not thrown** (#243) —
with a line, a column, and the right correction.

Converting the link check (#290) and the address diff (#292) to read the index
handed those passes the index's one hard failure. A note authoring a key the
index derives — {@link DERIVED_KEYS} — aborted the whole pass, so **one
malformed note took every other finding in the tree with it**, and the reader
got a bare `Error` where the project's other diagnostics give
`file:line:column: severity: message`. This is precisely what #243 lists as the
thing that must not regress, and it did.

Concretely, over a tree holding a legacy `package:` note and an unrelated dead
link:

|                         | reported                                                             |
| ----------------------- | -------------------------------------------------------------------- |
| _before the conversion_ | the dead link; nothing about `package:`                              |
| _after it_              | ``Skills/Legacy.md: `package:` is derived …`` — and **nothing else** |
| _now_                   | both, each with its position                                         |

**A reader collects; the emitter still refuses.** `collectContentIndex` and
`indexRecordsFor` take a `problems` array: given one, a note that cannot be
recorded is pushed as a diagnostic and skipped, and the derivation continues.
Given none they throw exactly as before — which is the contract
`emitContentIndex` needs, since an index quietly missing a note asserts that the
note does not exist. `buildLinkIndex`, `declaredPredecessors` and
`noteFilesById` pass the array through, and `lint`, `links`, `reachability` and
`addresses diff` emit what it collects and exit non-zero — an error whatever the
command's own strictness flag says, because the note is absent from every answer
those commands give.

**`package:` gets its own words back.** It is on the derived list, but it is not
a name collision — it is a **retired field** (#56), and the fix is to delete it,
not to rename it. `assertNoDeclaredPackage` has said so, correctly and with a
position, since the field was retired, and had **no caller**: the generic
"rename the frontmatter field" was the only message anyone saw, and it was
wrong. The index now defers to it, so one mistake has one message rather than
two that disagree about the fix.

_No change to any tree that has no such note: `sohl`'s 1,685 notes produce
byte-identical `links`, `lint` and address-map output._
