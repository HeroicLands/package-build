# Release and deploy a package

A Foundry package has two delivery paths. `package-build release` prepares
files for a GitHub release that Foundry can install. `package-build deploy`
places the staged build directly in one Foundry data directory for testing or
operation. Both start with the package built from its source and configuration.
The [command reference](../commands.md) gives each command's options; the
[configuration reference](../configuration.md) defines the stage and manifest.

## Check published addresses before a release

An Item address is an interface other packages can resolve against. Compare a
candidate build with an explicit released artifact when changing note
shortcodes or withdrawing Items:

```bash
package-build addresses diff --from build/baseline/module.zip
package-build addresses diff --from build/baseline/module.zip --strict
```

The baseline can be a release ZIP or an unpacked build directory; the command
does not download one. It reports an address as **renamed** when the same
document ID appears under another address, and **withdrawn** when that ID
appears under none. Findings are warnings by default. `--strict` turns them
into errors for a release gate. The comparison reads shipped Item packs, so it
reports the surface consumers actually resolve rather than inferring changes
from filenames. Use the [Address reference](../content-format.md#addresses)
when choosing a durable shortcode.

## Build the release files

Build the repository's staged package and content index, then run:

```bash
package-build release
```

The command writes a Foundry ZIP and its `system.json` or `module.json`
manifest under `build/dist/`. The ZIP contains the staged tree at its root,
which is the shape Foundry installs. When the manifest advertises a content
index, the corresponding metadata JSONL is also placed beside the ZIP. A
manifest that advertises an index the build has not produced fails the
release. An opted-in staged `schema.json` is published beside it too.

When the package publishes content and has a book configuration, the release
also builds a PDF beside the archive. Book findings are reported without
discarding the installable archive. `package-build release --no-pdf` skips the
book step. The [book guide](book.md) covers selecting and checking its pages.

The repository's build scripts decide how the staged tree is assembled. A
typical content build runs `package-build content-index`,
`package-build assets`, `package-build package compile`, and
`package-build manifest` before release. Run `package-build bundle check` when
the package ships a JavaScript bundle; it checks that the staged manifest
loads that bundle once and in the right module form.

## Deploy a staged build to Foundry

Set the stage's data root and deploy the build already under
`packageBuild.stageDir`:

```bash
export FOUNDRYVTT_DEV_DATA=/path/to/foundry-data
package-build deploy dev
package-build container dev status
package-build container dev restart
```

The data root can be a local path or a `[user@]host:/path` SFTP destination.
The deploy command stages a complete copy beside the installed package and
swaps it into place, so it does not rewrite open LevelDB files one by one.
For a remote destination it uses the SSH agent unless the stage names an
explicit key. `.env.local` and `.env` are loaded by the command, so a local
stage can keep its destination outside committed configuration. The
`container` command manages the Foundry Docker instance for the same stage;
`restart` stops it, clears a stale lock, then starts it. See the
[container command](../commands.md#package-build-container-stage-action) for
the other actions and environment variables.

## Publish a package-build npm version

For this toolchain's own npm release, a pull request with a change installers
meet carries one changeset. An internal or documentation-only change carries
none. The shared repository rules choose the bump: a non-optional user-visible
change is minor; an optional command, flag, or key is patch. A major bump
requires the maintainer's direct decision. `package-build changelog check`
checks the quality of any pending changeset.

Merging a changeset to `main` makes the **Version Packages** pull request. Its
generated changelog section is reviewed as the release note. Merging that
pull request runs the **Publish to npm** workflow: npm Trusted Publishing
publishes the version, and the workflow creates its version tag and GitHub
Release. The workflow's manual dispatch can retry publishing a version already
merged to `main`. The [npm package page](https://www.npmjs.com/package/@heroiclands/package-build)
shows the published version and README.
