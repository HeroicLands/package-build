---
"@heroiclands/package-build": minor
---

**The Foundry manifest is generated from configuration. The template is
retired.**

`package-build manifest` writes `system.json` / `module.json` from
`packageBuild.manifest` plus the facts the build already holds. There is no
`assets/templates/*.template.json`, and the template-reading path is removed
rather than left as a fallback: `writeFoundryManifest`, `stampManifest` and
`artifactFromTemplate` are gone, replaced by `buildManifest`, `writeManifest`
and `manifestPacks`.

The manifest was the one build input still hand-authored JSON, per repository,
with no schema and nothing checking it — and it declared facts the configuration
already declared. SoHL's pack list was written twice, in two formats, with
nothing checking the pairs agreed; `sohl-kethira-basic` hand-maintained its whole
`module.json`, and its `download` named an older version than the module claimed.

Three kinds of key end up in the result:

- **Declared** — `packageBuild.manifest`, emitted unchanged, so a key Foundry
  adds in a later version needs no release of this package. The block is
  deliberately not key-checked; pass-through and unknown-key checking cannot
  coexist, which is why it is its own block rather than spread across
  `packageBuild:` where the keys around it are still checked.
- **Derived** — `id`, `version`, `url`, `bugs`, `manifest`, `download`,
  `compatibility`, `relationships`, `packs`. Declaring one is an **error**
  naming the key and where the value actually comes from, not an override: an
  authored copy would be silently overwritten and the two would disagree with
  nothing to say so.
- **Computed** — namespaced `flags` from a module named in
  `packageBuild.manifestFlags`, merged over any declared. That is for a value a
  repository must work out rather than state — SoHL's credits `@UUID` only
  exists once the content tree has been walked.

`packs` comes from the **one** pack list at the top level of
`content-build.config.yaml`, with companions flattened in. Give each pack the
`label` Foundry should show; everything else is derived.

Requires `@heroiclands/content-build` **1.0.0**, which moved `compatibility` and
`relationships` to the top level (content-build#50).

Verified against SoHL's real package: the generated manifest is **byte-identical**
to what its template pipeline produces today, all 24 keys, key order included.
