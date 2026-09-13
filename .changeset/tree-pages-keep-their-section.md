---
"@heroiclands/package-build": minor
---

**A `trees` entry's pages stay where their tree mounts them** — declaring
`subType` on a note inside `site.trees` no longer moves its published address.
A `subType` classifies a page for the site index; it never routed a tree
page's URL to begin with for a note that left it unset, and now it does not
for one that sets it either. A site that already worked around this by
avoiding `subType` on its tree notes can declare it again: those pages move
back under the tree's own section on upgrade.
