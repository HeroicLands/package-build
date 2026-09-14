---
"@heroiclands/package-build": minor
---

**`package-build bump` takes a newer first-party release without reformatting
the lockfile.** Run it with no arguments to move every `@heroiclands/*`
dependency to its newest published version, or name the packages to move; add
`--check` to see what would change and write nothing.

npm does the resolving, so a version whose dependency set differs from the one
it replaces is handled as correctly as one that moves three lines — and then
both `package-lock.json` and `package.json` are restored to the indentation they
already used. That is the part worth having: every repository consuming this
toolchain writes its lockfile with four spaces and prettier-ignores it, npm
rewrites it with two, and a three-line version change arrives as a whole-file
reformat nobody can review.
