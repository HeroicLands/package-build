---
shortcode: referencesettlementplacement
type: doc
name: { full: "Settlement site discovery" }
texinfo:
  parent: homepage-root
  after: [referencesettlementproposals]
---

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

The work limit includes the captured source and dependency data used by assembly.
Collection sizes are charged before iteration, including nested settlement and
parent lists. A conservative allowance covers repeated membership calculations,
placement scans and source text. Candidate assembly uses the same allowance;
an operation that exceeds it reports the missing budget before assembly.

Each grid square is clipped to its owning cell. Its share of the cell polygon
weights the physical acreage remaining after existing reservations. This is a
modeling assumption, not a surveyed parcel or a statement of worked land.
Uncovered edges remain unassigned. The declared land rule and culture determine
household capacity, bounded below the town population band. The rural population
allocator assigns whole households, and occupied sites receive modeled acreage
from their household holdings. The report includes the weights, ceilings, cell
ledgers, unallocated population and final food calculations. Candidate points
are operation data rather than settlement note fields.

Selection respects both household-derived reservations and the territorial
check's sum of displayed populations. Existing authored populations stay intact.
For example, five households of seven reserve 35 people in the model, but an
authored population of 300 still counts as 300 against the territorial ceiling.
In a territory of 500, generated rows may therefore display at most 200 people.
Whole-household allocation and two-significant-figure rounding can leave part of
that allowance unused; the report keeps that remainder visible.

## Command

`package-build settlement --polity ADDRESS --map FILE --json FILE --inputs FILE`
prints a JSON report for a captured local polity. The command reads the saved
map and its Full JSON export only on demand. The inputs file is a JSON object
with these keys:

- `pin` and `mapping`: the [Azgaar map input](azgaar-map-input.md) pin and
  explicit state and culture mapping.
- `bindings` and `settings`: the [settlement assembly](settlement-inputs.md)
  inputs, including existing placements, land rules and urban supply inputs.
- `bands`: optional numeric overrides for `homesteadBelow` (10), `hamletBelow`
  (100), `townAt` (1000) and `localAbove` (80). Type uses the first three
  boundaries; a population at or below `localAbove` has a subsistence market,
  and a larger rural population has a local market. Thresholds are whole
  numbers, increasing through `townAt`; `localAbove` is below `townAt`.
- `selection`: `cellIds`, `existingSites` (each with an existing settlement
  `identity` and coordinate pair `point`), `spacingMeters`, `candidateLimit`
  and `workLimit`.

The report includes checked names, complete source rows, edit metadata, missing
inputs and the land and population calculations. It exits unsuccessfully when
the operation is incomplete. `--checks-module` explicitly selects a trusted
local module exporting `loadSettingCheckResources` and `createSettingChecks`.
The module runs with the caller's permissions. The loader receives explicit
`guideFile`, `englishWordsFile`, `englishSourcesFile`, `indexFile`, and optional `wordlistDirs`; the factory receives its
resources and the mutable list of selected names. The guide, English word list, its source manifest, index and explicit word
lists are copied into private snapshots, limited together by `--checks-byte-limit`
(default 268435456) and `--checks-entry-limit` (default 100000 directory entries).
`--checks-work-limit` (default 10000000000000) bounds traversed values, text
length, and a conservative allowance for comparisons and name preparation.
The report identifies each captured input by its original path and SHA-256.
The module is trusted code; its imports and dependency reads are outside these
snapshot and work limits. The index must match the
captured notes. Each selected culture must resolve to one indexed language.
`--seed` and `--name-limit` bound the deterministic name selection; the number
of proposed sites times that limit must fit the authoring work limit.

The default is a dry run. `--write` commits the prepared append-only edit only
when the selected names pass all checks and no inputs are missing. The writer
checks the source capture and preserves existing rows, comments and prose. The
source must remain exclusively edited during commit, as described in
[settlement source edits](settlement-source.md).

## Work budgets

Both work limits are positive safe integers and fail before returning partial
results. They count conservative operation units, not elapsed milliseconds.
`selection.workLimit` is required in the inputs file; `--checks-work-limit`
defaults to 10,000,000,000,000. The byte and directory-entry limits apply
independently. Setting modules remain trusted code, not a sandbox.

For selection assembly, let `G` be graph units (object properties and collection
entries), `T` the captured text length, `R` the local and foreign record count,
`P` the authored placement count and `C` the candidate count. The assembly
allowance is `4 × (G + T + R × (P + C + 1) + C) + M`, where `M` counts
charged membership graph and hierarchy work. One membership corpus serves both
assembly passes and every subordinate polity. Parent comparisons, ancestor
expansion, ownership edges, membership results and hierarchy traversal debit
`M` before expansion. Cached ancestry and the corpus are reused within the
operation; a deep or multiply parented graph can cost more than a flat one.
Repeated references count for each expanded traversal, including appearances
in records, parsed frontmatter and raw-source captures; shared objects are not
deduplicated when charging this traversal. Reusing one array from several records
therefore consumes budget for each appearance. Cycles are refused. For example, `G = 6,137,056`,
`T = 135,720,164`, `R = 19,805`, no authored placements and 100 candidates need
about 575 million units before `M`. A selection budget of one billion leaves
about 425 million units for membership work in that assembly example. Geometry,
grid traversal, footprint and land-rule work also
have to fit their bounds, including 54 units per candidate for the bounded
whole-household search; denser spacing or more selected cells can require a
larger allowance. A limit is not a request to stop after a partial set of sites.

For naming, let `N` be the local record count, `F` the foreign record count,
`Q` the proposal count, `E` the existing row count, and `K` the per-name candidate
limit. With `X = N + F + Q + E + 1`, the preflight reserves
`2 × X² + Q × (X + K + 1)`, then counts the captured graph and text as `U`.
Validation reserves a further `4 × N × U` for descendant-row scans. For example,
11,912 local records and 131,600,718 captured units require about 6.27 trillion
validation units. The ten-trillion default accommodates that bounded example
with room for the preflight allowance, loaded resources and name ranking. It is
not an unlimited corpus allowance: a larger capture or candidate pool must fit
an explicitly chosen safe-integer limit.

Loaded resources are traversed within the remaining naming allowance. For each
proposal, ranking reserves the resource record count plus
`L × (ceil(log2(L + 1)) + 1)`, where `L` is the largest language element pool.
Use the captured record, text and collection sizes to size limits; do not treat
raising a limit as evidence that the selected map or naming data is valid.
