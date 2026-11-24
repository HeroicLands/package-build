---
shortcode: referenceazgaarmapinput
type: doc
name: { full: "Azgaar map input" }
texinfo:
  parent: homepage-root
  after: [referenceformatdetails]
---

# Azgaar map input

`readAzgaarMap` in `engine/azgaar-map.mjs` reads an Azgaar 1.156.0 **Full JSON** export and the `.map` file it came from. It is an internal authoring input; ordinary builds do not call it. The input supplies the bytes and file names, SHA-256 hashes of both files, version, map identity, seed, dimensions and units as a `pin`. It also supplies an explicit state ID and polity Address and a culture Address for each non-neutral culture in the selected state. It does not match names to notes.

The adapter checks the pinned hashes and compares the saved map header, settings and export metadata. A matching map identity and seed do not prove that two files were saved from the same editing state; export the JSON from the saved map and record their provenance together. The pinned version's [exporter](https://github.com/Azgaar/Fantasy-Map-Generator/blob/67d555b/src/services/io/export-json.ts) defines the Full JSON shape. Its [saver](https://github.com/Azgaar/Fantasy-Map-Generator/blob/67d555b/src/services/io/save.ts) defines the `.map` header.

Each selected packed cell includes its center, boundary, neighbors, map records and route links. Temperature and precipitation come from its `g` grid-cell reference, not from the packed ID. `area` is the raw cell area multiplied by distance scale squared; `rawArea` and the pinned units are retained. Rural population points use the population rate, and burg population points also use the urbanization rate. A burg with no recorded population has an unknown urban population. These map populations are defaults, not household counts or a survey. Map features and routes do not establish land yield, food balance, holders or descriptive facts.

The adapter rejects absent or removed selected states, broken referenced records and unmapped non-neutral cultures. Its result preserves map-provided biome, feature, river, province and burg records. It does not infer package identities for them. A real export and its mapping are needed to assess compatibility and calibrate a settlement model.

The geometry coordinates and raw area use map coordinate units and their square. `area` is in the square of the pinned distance unit. `temperatureCelsius` is the stored Celsius value, even when the display preference is Fahrenheit; `precipitation100mm` counts units of 100 mm. `elevationScale` is the generator's nonlinear 0–100 height scale, not feet or meters. The height and temperature settings are display preferences, retained in `units`. A burg's culture is mapped separately from its cell's culture; `burgCultureId` retains zero for neutral and null when absent.

The adapter accepts at most 64 MiB of saved map data and 256 MiB of Full JSON, with at most one million entries in each indexed collection and route geometry or cell boundary. The optional `limits` input can reduce these bounds. The adapter reads only the header and settings records of the saved map after checking its size and hash.
