---
"@heroiclands/package-build": major
---

**The cross-package link manifest is gone.** A package now publishes its own
content index and a consumer fetches the ones it depends on (#239).

The manifest was vendored — every repository committed a copy of every other
repository's file — and that failed three ways, none of them fixable by
tightening it.

**A copy goes stale silently, and one was.**
`Song-of-Heroic-Lands-FoundryVTT` carried 2,101 `thalorna` entries whose address
was the old name-derived form, so every cross-package link it rendered pointed
at a URL the site had stopped publishing. The format-version gate saw nothing,
because the format had not changed — only the values were wrong.

**Mutual vendoring deadlocks.** SoHL vendored thalorna and thalorna vendored
SoHL, so a format bump stopped both builds until the other had already
published: neither could go first.

**It was a second answer to a settled question.** The content index already
carried the canonical key, the name, the anchors, the Foundry `uuid` and the web
address. There was nothing in a manifest entry it did not hold.

**What replaces it**

- Every package emits `<package>-metadata.jsonl` and advertises it as
  `flags.metadataUrl`, pinned to the version being built.
- The release publishes it as a third asset, named by that URL so the file
  shipped and the URL advertised cannot disagree.
- `content-build deps fetch` pulls each dependency's index into
  `build/cache/metadata`, reading the `manifest` URL the relationship already
  declares and taking `flags.metadataUrl` from it. The whole chain is declared;
  nothing holds an address of its own.
- Cross-package links resolve from that cache.

**The dependency set is every declared dependency** — everything in
`relationships.systems` and `relationships.requires` — and deliberately _not_
only those declaring `itemCatalog: true`. Citing another package's addresses and
embedding its items are separate edges: `harn-ensemble` cites no foreign address
and carries 324,016 embedded item references. `recommends` and `conflicts` are
not dependencies and are not fetched.

**Removed:** `engine/kb-manifest.mjs`, `engine/foreign-manifests.mjs`, the
`content-build manifest` command, its `--manifests` options, and the
configuration keys `paths.manifests`, `paths.manifestOut` and
`publish.manifests`. `engine/manifest-emit.mjs` becomes
`engine/foundry-entries.mjs`, which is what it always did — `manifest.mjs` and
`kb-manifest.mjs` both exported `buildManifest` meaning different things, and
that ends here.

**Kept, and moved:** the address grammar — `canonicalKey`, `readCanonicalKey`,
`CANONICAL_KEY_SEGMENTS`, `PACKAGE_BASE` and the URL helpers — now lives in
`engine/content-address.mjs` beside `addressSlug`. It was never the manifest's;
deleting the module without splitting it would have taken the address form too.

**Two behaviours moved rather than vanished.** A manifest-completeness gate no
longer exists: a declared dependency with no fetched index is a hard error
naming `deps fetch`, so past the load everything is accounted for. And whether a
package serves pages is now the consumer's `PACKAGE_BASE` rather than the
producer's entries — a package with no configured base stays citable by UUID and
simply yields no URL, which is what `kethira` needs.

**Consumers must act.** Declare your dependencies in `relationships`, run
`content-build deps fetch` before a build that resolves cross-package links, and
delete `assets/manifests/`. A configuration still naming `publish.manifests` or
`paths.manifests` will be rejected as an unknown key.
