---
"@heroiclands/package-build": minor
---

`contentPackage` is validated as an address segment, and `readCanonicalKey` counts segments explicitly.

A canonical address (`sohl-skill-clmb`) is read by counting hyphen-separated segments, which is sound only while the hyphen is _purely_ a separator — no segment may contain one. #59 names three charset guarantees behind that and asks for each to be **enforced rather than assumed**. Shortcodes already were; `contentPackage` was not, and its absence had a live cost: `harn-adventures` produced four-segment keys that failed as a `null` return rather than as an error saying what was wrong.

**`contentPackage` is now checked twice.** It must be alphanumeric (`^[A-Za-z0-9]+$`), and it must not equal a note type — `doc`, `being`, the map types, and every declared item type with its `doc`-prefixed documentation form. A violation is a build error in the usual `file:line:column: severity: message` form, naming the key's own line in the configuration file (#95). Every package in use today passes: `sohl`, `hm3`, `thalorna`, `kethira`, `harnensemble`, `harnadventures`.

**The shortcode rule and the package rule are one constant.** `SHORTCODE_PATTERN` now _is_ `ADDRESS_SEGMENT_PATTERN`, from the new `engine/address-charset.mjs` leaf, rather than a second copy of the same regex free to drift from it.

**`readCanonicalKey` states its premise instead of assuming it.** It counts against a named `CANONICAL_KEY_SEGMENTS`, and its documentation says the charset rule is what makes counting sound — rather than restating "nothing contains a hyphen" as a fact about the data that nothing checked. It also distinguishes its two failures: a string that cannot be a key still yields `null`, while an absent or blank input yields `undefined`. Both are falsy and all four call sites test only for truthiness, so no behaviour changes.

Deliberately **not** in this change, because they depend on decisions still open in #59: the system segment, `none`, the manifest format-version bump, partial-address resolution, and the single-hit rule. The key format is unchanged — three segments, `<package>-<type>-<shortcode>`.

Part of #127. Part of #59.
