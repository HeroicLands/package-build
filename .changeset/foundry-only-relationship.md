---
"@heroiclands/package-build": patch
---

**A relationship may declare `contentIndex: false`.** A `requires` or
`systems` entry naming a package Foundry installs but the content tree never
cites by wikilink no longer needs a fetched index just to satisfy
`deps fetch`. `contentIndex` (default `true`) narrows a relationship declaring
it `false` to the Foundry manifest only: `deps fetch` fetches nothing for it,
and a wikilink into it fails at the link, naming the key, rather than
resolving against a stale declaration or an index nobody fetched. It cannot be
combined with `itemCatalog: true`, which extracts items from the same index
this declares there is none of.
