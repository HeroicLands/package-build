# Settlement site discovery

`discoverPlacementSites` from `@heroiclands/package-build/engine/settlement-placement` finds geometric candidates in explicitly selected normalized Azgaar cells. Its input is a map returned by `readAzgaarMap`, restricted to the cells being considered, plus all relevant existing site positions in the map's coordinate system. It does not choose how many settlements to create, allocate land, name them, bind map identities or modify source data.

Supply a positive `spacingMeters`, a nonnegative integer `candidateLimit`, and a positive integer `workLimit`. Distance uses the pinned `distanceScale` and one of the normalized units `km`, `mi`, `lg`, `vr`, `nmi`, or `nlg`. For example, three nautical miles is 5,556 meters. The operation uses a square grid anchored at map coordinate zero, with a grid interval equal to the requested physical spacing. It returns sites ordered by grid y then x. A grid point on a shared boundary belongs to the lowest packed cell ID. Cells must have distinct IDs and valid non-self-intersecting polygons; overlapping interiors are ambiguous. The input cell ID is the packed ID, not its grid ID.

```js
import { discoverPlacementSites } from "@heroiclands/package-build/engine/settlement-placement";

const result = discoverPlacementSites({
  map: selectedMap,
  existingSites: [{ point: [12, 18] }],
  spacingMeters: 5556,
  candidateLimit: 1000,
  workLimit: 1000000,
});
if (result.missing.length) {
  // Show the diagnostic to the author before using candidates.
} else {
  // Each candidate has a cellId and a point in map coordinates.
}
```

`selectedMap` retains the map ID, both source hashes, pinned units and selected normalized cell polygons. Results include those provenance values and the spacing. Coordinates at least the requested distance from every supplied existing position are eligible. Supply `{ point: null }` for an existing site whose location is unknown; discovery reports `unknown-location` and returns no candidates. Do not substitute its cell center for a known position. The caller is responsible for supplying all relevant existing locations, including those outside the selected cells that may lie within the spacing distance.

`missing` distinguishes invalid inputs and geometry, ambiguous overlapping cells, unknown locations, and work or candidate limits. A failure returns no partial candidate list. The work limit covers polygon validation, cell comparisons, grid traversal and position checks, including a preflight bound on grid traversal. Increase limits deliberately for a larger selected area; discovery does not treat a limit as a request to truncate results. Candidate sites are geometric possibilities, not a population, acreage or completed settlement proposal.
