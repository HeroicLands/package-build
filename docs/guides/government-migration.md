---
shortcode: governmentmigration
name: { full: "Migrating place governments" }
type: doc
subType: howto
---

# Migrating place governments

A place's `data.government` is the sole declaration of government. Name one governing affiliation, or write explicit `null` for complete anarchy. Omission means unknown. The website derives `governed_by` on a place and `governed_places` on its governing affiliation from resolved references across local and fetched indexes. Neither containment nor organizational parents supplies a government.

```yaml
type: place
data:
  government: temple
```

A temple can be a government when it actually governs the place; so can a company, house or polity. Naming land in an old affiliation `data.domains` list never makes that body a government automatically. When old lists overlap, choose the one body that actually governs each place. Do not choose from subtype or list order. Leave government absent if the answer is unknown; do not write null merely to silence a warning.

## Legacy input and output changes

Legacy affiliation `data.domains` is temporarily accepted without a finding so existing trees can migrate. It is ignored: it no longer creates affiliation Domains infobox rows, metadata-index `domains`, SoHL `system.domain`, or website `held_by` and `holdings`. New notes should omit it. There is no new authored holdings or tenure field. Preserve distinct ownership, subordinate tenure, property rights or influence in the note's prose, with links where useful, before deleting the old list.

The tenure-based `over-held land` population advisory is retired. Geographical `contains` and the remaining population checks continue to use place parents unchanged. Explicit null remains null in published metadata and displays Complete anarchy; omission stays absent. Neither appears in a governing body's reverse list.

## Inventory behind the migration

The baseline at commit `ada039d` contains 15 production files, six documentation files and nine test files mentioning `domains`, `held_by` or `holdings` (137, 70 and 99 occurrences respectively). Domains alone appears in 20 files across 127 matching lines. The active consumers are author declarations/schema and infoboxes, metadata indexes, SoHL `system.domain`, direct and reverse website tenure lists, site previews and the polity population advisory. Public holdings APIs and generated reference documentation describe these outputs.

The migrated Thalorna baseline has 3,171 notes: 637 places, of which 191 declare government, 446 omit it and none declare null. Its 133 affiliations still carry 196 legacy domains claims covering 191 distinct places: 125 polities account for 184 claims, seven faith traditions for 11 and one order for one. Two places have overlapping claims (`pssshrines`: two; `aukhelathrgq`: five). These are reasons to review actual governance rather than infer it from legacy claims.

Those consumers combined governance with independently meaningful direct tenure: houses holding manors, temples and companies claiming property, overlapping provincial and imperial claims. This migration deliberately replaces structured tenure displays with government derived from places, rather than converting every old claim into government. Independent historical facts remain supported in prose. Acceptance of legacy input is transitional; enforced removal will require separate author guidance.
