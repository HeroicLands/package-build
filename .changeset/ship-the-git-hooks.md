---
"@heroiclands/package-build": minor
---

**The git hooks ship here now**, and with them a pre-push check that runs a
repository's own Build & Test workflow in a container before the push leaves.

**Why here.** Five repositories carried `.githooks/` with `commit-msg`,
`pre-commit`, `pre-merge-commit` and `protected-branch.sh` — **twenty copies of
four byte-identical files**, each free to drift. The `.github` repository cannot
help: its `actions/*` are fetched by the GitHub _runner_ through `uses:`, and
nothing on a developer's machine fetches from it. This package is what every
repository already installs, so it is the only thing that reaches every
checkout.

A consumer points git at the packaged directory once:

```json
"prepare": "git config core.hooksPath node_modules/@heroiclands/package-build/githooks"
```

and then carries no hook files at all.

**The new hook, and it is off unless you ask for it.** `pre-push` runs the
steps of the repository's own `.github/workflows/build.yml` and refuses the push
if they fail — but only where someone has opted in:

```bash
git config hooks.prePushCi true            # this clone, and every worktree of it
git config --global hooks.prePushCi true   # every repository on this machine
```

Off, it is silent and instant. That is deliberate: the check costs a couple of
minutes and ships to every repository installing this package, so it must not
be something a contributor discovers by having their push get slow.

Four decisions worth knowing:

- **The steps are read, not restated.** `ci/ci-steps.mjs` parses them from the
  workflow, so there is no second copy of the command list to go stale — which
  matters because a stale copy fails _silently_: running four of five steps
  still exits 0. It refuses loudly when it recognises no steps or finds no
  workflow, and names the `uses:` steps it cannot run. It parses rather than
  importing a YAML library because the first step it must run is `npm ci`, so
  anything from `node_modules` is missing exactly when it is needed.
- **In a container, over `git archive HEAD`.** Timing decides this: the workflow
  begins with `npm ci`, so a host run costs about what the container costs
  (134s cold, measured) and pays it by deleting the working tree's
  `node_modules` each time. The container touches nothing of yours and tests
  only committed content, as GitHub does — closing a dirty environment and a
  case-sensitive filesystem, neither of which a Mac can catch.
- **`linux/amd64` by default**, matching the runner. Measured on Apple silicon
  with Docker Desktop's Rosetta translation: JS compute 1104/1071/1078 ms native
  against 1098/1062/1093 ms emulated, and `npm ci` 23s either way —
  indistinguishable, so matching the runner is free. `--native` opts out, for a
  machine where that translation is unavailable.

- **Docker is not required, even when enabled.** Without it the check reports
  that it could not run, says so loudly, and **lets the push through**. The
  workflow is what enforces this; the hook only saves a round trip, so someone
  without Docker — or without this package installed — must still be able to
  open a pull request. Only a genuine check _failure_ refuses a push.

`git push --no-verify` skips it once. A branch delete pushes no commits, so the
hook stands aside. First enabled run pulls the image (~400MB), once.
