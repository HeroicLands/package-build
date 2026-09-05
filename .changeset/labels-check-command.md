---
"@heroiclands/package-build": minor
---

**New: `package-build labels check`.** The issue-label registry has two faces
that must agree — `.github/labels.yml`, which is synced to GitHub, and the §3
table in `.github/ISSUE_REPORTING.md`, which is what a person reads. Neither
derives from the other, so either can drift, and nothing notices until an issue
is filed against a label that does not exist or the sync pushes one the
documentation never mentions.

It arrives here because **every repository wants it and only the paths ever
differed** — it was a `utils/check-labels.mjs` copied per repository, which is
the shape a shared check takes just before its copies start disagreeing. Same
argument that moved the no-attribution check to a shared action.

Two things improve in the move:

- **Findings are compiler-parseable and located.** The original printed prose
  to stderr; this reports `.github/labels.yml:73:9: error: …` against the file
  each finding belongs to, so a missing row is located in the documentation and
  a missing entry in the registry.
- **The documentation path is an option.** `--doc` defaults to
  `.github/ISSUE_REPORTING.md`; `Song-of-Heroic-Lands-FoundryVTT` keeps its at
  `kb/dev-docs/how-to/issue-reporting.md` and now needs no separate script.
  `--registry` likewise.

A missing §3 is reported once, as its own failure, rather than as every label
having drifted. An over-long description is caught here too — GitHub answers a
bare 422 naming neither the label nor the limit.

**A label name may contain spaces**, and two GitHub defaults do — `good first
issue` and `help wanted`. The script this replaces matched a kebab-case charset,
so it skipped those rows silently and would have reported both labels as
undocumented: a false finding, pointing at the wrong file. The name is read as
written now, with the backticks and the first-cell anchor doing the narrowing.

Verified against every repository that has a registry — `sohl-thalorna` (12),
`sohl-kethira-basic` (11), `harn-adventures` (11), `harn-ensemble` (12),
`Song-of-Heroic-Lands-FoundryVTT` (16) and `HarnMaster-3-FoundryVTT` (14) — all
six agree. Three of them had never had the check run at all.
