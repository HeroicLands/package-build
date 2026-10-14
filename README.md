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

## Documentation

The documentation lives in the Markdown files in this repository. Start with [the documentation home](docs/index.md). This toolchain does not build its own site or book. A Hugo theme dependency would form a cycle because the theme uses package-build for releases.

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
| Every CLI command                                 | [Commands](docs/commands.md)                                              |
| Every build setting                               | [Configuration](docs/configuration.md)                                    |
| Programmatic exports                              | [API](docs/api.md)                                                        |
| Error locations and severities                    | [Diagnostics](docs/diagnostics.md)                                        |
| Architectural rationale                           | [Design](docs/design.md)                                                  |

Place notes may declare a governing affiliation with `data.government` (`Address`, default target type `affiliation`), or explicit `null` for complete anarchy. Positive population with an omitted government produces an advisory. See [place governments](docs/authoring/frontmatter.md#place-governments).

Every icon and image is covered by a provenance record stating `attribution`, `license` and `ai`. A Foundry package ships only the pictures whose record says `ai: false` under a licence on the shipping list, staged flat at the package root as `icons/<basename>` and `images/<basename>` and listed in its asset set, `asset-sets/default.json`; a reference to a picture it leaves out draws the package's `missing` stand-in, and every compiled reference states its asset's address. See [assets](docs/authoring/assets.md#what-the-foundry-package-ships) and [what a package ships](docs/reference/format-details.md#what-a-package-ships).

`package-build cdn publish --set <file> --name <display name>` uploads every icon and image the package has, shipped or not, to `<site.assets>/<contentPackage>/` in that flat layout, and writes the named set listing the pictures the package leaves out. It reads the bucket from `CDN_ENDPOINT`, `CDN_BUCKET`, `CDN_ACCESS_KEY_ID` and `CDN_SECRET_ACCESS_KEY`, in the environment or `.env.local`. See [publish pictures to the CDN](docs/guides/release-and-deploy.md#publish-pictures-to-the-cdn).

Leading captions, generic fenced divs, inline spans, and poetry code fences are described in [links and markup](docs/authoring/links-and-markup.md).

The package is GPL-3.0-or-later for code and CC-BY-SA-4.0 for original content. See [LICENSE.md](LICENSE.md).
