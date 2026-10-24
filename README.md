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
| Buffer-only preview and Gitea rendering           | [Source preview](docs/source-preview.md)                                  |
| Every CLI command                                 | [Commands](docs/commands.md)                                              |
| Every build setting                               | [Configuration](docs/configuration.md)                                    |
| Programmatic exports                              | [API](docs/api.md)                                                        |
| Error locations and severities                    | [Diagnostics](docs/diagnostics.md)                                        |
| Architectural rationale                           | [Design](docs/design.md)                                                  |

Place notes may declare a governing affiliation with `data.government` (`Address`, default target type `affiliation`), or explicit `null` for complete anarchy. Positive population with an omitted government produces an advisory. See [place governments](docs/authoring/frontmatter.md#place-governments).

Every icon and image is covered by a provenance record stating `attribution`, `license` and `ai`. A Foundry package ships only the pictures whose record says `ai: false` under a licence on the shipping list, staged flat at the package root as `icons/<basename>` and `images/<basename>` and listed in its asset set, `asset-sets/default.json`; a reference to a picture it leaves out draws the package's `missing` stand-in, and every compiled reference states its asset's address. See [assets](docs/authoring/assets.md#what-the-foundry-package-ships) and [what a package ships](docs/reference/format-details.md#what-a-package-ships).

`package-build cdn publish --set <file> --name <display name>` uploads every icon and image the package has, shipped or not, to `<site.assets>/<contentPackage>/` in that flat layout, and writes the named set listing the pictures the package leaves out. It reads the bucket from `CDN_ENDPOINT`, `CDN_BUCKET`, `CDN_ACCESS_KEY_ID` and `CDN_SECRET_ACCESS_KEY`, in the environment or `.env.local`. See [publish pictures to the CDN](docs/guides/release-and-deploy.md#publish-pictures-to-the-cdn).

Leading captions, generic fenced divs, inline spans, and verse code fences are described in [links and markup](docs/authoring/links-and-markup.md).

Cypress end-to-end suites use pinned Chrome for Testing 155.0.8059.84 by default
on macOS arm64 and Linux x64, downloaded once into a reusable cache. Select an
installed browser with `package-build e2e fast -- --browser electron` (also
available for `run` and `open`). See [browser selection and cache settings](docs/guides/e2e.md#choose-a-browser).

The package is GPL-3.0-or-later for code and CC-BY-SA-4.0 for original content. See [LICENSE.md](LICENSE.md).
