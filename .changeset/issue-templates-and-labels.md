---
---

**Repository meta only — no release.** This repository now carries the standard
HeroicLands issue templates, the label registry, and the issue-reporting
standard, in the shape `heroiclands-emacs` settled on: `.github/ISSUE_TEMPLATE/`
for the five types plus the routing `config.yml`, `.github/labels.yml` as the
closed registry, `.github/ISSUE_REPORTING.md` as its documented §3 counterpart,
and a `labels-sync.yml` that reconciles GitHub to the registry through the
org-wide action.

It also wires `package-build labels check` into this repository's own `lint`
chain. The command has shipped since the label module moved here, and every
consumer runs it against its own registry — but the repository that publishes it
had no registry to run it against, so the check was the only lint here that
nothing exercised.

Nothing a consumer installs changes, so this ships no version.
