---
"@heroiclands/package-build": patch
---

A `packageBuild.assets` row that copies files into `icons/` or `images/` now ships them beside the staged pictures instead of having them erased. A shipped picture whose path matches a file a row already staged is an error, and the row's file is left as it was.
