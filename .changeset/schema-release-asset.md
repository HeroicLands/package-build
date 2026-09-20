---
"@heroiclands/package-build": minor
---

**`schema.json` is a release asset, not a committed file.** `package-build schema` writes `build/schema.json` instead of the repository root, and `--check` is gone — there is no committed copy left to compare against. `package-build release` publishes `schema.json` beside the archive and the manifest, the way it already publishes the content index, whenever the staged tree carries one.

To keep publishing a schema: drop the committed `schema.json` and any lint step that runs `package-build schema --check`; add `{ from: build/schema.json, to: schema.json }` to `packageBuild.assets`, and run `package-build schema` before `package-build assets` in the build chain so the release never ships one older than the source it was cut from.
