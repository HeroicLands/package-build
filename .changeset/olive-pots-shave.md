---
"@heroiclands/package-build": patch
---

Unblock releasing. Every run of the release workflow had failed at
`changeset version` with `sh: 1: changeset: not found` since 2026-09-11, so
nothing reached the registry past 20.0.0 while `main` went on believing itself
released.

The workflow installed `npm@latest` before publishing, to clear an OIDC floor of
11.5. That was written when Node 24.0–24.4 bundled npm 11.3–11.4; since 24.5 the
bundled npm has cleared the floor on its own, and the step became a no-op that
nobody removed. On 2026-09-11 `latest` became npm 12, which stopped putting
`node_modules/.bin` on the PATH of a run-script's shell, and a release path
nobody had touched broke.

The install is gone rather than pinned: the npm that publishes is now the one
Node brings, so its version follows `node-version` instead of a number kept in
step by hand. A check in its place asserts the floor and fails loudly if a
future Node pin ever drops below it — an assertion cannot go quietly stale the
way the comment it replaces did. The version script also resolves its binary
through `npx`, as the publish script already did.
