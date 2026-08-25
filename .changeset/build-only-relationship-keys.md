---
"@heroiclands/package-build": patch
---

Stop publishing a relationship's build-only keys into the manifest.

`relationships` was copied verbatim out of `content-build.config.yaml`, and that
block now has a second reader: content-build 1.8.0 added `itemCatalog: true` as
an opt-in on a declared dependency, selecting that package's Item packs as a
resolution source for the actors pass. It is a directive to the build, not a
fact about the shipped package — so `sohl-kethira-basic` shipped a `module.json`
whose `relationships.systems[0]` carried `"itemCatalog": true` beside `id`,
`manifest` and `compatibility`, with nothing to tell a consumer which was which.
Foundry's relationship schema does not define the key; nothing broke, because
Foundry ignores what it does not know.

The fix is the distinction rather than the one name: `BUILD_ONLY_RELATIONSHIP_KEYS`
lists the keys that answer _how is this built?_, and `publishedRelationships`
drops them on the way into the manifest. Everything else is copied — including a
key this package has never heard of, on the same reasoning that lets a declared
manifest key through unread. A list is enough here, and needs no prefix agreed
between the two packages, because content-build already normalises a
relationship to a closed set of keys and rejects the rest at configuration time.
