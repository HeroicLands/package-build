---
"@heroiclands/package-build": patch
---

**The address-segment charset is documented as lowercase, matching what it enforces.**

Comments, JSDoc and the reference documentation described `contentPackage`,
`type`, `subType` and `shortcode` as `^[A-Za-z0-9]+$` or plainly "alphanumeric",
which reads as case-insensitive. The charset every one of them is held to is
lowercase-only, and the wording now says so — in prose and in the refusal
messages an author hits when a value breaks it.
