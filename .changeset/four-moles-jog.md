---
"@heroiclands/package-build": patch
---

**`content-build docs item-fields --check` reports a stale page in the located form**

The stale-page diagnostic now starts with the file's path, unprefixed by a
timestamp — matching every other located failure this command line emits, and
readable by the same tools that already parse the rest of them.
