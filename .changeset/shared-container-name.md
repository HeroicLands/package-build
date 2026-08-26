---
"@heroiclands/package-build": minor
---

Let packages share one Foundry container, and so one signed licence.

The container name was derived from the package id, and `--hostname` set to
match. The hostname part is right — Foundry binds a signed licence to it, and a
stable one is exactly what makes the signature survive a `recreate`. What was
wrong is that the value could not be shared: `sohl` got `sohl-foundry-test` and
`hm3` got `hm3-foundry-test`, so a `Config/license.json` signed for the first
would not verify for the second, and one maintainer with one dev licence needed
one per package.

Neither fallback rescues it. Passing `FOUNDRYVTT_<STAGE>_LICENSE_KEY` makes the
felddy image write the key **unsigned**, and Foundry v13+ refuses to start with
`Software license requires signature`; omitting it makes the image fetch a key
from the account, unsigned, same refusal. Signing is a one-time interactive step
per host, so a second package's container could not come up without a second
licence — or a re-signing that then broke the first.

The rest of the shared-instance model already worked. `requireIsolatedDataRoot`
refuses only the dev/qa/prod roots, so a shared **test** root was already
allowed, and `resolveE2EWorld` already derives a distinct world id per package,
so one data root already holds both systems and both worlds with `FOUNDRY_WORLD`
choosing which launches. The container identity was the last package-scoped
piece.

So `packageBuild.container.name` declares it:

```yaml
packageBuild:
  container:
    # Shared with the other HeroicLands packages so one signed Foundry
    # licence covers them all.
    name: heroiclands-foundry
```

The stage is still appended — this declares `heroiclands-foundry-test`, not
`heroiclands-foundry`. Sharing is meant to cross packages, not stages: two
stages are two containers over two data roots, and docker names are unique, so a
name used whole would have `container dev` find the `test` container already
there, start it, and serve the test data root on the dev port. Nothing is
declared by default, and the name stays `<packageId>-foundry-<stage>`.
