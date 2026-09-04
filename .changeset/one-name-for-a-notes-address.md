---
"@heroiclands/package-build": major
---

**A note's address has one name: `packageAddress`.** `engine/content-address.mjs`
exported it twice — as `contentAddress` and as `packageAddress` — and the two
bodies had become byte-identical:

```js
// before                              // after
contentAddress(fm); // "doc-gear/"     packageAddress(fm); // "doc-gear/"
packageAddress(fm); // "doc-gear/"
```

`contentAddress` is removed. Import `packageAddress` from
`@heroiclands/package-build/engine/content-address` instead; the two returned
the same string, so nothing else changes.

The names once meant different things — a note's address _within the content
tree_, and its address _relative to the package_. They could differ while a
`README.md` addressed its section rather than itself and while a page's URL was
derived from `name.full`; the first went with the landing rules (#204, #208) and
the second when a page's URL became its address (#181). What was left was two
exported names for one notion, on a public subpath, with `contentAddress`'s
documentation still describing an address "below the knowledgebase mount" that
it no longer returned.

`packageAddress` is the name that survives because it still says something true
and load-bearing: the string is measured **from the package**, so a caller
composing a URL or a manifest `path` prepends where the package is served. That
is the one qualification a reader of the call site needs, and it is exactly the
distinction the `url:` change in 15.0.0 turned on. Closes #226.
