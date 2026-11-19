<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Settlement input assembly

`prepareSettlementInputs` assembles inputs for on-demand settlement calculations from one captured content session. It selects one local polity by its fully qualified Address, joins each parsed frontmatter capture to the raw bytes captured at the same path, and retains the polity's existing settlement rows in order. The returned source capture is an internal input to the settlement source editor. Assembly does not change source files or register a content build hook.

The session's local and dependency index records supply directly subordinate polities, noted settlements, and their household and population facts. The writable polity and source capture are local. The membership resolver follows declared parent, government, and seat Addresses. Unresolved references produce located missing-input records. Household counts take precedence over populations, including zero and explicit unknown values. A settlement note's indexed culture and its declared household size take precedence over the map's culture. When that culture's size is unavailable, the input remains missing rather than using the map's size. A map estimate or a setting cannot replace a stated count. The map supplies geography and mapped culture identities; it does not establish source-note relationships by name.

## Inputs

Pass `{session, polityAddress, map, bindings, settings}`. The map is the normalized result of the pinned Azgaar adapter. Each selected cell must carry the selected polity Address. The `bindings` object contains explicit associations:

- `notes`: entries with a settlement `address` and map `source` for each directly governed or seated settlement note.
- `rows`: optional entries with a zero-based `index` and map `source` for rows without an authored `generatorSource`. A binding for a row with a source must agree with it.
- `subpolities`: entries with a subordinate polity `address` and its `cellIds`.

Addresses in bindings are fully qualified. A source has the adapter's `mapId`, `kind`, `id`, and, for a cell, optional `slot`. An omitted cell slot means zero; a burg has no slot. Each existing fact has a distinct source identity across both rural and urban settlements. A row index identifies a row in this captured prefix; it does not identify a new settlement across source edits.

`settings.urbanShares` maps polity Addresses to an explicit share from zero to one. An omitted polity share uses `settings.model.urbanShare`, or the editable model default when no model is supplied. An explicit zero is retained; a null or invalid share is reported. The share and the indexed territorial population produce the urban and rural totals. A stated zero total needs no default share. The totals of subordinate polities are included in the selected polity's total and reserved by the calculations. An unknown territorial population remains unknown.

`settings.placements` and `settings.landRules` supply the accepted rural calculator's explicit placements, acreages and land profiles. `settings.urban.sources` and `settings.urban.routes` supply the urban calculator's declared food sources and routes. `settings.urban.cities` supplies an `identity` and `localFood` for each bound urban settlement. City identity is its note Address or `row:<index>` for a listed row. `settings.model` optionally supplies the editable model figures. The assembly reads household counts, population, culture size and settlement type from content; extra copies of those facts in settings do not replace them.

A placement may omit `source` when it represents a new settlement in its declared `cellId`. The assembler reserves all existing identities and all explicitly sourced placements, then assigns each new placement the lowest available cell slot in input order. Explicit identities stay unchanged; an omitted cell slot and slot zero identify the same place. A placement naming an existing `noteAddress` uses that note's bound source when it omits `source`. Missing or conflicting bindings are reported. The caller supplies placements for existing settlements explicitly and supplies source-free placements only for additional settlements; the assembler does not infer correspondence from a name or determine how many settlements a cell needs. A fresh invocation reads saved identities again, so discovery must account for them when selecting additional placements.

## Results and missing inputs

The result contains `polity`, `sourceCapture`, `existingRows`, `existingFacts`, `cultureSizes`, `subpolities`, `resolvedPlacements`, `ruralInput`, `urbanInput`, and `missing`. `resolvedPlacements` contains the supplied placements with their assigned sources when the bindings are valid. A calculator input is present only when its prerequisites pass the corresponding calculator. `missing` entries carry a `file`, `field`, and `message`; a source field also carries a line and column when its captured YAML provides a position. The calculator results retain unallocated population and unmet food; callers inspect those results as well as `missing`.

Placement discovery and naming are distinct stages. The assembler records both stages as incomplete, including when explicit placements are available for calculation. Even when the calculation inputs are complete, their proposals are not complete source rows. The source editor accepts only complete, reviewed rows that preserve the existing prefix. It is not invoked by this assembler.
