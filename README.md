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

The documentation lives in the Markdown files in this repository. Start with [the documentation home](docs/index.md).

| Topic                                             | Guide                                                        |
| ------------------------------------------------- | ------------------------------------------------------------ |
| Documentation landing                             | [Home](docs/index.md)                                        |
| Project layout and scripts                        | [Project setup](docs/project-setup.md)                       |
| Note model and output                             | [Content format](docs/content-format.md)                     |
| Frontmatter and system blocks                     | [Frontmatter](docs/authoring/frontmatter.md)                 |
| Addresses, links, anchors, SQL, and secret blocks | [Links and markup](docs/authoring/links-and-markup.md)       |
| Images, icons, audio, and provenance              | [Assets](docs/authoring/assets.md)                           |
| Dates, calendars, and eras                        | [Dates and calendars](docs/authoring/dates-and-calendars.md) |
| Complete note fields and mappings                 | [Note types](docs/reference/note-types.md)                   |
| Detailed format rules and examples                | [Format details](docs/reference/format-details.md)           |
| Compendium routing and document builds            | [Packs](docs/guides/packs.md)                                |
| Website build and publication                     | [Site](docs/guides/site.md)                                  |
| PDF book build                                    | [Book](docs/guides/book.md)                                  |
| Icon generation and use                           | [Icons](docs/guides/icons.md)                                |
| Reference pages and content indexes               | [Reference pages](docs/guides/reference-pages.md)            |
| Localization and templates                        | [Localization](docs/guides/localization.md)                  |
| Foundry integration testing                       | [End-to-end testing](docs/guides/e2e.md)                     |
| Release and deployment                            | [Release and deploy](docs/guides/release-and-deploy.md)      |
| Every CLI command                                 | [Commands](docs/commands.md)                                 |
| Every build setting                               | [Configuration](docs/configuration.md)                       |
| Programmatic exports                              | [API](docs/api.md)                                           |
| Error locations and severities                    | [Diagnostics](docs/diagnostics.md)                           |
| Architectural rationale                           | [Design](docs/design.md)                                     |

The package is GPL-3.0-or-later for code and CC-BY-SA-4.0 for original content. See [LICENSE.md](LICENSE.md).
