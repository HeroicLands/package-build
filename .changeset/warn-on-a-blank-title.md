---
"@heroiclands/package-build": minor
---

**`title: ""` is now a warning** (#218).

The two art fields follow a rule — `null` falls back, `""` is blank on purpose —
and `title` was kept off it because the top-level key simultaneously fed an
affiliation's `system.title`, so `title: null` compiled the literal `"null"`.
That collision is gone: the field declares `topLevelMeans`, and the two spellings
no longer meet.

What is left is the page heading. The emitter is `fm.title ?? name`, so `""`
survives, the page publishes with no heading, and it sorts to the front of its
section landing ahead of every named page. Fifteen notes in `sohl-thalorna` are
in exactly that state.

A _warning_ rather than an error: the value is legal under the rule, and a page
that genuinely wants no heading may keep it — it just has to mean it.
