---
"@heroiclands/package-build": patch
---

**Maps**

- A new `content-build map --tree` draws the containment tree from `parents`, clustered by continent, and reports a place with no parent, a parent no place declares, and a cycle.
- `content-build map --from <shortcode>` draws the map from that place: north up, each neighbour at its bearing and on a ring of its days, places two hops out drawn dimmer.
- `--from all` draws one map for every place with a border or a route, and `--travel` draws the whole route graph.
- The drawings land under `build/map/` as SVG beside their DOT source; GraphViz is needed for this command alone, and its absence is reported plainly.
