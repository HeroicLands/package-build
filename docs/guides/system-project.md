---
shortcode: guidessystemproject
name: { full: "Building a Foundry system" }
type: doc
subType: howto
---

# Building a Foundry system

A system repository owns its Foundry source and its content package. The system's JavaScript, templates, styles, and localization are repository source; Markdown notes under `assets/content/` describe setting material and compile into the configured packs, site, book, and content index. Both sides are assembled by the same `package-build.config.yaml`.

## Initialize the project

```bash
npm exec --package=@heroiclands/package-build -- package-build init my-system --kind systems --name my-system --title "My System" --description "A Foundry game system." --author "Your Name" --license original
cd my-system
npm install
npm run lint
```

The initializer writes `package.json`, `package-build.config.yaml`, shared formatting configuration, a homepage and introduction note, `book.yaml`, localization, and npm scripts. It configures a JournalEntry pack, website, and book. It does not invent your Actor and Item DataModels or source bundle. Add those as the system grows, and declare every staged asset and pack in the build configuration. [Configuration](../configuration.md) gives the exact keys; [project setup](../project-setup.md) explains the scripts and generated directories.

`packageKind: systems` determines Foundry's package kind. `contentPackage` is the first segment of every content Address and must contain lowercase letters and digits. `package.json` supplies the package ID, version, and repository URL. The Foundry manifest is generated from these sources; keep no hand-edited second manifest.

## Add source and content

Put system code under `src/`, templates under `templates/`, styles under `styles/`, and localization under `lang/`. Configure the build to stage the outputs Foundry loads and to validate the bundle against the generated manifest. [Project setup](../project-setup.md) describes the stage, language and bundle scripts; [localization](localization.md) covers keys and templates.

Put authored notes under `assets/content/` in any folder arrangement that helps the team. The note's frontmatter determines its content type and system document. Start with [one note](../authoring/first-note.md), then add [system blocks](../authoring/frontmatter.md) to a being or Item. The shared body makes one JournalEntry even if both SoHL and HM3 blocks appear; game-specific fields come from the respective block.

A system can own images, icons, and audio under their addressable roots. Keep provenance with each authored asset. [Assets](../authoring/assets.md) explains the roots and records. Set `packs` in the configuration for the compendiums the system ships; [packs](packs.md) explains routing and document compilation.

## Build and review

```bash
npm run build:db
npm run build:site
npm run serve:site
npm run build:book
npm run build:noci
```

`build:db` writes the content index, stages assets, and compiles configured packs. `build:site` writes site content and renders it with Hugo Extended; `serve:site` starts a local Hugo preview. `build:book` uses Typst. `build:noci` runs lint, database, and manifest steps without reinstalling dependencies. Inspect `build/packs-json/` for compiled document data and `build/stage/` for what Foundry receives. Everything under `build/` is generated and can be deleted.

The [testing guide](e2e.md) covers a disposable Foundry world. The [release guide](release-and-deploy.md) covers packaging and deployment. Site deployment needs its own hosting configuration; local builds do not.
