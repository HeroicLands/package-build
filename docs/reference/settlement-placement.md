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

## Input and result

`map` supplies nonempty string `mapId`, `mapHash` and `jsonHash`, `units.distanceUnit` and positive finite `units.distanceScale`, and a `cells` array. Each cell supplies a distinct nonnegative safe integer `id` and a `boundary` array of at least three finite `[x, y]` coordinate pairs. `existingSites` is an array of objects with `point`, either a finite `[x, y]` pair or `null`. Limits are safe integers: `candidateLimit` may be zero; `workLimit` must be positive. `spacingMeters` is a positive finite number. An empty cells array or a grid with no rows or no columns succeeds with no candidates. A zero candidate limit succeeds only when no candidate passes the geometry and existing-site spacing checks; otherwise discovery returns `candidate-limit` with no partial or truncated list.

The result has three keys:

- `provenance` contains the supplied `mapId`, `mapHash`, `jsonHash`, a copy of `units`, and `spacingMeters`.
- `candidates` is an array of `{ cellId, point }` objects. `cellId` is the packed cell ID; `point` is an `[x, y]` pair in map coordinates.
- `missing` is an array of `{ code, message }` diagnostics. A successful result has an empty array; a diagnostic result contains one entry and no candidates.

Diagnostic codes are `invalid-input` for missing or malformed inputs, `invalid-geometry` for malformed cell polygons or IDs, `ambiguous-geometry` for overlapping cell interiors, `unknown-location` for an existing site without a position, `work-limit` when geometry or grid work exceeds the limit, and `candidate-limit` when the result would exceed its limit. The hashes and units describe the caller's normalized input; discovery does not itself read or verify map files. On an `invalid-input` result, provenance records the supplied values before validation: individual fields may be absent or malformed, and `units` may be absent or contain malformed values. On success, `units.distanceUnit` and `units.distanceScale` have the supported, positive values described above; the copy also retains any other unit fields supplied by the map.

## Rural selection

`selectSettlementPlacements` accepts the captured session and assembler inputs,
plus direct cell IDs, an explicit position for each captured settlement, grid
spacing, and work and candidate limits. Existing placements provide acreage;
zero is a known value. Missing positions and acreage stop selection. The result
contains assembled calculation inputs and a selection report; it writes no notes.

Each grid square is clipped to its owning cell. Its share of the cell polygon
weights the physical acreage remaining after existing reservations. This is a
modeling assumption, not a surveyed parcel or a statement of worked land.
Uncovered edges remain unassigned. The declared land rule and culture determine
household capacity, bounded below the town population band. The rural population
allocator assigns whole households, and occupied sites receive modeled acreage
from their household holdings. The report includes the weights, ceilings, cell
ledgers, unallocated population and final food calculations. Candidate points
are operation data rather than settlement note fields.

## Command

`package-build settlement --polity ADDRESS --map FILE --json FILE --inputs FILE`
prints a JSON report for a captured local polity. The command reads the saved
map and its Full JSON export only on demand. The inputs file is a JSON object
with these keys:

- `pin` and `mapping`: the [Azgaar map input](azgaar-map-input.md) pin and
  explicit state and culture mapping.
- `bindings` and `settings`: the [settlement assembly](settlement-inputs.md)
  inputs, including existing placements, land rules and urban supply inputs.
- `selection`: `cellIds`, `existingSites` (each with an existing settlement
  `identity` and coordinate pair `point`), `spacingMeters`, `candidateLimit`
  and `workLimit`.

The report includes missing inputs and exits unsuccessfully when the operation
is incomplete. The default is a dry run. `--write` reports the required
setting name checks and does not write rows while those checks are unavailable.
