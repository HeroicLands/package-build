---
"@heroiclands/package-build": minor
---

**A key-by-key reference for `package-build.config.yaml`**

`docs/configuration.md` documents every top-level key, every nested key, its
type, whether it is required, its default, and the exact message an author
sees when a value is wrong — quoted from the validator, so the error a build
prints is searchable against the page that explains it.

It also documents the values a repository never writes: `rootDir` and
`foundryPackage` are derived from where the file sits and from the adjacent
`package.json`; `stats.systemVersion` is derived from `package.json` or from
`systems:`; `itemBuilders` accepts a registry name (`sohl`, `hm3`) in YAML,
resolved before validation. Authoring the first three directly is refused,
with the message that says so.

`packageBuild:` — the section `@heroiclands/package-build`'s own packaging
half reads — gets the same treatment: staging assets, the manifest
pass-through and the keys it derives and refuses to have overwritten, the
localization coverage settings, the container and end-to-end test
configuration.
