---
"@heroiclands/package-build": patch
---

Drop history, issue references and hand-counted values from the comments and
the shipped documentation.

A comment citing the issue it came from tells a reader nothing they can act on,
and a rule explained by narrating the shape it replaced buries what is true now.
Both are removed throughout `engine/`, `sohl/`, `hm3/`, `bin/`, `ci/`, the test
suites and the reference docs; the reasoning survives, stated in the present
tense.

`MIGRATING.md` is deleted and drops out of the published `files`. It carried
upgrade instructions for 15.0.0 down to 3.0.0, and no consumer is below 18.

`CHANGELOG.md` and `CHANGELOG-content-build.md` are untouched — history belongs
in them.

No behavior changes.
