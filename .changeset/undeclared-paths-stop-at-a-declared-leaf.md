---
"@heroiclands/package-build": patch
---

**`undeclaredPaths` stops descending at a declared leaf** — a declared path with
no children holds _values_, not fields (#126).

A schema declares a path that has nothing beneath it for two ordinary reasons: a
map with **dynamic keys** (a mystery's `skillAptitudes` is skill selector →
modifier, an affiliation's `relations` is shortcode → standing) and a
**TypedSchemaField** (`strikeModes`, discriminated by `type`). In both, what sits
under the path is data an author wrote, not paths the schema names — so walking
into one reports every entry as an undeclared `system` key.

It stayed invisible because those maps are authored _outside_ `<system>.system`
today, where nothing walks them. The moment a note authors one at the
destination — which is what #126's corpus move does — each entry becomes a
finding: `sohl.system.skillAptitudes.zepharis`, `…strikeModes.impale`, one per
key. Measured on a migrated `sohl-thalorna`: **324 findings, none of them a
defect**, and they would have made the migration look like it had broken 62
notes.

Descent is now conditional on the schema declaring something _beneath_ the path.
`body.structure` declares `parts` and `zones`, so it is a real container and an
undeclared `adjacent` under it is still reported; `skillAptitudes` declares
nothing beneath it, so its contents are a value.
