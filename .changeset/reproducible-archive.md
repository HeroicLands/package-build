---
"@heroiclands/package-build": patch
---

Rebuilding a release of the same commit produces an identical `module.zip` or `system.zip`, so a rebuilt archive can be compared with the one already published. Setting `SOURCE_DATE_EPOCH` stamps the archive's files with that time.
