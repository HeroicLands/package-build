---
shortcode: gettingstarted
name: { full: "Getting started" }
type: doc
subType: userguide
---

# Getting started

`@heroiclands/package-build` turns an authored content tree and a project configuration into Foundry compendiums, a website, and a book. Choose the path that matches the package you own, then use the shared note guide for its content.

| You are building                              | Start here                                 |
| --------------------------------------------- | ------------------------------------------ |
| A Foundry system with source code and content | [System project](guides/system-project.md) |
| A Foundry module, with or without source code | [Module project](guides/module-project.md) |
| Notes in an existing package                  | [Your first note](authoring/first-note.md) |

Node 24 or newer and npm are needed for the toolchain. The generated website build uses Hugo Extended; the book build uses Typst. A Foundry installation and deployment credentials are not needed to author or build content locally.

## Start a package

Run `init` through npm when the project does not have `package.json`:

```bash
npm exec --package=@heroiclands/package-build -- package-build init my-package --kind modules --name my-package --title "My Package" --description "A content package." --author "Your Name" --license original
cd my-package
npm install
npm run lint
npm run build:site
npm run serve:site
```

Use `--kind systems` for a system project. `package-build init --check` reports what it would create without writing. The generated project includes a homepage, website and book targets, a `package-build.config.yaml`, npm scripts, and a `.gitignore` for local and generated files. Deployment needs hosting configuration; the local build and server work without it.

The [command reference](commands.md) gives exact options. [Configuration](configuration.md) explains every key. [Authoring content](content-format.md) is the route into note syntax and the exhaustive [type reference](reference/note-types.md). [Diagnostics](diagnostics.md) explains located errors.
