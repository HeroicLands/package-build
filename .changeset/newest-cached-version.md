---
"@heroiclands/package-build": patch
---

**The item catalogue picks the newest cached version numerically, not by string
sort** (#272).

`foreignItemCatalogDirs` chose among several cached versions of a dependency
with a plain `sort()` over directory names of the form `<id>@<version>`. That is
a **string** comparison, so `sohl@0.8.10` sorts _before_ `sohl@0.8.2` and the
build resolved its embedded item references against the older catalogue.

Nothing reported it, and nothing could: both caches are complete and stamped,
and the older one is a perfectly valid catalogue — it simply answers for the
wrong version. Several versions coexist whenever a pinned version is raised
without clearing `build/cache/foreign`, which is the ordinary case, since a
fetch writes the newly declared version beside the old one rather than replacing
it.

The content-index cache already compared version segments numerically for
exactly this reason. That comparison is now shared as `newestVersionDir` rather
than written once per cache: two copies were two chances to get it wrong, and
this is the copy that was wrong.
