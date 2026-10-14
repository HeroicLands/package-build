---
"@heroiclands/package-build": patch
---

`package-build labels check` is gone, because issue labels are defined once for the whole organisation; remove any `lint:labels` script and `.github/labels.yml`. A project created by `package-build init` no longer gets a label registry.
