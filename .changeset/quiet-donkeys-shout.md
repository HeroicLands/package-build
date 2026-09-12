---
"@heroiclands/package-build": patch
---

Release again. Since 2026-09-11 every run of the release workflow had died at
`changeset version` with `sh: 1: changeset: not found`, so nothing reached the
registry past 20.0.0.

The workflow set `version-script`, which replaces the action's own invocation of
the changesets CLI with a shell command run through its exec — and under that
exec a bare `changeset` does not resolve on a runner. Left unset, the action
resolves the installed package with `require.resolve` and runs it with `node`,
depending on no PATH at all. The override is removed.

The fault was never in this repository's install. A diagnostic run confirmed
that after `npm ci` a runner has the package, has the bin linked, puts
`node_modules/.bin` first on a run-script's PATH, and resolves the bare name
through `npm run` — all in the same job that then failed.

The one thing the override bought, refreshing `package-lock.json`'s root
`version`, is now #385 rather than a reason to keep a step that does not run.
