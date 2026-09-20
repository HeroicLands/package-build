## Configuration: `package-build.config.yaml`, key by key

Every repository built by `@heroiclands/package-build` declares itself in one
file at its root: `package-build.config.yaml` (`.yml` works identically). The
whole contract is `defineConfig`, exported from `content-config.mjs`: it
validates the object, fills every optional key with its default, and returns a
deeply frozen copy. It performs no I/O and knows nothing about any particular
package's content — the configuration is data, and the compilers read it.

The reserved `packageBuild:` section belongs to the packaging half of the
toolchain and is validated separately, by `resolvePackageBuildConfig` in
`config.mjs`. `content-config.mjs` checks only that the section is a mapping
and hands it back frozen; its own key-by-key reference is
[below](#the-packagebuild-section).

This document is a transcription of both validators. Where a rule is stated in
prose here, the validator states it in code; where a message is quoted, it is
quoted **verbatim** — search the error text you hit against this page and you
will find the row that produced it.

### Two ways to write it

Every configuration ends at the same `defineConfig`, but reaches it by one of
two routes, and three keys behave differently depending on which:

|                  | `package-build.config.yaml` (data)                                                                   | `package-build.config.mjs` (code)                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Loaded by        | `engine/pack-config.mjs`, which parses the YAML and derives three keys before calling `defineConfig` | `require()`, which loads the module and reads its default export — already the result of the file calling `defineConfig` itself |
| `rootDir`        | Forbidden — always the directory the file sits in                                                    | Authored, typically `import.meta.dirname`                                                                                       |
| `foundryPackage` | Forbidden — always the adjacent `package.json` `name`                                                | Authored                                                                                                                        |
| `homepage`       | Forbidden — always the adjacent `package.json` `homepage`                                            | Authored                                                                                                                        |
| `author`         | Forbidden — always the adjacent `package.json` `author`                                              | Authored                                                                                                                        |
| `itemBuilders`   | A **name** (`sohl`, `hm3`) or list of names, resolved against the registries this package ships      | The registry object itself — real builder functions, which only code can carry                                                  |

A file is chosen by its extension: `package-build.config.yaml`, then
`.yml`, then `.mjs`, resolved by walking up from the working directory. Two of
them in one directory is a hard error — a repository declares its build in
exactly one file. The `.mjs` form exists as an escape hatch for a repository
whose `itemBuilders` registry is its own code, not one of the two this package
ships; everything else about the two forms is identical, because both are
validated and frozen by the same `defineConfig`.

An `.mjs` configuration imports `defineConfig` from
`@heroiclands/package-build/content-config`, never from the package root
barrel — the barrel pulls in the compilers, which read this module, which
loads the config file, so a config reaching for the barrel closes a cycle
around its own evaluation.

### Quick reference

20 top-level keys. `rootDir` is not one of them — a data configuration never
writes it — and is documented under [Derived values](#derived-values) instead,
alongside `foundryPackage`, `homepage`, `author` and `itemBuilders`, whose
data-configuration behaviour is also derivation rather than ordinary
authoring.

| Key                                         | Type                                                                       | Required                                                                                           | Default                                     |
| ------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| [`contentPackage`](#contentpackage)         | string                                                                     | yes                                                                                                | —                                           |
| [`foundryPackage`](#foundrypackage)         | string                                                                     | yes (`.mjs` only — derived in YAML); refused in a `documentation` package                          | —                                           |
| [`homepage`](#homepage)                     | string                                                                     | no (`.mjs` only — derived in YAML)                                                                 | `null`                                      |
| [`author`](#author)                         | string, or `{name, email?, url?}`                                          | no (`.mjs` only — derived in YAML)                                                                 | `null`                                      |
| [`packageKind`](#packagekind)               | `"systems"` \| `"modules"` \| `"documentation"`                            | yes                                                                                                | —                                           |
| [`stats`](#stats)                           | object                                                                     | yes; refused in a `documentation` package                                                          | —                                           |
| [`itemBuilders`](#itembuilders)             | object, or list of `{system, builders}` (or a name/list of names, in YAML) | no; refused in a `documentation` package                                                           | `{}`                                        |
| [`paths`](#paths)                           | object                                                                     | no                                                                                                 | see [`paths`](#paths)                       |
| [`skipDirectories`](#skipdirectories)       | string[]                                                                   | no                                                                                                 | `[]`                                        |
| [`icons`](#icons)                           | object, or a path to a file holding one                                    | no                                                                                                 | empty registry                              |
| [`packs`](#packs)                           | array                                                                      | yes, at least one entry, in a `systems` or `modules` package; refused in a `documentation` package | —                                           |
| [`docs`](#docs)                             | object                                                                     | no; refused in a `documentation` package                                                           | `{}`                                        |
| [`site`](#site)                             | object                                                                     | no                                                                                                 | see [`site`](#site)                         |
| [`pdf`](#pdf)                               | object                                                                     | no                                                                                                 | `null`                                      |
| [`compatibility`](#compatibility)           | object                                                                     | no; refused in a `documentation` package                                                           | `null`                                      |
| [`relationships`](#relationships)           | object                                                                     | no; refused in a `documentation` package                                                           | `{}`                                        |
| [`systems`](#systems)                       | object                                                                     | no; refused in a `documentation` package                                                           | `{}`                                        |
| [`requiresSystem`](#requiressystem)         | string                                                                     | no; refused in a `documentation` package                                                           | `null`                                      |
| [`packageBuild`](#the-packagebuild-section) | object                                                                     | no                                                                                                 | `{}`                                        |
| [`publish`](#publish)                       | object                                                                     | no; **required**, with `site: content`, in a `documentation` package                               | `{site: "homepage", address: {prefix: ""}}` |

Any key outside this list is refused:

> `` `<key>` is not a recognized option (expected one of: rootDir, contentPackage, foundryPackage, homepage, author, packageKind, stats, itemBuilders, paths, skipDirectories, icons, packs, docs, site, pdf, compatibility, relationships, systems, requiresSystem, packageBuild, publish). ``

(`rootDir` appears in that list because it is a key `defineConfig` itself
accepts — an `.mjs` configuration authors it directly. A YAML configuration
never sees this particular message about it, because `engine/pack-config.mjs`
refuses an authored `rootDir` earlier, with its own message — see
[Derived values](#derived-values).)

### Derived values

Seven values in the resolved configuration are never transcribed by an author
— they are computed from where the file sits, from the adjacent
`package.json`, from the package kind, or from a name naming a table this
package already ships. Authoring `rootDir`, `foundryPackage`, `homepage`,
`author` or `stats.systemVersion` yourself is an **error**, not an override: a
transcribed copy is free to drift from what it copied, which is exactly how
`stats.systemVersion` once sat at a stale version for four releases while
nothing said so. `assetRoot` has no author-facing spelling to refuse in the
first place — it is never a key at all, only ever a computed value.

#### `rootDir`

The configuration's own directory, always. Every configured path in `paths`
is resolved against it, so the build reads the same tree whatever directory
it was launched from.

- In a **YAML** configuration, writing `rootDir:` is refused by the loader
  before `defineConfig` ever runs:

  > ``package-build: <config file> declares `rootDir`, which a data configuration may not: it is always the directory the file sits in. An absolute path written here would be one machine's; remove the key.``

- In an **`.mjs`** configuration, `rootDir` is an ordinary required key of
  `defineConfig` — a non-empty, absolute string, typically
  `import.meta.dirname`. A relative or missing value is refused:

  > ``package-build config: `rootDir` must be a non-empty string.``

  > ``package-build config: `rootDir` must be an absolute path — it is what makes the build independent of the directory it was launched from (pass `import.meta.dirname`).``

#### `foundryPackage`

The Foundry package id — what appears as `id` in the generated
`system.json` / `module.json`, and the value `assetRoot` and the packaging
half's `packageId` are built from. `null` in the resolved configuration of a
`documentation` package — see [`packageKind`](#packagekind) for the refusal,
which applies before either loader form gets a chance to derive anything.

- In a **YAML** configuration, writing `foundryPackage:` is refused; the
  loader reads it from the adjacent `package.json` `name` instead, verbatim,
  with no normalisation and no legality check (every consumer is an
  unscoped, private npm package, so the case of a scoped name never arises):

  > ``package-build: <config file> declares `foundryPackage`, which a data configuration may not: it is the `name` of the `package.json` beside it. Remove the key.``

  If the adjacent `package.json` cannot be read, or declares no `name`:

  > `package-build: <package.json path> could not be read, and the configuration derives its Foundry package id, system version, homepage and author from it.`

  > ``package-build: <package.json path> declares no `name`, which is what the Foundry package id is derived from.``

  A `documentation` package derives nothing here: it has no Foundry package
  id, so the loader never reads `package.json` `name` for one.

- In an **`.mjs`** configuration, `foundryPackage` is an ordinary required
  key — a non-empty string, checked the same way as every other required
  string field — for a `systems` or `modules` package:

  > ``package-build config: `foundryPackage` must be a non-empty string.``

#### `homepage`

The address a package's site is served at — read by the generated Hugo
configuration for `baseURL`, independently of the Foundry manifest's own
`url`, which derives from `contentPackage` instead (see
[`packageBuild.manifest`](#packagebuildmanifest)). `null` when the package
declares none.

- In a **YAML** configuration, writing `homepage:` is refused; the loader
  reads it from the adjacent `package.json` `homepage` instead, verbatim:

  > ``package-build: <config file> declares `homepage`, which a data configuration may not: it is `package.json`'s own `homepage`. Remove the key.``

- In an **`.mjs`** configuration, `homepage` is an ordinary optional key — a
  non-empty string when declared:

  > ``package-build config: `homepage` must be a non-empty string.``

`homepage` is not itself checked against `contentPackage` by `defineConfig`.
`checkHomepage` in `config.mjs` is the check: `homepage` is required
unconditionally — every package publishes a site — and must be an absolute
URL whose path ends `/<contentPackage>/`. `content-build site` makes it
before the generated `baseURL` is written, so a missing or mismatched
`homepage` is a finding on every site build:

> ``package-build config: `homepage` is not declared in `package.json`, and every package needs one to build its site's `baseURL` from. Add `https://www.heroiclands.org/<contentPackage>/`.``

> ``package-build config: `homepage` is `https://www.heroiclands.org/harn-ensemble`, but `contentPackage` is `harnensemble` — a package's site is served at `https://www.heroiclands.org/harnensemble/`, so `package.json`'s `homepage` must end `/harnensemble/`.``

#### `author`

The package's byline, normalised from either of npm's `author` forms — a
string (`"Name <email> (url)"`, with the email and the URL both optional) or
an object (`{name, email?, url?}`) — to the object form. `null` when the
package declares none.

- In a **YAML** configuration, writing `author:` is refused; the loader reads
  it from the adjacent `package.json` `author` instead:

  > ``package-build: <config file> declares `author`, which a data configuration may not: it is `package.json`'s own `author`. Remove the key.``

- In an **`.mjs`** configuration, `author` is an ordinary optional key, in
  either form:

  > ``package-build config: `author` must be `"Name"`, `"Name <email>"`, `"Name (url)"` or `"Name <email> (url)"` — npm's own `author` forms.``

  > ``package-build config: `author` must be a string or an object with `name`, `email` and `url`.``

#### `assetRoot`

The served Foundry asset root a compiled document's `img:` is resolved
against — the one reader of it is `resolveImg`
(`engine/helpers.mjs`). Never a key an author writes; always computed from
`packageKind` and `foundryPackage`.

- For a `systems` or `modules` package, `<packageKind>/<foundryPackage>/assets`.
- For a `documentation` package, `null` — Foundry serves no files for a
  package of this kind, and `documentation/null/assets` would be an address
  that resolves nowhere. `resolveImg` refuses rather than rooting a path
  against nothing.

#### `stats.systemVersion`

The version of the game system the packs were built against, stamped into
every compiled document's `_stats.systemVersion`. `stats.systemId` is
derived the same way, from the same block — see [`stats`](#stats) for both.
Both are `null` in the resolved configuration of a `documentation` package,
which refuses `stats` outright — see [`stats`](#stats) — and so has neither
to derive.

- **A system package** (`packageKind: systems`) is its own system, so its
  `systemVersion` is its own `package.json` `version`:

  > ``package-build: <package.json path> declares no `version`, which is what a system's stats.systemVersion is derived from.``

- **A module** ships content _for_ another package's system. Its own
  `package.json` version is the module's, not the system's, so deriving from
  it would stamp a version that never existed. The honest source is
  `systems:` (preferred) or `relationships.systems` (the older form) — see
  [`systems`](#systems). Declaring neither, on a module whose packs carry no
  `system:` either, is system-agnostic on purpose and stamps no version at
  all. Declaring one without a usable `compatibility.verified` is refused:

  > ``package-build: a module's stats.systemVersion is derived from the system it declares a relationship with, and this configuration declares none usable. Add `relationships.systems` naming <system id, or "the system"> with a `compatibility.verified` version. It is not taken from this package's own `package.json` version — that is the module's version, and stamping it would claim a system version that never existed.``

- Authoring `stats.systemVersion` directly is refused by `defineConfig`
  itself, in both configuration forms — see [`stats`](#stats) for the exact
  message.

- **In an `.mjs` configuration**, this derivation is the author's own
  responsibility: `defineConfig` performs no I/O, so a code configuration
  that wants `stats.systemVersion` populated reads its own `package.json` (or
  its own `relationships.systems`) and supplies the result under the
  `DERIVED_SYSTEM_VERSION` symbol exported by `content-config.mjs`, the same
  channel `engine/pack-config.mjs` uses for a YAML configuration:

  ```js
  import { defineConfig, DERIVED_SYSTEM_VERSION } from "@heroiclands/package-build/content-config";

  export default defineConfig({
    // …
    stats: {
      lastModifiedBy: "acmebuilder00000",
      [DERIVED_SYSTEM_VERSION]: "1.6.3",
    },
  });
  ```

  A symbol, deliberately — a string key would be a second, forgeable spelling
  of the `stats.systemId` / `stats.systemVersion` keys `defineConfig` refuses
  to let an author write, reachable from plain YAML. A symbol cannot be
  written in YAML at all and does not appear in `Object.keys`, so the
  refusal has no back door. Supplying nothing here, and declaring no
  resolvable `systems:` entry either, leaves `stats.systemVersion` `null` —
  `defineConfig` raises nothing for it; a document compiled that way simply
  stamps `_stats.systemVersion: null`.

#### `itemBuilders`

Unlike the first three, authoring `itemBuilders` is not an error — it is
**translated**, in the YAML form only:

- In a **YAML** configuration, the value is a _name_ — `sohl`, `hm3` — or a
  list of names, each resolved against the registries this package ships
  (`sohl/item-builders.mjs`'s `ITEM_BUILDERS`, `hm3/item-builders.mjs`'s
  `HM3_ITEM_BUILDERS`) before `defineConfig` ever sees the result. A name
  this package does not ship is refused:

  > ``package-build: <config file> names the `itemBuilders` registry "<name>", which this package does not ship. Known registries: sohl, hm3. To supply your own, declare it in package-build.config.mjs.``

  A non-string entry — something that is not a registry name at all — is
  refused the same way:

  > ``package-build: <config file> must name its `itemBuilders` registry as a string — the registry is code, and data cannot carry it. Known registries: sohl, hm3; a registry of your own goes in package-build.config.mjs.``

- In an **`.mjs`** configuration, `itemBuilders` is the registry itself —
  real builder functions — since only code can carry a function. See
  [`itemBuilders`](#itembuilders-1) below for the shape both forms end at.

---

## The 20 keys

### `contentPackage`

**Type:** string · **Required** · no default.

The address namespace every note in this repository is published under —
the first segment of every canonical address (`contentPackage-system-type-shortcode`,
so `sohl-none-doc-gear`). Read wherever an address is built or parsed
(`engine/content-address.mjs` and everything downstream of it).

Two rules apply, both enforced here rather than assumed, because an address
is read by counting hyphen-separated segments:

- It must be **lowercase alphanumeric** — the hyphen stays purely a separator.
  A value containing one is refused:

  > ``package-build config: `contentPackage` is `harn-adventures`, which is not lowercase alphanumeric (^[a-z0-9]+$). It is the first segment of every address this package publishes (`harn-adventures-<system>-<type>-<shortcode>`), and an address is read by counting hyphen-separated segments — so anything outside that here makes those addresses unreadable rather than merely ugly. `harn-adventures` became `harnadventures`.``

- It must **not also be a note type** — the two vocabularies are disjoint,
  because a written address may drop its leading segments and
  `contentPackage-shortcode` has to read unambiguously as one or the other:

  > ``package-build config: `contentPackage` is `macro`, which is also a note type — `macro-<shortcode>` already addresses one. A written address may omit its leading segments, so `macro-<shortcode>` reads as a type and a shortcode and nothing but the two vocabularies being disjoint says which slot the name is filling. Rename the package.``

  The vocabulary checked against is the union of every note type this
  toolchain knows about — the closed format vocabulary, every consumer's
  configured `itemBuilders` types, `macro`, the map types, and the
  `doc`-prefixed form of each. `sohl` colliding with itself (the system
  package's own id is also a system id, `sohl-sohl-skill-clmb` being the
  honest result) is structural and cannot be avoided; this check exists to
  prevent every other collision, which can be.

An empty or non-string value is refused generically:

> ``package-build config: `contentPackage` must be a non-empty string.``

### `foundryPackage`

See [Derived values](#derived-values) — forbidden in a YAML configuration,
required (a non-empty string) in an `.mjs` one. Refused in either form for a
`documentation` package, which is not a Foundry package and has no Foundry
package id:

> ``package-build config: `foundryPackage` is refused in a `documentation` package, which is not a Foundry package, so it has no Foundry package id.``

### `homepage`

See [Derived values](#derived-values) — forbidden in a YAML configuration,
optional (a non-empty string) in an `.mjs` one.

### `author`

See [Derived values](#derived-values) — forbidden in a YAML configuration,
optional (either of npm's forms) in an `.mjs` one.

### `packageKind`

**Type:** `"systems"` \| `"modules"` \| `"documentation"` · **Required** · no default.

Which kind of package this repository builds. `systems` and `modules` are the
two Foundry answers — also the directory Foundry installs the package under,
and what `assetRoot` and the packaging half's `artifact` (`system` or
`module`) are derived from. `documentation` is the answer "not a Foundry
package at all": it publishes a site and a book from its notes, installs into
no Foundry data directory and compiles no compendium.

> ``package-build config: `packageKind` must be one of: systems, modules, documentation.``

`compilesFoundryDocuments(config)`, exported from `content-config.mjs`
alongside `DOCUMENTATION_KIND` and [`publishesContentPages`](#publish), is the
one question every Foundry-side reader asks — the manifest writer, to decide
whether there is a package for Foundry to install, and the pack compilers, to
decide whether there is anything to compile. It returns
`config.packageKind !== DOCUMENTATION_KIND`.

### `stats`

**Type:** object · **Required** in a `systems` or `modules` package · refused
in a `documentation` package, which compiles no documents and so has no
`_stats` block to stamp:

> ``package-build config: `stats` is refused in a `documentation` package, which compiles no documents, so there is no `_stats` block to stamp.``

The identity stamped into every compiled document's `_stats` block.
`coreVersion` is **not** here — that is the top-level `compatibility.minimum`,
stamped from one place rather than duplicated.

| Key                    | Type   | Required      | Default |
| ---------------------- | ------ | ------------- | ------- |
| `stats.lastModifiedBy` | string | yes           | —       |
| `stats.systemId`       | —      | **forbidden** | derived |
| `stats.systemVersion`  | —      | **forbidden** | derived |

`stats.lastModifiedBy` is the 16-character id every compiled document is
stamped as authored by. An empty or missing value is refused generically:

> ``package-build config: `stats.lastModifiedBy` must be a non-empty string.``

`stats.systemId` and `stats.systemVersion` are **derived and may not be
authored**, in both configuration forms — `defineConfig` itself refuses them,
before either loader has a chance to supply its own derivation:

> ``package-build config: `stats.systemId` is derived and may not be authored. A system package is its own system; a module takes it from `requiresSystem`, or from `systems:` when it declares exactly one. Remove the key.``

> ``package-build config: `stats.systemVersion` is derived and may not be authored. It is the `compatibility.verified` of the system in `systems:`, or a system package's own `package.json` version. Remove the key.``

See [`stats.systemVersion`](#statssystemversion) under Derived values for how
each is actually resolved.

Any other key under `stats` is refused:

> ``package-build config: `stats.<key>` is not a recognized option (expected one of: lastModifiedBy).``

### `itemBuilders`

**Type:** object (`{type: builder}`), or a list of `{system, builders}`
registries — or, in YAML only, a registry **name** (`sohl`, `hm3`) or list of
names · **Optional** · default `{}`. Refused in a `documentation` package,
which compiles no items and so has no item-type registry to name:

> ``package-build config: `itemBuilders` is refused in a `documentation` package, which compiles no items, so there is no item-type registry to name.``

The consumer's item-type registry: each content `type` that compiles into an
Item, paired with the builder function producing its `system` block. A
content module that ships no items declares none.

**Single-registry form** — what almost every configuration declares. Each
entry is either a bare builder function, or that function paired with the
type's default art and the frontmatter fields it declares:

```yaml
itemBuilders: sohl # YAML: a name naming a shipped registry
```

```js
itemBuilders: {          // .mjs: the registry itself
    relic: { system: buildRelic, img: "icons/relic.svg", fields: [...] },
    charm: buildCharm,   // a bare builder — every note of the type needs its own `img:`
}
```

| Key (under `itemBuilders.<type>`) | Type                        | Required | Default               |
| --------------------------------- | --------------------------- | -------- | --------------------- |
| `itemBuilders.<type>.system`      | function                    | yes      | —                     |
| `itemBuilders.<type>.img`         | string                      | no       | none (no default art) |
| `itemBuilders.<type>.fields`      | array of field declarations | no       | none                  |

An entry that is neither a function nor an object with a `system` builder is
refused:

> ``package-build config: `itemBuilders.<type>` must be a builder function, or an object with a `system` builder.``

> ``package-build config: `itemBuilders.<type>.system` must be a function.``

Each entry of `itemBuilders.<type>.fields` must be an object declaring a
`to`:

> ``package-build config: `itemBuilders.<type>.fields[<index>]` must be a field declaration object.``

> ``package-build config: `itemBuilders.<type>.fields[<index>].to` must be a non-empty string.``

Any other key under one entry is refused:

> ``package-build config: `itemBuilders.<type>.<key>` is not a recognized option (expected one of: system, img, fields).``

**List-of-registries form** — for a repository feeding more than one system
(`harn-ensemble` ships an HM3 pack, a SoHL pack, and a system-neutral one).
The accepted type vocabulary is the **union** of the registries' keys; a
type more than one registry declares keeps a builder per system rather than
one winning in silence, and is tracked separately as
`itemTypesBySeveralSystems` in the resolved configuration.

```yaml
itemBuilders: [sohl, hm3] # YAML
```

```js
itemBuilders: [
  // .mjs
  { system: "sohl", builders: { skill: buildSohlSkill } },
  { system: "hm3", builders: { skill: buildHm3Skill } },
];
```

| Key (under `itemBuilders[]`) | Type                                           | Required | Default |
| ---------------------------- | ---------------------------------------------- | -------- | ------- |
| `itemBuilders[].system`      | string                                         | yes      | —       |
| `itemBuilders[].builders`    | object, same shape as the single-registry form | yes      | —       |

Declaring the same system twice is refused:

> ``package-build config: `itemBuilders[<index>]` declares a second registry for `<system>` — a system has one item vocabulary, so merge them at their source.``

An entry that is not `{system, builders}` is refused:

> ``package-build config: `itemBuilders[<index>]` must be `{ system, builders }` — a registry and the system it belongs to.``

Any other key on one list entry is refused:

> ``package-build config: `itemBuilders[<index>].<key>` is not a recognized option (expected one of: system, builders).``

See [`itemBuilders`](#itembuilders) under Derived values for how the YAML
name form resolves before reaching here.

### `paths`

**Type:** object · **Optional** · every key defaults to the conventional
HeroicLands layout, resolved against `rootDir`:

| Key                     | Default                  | What it is                                                                                      |
| ----------------------- | ------------------------ | ----------------------------------------------------------------------------------------------- |
| `paths.content`         | `assets/content`         | The content tree root.                                                                          |
| `paths.assets`          | `assets`                 | The asset roots' parent, holding `icons/`, `images/` and `audio/`.                              |
| `paths.contentIndex`    | `build/content-index`    | Where `content-index` writes this package's note index. Derived and disposable.                 |
| `paths.packJson`        | `build/packs-json`       | Build-only per-entry JSON intermediate.                                                         |
| `paths.stage`           | `build/stage/packs`      | Compiled LevelDB packs.                                                                         |
| `paths.unpack`          | `build/tmp/packs`        | Where `unpack` extracts JSON back to.                                                           |
| `paths.foreignCache`    | `build/cache/foreign`    | Where a dependency declaring `itemCatalog: true` is unpacked.                                   |
| `paths.metadataCache`   | `build/cache/metadata`   | Where a dependency's published content index is fetched to, for every declared dependency.      |
| `paths.navigationCache` | `build/cache/navigation` | Where the site navigation heroiclands.org publishes is fetched to, for the generated Hugo menu. |

Every configured path must be **relative** — an absolute one would escape
the repository the config anchors:

> ``package-build config: `paths.<key>` must be relative to rootDir, so a consumer's layout travels with its repository.``

An empty value is refused generically:

> ``package-build config: `paths.<key>` must be a non-empty string.``

Any other key is refused:

> ``package-build config: `paths.<key>` is not a recognized option (expected one of: content, assets, contentIndex, packJson, stage, unpack, foreignCache, metadataCache, navigationCache).``

### `skipDirectories`

**Type:** string[] · **Optional** · default `[]`.

Directory names the content walk ignores wherever they appear — Obsidian's
`Templates`, for instance.

```yaml
skipDirectories: [Templates]
```

> ``package-build config: `skipDirectories` must be an array.``

> ``package-build config: `skipDirectories[<index>]` must be a non-empty string.``

### `icons`

**Type:** object (`{families, icons, defaultFamily?}`), or a string naming a
file holding one, relative to the configuration · **Optional** · default: an
empty registry (`{families: {}, defaultFamily: undefined, icons: {}}`) —
nothing is supplied by default, because a registry entry is a promise that a
glyph will render and only the package shipping the font can keep it.

```yaml
# inline
icons:
  families:
    fontawesome: { class: fa, styles: [solid, regular, brands], describe: Font Awesome Free }
  icons:
    being: { style: solid, icon: user, label: being }
```

```yaml
# or a path to a generated file — the shape a real package wants, since the
# registry is derived from what the interface actually draws
icons: assets/icon-registry.yaml
```

A bare string that is empty is refused:

> ``package-build config: `icons` is empty — name a file, or write the registry inline.``

A named file that cannot be read, or does not parse as YAML, or parses to
nothing, is refused:

> ``package-build config: `icons` names <file>, which cannot be read from <rootDir>.``

> ``package-build config: `icons` names <file>, which is not readable YAML: <parser error>.``

> ``package-build config: `icons` names <file>, which is empty.``

A value that is neither a registry nor a file path is refused:

> ``package-build config: `icons` must be a registry — `families` and `icons` — or a path to a file holding one.``

Within the registry (inline or loaded from file):

| Key                   | Type                             | Required | Default |
| --------------------- | -------------------------------- | -------- | ------- |
| `icons.families`      | object (name → family)           | no       | `{}`    |
| `icons.icons`         | object (name → icon entry)       | no       | `{}`    |
| `icons.defaultFamily` | string, naming a declared family | no       | none    |

> ``package-build config: `icons.families` must be a mapping of name to family.``

> ``package-build config: `icons.icons` must be a mapping of name to icon entry.``

Every icon name is checked against the charset a note may write between the
colons — lowercase letters, digits and hyphens, the same charset an address
segment uses:

> ``package-build config: `icons.icons.Bad_Name` is not a name a note can write — `:icon-…:` takes lowercase letters, digits and hyphens, the charset an address segment uses.``

`defaultFamily`, if set, must name a family the registry actually declares:

> ``package-build config: `icons.defaultFamily` names `<name>`, which is not one of the declared families.``

The registry is then checked by `engine/content-icons.mjs`'s
`checkIconRegistry` — elsewhere in the toolchain its findings are warnings;
here, because this is the table every note in the package is read against,
any finding it reports is a refusal, joined into one message:

> ``package-build config: `icons` <findings, semicolon-joined>.``

### `packs`

**Type:** array of pack specs · **Required, at least one entry**, in a
`systems` or `modules` package. Refused in a `documentation` package, which
compiles no compendium and so has no packs to declare:

> ``package-build config: `packs` is refused in a `documentation` package, which compiles no compendium, so there are no packs to declare.``

The compendium packs the build compiles, named exactly as declared in the
package manifest's `packs` array. Several packs may share a `type` — a
note's `pack:` frontmatter then names which one it belongs to, and at most
one pack of a type is marked `default: true` to receive the notes that name
none.

```yaml
packs:
  - { name: items, type: Item }
  - { name: journals, type: JournalEntry, label: Journals }
```

| Key (under `packs[]`) | Type                                                                  | Required | Default                                 |
| --------------------- | --------------------------------------------------------------------- | -------- | --------------------------------------- |
| `packs[].name`        | string                                                                | yes      | —                                       |
| `packs[].type`        | one of `Actor`, `Adventure`, `Item`, `JournalEntry`, `Macro`, `Scene` | yes      | —                                       |
| `packs[].label`       | string                                                                | no       | `packs[].name`                          |
| `packs[].private`     | boolean                                                               | no       | `false`                                 |
| `packs[].companions`  | array, same shape, one level only                                     | no       | `[]`                                    |
| `packs[].mayBeEmpty`  | boolean                                                               | no       | `false`                                 |
| `packs[].default`     | boolean                                                               | no       | `false`                                 |
| `packs[].prebuilt`    | string (directory)                                                    | no       | `null`                                  |
| `packs[].system`      | string                                                                | no       | `null` — falls back to `stats.systemId` |

`packs` itself:

> ``package-build config: `packs` must be an array.``

A package may declare **no** packs. A module that ships assets and compiles
nothing — alternative art for another package is the case — writes `packs: []`,
and the manifest carries an empty pack list.

Two packs (including companions, anywhere in the tree) may not share a name
— two packs both named `x` produce:

> ``package-build config: `packs` declares the pack `x` more than once.``

At most one pack of a given `type` may be marked default — two Item packs
`a` and `b` both marked `default: true` produce:

> ``package-build config: `packs` marks both `a` and `b` as the default Item pack; a note declaring no `pack:` must have one destination.``

`packs[].type` is checked against the closed set of document types this
toolchain compiles:

> ``package-build config: `packs[<index>].type` must be one of: Actor, Adventure, Item, JournalEntry, Macro, Scene.``

`folders` is retired — a folder is a note (`type: folder`) now, materialised
by the pack whose documents reference it through `packFolder`:

> ``package-build config: `packs[<index>].folders` is retired — delete it. A folder is a note (`type: folder`) now, and a pack materialises the folders its documents reference through `packFolder`, so there is no per-pack hierarchy file to name.``

A **companion** — a pack written by its parent pack's own compile pass — may
not declare `default` (no note is ever routed into one), and may not nest
further companions of its own:

> ``package-build config: `packs[<index>].companions[<index>].default` may not be declared on a companion: a companion is written by another pack's pass, so no note is ever routed into one.``

> ``package-build config: `packs[<index>].companions[<index>].companions` may not nest: a companion is written by another pack's pass, and that pass is the only level of indirection the build has.``

A **prebuilt** pack (its per-document JSON already exists) has no compile
pass, so it may not also be a companion, may not declare companions of its
own, and may not be `default`:

> ``package-build config: `packs[<index>].prebuilt` may not be declared on a companion: a companion is written by another pack's pass, and a prebuilt pack has no pass.``

> ``package-build config: `packs[<index>].companions` may not accompany `prebuilt`: a companion is written by this pack's pass, and a prebuilt pack has none.``

> ``package-build config: `packs[<index>].default` may not accompany `prebuilt`: the default pack receives notes declaring no `pack:`, and no note is routed into a prebuilt one.``

`packs[].system` — every document in a pack is stamped `_stats.systemId` and
`systemVersion`, and Foundry hides a whole package from any world whose
system `requiresSystem` does not name, so a pack's declared `system:` must
resolve to something real. A pack `x` naming `system: sohl` in a package
with no `systems:` block, whose own `foundryPackage` is `acme`, produces:

> ``package-build config: `packs.x.system` names `sohl`, which `systems:` does not declare — the `systems:` block is empty or absent, and which is not this package's own system `acme`. Every document in the pack is stamped `_stats.systemId` and `systemVersion` from one of those two, so with neither it would be stamped null. Add `systems:` naming `sohl` with a `compatibility.verified` version.``

A pack naming a `system:` other than the one `requiresSystem` names — the
pack could never be seen, since Foundry hides the whole package from any
world whose system `requiresSystem` does not name:

> ``package-build config: `packs.<name>.system` names `<system>` while `requiresSystem` is `<other>`, so this pack could never be seen — Foundry hides the whole package from any world whose system `requiresSystem` does not name. Drop `requiresSystem`, or correct the pack.``

Any other key on a pack entry is refused:

> ``package-build config: `packs[<index>].<key>` is not a recognized option (expected one of: name, type, label, private, companions, mayBeEmpty, default, prebuilt, system).``

### `docs`

**Type:** object · **Optional** · default `{}`. Refused in a `documentation`
package, which compiles no items and so has no item-field reference pages to
frame:

> ``package-build config: `docs` is refused in a `documentation` package, which compiles no items, so there are no item-field reference pages to frame.``

How this repository frames the documentation pages it generates.

| Key               | Type   | Required | Default |
| ----------------- | ------ | -------- | ------- |
| `docs.itemFields` | object | no       | `{}`    |

> ``package-build config: `docs` must be a mapping.``

> ``package-build config: `docs.<key>` is not a recognized option (expected one of: itemFields).``

`docs.itemFields` frames the item-frontmatter reference rendered by
`content-build docs item-fields` — the tables come from the `itemBuilders`
registry and are the same wherever rendered; everything here is the
consumer's: heading, orientation, where the page is filed.

| Key                           | Type     | Required | Default                                                                |
| ----------------------------- | -------- | -------- | ---------------------------------------------------------------------- |
| `docs.itemFields.title`       | string   | no       | none — the page's H1                                                   |
| `docs.itemFields.out`         | string   | no       | none — without it, the page goes to stdout                             |
| `docs.itemFields.preamble`    | string[] | no       | none — markdown lines between the generated banner and the first table |
| `docs.itemFields.frontmatter` | object   | no       | none — extra note frontmatter, deep-merged over the generated envelope |

> ``package-build config: `docs.itemFields` must be a mapping.``

> ``package-build config: `docs.itemFields.title` must be a non-empty string.``

`preamble` is a list of lines, and a blank entry is a meaningful blank line
— markdown's paragraph separator — so the check is on type, not content:

> ``package-build config: `docs.itemFields.preamble` must be a list of lines — a blank entry is a blank line, which is how paragraphs are separated in markdown.``

> ``package-build config: `docs.itemFields.preamble[<index>]` must be a string.``

`frontmatter` is deep-merged over the note envelope written when `out` is
under the content tree — see [`content-build docs item-fields`](commands.md#content-build-docs-item-fields):

> ``package-build config: `docs.itemFields.frontmatter` must be a mapping.``

Any other key under `docs.itemFields` is refused:

> ``package-build config: `docs.itemFields.<key>` is not a recognized option (expected one of: title, out, preamble, frontmatter).``

### `site`

**Type:** object · **Optional** · every key defaults to nothing published:

| Key                | Type     | Default                                     |
| ------------------ | -------- | ------------------------------------------- |
| `site.base`        | string   | `""`                                        |
| `site.assets`      | string   | `""`, but required for `content-build site` |
| `site.description` | string   | `""`, but required for `content-build site` |
| `site.packages`    | string[] | `[]`                                        |
| `site.pass`        | string   | `""`                                        |
| `site.passOptions` | object   | `{}`                                        |
| `site.notfound`    | object   | `null`                                      |
| `site.hugo`        | object   | `{}`                                        |

How much of a package reaches the web at all is **not** here — it is
[`publish.site`](#publish). `site` is framing: which named pass bundle
supplies the repository's own body rewrites, and the residue of the
[generated Hugo configuration](#the-generated-hugo-configuration) that is
genuinely this repository's own.

**A site is its homepage and its pages.** The `type: homepage` note is the
package's front page at `/<contentPackage>/`, and every other note is one page
at `/<contentPackage>/<type>-<shortcode>/`. Nothing is generated between
them: no section directory, no listing of a type, no tag page. Every
structure above the pages — which notes belong together, in what order,
under which headings — is authored, as a `doc` note carrying a content table
over the content index, and linked from the homepage like any other page.

So a page of documentation is a note — `type: doc`, addressed by its
shortcode, and `pack: none` where it compiles into no Foundry document — and
there is no second mechanism for mounting a directory of markdown. A
configuration that names one is refused with a message saying where the page
goes instead:

> ``package-build config: `site.trees` is retired — a page is a note in the content tree. Give each page `type: doc`, a `shortcode` and `pack: none`, file it under `assets/content/`, and link it from the homepage or from a `doc` note that indexes it.``

> ``package-build config: `site.readmeSections` is retired — a page is a note in the content tree. Give each page `type: doc`, a `shortcode` and `pack: none`, file it under `assets/content/`, and link it from the homepage or from a `doc` note that indexes it.``

A configuration that asks the build to generate an index between the
homepage and the pages is refused the same way, by name and with one message
— `site.sections` (and the `listType` / `listSubType` an entry carried),
`site.landing`, `site.backfillSections` and `site.list` alike, since how a
listing renders is a content table's to say:

> ``package-build config: `site.sections` is retired — a site is its homepage and its pages, and any index between them is a `doc` note: write one with `type: doc`, a `shortcode` and `pack: none`, carrying a content table over the notes it lists, and link it from the homepage. Nothing is generated between the homepage and the pages, so delete the key.``

> ``package-build config: `site.landing` is retired — a site is its homepage and its pages, and any index between them is a `doc` note: write one with `type: doc`, a `shortcode` and `pack: none`, carrying a content table over the notes it lists, and link it from the homepage. Nothing is generated between the homepage and the pages, so delete the key.``

> ``package-build config: `site.backfillSections` is retired — a site is its homepage and its pages, and any index between them is a `doc` note: write one with `type: doc`, a `shortcode` and `pack: none`, carrying a content table over the notes it lists, and link it from the homepage. Nothing is generated between the homepage and the pages, so delete the key.``

> ``package-build config: `site.list` is retired — a site is its homepage and its pages, and any index between them is a `doc` note: write one with `type: doc`, a `shortcode` and `pack: none`, carrying a content table over the notes it lists, and link it from the homepage. Nothing is generated between the homepage and the pages, so delete the key.``

Where the Hugo tree is written is not a choice. `content-build site` writes
the whole Hugo source tree under `build/hugo/` — the generated `hugo.toml`,
the content mount at `build/hugo/content/`, Hugo's own cache — as a sibling
of the deployment root `build/site/`, so nothing Hugo reads lands in what is
published. A `site.out` is refused by name:

> ``package-build config: `site.out` is retired — the site build writes its content mount at `build/hugo/content`, beside the generated `hugo.toml`, and the location is not configurable. Remove the key.``

> ``package-build config: `site` must be a mapping.``

> ``package-build config: `site.<key>` is not a recognized option (expected one of: base, assets, description, packages, pass, passOptions, notfound, hugo).``

`site.assets` is the host every package's imagery is served from, and it is
the one address in this file that is not this repository's own. A note names
a file by the package that owns it and the path inside that package's
`assets/` (see `docs/content-format.md`), and the website joins the two onto
this host — `https://cdn.heroiclands.org` + `/thalorna` +
`/images/map.webp`. A build has no way to find the host out, so a page
carrying a package-owned image with none set is an error naming this key.
Absolute, and the trailing slash is trimmed:

> ``package-build config: `site.assets` must be an absolute `http://` or `https://` address — it is the host every package's imagery is served from, and a relative value resolves against whichever page happens to carry the image.``

`content-build site` refuses to generate a configuration with no
`site.assets` at all — there is no defensible default, because the theme
resolves every relative asset against it:

> ``package-build config: `site.assets` is not declared, and a site build needs one — it is the host every package's imagery is served from, and the theme resolves every relative asset against it.``

The generated Hugo configuration carries the same host as
`params.cdnBaseURL`, which the theme resolves a relative asset path against.
The two are one value read by two readers: the toolchain emits it into a
page, and the theme joins it onto anything the toolchain left relative.

`site.description` is the site's `<meta name="description">` — one plain
sentence, distinct from the Foundry package browser's pitch
([`packageBuild.manifest.descriptionHtml`](#packagebuildmanifest), which
allows HTML). Required for `content-build site`, the way `packageBuild.manifest.title`
is:

> ``package-build config: `site.description` is not declared, and the site's `<meta name="description">` reads from it.``

Markup belongs in `descriptionHtml`, not here — a value containing `<` is
refused:

> ``package-build config: `site.description` contains `<` — this is plain text for the site's `<meta name="description">`; markup belongs in `packageBuild.manifest.descriptionHtml`.``

`site.packages` names which content packages' notes the site walks, beyond
this one's own; `site.pass` names a repository's own body-rewrite bundle
(the one part of the site contract that is code, exactly as `itemBuilders`
names a registry):

> ``package-build config: `site.packages` must be a list.``

> ``package-build config: `site.packages[<index>]` must be a non-empty string.``

`site.passOptions` has no further shape of its own — it is passed to the
resolved `site.pass` bundle unchanged.

`site.notfound` is the wording of the "page not found" page, written into
the generated Hugo configuration as `params.notfound`. The theme renders
the page for every site; what a repository supplies is the tagline, the
noun the body prose calls the site, and the routes back. `tagline` and
`sitenoun` are required once the block is present — a block declaring only
links would render the theme's generic wording above this site's routes,
which reads as two sites:

| Key                           | Type   | Required | Default                                                                 |
| ----------------------------- | ------ | -------- | ----------------------------------------------------------------------- |
| `site.notfound.tagline`       | string | yes      | —                                                                       |
| `site.notfound.sitenoun`      | string | yes      | —                                                                       |
| `site.notfound.heroimage`     | string | no       | none — the theme's default banner, resolved against `params.cdnBaseURL` |
| `site.notfound.links`         | array  | no       | none — no list of routes back                                           |
| `site.notfound.links[].title` | string | yes      | —                                                                       |
| `site.notfound.links[].url`   | string | yes      | — site-relative (`/`, `/polity/`) or absolute                           |
| `site.notfound.links[].text`  | string | yes      | —                                                                       |

```yaml
site:
  notfound:
    tagline: This module has one page, and it is not at
    sitenoun: module
    heroimage: images/banners/tapestry-of-dreams.webp
    links:
      - title: Thalorna
        url: https://www.heroiclands.org/thalorna/
        text: The setting whose artwork this module replaces.
```

> ``package-build config: `site.notfound` must be a mapping.``

> ``package-build config: `site.notfound.tagline` must be a non-empty string.``

> ``package-build config: `site.notfound.links` must be a list.``

> ``package-build config: `site.notfound.links[<index>].url` must be a non-empty string.``

> ``package-build config: `site.notfound.<key>` is not a recognized option (expected one of: tagline, sitenoun, heroimage, links).``

> ``package-build config: `site.notfound.links[<index>].<key>` is not a recognized option (expected one of: title, url, text).``

`site.hugo` is a mapping deep-merged over the generated Hugo configuration,
last — the escape hatch for the one key nobody anticipated. A repository
whose homepage reproduces a notice whose bare URLs must stand unedited turns
Goldmark's autolinker off:

```yaml
site:
  hugo:
    markup:
      goldmark:
        extensions:
          linkify: false
```

Objects merge; an array or a scalar replaces what the generator wrote. Every
key the generator writes is refused here, naming its source — see
[the generated Hugo configuration](#the-generated-hugo-configuration) — so
the block cannot grow into a second configuration file:

> ``package-build config: `site.hugo` must be a mapping.``

> ``package-build config: `site.hugo.baseURL` is derived from package.json `homepage` and must not be declared — it would be overwritten, and the two would disagree with nothing to say so.``

### The generated Hugo configuration

`content-build site` writes `build/hugo/hugo.toml` on every run. Every value
in it has one source, and that source is where it is edited:

| Key                               | Derived from                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseURL`                         | `package.json` `homepage`, checked by `checkHomepage` — an absolute URL ending `/<contentPackage>/`                                                     |
| `title`                           | `packageBuild.manifest.title`, which is required                                                                                                        |
| `locale`                          | the organisation's locale, `en-us`, in `engine/site-config.mjs`                                                                                         |
| `publishDir`                      | `contentPackage`, under the deployment root `build/site` — written relative to `build/hugo/`, so `../site/<contentPackage>`                             |
| `contentDir`                      | the fixed content mount, `build/hugo/content` — written as `content`                                                                                    |
| `themesDir`                       | where `@heroiclands/hugo-theme` is installed, resolved the way Node resolves a package and written relative to `build/hugo/`                            |
| `theme`                           | the installed `@heroiclands/hugo-theme`, so `hugo-theme`                                                                                                |
| `disableKinds`                    | the toolchain, which renders a site as its homepage and its pages: `["section", "taxonomy", "term", "RSS"]` on every site, whatever its notes carry     |
| `taxonomies`                      | the toolchain — never written, because `taxonomy` and `term` are disabled kinds                                                                         |
| `outputs`                         | the toolchain — never written, because every listing kind is disabled                                                                                   |
| `params.description`              | `site.description`, which is required                                                                                                                   |
| `params.author`                   | `package.json` `author`, its `name`; absent when the package declares none                                                                              |
| `params.cdnBaseURL`               | `site.assets`, which is required                                                                                                                        |
| `params.brand`                    | the organisation's brand links — `logo`, `licenseURL`, `discordURL` — in `engine/site-config.mjs`                                                       |
| `params.notfound`                 | `site.notfound`; absent when undeclared                                                                                                                 |
| `markup.goldmark.renderer.unsafe` | the toolchain, whose pages carry raw HTML — a `<figure>` for every image, a `<span>` marking an unresolved link                                         |
| `menu`                            | the navigation `content-build deps fetch` caches from `https://www.heroiclands.org/nav.json`, entry for entry, a dropdown's entries as `parent` entries |

The site build reads the navigation from the cache only. A cold cache is an
error naming the command that fills it:

> `the site navigation has not been fetched. Run `content-build deps fetch` first.`

A missing theme names the package to install:

> `@heroiclands/hugo-theme is not installed anywhere above <rootDir> — add it to `devDependencies`and run`npm ci``

And a site's title reads from the manifest's, so a configuration declaring
none fails the site build:

> ``package-build config: `packageBuild.manifest.title` is not declared, and the site's `title` reads from it.``

`params.description` reads from `site.description` the same way, and fails
the same way when it is absent:

> ``package-build config: `site.description` is not declared, and the site's `<meta name="description">` reads from it.``

`params.cdnBaseURL` reads from `site.assets`, and the theme resolves every
relative asset against it, so a configuration declaring none fails the site
build the same way:

> ``package-build config: `site.assets` is not declared, and a site build needs one — it is the host every package's imagery is served from, and the theme resolves every relative asset against it.``

Nothing else is emitted. `home` and `page` are the only kinds a site
renders: the homepage is the mount's `_index.md`, every note is a page, and
`section`, `taxonomy`, `term` and `RSS` are disabled on every site — so no
`[taxonomies]` or `[outputs]` is written, Hugo's default taxonomy pair never
applies, and a note's `tags:` reach the page's front matter and nothing
else. A tag is a field a content table filters on, not a page of its own.
Every other key is `site.hugo`'s to add.

### `pdf`

**Type:** object · **Optional** · default `null` (no book is built).

The content tree published as a book — a **selection**, not a rendering of
everything: `pdf.document` names the tree that says which notes the volume
carries and in what order, parsed by `engine/pdf-toc.mjs`'s
`parseDocumentTree` and not validated here. Whether a book is built at all
is [`publish.site`](#publish), the same switch that gates the website —
`content` builds one, `homepage` does not, so a package cannot end up with
two switches that disagree about whether it publishes its content tree.

```yaml
pdf:
  title: The Hârn Ensemble
  document: book.yaml
  fonts:
    serif: Libertinus Serif
    mono: DejaVu Sans Mono
```

| Key             | Type                        | Required | Default                |
| --------------- | --------------------------- | -------- | ---------------------- |
| `pdf.title`     | string                      | yes      | —                      |
| `pdf.document`  | string (path)               | yes      | —                      |
| `pdf.subtitle`  | string                      | no       | `""`                   |
| `pdf.out`       | string                      | no       | `""`                   |
| `pdf.front`     | string[] (markdown files)   | no       | `[]`                   |
| `pdf.fonts`     | object                      | no       | all empty              |
| `pdf.iconFonts` | object (family → font file) | no       | `{}`                   |
| `pdf.binary`    | string                      | no       | `""` — found on `PATH` |

`pdf.title` and `pdf.document` are required **together** — a document with
no title produces a file whose name and cover say nothing about what a
reader downloaded, and a title with no document has nothing to print:

> ``package-build config: `pdf.title` must be a non-empty string.``

> ``package-build config: `pdf.document` must be a non-empty string.``

> ``package-build config: `pdf` must be a mapping.``

> ``package-build config: `pdf.front` must be a list of markdown files.``

`pdf.fonts` names font **families**, not files — the renderer asks the font
stack for a family by name:

| Key (under `pdf.fonts`) | Type          | Required | Default                                                   |
| ----------------------- | ------------- | -------- | --------------------------------------------------------- |
| `pdf.fonts.serif`       | string        | no       | `""` — the book is set in `Libertinus Serif`              |
| `pdf.fonts.sans`        | string        | no       | `""` — its headings in `Libertinus Sans`                  |
| `pdf.fonts.mono`        | string        | no       | `""` — its raw and code spans in `DejaVu Sans Mono`       |
| `pdf.fonts.path`        | string (path) | no       | `""` — faces of your own, searched as well as the shipped |

Each role falls back to a face that resolves on a machine carrying none of them:
the toolchain ships the sans and the compiler embeds the other two. The compile
searches the shipped directory, and `pdf.fonts.path` when one is given, and
nothing the machine has installed — so a face named here has to come from one of
those two places, and a name nothing resolves is reported rather than set in the
fallback. Shipped alongside the sans, and available to a package that names it,
is `Libertinus Mono`.

> ``package-build config: `pdf.fonts` must be a mapping.``

> ``package-build config: `pdf.fonts.<key>` is not a recognized option (expected one of: serif, sans, mono, path).``

`pdf.iconFonts` maps an icon family to the **font file** carrying its
glyphs — a file rather than a codepoint, since the font's own tables are
the only trustworthy source of which glyph a name resolves to:

> ``package-build config: `pdf.iconFonts` must be a mapping of icon family to font file.``

`pdf.binary` names the Typst binary when it is not simply `typst` on
`PATH` — bundling a native compiler would put a platform-specific artefact
in the dependency tree of every repository, most of which do not build
books.

Any other key on `pdf` is refused:

> ``package-build config: `pdf.<key>` is not a recognized option (expected one of: title, subtitle, document, out, front, fonts, iconFonts, binary).``

### `compatibility`

**Type:** object · **Optional** · default `null`. Refused in a
`documentation` package, which installs into no Foundry data directory and so
has no Foundry core range to support:

> ``package-build config: `compatibility` is refused in a `documentation` package, which installs into no Foundry data directory, so there is no Foundry core range to support.``

The **Foundry core** version range this package supports — not to be
confused with `relationships.systems[].compatibility` or
`systems.<id>.compatibility`, which are a _game system's_ range. Same key
name, different subject. `compatibility.minimum` is stamped into every
compiled document as `_stats.coreVersion`, so a document never claims to
predate the migrations that would rewrite it; `compatibility.verified`
names the newest build the full suite has actually passed, never an
aspiration.

```yaml
compatibility: { minimum: "14.359", verified: "14.364" }
```

| Key                      | Type   | Required                               | Default |
| ------------------------ | ------ | -------------------------------------- | ------- |
| `compatibility.minimum`  | string | yes, once `compatibility:` is declared | —       |
| `compatibility.verified` | string | no                                     | none    |

> ``package-build config: `compatibility` must be a mapping.``

> ``package-build config: `compatibility.minimum` must be a non-empty string.``

> ``package-build config: `compatibility.<key>` is not a recognized option (expected one of: minimum, verified).``

`compatibility` itself is optional at this validation layer — absent for a
content-only consumer, which has none to invent — but a repository that
compiles any pack needs one in practice: reading the floor throws, at
compile time rather than at configuration time, without it:

> ``package-build: the configuration declares no `compatibility.minimum`, so compiled documents have no honest core version to stamp. Declare it at the top level of package-build.config.yaml.``

### `relationships`

**Type:** object · **Optional** · default `{}`. Refused in a `documentation`
package, which is not a Foundry package and so stands in no relationship to
one:

> ``package-build config: `relationships` is refused in a `documentation` package, which is not a Foundry package, so it stands in no relationship to one.``

What this package declares about other packages, in Foundry's own shape.
Passed through to the shipped manifest, and read here for one derivation: a
module's `_stats.systemVersion` can come from the `verified` field of the
system relationship it declares — see [`stats.systemVersion`](#statssystemversion).

| Key                        | Type  | Required |
| -------------------------- | ----- | -------- |
| `relationships.systems`    | array | no       |
| `relationships.requires`   | array | no       |
| `relationships.recommends` | array | no       |
| `relationships.conflicts`  | array | no       |

> ``package-build config: `relationships` must be a mapping.``

> ``package-build config: `relationships.<kind>` must be a list.``

> ``package-build config: `relationships.<kind>` is not a recognized option (expected one of: systems, requires, recommends, conflicts).``

Each entry, in any of the four lists:

| Key (under `relationships.<kind>[]`)     | Type                            | Required | Default |
| ---------------------------------------- | ------------------------------- | -------- | ------- |
| `relationships.systems[].id`             | string                          | yes      | —       |
| `relationships.systems[].contentPackage` | string                          | no       | the id  |
| `relationships.systems[].type`           | string                          | no       | none    |
| `relationships.systems[].manifest`       | string                          | no       | none    |
| `relationships.systems[].compatibility`  | object, `{minimum?, verified?}` | no       | none    |
| `relationships.systems[].itemCatalog`    | boolean                         | no       | `false` |
| `relationships.systems[].contentIndex`   | boolean                         | no       | `true`  |

(the same keys apply under `requires[]`, `recommends[]` and
`conflicts[]`.)

> ``package-build config: `relationships.<kind>[<index>]` must be a mapping.``

> ``package-build config: `relationships.<kind>[<index>].id` must be a non-empty string.``

> ``package-build config: `relationships.<kind>[<index>].<key>` is not a recognized option (expected one of: id, contentPackage, type, manifest, compatibility, itemCatalog, contentIndex).``

`contentPackage` names what the other package's _content_ is called, where
that differs from its Foundry id. A note addresses a file by the content
package that owns it — `thalorna/assets/images/map.webp` — and the Foundry id
(`sohl-thalorna`) appears only in the install path that pathname resolves to.
Omit it where the two are the same word, which they are for every system:

> ``package-build config: `relationships.<kind>[<index>].contentPackage` must be a non-empty string.``

`itemCatalog` opts into extracting the named package's Item packs so the
actors pass can resolve embedded items this repository does not hold — off
by default, since depending on a package is not the same as needing its
item catalogue at build time. It requires a `manifest`:

> ``package-build config: `relationships.<kind>[<index>].itemCatalog` must be true or false.``

> ``package-build config: `relationships.<kind>[<index>].itemCatalog` needs a `manifest` naming the package to fetch.``

`contentIndex` and `itemCatalog` are the two edges a relationship may declare,
and a package may have either without the other. `itemCatalog` says a
dependency supplies _items_; `contentIndex`, `true` by default, says
`deps fetch` fetches its published note index and this tree may cite its
addresses by wikilink. Declaring `contentIndex: false` narrows the
relationship to the Foundry manifest only — a dependency Foundry installs but
this tree never cites — so `deps fetch` fetches nothing for it and a wikilink
into it fails, naming the key, rather than resolving against a stale
declaration or an index nobody fetched:

> ``package-build config: `relationships.<kind>[<index>].contentIndex` must be true or false.``

> ``package-build config: `relationships.<kind>[<index>].contentIndex` cannot be false together with `itemCatalog: true` — a catalogue is fetched from the same index.``

### `systems`

**Type:** object (`{id: spec}`) · **Optional** · default `{}`. Refused in a
`documentation` package, which compiles no documents and so ships content for
no game system:

> ``package-build config: `systems` is refused in a `documentation` package, which compiles no documents, so it ships content for no game system.``

The systems this package can stamp content against — **declaration only**,
not a restriction. Declaring a system here does not narrow which worlds can
load the package; only [`requiresSystem`](#requiressystem) does that. A
repository shipping content for two systems declares both here; a system
package needs no entry, since it is its own system by construction.

```yaml
systems:
  sohl:
    compatibility: { verified: "1.6.3" }
```

| Key (under `systems.<id>`)            | Type   | Required | Default |
| ------------------------------------- | ------ | -------- | ------- |
| `systems.<id>.manifest`               | string | no       | `null`  |
| `systems.<id>.compatibility`          | object | yes      | —       |
| `systems.<id>.compatibility.minimum`  | string | no       | `null`  |
| `systems.<id>.compatibility.verified` | string | yes      | —       |

`compatibility.verified` is required here — unlike the top-level
`compatibility` block, where `minimum` is the required half — because this
is the value a pack actually **stamps**; a declaration that cannot answer
"which version was this built against" is the gap `systems:` exists to
close.

> ``package-build config: `systems` must be a mapping of id to spec.``

> ``package-build config: `systems` declares an empty system id.``

> ``package-build config: `systems.<id>` must be a mapping.``

> ``package-build config: `systems.<id>.compatibility` must be a mapping.``

> ``package-build config: `systems.<id>.compatibility.verified` must be a non-empty string.``

> ``package-build config: `systems.<id>.<key>` is not a recognized option (expected one of: manifest, compatibility).``

> ``package-build config: `systems.<id>.compatibility.<key>` is not a recognized option (expected one of: minimum, verified).``

### `requiresSystem`

**Type:** string · **Optional** · default `null`. Refused in a
`documentation` package, which compiles no documents and so has no game
system to gate its packs on:

> ``package-build config: `requiresSystem` is refused in a `documentation` package, which compiles no documents, so there is no game system to gate its packs on.``

The one system this package refuses to load without — the **gate** half of
the systems split. Naming one here emits `relationships.systems` for it,
which Foundry's `supportsSystem` reads, making the package unavailable
under any other system. Omitted, no relationship is emitted and each pack
stamps whatever its own `system:` names.

It must name a system `systems:` actually declares. With no `systems:`
block at all:

> ``package-build config: `requiresSystem` names `sohl`, which `systems:` does not declare — the `systems:` block is empty or absent.``

With one, naming what it does declare instead:

> ``package-build config: `requiresSystem` names `<name>`, which `systems:` does not declare. Declared: <list>.``

> ``package-build config: `requiresSystem` must be a non-empty string.``

### `packageBuild`

Reserved for `@heroiclands/package-build`'s own packaging half — see
[The `packageBuild` section](#the-packagebuild-section) below for its full
key-by-key reference. `content-config.mjs` checks only that the value is a
mapping:

> ``package-build config: `packageBuild` must be a mapping — it is the section @heroiclands/package-build reads, and that package validates what is inside it.``

### `publish`

**Type:** object · **Optional** for a `systems` or `modules` package, default
`{site: "homepage", address: {prefix: ""}}`. **Required** for a
`documentation` package, with `site: content` — publishing the content tree is
the whole of what that kind does:

> ``package-build config: `publish` is required in a `documentation` package: publishing the content tree is the whole of what it does. Write `publish: {site: content}`.``

> ``package-build config: `publish.site` must be `content` in a `documentation` package — `homepage` fences the content surfaces off, and a package that compiles nothing and publishes nothing from its tree would produce a single authored page and no book.``

Publishing switches — how much of this package reaches the web, and where
its content tree's addresses mount inside the package.

| Key                      | Type                        | Required | Default        |
| ------------------------ | --------------------------- | -------- | -------------- |
| `publish.site`           | `"homepage"` \| `"content"` | no       | `"homepage"`   |
| `publish.address`        | object                      | no       | `{prefix: ""}` |
| `publish.address.prefix` | string                      | no       | `""`           |

> ``package-build config: `publish` must be an object.``

> ``package-build config: `publish.<key>` is not a recognized option (expected one of: site, address).``

Every HeroicLands package publishes at least an authored homepage at
`https://www.heroiclands.org/<contentPackage>/` — there is no value meaning
_no web presence at all_. `homepage` is the floor: the authored homepage
and nothing else, no content-tree walk. `content` is the homepage plus every
page the content tree publishes. `publishesContentPages(config)`, exported from
`content-config.mjs` alongside [`compilesFoundryDocuments`](#packagekind),
answers the one question every reader of the mode actually asks — the site
build, to decide whether to walk the tree at all, and the content index, to
decide whether an entry carries a web `path`. It returns
`config.publish.site === "content"`.

This was a boolean before `5.0.0`, and both spellings are refused rather
than silently mapped, because a value reinterpreted reads to its author as
though it still means what it said:

> ``package-build config: `publish.site` is no longer a boolean — write `site: content`. Every package publishes an authored homepage at /<contentPackage>/, so no value means "no web presence": `homepage` publishes that page and nothing else, and `content` publishes it plus every page the content tree compiles to.``

> ``package-build config: `publish.site` must be one of homepage, content (got "public").``

`publish.address.prefix` is where the content tree mounts _inside the
package_ — `"kb/"` for a repository whose knowledgebase is one surface
among several, `""` for one whose site is nothing but its content. It must
end in a slash when set (a missing one would silently fuse the prefix to
the first section) and must not begin with one (which would make the
recorded address package-absolute):

> ``package-build config: `publish.address` must be an object.``

> ``package-build config: `publish.address.prefix` must end in a slash when it is set.``

> ``package-build config: `publish.address.prefix` must not begin with a slash.``

`publish.address.landing` is **retired** — it named which note addressed a
whole section rather than a page within one, and there are no sections to
address:

> ``package-build config: `publish.address.landing` is a retired option — delete it. It named which note addressed a whole section rather than a page within one, and there are no sections to address: a section is a Hugo content directory the note format does not carry, so no note lands one and every page is addressed `<type>-<shortcode>`. Nothing replaces it.``

Any other key under `publish.address` is refused:

> ``package-build config: `publish.address.<key>` is not a recognized option (expected one of: prefix).``

---

## The `packageBuild` section

Validated by `resolvePackageBuildConfig` in `config.mjs`, not by
`content-config.mjs`. The two halves split by **input** — the content half
reads the content tree, this one reads `lang/`, `styles/`, `src/`, the
assets and the manifest template — and neither validates the other's keys.
`packageBuild` is an ordinary section of the one configuration file; the
split exists only to stop one key being checked twice against two
disagreeing ideas of what it means.

```yaml
packageBuild:
  assets:
    - { from: lang, to: lang }
    - { from: assets/icons, to: assets/icons }
  assetTransform: ./utils/svg-theme.mjs
  stageDir: build/stage
  clean:
    extra: [coverage]
  lang:
    sources: lang/*.json
  deploy:
    envPrefix: SOHL
```

| Key                                                                                        | Type                                        | Required | Default                           |
| ------------------------------------------------------------------------------------------ | ------------------------------------------- | -------- | --------------------------------- |
| [`packageBuild.stageDir`](#packagebuildstagedir-and-packagebuildassets)                    | string                                      | no       | `build/stage`                     |
| [`packageBuild.assets`](#packagebuildstagedir-and-packagebuildassets)                      | array                                       | no       | `[]`                              |
| [`packageBuild.assetTransform`](#packagebuildassettransform-and-packagebuildmanifestflags) | string (path to a module)                   | no       | `null`                            |
| [`packageBuild.manifest`](#packagebuildmanifest)                                           | object, pass-through                        | no       | `{}`                              |
| [`packageBuild.manifestFlags`](#packagebuildassettransform-and-packagebuildmanifestflags)  | string (path to a module)                   | no       | `null`                            |
| [`packageBuild.schema`](#packagebuildschema)                                               | object (`{documentType: {from, registry}}`) | no       | `[]`                              |
| [`packageBuild.clean`](#packagebuildclean)                                                 | object                                      | no       | `{extra: []}`                     |
| [`packageBuild.lang`](#packagebuildlang)                                                   | object                                      | no       | see below                         |
| [`packageBuild.deploy`](#packagebuilddeploy)                                               | object                                      | no       | `{envPrefix: "SOHL"}`             |
| [`packageBuild.release`](#packagebuildrelease)                                             | object                                      | no       | `{artifact: <from packageKind>}`  |
| [`packageBuild.bundle`](#packagebuildbundle)                                               | object                                      | no       | `{entry: "<foundryPackage>.mjs"}` |
| [`packageBuild.container`](#packagebuildcontainer)                                         | object                                      | no       | see below                         |
| [`packageBuild.e2e`](#packagebuilde2e)                                                     | object                                      | no       | see below                         |

> ``package-build config: `packageBuild.<key>` is not a recognised key (expected one of: stageDir, assets, assetTransform, manifest, manifestFlags, schema, clean, lang, deploy, release, bundle, container, e2e).``

### `packageBuild.stageDir` and `packageBuild.assets`

`stageDir` is where the package is assembled before it is zipped or
deployed — every asset destination is relative to it, so a repository's
table says `lang`, not `build/stage/lang`.

`assets` is the table of staging copies: source path in the repository,
destination under the staged package root.

| Key                          | Type   | Required |
| ---------------------------- | ------ | -------- |
| `packageBuild.assets[].from` | string | yes      |
| `packageBuild.assets[].to`   | string | yes      |

> ``package-build config: `packageBuild.stageDir` must be a non-empty string.``

> ``package-build config: `packageBuild.assets` must be a list.``

> ``package-build config: `packageBuild.assets[<index>]` must be a mapping.``

> ``package-build config: `packageBuild.assets[<index>].from` must be a non-empty string.``

> ``package-build config: `packageBuild.assets[<index>].<key>` is not a recognised key (expected one of: from, to).``

### `packageBuild.assetTransform` and `packageBuild.manifestFlags`

Both name a module, resolved against `rootDir`: `assetTransform` exports a
`transform` a repository needs beyond verbatim asset copying, and
`manifestFlags` exports a `flags` function for namespaced manifest flags a
repository has to compute. Neither declares anything, both default to
`null`:

> ``package-build config: `packageBuild.assetTransform` must be a non-empty string.``

> ``package-build config: `packageBuild.manifestFlags` must be a non-empty string.``

### `packageBuild.manifest`

Everything declared here is emitted into the generated manifest unchanged —
**deliberately not key-checked**, so a key Foundry adds in a later version
can be declared without waiting on a release of this package. The one rule
that has a wrong answer rather than an unknown one: a key the build
**derives** must not also be authored, since the authored value would be
silently overwritten and the two would be free to disagree with nothing to
say so.

`packageBuild.manifest.descriptionHtml` is the exception worth calling out on
its own: it is not forbidden, it **is** how `description` is authored. It is
the pitch Foundry's package browser shows — HTML allowed, any length — and it
is emitted into the generated manifest as `description`; the key itself never
survives into the manifest under its own name. `package.json`'s own
`description` is read by neither this nor the site (see
[`site.description`](#site)) — a declared one is reported as a warning naming
both real keys, so it cannot drift back into use:

> `package.json: warning: \`description\` is read by nothing; the Foundry pitch is \`packageBuild.manifest.descriptionHtml\` and the site's is \`site.description\`` — a JSON manifest carries no line to point at, so only the file is named.

| Forbidden key                         | Derived from                                                     |
| ------------------------------------- | ---------------------------------------------------------------- |
| `packageBuild.manifest.id`            | `foundryPackage`, itself derived from `package.json` `name`      |
| `packageBuild.manifest.version`       | `package.json` `version`                                         |
| `packageBuild.manifest.description`   | `packageBuild.manifest.descriptionHtml`                          |
| `packageBuild.manifest.url`           | `package.json` `repository`                                      |
| `packageBuild.manifest.bugs`          | `package.json` `repository`                                      |
| `packageBuild.manifest.manifest`      | `package.json` `repository` and the release tag                  |
| `packageBuild.manifest.download`      | `package.json` `repository` and the release tag                  |
| `packageBuild.manifest.compatibility` | the top level of `package-build.config.yaml`                     |
| `packageBuild.manifest.relationships` | the top level of `package-build.config.yaml`                     |
| `packageBuild.manifest.packs`         | the `packs` list at the top level of `package-build.config.yaml` |

> ``package-build config: `packageBuild.manifest.version` is derived from package.json `version` and must not be declared — it would be overwritten, and the two would disagree with nothing to say so.``

> ``package-build config: `packageBuild.manifest.description` is derived from `packageBuild.manifest.descriptionHtml` and must not be declared — it would be overwritten, and the two would disagree with nothing to say so.``

> ``package-build config: `packageBuild.manifest` must be a mapping.``

### `packageBuild.schema`

Registers the DataModel bindings `package-build schema` reads. The document
type is the key, so a package that models only Items declares only that
entry:

```yaml
packageBuild:
  schema:
    Item: { from: module/data/item-models.mjs, registry: ITEM_DM_DEF }
```

| Key (under `packageBuild.schema.<DocumentType>`) | Type                          | Required |
| ------------------------------------------------ | ----------------------------- | -------- |
| `packageBuild.schema.<DocumentType>.from`        | string (path to a module)     | yes      |
| `packageBuild.schema.<DocumentType>.registry`    | string (the exported binding) | yes      |

> ``package-build config: `packageBuild.schema` must be a mapping.``

> ``package-build config: `packageBuild.schema.<DocumentType>` must be a mapping.``

> ``package-build config: `packageBuild.schema.<DocumentType>.from` must be a non-empty string.``

### `packageBuild.clean`

| Key                        | Type     | Required | Default |
| -------------------------- | -------- | -------- | ------- |
| `packageBuild.clean.extra` | string[] | no       | `[]`    |

Directories to remove beyond the conventional build artifacts.

> ``package-build config: `packageBuild.clean` must be a mapping.``

> ``package-build config: `packageBuild.clean.extra` must be a list.``

> ``package-build config: `packageBuild.clean.extra[<index>]` must be a non-empty string.``

### `packageBuild.lang`

Localization coverage settings, read by the `lang` checks.

| Key                            | Type                         | Required | Default                                                                                                               |
| ------------------------------ | ---------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `packageBuild.lang.sources`    | string or string[] (glob)    | no       | `lang/*.json`                                                                                                         |
| `packageBuild.lang.help`       | string                       | no       | `null` — extra guidance printed after a failure                                                                       |
| `packageBuild.lang.primary`    | string                       | no       | `lang/en.json` — the file coverage is measured against                                                                |
| `packageBuild.lang.scripts`    | string or string[] (glob)    | no       | `src/**/*.{ts,mjs}`                                                                                                   |
| `packageBuild.lang.templates`  | string or string[] (glob)    | no       | `templates/**/*.hbs`                                                                                                  |
| `packageBuild.lang.keyRoots`   | string or string[] (glob)    | no       | `null` — derived from the primary file's own keys unless a repository references a root the file does not yet declare |
| `packageBuild.lang.references` | string (path to a module)    | no       | `null` — a module exporting a `references` function                                                                   |
| `packageBuild.lang.retained`   | array of `{prefix, reason}`  | no       | `[]` — key prefixes exempt from the unreferenced advisory                                                             |
| `packageBuild.lang.allow`      | array of `{literal, reason}` | no       | `[]` — template literals that are deliberately not localization keys                                                  |

> ``package-build config: `packageBuild.lang` must be a mapping.``

Each `retained` / `allow` entry states its own reason, which is what keeps
the escape hatch from becoming a place unexplained exceptions accumulate:

> ``package-build config: `packageBuild.lang.retained[<index>]` must be a mapping.``

> ``package-build config: `packageBuild.lang.retained[<index>].reason` must be a non-empty string.``

> ``package-build config: `packageBuild.lang.retained[<index>].<key>` is not a recognised key (expected one of: prefix, reason).``

### `packageBuild.deploy`

| Key                             | Type   | Required | Default |
| ------------------------------- | ------ | -------- | ------- |
| `packageBuild.deploy.envPrefix` | string | no       | `SOHL`  |

Prefix of the deploy environment variables.

> ``package-build config: `packageBuild.deploy` must be a mapping.``

> ``package-build config: `packageBuild.deploy.envPrefix` must be a non-empty string.``

### `packageBuild.release`

| Key                             | Type   | Required | Default                                                                  |
| ------------------------------- | ------ | -------- | ------------------------------------------------------------------------ |
| `packageBuild.release.artifact` | string | no       | `system` for `packageKind: systems`, `module` for `packageKind: modules` |

Foundry installs a system from `system.json` and a module from
`module.json`; the kind already decides which, so this is stated only when
a repository genuinely needs the other answer.

> ``package-build config: `packageBuild.release` must be a mapping.``

> ``package-build config: `packageBuild.release.artifact` must be a non-empty string.``

### `packageBuild.bundle`

| Key                         | Type   | Required | Default                |
| --------------------------- | ------ | -------- | ---------------------- |
| `packageBuild.bundle.entry` | string | no       | `<foundryPackage>.mjs` |

The bundle file Foundry loads, as the manifest spells it. Named after the
package by convention; stated only when a repository's bundler emits
something else. Deliberately not read back out of the generated manifest —
that would let the check agree with itself by construction.

> ``package-build config: `packageBuild.bundle` must be a mapping.``

> ``package-build config: `packageBuild.bundle.entry` must be a non-empty string.``

### `packageBuild.container`

| Key                             | Type                                              | Required | Default                           |
| ------------------------------- | ------------------------------------------------- | -------- | --------------------------------- |
| `packageBuild.container.image`  | string                                            | no       | `null` — override for every stage |
| `packageBuild.container.name`   | string, matching `/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/` | no       | `null` — named after the package  |
| `packageBuild.container.stages` | object (`{stage: spec}`)                          | no       | `{}`                              |

`name` is checked against what `docker run` accepts, since the stage is
appended to it and a rejected name would otherwise surface as a failure to
create a container whose name was never written down:

> ``package-build config: `packageBuild.container.name` must be a container name docker accepts — a letter or digit, then letters, digits, underscores, periods or hyphens.``

> ``package-build config: `packageBuild.container` must be a mapping.``

> ``package-build config: `packageBuild.container.stages` must be a mapping.``

`packageBuild.container.stages.<name>` is for a stage that is genuinely
one repository's own — an older Foundry serving a previous generation of
the package. The four every HeroicLands package deploys to (dev, qa, prod,
test) need no entry:

| Key (under `packageBuild.container.stages.<name>`) | Type                                | Required | Default |
| -------------------------------------------------- | ----------------------------------- | -------- | ------- |
| `packageBuild.container.stages.<name>.port`        | number                              | no       | `null`  |
| `packageBuild.container.stages.<name>.world`       | string (`""` forces no auto-launch) | no       | `null`  |
| `packageBuild.container.stages.<name>.version`     | string                              | no       | `null`  |

> ``package-build config: `packageBuild.container.stages.<name>` must be a mapping.``

> ``package-build config: `packageBuild.container.stages.<name>.port` must be a number.``

> ``package-build config: `packageBuild.container.stages.<name>.world` must be a string ("" forces no auto-launch).``

### `packageBuild.e2e`

The Cypress suite a repository runs against the served world — the one
thing the harness does not own, since what runs against a standing world is
entirely the repository's.

| Key                          | Type                                   | Required | Default |
| ---------------------------- | -------------------------------------- | -------- | ------- |
| `packageBuild.e2e.stage`     | string                                 | no       | `test`  |
| `packageBuild.e2e.suite`     | object                                 | no       | `null`  |
| `packageBuild.e2e.results`   | string or string[] (glob)              | no       | `[]`    |
| `packageBuild.e2e.build`     | object (`{target: spec}`)              | no       | `{}`    |
| `packageBuild.e2e.world`     | object                                 | no       | `{}`    |
| `packageBuild.e2e.gm`        | object                                 | no       | `{}`    |
| `packageBuild.e2e.documents` | object (collection → source directory) | no       | `{}`    |

> ``package-build config: `packageBuild.e2e` must be a mapping.``

`packageBuild.e2e.suite`:

| Key                           | Type                             | Required |
| ----------------------------- | -------------------------------- | -------- |
| `packageBuild.e2e.suite.run`  | string[] (program and arguments) | yes      |
| `packageBuild.e2e.suite.open` | string[]                         | no       |

> ``package-build config: `packageBuild.e2e.suite` must be a mapping.``

> ``package-build config: `packageBuild.e2e.suite.run` must be a non-empty list naming a program to run.``

`packageBuild.e2e.build.<name>` — a bare string is the script name; the
mapping form adds `recreate`, for a target that writes something Foundry
reads only at world launch (the manifest), where deploying it into a
running world deploys a file nothing will look at:

| Key                                      | Type    | Required           | Default |
| ---------------------------------------- | ------- | ------------------ | ------- |
| `packageBuild.e2e.build.<name>.script`   | string  | yes (mapping form) | —       |
| `packageBuild.e2e.build.<name>.recreate` | boolean | no                 | `false` |

> ``package-build config: `packageBuild.e2e.build.<name>` must be a script name or a mapping.``

> ``package-build config: `packageBuild.e2e.build.<name>.recreate` must be a boolean.``

`packageBuild.e2e.world` — declared world identity:

| Key                                  | Type   |
| ------------------------------------ | ------ |
| `packageBuild.e2e.world.id`          | string |
| `packageBuild.e2e.world.title`       | string |
| `packageBuild.e2e.world.description` | string |

`packageBuild.e2e.gm` — declared GM credentials:

| Key                            | Type   |
| ------------------------------ | ------ |
| `packageBuild.e2e.gm.name`     | string |
| `packageBuild.e2e.gm.password` | string |

Every value in both mappings must be a non-empty string:

> ``package-build config: `packageBuild.e2e.world.<key>` must be a non-empty string.``

`packageBuild.e2e.documents` is a mapping too, but an **open** one — unlike
`world` and `gm`, it declares no fixed key list, since a collection name is
the repository's own. Every value must still be a non-empty string, naming
the source directory:

> ``package-build config: `packageBuild.e2e.documents.<key>` must be a non-empty string.``

---

## Every retired or forbidden key, in one place

| Key                                                                                                                                                                                                                                                                                         | Why                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `publish.address.landing`                                                                                                                                                                                                                                                                   | Retired — named a whole-section landing, and there are no sections to address.                                                                         |
| `packs[].folders`                                                                                                                                                                                                                                                                           | Retired — a folder is a note (`type: folder`), materialised by the pack whose documents reference it.                                                  |
| `rootDir`                                                                                                                                                                                                                                                                                   | Forbidden in a YAML configuration — always the file's own directory.                                                                                   |
| `foundryPackage`                                                                                                                                                                                                                                                                            | Forbidden in a YAML configuration — always the adjacent `package.json` `name`.                                                                         |
| `homepage`, `author`                                                                                                                                                                                                                                                                        | Forbidden in a YAML configuration — always the adjacent `package.json`'s own `homepage` and `author`.                                                  |
| `stats.systemId`                                                                                                                                                                                                                                                                            | Forbidden in every configuration — derived from `packageKind`, `requiresSystem` or a lone declared system.                                             |
| `stats.systemVersion`                                                                                                                                                                                                                                                                       | Forbidden in every configuration — derived from `package.json` (a system) or `systems:` / `relationships.systems` (a module).                          |
| `packageBuild.manifest.id`, `.version`, `.description`, `.url`, `.bugs`, `.manifest`, `.download`, `.compatibility`, `.relationships`, `.packs`                                                                                                                                             | Forbidden — each is derived from `package.json` or the top level of `package-build.config.yaml`; see [`packageBuild.manifest`](#packagebuildmanifest). |
| `site.out`                                                                                                                                                                                                                                                                                  | Retired — the site build writes its content mount at `build/hugo/content`, beside the generated `hugo.toml`.                                           |
| `site.trees`, `site.readmeSections`                                                                                                                                                                                                                                                         | Retired — a page is a note in the content tree.                                                                                                        |
| `site.sections`, `site.landing`, `site.backfillSections`, `site.list`                                                                                                                                                                                                                       | Retired — a site is its homepage and its pages, and any index between them is a `doc` note.                                                            |
| `site.hugo.baseURL`, `.title`, `.locale`, `.publishDir`, `.contentDir`, `.themesDir`, `.theme`, `.disableKinds`, `.taxonomies`, `.outputs`, `.params.description`, `.params.author`, `.params.cdnBaseURL`, `.params.brand`, `.params.notfound`, `.markup.goldmark.renderer.unsafe`, `.menu` | Forbidden — each is written by the site build from a source it names; see [the generated Hugo configuration](#the-generated-hugo-configuration).       |
| `publish.site: true` / `publish.site: false`                                                                                                                                                                                                                                                | Refused rather than mapped — write `homepage` or `content`.                                                                                            |
| `packs`, `itemBuilders`, `docs`, `compatibility`, `relationships`, `systems`, `requiresSystem`, `stats`, `foundryPackage`                                                                                                                                                                   | Forbidden in a `documentation` package — each describes a Foundry package this kind is not; see the key's own section for its located refusal message. |
