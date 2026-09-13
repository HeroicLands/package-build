---
"@heroiclands/package-build": patch
---

**`content-config.mjs`'s own documentation now matches what `defineConfig` accepts**

The worked example at the top of `content-config.mjs` — and its `.mjs` twin in
`CONTENT.md` — authored `stats.systemId`, a key `defineConfig` refuses as
derived. Both now carry only what loads.

The `contentPackage` refusal, and the sibling refusal for a section's
`listType` / `listSubType`, named the wrong character class — `[A-Za-z0-9]`
when the enforced charset is lowercase only. Both now say `lowercase
alphanumeric` and print the pattern actually enforced, so an author who writes
`contentPackage: PackageBuild` is told what is wrong with it rather than sent
looking for a character they do not have.
