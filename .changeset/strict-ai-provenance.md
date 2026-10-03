---
"@heroiclands/package-build": patch
---

**Asset provenance**: an asset record's `ai` field now answers truthfully whether its file is machine-generated, for both `true` and `false`, and a provenance file stating anything else is refused rather than published as a wrong answer.

**`forbidGeneratedArt`**: a package can declare this to have `lint` refuse any asset it ships whose provenance states `ai: true`.
