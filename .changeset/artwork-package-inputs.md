---
"@heroiclands/package-build": minor
---

**Content and notes**

- Build with validated artwork from exact-version npm packages and their asset indexes.

**Upgrading**

- Declare each artwork package in `art.packages` and as an exact required development dependency, then run `npm ci`.
