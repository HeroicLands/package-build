---
"@heroiclands/package-build": major
---

**`subType: user-guide` is refused.** #206 renamed the `doc` subType
`user-guide` to `userguide` and held every `type` and `subType` to the address
charset, but shipped a **transitional acceptance** for the old spelling — a
warning naming the replacement rather than a refusal — because 43 `sohl` notes
authored it and no consumer can sweep ahead of the release that renames a value.
Every consumer tree has now swept: `sohl` **0**, `sohl-thalorna` **0**,
`sohl-kethira-basic` **0**, counted on a pristine extraction of each
`origin/main`. So the acceptance guards nothing, and this is the follow-up #207
named.

`RETIRED_SUBTYPES`, `retiredSubType()` and `retiredSubTypeMessage()` are gone
from `engine/note-vocabulary.mjs`, along with the retired-spelling branch that
ran ahead of the charset check in `checkSubType`. Nothing replaces them:
`user-guide` now falls through to the **charset** check and is refused as an
error, for the reason that always applied — it contains a hyphen. That is why
the acceptance could be deleted rather than promoted to an error: the permanent
rule already covers the case, so no retirement-specific code outlived the sweep.

**Breaking**, though the diff only removes code. A spelling that built at exit 0
one release ago now fails the build, and three exported symbols no longer exist.
A tree that has swept sees no change at all — which all three consumers have,
and each was verified unaffected.

**The subType charset diagnostic is reworded.** It justified the rule by "the
hyphen separates the segments of an address", true of a `subType` when #206
shipped — `sectionOf` returned a `doc`'s subType, so the value was a URL path
segment — and not true since #204 retired sections. The rule stands on its own
footing instead: a subType is a vocabulary term the whole toolchain keys on, one
closed set away from being an address segment again, and a charset holding for a
type, a shortcode and a `contentPackage` but not for a subType would be a rule
nobody could state in a sentence. `typeCharsetMessage` is untouched — a type
genuinely is the first segment of every address.

Closes #210
