---
"@heroiclands/package-build": patch
---

Adds `package-build changelog check`, which lints a pending changeset or a
`CHANGELOG.md` release section for the marks a pull-request description
leaves behind — a commit hash, an issue reference, a code fence, a
"Verified" paragraph, a byte or test count, an over-long or nested bullet,
a stray heading, or simply too many bullets or lines for one entry — and
refuses to let one merge. The shipped `pre-commit` hook runs it on a staged
changeset automatically.
