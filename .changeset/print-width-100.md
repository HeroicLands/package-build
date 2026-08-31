---
"@heroiclands/package-build": major
---

Raise the shared `printWidth` from 80 to 100.

**Breaking for every consumer**, in the one way this configuration always is: a
repository that updates and runs `lint:format` will find every file reported
until it reformats. Nothing about a built package, an emitted document or a
manifest changes — this is hygiene, and it reaches users not at all.

**80 was inherited, not chosen.** The usual argument for it is reading measure,
and that argument does not apply here: `proseWrap` is left at Prettier's default
of `preserve`, so authored prose is **never reflowed**. Measured across the
content trees, prose lines run to a p90 of 378 characters and a maximum of
5,531, entirely untouched by this number. What `printWidth` actually governs is
TypeScript and the YAML of a note's frontmatter.

**Both were measurably cramped.** Reformatting a third of the SoHL source at
each width:

| width | total lines | vs 80 | lines still over width |
| ----- | ----------- | ----- | ---------------------- |
| 80    | 31,198      | —     | **1,399**              |
| 90    | 30,328      | −2.8% | 193                    |
| 100   | 29,672      | −4.9% | 75                     |
| 120   | 28,850      | −7.5% | 25                     |

The last column is the argument. At 80, Prettier _cannot_ honour the limit on
1,399 lines — long string literals, `@src/…` specifiers, generic signatures — so
those lines are over-width regardless and their surroundings were broken up for
nothing. At 100 that falls to 75.

The same knee appears in content. An item entry written in flow style —
`{ shortcode: X, type: skill, name: …, system: { … } }` — typically lands in the
low 90s, so of 318,030 entries across the two largest trees, 90.8% fit on one
line at 80 and **95.3% at 100**, with almost nothing gained in between. 120 buys
another 0.8 points and is not worth a second reformat.

**This package's own config stops restating the values.** `prettier.config.js`
carried its own copy of all twelve options with a comment saying they were
"matched to" the SoHL repository — already the wrong authority once
`PRETTIER_BASE` existed here, and a copy is a copy: raising the width would have
left the package that _defines_ the shared style as the one repository not
written in it. It now re-exports `PRETTIER_CONFIG`, so there is nothing left to
drift.

This release reformats this repository: 147 files, 2,677 lines shorter.

**Bump**

_Major._ Consumers' `lint:format` fails until they reformat, which is the whole
of the breakage and is a one-command fix.
