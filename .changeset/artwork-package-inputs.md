---
"@heroiclands/package-build": minor
---

**Content and notes**

- Build with validated artwork from exact-version npm packages and their asset indexes.

**Upgrading**

- Replace `art.lock` and the removed `art fetch`, `art source fetch`, and `art reproduce` commands with `art.packages` and exact required artwork development dependencies, then run `npm ci`.
