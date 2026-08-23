---
"@heroiclands/package-build": minor
---

**Commands for the Foundry container and the end-to-end harness** (#18).

A package that declares a `compatibility` range is making a promise, and until
now exactly one repository could defend it: container lifecycle, world seeding
and the browser harness all lived in `SoHL/utils/`, so two of three HeroicLands
module repositories declared a range nothing could test.

Two new commands:

```
package-build container <stage> <start|stop|restart|recreate|rm|status|logs|pull>
package-build e2e <seed|run|open|fast|sweep>
```

**Nothing about the destination is restated.** A container mounts
`FOUNDRYVTT_<STAGE>_DATA` — the variable `deploy` already writes into — so
serving what was just deployed is the next step from one variable rather than a
second configuration. Stage ports, the container name, the world id and the GM
credentials all derive from what the repository already declares.

**The end-to-end stage is pinned to `compatibility.minimum`.** The claim and the
evidence for it are now literally the same number, so raising the pin is what it
should be: a decision to raise the supported floor. `FOUNDRYVTT_<STAGE>_VERSION`
still wins for a one-off, and `e2e sweep <build>` runs the full suite against a
build the repository does _not_ pin, so `compatibility.verified` can be evidence.

**The wait is for an active world, not an open port.** Foundry answers on its
port long before a world is serving, and a suite started then fails every spec
for no visible reason. A licence failure — which never recovers — is read out of
the container log and reported at once.

**What the suite _is_ stays the consumer's**, named in `packageBuild.e2e.suite`
the way `assetTransform` and `manifestFlags` are named. So does the seed world's
extra content, in `packageBuild.e2e.documents`. A **module** package additionally
gets `core.moduleConfiguration` seeded, without which its suite would run against
a world that never loaded it.

New configuration, all optional: `packageBuild.container.{image,stages}` and
`packageBuild.e2e.{stage,suite,build,world,gm,documents}`. New subpath exports
`./container` and `./e2e`. Adds `@foundryvtt/foundryvtt-cli` as a dependency —
seeding a world means compiling its LevelDB collections.
