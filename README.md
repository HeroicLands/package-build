# @heroiclands/package-build

The shared toolchain for building HeroicLands Foundry systems and modules. It compiles Markdown content into a searchable index, Foundry compendiums, website pages, and a book; it also assembles manifests, assets, bundles, and release archives.

## Start here

Use Node 24 or newer and npm. Initialize a project before it has a `package.json`, or add the package to an existing repository:

```bash
npm exec --package=@heroiclands/package-build -- package-build init my-package --kind modules --name my-package --title "My Package" --description "A content package." --author "Your Name" --license original
```

```bash
npm install -D @heroiclands/package-build
```

The generated project includes a homepage, website and book targets, npm scripts, and a local `.gitignore`. [Getting started](docs/getting-started.md) routes you to a [system](docs/guides/system-project.md), [module](docs/guides/module-project.md), or [content authoring](docs/authoring/first-note.md) path. The [content-language-server](https://github.com/HeroicLands/content-language-server) provides editor navigation and completion.

Build indexes, calendars, staged assets and packs together with `package-build content build --calendaria-version 1.4.2`. The [complete content build](docs/commands.md#package-build-content-build) shares one source capture across publication, lint, links and compilation and reports each build stage's time.

Run selected content operations together with `package-build content run index lint links compile`. The [shared content command](docs/commands.md#package-build-content-run-targets) captures one source tree for the selected checks and outputs; standalone commands remain available.

Render one note to the body HTML its site page carries with
`@heroiclands/package-build/note-page`: `renderNoteFile(path, { root })` reads a
saved note of a repository against its content tree and fetched dependency
indexes, and returns `{ html, styles, findings, cache }`. What it derives is
kept in `build/cache/note-page/` and reused while its inputs are unchanged, so a
second preview is fast; see [`./note-page`](docs/api.md#note-page).

Language annotations keep authored spelling: `[Zaron]{lang=vyl}` stays Roman.
Add `.nativefont` with an explicit `lang=` to use native script defaults;
see [writing in invented scripts](docs/guides/writing-in-invented-scripts.md).
Parallel verse sets `cols=N`, then prefixes each reading with its column
number; blank lines divide logical rows.

## Working on this repository

Run `npm ci` in each fresh clone or worktree. Its `prepare` step installs the
committed `.githooks/` with `git config core.hooksPath .githooks`; run
`npm run prepare` to install the hooks again without reinstalling dependencies.
Git uses the hook files in the current worktree.

These are the canonical POSIX shell hooks from
[HeroicLands/.github](https://github.com/HeroicLands/.github#local-git-hooks-and-actionsgithooks).
They need Git, POSIX utilities and an available UTF-8 locale, and run without
Node at commit time. `pre-commit` refuses commits on `main` and `master`;
`commit-msg` refuses assistant coauthor credits and standalone assistant
signatures while allowing ordinary prose and human coauthors. Both forges run
the pinned canonical drift action against every installed hook file.

Local opt-outs use Git configuration: `hooks.protectedBranch false` or
`hooks.allowCommitOnMain true` for the branch guard, and
`hooks.noAttribution false` for the message guard. Prefix each with `git config`
to set it for this clone. `git commit --no-verify` skips both checks once.
Server and pull-request enforcement still apply.

The published `githooks/` bundle is a separate optional API described in
[project setup](docs/project-setup.md#optional-published-hook-bundle). This
repository’s setup installs the two canonical shell hooks; it installs no
pre-push hook. Run `npm test` and the other checks directly, or use
`package-build ci` for a container run.

The repository's `vitest.config.ts` limits both `npm test` and `npm run
test:watch` to two workers, with Vitest's isolated fork pool. CI runs the same
`npm test` command. This bounds concurrent test files on the shared runner,
including files that start CLI subprocesses, load SQL databases, or emit
TypeScript declarations. Keep this bound when reproducing CI failures locally;
a percentage of the host's CPUs does not reserve resources for other jobs.

Real Typst and PDF fixture compilation requires owner permission and an available
Typst installation. Once authorized, run `PACKAGE_BUILD_COMPILE_TESTS=1 npm test`
to include those fixtures. The default test command leaves them disabled.

### The Texinfo manual

`node scripts/docs-texinfo.mjs` converts the Markdown under `docs/` into the
Texinfo manuals that `packageBuild.texinfo` declares in
`package-build.config.yaml`. For each manual it writes `build/docs/<name>.texi`,
one included file per chapter under `build/docs/<name>-chapters/`, the images
the manual shows under `build/docs/<name>-images/`, a build report
`<name>.report.txt`, and an Info `dir` file that lists the manuals.
`--root <dir>` names another repository root, `--out <dir>` writes elsewhere,
`--check` converts without writing, and `--help` prints the usage. A finding is
reported as `file:line:column: severity: message`: an error exits with status 1
and writes nothing, and a warning is reported and the manual is written.

The manual's structure comes from each page's `texinfo` front matter, never from
links:

```yaml
texinfo:
  parent: homepage-root
  before: [guidespacks]
  after: [gettingstarted]
```

`parent` is required, and `parent: null` marks the top page. `before` and
`after` order siblings. A page without `texinfo` is not in the manual. Links
only discover pages and become cross-references: the crawl starts at the top
page, follows links through pages that take part, and stops at a page that does
not. `parent`, `before` and `after` name pages by Address, with `doc` as the
default type, so a page needs a `type` and a `shortcode`.

The manual's title is the top page's `name.full`, its version and file name
come from `package.json`, and its Info directory category and the license of
its text come from `texinfo.dircategory` and `texinfo.license` in `package.json`. Its date is `SOURCE_DATE_EPOCH` or the
last commit's time, so a build never changes with the clock. The
[configuration reference](docs/configuration.md#packagebuildtexinfo) describes
the front matter, the node names, the depth rules, the indexes and every
finding the build reports.

`texi2any` builds the Info and split HTML output and `texi2pdf` the PDF, and the
tests run all three on the manual and on a fixture tree, treating a warning as a
failure. Outside CI they skip, with the reason, when a tool or `texinfo.tex` is
missing; in CI, where the Build and Test job installs Texinfo and TeX, a missing
tool fails them.

## Documentation

The documentation lives in the Markdown files in this repository. Start with [the documentation home](docs/index.md). This toolchain does not build its own site or book.

| Topic                                             | Guide                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| Documentation landing                             | [Home](docs/index.md)                                                     |
| Project layout and scripts                        | [Project setup](docs/project-setup.md)                                    |
| Note model and output                             | [Content format](docs/content-format.md)                                  |
| Frontmatter and system blocks                     | [Frontmatter](docs/authoring/frontmatter.md)                              |
| Addresses, links, anchors, SQL, and secret blocks | [Links and markup](docs/authoring/links-and-markup.md)                    |
| Images, icons, audio, and provenance              | [Assets](docs/authoring/assets.md)                                        |
| Dates, calendars, and eras                        | [Dates and calendars](docs/authoring/dates-and-calendars.md)              |
| Complete note fields and mappings                 | [Note types](docs/reference/note-types.md)                                |
| Detailed format rules and examples                | [Format details](docs/reference/format-details.md)                        |
| Compendium routing and document builds            | [Packs](docs/guides/packs.md)                                             |
| Website build and publication                     | [Site](docs/guides/site.md)                                               |
| What the theme draws on a page                    | [Theme pages](docs/reference/theme-pages.md)                              |
| PDF book build                                    | [Book](docs/guides/book.md)                                               |
| Icon generation and use                           | [Icons](docs/guides/icons.md)                                             |
| Reference pages and content indexes               | [Reference pages](docs/guides/reference-pages.md)                         |
| Localization and templates                        | [Localization](docs/guides/localization.md)                               |
| Foundry integration testing                       | [End-to-end testing](docs/guides/e2e.md), including an optional S3 server |
| Release and deployment                            | [Release and deploy](docs/guides/release-and-deploy.md)                   |
| Invented languages and scripts                    | [Write in invented scripts](docs/guides/writing-in-invented-scripts.md)   |
| Encoding rules and the conversion core            | [Encoding core](docs/encoding-core.md)                                    |
| Buffer-only preview and Gitea rendering           | [Source preview](docs/source-preview.md)                                  |
| One note as its site page's body                  | [`./note-page`](docs/api.md#note-page)                                    |
| Vehicle prompt generation                         | [Vehicle command](docs/commands/vehicle.md)                               |
| Every CLI command                                 | [Commands](docs/commands.md)                                              |
| Every build setting                               | [Configuration](docs/configuration.md)                                    |
| Programmatic exports                              | [API](docs/api.md)                                                        |
| Error locations and severities                    | [Diagnostics](docs/diagnostics.md)                                        |
| Architectural rationale                           | [Design](docs/design.md)                                                  |

Settlement authoring references cover [map input](docs/reference/azgaar-map-input.md),
[input assembly](docs/reference/settlement-inputs.md), the [model](docs/reference/settlement-model.md),
[rural proposals](docs/reference/settlement-proposals.md), [site discovery](docs/reference/settlement-placement.md),
[urban food](docs/reference/settlement-urban.md),
[place-name candidates](docs/reference/settlement-names.md), and [source edits](docs/reference/settlement-source.md).

Place notes may declare a governing affiliation with `data.government` (`Address`, default target type `affiliation`), or explicit `null` for complete anarchy. Positive population with an omitted government produces an advisory. See [place governments](docs/authoring/frontmatter.md#place-governments).

Every icon and image is covered by a provenance record stating `attribution`, `license` and `ai`. A Foundry package ships only the pictures whose record says `ai: false` under a licence on the shipping list, staged flat at the package root as `icons/<basename>` and `images/<basename>` and listed in its asset set, `asset-sets/default.json`; a reference to an excluded known-AI master draws its declared non-AI alternative. Other excluded pictures draw the package's `missing` stand-in. Every compiled reference keeps the original asset's address. See [assets](docs/authoring/assets.md#what-the-foundry-package-ships) and [what a package ships](docs/reference/format-details.md#what-a-package-ships).

`package-build cdn publish [--dest internal|cloudflare] --set <file> --name <display name>` manually uploads every icon and image, shipped or left out, and writes a named set listing the left-out pictures. The default publishes to atlas at `https://cdn.internal.heroiclands.org/<contentPackage>/` using SSH and rsync. `--dest cloudflare` uses the existing R2 bucket at `site.assets` and its `CDN_ENDPOINT`, `CDN_BUCKET`, `CDN_ACCESS_KEY_ID` and `CDN_SECRET_ACCESS_KEY` environment settings. Site builds never publish pictures. See [publish pictures to the CDN](docs/guides/release-and-deploy.md#publish-pictures-to-the-cdn).

Leading captions, fenced divs, inline spans, and verse quotations are described in [links and markup](docs/authoring/links-and-markup.md).

Cypress end-to-end suites use pinned Chrome for Testing 155.0.8059.84 by default
on macOS arm64 and Linux x64, downloaded once into a reusable cache. Select an
installed browser with `package-build e2e fast -- --browser electron` (also
available for `run` and `open`). See [browser selection and cache settings](docs/guides/e2e.md#choose-a-browser).

The package is GPL-3.0-or-later for code and CC-BY-SA-4.0 for the documentation text and the generated manual. See [LICENSE.md](LICENSE.md).

## Pull request checks

A pull request whose title starts with `WIP:` runs the light checks. An existing
required check runs a short guard and fails, blocking merges while the expensive
steps stay skipped. Remove the prefix with `earl pr ready`; it starts fresh
required checks before scheduling a merge. Changing the title by hand does not
start those checks. Main, release and manual runs keep their existing checks.

Check the workflow gating locally with `node --test ci/wip-workflows.test.mjs`.

### Consumer compile proof

The **Consumer proof** workflow (`consumer-proof.yml`) runs on explicit dispatch.
Supply the full package-build commit SHA as `candidate_sha` and dispatch the
branch containing that commit. Select `consumer: kethira` (the default) for the
pinned Kethira compile, or `consumer: thalorna-encoding` for the pinned Thalorna
encoding proof, or `consumer: thalorna-headwords` for the pinned Thalorna
headword proof.
Set `art_archives: true` with `consumer: kethira` to add an isolated artwork
archive compile. The Thalorna proofs ignore this option.

Select `consumer: thalorna-art-release`, supply the exact `consumer_sha`, and set
`art_release_tag` to a published `HeroicLands/art-thalorna` tag and
`art_release_sha256` to its reviewed release digest. This proof
compiles the real Thalorna source with every released ZIP, first with an empty
archive cache and then with archive fetches refused. The
`art-release-consumer-proof` artifact records release coordinates and digests,
archive layout, original-byte preservation, staged artwork and compiled
references. It requires an eligible published release and does not publish one.
See [the CI instructions](ci/README.md) for inputs, limits and evidence.

Select `consumer: authoring-reference` to generate the controlled reference
documents from the selected commit in an isolated snapshot. The
`authoring-reference` artifact contains the documents and a receipt with the
source commit and SHA-256 hashes; review them before committing the output.

Select `consumer: thalorna-populations`, set `consumer_sha` to the exact
Thalorna commit, and supply `population_addresses` as a JSON list of canonical
place (`thalorna-note-place-…`) and affiliation (`thalorna-sohl-affiliation-…`)
Addresses. At least one selected subject must have differing figures; each
selected subject must have public site and JournalEntry output. The proof checks an isolated
source snapshot, public index and site, and public and private Foundry documents. Its
receipt records source and output hashes without copying private source records.
The source commit must contain population `actual`/`apparent` maps, public SQL
queries that read `apparent`, and `facial_hair_genders` beside authored
`facial_hair` weights. The proof reads the authored population declarations without
changing the snapshot’s notes.

The consumer compile choices pack that commit, verify the archive integrity and
installed bytes, and refuse changes to unrelated locked dependencies before the
normal consumer compile. Kethira checks its content index and compiled packs. The encoding proof
applies two disposable note overlays and checks that the requested stressed grave
vowels encode, decode and render without findings. The headword proof applies
three disposable replacements and checks the resulting dictionary classes,
meanings and rendered anchors. The canonical consumer notes
stay in their own repository.

For `consumer: thalorna-facial-hair`, supply the exact Thalorna commit as
`consumer_sha`. The workflow archives that source, checks its culture profiles,
compiles it with the candidate and checks the indexed profiles and generated
characters. The `facial-hair-consumer-proof` artifact records the two commits,
archive hashes, source profiles, indexed lists and generation counts. The source
commit must contain population `actual`/`apparent` maps, public SQL queries
that read `apparent`, and `facial_hair_genders` beside authored `facial_hair`
weights. This proof does not convert populations.

The workflow requires registry and consumer dependency access; it does not
publish a package or site.

The Thalorna consumer proofs use the normal `build` host runner with a 3072 MiB
Node heap limit. The encoding and headword proofs verify the runner service and shared content slice's
12 GiB high watermark and 14 GiB memory limit. The profile permits swap.
The `consumer-proof-memory` artifact retains before/after memory limits, peak
and event counters, including failed compiles. Those cgroup counters include
other content jobs sharing the service or slice; they are not per-job peaks.
The same artifact contains per-process Node memory samples, the effective V8
heap ceiling, and content-stage transitions. Samples include RSS, heap use and
external memory; the heap ceiling does not limit native allocations such as
DuckDB's separate memory allowance. Stage transitions are recorded synchronously,
while periodic samples depend on the Node event loop being available. A failed
compile remains a failure; memory counters do not replace the compile and
focused assertions. Kethira uses a
2 GiB container without swap.

### Settlement setting integration

The manually dispatched [Settlement setting integration workflow](.gitea/workflows/settlement-real-factory.yml)
checks the settlement command against a pinned accepted Thalorna `main` commit. It
checks out that setting tree and installs both repositories' locked dependencies. The test runs only when
`SETTLEMENT_SETTING_CHECKOUT` names the setting checkout; its map, notes and
writes are isolated fixture data.

The test covers a dry run with the actual factory, a missing resource, a locked
write, a source edit rejected after an intervening change, a successful write,
and a repeat with a refreshed index emitted by the production index serializer. A passing run establishes interoperability
on that fixture. It does not establish production naming readiness or calibrate
a real map. The setting factory supports a limited language and composition scope.

### Real map adapter probe

The manual **Real map adapter probe** workflow reads pinned saved-map and Full
JSON attachments and the retained export evidence through bounded, checksum-verified
HTTPS requests using the workflow’s read-only forge token. Dispatch the candidate branch with its exact
`candidate_sha` and the seven attachment URLs named by the workflow inputs.
The output artifact holds the adapter report and the original evidence files,
including loader repairs, integrity notices and boundary observations. A refusal
fails the job and retains its report. The probe does not generate settlements or
write setting notes; successful ingestion is not a map calibration.

### Settlement preflight

Dispatch **Settlement real calibration preflight** on the candidate branch, supplying its exact package-build commit and the seven attachment URLs. The workflow captures the Thalorna source session at `d1a435b9821008a1f080d0462fe8b88d2dc82204` and the approved map attachments. The workflow downloads the pinned SoHL release artifacts directly, verifies their SHA-256 hashes, and records those hashes with the receipt. Optional trial JSON may contain `bindings`, `settings`, `selection` and `bands`; values describe explicit trial assumptions, not authored facts. The [settlement assembly inputs](docs/reference/settlement-inputs.md) describe bindings and settings, and the [placement guide](docs/reference/settlement-placement.md) describes selection fields and work budgets. The retained JSON and Markdown receipts identify the source and input hashes, map identities, declared facts, missing fields and available numerical results. Receipt status is `incomplete` for a captured preflight and `refused` when setup or inspection fails. Neither status establishes calibration or a completed settlement operation.
