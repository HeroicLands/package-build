---
"@heroiclands/package-build": patch
---

**A module embedding HM3 spells, invocations or psionics compiles.** A being's
embedded `spell`, `invocation` or `psionic` reference that names no shortcode
template and no `data.icon` of its own now takes that subtype's own default
art — the icon HM3 itself assigns a freshly created item of that kind —
instead of the build refusing the actor outright.
