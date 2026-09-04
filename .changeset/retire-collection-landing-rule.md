---
"@heroiclands/package-build": major
---

Retire the `collection` landing rule, the `section:` frontmatter key it read,
and the `collection` doc subtype that selected it (#202). A section is landed by
the `README.md` in its directory, and that is now the only rule.

**Why it goes.** Every publishing tree had already migrated: no note in `sohl`,
`sohl-thalorna` or `sohl-kethira-basic` declares `section:` or writes
`subType: collection`, and both publishing consumers configure `landing: readme`.
What was left was not merely unused but **unimplemented on one of the two sides
that must agree**. `engine/content-address.mjs` branched on the configured rule;
`engine/site-build.mjs` never read it — it derives `isReadme` from the basename
and treats a `README.md` as a landing whatever the configuration says. So under
`landing: collection` the link manifest and the emitted site would have disagreed
about where a page is, which is the single failure the shared address function
exists to prevent. With one rule they agree by construction.

**`landing: collection` is refused, not merely unrecognized.** Reported as a bad
value it would read as a misspelling of the rule that survives, and an author
would correct the value rather than learn that the mechanism is gone. The
diagnostic names the key, says the rule is retired, says a section is landed by
its `README.md`, and says the `section:` key went with it — located to the line
and column in `package-build.config.yaml`, as every configuration finding is.

**`section:` is refused the way `draft:`, `package:` and `aliases:` are.** It had
exactly one reader — the retired branch — and no schema or vocabulary declared
it, so nothing checked it: left in place it would be _ignored_, which reads to
its author as though it still works. It is now reported by `content-build lint`
and refused at compile, with the file, line and column.

| Surface                          | Before                                | After                                  |
| -------------------------------- | ------------------------------------- | -------------------------------------- |
| `publish.address.landing`        | `readme` \| `collection`              | `readme` — the value is still accepted |
| `section:` in a note             | read under `collection`, else ignored | refused, at lint and at compile        |
| `subType: collection` on a `doc` | selected the rule                     | not a subtype the format declares      |
| `LANDING_RULES`                  | `["readme", "collection"]`            | `["readme"]`                           |

**Migration.** Delete `landing: collection` from `publish.address` — or write
`landing: readme` — and make each section's landing the `README.md` in its
directory. Delete any `section:` a note still carries. A repository that already
configures `landing: readme` and writes no `section:` needs no change: `lint`,
`links` and `site` were verified byte-identical against `sohl`, `sohl-thalorna`
and `sohl-kethira-basic` at `origin/main`, including all 1,657 pages `sohl`
emits.

**`publish.address.landing` itself survives, for now.** It is the key both
publishing consumers declare, and refusing a correct `landing: readme` would
break them over a statement that is still true. With one rule it selects nothing,
so it is a candidate for deletion once no configuration writes it — the third
step `package:` took (#56), and a separate change.
