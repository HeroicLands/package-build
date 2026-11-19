<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Settlement input assembly

`prepareSettlementInputs` assembles inputs for on-demand settlement calculations from one captured content session. It selects one local polity by its fully qualified Address, joins each parsed frontmatter capture to the raw bytes captured at the same path, and retains the polity's existing settlement rows in order. The returned source capture is an internal input to the settlement source editor. Assembly does not change source files or register a content build hook.

The session's indexed records supply the polity, its directly subordinate polities, its noted settlements, settlement household and population facts, and culture household sizes. The membership resolver follows declared parent, government, and seat Addresses. Unresolved references produce located missing-input records. Household counts take precedence over populations, including zero and explicit unknown values. A map estimate or a setting cannot replace a stated count. The map supplies geography and mapped culture identities; it does not establish source-note relationships by name.

## Inputs

Pass `{session, polityAddress, map, bindings, settings}`. The map is the normalized result of the pinned Azgaar adapter. Each selected cell must carry the selected polity Address. The `bindings` object contains explicit associations:

- `notes`: entries with a settlement `address` and map `source` for each directly governed or seated settlement note.
- `rows`: optional entries with a zero-based `index` and map `source` for rows without an authored `generatorSource`. A binding for a row with a source must agree with it.
- `subpolities`: entries with a subordinate polity `address` and its `cellIds`.

Addresses in bindings are fully qualified. A source has the adapter's `mapId`, `kind`, `id`, and, for a cell, optional `slot`. A row index identifies a row in this captured prefix; it does not identify a new settlement across source edits.

`settings.urbanShares` maps polity Addresses to an explicit share from zero to one. The share and the indexed territorial population produce the urban and rural totals. A stated zero total needs no share. The totals of subordinate polities are included in the selected polity's total and reserved by the calculations. An unknown territorial population remains unknown.

`settings.placements` and `settings.landRules` supply the accepted rural calculator's explicit placements, acreages and land profiles. `settings.urban.sources` and `settings.urban.routes` supply the urban calculator's declared food sources and routes. `settings.urban.cities` supplies an `identity` and `localFood` for each bound urban settlement. City identity is its note Address or `row:<index>` for a listed row. `settings.model` optionally supplies the editable model figures. The assembly reads household counts, population, culture size and settlement type from content; extra copies of those facts in settings do not replace them.

## Results and missing inputs

The result contains `polity`, `sourceCapture`, `existingRows`, `existingFacts`, `cultureSizes`, `subpolities`, `ruralInput`, `urbanInput`, and `missing`. A calculator input is present only when its prerequisites pass the corresponding calculator. `missing` entries carry a `file`, `field`, and `message`; a source field also carries a line and column when its captured YAML provides a position. The calculator results retain unallocated population and unmet food; callers inspect those results as well as `missing`.

Placement discovery and naming are distinct stages. The assembler records both stages as incomplete, including when explicit placements are available for calculation. Even when the calculation inputs are complete, their proposals are not complete source rows. The source editor accepts only complete, reviewed rows that preserve the existing prefix. It is not invoked by this assembler.
