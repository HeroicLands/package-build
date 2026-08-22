# @heroiclands/package-build

The shared toolchain for building and shipping a HeroicLands **Foundry
package** — the parts Foundry loads whether or not the package ships any
content.

It is the counterpart to
[`@heroiclands/content-build`](https://github.com/HeroicLands/content-build), and
the two split by **input**:

| Package         | Reads                                                        | Produces                                                       |
| --------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| `content-build` | `assets/content/**`                                          | compendium packs, site content, link manifest                  |
| `package-build` | `lang/`, `styles/`, `src/`, `assets/`, the manifest template | `system.json` / `module.json`, styles, bundle, release archive |

A module uses either, or both. An adventure module that ships only notes needs
no bundler; a variant module that ships only behavior needs no Markdown
pipeline. The coupling runs one way — `package-build` asks `content-build` for
the compiled `packs[]` block, never the reverse.

## Install

```
npm install -D @heroiclands/package-build
```

## What it covers

The whole of assemble → validate → ship, one subpath each:

- **`manifest`** — the Foundry package manifest, `system.json` or `module.json`:
  read the repository's template, stamp the version and the four release
  addresses, write it into the stage. The artifact is inferred from the
  template's name, and every address is derived from `package.json`'s
  `repository` — nothing is transcribed.
- **`stage`** — assembling the build stage and clearing it away again. A listed
  asset path that does not exist **fails the build** rather than shipping a
  package that quietly lacks its localization or its templates, and the whole
  list is checked before anything is copied, so a bad list leaves no
  half-populated stage.
- **`lang`** — what a shippable Foundry localization file must satisfy: it
  parses, its top level is an object, no key is both a leaf and a dotted prefix
  of another, placeholders are single-braced, and key segments carry no data.
- **`bundle`** — whether the manifest agrees with the file it points at.
  Declared under `"esmodules"` the bundle must parse as a module; declared under
  `"scripts"` it must declare **nothing** at top level, because every top-level
  declaration in a classic script is a global lexical binding and one colliding
  with a non-configurable `window` property throws at parse time.
- **`release`** — the two assets a GitHub Release carries, `<artifact>.zip` and
  the manifest beside it. Waits for the archive to be _written_, not merely
  finalized.
- **`deploy`** — installing a staged package into a Foundry data directory, over
  a local copy or SFTP. Always a staged, atomic swap: a running Foundry holds
  its LevelDB packs open, and replacing them in place leaves a directory LevelDB
  "repairs" to zero.
- **`text`** — locating a literal inside a file, so a finding names the line and
  column it is about.

## Design

**The rules are pure, and I/O is confined to functions named for it.** A rule
takes source text or data and returns findings or values; discovery and
reporting stay with the caller. Where a step genuinely has to touch disk or a
network it is an export named for what it does — `writeFoundryManifest`,
`stageAssets`, `packRelease`, `deployStage`.

That is what lets one rule set serve a `lint` script, a build step and a unit
test without any of them agreeing on how files are found or how findings are
printed — and it is what makes the rules testable at all, which the scripts they
were extracted from were not: each ran its work at import time and exported
nothing.

Findings carry the fields the shared diagnostic format takes (`line`, `column`,
`severity`, `message`) but never `file`, which only the caller knows. The format
itself is owned by `@heroiclands/content-build`'s `engine/diagnostics`, and is
not restated here.

```js
import { validateLangSource } from "@heroiclands/package-build/lang";

for (const file of globSync("lang/*.json")) {
  for (const finding of validateLangSource(readFileSync(file, "utf8"))) {
    reportDiagnostic({ file, ...finding });
  }
}
```

## Tests

```
npm test
```

Plain `vitest`, no setup file and no aliases: everything here is ESM over Node
built-ins and three dependencies, and a harness that offered a Foundry global
would let something reach for one.

`tests/dependencies-are-declared.test.ts` is the guard an extraction most needs
— every bare specifier in a shipped file must be a builtin, this package, or a
declared `dependency`. Inside a workspace a missing declaration is invisible;
installed from npm it fails on the first import.

## Licence

GPL-3.0-or-later.
