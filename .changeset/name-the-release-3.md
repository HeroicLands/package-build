---
"@heroiclands/package-build": patch
---

Correct the release the merge is dated to: 3.0.0, not 2.0.0.

The merge commit set `version` by hand _and_ carried a major changeset, so
changesets bumped it a second time. `MIGRATING.md` was the live defect — it told
a consumer to install `^2.0.0`, which resolves nowhere.
