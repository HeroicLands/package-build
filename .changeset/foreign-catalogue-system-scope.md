---
"@heroiclands/package-build": minor
---

**A fetched item catalogue is read one system at a time** (#58).

A pack declaring `system: hm3` already read only this repository's `hm3` and
system-neutral Item packs. The other half of the same lookup — the catalogue
fetched from a dependency that declares `itemCatalog: true` — was unscoped, and
both halves are merged into one address space keyed by `subType:shortcode`. So
an address that exists in both vocabularies resolved against whichever document
the dependency's other system happened to supply, and said nothing: `skill:awar`
is a real address under SoHL and under HM3 and means two different documents.

`deps fetch` now records what each extracted pack is, from the dependency's own
manifest, and `foreignItemCatalogDirs(config, system)` reads only the packs that
system may see plus the ones declaring no system at all.

**What a consumer sees**

|                                      | Before                  | After                            |
| ------------------------------------ | ----------------------- | -------------------------------- |
| a pack with `system: hm3`            | reads every cached pack | reads the `hm3` and neutral ones |
| a single-system build                | reads every cached pack | unchanged                        |
| a cache filled by an earlier version | used as-is              | treated as incomplete            |

**Refill the cache once.** A cache written before this holds the items but not
what they are, and neither way of proceeding without that is honest: reading
every pack is the wrong-document failure above, and reading none fails a build
that worked. So it is incomplete, and `content-build deps fetch` refills it —
the command the cold-cache error already names.
