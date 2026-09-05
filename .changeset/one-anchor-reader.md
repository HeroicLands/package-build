---
"@heroiclands/package-build": patch
---

**One reader for a note's anchors.** `engine/content-links.mjs` kept its own,
and it disagreed with the content index's: it matched `{#([a-z0-9-]+)}` where
`collectAnchors` matches `{#([^}]+)}`. So an anchor with a capital in it —
`{#CalendarFormat}`, three of them in `sohl`'s own content — existed for the
index and for the compilers, and did not exist for the check of them.

Nothing links to one today, so the disagreement was latent. The first link to
one would have been reported dead against a heading plainly present in the
file, which is the worst shape a finding can take.

The specification puts no charset on the id — "`#id` represents an id anchor
named `id`" — so the narrower pattern was this module's invention rather than a
rule it was enforcing. That is the argument for one reader rather than a
well-chosen one, and the first thing #243 asks for: the corpus and everything
derived from it answered in one place.
