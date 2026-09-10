---
"@heroiclands/package-build": patch
---

**A `model:` now resolves an item whose shortcode carries a capital** (#346). The
catalogue was keyed on the compiled document's `system.shortcode` exactly, while
an address is lower-cased when it is read — so `model: weapongear-clb` looked for
`weapongear:clb` while the document sat under `weapongear:Clb`, and every being
referencing one of the six mixed-case gear shortcodes in `sohl` failed to
compile.

The catalogue key folds the shortcode's case. The **id-bearing** address does
not: `itemAddress` seeds `embeddedItemId`, so folding there would change the
`_id` of every embedded item whose identity carries a capital — silently
re-identifying documents nothing about which had changed. A catalogue is a lookup
table; an id is a promise.

Verified by compiling both swept trees: `sohl` emits actors, items, macros,
scenes and adventures byte-identical to its pre-sweep baseline, and
`sohl-thalorna` differs only by the 938 embedded ids its sweep predicts.
