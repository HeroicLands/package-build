---
"@heroiclands/package-build": patch
---

**Content and notes**

- Polity inventories belong in `data.settlements`. Declare `data.territorial_population` for a polity with settlements, a seat, or subordinate polities, and list at most one superior in `data.parents`.
- Give each settlement note short `data.notes`. A populated settlement note requires a declared `data.market` label such as `local`.
- Settlement references accept typed address forms with section anchors, and completeness errors explain how to supply missing settlements or record an owner exception.
