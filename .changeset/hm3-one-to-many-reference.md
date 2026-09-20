---
"@heroiclands/package-build": patch
---

**A module embedding HârnMaster 3 weapons compiles.** A being's `(type,
shortcode)` reference into HM3's one-to-many `weapongear` row resolves when
its `type` names one of the row's own subtypes — `weapongear` or
`missilegear` — instead of being refused as ambiguous.
