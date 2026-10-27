---
"@heroiclands/package-build": minor
---

**Builds and commands**

- `changelog check` now refuses a changeset that is not labelled blocks of bullets: a lead paragraph, an unlabelled bullet, prose between blocks and a label that is not declared are errors.
- A label must be in `labels` or be `Miscellaneous`, which every repository has and never declares; with no list declared, only `Miscellaneous` is accepted.
- `changelog check --release` holds a Version Packages section to the same shape.
- `changelog group` removes the `### … Changes` headings, merges blocks that share a label, orders them as `labels` declares and lists `Miscellaneous` last.

**Upgrading**

- Declare `labels` in the changelog options of `.changeset/config.json`, and rewrite pending changesets as labelled blocks of bullets before upgrading.
