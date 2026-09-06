---
"@heroiclands/package-build": patch
---

**A folder's `parent` may be a map keyed by pack, and the lint now agrees**
(#288). `folderFields()` has read both forms since #276 — a folder's _identity_
is one thing and its _hierarchy_ another, and both large trees file the same
folder under a different parent in the items pack and the journals pack. The
vocabulary typed the field as a bare `LINK`, so `content-build lint` required a
scalar and rejected every note using the form the specification prescribes: 46
findings against `sohl-thalorna` and 3 here, exactly the notes #276 documents as
its motivating cases and no others. Every note using the form was a finding, and
no note using it was not.

`parent` is declared `scalar-or-map` now, and a map written in that form is
checked **entry by entry** rather than as one value — the correction an author
has to make is one pack's address, not the whole map, and quoting the map back
named every entry that was right alongside the one that was not. An explicit `~`
under a pack key still means _at the root there_, which is a different statement
from saying nothing.

**A pack key naming no declared pack is a finding of its own.** Nothing checked
it before, because the whole value was rejected before it was read. It is not a
harmless surplus: the compile asks the map for the pack it is writing and falls
back to `default` when there is no such key, so a mistyped `journal:` filed the
folder wherever the default put it — exactly the hierarchy the key was written
to override, and silently. `content-build lint` passes the configured pack names
(companions included) for the check; a caller that supplies none makes no claim
about the keys, as it already does for the vocabulary itself.

The specification's `### type: folder` table types `parent` as the scalar-or-map
it is, so the two cannot disagree again from opposite sides of one field.
