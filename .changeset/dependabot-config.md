---
"@heroiclands/package-build": patch
---

Add `.github/dependabot.yml`. This repository had none, so nothing proposed a
dependency update — not npm, not GitHub Actions.

That matters more here than in a consumer: this is the toolchain every other
HeroicLands package builds with, and it is published to npm, so its dependency
tree reaches every consumer's build and everyone who installs it. The
consuming repositories are already covered; this producer was the one link in
the chain nothing watched.

`@foundryvtt/foundryvtt-cli` and `classic-level` are each an ungrouped
single-package entry, ordered ahead of the housekeeping catch-all, for every
update type including minor and patch. Both sit directly on the compendium
pack pipeline, and a version bump that silently changes how a pack compiles is
exactly the failure this repository's byte-level output comparisons exist to
catch — grouping either into a housekeeping pull request would hide which
dependency caused a regression.

No `ignore` entries: nothing here has a known-bad range to record.
`typescript` is a direct dependency, but `build.yml`'s "Declaration emit" step
already gates a breaking bump on every pull request.

Closes #100.
