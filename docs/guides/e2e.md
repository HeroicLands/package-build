---
shortcode: guidese2e
name: { full: "Test a package in Foundry" }
type: doc
subType: howto
---

# Test a package in Foundry

`package-build e2e` serves a staged package in a disposable Foundry world and
hands control to the repository's browser suite. The harness owns deployment,
world seeding, container lifecycle, and the wait for an active world. The
repository chooses the suite command, build targets, and result files. See the
[e2e command](../commands.md#package-build-e2e-action) and
[configuration reference](../configuration.md#packagebuilde2e) for the full
contract.

## Configure the suite

Declare a headless runner, and optionally an interactive one. The suite
command is an argument array, so each item is one process argument:

```yaml
packageBuild:
  e2e:
    suite:
      run: [npx, cypress, run]
      open: [npx, cypress, open]
    results: [cypress/results]
    build:
      code: { script: build:code, recreate: true }
      packs: build:db
```

Here `build:code` and `build:db` are scripts in the consuming repository's
`package.json`. The `build` mapping is ordered: a `fast` run executes targets
in that order even when they are requested in another order. Mark a target
`recreate: true` when it changes something Foundry reads only when the world
starts, such as the manifest. Configure the runner to write to the paths in
`results`; the example runner writes to `cypress/results`. A zero exit with no
fresh result in those paths is reported as
a failed run; the harness also checks that the runner executable remains
installed through the run.

The optional `world`, `gm`, and `documents` mappings set the disposable
world's identity, GM credentials, and seeded collections. With no override,
the world is named from the package and includes a GM and active scene. A
module package is enabled in that world. The harness does not supply a
Cypress test suite; `suite.run` and `suite.open` name the repository's own.

## Keep local settings in `.env.local`

Create `.env.local` at the repository root with a data directory reserved for
this harness and a Foundry license available to the test container:

```dotenv
FOUNDRYVTT_TEST_DATA=/path/to/isolated-foundry-test-data
FOUNDRYVTT_TEST_LICENSE_KEY=replace-with-test-license-key
FOUNDRYVTT_TEST_PORT=30003
# FOUNDRYVTT_TEST_VERSION=14.367
```

Keep `.env.local` ignored by git; it holds machine-specific paths and real
credentials. `package-build init` creates this basic `.gitignore` skeleton:

```gitignore
node_modules
/build/
/nogit/
/.env*
/.DS_Store
/.claude/
*.tgz
```

`/.env*` covers `.env.local`, `.env`, and other local environment files.
`/build/` keeps generated indexes, packs, site files, and books out of commits;
`/nogit/` reserves local scratch. The CLI reads `.env.local` from the
configured repository root before `.env`. Values already set in the shell take precedence over both files, and
`.env.local` takes precedence over `.env`. A separate git worktree needs its
own `.env.local` because that ignored file is not copied with the branch.
The test data path is a Foundry data root, beneath which the harness creates
`Data/worlds/` and installs the package. Use an absolute path; `~` and shell
variables are not expanded in `.env.local`. Set `FOUNDRYVTT_TEST_VERSION` to
select a specific Foundry build for routine runs. With the local settings in
place, seed the world:

```bash
package-build e2e seed
```

The seed command writes the disposable world beneath that data root. It
replaces the seeded world with the same ID each time. The harness refuses a
root shared with another Foundry stage, so test seeding cannot overwrite a
development or production world.

## Run the whole suite

Build the staged package first, then use one of the full-run modes:

```bash
package-build e2e run
package-build e2e open
```

`run` deploys the stage, reseeds the world, recreates the container, waits for
the world to become active, runs the headless suite, and stops the container.
`open` uses the same setup and launches `suite.open`; it leaves the server up
for interactive testing. Arguments after `--` are passed to the suite, for
example `package-build e2e run -- --browser chrome`. A port answering is not
enough: the harness waits until Foundry's join page shows the world is active.

## Iterate without reseeding

`fast` rebuilds declared targets, redeploys the full stage, cycles the world,
waits for it, and runs the headless suite:

```bash
package-build e2e fast
package-build e2e fast --build=packs -- --spec cypress/e2e/items.cy.js
package-build e2e fast --build=none --no-run
```

`--build=` takes declared target names, a comma-separated subset, `all`, or
`none`. `--no-run` updates the environment without launching the suite.
`--recreate` forces a fresh container even when the selected targets do not
require it. This mode keeps the existing seeded world's Foundry generation;
use a full run when changing the Foundry build.

## Verify another Foundry build

Name an exact Foundry build for a compatibility sweep:

```bash
package-build e2e sweep 14.367
```

The sweep runs the full reseeded suite with that build for this invocation
only. It does not change the repository's compatibility declaration. A bare
major version or moving tag is refused, because the result must name the
build actually tested. A passing sweep provides evidence for choosing a
new `compatibility.verified` value; a routine run exercises the pinned
minimum build.
