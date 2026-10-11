---
"@heroiclands/package-build": patch
---

`package-build lint` now resolves a being's embedded `model:` addresses against a `recommends` system that declares `itemCatalog: true`, after `deps fetch`, as the compile already does.
