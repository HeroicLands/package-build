---
"@heroiclands/package-build": patch
---

Finish unblocking the release. Removing the stale `npm install -g npm@latest`
fixed the npm-12 half, but the same change also swapped the version script's
bare `changeset` for `npx changeset`, and that turned the failure into `npm
error could not determine executable to run`.

The npx form was belt-and-braces and it was wrong. `npm run` already puts
`node_modules/.bin` on the PATH — the same mechanism `npm test` uses to reach
`vitest` earlier in the same job — so the bare name resolves the pinned local
copy with no lookup. npx instead consults the registry, which this job
configures for OIDC publishing rather than for reads.

The script is back to the bare binary, and the reasoning is recorded beside it
so the asymmetry with `publish-script` is not mistaken for an oversight again.
