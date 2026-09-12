---
"@heroiclands/package-build": patch
---

Unblock releasing. Every run of the release workflow had failed at
`changeset version` with `sh: 1: changeset: not found` since 2026-09-11, so
nothing reached the registry past 20.0.0 while `main` went on believing itself
released.

The workflow upgraded npm to `latest` before publishing, for an OIDC floor of
11.5. `latest` became npm 12, which stopped putting `node_modules/.bin` on the
PATH of a run-script's shell — so a release path nobody had touched broke on the
day npm shipped a major. The upgrade is now bounded to `^11.5`, which is what
the requirement actually asked for, and the version script resolves its binary
through `npx` as the publish script already did.
