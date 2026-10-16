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
FOUNDRYVTT_CACHE=/path/to/foundry-release-cache
FOUNDRY_USERNAME=your-foundryvtt-com-account
FOUNDRY_PASSWORD=replace-with-account-password
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
select a specific Foundry build for routine runs; the container then runs the
image made for that build. The first run downloads the release, which needs
`FOUNDRY_USERNAME` and `FOUNDRY_PASSWORD`, and the image keeps the archive in
`FOUNDRYVTT_CACHE`, or in `container_cache` beneath the data root when that is
unset. Once the archive is cached and the stage has a licence, later runs
start without signing in to foundryvtt.com, so its rate limit never stops a
run. A key alone does not sign the licence. The image applies
`FOUNDRYVTT_TEST_LICENSE_KEY` and nothing more; the signature comes from
accepting the licence agreement in Foundry's own page, once per data root, and
then persists in `Config/license.json` there. On a fresh data root, start the
stage with no world (`package-build container test start`), open it in a
browser and accept the agreement. A run against an unsigned licence fails at
once saying so, naming the data root, instead of waiting for a world that never
activates. Under rootless Docker, set
`FOUNDRYVTT_CONTAINER_USER=0:0`: container root is then the host user, so every
file under the data root belongs to them, where the image would otherwise run
Foundry as user 1000. With the local settings in place, seed the world:

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

## Choose a browser

For a Cypress suite, `e2e fast`, `e2e run` and `e2e open` use pinned
Chrome for Testing **155.0.8059.84** on macOS arm64 and Linux x64. The first run
downloads it; later runs reuse the cached executable. Each run prints the
resolved browser and version, and Cypress reports the browser in its header.
Other suite commands run as declared.

An explicit `--browser` in the configured suite or its extra arguments wins,
including `--browser=electron`. For example:

```bash
package-build e2e fast -- --browser electron
package-build e2e run -- --browser /path/to/chrome
package-build e2e open -- --browser=chrome
```

A platform without a configured build requires an explicit installed browser.
The automatic download needs network access on first use. The cache location is,
in order: `HL_BROWSER_CACHE`, `browser-cache` beside `FOUNDRYVTT_CACHE`,
`HL_E2E_ROOT/browser-cache`, or `heroiclands/chrome-for-testing` under the user's
cache directory (`XDG_CACHE_HOME`, macOS `~/Library/Caches`, otherwise
`~/.cache`). CI keeps it inside the job's persistent `HL_E2E_ROOT`; point
`FOUNDRYVTT_CACHE` there too, or set `HL_BROWSER_CACHE` explicitly. Reseeding
and container teardown leave the browser cache intact. Renovate tracks the
exact Chrome pin in `e2e.mjs` through the repository's custom datasource.

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

## An S3 server for the container

A suite that exercises S3 storage needs an S3-compatible server the browser and
Foundry both reach. Setting `FOUNDRYVTT_CONTAINER_S3=1` when a container is
created (`start`, `recreate`; through `e2e:fast --recreate` as well) provides one.
Without it nothing changes: no network, no server, no extra environment.

With it, before Foundry starts:

- A user-defined network named `<container>-net` is created, and the Foundry
  container is created on it.
- A SeaweedFS server (`chrislusf/seaweedfs:3.80`) named `<container>-s3` joins
  the network under the alias `s3.localhost` and publishes port 8333. Chromium
  resolves every `*.localhost` name to loopback, so `http://s3.localhost:8333`
  reaches the server from the browser and, through the alias, from the
  container. Its CORS allows every origin.
- The bucket `sohl-e2e` is created. Anonymous read and the test credentials come
  from the identities file the server is started with.
- The repository's `cypress/s3/aws-e2e.json` is copied into the data root's
  `Config/`, and the container is created with `FOUNDRY_AWS_CONFIG=aws-e2e.json`.

The repository supplies both files: `cypress/s3/s3-identities.json` (the
SeaweedFS identities, including an `anonymous` identity with `Read`) and
`cypress/s3/aws-e2e.json` (Foundry's `awsConfig`, pointing at
`http://s3.localhost:8333`). The credentials are test-only. A missing file stops
the start and names it.

```bash
FOUNDRYVTT_CONTAINER_S3=1 npm run e2e:fast -- --recreate
```

The container's environment is fixed when it is created, so an existing
container started with the variable set joins the network but keeps the
environment it was created with; `--recreate` applies `FOUNDRY_AWS_CONFIG`.
`package-build container <stage> rm` with the variable set removes the server
and the network along with the container. The server is otherwise left running
between runs, bucket intact. New and reused servers must answer the S3 HTTP
health check before Foundry starts; a ready filer alone is insufficient.

Both configuration paths must be readable regular files. When changing
worktrees, an existing server must bind the identities file from the current
checkout (symlinks to the same file are accepted). An incompatible or
uninspectable bind stops the start and names the server and expected path.
Restore the original checkout to keep its bucket data, or remove only the named
disposable S3 server with `docker rm -f <container>-s3` and rerun. Removing that
server discards its bucket data; the tool never removes it automatically.
