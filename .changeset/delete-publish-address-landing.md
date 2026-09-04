---
"@heroiclands/package-build": major
---

**`publish.address.landing` is deleted.** `prefix` is the whole address scheme:

```yaml
publish:
  address:
    prefix: kb/ # default: "" — the package root
```

The key named which note addressed a whole section rather than a page within
one. #202 retired the second of its two rules and #204 retired the concept both
rules chose between — a section is a Hugo content directory the note format does
not carry, a page's address names no directory, and so no note lands one. What
survived was the key itself: resolved, refused-by-name for the retired value,
checked against a one-element vocabulary, frozen into the configuration, and
read by nobody. `LANDING_RULES` said so in its own doc comment — _"Inert since
#204."_

**A configuration still declaring it is refused, at the line it is written on.**
Not reported as an unrecognized option, which names a spelling to correct and
leaves the author to work out that the mechanism is gone:

```text
package-build.config.yaml:14:9: error: package-build config:
`publish.address.landing` is a retired option — delete it. It named which note
addressed a whole section rather than a page within one, and there are no
sections to address: a section is a Hugo content directory the note format does
not carry, so no note lands one and every page is addressed
`<type>-<shortcode>`. Nothing replaces it.
```

Presence is the whole test, as it is for a retired frontmatter field: no value
makes declaring it right, so `readme` and the already-retired `collection` are
refused alike, by `RETIRED_ADDRESS_KEYS` — the configuration-side twin of
`engine/retired-fields.mjs`.

**Why the key outlived its mechanism by one release.** `content-config.mjs` has
no warning channel — every finding goes through `fail()`, which throws — so
while both publishing consumers still declared the then-true `landing: readme`
the only options were to break them over a correct statement or to accept the
key in silence, and silent acceptance is what this codebase refuses everywhere
else. So it took the three steps `package:` took (#56): retire the value, have
consumers drop the key, delete the key. No consumer declares it now.

**The plumbing goes with it.** `packageAddress` took an address scheme only to
validate the `landing` rule it then discarded — its own docstring already said
the `prefix` half never applied, because an address is `(type, shortcode)`, a
package-wide identity that takes no mount. It is now a function of the
frontmatter and nothing else, and `manifestContext` no longer carries a `scheme`
that nothing reads.

| Removed                                                                                                                              | Where                        |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| `LANDING_RULES`, `RETIRED_LANDING_RULES`                                                                                             | `content-config.mjs`         |
| `DEFAULT_ADDRESS_SCHEME.landing`, `ADDRESS_KEYS`' second entry, `normalizePublish`'s resolve-and-check, `AddressSchemeInput.landing` | `content-config.mjs`         |
| The `LANDING_RULES` re-export, `packageAddress`'s `{ scheme }` parameter and its landing check                                       | `engine/content-address.mjs` |
| `manifestContext`'s `scheme`, and the argument `collectManifestEntries` passed on with it                                            | `engine/manifest-emit.mjs`   |

**Nothing a consumer emits moves.** Verified against pristine
`git archive origin/main` extractions of all three consumers, before and after:
`lint`, `links`, `manifest`, `package compile` and `site` produce **identical
console output, line for line**, and every emitted file is byte-identical —
31,197 files across the three trees, with only LevelDB's own timestamped `LOG`
differing. `sohl` stays green (2,988 manifest entries, 3,125 pack documents,
1,671 emitted pages); `sohl-thalorna` stays exactly as red as it was for its own
content gap (1,983 lint findings, 122 link findings); `sohl-kethira-basic` stays
green.

Closes #215
