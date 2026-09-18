# API reference

`@heroiclands/package-build` exposes its programmatic surface through
subpath entries, declared in `package.json`'s `exports` map. Every function
and value documented here is a supported contract, not an internal seam —
`./sohl` and `./hm3` included.

**Everything exported anywhere in this package is pure.** A function takes
source text or already-loaded data and returns findings or values;
discovery, I/O and reporting stay with the caller. That is what lets one
rule set serve a lint script, a build step and a unit test without any of
them having to agree on how files are found or how findings are printed. A
handful of packaging functions — deploying, staging, running a container,
packing a release — necessarily touch the filesystem or a subprocess; each
is named for it in the tables below, and the pure half of its module is kept
separate from it.

This reference is organized by subpath entry, matching how a consumer
imports: `import * as engine from "@heroiclands/package-build/engine"` reads
the engine namespaces directly, while `import { engine } from
"@heroiclands/package-build"` reaches the same namespaces one level deeper,
as a property of the root import. Each export's row states its signature,
what it returns, and when a caller reaches for it — sourced from the
export's own JSDoc.

## `.` — the package root

`@heroiclands/package-build` — the shared toolchain for building and shipping a HeroicLands **Foundry package**, content and all. Importing the bare package name re-exports the content configuration contract plus every namespace documented below, so a consumer that wants the whole surface under one import can use this entry instead of reaching for each subpath individually.

```js
import { defineConfig, engine, sohl } from "@heroiclands/package-build";

const config = defineConfig({
  rootDir: import.meta.dirname,
  contentPackage: "example",
  foundryPackage: "example",
  packageKind: "modules",
  stats: { lastModifiedBy: "examplebuilder00" },
  packs: [{ name: "items", type: "Item" }],
  compatibility: { minimum: "14.359" },
});
const { addressSlug } = engine.contentAddress;
console.log(addressSlug({ type: "weapongear", shortcode: "dagger" })); // "weapongear-dagger"
```

| Export                | What it is                        |
| --------------------- | --------------------------------- |
| `defineConfig`        | Function — see `./content-config` |
| `PACKAGE_KINDS`       | Const — see `./content-config`    |
| `PACK_DOCUMENT_TYPES` | Const — see `./content-config`    |
| `engine`              | Namespace — see `./engine`        |
| `sohl`                | Namespace — see `./sohl`          |
| `manifest`            | Namespace — see `./manifest`      |
| `bundle`              | Namespace — see `./bundle`        |
| `stage`               | Namespace — see `./stage`         |
| `release`             | Namespace — see `./release`       |
| `deploy`              | Namespace — see `./deploy`        |
| `container`           | Namespace — see `./container`     |
| `e2e`                 | Namespace — see `./e2e`           |
| `lang`                | Namespace — see `./lang`          |
| `coverage`            | Namespace — see `./coverage`      |
| `templates`           | Namespace — see `./templates`     |

`hm3` is **not** re-exported from the root — import `@heroiclands/package-build/hm3` directly.

## `./engine`

The package-agnostic half of the toolchain: everything that knows how a
HeroicLands content tree is shaped, but nothing about any particular game
system's data model. The content walk, frontmatter parsing, table
generation, wikilink resolution, id and folder derivation, the link
manifest and the web-address rule, `BasePackCompiler`, and the generic
Foundry document compilers (journals, macros, scenes) all live here.

**Each module is re-exported as its own namespace, not flattened.** Several
namespaces deliberately re-export a neighbour's symbol so a caller keeps one
import path — `helpers` re-exports the frontmatter readers and `makeId`;
`wikilinks` re-exports the pack router. Flattened, every such name would
become an ambiguous star export and vanish from this barrel silently.

**Every module is also reachable as its own entry point** —
`@heroiclands/package-build/engine/<module>` (e.g.
`@heroiclands/package-build/engine/content-address`) — which is how a build
that needs one thing avoids loading the whole pipeline.

```js
import { engine } from "@heroiclands/package-build";
// or, to load only what is needed:
import * as contentAddress from "@heroiclands/package-build/engine/content-address";

const { addressSlug } = engine.contentAddress;
console.log(addressSlug({ type: "weapongear", shortcode: "dagger" }));
// -> "weapongear-dagger"
```

### `engine.ids`

Deterministic document ids, derived by hashing rather than stored, so compile passes that cannot see each other's output still agree on an id. Also holds the pack-name vocabulary — which content type compiles into which conventional pack and document type — and the retired/renamed type tables every type-keyed lookup normalizes through first.

| Export                 | Signature                                       | Returns                                                        | Use it when                                                                                |
| ---------------------- | ----------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `makeId`               | `makeId(namespace, value)`                      | `string` — a 16-character hexadecimal Foundry id               | deriving a stable id from a namespace and a value, e.g. a heading id when none is supplied |
| `MAP_TYPES`            | `const MAP_TYPES`                               | —                                                              | enumerating the content types that compile into a Foundry `Scene`                          |
| `MAP_SUBTYPES`         | `const MAP_SUBTYPES`                            | —                                                              | reading the map subTypes, which differ only in derived canvas defaults                     |
| `JOURNAL_TYPES`        | `const JOURNAL_TYPES`                           | —                                                              | enumerating content types whose whole document _is_ a JournalEntry                         |
| `PACK_BY_TYPE`         | `const PACK_BY_TYPE`                            | —                                                              | looking up the conventional pack name and document type for a content type                 |
| `RETIRED_TYPES`        | `const RETIRED_TYPES`                           | —                                                              | looking up what a retired content type was replaced by                                     |
| `assertTypeNotRetired` | `assertTypeNotRetired(type, where)`             | throws                                                         | refusing a note whose type has been retired outright                                       |
| `RENAMED_TYPES`        | `const RENAMED_TYPES`                           | —                                                              | looking up what a renamed content type is now called                                       |
| `currentType`          | `currentType(type)`                             | the current spelling                                           | normalizing a type to its current spelling before any keyed lookup                         |
| `renamedTypeMessage`   | `renamedTypeMessage(retired, current, where)`   | `string` — the finding message                                 | building the one message every reporter of a renamed type shares                           |
| `ITEM_PACK`            | `const ITEM_PACK`                               | —                                                              | naming the pack every open-set item type compiles into by default                          |
| `packForType`          | `packForType(type)`                             | `{pack, docType}`                                              | resolving the pack and document type an item type's documents live in                      |
| `compendiumUuid`       | `compendiumUuid(packageId, type, id, packName)` | `string` — `Compendium.<packageId>.<pack>.<DocumentType>.<id>` | composing a document's full compendium UUID in the one place it is spelled                 |
| `pageUuid`             | `pageUuid(entryUuid, pageId)`                   | `string` — the page's UUID                                     | composing the UUID of a JournalEntry page                                                  |

### `engine.systemBlock`

The per-system frontmatter block: how one note feeds more than one game system through properties named after that system (`<system>.system`, `<system>.type`, `<system>.img`, `<system>.items` on actors). Resolves a field's value through the block, the shared top level, and a retiring position in that order, and merges an authored `<system>.system` onto a compiler-built one without disturbing what the builder already wrote.

| Export                      | Signature                                     | Returns                                | Use it when                                                                                   |
| --------------------------- | --------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------- |
| `SYSTEM_DATA_KEY`           | `const SYSTEM_DATA_KEY`                       | —                                      | naming the key inside a system block whose contents are the system's own vocabulary           |
| `BLOCK_DOCUMENT_PROPERTIES` | `const BLOCK_DOCUMENT_PROPERTIES`             | —                                      | mapping a system-block key to the document property it becomes                                |
| `BLOCK_DIRECTIVES`          | `const BLOCK_DIRECTIVES`                      | —                                      | recognizing a build directive (e.g. `pack`) that names no document property                   |
| `SYSTEM_BLOCK_KEYS`         | `const SYSTEM_BLOCK_KEYS`                     | —                                      | enumerating every key any system block may carry                                              |
| `setPath`                   | `setPath(target, dotted, value)`              | `object` — `target`, for chaining      | writing a value at a dotted path in a document's `system` block                               |
| `systemBlock`               | `systemBlock(fm, block)`                      | `Record<string, unknown> \| undefined` | reading one system's whole block off a note, or nothing when it is absent or malformed        |
| `carriesSystemBlock`        | `carriesSystemBlock(fm, block)`               | `boolean`                              | deciding whether a pack that declares a system should compile a note at all                   |
| `systemData`                | `systemData(fm, block)`                       | `Record<string, unknown>`              | reading a system block's `system` sub-block, `{}` when absent                                 |
| `blockField`                | `blockField(fm, block, key, defaultValue)`    | the value                              | reading a key from one system's block, falling back to the top level                          |
| `sharedProperty`            | `sharedProperty(fm, source, defaultValue)`    | the value                              | reading a shared top-level property by a possibly-dotted path, blind to every system block    |
| `blockProperty`             | `blockProperty(fm, block, key, defaultValue)` | the value                              | reading a property a system block may override, else the shared top-level one                 |
| `legacyKeyOf`               | `legacyKeyOf(field)`                          | `string \| undefined`                  | finding the key a field is authored at inside a system block                                  |
| `retiredTopLevelKey`        | `retiredTopLevelKey(field)`                   | `string \| undefined`                  | finding the bare top-level key a `data:`-sourced field is being swept off                     |
| `resolveFieldValue`         | `resolveFieldValue(field, fm, ...)`           | `{value, from}`                        | resolving one declared field against a note, in the declared source order                     |
| `systemDataPaths`           | `systemDataPaths(data, prefix)`               | `string[]`                             | listing every path a note authors under `<system>.system`, containers included                |
| `undeclaredPaths`           | `undeclaredPaths(data, declared, prefix)`     | `string[]`                             | finding authored paths a system's published schema does not declare                           |
| `unknownBlockKeys`          | `unknownBlockKeys(fm, block, ...)`            | `string[]`                             | finding keys directly under a system block that neither this format nor the system recognizes |
| `claimedPaths`              | `claimedPaths(fields)`                        | `Set<string>`                          | listing the exact `system` paths a field declaration writes, for `mergeSystemData`            |
| `mergeSystemData`           | `mergeSystemData(built, fm, ...)`             | `object` — `built`, for chaining       | merging a note's `<system>.system` verbatim onto a built `system` block                       |

### `engine.codeFences`

Where code lives in a markdown body, so a rewriter can leave it alone. Every build-time rewriter that pattern-matches a body needs to know where code is, or a source listing that happens to contain the rewriter's own syntax is silently corrupted.

| Export                | Signature                                                  | Returns                         | Use it when                                                                                  |
| --------------------- | ---------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------- |
| `FENCE_LINE`          | `const FENCE_LINE`                                         | —                               | matching a fence line, capturing its indent, marker, and info string                         |
| `parseHeaderArgs`     | `parseHeaderArgs(info)`                                    | `{language, args}`              | reading a fence's info string as org-babel header arguments                                  |
| `codeRegions`         | `codeRegions(markdown, ...)`                               | `Array<{start, end}>`           | getting every code region in a markdown body as character offsets                            |
| `replaceOutsideCode`  | `replaceOutsideCode(markdown, pattern, replacer, options)` | `string` — the rewritten body   | running `String.prototype.replace` while skipping anything inside code                       |
| `matchAllOutsideCode` | `matchAllOutsideCode(markdown, pattern, options)`          | `Array<RegExpMatchArray>`       | running `String.prototype.matchAll` while skipping anything inside code                      |
| `protectCode`         | `protectCode(body, transform)`                             | `string` — the transformed body | running an arbitrary transform over a body while restoring every code run verbatim afterward |

### `engine.frontmatter`

Frontmatter readers: pure functions that read a content note's `sohl:` block and normalize what they find. A dependency-free leaf module — its only import is a frozen constants list — so the item-type registry can use these readers without pulling in `helpers.mjs` and the wikilink cycle behind it.

| Export                  | Signature                               | Returns                     | Use it when                                                                            |
| ----------------------- | --------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| `getFrontmatter`        | `getFrontmatter(fm, key, defaultValue)` | the value or `defaultValue` | resolving a dotted frontmatter key (e.g. `"name.full"`) into its nested value          |
| `sohlField`             | `sohlField(fm, key, defaultValue)`      | the value                   | reading a key from `fm.sohl`, dotted notation supported, falling back to the top level |
| `sohlSystemField`       | `sohlSystemField(fm, to, defaultValue)` | the value                   | reading a `sohl:` field by also checking its destination position                      |
| `resolveCharges`        | `resolveCharges(fm)`                    | `{value, max}`              | resolving the `charges` block shared by Mystery and Mystical Ability items             |
| `resolveSkillAptitudes` | `resolveSkillAptitudes(fm, ctx)`        | `Record<string, number>`    | resolving an item's `skillAptitudes` selector → modifier map                           |
| `resolveRelation`       | `resolveRelation(fm, ctx)`              | `Record<string, string>`    | resolving an affiliation's `relation` map of standings toward other affiliations       |
| `requireSubType`        | `requireSubType(fm, ctx)`               | `string`                    | reading a mandatory `subType`, throwing when it is absent or blank                     |
| `parseValueDesc`        | `parseValueDesc(raw)`                   | a normalized threshold list | parsing the `valueDesc` / threshold array format, either string or object form         |
| `folderField`           | `folderField(fm)`                       | `{value, isAddress}`        | reading the compendium folder a note names, as its address                             |

### `engine.contentTree`

Whether a content tree has anything to compile. The pack build's worst failure is a success on nothing — an absent or empty tree that compiles zero documents and ships empty compendiums with no error — so this is the empty-tree guard's evidence.

| Export              | Signature                 | Returns                                                  | Use it when                                                      |
| ------------------- | ------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| `countContentNotes` | `countContentNotes(root)` | `number` — `.md` note count, `0` when the tree is absent | guarding a build against a content tree that resolves to nothing |

### `engine.packConfig`

The consuming repository's resolved `package-build.config.yaml`: the content package, the Foundry package and its kind, every path, the `_stats` identity, item-type membership and the pack list — read on call rather than hoisted at import, so importing this package never requires a configuration to exist.

| Export              | Signature                            | Returns                       | Use it when                                                                          |
| ------------------- | ------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------ |
| `CONFIG_BASENAME`   | `const CONFIG_BASENAME`              | —                             | naming the stem every consuming repository declares its build under                  |
| `CONFIG_FILENAMES`  | `const CONFIG_FILENAMES`             | —                             | listing the file names a configuration may be written as                             |
| `findConfigFile`    | `findConfigFile(from)`               | `string \| undefined`         | finding the nearest configuration file at or above a directory                       |
| `resolveConfigFile` | `resolveConfigFile(...)`             | `{path, fromCwd, fromModule}` | asking which configuration file a build launched here would read, without loading it |
| `locateConfigError` | `locateConfigError(err, configPath)` | the decorated error           | attaching the position of the key a configuration error names                        |
| `configFromData`    | `configFromData(data, configPath)`   | `ContentBuildConfig`          | turning a parsed YAML configuration into the frozen one the engine reads             |
| `loadPackConfig`    | `loadPackConfig()`                   | `ContentBuildConfig`          | reading the consuming repository's resolved, frozen configuration                    |
| `packConfigPath`    | `packConfigPath()`                   | `string`                      | naming the file `loadPackConfig` resolved the configuration from, for a diagnostic   |

### `engine.packRouter`

Which pack a note's document lands in, when a document type has more than one configured pack — the routing a repository needs once it ships more than one pack per document type (editorial grouping like "Core Spells" and "Expanded Spells").

| Export             | Signature                              | Returns                    | Use it when                                                                                       |
| ------------------ | -------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------- |
| `PackRoutingError` | `class PackRoutingError extends Error` | —                          | catching a note that cannot be routed to any configured pack                                      |
| `PACK_FIELD`       | `const PACK_FIELD`                     | —                          | naming the frontmatter field a note declares its pack in                                          |
| `createPackRouter` | `createPackRouter(packs)`              | `{resolve, resolveOrNull}` | building a router for one configured pack list, purely, for testing without a config file on disk |
| `routerFor`        | `routerFor(config)`                    | the router                 | getting the router for a resolved configuration, built once per configuration                     |
| `packRouter`       | `packRouter()`                         | the router                 | asking, as every module that emits a UUID does, where a note's document lives                     |

### `engine.noteClaims`

Which note types a configuration compiles at all, and the two findings that follow: a note no pack would claim, and a note that loses a document while the rest of it compiles.

| Export                     | Signature                                | Returns               | Use it when                                                                                                                                   |
| -------------------------- | ---------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEVER_PACKED_TYPES`       | `const NEVER_PACKED_TYPES`               | —                     | enumerating note types that compile into no compendium document by design                                                                     |
| `DOCUMENTATION_NOTE_TYPES` | `const DOCUMENTATION_NOTE_TYPES`         | —                     | reading the whole note vocabulary a `documentation` package may use — `doc` and `homepage`, both already pages rather than compendium entries |
| `UNIMPLEMENTED_TYPES`      | `const UNIMPLEMENTED_TYPES`              | —                     | enumerating content types the specification states that this toolchain does not yet compile                                                   |
| `DERIVED_PACKED_TYPES`     | `const DERIVED_PACKED_TYPES`             | —                     | enumerating note types that reach a pack by a route other than the pack router                                                                |
| `noteTypesClaimedBy`       | `noteTypesClaimedBy(docType, sources)`   | `ReadonlySet<string>` | listing the note types a pass of one document type would claim                                                                                |
| `CLAIMABLE_DOCUMENT_TYPES` | `const CLAIMABLE_DOCUMENT_TYPES`         | —                     | enumerating every Foundry document class `noteTypesClaimedBy` answers for                                                                     |
| `documentClassesFor`       | `documentClassesFor(type, sources, ...)` | `string[]`            | listing every document class a note of one type compiles into                                                                                 |
| `claimedNoteTypes`         | `claimedNoteTypes(config)`               | `ReadonlySet<string>` | finding every note type some pack in a configuration would compile                                                                            |
| `noteTypeVocabulary`       | `noteTypeVocabulary(sources)`            | `ReadonlySet<string>` | finding every note type this build knows, whatever one repository configures                                                                  |
| `unclaimedNoteFindings`    | `unclaimedNoteFindings(config, ...)`     | one finding per note  | reporting every note in a content tree that no configured pack would compile                                                                  |

### `engine.folderNotes`

Folders, authored as notes rather than bespoke `*-folders.yaml` configuration, so a folder's parent is an address the link resolver already understands, its id is derived like any other document's, and an unclaimed folder is a finding like any other unclaimed note.

| Export                   | Signature                                             | Returns                                         | Use it when                                                                           |
| ------------------------ | ----------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| `FOLDER_TYPE`            | `const FOLDER_TYPE`                                   | —                                               | naming the note type a folder is authored as                                          |
| `FOLDER_ID_NAMESPACE`    | `const FOLDER_ID_NAMESPACE`                           | —                                               | naming the id namespace a derived folder id is hashed under                           |
| `DEFAULT_PARENT`         | `const DEFAULT_PARENT`                                | —                                               | naming the key a per-pack `parent` map uses for "everywhere else"                     |
| `bareAddress`            | `bareAddress(value)`                                  | `string \| null`                                | stripping wikilink brackets and a label off an authored `parent` value                |
| `folderAddress`          | `folderAddress(pkg, shortcode)`                       | `string` — `<pkg>-none-folder-<shortcode>`      | composing the canonical address of a folder note                                      |
| `folderDocId`            | `folderDocId(pkg, shortcode)`                         | `string` — the folder's 16-character Foundry id | deriving the Foundry `_id` a folder note's documents file under                       |
| `collectFolderNotes`     | `collectFolderNotes(notes, pkg)`                      | `FolderNote[]`                                  | collecting every folder note in a content tree, in walk order                         |
| `buildFolderNoteIndex`   | `buildFolderNoteIndex(folders)`                       | `{byKey, folders, resolve, ancestorsOf, ...}`   | indexing folder notes by every form an author may address one by, checking invariants |
| `folderDocument`         | `folderDocument(folder, parent, documentType, stats)` | `object` — the Folder document                  | compiling the Foundry `Folder` document one folder note produces for one pack         |
| `assertNoDeclaredFolder` | `assertNoDeclaredFolder(fm, ...)`                     | throws                                          | refusing a note that declares the retired `folder:` spelling                          |

### `engine.contentPackage`

Which content package this repository compiles, and which Foundry package ships it — both derived from `package-build.config.yaml`, exposed as the import path link resolution and the compilers have always used.

| Export             | Signature            | Returns                                    | Use it when                                                                                   |
| ------------------ | -------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `contentPackage`   | `contentPackage()`   | `string` — the configured `contentPackage` | naming the address namespace every note in this repository publishes under                    |
| `foundryPackageId` | `foundryPackageId()` | `string` — the configured `foundryPackage` | naming the Foundry package these packs ship in and the first segment of every compendium UUID |

### `engine.notePackage`

Which content package a note belongs to: the repository's configured `contentPackage`, and nothing a note itself may declare — a property of the repository, never a per-note selector.

| Export                    | Signature                               | Returns                                      | Use it when                                                                              |
| ------------------------- | --------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `searchableFrontmatter`   | `searchableFrontmatter(fm, configured)` | frontmatter with the derived package present | making a note's package visible to a generated table search, though no note declares one |
| `assertNoDeclaredPackage` | `assertNoDeclaredPackage(fm, ...)`      | throws                                       | refusing a note that declares `package:` at all, present or empty                        |

### `engine.retiredFields`

Frontmatter fields a note may no longer declare — `draft:`, a top-level `aliases:`, `section:`, a top-level `traits:` block, and any field with a renamed spelling or in-block position — each refused by presence alone, naming the file and line and saying what to write instead.

| Export                        | Signature                                        | Returns                  | Use it when                                                                                        |
| ----------------------------- | ------------------------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------- |
| `draftRetiredMessage`         | `draftRetiredMessage(file)`                      | `string`                 | building the one message shared by the compile-time refusal and the frontmatter lint for `draft:`  |
| `assertNoDraftField`          | `assertNoDraftField(fm, ...)`                    | throws                   | refusing a note that declares `draft:` at all                                                      |
| `aliasesRetiredMessage`       | `aliasesRetiredMessage(file)`                    | `string`                 | building the shared message for a top-level `aliases:`                                             |
| `assertNoAliasesField`        | `assertNoAliasesField(fm, ...)`                  | throws                   | refusing a note that declares a top-level `aliases:`                                               |
| `declaresRetiredAliasesField` | `declaresRetiredAliasesField(fm)`                | `boolean`                | checking whether a note declares the retired top-level `aliases:`, distinct from `name.aliases`    |
| `sectionRetiredMessage`       | `sectionRetiredMessage(file)`                    | `string`                 | building the shared message for `section:`                                                         |
| `assertNoSectionField`        | `assertNoSectionField(fm, ...)`                  | throws                   | refusing a note that declares `section:` at all                                                    |
| `traitsRetiredMessage`        | `traitsRetiredMessage(file)`                     | `string`                 | building the shared message for a top-level `traits:` block, stating where each key moved          |
| `assertNoTraitsField`         | `assertNoTraitsField(fm, ...)`                   | throws                   | refusing a note that declares a top-level `traits:` block at all                                   |
| `locateFrontmatterKey`        | `locateFrontmatterKey(absPath, key, value, ...)` | `{line?, column?}`       | finding a frontmatter key's position in a note's file, by reading it                               |
| `RETIRED_FIELD_ALIASES`       | `const RETIRED_FIELD_ALIASES`                    | —                        | looking up the current field name a retired spelling was renamed to                                |
| `retiredAliasMessage`         | `retiredAliasMessage(retired, current, file)`    | `string`                 | building the shared message for a note writing a renamed field                                     |
| `legacyKeyMessage`            | `legacyKeyMessage(block, field, file)`           | `string`                 | building the message for a field written at its legacy in-block position                           |
| `retiredTopLevelMessage`      | `retiredTopLevelMessage(field, file)`            | `string`                 | building the message for a field written at the top-level key `data:` gathered it off              |
| `declaresRetiredAlias`        | `declaresRetiredAlias(fm, current)`              | `boolean`                | checking whether a note writes the retired spelling of a field, in either region `sohlField` reads |
| `readAliasedField`            | `readAliasedField(fm, current)`                  | the value or `undefined` | reading a field that has a retired spelling, the current name winning                              |

### `engine.runtimeOnlyFields`

Schema fields a note may never author, because the document writes them during play rather than at compile time — a permanent part of a type's schema that is simply not content, distinct from a retired field, which a note may not author either but for a different reason.

| Export                      | Signature                                    | Returns       | Use it when                                                                                  |
| --------------------------- | -------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------- |
| `runtimeOnlyMessage`        | `runtimeOnlyMessage(key, field, file)`       | `string`      | building the shared message every caller reports for an authored runtime-only field          |
| `authoredRuntimeOnlyFields` | `authoredRuntimeOnlyFields(fm, fields, ...)` | `FieldSpec[]` | listing the runtime-only fields a note actually writes, in declaration order                 |
| `runtimeOnlyIn`             | `runtimeOnlyIn(data, fields)`                | `FieldSpec[]` | asking the same question of a `system` block directly, e.g. an actor's embedded item entries |
| `assertNoRuntimeOnlyFields` | `assertNoRuntimeOnlyFields(fm, fields, ...)` | throws        | refusing a note that authors any of its type's runtime-only fields                           |

### `engine.derivedFields`

`system` keys a note may never author, because the compiler writes them from the note itself — the third of three refusals that read alike (a note says one thing, the build does another) but state different facts about why the key is off limits.

| Export                  | Signature                              | Returns         | Use it when                                                                  |
| ----------------------- | -------------------------------------- | --------------- | ---------------------------------------------------------------------------- |
| `derivedMessage`        | `derivedMessage(key, from, file)`      | `string`        | building the shared message every caller reports for an authored derived key |
| `authoredDerivedKeys`   | `authoredDerivedKeys(fm, keys, ...)`   | `{key, from}[]` | listing the derived keys a note actually writes, in declaration order        |
| `derivedIn`             | `derivedIn(data, keys)`                | `{key, from}[]` | asking the same question of a `system` block directly                        |
| `assertNoDerivedFields` | `assertNoDerivedFields(fm, keys, ...)` | throws          | refusing a note that authors any key its compiler derives                    |

### `engine.homepage`

The package homepage: a note that compiles to a page rather than a compendium document, hand-authored at the conventional shortcode `root`, checked for its address fields and for uniqueness across the tree.

| Export                       | Signature                             | Returns                            | Use it when                                                                                |
| ---------------------------- | ------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `HOMEPAGE_TYPE`              | `const HOMEPAGE_TYPE`                 | —                                  | naming the note type that compiles to the package homepage                                 |
| `HOMEPAGE_FIELDS`            | `const HOMEPAGE_FIELDS`               | —                                  | declaring what a homepage note may write under `sohl:` — nothing                           |
| `HOMEPAGE_SHORTCODE`         | `const HOMEPAGE_SHORTCODE`            | —                                  | naming the shortcode a package landing conventionally takes                                |
| `homepageDestination`        | `homepageDestination(fm)`             | `string` — e.g. `homepage-root.md` | naming the file a homepage is written to, relative to the site root                        |
| `isHomepage`                 | `isHomepage(fm)`                      | `boolean`                          | checking whether a note's frontmatter declares the homepage type                           |
| `HOMEPAGE_REFUSED_FIELDS`    | `const HOMEPAGE_REFUSED_FIELDS`       | —                                  | naming the top-level field a homepage refuses, and what it would decide                    |
| `checkHomepageAddressFields` | `checkHomepageAddressFields(fm, ...)` | one finding per issue              | checking what the address rule says about one homepage note's top-level fields             |
| `checkHomepageCount`         | `checkHomepageCount(found, ...)`      | one finding per offending note     | requiring exactly one homepage note in a content tree                                      |
| `homepageTitle`              | `homepageTitle(fm, config)`           | `string`                           | resolving the title a homepage publishes under, defaulting to the package's manifest title |
| `homepageFrontmatter`        | `homepageFrontmatter(fm, ...)`        | `object`                           | assembling the frontmatter a homepage publishes with, note plus derived values             |
| `HOMEPAGE_ADDRESS_KEYS`      | `const HOMEPAGE_ADDRESS_KEYS`         | —                                  | naming the two frontmatter keys that hold an address, and what each means                  |
| `homepageAddresses`          | `homepageAddresses(fm, body, ...)`    | `Array<{field, url, kind}>`        | finding every address a homepage carries, in frontmatter and body both                     |

### `engine.noteSchemas`

The note types the engine itself declares — vocabulary that is a fact about the note format rather than about any game system. `sohl/note-schemas.mjs` (and any other system) declares its own half separately.

| Export                | Signature                   | Returns | Use it when                                                                       |
| --------------------- | --------------------------- | ------- | --------------------------------------------------------------------------------- |
| `ENGINE_NOTE_SCHEMAS` | `const ENGINE_NOTE_SCHEMAS` | —       | looking up every engine-level content type and what a note of that type may write |

### `engine.noteVocabulary`

The closed half of a note's frontmatter: the `data:` container and each type's `subType` — the only two regions where an unrecognized key is refused rather than passed through to the page.

| Export                    | Signature                                    | Returns                                  | Use it when                                                                                  |
| ------------------------- | -------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| `DRAFT_TAG`               | `const DRAFT_TAG`                            | —                                        | naming the declared tag that marks a note as unfinished                                      |
| `NOTE_VOCABULARY`         | `const NOTE_VOCABULARY`                      | —                                        | looking up, per content type, its `data:` field list and its closed `subType` values         |
| `DECLARED_TAGS`           | `const DECLARED_TAGS`                        | —                                        | looking up the tags a note type may declare, grouped                                         |
| `declaredTags`            | `declaredTags(type, groups)`                 | `readonly string[]`                      | reading the declared tags a note of a type may carry, flattened                              |
| `applicableTagGroups`     | `applicableTagGroups(type, groups)`          | `object[]`                               | reading the declared tag groups that apply to a note type                                    |
| `exclusiveTagGroups`      | `exclusiveTagGroups(type, groups)`           | `Array<{slot, tags}>`                    | reading the single-valued tag slots a note type has, such as a being's kind                  |
| `hasTag`                  | `hasTag(fm, tag)`                            | `boolean`                                | checking whether a note carries a given tag, whatever scalar-or-list form it was authored in |
| `isDraftNote`             | `isDraftNote(fm)`                            | `boolean`                                | checking whether a note is tagged as an unfinished draft                                     |
| `subTypeCharsetMessage`   | `subTypeCharsetMessage(value)`               | `string`                                 | building the message for a `subType` outside the address charset                             |
| `typeCharsetMessage`      | `typeCharsetMessage(type)`                   | `string`                                 | building the message for a `type` outside the address charset                                |
| `assertVocabularyCharset` | `assertVocabularyCharset(vocabulary, where)` | throws                                   | refusing a vocabulary declaration whose type or subType breaks the address charset           |
| `dataFields`              | `dataFields(type, vocabulary)`               | `readonly DataFieldSpec[] \| undefined`  | looking up the `data:` keys a note type may carry                                            |
| `subTypes`                | `subTypes(type, vocabulary)`                 | `readonly string[] \| null \| undefined` | looking up the closed `subType` values a note type declares                                  |

### `engine.infobox`

The declared infobox: what a note's summary panel holds, decided once and rendered by each medium. The note box's fields are the type's own `data:` vocabulary, in its declared order, so a key added to a type appears everywhere with no second edit; the overlay declares only the label and the handful of keys that carry no row.

| Export                    | Signature                              | Returns                     | Use it when                                                                            |
| ------------------------- | -------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| `INFOBOX_LAYOUTS`         | `const INFOBOX_LAYOUTS`                | —                           | looking up the four section layouts and the property each carries its content in       |
| `INFOBOX_VALUE_KINDS`     | `const INFOBOX_VALUE_KINDS`            | —                           | enumerating what a row's value may be                                                  |
| `DURATION_LABELS`         | `const DURATION_LABELS`                | —                           | naming a duration pair — the roll and the flat number of seconds — in either overlay   |
| `GEAR_UNITS`              | `const GEAR_UNITS`                     | —                           | naming a gear item's price and weight, and the unit each carries, in either overlay    |
| `UNSET_VALUES`            | `const UNSET_VALUES`                   | —                           | enumerating the words a corpus writes when it means "there is nothing here"            |
| `applyUnit`               | `applyUnit(kind, value, unit)`         | `object`                    | putting a declared unit on a row's value, where the quantity is                        |
| `NOT_AVAILABLE`           | `const NOT_AVAILABLE`                  | —                           | naming what a mapped system that produced no document says                             |
| `NOTHING_BEYOND_PROFILE`  | `const NOTHING_BEYOND_PROFILE`         | —                           | naming what a system holding nothing the note box has not shown says                   |
| `NOTE_BOX_ID`             | `const NOTE_BOX_ID`                    | —                           | naming the note infobox, which is not a system id                                      |
| `NOTE_BOX_TITLE`          | `const NOTE_BOX_TITLE`                 | —                           | naming the note infobox's heading                                                      |
| `NOTE_SECTION_ID`         | `const NOTE_SECTION_ID`                | —                           | naming the note infobox's single section                                               |
| `NOTE_FIELD_PRESENTATION` | `const NOTE_FIELD_PRESENTATION`        | —                           | looking up a `data:` key's label, the group it composes into, or why it carries no row |
| `assertInfoboxSet`        | `assertInfoboxSet(boxes, fm, options)` | `readonly object[]`, throws | refusing a page that carries anything but the boxes its type maps to                   |
| `buildInfoboxes`          | `buildInfoboxes(fm, options)`          | `object[]`                  | building every box a note carries, against a given set of maps and declarations        |
| `defineInfobox`           | `defineInfobox(declaration)`           | `object`                    | declaring one system's half of the infobox                                             |
| `hasRenderableValue`      | `hasRenderableValue(kind, value)`      | `boolean`                   | deciding whether a built value is worth a row                                          |
| `hasValue`                | `hasValue(value)`                      | `boolean`                   | deciding whether an authored value is worth a row                                      |
| `humanizeFieldName`       | `humanizeFieldName(name)`              | `string`                    | turning a declared key into the label a reader sees                                    |
| `humanizeValue`           | `humanizeValue(value)`                 | `string`                    | turning an authored value into readable text                                           |
| `isDeclaredDefault`       | `isDeclaredDefault(field, raw)`        | `boolean`                   | deciding whether a value is the one the field's own declaration would have supplied    |
| `isUnsetSentinel`         | `isUnsetSentinel(value)`               | `boolean`                   | deciding whether a value is a word meaning "nothing here" rather than a value          |
| `linkValue`               | `linkValue(ref, resolve, hint)`        | `object`                    | resolving one reference into a `link` value                                            |
| `noteInfobox`             | `noteInfobox(fm, options)`             | `object`                    | building the note box alone, from the type's `data:` vocabulary                        |
| `overlayFor`              | `overlayFor(presentation, type, name)` | `object`                    | reading a field's overlay entry, preferring the `<type>.<field>` key over the bare one |
| `presentValue`            | `presentValue(value)`                  | `string`                    | showing a value in a row, capitalising an enumerated one and leaving prose as written  |
| `requiredInfoboxIds`      | `requiredInfoboxIds(fm, options)`      | `string[]`                  | asking which boxes a note's type maps to                                               |
| `sectionHolds`            | `sectionHolds(section)`                | `boolean`                   | deciding whether a section holds anything a medium would draw                          |
| `systemRowsSection`       | `systemRowsSection(fm, fields, ctx)`   | `object[]`                  | building the rows a type's own field declaration yields                                |
| `valueKindOf`             | `valueKindOf(field, value)`            | `string`                    | reading the value kind a field declaration implies                                     |

### `engine.infoboxRegistry`

The infobox declarations this toolchain ships, one per system, and the single call each medium makes to build a note's boxes.

| Export            | Signature                    | Returns               | Use it when                                                                    |
| ----------------- | ---------------------------- | --------------------- | ------------------------------------------------------------------------------ |
| `KNOWN_INFOBOXES` | `const KNOWN_INFOBOXES`      | —                     | enumerating every system's infobox declaration, in the order a page shows them |
| `infoboxFor`      | `infoboxFor(system)`         | `object \| undefined` | looking up one system's declaration by its id                                  |
| `noteInfoboxes`   | `noteInfoboxes(fm, options)` | `object[]`, throws    | building every box one note carries, wired to the shipped registries           |

### `engine.infoboxRender`

Drawing a declared infobox: HTML for a Foundry Journal Page, Typst for the book. The website's boxes travel in front matter and the site theme draws them, so there is no renderer for it here.

| Export                 | Signature                             | Returns   | Use it when                                                              |
| ---------------------- | ------------------------------------- | --------- | ------------------------------------------------------------------------ |
| `infoboxTypstPreamble` | `infoboxTypstPreamble()`              | `string`  | emitting the panel definitions the book's bodies call, once per document |
| `infoboxesToHtml`      | `infoboxesToHtml(boxes, options)`     | `string`  | drawing the boxes as `<details>` disclosures, open by default            |
| `infoboxesToTypst`     | `infoboxesToTypst(boxes, options)`    | `string`  | drawing the boxes as panels that break between their sections            |
| `linkToHtml`           | `linkToHtml(value)`                   | `string`  | drawing a link value as an anchor on its URL                             |
| `linkToTypst`          | `linkToTypst(value, links, labelFor)` | `string`  | drawing a link value as a cross-reference into the book                  |
| `linkToUuid`           | `linkToUuid(value)`                   | `string`  | drawing a link value as a Foundry document reference                     |
| `sectionHasContent`    | `sectionHasContent(section)`          | `boolean` | deciding whether a section holds anything worth drawing                  |

### `engine.systems`

The closed registry of system ids, and the `none` that stands for no system at all. An unknown system value is an error; adding a system is a data change to this registry rather than a hardcoded set scattered through the pipeline.

| Export                 | Signature                              | Returns                         | Use it when                                                                                  |
| ---------------------- | -------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------- |
| `NO_SYSTEM`            | `const NO_SYSTEM`                      | —                               | naming the `<system>` segment of a note that belongs to no game system                       |
| `SYSTEM_IDS`           | `const SYSTEM_IDS`                     | —                               | enumerating every game system this toolchain compiles for                                    |
| `SYSTEM_SEGMENTS`      | `const SYSTEM_SEGMENTS`                | —                               | enumerating everything the `<system>` address segment may say — the systems plus `NO_SYSTEM` |
| `isSystemId`           | `isSystemId(value)`                    | `boolean`                       | checking whether a value names a game system this toolchain knows (`none` is rejected)       |
| `isSystemSegment`      | `isSystemSegment(value)`               | `boolean`                       | checking whether a value is something the `<system>` address segment may hold                |
| `unknownSystemMessage` | `unknownSystemMessage(value, where)`   | `string`                        | building the message for a caller that wrote an unknown system                               |
| `assertSystemSegment`  | `assertSystemSegment(value, where)`    | `string` — the value, unchanged | refusing a value the `<system>` segment may not hold, validating inline                      |
| `assertSystemCharset`  | `assertSystemCharset(segments, where)` | throws                          | refusing a registry declaration whose id could not be an address segment                     |

### `engine.contentAddress`

Where a content note publishes on the web. One rule, in one place, because two builds need the same answer: the knowledgebase build renders the page, and the link manifest records the address other packages link to. Stating it twice is how a manifest comes to assert a URL that resolves at build time and 404s for the reader.

| Export                   | Signature                                             | Returns                                                                                                                                                                                                 | Use it when                                                                                           |
| ------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `KB_PREFIX`              | `const KB_PREFIX`                                     | —                                                                                                                                                                                                       | The knowledgebase's mount within this package's site.                                                 |
| `addressSlug`            | `function addressSlug(fm)`                            | {string} The address segment, e.g.                                                                                                                                                                      | The single path segment a note is addressed by: `type-shortcode`.                                     |
| `packageAddress`         | `function packageAddress(fm)`                         | {string} The package-relative address, with a trailing slash and no leading one.                                                                                                                        | A note's address: `<type>-<shortcode>/`, e.g.                                                         |
| `canonicalKey`           | `function canonicalKey(pkg, system, type, shortcode)` | {string} `package-system-type-shortcode`, lowercased.                                                                                                                                                   | The **canonical** address of a note: fully qualified, one spelling per document, and globally unique. |
| `blockSystem`            | `function blockSystem(keyPath)`                       | {string} The system id, or `none`.                                                                                                                                                                      | Which system a frontmatter key path is written under.                                                 |
| `expandAddress`          | `function expandAddress(read, where)`                 | {string} The canonical `package-system-type-shortcode`.                                                                                                                                                 | Expand a written address to the one canonical address it names.                                       |
| `CANONICAL_KEY_SEGMENTS` | `const CANONICAL_KEY_SEGMENTS`                        | —                                                                                                                                                                                                       | How many segments a canonical key has, and therefore how many the reader below counts.                |
| `readCanonicalKey`       | `function readCanonicalKey(key)`                      | {{package: string, system: string, type: string, shortcode: string} \|null\|undefined} The parts; `null` when there is a string that is not in canonical form; `undefined` when there is no key at all. | Reads a canonical key back into its parts.                                                            |
| `PACKAGE_BASE`           | `const PACKAGE_BASE`                                  | —                                                                                                                                                                                                       | Where this build serves each package, keyed by package name.                                          |
| `checkBase`              | `function checkBase(base, what)`                      | {string} The base.                                                                                                                                                                                      | Asserts a base is usable as a prefix and returns it.                                                  |
| `packageRelative`        | `function packageRelative(url, base)`                 | {string} The address relative to `base`, with no leading slash.                                                                                                                                         | The package-relative address a site-absolute URL records as.                                          |
| `resolvePackageUrl`      | `function resolvePackageUrl(rel, base)`               | {string} The resolved URL.                                                                                                                                                                              | The URL a package-relative address resolves to in this build.                                         |
| `DOCUMENT_ID_NAMESPACE`  | `const DOCUMENT_ID_NAMESPACE`                         | —                                                                                                                                                                                                       | The namespace {@link documentId} hashes a canonical address under.                                    |
| `documentId`             | `function documentId(pkg, system, type, shortcode)`   | {string} A 16-character Foundry id.                                                                                                                                                                     | The Foundry `_id` of the document a note compiles into, derived from its canonical address.           |

- `NO_SYSTEM` — re-exported: Re-exported so the address grammar and the system vocabulary are one fact: {@link canonicalKey} writes this segment, and `engine/systems.mjs` decides what may appear in it.

### `engine.contentSlug`

One normalisation, for every slug this build makes. {@link slugify} reduces a piece of prose — a heading, a document name — to a URL-safe token. It is **not** how a page is addressed: a note's URL is its address, `type-shortcode`, derived in `engine/content-address.mjs` and touching no display string at all.

| Export    | Signature                | Returns                                                             | Use it when                                     |
| --------- | ------------------------ | ------------------------------------------------------------------- | ----------------------------------------------- |
| `slugify` | `function slugify(text)` | {string} The token, or `""` when the text carries nothing URL-safe. | The URL-safe token a piece of prose reduces to. |

### `engine.subtypeRegistry`

Which note-type → document-subtype maps this toolchain ships, and the two questions asked of the _list_ rather than of any one map. One frozen list, and the two lookups that need to choose among its members before a map can be consulted at all. It sits here rather than in `note-claims.mjs`, which is where the _questions_ asked of it live — but that module imports half the engine, so anything needing the bare list had to take all of it, and `helpers.mjs` could not take it at all: `note-claims.mjs` imports `walkMarkdownTree` from there, so the dependency would have closed a cycle.

| Export                        | Signature                                | Returns                                                                                                                           | Use it when                                                                                                                            |
| ----------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `KNOWN_DOCUMENT_SUBTYPE_MAPS` | `const KNOWN_DOCUMENT_SUBTYPE_MAPS`      | —                                                                                                                                 | The note-type → document-subtype maps this toolchain ships.                                                                            |
| `ACTOR_TYPES`                 | `const ACTOR_TYPES`                      | —                                                                                                                                 | Every note type any shipped map compiles into an **Actor**.                                                                            |
| `subtypeMapFor`               | `function subtypeMapFor(system)`         | {import("./document-subtypes.mjs").DocumentSubtypeMap\|undefined} Its map, or `undefined` where this toolchain ships none for it. | The map one system ships, by its id.                                                                                                   |
| `schemaSubtypeOf`             | `function schemaSubtypeOf(system, type)` | {string} The document subtype to look up.                                                                                         | The document subtype a note type compiles into for one system — the translation the _schema_ check needs, and the reason it needs one. |

### `engine.noteIds`

The id a note's document is filed under: its pinned `id:`, when a note authors one, or otherwise a hash of its canonical address. The canonical address (`sohl-none-miscgear-bowlcer`) is a readable identity that `content-lint` already guards — a duplicate address is a build error — so the derived id inherits that guarantee. An author who must keep a document's identity stable across a shortcode rename pins an `id:`.

| Export          | Signature                          | Returns                                                                                                   | Use it when                                                            |
| --------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `noteDocId`     | `function noteDocId(fm,`           | {string\|undefined} The document's `_id`, or `undefined` when the note has no address to derive one from. | The document id a note compiles under: its pin, or its address.        |
| `resolveNoteId` | `function resolveNoteId(fm, opts)` | {object\|null\|undefined} `fm`, for chaining.                                                             | Fill a note's `id` in place, so everything downstream reads one value. |

### `engine.noteRenames`

The shortcodes a note declares it used to be published under. A package's `(type, shortcode)` addresses are a published interface, and `addresses diff` reports what a build stopped publishing — telling a **rename** from a **withdrawal** by matching document ids across two releases. The property that rested on is gone: an id is derived from the canonical address, which carries the shortcode, so renaming a shortcode moves the id too: both sides of the join move together, the match finds nothing, and a rename is reported as a withdrawal with no successor named.

| Export                | Signature                          | Returns                                                                                          | Use it when                                                          |
| --------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `renamedFromEntries`  | `function renamedFromEntries(fm)`  | {readonly unknown[]} The authored entries, in authored order; empty when the note declares none. | The `renamedFrom:` entries a note authors, exactly as authored.      |
| `renamedFrom`         | `function renamedFrom(fm)`         | {string[]} The declared predecessor shortcodes.                                                  | The well-formed shortcodes among a note's `renamedFrom:` entries.    |
| `declaresRenamedFrom` | `function declaresRenamedFrom(fm)` | {boolean} `true` when the key is present and not null.                                           | Whether a note declares the key at all, however malformed its value. |

### `engine.metadataIndex`

The published content index — the artifact packages exchange addresses through. **A package publishes its own index; a consumer fetches the ones it depends on.** That is the whole mechanism, and it replaces a vendored link manifest that each repository committed a copy of every other repository's file into. Vendoring failed three ways, and only the last is about staleness:

| Export                         | Signature                                                  | Returns                                                                                                                                                                                | Use it when                                                                   |
| ------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `METADATA_RELATIONSHIP_KINDS`  | `const METADATA_RELATIONSHIP_KINDS`                        | —                                                                                                                                                                                      | The relationship kinds that are dependencies, and therefore citable.          |
| `metadataFileName`             | `function metadataFileName(pkg)`                           | {string} The file name, e.g.                                                                                                                                                           | What a package's content index is called, wherever it is written or fetched.  |
| `metadataRelationships`        | `function metadataRelationships(config)`                   | {Array<{id: string, manifest: string, kind: string, verified: string\|undefined}>} The dependencies, in declaration order.                                                             | Every dependency whose published index this build resolves addresses through. |
| `metadataCacheDir`             | `function metadataCacheDir(config, id, version)`           | {string} The directory.                                                                                                                                                                | The cache directory for one dependency's index at one version.                |
| `isComplete`                   | `const isComplete`                                         | {boolean} True when it was fetched to completion.                                                                                                                                      | Whether a dependency's cache is present and complete.                         |
| `markComplete`                 | `function markComplete(dir)`                               | {void}                                                                                                                                                                                 | Mark a dependency's cache complete.                                           |
| `cachedMetadataFiles`          | `function cachedMetadataFiles(config)`                     | {string[]} One index file per declared dependency.                                                                                                                                     | The fetched index files this build resolves foreign addresses against.        |
| `cachedMetadataIndexes`        | `function cachedMetadataIndexes(config)`                   | {Array<{id: string, file: string}>} One entry per declared dependency.                                                                                                                 | The same fetched indexes, each paired with the package that published it.     |
| `newestVersionDir`             | `function newestVersionDir(dirs)`                          | {string} The newest one.                                                                                                                                                               | The newest cached version among several version-keyed cache directories.      |
| `loadForeignIndexes`           | `function loadForeignIndexes(config, localPackages, bases` | {{index: Map<string, object>, packages: Set<string>, stale: Array<{package: string, reason: string}>}} The resolved addresses, which packages contributed, and what could not be read. | Resolve every foreign address this build can cite, from the fetched indexes.  |
| `cachedIndexPath`              | `function cachedIndexPath(config, pkg)`                    | {string} A path to name in a diagnostic.                                                                                                                                               | Where a dependency's fetched index sits, for naming it in a diagnostic.       |
| `unaddressableForeignPackages` | `function unaddressableForeignPackages(foreignIndex)`      | {Array<{package: string, entries: number, sampleKey: string}>} One finding per drifted package, in the order the index first names each.                                               | Whether a fetched index can still be _addressed_, as distinct from read.      |
| `formatUnaddressableFinding`   | `function formatUnaddressableFinding(finding, config)`     | {string} The formatted diagnostic, path first on the line.                                                                                                                             | One finding, in the standard `file:line:column: severity: message` form.      |

### `engine.foundryEntries`

Emitting this package's cross-package link manifest. `engine/content-address.mjs` owns the address _grammar_ — how a key is version is read, how a foreign file resolves. This module owns the _pass_: walking a content tree and deriving, for every note it publishes, the addresses that entry states. The two halves were split across the format module and a hand-written script in each consuming repository, which is how the two scripts came to differ in ways nobody chose — one routes its UUIDs through the pack router and one does not, and neither knew.

| Export                  | Signature                                               | Returns                                                                                                                    | Use it when                                                   |
| ----------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `LEAD_ANCHOR`           | `const LEAD_ANCHOR`                                     | —                                                                                                                          | The reserved anchor name for a journal's **first** page.      |
| `anchorsOf`             | `function anchorsOf(entryUuid, entryId, body, name)`    | {Record<string, string>} The anchors.                                                                                      | Every page of a note's journal, as `anchorName → whole UUID`. |
| `entriesForNote`        | `function entriesForNote(fm, name, address, body, ctx)` | {Array<object>} One or two entries, in {@link buildManifest}'s shape.                                                      | The manifest entries a single note produces.                  |
| `collectFoundryEntries` | `function collectFoundryEntries(contentBase, ctx)`      | {{entries: Array<object>, notes: number, skipped: Array<{file: string, reason: string}>}}                                  | Every note this package publishes, as manifest entries.       |
| `foundryIdentities`     | `function foundryIdentities(config`                     | {{contentPackage: string, foundryPackageId: string, packRouter: object, web: boolean, skipDirectories: readonly string[]}} | The identities an emission runs against, from configuration.  |
| `entryContext`          | `function entryContext(config`                          | {{contentPackage: string, foundryPackageId: string, packRouter: object, web: boolean, skipDirectories: readonly string[]}} | The identities an emission runs against, from configuration.  |

### `engine.contentIndex`

Emitting this package's content index. Every content build already walks the whole note tree and parses every note's frontmatter — the pack compilers, the site build, and the content-table expander each do it — and every one of them throws the result away when it finishes. So nothing outside a build can ask a question about the content: "which beings carry no `kbcat`?", "what does this table actually select?", "did that type rename leave anything behind?" have no answer short of writing a throwaway script that re-walks the tree. Eight dead Bestiary tables shipped for weeks behind exactly that gap.

| Export                  | Signature                                                                                       | Returns                                                                                                                                                                                                                  | Use it when                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `noteAddress`           | `function noteAddress(frontmatter, contentPackage)`                                             | {{slug: string, canonical: string}\|null} `slug` is what goes inside `[[…]]` within this package; `canonical` is the fully qualified key the manifest files the note under, carrying the package and the system as well. | The address a wikilink writes to reach a note, or `null` when it has none.                                                                                                       |
| `sortKeysDeep`          | `function sortKeysDeep(value)`                                                                  | {unknown} The value with every plain object's keys in sorted order.                                                                                                                                                      | Recursively sort an object's keys, so serialization is order-independent.                                                                                                        |
| `asciiName`             | `function asciiName(name)`                                                                      | {string\|null} The ASCII form, or `null` when there is no name, or nothing printable survives.                                                                                                                           | A note's display name reduced to printable 7-bit ASCII.                                                                                                                          |
| `asciiAliases`          | `function asciiAliases(aliases)`                                                                | {Array<string>} Possibly empty, never null: a note with no aliases has an empty set of them, which is a fact rather than a missing value, and a consumer iterating it should not have to check first.                    | A note's `name.aliases` reduced to printable 7-bit ASCII, in order.                                                                                                              |
| `serializeContentIndex` | `function serializeContentIndex(records)`                                                       | {string} One compact JSON object per line, newline-terminated.                                                                                                                                                           | Serialize records as JSON Lines.                                                                                                                                                 |
| `indexRecordsFor`       | `indexRecordsFor({ contentBase, config, skipDirectories, problems })`                           | {object[]} One record per note, plus one per documentation entry.                                                                                                                                                        | The index records for a content tree, without writing anything.                                                                                                                  |
| `emitContentIndex`      | `emitContentIndex({ contentBase, outDir, config })`                                             | {{file: string, notes: number, bytes: number}} Where it was written, how many notes it holds, and its size.                                                                                                              | Emit this package's content index.                                                                                                                                               |
| `buildIndexRecord`      | `buildIndexRecord({ frontmatter, relPath, absPath, contentPackage, body, bodyLine, manifest })` | `Record<string, any>` — the record, with derived fields sorted deep                                                                                                                                                      | building one note's content-index record; refuses a note that authors a key the index derives itself (`package` among them) before building anything                             |
| `collectContentIndex`   | `collectContentIndex(contentBase, { contentPackage, skipDirectories, manifest, problems })`     | `Array<Record<string, any>>`                                                                                                                                                                                             | reading a whole content tree into index records, in a total order independent of directory-read order; an item note yields two records (its own and its documentation journal's) |

`engine.contentIndex` also re-exports five names from neighbouring leaf modules, at this same import path:

| Export                | Signature                        | Returns                                                        | Use it when                                                                                                                                                                      |
| --------------------- | -------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collectAnchors`      | `collectAnchors(body, bodyLine)` | `Array<{slug: string, line: number}>`                          | reading a note body's anchors, shared with the link checker and every build that emits a link                                                                                    |
| `DERIVED_KEYS`        | `const DERIVED_KEYS`             | —                                                              | reading which keys the content index adds to a record, and which a note therefore may not author itself                                                                          |
| `noteFile`            | `noteFile(contentBase, record)`  | `string` — the note's absolute path                            | composing an index record's `file.path` (recorded relative, for a byte-stable artifact) back into an openable absolute path                                                      |
| `authoredFrontmatter` | `authoredFrontmatter(record)`    | `Record<string, any>` — the frontmatter without `DERIVED_KEYS` | reading back exactly what a note authored from its index record, so a pass can lint or compile from the index without reasoning about derived fields as if the author wrote them |
| `isNoteRecord`        | `isNoteRecord(record)`           | `boolean`                                                      | telling a note's own record apart from its documentation journal's, when enumerating the corpus                                                                                  |

### `engine.siteBuild`

Publishing a content tree as a website. Compiling a content tree into compendium packs is `content-build package compile`. Publishing the _same tree_ as a website was a script each consumer wrote for itself — 473 code lines in `sohl` and 462 in `sohl-thalorna`, 87 of them identical — and the copies drifted in ways neither repository could see. `sohl-thalorna` reimplemented four things this package already exported, not because it needed different behaviour but because its script predates the extraction. That is the failure a command removes: a consumer cannot accidentally reimplement one.

| Export                 | Signature                                         | Returns                                                                                                                                | Use it when                                                                   |
| ---------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `walkSiteTree`         | `function walkSiteTree(dir, skip`                 | {string[]} Absolute paths.                                                                                                             | Every `.md` file under `dir`, depth-first in directory order.                 |
| `collectContentPages`  | `function collectContentPages(contentBase, ctx)`  | {{pages: object[], addressFindings: object[], fmLinkFindings: object[]}}                                                               | The content tree's pages, and what could not be addressed.                    |
| `collectTreePages`     | `function collectTreePages(tree, ctx)`            | {{pages: object[], fmLinkFindings: object[]}}                                                                                          | An extra tree's pages — a documentation tree published alongside the content. |
| `collectHomepages`     | `function collectHomepages(contentBase, ctx)`     | {{pages: object[], addressFindings: object[]}} The homepage notes, in walk order, and the ones among them that could not be addressed. | The package's homepage notes — the authored page at `/<contentPackage>/`.     |
| `writeHomepages`       | `function writeHomepages(outRoot, pages, config)` | {number} How many pages were written.                                                                                                  | Writes each homepage at its address, below the package's own root.            |
| `siteGates`            | `function siteGates(pages, findings,`             | {object} The gate results and, when they pass, the built index.                                                                        | The integrity gates a site build runs before it writes anything.              |
| `emptyGates`           | `function emptyGates()`                           | {object} An all-clear gate result.                                                                                                     | The gate result of a build that ran none of them.                             |
| `gatesFailed`          | `function gatesFailed(gates)`                     | —                                                                                                                                      | Whether any gate produced a finding.                                          |
| `tableUniverse`        | `function tableUniverse(pages)`                   | {Map<string, object[]>} Package → the notes it may tabulate.                                                                           | The universe a generated table searches, grouped by package.                  |
| `sectionFrontmatter`   | `function sectionFrontmatter(meta)`               | {object} Its front matter, `title` first.                                                                                              | The front matter a section's landing states about itself.                     |
| `pageFrontmatter`      | `function pageFrontmatter(page,`                  | {object} The frontmatter to write.                                                                                                     | The frontmatter a page publishes with.                                        |
| `pageDestination`      | `function pageDestination(page)`                  | —                                                                                                                                      | Where a page is written, relative to the output root.                         |
| `renderPages`          | `function renderPages(pages, options)`            | {{written: number, byKind: Record<string, number>, tableErrors: object[], wikiErrors: object[]}}                                       | Renders and writes every page.                                                |
| `writeSectionLandings` | `function writeSectionLandings(outRoot,`          | {number} How many landings were written.                                                                                               | Writes the Hugo sections a published tree declares.                           |
| `pluralTitle`          | `function pluralTitle(name)`                      | {string} The display title.                                                                                                            | A section landing's title, from its directory name — `macro` → `Macros`.      |
| `resolveSitePass`      | `function resolveSitePass(name, options)`         | {{beforeLinks?: Function, afterLinks?: Function}} The bundle.                                                                          | Resolves `site.pass` to its bundle.                                           |
| `resolveOutputRoot`    | `function resolveOutputRoot(rootDir, out)`        | {string} The absolute output root.                                                                                                     | The output root, having established that it is safe to delete.                |
| `buildSite`            | `buildSite({ config, outRoot, sqlTables })`       | {{gates: object, stats: object\|null, tableErrors: object[], wikiErrors: object[], manifests: object\|null}}                           | Builds a Hugo content tree from a content tree, and reports what it found.    |

### `engine.contentLint`

Linting a content tree's **addresses** — the rules every package's notes are authored against, wherever those notes live. These rules do not live in a consumer's `utils/`, which has two consequences and no upside. `thalorna` and `kethira` notes were checked by nothing at all, so the packages most likely to carry authoring mistakes were the ones nothing inspected. And one rule with two implementations can disagree without anything detecting it, which the canonical-separator handling already did once on each side.

| Export              | Signature                                                                                      | Returns                                                                                                                                                                                               | Use it when                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `SHORTCODE_PATTERN` | `const SHORTCODE_PATTERN`                                                                      | —                                                                                                                                                                                                     | The shape every `shortcode` must match: ASCII letters and digits only. |
| `isValidShortcode`  | `function isValidShortcode(value)`                                                             | {boolean} `true` when it matches {@link SHORTCODE_PATTERN}.                                                                                                                                           | Whether a value is a well-formed shortcode.                            |
| `lintContentTree`   | `lintContentTree(contentBase, { skipDirectories, contentPackage, config, records, problems })` | {{findings: Array<{file: string, line?: number, column?: number, severity: "error"\|"warning", message: string}>, notes: number, keys: number}} The findings, and what was inspected to produce them. | Lint every address in a content tree.                                  |

### `engine.contentCharset`

The charset authored content is held to, so a book can choose its face. The packs and the website render in whatever font the reader's browser or Foundry supplies, and a glyph nobody has is somebody else's problem. **A book is not that.** A PDF embeds the faces it sets, so every character in the corpus is a claim on the book's typeface — and the claim is silent, which is what makes it expensive.

| Export               | Signature                                  | Returns                                                                                                                                                                | Use it when                                                                |
| -------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `isLetterTier`       | `function isLetterTier(cp)`                | {boolean} Whether Tier 1 admits it.                                                                                                                                    | Tier 1 — the letters, and the two whitespace characters a file is made of. |
| `TYPOGRAPHY`         | `const TYPOGRAPHY`                         | —                                                                                                                                                                      | Tier 2 — typography, enumerated one codepoint at a time.                   |
| `NOTATION`           | `const NOTATION`                           | —                                                                                                                                                                      | Tier 3 — the notation the rules and price tables are written in.           |
| `isAllowedCodePoint` | `function isAllowedCodePoint(cp)`          | {boolean} Whether it is allowed outside a code fence.                                                                                                                  | Whether the charset admits a code point anywhere in a note.                |
| `isDiagramCodePoint` | `function isDiagramCodePoint(cp)`          | {boolean} Whether a fence may carry it.                                                                                                                                | Whether a code point is diagram furniture, admitted inside a fence only.   |
| `refusalFor`         | `function refusalFor(cp)`                  | {string} A clause naming what it is and what to do instead.                                                                                                            | The reason a code point is refused.                                        |
| `decomposedRuns`     | `function decomposedRuns(text)`            | {Array<{sequence: string, composed: string, index: number}>} Each offending run, in the order it appears.                                                              | Every non-NFC run in a string, with the composed form it should have been. |
| `checkText`          | `function checkText(text, file)`           | {Array<{file: string, line: number, column: number, severity: "warning", message: string}>} What is wrong, in file order.                                              | Check one file's text against the charset and the normalization rule.      |
| `lintContentCharset` | `function lintContentCharset(contentBase,` | {{findings: Array<{file: string, line: number, column: number, severity: "warning", message: string}>, files: number}} The findings, and how many files produced them. | Walk a content tree and check every authored file in it.                   |

### `engine.contentIcons`

Naming an interface icon in a note, without drawing it there. The user guide describes Foundry's interface, and it did so by pasting Unicode lookalikes of the icons the sheets actually draw: `☆` for the improve flag, `✎` for the formula editor, `◆` in the success-value table, `★★★` for mastery. The system renders every one of those with **Font Awesome** — a `fa-regular fa-star`, a `fa-solid fa-pen-to-square` — so the note and the screen it describes were drawing different pictures, and drifting apart with every sheet change.

| Export                | Signature                                    | Returns                                                                                                                               | Use it when                                                                   |
| --------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `EMPTY_ICON_REGISTRY` | `const EMPTY_ICON_REGISTRY`                  | —                                                                                                                                     | The registry a package that declares none gets: nothing at all.               |
| `familyOf`            | `function familyOf(entry, registry`          | {string\|undefined} The family name, or nothing when neither the entry nor the registry says.                                         | The family an entry draws from, named or defaulted.                           |
| `ICON_SIZES`          | `const ICON_SIZES`                           | —                                                                                                                                     | The sizes a note may ask for, and what each means on a page.                  |
| `ICON_ATTRIBUTES`     | `const ICON_ATTRIBUTES`                      | —                                                                                                                                     | The attribute names a note may write, and how each is validated.              |
| `parseIconAttributes` | `function parseIconAttributes(raw)`          | {{attrs: Record<string, string>, problems: string[]}} What was written, and what cannot be honoured.                                  | Read the brace of an icon token.                                              |
| `ICON_PATTERN`        | `const ICON_PATTERN`                         | —                                                                                                                                     | The shape a note writes, and the one this module claims.                      |
| `resolveIcon`         | `function resolveIcon(name, registry`        | {object\|null} The entry, or `null` when the registry does not declare it.                                                            | Look one name up.                                                             |
| `iconHtml`            | `function iconHtml(entry, attrs`             | {string} An `<i>` element.                                                                                                            | The HTML the journals and the website emit — what the system already renders. |
| `iconsIn`             | `function iconsIn(text)`                     | {Array<{name: string, index: number, raw: string}>} What it names.                                                                    | Every icon a string names, in the order written.                              |
| `lintIcons`           | `function lintIcons(text, file, registry`    | {Array<{file: string, line: number, column: number, severity: "warning", message: string}>} The unknown names.                        | Report every icon a tree names that its registry does not declare.            |
| `checkIconRegistry`   | `function checkIconRegistry(registry, where` | {Array<{severity: "warning", message: string}>} What is wrong with it.                                                                | What is wrong with a package's declared registry.                             |
| `lintContentIcons`    | `function lintContentIcons(contentBase,`     | {{findings: Array<{file: string, line: number, column: number, severity: "warning", message: string}>, files: number}} What it found. | Walk a content tree and report every icon name its registry does not declare. |
| `iconPlugin`          | `function iconPlugin(registry`               | {(md: object) => void} A markdown-it plugin.                                                                                          | A markdown-it plugin rendering `:icon-name:` inline.                          |

### `engine.contentHtml`

Raw HTML in a note's prose, reported. **A note is markdown.** What markdown cannot say, a note does not say — it gets a construct every surface can render, the way `:icon-…:` replaces a pasted glyph.

| Export            | Signature                               | Returns                                                                                                                                                            | Use it when                                                    |
| ----------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `HTML_TAG`        | `const HTML_TAG`                        | —                                                                                                                                                                  | A raw HTML tag, opening, closing or self-closing.              |
| `htmlMessage`     | `function htmlMessage(tag)`             | {string} The message, unpunctuated at the end as a finding is.                                                                                                     | What a note carrying raw HTML is told.                         |
| `checkHtml`       | `function checkHtml(body, file,`        | {Array<{file: string, line: number, column: number, severity: "warning", message: string}>} One finding per tag, in source order.                                  | Every raw HTML tag in one note's body.                         |
| `lintContentHtml` | `function lintContentHtml(contentBase,` | {{findings: Array<{file: string, line: number, column: number, severity: "warning", message: string}>, files: number}} The findings, and how many files were read. | Walk a content tree and report raw HTML in every note's prose. |

### `engine.contentImages`

An image saying how wide it is and where it sits. A markdown image carries no indication of either, so each of the three surfaces decides for itself and the author — who is the one who knows — has no way to say. A directive in the curly-attribute convention Pandoc and Kramdown use closes that, in two closed vocabularies: a width class, and a `float:` position.

| Export                | Signature                                       | Returns                                                                                                                                        | Use it when                                                                  |
| --------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `IMAGE_CLASSES`       | `const IMAGE_CLASSES`                           | —                                                                                                                                              | The width classes an image may carry, and what each means to a renderer.     |
| `IMAGE_FLOATS`        | `const IMAGE_FLOATS`                            | —                                                                                                                                              | The `float:` positions an image may take, and where each puts it.            |
| `IMAGE_FIGURE_CLASS`  | `const IMAGE_FIGURE_CLASS`                      | —                                                                                                                                              | The class every figure carries, whatever its width or position.              |
| `IMAGE_PATTERN`       | `const IMAGE_PATTERN`                           | —                                                                                                                                              | A markdown image, with the directive it may carry.                           |
| `imageSourceProblem`  | `function imageSourceProblem(src)`              | {string} The problem, as a finding's sentence, or `""`.                                                                                        | What is wrong with an image's address, or `""` when nothing is.              |
| `parseImageDirective` | `function parseImageDirective(raw)`             | {{classes: string[], float: string, problems: string[]}} What was written, and what cannot be honoured.                                        | Read the directive on an image.                                              |
| `figureClasses`       | `function figureClasses(directive)`             | {string} A space-separated class list.                                                                                                         | The classes a figure carries, from a parsed directive.                       |
| `escapeHtml`          | `function escapeHtml(text)`                     | {string} The same value, safe in markup.                                                                                                       | Text going inside an HTML attribute or between tags.                         |
| `imageFigureHtml`     | `function imageFigureHtml(image)`               | {string} The figure, as one HTML block.                                                                                                        | One image as the `<figure>` both HTML surfaces render.                       |
| `standsAlone`         | `function standsAlone(text, start, end)`        | {boolean} Whether the match is a block of its own.                                                                                             | Whether a match sits alone in its own paragraph.                             |
| `imagesIn`            | `function imagesIn(body)`                       | {Array<{alt: string, src: string, title: string, directive: string, index: number, length: number, block: boolean}>} One entry per image.      | Every image in one body, with its directive and its position.                |
| `imageSourcesIn`      | `function imageSourcesIn(body)`                 | {string[]} The addresses, with repeats.                                                                                                        | Every image address one body names, in order of appearance.                  |
| `checkImages`         | `function checkImages(body, file,`              | {Array<{file: string, line: number, column: number\|undefined, severity: "error", message: string}>} One finding per defect, in source order.  | Every defect in one note's images.                                           |
| `lintContentImages`   | `function lintContentImages(contentBase,`       | {{findings: Array<{file: string, line: number, column: number\|undefined, severity: "error", message: string}>, files: number}} What it found. | Walk a content tree and report every image it cannot render as authored.     |
| `renderImageFigures`  | `function renderImageFigures(body, resolveSrc)` | {string} The same body, with each block image as a `<figure>`.                                                                                 | Rewrite every block image in a body into the figure the website publishes.   |
| `imagePlugin`         | `function imagePlugin()`                        | {(md: object) => void} A markdown-it plugin.                                                                                                   | A markdown-it plugin that reads an image's directive and renders its figure. |

### `engine.pathnames`

One authored pathname, and the four addresses it resolves to. A note names a file once — in `img:`, in `data.portrait:`, in the body of a markdown image — and the first segment says which package owns it when an `assets/` follows. Every surface derives its own address from that one statement: the path inside a Foundry install, the file in the owning repository's tree, the address the website serves, and where the book stages its copy.

| Export              | Signature                               | Returns                                                                                            | Use it when                                                         |
| ------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `ASSETS_SEGMENT`    | `const ASSETS_SEGMENT`                  | —                                                                                                  | The directory a package ships its files in.                         |
| `PATHNAME_SURFACES` | `const PATHNAME_SURFACES`               | —                                                                                                  | The surfaces one authored pathname resolves for.                    |
| `pathnameProblem`   | `function pathnameProblem(raw)`         | {string} The problem, as a finding's sentence, or `""`.                                            | What is wrong with an authored pathname, or `""` when nothing is.   |
| `packageAddresses`  | `function packageAddresses(config)`     | {Map<string, {root: string\|null, id: string\|null, own: boolean}>} The packages, by package name. | Every content package this build can resolve a pathname against.    |
| `resolvePathname`   | `function resolvePathname(raw, config)` | {PathnameForms\|null} The four forms, or `null` when the note names no file.                       | Resolve one authored pathname into the address each surface serves. |

### `engine.contentLinks`

Resolving every link in a content tree, and reporting the ones that land nowhere. Three link defects survive both content builds silently, so neither the pack compilers nor a site build catches them:

| Export               | Signature                                                                                | Returns                                                                                                                                                                                                                      | Use it when                                                   |
| -------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `anchorsOf`          | `function anchorsOf(body)`                                                               | {Set<string>} The declared anchor slugs.                                                                                                                                                                                     | Every `{#anchor}` a note declares on a heading.               |
| `buildLinkIndex`     | `buildLinkIndex(contentBase, { config, skipDirectories, sqlTables, records, problems })` | {object} The notes, the index, and the resolvers built over it.                                                                                                                                                              | Read a content tree into the index a link resolves against.   |
| `auditHomepageLinks` | `function auditHomepageLinks(index)`                                                     | {Array<{note: object, field: string, url: string, text: string, occurrence: number, message: string}>} One finding per defect, `text` and `occurrence` locating it in the note's raw source.                                 | Every defect in the addresses a package homepage carries.     |
| `auditLinks`         | `function auditLinks(index)`                                                             | {{deadAnchors: object[], deadAddresses: object[], unlabelledLinks: object[], frontmatterLinks: object[], homepageLinks: object[], usedManifest: Set<string>}} The findings, and which addresses a foreign manifest answered. | Every link in a tree that lands nowhere.                      |
| `walkReachability`   | `function walkReachability(index,`                                                       | {{root: object, reached: Set<object>, orphans: object[]}} The root, everything reached from it, and the corpus members that were not.                                                                                        | Walk a corpus from its root and report what nothing links to. |

### `engine.webWikilinks`

Wikilink resolution for the knowledgebase build. The same authored links the pack compilers turn into Foundry `@UUID` enrichers (see `./wikilinks.mjs`) become site-local hrefs here:

| Export                 | Signature                                 | Returns                                                                                                                                           | Use it when                                                           |
| ---------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `frontmatterWikilinks` | `function frontmatterWikilinks(fm)`       | {Array<{path: string, link: string}>} In reading order; `path` is the dotted key path of the offending value (`government.summary`, `aliases.1`). | Every wikilink authored inside a frontmatter value.                   |
| `resolveWebWikilinks`  | `function resolveWebWikilinks(body, ctx)` | {string} The body with wikilinks rewritten.                                                                                                       | Rewrites the wikilinks in a markdown body as KB-local markdown links. |

### `engine.contentTables`

Generated content tables — Obsidian **Dataview** `TABLE` queries. A catalog table (every cloth armour, every animal's abilities) is data that already lives in the frontmatter of the notes it describes. Authoring such a table by hand duplicates that data and guarantees drift, so a content body instead declares what it wants tabulated, in a fenced `dataview` block:

| Export                | Signature                                                                    | Returns                                                                                                                                                            | Use it when                                                                                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parseDataviewQuery`  | `function parseDataviewQuery(source)`                                        | {{columns: Array<{header: string, expr: object}>, from: object\|null, where: object\|null, sort: Array<{expr: object, descending: boolean}>, limit: number\|null}} | Parse one `dataview` block's query.                                                                                                                                                                                         |
| `resolveField`        | `function resolveField(doc, path)`                                           | {unknown} `null` when the note has no such field.                                                                                                                  | Resolve a dotted path against a content note.                                                                                                                                                                               |
| `evaluate`            | `function evaluate(node, doc, self)`                                         | {unknown}                                                                                                                                                          | Evaluate one parsed expression against a note.                                                                                                                                                                              |
| `selectRows`          | `function selectRows(spec, docs, self)`                                      | {Array<ContentTableDoc>} The matching notes, sorted and limited.                                                                                                   | The notes a query selects, in the order its `SORT` keys give.                                                                                                                                                               |
| `renderContentTable`  | `function renderContentTable(spec, rows, linkable, self)`                    | {string} The markdown table (no trailing newline).                                                                                                                 | Build the markdown table for one query.                                                                                                                                                                                     |
| `expandContentTables` | `expandContentTables(markdown, { docs, linkable, source, self, sqlTables })` | `{markdown: string, errors: object[], lineMap: object[], warnings: object[]}`                                                                                      | expanding every fenced `dataview` block in a markdown body; a block that cannot be honoured is left verbatim and reported in `errors` rather than failing the build, and a query matching no note renders as an empty table |

### `engine.helpers`

Shared helpers for the pack compilers in `packages/content-build/`. The HeroicLands vault is authoritative for compendium item data. Pack compilers walk the vault, read markdown files with YAML frontmatter, and emit Foundry-compatible JSON. These helpers handle the common shape: markdown parsing, frontmatter access (including the nested `sohl:` block), filename generation, and slug normalization.

| Export                    | Signature                                                                                                   | Returns                                                                                                                                                                                                                                 | Use it when                                                                                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `md`                      | `const md`                                                                                                  | —                                                                                                                                                                                                                                       | The markdown renderer every surface shares.                                                                                                                                                          |
| `parseMarkdownFile`       | `function parseMarkdownFile(filePath)`                                                                      | —                                                                                                                                                                                                                                       | Parses a markdown file with YAML frontmatter.                                                                                                                                                        |
| `assertStatedScope`       | `function assertStatedScope(skipDirectories, who)`                                                          | {void}                                                                                                                                                                                                                                  | Refuse a corpus read whose scope its caller did not state.                                                                                                                                           |
| `assertSuppliedCorpus`    | `function assertSuppliedCorpus(records, who)`                                                               | {void}                                                                                                                                                                                                                                  | Refuse a corpus read whose records its caller did not supply.                                                                                                                                        |
| `statedTemplatePriority`  | `function statedTemplatePriority(fm, label,`                                                                | {number\|null} The priority, or `null` when the note is not a template or states nothing.                                                                                                                                               | The template priority a note states, for a system that treats an unstated one as "not a template" rather than as an authoring error.                                                                 |
| `resolveTemplatePriority` | `function resolveTemplatePriority(fm, label,`                                                               | {number\|undefined} The template priority, or `undefined` when null.                                                                                                                                                                    | Resolve the required `templatePriority` frontmatter for an Item/Actor entry (the archetype contract).                                                                                                |
| `systemTemplatePriority`  | `function systemTemplatePriority(fm, label)`                                                                | {number\|null} The template priority, or `null` for a document that is not a template.                                                                                                                                                  | The value a document's `system.templatePriority` carries, from the required `templatePriority` frontmatter (`archetype` is the legacy spelling).                                                     |
| `makeFilename`            | `function makeFilename(name, id)`                                                                           | —                                                                                                                                                                                                                                       | Generates a compendium-source filename: `Name_id.json` with non- alphanumeric runs replaced by underscores.                                                                                          |
| `resolveImg`              | `function resolveImg(raw, config`                                                                           | {string \| null} the Foundry-relative path; `""` for a deliberate blank, and `null` when the note names no art at all.                                                                                                                  | Translate a content-relative image path into its Foundry-relative form.                                                                                                                              |
| `resolveName`             | `function resolveName(fm, defaultValue`                                                                     | —                                                                                                                                                                                                                                       | Resolves the display name from frontmatter, preferring `name.full`, falling back to `name` (if string), then `defaultValue`.                                                                         |
| `supportedCoreVersion`    | `function supportedCoreVersion(config`                                                                      | {string} The declared `compatibility.minimum`.                                                                                                                                                                                          | The oldest Foundry core this package supports, stamped into every compiled document as `_stats.coreVersion`.                                                                                         |
| `buildStats`              | `function buildStats(systemVersion`                                                                         | {object} The `_stats` block.                                                                                                                                                                                                            | Default `_stats` block for compiled compendium entries.                                                                                                                                              |
| `statsForPack`            | `function statsForPack(packSystem, config`                                                                  | {object} The `_stats` block for that pack.                                                                                                                                                                                              | The `_stats` block for one pack, stamped with the system that pack is for.                                                                                                                           |
| `defaultStats`            | `function defaultStats()`                                                                                   | {object} The default `_stats` block, shared by every compiler.                                                                                                                                                                          | The `_stats` block every compiler stamps on an entry it emits, built once.                                                                                                                           |
| `buildContentLinkIndex`   | `buildContentLinkIndex(contentBase, router, { skipDirectories, config, records, problems })`                | {{byShortcode: Map, types: Set}} From `buildWikilinkIndex`.                                                                                                                                                                             | Indexes **every** note in the content tree so any pack compiler can resolve a wikilink to any other document.                                                                                        |
| `convertNoteWikilinks`    | `convertNoteWikilinks(body, { type, id, pack, docPack, index, name, file, bodyLine, bodyColumn, lineMap })` | {{markdown: string, unresolved: Array<object>}}                                                                                                                                                                                         | Converts the wikilinks in one note's markdown, reporting any that have no target in the content tree.                                                                                                |
| `collectContentDocs`      | `collectContentDocs(contentBase, { skipDirectories, config, records, problems })`                           | {Array<{fm: object, path: string, tld: string, folder: string, absPath: string}>}                                                                                                                                                       | Every note in the content tree, in the shape the `dataview` table expander searches: its frontmatter plus where it sits in the tree.                                                                 |
| `expandNoteTables`        | `function expandNoteTables(body,`                                                                           | {{markdown: string, lineMap: Array<{line: number, generated: boolean}>}} The body with every table expanded, and where each emitted line came from — which is what lets a diagnostic about the expanded body name an authored position. | Expand the fenced `dataview` tables in one note's markdown, before wikilinks are resolved — so a generated cell may itself be a wikilink.                                                            |
| `folderFilename`          | `function folderFilename(name, id)`                                                                         | —                                                                                                                                                                                                                                       | Builds a compendium-source filename for a folder JSON document: `folder_Name_id.json` with non-alphanumeric runs replaced by underscores.                                                            |
| `walkMarkdownTree`        | `walkMarkdownTree(rootDir, { skipDirectories })`                                                            | generator yielding `{frontmatter, body, description, bodyLine?, bodyColumn?, file, absPath}`                                                                                                                                            | walking a content tree and reading every markdown file's frontmatter and body; `skipDirectories` is required rather than defaulted, so two callers cannot silently disagree about the corpus's scope |

### `engine.itemRegistry`

**The resolved item-type registry** — the consuming repository's `itemBuilders` table, and the type whitelist derived from its keys. Both are read from the one resolved configuration, so they are literally the same object's keys and values: a type cannot be whitelisted for compilation without the builder that compiles it, which is the guarantee this exists for. Where a consumer declares **several** registries, one per system, the vocabulary is their union and every lookup below takes the system that is asking — a type both systems declare has two builders, and answering with one of them because it was declared first is the silent-wrong-output failure this package spends its time removing. The Item compiler dispatches through {@link itemBuilder}, so the table a consumer configured is the table its notes compile with — the whitelist and the dispatch would otherwise come from different places, and a consumer supplying its own registry got the types it asked for and the builders it did not.

| Export        | Signature                            | Returns                                                         | Use it when                                                                                                     |
| ------------- | ------------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `itemTypes`   | `function itemTypes()`               | {ReadonlySet<string>} The configured item types.                | Every content type that compiles into an item — and therefore into an item doc.                                 |
| `itemBuilder` | `function itemBuilder(type, system)` | {(fm: object) => object} The builder for that type.             | The builder the consuming repository registered for an item type.                                               |
| `itemFields`  | `function itemFields(type, system)`  | {readonly object[]\|undefined} The declaration, or `undefined`. | The frontmatter fields a type's registry entry declares, if any.                                                |
| `itemArt`     | `function itemArt(type, system)`     | {string} The default image path for that type.                  | The default art for an item type — the image a note of that type is given when it carries no `img:` of its own. |

### `engine.documentSubtypes`

**The note-type → document-subtype map** — the mechanism that stops a build inferring a Foundry document's subtype from the markdown note's `type`. A note's `type` and the subtype of the document it compiles into are two vocabularies, and until now they were the same identifier for one reason only: a builder wrote the same string twice. `sohl/actors.mjs` declared `ACTOR_VAULT_TYPE = "being"` and emitted `type: "being"` several hundred lines below it, under a comment reading _"One content type, named for the Foundry actor it produces."_ Nothing related the two, so changing one and not the other produced a wrongly-typed document in silence — a wrong-output risk with **one** system, not merely with two.

| Export                   | Signature                                             | Returns                                                                                                                              | Use it when                                                              |
| ------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `defineDocumentSubtypes` | `defineDocumentSubtypes({ system, block, types })`    | {DocumentSubtypeMap} The frozen map, rows and all.                                                                                   | Declare one system's note-type → document-subtype map.                   |
| `subtypeRow`             | `function subtypeRow(map, noteType)`                  | {Readonly<DocumentSubtypeRow>\|undefined} The row, or `undefined` where this system maps the type at all.                            | The row a system declares for a note type, or nothing.                   |
| `mapsNoteType`           | `function mapsNoteType(map, noteType, document)`      | {boolean} True when the map carries a matching row.                                                                                  | Whether a system maps a note type — optionally, onto one document class. |
| `noteTypesFor`           | `function noteTypesFor(map, document)`                | {string[]} The note types, in sorted order.                                                                                          | Every note type a system maps onto one document class, sorted.           |
| `documentSubtype`        | `function documentSubtype(map, noteType, fm,`         | {string\|undefined} The subtype, or `undefined` where this system maps nothing for the type — which means no document, not an error. | The document subtype a note compiles into for one system.                |
| `referencedSubtype`      | `function referencedSubtype(map, noteType, document)` | {ReferencedSubtype} The subtype, or why there is none.                                                                               | The document subtype a `(type, shortcode)` **reference** addresses.      |
| `systemOf`               | `function systemOf(type, maps)`                       | {string} The system id, or {@link NO_SYSTEM}.                                                                                        | Which system defines the document a note of this type compiles into.     |

### `engine.itemDocs`

**Item docs** — an item's prose compiled as a JournalEntry, with the item keeping only a pointer to it. An item note's body describes what the thing _is_. That is documentation, and documentation belongs in the journals pack, so each item note compiles into a JournalEntry and the item's `system.docHtml` becomes nothing but a `@UUID` link to that entry's first page — the description-as-pointer convention, which {@link sohl.utils.descriptionLinkTarget} recognises and Display Description follows.

| Export           | Signature                                                       | Returns                                                                                          | Use it when                                                                                                                 |
| ---------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `docEntryTypes`  | `function docEntryTypes()`                                      | {ReadonlySet<string>} The configured doc-carrying types.                                         | Every content type whose **prose compiles into a JournalEntry of its own**, addressed by the virtual `doc<type>` qualifier. |
| `hasDocEntry`    | `function hasDocEntry(type)`                                    | {boolean} True for an item type, for `macro` and for a map type; false for `doc` and for actors. | Whether a content note's type is one whose prose becomes a JournalEntry of its own.                                         |
| `itemDocEntryId` | `function itemDocEntryId(itemId)`                               | {string} A 16-character Foundry id.                                                              | The id of the JournalEntry a note's prose compiles into — an item's, or a macro's.                                          |
| `itemDocPointer` | `function itemDocPointer(packageId, itemId, name, firstPageId)` | {string} The pointer to store in `system.docHtml`.                                               | The description an item carries in place of its prose: a `@UUID` link to the first page of its item doc, and nothing else.  |

- `itemTypes` — re-exported: Every content type that compiles into an item — and therefore into an item doc.

### `engine.wikilinks`

Wikilink resolution for the pack compilers. Content notes link to one another with wikilinks rather than file paths:

| Export               | Signature                                                               | Returns                                                                                                                                                                                                                                                                                                                               | Use it when                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolveItemDocType` | `function resolveItemDocType(qualifier, types)`                         | {string\|null} The underlying document type, or `null` when the qualifier is not a virtual one.                                                                                                                                                                                                                                       | Reads a qualifier as the **virtual `doc<type>`** form, or reports that it is not one.                                                                                      |
| `readQualifier`      | `function readQualifier(target, types, packages)`                       | {{type: string, shortcode: string, itemDoc: boolean, package?: string, system?: string, reason?: undefined} \| {reason: "unknown-type"} \| null} The resolved qualifier; a `reason` when the target is definitely qualified but names no known type; or `null` when it is not an address at all.                                      | Read a link target as a **qualified** `type-shortcode` reference, or report that it does not parse as one.                                                                 |
| `anchorPageId`       | `function anchorPageId(noteId, anchorSlug)`                             | {string} A 16-character alphanumeric id.                                                                                                                                                                                                                                                                                              | The deterministic JournalEntryPage id for one anchor: SHA-256 of `"<noteId>-<anchorSlug>"`, base64-encoded, reduced to the 16 alphanumeric characters a Foundry id allows. |
| `buildWikilinkIndex` | `function buildWikilinkIndex(docs, packageId, foreign, contentPackage)` | {{byShortcode: Map<string, object>, types: Set<string>}} `types` is every type the tree actually contains, so a qualifier naming no real type can be told apart from a missing target.                                                                                                                                                | Builds the link-resolution tables for a content tree.                                                                                                                      |
| `resolveReference`   | `function resolveReference(index, ref, hint)`                           | {{name?: string, uuid?: string, address?: string, subType?: string}\|undefined} The target, or `undefined` where nothing answers.                                                                                                                                                                                                     | Resolve one reference — a bare shortcode, a short address or a canonical one — to what a compendium can use.                                                               |
| `convertWikilinks`   | `function convertWikilinks(markdown,`                                   | {{markdown: string, unresolved: Array<{link: string, target: string, offset: number, reason: string, packages?: string[], anchor?: string}>}} Each `reason` is one of {@link LINK_FINDING_REASONS}, the vocabulary all three resolvers share — `ambiguous` carries the claiming `packages` and `unknown-anchor` the section it named. | Rewrites every wikilink in a markdown body as a Foundry UUID enricher.                                                                                                     |

### `engine.wikilinkSyntax`

What a `[[…]]` **is**, before anything decides where it points. One authored link compiles to two different addresses — a Foundry `@UUID` enricher for the packs, a URL for the web — and those two destinations are the _only_ thing that legitimately differs. The syntax is the author's, and it is the same syntax whichever build is reading it.

| Export                     | Signature                                                  | Returns                                                         | Use it when                                                                     |
| -------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `WIKILINK`                 | `const WIKILINK`                                           | —                                                               | A wikilink, as authored.                                                        |
| `parseWikilink`            | `function parseWikilink(rawInner)`                         | {ParsedWikilink} The parts, each trimmed.                       | Split a wikilink's interior into its parts.                                     |
| `authoredLabel`            | `authoredLabel({ display })`                               | {string\|null} The label, or `null` when there is none to show. | The label an author actually supplied, or `null` when they supplied none.       |
| `unlabelledLinkMessage`    | `function unlabelledLinkMessage(target)`                   | {string} The message, unpunctuated at the end as a finding is.  | What an author writing an unlabelled link is told, in one place.                |
| `LINK_FINDING_REASONS`     | `const LINK_FINDING_REASONS`                               | —                                                               | Every way a link can fail, named once for all three resolvers.                  |
| `unresolvedAddressMessage` | `function unresolvedAddressMessage(target)`                | {string} The message, unpunctuated at the end as a finding is.  | What an author writing an address that resolves to nothing is told.             |
| `ambiguousAddressMessage`  | `function ambiguousAddressMessage(target, packages`        | {string} The message.                                           | What an author writing a short address more than one package publishes is told. |
| `linkFindingMessage`       | `linkFindingMessage({ reason, target, packages, anchor })` | {string} The message.                                           | The message for one link finding, whichever resolver found it.                  |
| `isSamePage`               | `isSamePage({ target, anchor })`                           | {boolean} True when the link is same-page.                      | Whether a parsed link addresses a section of the page it is written on.         |

### `engine.siteIndex`

**The address index a site build resolves its wikilinks against.** Every consumer that publishes a content tree as a website has to answer the same question — given `[[Something]]`, which page? — and every one of them answered it with its own copy of the same 150 lines. `sohl`'s and `sohl-thalorna`'s site builds still share 147 identical lines of it, comments and indentation aside. This is that shared half, lifted out whole.

| Export              | Signature                                          | Returns                                                                                                                        | Use it when                                                                                                  |
| ------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `buildSiteIndex`    | `function buildSiteIndex(entries,`                 | {SiteIndex} The index, and what could not be addressed unambiguously.                                                          | Build the address index a site's wikilink resolver reads.                                                    |
| `wikiContext`       | `function wikiContext(built,`                      | {object} The resolver context.                                                                                                 | The per-page context a wikilink resolver takes.                                                              |
| `resolveInfoboxRef` | `function resolveInfoboxRef(siteIndex, ref, hint)` | {{name?: string, url?: string, address?: string, subType?: string}\|undefined} The page, or `undefined` where nothing answers. | Resolve one infobox reference — a bare shortcode, a short address or a canonical one — against a site index. |

### `engine.pdfToc`

The document tree a PDF is built from, and the plan it resolves to (#316). The packs and the website both render the _whole_ content tree: every note becomes a document and a page, and the three surfaces agreeing about what the content is, is the point. **A book is not that.** It is a selection — a declared structure whose leaves pick notes out of the corpus by a `WHERE` clause, interleaved with prose that may not live in the content tree at all.

| Export              | Signature                                  | Returns                                                                                                                                                              | Use it when                                                        |
| ------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `PRESENTATION_KEYS` | `const PRESENTATION_KEYS`                  | —                                                                                                                                                                    | Presentation a node may declare, and that its descendants inherit. |
| `parseDocumentTree` | `function parseDocumentTree(raw,`          | {{nodes: object[], findings: object[]}} The flattened tree and what was wrong with it.                                                                               | Validate the raw tree and flatten it into nodes.                   |
| `runTreeFilters`    | `async function runTreeFilters(nodes, db,` | {Promise<{selections: Map<string, object[]>, findings: object[]}>}                                                                                                   | Run every filter, and report the ones that would not run.          |
| `planDocument`      | `function planDocument(nodes,`             | {{entries: object[], links: Map<string, string>, stats: object}} The plan, the address→anchor map inbound wikilinks resolve through, and what the selection came to. | Resolve the flattened tree into the document plan.                 |

### `engine.pdfRender`

A note's markdown, and a document plan, rendered as Typst source. **This module emits text and reads nothing.** It takes markdown and a plan and returns a `.typ` document; the filesystem, the note bodies and the compiler that turns the result into a PDF all live in {@link module:engine/pdf-build}. That split is what lets the outline, the table of contents, every anchor and every link destination be asserted in a unit test with no renderer installed — which is most of what a book has to get right, and all of what a test can check without eyes.

| Export                  | Signature                                                                                 | Returns                                                      | Use it when                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `escapeTypst`           | `function escapeTypst(text)`                                                              | {string} The same text, inert.                               | Escape literal text for Typst markup.                                    |
| `escapeTypstString`     | `function escapeTypstString(text)`                                                        | {string} The same value, quotable.                           | Escape a string going inside Typst string quotes, as a `#link` URL does. |
| `labelFor`              | `function labelFor(anchor)`                                                               | {string} A Typst label name.                                 | A Typst label, from a plan anchor.                                       |
| `createParser`          | `function createParser(registry)`                                                         | {object} A markdown-it instance.                             | A markdown-it configured to parse, not to render.                        |
| `markdownToTypst`       | `function markdownToTypst(markdown, opts`                                                 | {string} Typst markup.                                       | Render markdown as Typst content.                                        |
| `renderBook`            | `renderBook({ plan, bodies, title, subtitle, front, fonts, version, preamble, banners })` | {string} A complete `.typ` document.                         | The whole book, as one Typst document.                                   |
| `resolveDanglingLabels` | `function resolveDanglingLabels(source, findings`                                         | {string} The same document, with no reference left dangling. | Point every internal link at a label the document actually declares.     |
| `iconNamesIn`           | `function iconNamesIn(markdown)`                                                          | {string[]} The names, in order of appearance, with repeats.  | Every icon name a body uses, so a build can resolve them once.           |
| `bookTypstPreamble`     | `function bookTypstPreamble()`                                                            | {string} Typst markup.                                       | The Typst definitions the book's page furniture is drawn with.           |

### `engine.pdfFonts`

Which glyph an icon name resolves to, read from the font that carries it. {@link module:engine/content-icons} states an icon's family and its name and **deliberately holds no codepoints**: writing them out by hand would be a second copy of a table the font already owns, wrong the first time the icon set renumbers anything, and wrong silently. So the renderer resolves a name against the file it is going to embed, which is this module.

| Export              | Signature                                        | Returns                                                             | Use it when                                                          |
| ------------------- | ------------------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `glyphTable`        | `function glyphTable(file)`                      | {Map<string, number>} Name → codepoint.                             | Every glyph name a font carries, with the codepoint that reaches it. |
| `familyName`        | `function familyName(file)`                      | {string} The family name, or "" when the table cannot be read.      | The family name a font file announces, for Typst's `text(font: …)`.  |
| `resolveIconGlyphs` | `function resolveIconGlyphs(registry, iconFonts` | {Map<string, {font: string, codepoint: number}>} Icon name → glyph. | Resolve every icon in a registry against the fonts a consumer named. |

### `engine.pdfBuild`

The content tree, built into a book. The I/O half of the PDF surface: it reads the configuration, the document tree and the notes, drives the passes the site build already owns, hands the result to {@link module:engine/pdf-render} and runs Typst over what comes back. Everything about _what the book says_ is decided in the pure half; this module is where the filesystem and the compiler live.

| Export            | Signature                                                  | Returns                                                                                         | Use it when                                                          |
| ----------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `pdfFileName`     | `function pdfFileName(artifact, version)`                  | {string} `<artifact>-<version>.pdf`, or `<artifact>.pdf` unversioned.                           | The file name a downloaded book identifies itself by.                |
| `buildPdf`        | `async buildPdf({ config, out, version, compile })`        | {Promise<object>} `{ built, reason, findings, typ, pdf, stats }`.                               | Build the book.                                                      |
| `stagedImagePath` | `function stagedImagePath(src, config)`                    | {{from: string, to: string}\|null} The file, and where under the output directory it is staged. | The file on disk an authored image address names, or `null`.         |
| `stageBanners`    | `function stageBanners(entries, config, outDir, findings)` | {Map<string, string>} Declared path → the staged file's path, relative to the `.typ`.           | Copy every banner the document tree names into the output directory. |
| `compileTypst`    | `function compileTypst(typPath, pdfPath, pdf`              | {{ok: boolean, message: string, findings: object[]}} What happened.                             | Run Typst over the emitted source.                                   |
| `typstArgs`       | `function typstArgs(typPath, pdfPath, pdf)`                | {string[]} The arguments, in order.                                                             | The command line the compile runs, as data.                          |
| `typstWarnings`   | `function typstWarnings(output)`                           | {object[]} One finding per warning the compiler wrote.                                          | The compiler's own warnings, as findings.                            |
| `BOOK_FONTS_PATH` | `const BOOK_FONTS_PATH`                                    | {string} The directory holding them.                                                            | The faces the book is set in, shipped with this package.             |

### `engine.baseCompiler`

`BasePackCompiler` — the one compile loop every pack pass runs. Walking the content tree, rejecting what this build does not own, expanding generated tables, converting wikilinks, writing the JSON and counting what failed are the same in every pass. They were written out once per pass — three times when this was filed, five by the time it landed — so a fix to any of them had to be made everywhere, and the passes drifted apart in exactly the places nobody was comparing.

| Export             | Signature                | Returns | Use it when                                                               |
| ------------------ | ------------------------ | ------- | ------------------------------------------------------------------------- |
| `BasePackCompiler` | `class BasePackCompiler` | —       | The shared walk → filter → expand → convert → build → write → count loop. |

### `engine.journals`

Journals pack compiler — produces JSON pack files for the "journals" Foundry compendium from markdown notes in the `assets/content/` tree. The content root (`contentBase`) is walked recursively; any `.md` file whose frontmatter declares either `type: doc` or a **doc-carrying type** ({@link sohl.utils.packs.docEntryTypes} — every item type, plus `macro`) is compiled into one JournalEntry document. Each note's body is split on top-level H1 headings; the optional content before the first H1 becomes a lead page, and each subsequent H1 starts a new page named after its heading text. All page bodies are rendered to HTML.

| Export                | Signature                                                                   | Returns                                                                                                                                                                        | Use it when                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `splitPages`          | `function splitPages(body, leadName`                                        | —                                                                                                                                                                              | Splits a markdown body into pages by top-level H1 headings.                                                                      |
| `assertUniquePages`   | `function assertUniquePages(rawPages, noteName)`                            | —                                                                                                                                                                              | Two pages in one note that would derive the same id, which the LevelDB packer reports only as an opaque duplicate-key collision. |
| `assertUniqueAnchors` | `function assertUniqueAnchors(rawPages, noteName)`                          | —                                                                                                                                                                              | The anchor half of {@link assertUniquePages}, under its former name.                                                             |
| `journalPageId`       | `function journalPageId(entryId, page)`                                     | {string} A 16-character Foundry id.                                                                                                                                            | The id of one page within its entry.                                                                                             |
| `buildPages`          | `function buildPages(rawPages, entryId, noteName)`                          | {Array<{_id: string, name: string, type: string, title: {show: boolean, level: number}, text: {format: number, content: string}, _key: string}>} The page documents, in order. | Compile split pages into JournalEntryPage documents.                                                                             |
| `buildJournalEntry`   | `buildJournalEntry({ id, name, markdown, leadName, folder, flags, stats })` | {object} The JournalEntry document, keyed for the pack.                                                                                                                        | Assemble one JournalEntry document from a note's converted markdown.                                                             |
| `Journals`            | `class Journals extends BasePackCompiler`                                   | —                                                                                                                                                                              | not called directly — imported and driven by `engine/generate.mjs` as the "journals" pack compiler                               |

### `engine.macros`

Macros pack compiler — produces JSON pack files for the "macros" Foundry compendium from markdown notes in the `assets/content/` tree. A `type: macro` note compiles into **two** documents, and this module writes only the first of them:

| Export                | Signature                               | Returns                                                                                                           | Use it when                                                                                                                              |
| --------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `MACRO_SCRIPT_ANCHOR` | `const MACRO_SCRIPT_ANCHOR`             | —                                                                                                                 | The anchor the executable script lives under: `# Script {#script}`.                                                                      |
| `MACRO_TYPES`         | `const MACRO_TYPES`                     | —                                                                                                                 | The Foundry macro types (`CONST.MACRO_TYPES`).                                                                                           |
| `MACRO_SCOPES`        | `const MACRO_SCOPES`                    | —                                                                                                                 | The Foundry macro scopes (`CONST.MACRO_SCOPES`), in schema order.                                                                        |
| `DEFAULT_MACRO_IMG`   | `const DEFAULT_MACRO_IMG`               | —                                                                                                                 | Foundry's own default macro artwork, used when a note authors no `img`.                                                                  |
| `extractJsFence`      | `function extractJsFence(markdown)`     | {string\|null} The fence's contents, with no trailing newline, or `null` when the block holds no tagged JS fence. | The body of the first **language-tagged** JavaScript fence in a markdown block, verbatim.                                                |
| `macroCommand`        | `function macroCommand(body, name)`     | {string} The macro's command.                                                                                     | The `command` a macro note compiles to: the first tagged JS fence on its `{#script}` page.                                               |
| `resolveMacroType`    | `function resolveMacroType(fm, label)`  | {"script"} The macro type.                                                                                        | The **Foundry** macro type a note compiles to — not the note's `type:`, which stays `macro` because that is what routes it to this pack. |
| `resolveMacroScope`   | `function resolveMacroScope(fm, label)` | {string} One of {@link MACRO_SCOPES}.                                                                             | The Foundry macro scope a note compiles to.                                                                                              |
| `buildMacroEntry`     | `function buildMacroEntry(fm,`          | {MacroDocument} The Macro document.                                                                               | The compendium envelope for one Macro.                                                                                                   |
| `Macros`              | `class Macros extends BasePackCompiler` | —                                                                                                                 | Macros pack compiler.                                                                                                                    |

### `engine.mapNotes`

**Map notes** — the markdown → Foundry `Scene` translation. A map note carries an _essence_: a curated, hand-owned subset of what a Scene record holds, exactly as a weapon note carries a weapon's essence rather than an Item's schema. Everything a Scene needs and nobody should have to author — the canvas defaults, the embedded `Level`, every derived region field — is synthesised here.

| Export                         | Signature                                       | Returns                                                                                    | Use it when                                                                                  |
| ------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `isMapType`                    | `function isMapType(type)`                      | {boolean} True for a map type.                                                             | Whether a content note's type compiles into a Scene.                                         |
| `MAP_SUBTYPE_PROFILES`         | `const MAP_SUBTYPE_PROFILES`                    | —                                                                                          | Per-subtype canvas defaults, emitted **explicitly** on every scene.                          |
| `mapProfile`                   | `function mapProfile(subType)`                  | {object} The profile from {@link MAP_SUBTYPE_PROFILES}.                                    | The canvas profile for a map subType.                                                        |
| `DEFAULT_LEVEL_ID`             | `const DEFAULT_LEVEL_ID`                        | —                                                                                          | Foundry's own id for the level a scene is created with (`Scene.metadata.defaultLevelId`).    |
| `regionDocId`                  | `function regionDocId(sceneId, key, pinned)`    | {string} A 16-character Foundry id.                                                        | The id of one region within its scene.                                                       |
| `behaviorDocId`                | `function behaviorDocId(regionId, key, pinned)` | {string} A 16-character Foundry id.                                                        | The id of one behaviour within its region.                                                   |
| `regionColor`                  | `function regionColor(key)`                     | {string} A CSS hex colour.                                                                 | A region's highlight colour, derived from its key.                                           |
| `assertPixelGeometry`          | `function assertPixelGeometry(coords, geom)`    | —                                                                                          | Reject geometry authored in grid squares where pixels belong.                                |
| `assertGridLocation`           | `function assertGridLocation(at, geom)`         | —                                                                                          | Reject a map pin authored in pixels where grid squares belong.                               |
| `wallRestrictions`             | `function wallRestrictions(spec, label)`        | {{move: number, sight: number, light: number, sound: number}} The Wall restriction fields. | Compile a wall's `blocks:` / `limits:` lists into Foundry's four numeric restriction fields. |
| `buildShape`                   | `function buildShape(spec, geom)`               | {object} The Foundry shape record.                                                         | Compile one authored shape into a Foundry shape record.                                      |
| `REGION_BEHAVIOR_TYPES`        | `const REGION_BEHAVIOR_TYPES`                   | —                                                                                          | The behaviour types a map note may carry (v1).                                               |
| `BANNED_REGION_BEHAVIOR_TYPES` | `const BANNED_REGION_BEHAVIOR_TYPES`            | —                                                                                          | Behaviour types a map note may **never** carry, and why.                                     |
| `buildScene`                   | `function buildScene(fm, ctx)`                  | {object} The Scene document, keyed for the pack.                                           | Compile a map note into a Scene document, embedded documents and all.                        |
| `buildLevel`                   | `function buildLevel(sohl, sceneId, img`        | {object} The Level document, keyed for the pack.                                           | Synthesise the scene's single embedded Level from `img:` / `overlay:`.                       |
| `buildWalls`                   | `function buildWalls(sohl, geom, ctx)`          | {object[]} The Wall documents.                                                             | Compile the `walls:` and `doors:` blocks into Wall documents.                                |
| `buildLights`                  | `function buildLights(sohl, geom, ctx)`         | {object[]} The AmbientLight documents.                                                     | Compile the `lights:` block into AmbientLight documents.                                     |
| `buildTiles`                   | `function buildTiles(sohl, geom, ctx)`          | {object[]} The Tile documents.                                                             | Compile the `tiles:` block into Tile documents.                                              |
| `buildSounds`                  | `function buildSounds(sohl, geom, ctx)`         | {object[]} The AmbientSound documents.                                                     | Compile the `sounds:` block into AmbientSound documents.                                     |
| `buildLocations`               | `function buildLocations(sohl, geom, ctx)`      | {object[]} The Note documents.                                                             | Compile the `locations:` block into Note documents — the map pins.                           |
| `buildRegions`                 | `function buildRegions(sohl, geom, ctx)`        | {object[]} The Region documents.                                                           | Compile the `regions:` block into Region documents with their behaviours.                    |

### `engine.scenes`

Scenes pack compiler — map notes in `assets/content/` → Foundry `Scene` documents, and the `Adventure` bundles that make their references resolve. The translation itself lives in the framework-free `map-notes.mjs`; this module is the pass that walks the tree, resolves what one note says about another, and writes the JSON the compendium CLI compiles.

| Export                    | Signature                                    | Returns                               | Use it when                                                                                                                                                                                        |
| ------------------------- | -------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collectKnownActionNames` | `function collectKnownActionNames(repoRoot)` | {Set<string>} The known action names. | Every SoHL action name this build knows about, for the `action:` warning on a region trigger.                                                                                                      |
| `Scenes`                  | `class Scenes extends BasePackCompiler`      | —                                     | not called directly — imported and driven by `engine/generate.mjs` as the "scenes" pack compiler; walks the tree, resolves cross-scene references, and writes the JSON the compendium CLI compiles |

### `engine.bundleNotes`

Bundles, as notes — the Foundry `Adventure` a `type: bundle` note compiles into. An `Adventure` is badly named, and the name misled the first design: it is not a story. `Adventure.contentFields` maps each `SetField` on the schema to a document class, and importing one partitions its members by whether the world's collection already holds that `_id`, then creates or updates each. Afterwards the documents live independently and the Adventure has no further role. **It is an installer** — a set of document _copies_ packaged for one-shot import.

| Export                    | Signature                                                                                 | Returns                                                       | Use it when                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `BUNDLE_TYPE`             | `const BUNDLE_TYPE`                                                                       | —                                                             | The note type a bundle is authored as.                                       |
| `ADVENTURE_CONTENT_FIELD` | `const ADVENTURE_CONTENT_FIELD`                                                           | —                                                             | Foundry's `Adventure.contentFields`, keyed by the document class each holds. |
| `CONTENTS_FIELD`          | `const CONTENTS_FIELD`                                                                    | —                                                             | The `data:` key a bundle lists its members under.                            |
| `stripAdventureKeys`      | `function stripAdventureKeys(value)`                                                      | {*} The same shape with every `_key` removed.                 | Strip the LevelDB keys from a document tree.                                 |
| `bareAddress`             | `function bareAddress(value)`                                                             | {string\|null} The bare address, or `null` for a blank entry. | An authored address with any wikilink brackets and label stripped.           |
| `bundleContents`          | `function bundleContents(fm)`                                                             | {string[]} The bare addresses.                                | The addresses a bundle note names, in the order it names them.               |
| `missingMemberVerdict`    | `function missingMemberVerdict(packSystem)`                                               | {"omit"\|"fail"} What to do about a member the sources lack.  | What a pass should do about a member its sources do not hold.                |
| `buildAdventure`          | `buildAdventure({ id, name, img, description, caption, folder, flags, stats, contents })` | {object} The Adventure document, keyed for the pack.          | Assemble one `Adventure` from a set of already-compiled documents.           |

### `engine.bundles`

Adventure pack compiler — `type: bundle` notes → Foundry `Adventure` documents. The specification and the vocabulary leave the type declared and uncompiled: authoring one said so, in as many words. This is the pass, and the two decisions it records are settled here.

| Export              | Signature                                | Returns                                       | Use it when                                                                                                                                                                                            |
| ------------------- | ---------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `loadBundleSources` | `function loadBundleSources(sourceDirs)` | {Map<string, object>} The compiled documents. | Load every compiled document a bundle may hold, keyed `<docType>/<id>`.                                                                                                                                |
| `Bundles`           | `class Bundles extends BasePackCompiler` | —                                             | not called directly — imported and driven by `engine/generate.mjs` as the pass a `type: bundle` note compiles through, assembling the `Adventure` from `loadBundleSources`' already-compiled documents |

### `engine.sceneLevels`

**Scene ↔ Level integrity** for a compiled compendium pack. A v14 Scene keeps its map image on an embedded `Level`, and a compiled pack stores the two in _separate_ LevelDB keys: the Scene at `!scenes!<id>` holding `levels` as an array of ids, and each Level at `!scenes.levels!<sceneId>.<levelId>`. Nothing in Foundry ties them together on read. If a Level record is missing, `EmbeddedCollectionField#expandEmbedded` merely warns

| Export                  | Signature                                       | Returns                                                                                                                                    | Use it when                                                               |
| ----------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `compendiumCliVersion`  | `function compendiumCliVersion()`               | {string \| undefined} The resolved version, or `undefined` when the package cannot be read (a pruned install, an exports-restricted copy). | The version of `@foundryvtt/foundryvtt-cli` this build actually resolves. |
| `checkSceneLevels`      | `function checkSceneLevels(records,`            | {string[]} One human-readable problem per violation, empty when the pack is sound.                                                         | Every way a compiled pack can ship a Scene that has lost its Level.       |
| `verifyPackSceneLevels` | `async function verifyPackSceneLevels(packDir)` | {Promise<string[]>} The problems found, empty when the pack is sound.                                                                      | Read a compiled pack back off disk and check it.                          |

### `engine.generate`

Pack JSON generation — in-repo Markdown → per-entry JSON (build-only). Reads the authoritative content tree at the configured content root and compiles each pack's entries to per-entry JSON under its build directory (`build/packs-json/<pack>/` in this repository). The JSON is a disposable build intermediate consumed by `build:compiledb` (which turns it into the shipped LevelDB packs) — it is never committed.

| Export                        | Signature                                               | Returns                                                                                                                                                                                                         | Use it when                                                                                                         |
| ----------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `compilerFor`                 | `function compilerFor(docType, system`                  | {Function\|undefined} The compiler class, or `undefined` for a document type nothing here compiles — which {@link generatePack} reports rather than defaulting past.                                            | The compiler class a pack of one document type and one system gets.                                                 |
| `emittedArtFor`               | `function emittedArtFor(type)`                          | {{document: string\|null, art: readonly string[]}\|null} What the type compiles into and the art it carries there, or `null` where no claim can be made — a retired type, which is reported as retired instead. | The art fields a note of one content type reaches its document through, and the document it reaches.                |
| `packJsonDir`                 | `const packJsonDir`                                     | {string} The pack's JSON directory.                                                                                                                                                                             | Root of the build-only JSON tree for one pack.                                                                      |
| `itemPackJsonDirs`            | `function itemPackJsonDirs(config`                      | {string[]} Each Item pack's JSON directory.                                                                                                                                                                     | The generated JSON of **every** configured Item pack — what the actors pass reads its predefined items from.        |
| `bundleSourceJsonDirs`        | `function bundleSourceJsonDirs(config`                  | {Record<string, string[]>} Each readable pack's JSON directory, by the Foundry document type it holds.                                                                                                          | The compiled JSON a bundle may hold copies of, by document type.                                                    |
| `orderPassesByDependency`     | `function orderPassesByDependency(packs)`               | {object[]} A new list, in compile order.                                                                                                                                                                        | The passes to run, ordered so that each one follows the output it reads.                                            |
| `unsatisfiedPassDependencies` | `function unsatisfiedPassDependencies(running, config)` | {string[]} One message per unsatisfiable dependency.                                                                                                                                                            | The dependencies this run cannot satisfy by ordering, because the pass that would produce them is not in it.        |
| `emptyPassErrors`             | `function emptyPassErrors(passes)`                      | {string[]} One message per pass that must not have been empty.                                                                                                                                                  | The passes that compiled nothing when they were expected to compile something — a build failure, not a quiet no-op. |
| `generatePacksJson`           | `async generatePacksJson({ only, config })`             | {Promise<number>} Total error count across the generated packs.                                                                                                                                                 | Generate the build-only JSON for every pack (or one, when `only` is given).                                         |

### `engine.compendiums`

Compendium pack library — compile / unpack / clean LevelDB packs. Wraps `@foundryvtt/foundryvtt-cli` over the packs a consuming repository declares: - {@link compilePacks}: generates each pack's per-entry JSON from the `assets/content/` Markdown into `build/packs-json/<name>/` (via generate.mjs), then builds LevelDB from it; no committed JSON, no vault. - {@link unpackPacks}: extracts a compiled pack back to per-entry JSON, rebuilding folder paths. - {@link cleanPacks}: normalizes/strips extracted JSON.

| Export         | Signature                                                             | Returns | Use it when                                                                                                                          |
| -------------- | --------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `compilePacks` | `async compilePacks({ config, sourcePacks, stageDest, packName })`    | —       | Generates each pack's per-entry JSON from `assets/content/` into `build/packs-json/<name>/`, then builds the LevelDB output from it. |
| `cleanPacks`   | `async cleanPacks({ config, packDest, packName, entryName })`         | —       | Cleans and formats source JSON files, removing unnecessary permissions and flags and adding the proper spacing.                      |
| `unpackPacks`  | `async unpackPacks({ packs, config, stageDest, packDest, packName })` | —       | Extracts compiled LevelDB packs back to per-entry JSON, rebuilding the folder hierarchy as directories.                              |

### `engine.regionEvents`

The curated Foundry region-event vocabulary, as plain data. Deliberately **plain ESM** — no TypeScript, no `@src` aliases, no Foundry — for the same reason `../sohl/default-item-art.mjs` is: the map-note pack compiler runs under bare `node`, outside the bundler that resolves `@src` and strips types, and it must reject an authored region event that the runtime would silently drop. One list here is what keeps the build-time lint and the runtime bridge from drifting apart.

| Export                    | Signature                       | Returns | Use it when                                                                                                                                                                  |
| ------------------------- | ------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REGION_EVENT_TO_TRIGGER` | `const REGION_EVENT_TO_TRIGGER` | —       | The curated Foundry region-event → SoHL trigger-name map.                                                                                                                    |
| `CURATED_REGION_EVENTS`   | `const CURATED_REGION_EVENTS`   | —       | The Foundry region-event names SoHL forwards (the keys of the map).                                                                                                          |
| `EXCLUDED_REGION_EVENTS`  | `const EXCLUDED_REGION_EVENTS`  | —       | Region events SoHL deliberately does **not** forward: the continuous (`tokenMove*`), view-dependent (`tokenAnimate*`) and lifecycle (`behavior*`, `regionBoundary`) streams. |

## `./sohl`

The SoHL-specific half of the toolchain: the knowledge of the Song of Heroic Lands data model that a generic content module must never receive. The item-type registry and its builders, the Item and Actor compilers, the default-art map, and the affiliation standings live here — nothing in `@heroiclands/package-build/engine` exports any of it, so an adventure module that builds journals, macros and scenes never receives `buildWeaponGear`. A consuming repository hands its own registry to the engine as configuration (`itemBuilders` in `package-build.config.yaml`), which is how the engine composes one doc-carrying-type set without holding any package's data model.

Every module beneath `./sohl` is also reachable as its own entry point, e.g. `@heroiclands/package-build/sohl/being-info`.

```js
import { isBeing, GEAR_TYPE_TO_KEY, deriveBeingInfo } from "@heroiclands/package-build/sohl";

console.log(isBeing({ type: "being" }));
// -> true
console.log(GEAR_TYPE_TO_KEY.weapongear);
// -> "weapons"
console.log(deriveBeingInfo({ items: [] }, new Map()));
// -> { items: [] }
```

### `sohl.itemBuilders`

The item-type registry: every content type that compiles into a Foundry Item, keyed to the builder that produces its `system` block. The registry's keys are generated from `item-fields.mjs`'s field declarations rather than written by hand, so the compilable-type whitelist and the builder table cannot drift apart the way they once could.

| Export          | Signature             | Returns | Use it when                                                                                                                                                                      |
| --------------- | --------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ITEM_BUILDERS` | `const ITEM_BUILDERS` | —       | reading every SoHL item type paired with its `system`-block builder, its default art, and its frontmatter fields — handed to the engine as `itemBuilders: sohl` in configuration |

### `sohl.documentSubtypes`

SoHL's note-type → document-subtype map: which Foundry document, and which subtype of it, a note of each content type compiles into. Every row is written out explicitly, identity rows included, so the note vocabulary and the document vocabulary stay two separately stated facts rather than one generating the other.

| Export                   | Signature                      | Returns | Use it when                                                                     |
| ------------------------ | ------------------------------ | ------- | ------------------------------------------------------------------------------- |
| `SOHL_DOCUMENT_SUBTYPES` | `const SOHL_DOCUMENT_SUBTYPES` | —       | looking up which Foundry document and subtype a SoHL content type compiles into |

### `sohl.items`

SoHL's Item pass — the parts of compiling a note into a SoHL Item that are facts about SoHL rather than about the note format: the note-type → document-subtype map, and the `commonSystem` fields (`shortcode`, `templatePriority`, `actionDefs`, `notes`, `docHtml`) every SoHL item carries regardless of type. Everything else lives in the engine's generic item compiler.

| Export  | Signature     | Returns | Use it when                                                                                              |
| ------- | ------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `Items` | `class Items` | —       | not called directly — this compiler class is imported and driven by `engine/generate.mjs` during a build |

### `sohl.actors`

SoHL's Actor pass — what a SoHL `being` document holds and nothing else: the body structure and its movement profiles, the attributes-and-items frontmatter that becomes embedded documents, the opening mastery level a skill is baked with, and the `system` block itself. The shared machinery (predefined-item catalogue, reference translation, embedding, anchored prose sections) lives in the engine's generic actor compiler.

| Export   | Signature      | Returns | Use it when                                                                                                                                    |
| -------- | -------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `Actors` | `class Actors` | —       | not called directly — imported and driven by `engine/generate.mjs`; must run after the items passes, since it reads their generated JSON trees |

### `sohl.infobox`

Which of SoHL's facts a note's summary panel carries, and how they group. Read off the same field declaration the compiler obeys, with a builder of its own only where a box is derived rather than read field by field.

| Export                    | Signature                       | Returns               | Use it when                                                                         |
| ------------------------- | ------------------------------- | --------------------- | ----------------------------------------------------------------------------------- |
| `SOHL_INFOBOX`            | `const SOHL_INFOBOX`            | —                     | reading SoHL's infobox declaration                                                  |
| `SOHL_INFOBOX_TITLE`      | `const SOHL_INFOBOX_TITLE`      | —                     | naming SoHL's box                                                                   |
| `SOHL_FIELD_PRESENTATION` | `const SOHL_FIELD_PRESENTATION` | —                     | looking up what one of SoHL's fields is called, or why it carries no row            |
| `PROTECTION_FIELDS`       | `const PROTECTION_FIELDS`       | —                     | reading the declarations of the aspects armour is rated against, in the order shown |
| `UNSTATED`                | `const UNSTATED`                | —                     | naming what a strike mode shows where a value was not stated                        |
| `armorSections`           | `armorSections(fm, ctx)`        | `object[]`            | building armour's box, protection included                                          |
| `beingSections`           | `beingSections(fm, ctx)`        | `object[]`            | building a being's attributes, skills, mystical abilities and equipment             |
| `decodeItem`              | `decodeItem(entry)`             | `object \| undefined` | reading what one `sohl.items` entry names, whichever form it was written in         |
| `projectileSections`      | `projectileSections(fm, ctx)`   | `object[]`            | building a projectile's box, its impact composed into one row                       |
| `strikeModes`             | `strikeModes(declared)`         | `[string, object][]`  | reading a weapon's strike modes, whichever of the two shapes were authored          |
| `weaponSections`          | `weaponSections(fm, ctx)`       | `object[]`            | building a weapon's box, strike modes included                                      |

### `sohl.kbPasses`

The `sohl` knowledgebase's own body passes: two rewrites driven by a TypeDoc symbol map and a repository layout only this package has, named from `site.passOptions` the same way an asset transform is named from configuration. Neither rewrite ever fails a build — an unresolved `{@link}` degrades to a code span, and a relative link outside the documentation tree becomes a GitHub blob URL — but building the bundle from a misconfigured `symbolMap` fails loudly before any page renders.

| Export             | Signature                                 | Returns                                                | Use it when                                                                                                                                                                     |
| ------------------ | ----------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolveApiLinks`  | `resolveApiLinks(body, symbols, apiBase)` | `string` — the body with every tag resolved            | resolving inline TypeDoc `{@link}` / `{@linkcode}` / `{@linkplain}` tags in a markdown body against the API symbol map                                                          |
| `rewriteRepoLinks` | `rewriteRepoLinks(body, docRel, options)` | `string` — the body with every relative link rewritten | rewriting a developer doc's repository-relative links so they resolve on the published site (documentation-tree links become routes, everything else becomes a GitHub blob URL) |
| `sohlKbPass`       | `sohlKbPass(options)`                     | `{beforeLinks: Function, afterLinks: Function}`        | building the `sohl` knowledgebase pass bundle the site renderer calls around wikilink resolution                                                                                |

### Flat exports (not under a namespace)

| Export                  | Signature                      | Returns                           | Use it when                                                                                                                                                                                       |
| ----------------------- | ------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_ITEM_ART`      | `const DEFAULT_ITEM_ART`       | —                                 | reading the full map of default item artwork keyed by SoHL Item document subtype — the single source both the compendium builder and the runtime `SohlItem.getDefaultArtwork` read                |
| `defaultItemArt`        | `defaultItemArt(type)`         | `string` — the default image path | getting the default art path for a document subtype, throwing (fail-fast) rather than defaulting silently when the type is unknown                                                                |
| `AFFILIATION_STANDINGS` | `const AFFILIATION_STANDINGS`  | —                                 | reading the closed set of stances an authored `relation` map may use between two affiliations                                                                                                     |
| `BEING_TYPE`            | `const BEING_TYPE`             | —                                 | the one note `type` value (`"being"`) whose pages carry a being info block; the retired `character`/`creature` spellings are deliberately not accepted here                                       |
| `GEAR_TYPE_TO_KEY`      | `const GEAR_TYPE_TO_KEY`       | —                                 | mapping a gear note type (`weapongear`, `armorgear`, …) to the sidebar heading it displays under (`weapons`, `armor`, …)                                                                          |
| `isBeing`               | `isBeing(fm)`                  | `boolean`                         | checking whether a note's frontmatter describes a being, using the one shared definition instead of a per-repository copy                                                                         |
| `deriveBeingInfo`       | `deriveBeingInfo(sohl, index)` | `object\|null\|undefined`         | deriving a being's info-block fields (`skills`, `gear`, `spells`, `talents`) from its raw embedded `sohl.items[]`, resolved against a content index; authored values always win over derived ones |

## `./hm3`

The HM3-specific half of the toolchain: the knowledge of the HârnMaster 3 data model that a generic content module must never receive. HM3's item-type registry and its builders, its note-type → document-subtype map, its two compilers and its default-art map live here; it imports nothing from `sohl/` and `sohl/` imports nothing from it — the only thing the two systems share is the engine between them. A repository shipping content for both names both registries (`itemBuilders: [sohl, hm3]`) and declares one pack per system per document type.

Every module beneath `./hm3` is also reachable as its own entry point, e.g. `@heroiclands/package-build/hm3/item-fields`.

```js
import { hm3DefaultItemArt, documentSubtypes } from "@heroiclands/package-build/hm3";

console.log(hm3DefaultItemArt("weapongear"));
// -> "systems/hm3/images/icons/svg/sword.svg"
console.log(documentSubtypes.HM3_TYPE_KEY);
// -> "type"
```

### `hm3.itemBuilders`

The item-type registry: every content type that compiles into an HM3 Foundry Item, keyed to the builder that produces its `system` block, generated from `item-fields.mjs`'s declarations the same way `sohl.itemBuilders` is. A type both systems' registries declare throws rather than resolving unless the caller says which system is asking.

| Export              | Signature                 | Returns | Use it when                                                                                                     |
| ------------------- | ------------------------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| `HM3_ITEM_BUILDERS` | `const HM3_ITEM_BUILDERS` | —       | reading every HM3 item type paired with its `system`-block builder, its default art, and its frontmatter fields |

### `hm3.itemFields`

The `hm3:` frontmatter vocabulary of every HM3 item type, keyed by **note** type. Deliberately shorter than SoHL's field table: where the content format's mapping tables state no destination for HM3, this file declares nothing rather than inventing a plausible one, since a guessed field compiles clean and is silently discarded by Foundry at load.

| Export            | Signature               | Returns | Use it when                                                                                 |
| ----------------- | ----------------------- | ------- | ------------------------------------------------------------------------------------------- |
| `HM3_ITEM_FIELDS` | `const HM3_ITEM_FIELDS` | —       | reading every HM3 item type's shared-source → `hm3.system` field mapping, in emission order |

### `hm3.documentSubtypes`

HM3's note-type → document-subtype map. Unlike SoHL's near-identity map, HM3's differs substantially: four rows are one-to-many (authored via `hm3.type`, never inferred), one renames outright, and five type names are shared with SoHL but back a different data model — so each system resolves through its own map and its own registry rather than matching by name.

| Export                  | Signature                     | Returns | Use it when                                                                                                                                            |
| ----------------------- | ----------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `HM3_TYPE_KEY`          | `const HM3_TYPE_KEY`          | —       | reading the frontmatter key (`hm3.type`) inside the `hm3:` block that resolves a one-to-many content type to its HM3 document subtype                  |
| `HM3_DOCUMENT_SUBTYPES` | `const HM3_DOCUMENT_SUBTYPES` | —       | looking up which Foundry document and subtype a content type compiles into under HM3; a type absent from this map compiles into no HM3 document at all |

### `hm3.infobox`

Which of HM3's facts a note's summary panel carries, read off the same field list the item builders obey.

| Export                   | Signature                      | Returns | Use it when                                   |
| ------------------------ | ------------------------------ | ------- | --------------------------------------------- |
| `HM3_INFOBOX`            | `const HM3_INFOBOX`            | —       | reading HM3's infobox declaration             |
| `HM3_INFOBOX_TITLE`      | `const HM3_INFOBOX_TITLE`      | —       | naming HM3's box                              |
| `HM3_FIELD_PRESENTATION` | `const HM3_FIELD_PRESENTATION` | —       | looking up what one of HM3's fields is called |

### `hm3.items`

HM3's Item pass — the parts of compiling a note into an HM3 Item that are facts about HM3: the `description` key rendered from a note's `{#appearance}` section (the one HM3 Item field with nowhere else to put it), and the `flags.hm3.templatePriority` flag HM3's data model has no field for. There is no HM3 equivalent of SoHL's `docHtml` — the prose still compiles into its JournalEntry, it just isn't addressed from the item.

| Export     | Signature        | Returns | Use it when                                                        |
| ---------- | ---------------- | ------- | ------------------------------------------------------------------ |
| `Hm3Items` | `class Hm3Items` | —       | not called directly — imported and driven by `engine/generate.mjs` |

### `hm3.actors`

HM3's Actor pass — what an HM3 `character` or `creature` holds. A being note authors which HM3 subtype it becomes via `hm3.type` (never defaulted), and only four of the content format's `being` mapping-table rows have an HM3 destination (`portrait`, `species`, `gender`, `occupation`, `templatePriority`) plus the two anchored prose sections (`{#appearance}` → `description`, `{#dossier}` → `biography`); `gender` and `occupation` are written only on a `character`.

| Export      | Signature         | Returns | Use it when                                                        |
| ----------- | ----------------- | ------- | ------------------------------------------------------------------ |
| `Hm3Actors` | `class Hm3Actors` | —       | not called directly — imported and driven by `engine/generate.mjs` |

### `hm3.templatePriority`

Where HM3 records the template priority — one statement (`data.templatePriority`), read through the shared field resolver by both of this system's passes so they cannot disagree about it, and written into `flags` because HM3's data model declares no field for it.

| Export          | Signature                  | Returns                      | Use it when                                                                                                                    |
| --------------- | -------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `templateFlags` | `templateFlags(fm, block)` | `object` — the flags to emit | computing a document's `flags` object: whatever the note authors, plus HM3's template-priority flag when the note declares one |

### Flat exports (not under a namespace)

| Export                 | Signature                    | Returns                           | Use it when                                                                                              |
| ---------------------- | ---------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `HM3_DEFAULT_ITEM_ART` | `const HM3_DEFAULT_ITEM_ART` | —                                 | reading the full map of default item artwork keyed by **note** type (not document subtype) for HM3 items |
| `hm3DefaultItemArt`    | `hm3DefaultItemArt(type)`    | `string` — the default image path | getting the default art path for an HM3 item's note type, throwing when the type is unknown              |

## `./content-config`

The per-repository configuration contract: what `package-build.config.yaml` (or an `.mjs` config calling `defineConfig` directly) must satisfy. `defineConfig` validates and normalizes the whole thing, returning a deeply frozen copy, and performs no I/O — `engine.packConfig` is what locates and reads a repository's file, deriving the three fields absent from authored YAML (`rootDir`, `stats.systemVersion`, the resolved `itemBuilders` table). See `docs/configuration.md` for the full key-by-key reference; this section covers the module's own exported shape.

```js
import { defineConfig, PACKAGE_KINDS } from "@heroiclands/package-build/content-config";

const config = defineConfig({
  rootDir: import.meta.dirname,
  contentPackage: "example",
  foundryPackage: "example",
  packageKind: PACKAGE_KINDS[0], // "systems"
  stats: { lastModifiedBy: "examplebuilder00" },
  packs: [{ name: "items", type: "Item" }],
  compatibility: { minimum: "14.359" },
});
```

| Export                     | Signature                          | Returns                                                    | Use it when                                                                                                                                                                                                                              |
| -------------------------- | ---------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defineConfig`             | `defineConfig(config)`             | `ContentBuildConfig` — the frozen, defaulted configuration | validating and normalizing a content configuration; every configuration reaches this function whether authored as YAML or as `.mjs`                                                                                                      |
| `PACKAGE_KINDS`            | `const PACKAGE_KINDS`              | —                                                          | reading the three kinds of Foundry package a content module can be built into — `systems`, `modules`, and `documentation`, the kind that compiles no Foundry document at all (also the Foundry install directory name for the first two) |
| `DOCUMENTATION_KIND`       | `const DOCUMENTATION_KIND`         | —                                                          | naming the `packageKind` value that compiles no Foundry documents, spelled once so the validator, the CLI and the compile passes cannot disagree about what it means                                                                     |
| `compilesFoundryDocuments` | `compilesFoundryDocuments(config)` | `boolean`                                                  | checking whether a resolved configuration compiles Foundry documents at all — false only for a `documentation` package                                                                                                                   |
| `PACK_DOCUMENT_TYPES`      | `const PACK_DOCUMENT_TYPES`        | —                                                          | reading the Foundry document types this toolchain is able to compile a compendium pack of                                                                                                                                                |
| `DEFAULT_PATHS`            | `const DEFAULT_PATHS`              | —                                                          | reading the conventional directory layout a build reads from and writes to, relative to `rootDir`                                                                                                                                        |
| `DEFAULT_ADDRESS_SCHEME`   | `const DEFAULT_ADDRESS_SCHEME`     | —                                                          | reading an unconfigured repository's address-scheme defaults (`prefix`, where the content tree mounts inside the package)                                                                                                                |
| `RETIRED_ADDRESS_KEYS`     | `const RETIRED_ADDRESS_KEYS`       | —                                                          | reading which address-scheme keys a configuration may no longer declare (e.g. `landing`) — declaring one is a refusal, not a silent no-op                                                                                                |
| `SITE_MODES`               | `const SITE_MODES`                 | —                                                          | reading the publishing modes `publish.site` may name, weakest first                                                                                                                                                                      |
| `DERIVED_SYSTEM_VERSION`   | `const DERIVED_SYSTEM_VERSION`     | —                                                          | the loader-only symbol key `defineConfig` uses internally to receive a resolved system version; not something a configuration author writes                                                                                              |
| `publishesContentPages`    | `publishesContentPages(config)`    | `boolean`                                                  | checking whether a resolved configuration publishes the pages its content tree compiles to — the one question the site build and the content index both need answered identically                                                        |

## `./config`

The per-repository **packaging** configuration — `packageBuild:` within the same `package-build.config.yaml` that `content-config` validates the rest of. Read through the content half's loader rather than a second file, so `packageKind` and `foundryPackage` are stated once. The two halves validate independently but share one document.

```js
// Run from a consuming repository's root, where package-build.config.yaml lives.
import { loadPackageBuildConfig } from "@heroiclands/package-build/config";

const config = loadPackageBuildConfig();
console.log(config.stageDir);
```

| Export                      | Signature                           | Returns                        | Use it when                                                                                                                                  |
| --------------------------- | ----------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `DERIVED_MANIFEST_KEYS`     | `const DERIVED_MANIFEST_KEYS`       | —                              | reading which manifest keys a repository may not declare because the build derives them (declaring one is an error naming the key)           |
| `resolvePackageBuildConfig` | `resolvePackageBuildConfig(shared)` | `Readonly<PackageBuildConfig>` | validating the `packageBuild:` section from an already-loaded shared configuration — the pure half, usable without touching disk             |
| `loadPackageBuildConfig`    | `loadPackageBuildConfig()`          | `Readonly<PackageBuildConfig>` | reading and validating the repository's resolved package-build configuration from disk, read fresh on each call rather than cached at import |

## `./prettier`

The shared Prettier configuration, published as a Prettier config module so an editor's format-on-save agrees with `content-build format`, which already applies these rules without a consumer declaring anything.

```js
// prettier.config.mjs
export { default } from "@heroiclands/package-build/prettier";
```

| Export    | Signature                        | Returns                                  | Use it when                                                                                      |
| --------- | -------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `default` | `export default PRETTIER_CONFIG` | The shared Prettier configuration object | re-exporting it as a consumer's own `prettier.config.mjs`, so an editor and the lint chain agree |

## `./markdownlint`

The shared markdownlint rules, as a markdownlint-cli2 options module, applied without a consumer declaring anything by `content-build markdown`. Exists for an editor's markdownlint extension, and for a consumer that wants to extend rather than replace the set.

```js
// .markdownlint-cli2.mjs
import shared from "@heroiclands/package-build/markdownlint";
export default { ...shared, config: { ...shared.config, MD013: true } };
```

| Export    | Signature                                                    | Returns                                     | Use it when                                                                                                                                                    |
| --------- | ------------------------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default` | `export default { config, globs, ignores, gitignore: true }` | The shared markdownlint-cli2 options object | spreading it into a consumer's own options module to extend rather than replace the shared rules; `config` is frozen, so it must be spread rather than mutated |

## `./bundle`

The code bundle, and the one way a manifest can disagree with it. Which manifest key an entry is declared under decides how the browser parses the file — an ES module, where every top-level declaration is scoped to the module, or a classic script, where those same declarations become global lexical bindings that can collide with a non-configurable `window` property and throw a parse-time `SyntaxError`. The check compares what the manifest declares against what the bundle actually is, rather than checking the manifest key in isolation. Every rule here is a pure function over source text; reading the built files is the caller's job.

```js
import { globalDeclarations } from "@heroiclands/package-build/bundle";

console.log(globalDeclarations("const chrome = 1;").map((d) => d.name));
// -> ["chrome"]
```

| Export               | Signature                                                                        | Returns                                                                                                                         | Use it when                                                                                          |
| -------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `declaredGlobals`    | `declaredGlobals(node)`                                                          | `string[]` — declared identifier names, empty when the statement declares none                                                  | inspecting one top-level `Program.body` entry for what it would declare in global scope              |
| `entryDeclaration`   | `entryDeclaration(manifest, entry)`                                              | `"esmodules"\|"scripts"\|"both"\|"neither"`                                                                                     | finding out how a parsed manifest declares a given entry file                                        |
| `globalDeclarations` | `globalDeclarations(source)`                                                     | `Array<{name: string, line: number, kind: string}>`                                                                             | listing every top-level declaration a bundle's source text would create under a classic-script parse |
| `checkBundleLoading` | `checkBundleLoading({ manifest, source, entry, manifestName = "the manifest" })` | `{findings: Array<{line?: number, severity: "error", message: string}>, declaredAs: "esmodules"\|"scripts"\|"both"\|"neither"}` | verifying a manifest and its bundle agree — the findings are empty when they do                      |

## `./container`

Running a built package inside a Foundry VTT container. `package-build deploy <stage>` installs a staged package into `FOUNDRYVTT_<STAGE>_DATA`; this module bind-mounts that same directory at `/data` in the community `felddy/foundryvtt` image and serves it, so running Foundry against what was just deployed is the next step from one variable. Licensing, provisioning and the Foundry build itself are left to the image and to environment passthrough — every `FOUNDRY_*` and `CONTAINER_*` variable is passed through — rather than being reimplemented here. The resolution rules (`resolve*`) are pure functions over data; the functions that talk to `docker` or the filesystem are named for it.

```js
import { containerName, dataEnvVar } from "@heroiclands/package-build/container";

console.log(containerName("sohl", "dev"));
// -> "sohl-foundry-dev"
console.log(dataEnvVar("dev"));
// -> "FOUNDRYVTT_DEV_DATA"
```

| Export                     | Signature                                                                                     | Returns              | Use it when                                                                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_STAGE_PORTS`      | `const DEFAULT_STAGE_PORTS`                                                                   | —                    | reading the host port each conventional stage (`dev`/`qa`/`prod`/`test`) publishes by default, chosen so all four can run at once                                                           |
| `CONTAINER_PORT`           | `const CONTAINER_PORT`                                                                        | —                    | the fixed port Foundry listens on inside the container                                                                                                                                      |
| `CACHE_MOUNT`              | `const CACHE_MOUNT`                                                                           | —                    | the path a host-provided download cache is mounted at inside the container                                                                                                                  |
| `CONTAINER_ACTIONS`        | `const CONTAINER_ACTIONS`                                                                     | —                    | the closed set of actions `package-build container` accepts                                                                                                                                 |
| `dataEnvVar`               | `dataEnvVar(stage)`                                                                           | `string`             | deriving the environment variable that names a stage's Foundry data root, without hand-tabulating one per stage                                                                             |
| `containerName`            | `containerName(packageId, stage, base = null)`                                                | `string`             | computing the stable container name a stage runs under, so a signed Foundry licence (bound to the hostname) survives a recreate; pass `base` to share one container/licence across packages |
| `resolveStagePort`         | `resolveStagePort(stage, { env, stages } = {})`                                               | `number`             | resolving the host port for a stage, honoring `FOUNDRYVTT_<STAGE>_PORT` over a declared or conventional default                                                                             |
| `resolveFoundryVersion`    | `resolveFoundryVersion(stage, { env, stages, compatibilityMinimum, e2eStage = "test" } = {})` | `string\|null`       | pinning the exact Foundry build a stage runs, deriving the end-to-end stage's pin from the package's own `compatibility.minimum` so the floor is actually exercised                         |
| `resolveImage`             | `resolveImage({ env, image, version, compatibilityMinimum } = {})`                            | `string`             | resolving the `felddy/foundryvtt` image reference a run uses                                                                                                                                |
| `resolveWorld`             | `resolveWorld(stage, { env, stages } = {})`                                                   | `string\|null`       | resolving which world a stage auto-launches — `""` declares "never auto-launch", distinct from `null` (leave `FOUNDRY_WORLD` alone)                                                         |
| `resolveLicenseKey`        | `resolveLicenseKey(stage, env = process.env)`                                                 | `string\|null`       | finding a stage's dedicated Foundry licence key, since Foundry is single-seat and two stages running at once need two keys                                                                  |
| `resolveDataRoot`          | `resolveDataRoot(stage, { env } = {})`                                                        | `string`             | resolving the local Foundry data root path for a stage, checked for what a bind mount needs                                                                                                 |
| `passthroughEnv`           | `passthroughEnv(env = process.env)`                                                           | `[string, string][]` | collecting the image's own `FOUNDRY_*`/`CONTAINER_*` environment pairs to pass through (deliberately excludes `CONTAINER_CACHE`, which `dockerRunArgs` sets itself)                         |
| `dockerRunArgs`            | `dockerRunArgs({ name, image, port, dataRoot, env, cacheDir, version, world, licenseKey })`   | `string[]`           | building the full `docker run` argument vector for a stage's container                                                                                                                      |
| `runDocker`                | `runDocker(args)`                                                                             | `number`             | running the `docker` CLI with inherited stdio and getting back its exit status                                                                                                              |
| `captureDocker`            | `captureDocker(args)`                                                                         | `string`             | running `docker` and capturing trimmed stdout, tolerating failure (returns `""`)                                                                                                            |
| `containerExists`          | `containerExists(name, runningOnly = false)`                                                  | `boolean`            | checking whether a container with exactly this name exists (optionally, only counting a running one)                                                                                        |
| `runningFoundryContainers` | `runningFoundryContainers(except = "")`                                                       | `string[]`           | listing HeroicLands-convention Foundry containers currently running, to warn about a licence clash before a run starts                                                                      |
| `clearStaleLock`           | `clearStaleLock(dataRoot, log = () => {})`                                                    | —                    | removing a data-root lock left behind by a container that did not shut down cleanly; only safe to call while the container is stopped                                                       |
| `resolveContainer`         | `resolveContainer({ stage, config, env = process.env })`                                      | `ResolvedContainer`  | resolving all of a stage's container settings in one call, from the package-build configuration                                                                                             |
| `startContainer`           | `startContainer(container, { dataRoot, env, log })`                                           | `number`             | starting a stage's container, creating it first if it does not exist                                                                                                                        |
| `removeContainer`          | `removeContainer(name, log = () => {})`                                                       | —                    | stopping and removing a container, tolerating "not running" and "no such container"                                                                                                         |
| `containerAction`          | `containerAction({ action, stage, config, env, log })`                                        | `number`             | performing one `CONTAINER_ACTIONS` action for a stage end to end                                                                                                                            |

## `./coverage`

Whether the localization keys a package **references** and the keys it **declares** are the same set. A referenced-but-undeclared key is an error — it renders as its raw key string to a player; a declared-but-unreferenced key is advisory only, since no scan can see every way a key might be reached. Generic Foundry reference shapes (`{{localize}}`, `game.i18n.localize`, `LOCALIZATION_PREFIXES`, template literals) are read here directly; a repository that mints keys by its own convention contributes a named module through configuration. Everything exported is pure — source text in, references or findings out.

```js
import { keyRootsOf } from "@heroiclands/package-build/coverage";

console.log(keyRootsOf(["SOHL.Item.Name", "SOHL.Actor.Name"]));
// -> ["SOHL"]
```

| Export                      | Signature                                                                     | Returns                                                                         | Use it when                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `keyRootsOf`                | `keyRootsOf(keys)`                                                            | `string[]`                                                                      | deriving the distinct first segments a set of declared localization keys uses, instead of configuring roots by hand               |
| `collectScriptReferences`   | `collectScriptReferences(source, { file, roots })`                            | `ReferenceSet`                                                                  | reading every localization reference out of a script's AST (so a key named only in a JSDoc `@example` is not counted)             |
| `collectTemplateReferences` | `collectTemplateReferences(source, { file, roots })`                          | `ReferenceSet`                                                                  | reading every localization reference out of a Handlebars template by text scan                                                    |
| `mergeReferences`           | `mergeReferences(sets)`                                                       | `ReferenceSet`                                                                  | combining multiple files' reference sets into one before comparing against declared keys                                          |
| `analyzeCoverage`           | `analyzeCoverage({ langSource, langFile, references, retained = [], roots })` | `{findings: CoverageFinding[], unreferenced: CoverageFinding[], stats: object}` | comparing what a package declares against what it references, separating must-fix findings from merely-advisory unreferenced keys |

## `./deploy`

Deploying a staged package into a Foundry data directory, always via a staged, atomic swap rather than a write in place — because a running Foundry holds its LevelDB compendium packs open, and replacing pack files underneath a live server corrupts them. The build lands in a sibling `…-staging-<pid>` directory and is renamed into place. Two transports are chosen from the destination string itself: a local path is copied, and a `[user@]host:/path` target is uploaded over SFTP, authenticating through the running SSH agent by default with no secret read from disk. The resolution rules are pure functions over data; the functions that touch a filesystem or network are named for it.

```js
import { isRemoteTarget, parseRemote } from "@heroiclands/package-build/deploy";

console.log(isRemoteTarget("user@example.org:/srv/foundry"));
// -> true
console.log(parseRemote("user@example.org:/srv/foundry"));
// -> { username: "user", host: "example.org", remotePath: "/srv/foundry" }
```

| Export            | Signature                                                                                 | Returns                                                           | Use it when                                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STAGE_ENV_MAP`   | `const STAGE_ENV_MAP`                                                                     | —                                                                 | reading the environment variable that names each stage's Foundry data root                                                                                 |
| `resolveStage`    | `resolveStage(stageArg)`                                                                  | `string`                                                          | normalising a raw stage argument to its trimmed, lowercased form (`""` when absent)                                                                        |
| `packageSubpath`  | `packageSubpath(packageKind, packageId)`                                                  | `string[]`                                                        | deriving where a package installs beneath a Foundry data root, from its kind and id                                                                        |
| `isRemoteTarget`  | `isRemoteTarget(target)`                                                                  | `boolean`                                                         | deciding whether a configured destination is a remote SFTP target or a local directory (correctly excluding a Windows drive letter like `C:\Foundry\Data`) |
| `parseRemote`     | `parseRemote(target)`                                                                     | `{username: string\|undefined, host: string, remotePath: string}` | splitting a `[user@]host:/path` remote target into its parts                                                                                               |
| `resolveAgent`    | `resolveAgent(env, stageUpper, prefix = "SOHL")`                                          | `string\|undefined`                                               | locating the SSH agent endpoint cross-platform, falling back to a key file when `undefined`                                                                |
| `buildConnection` | `async buildConnection(stageUpper, remote, { env, prefix = "SOHL" } = {})`                | `Promise<object>`                                                 | assembling an `ssh2-sftp-client` connection config for a stage, defaulting to agent auth so no secret is read from disk                                    |
| `deployLocal`     | `async deployLocal(srcAbs, destDir)`                                                      | `Promise<void>`                                                   | mirroring a staged build into a local directory via the staged, atomic swap                                                                                |
| `deployRemote`    | `async deployRemote(conn, srcAbs, remoteDir, { onUpload } = {})`                          | `Promise<void>`                                                   | mirroring a staged build into a remote directory over SFTP, with the same staged swap `deployLocal` performs                                               |
| `deployStage`     | `async deployStage({ stage, source, packageKind, packageId, env, prefix = "SOHL", log })` | `Promise<{stage: string, destination: string, remote: boolean}>`  | deploying a staged package to one named stage, choosing the transport from the configured destination automatically                                        |

## `./e2e`

The end-to-end harness: a disposable Foundry world, served from a container, with a browser suite driven against it. The harness does not know what the suite is — what runs against the served world is named in `packageBuild.e2e.suite` — it only stands the licensed Foundry up, seeds a world with a known Gamemaster password, waits for that world to be _active_, and tears it down again. Three shapes of run answer different questions: `run` (from scratch, the only path that may change Foundry build), `fast` (the iteration loop — rebuild, redeploy, cycle, re-run), and `sweep` (the same full run against a build the repository does not pin, so `compatibility.verified` can be evidence rather than hope).

```js
import { hashPassword, E2E_MODES } from "@heroiclands/package-build/e2e";

console.log(hashPassword("pw", "salt").slice(0, 8));
// -> "dba2956d"
console.log(E2E_MODES);
// -> ["run", "open"]
```

| Export                        | Signature                                                                                                | Returns                                        | Use it when                                                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `E2E_GM_ID`                   | `const E2E_GM_ID`                                                                                        | —                                              | reading the fixed Gamemaster document id every seeded world carries                                                                                         |
| `E2E_SCENE_ID`                | `const E2E_SCENE_ID`                                                                                     | —                                              | reading the seeded, pre-activated default scene's id                                                                                                        |
| `E2E_MODES`                   | `const E2E_MODES`                                                                                        | —                                              | the closed set of modes the suite may run under (`"run"` / `"open"`)                                                                                        |
| `hashPassword`                | `hashPassword(password, salt)`                                                                           | `string` — the hex hash                        | hashing a password the way Foundry's own `core/auth.mjs` does, to seed a login that actually works                                                          |
| `resolveE2EWorld`             | `resolveE2EWorld(config, env = process.env)`                                                             | `E2EWorld`                                     | resolving the seeded world's identity from configuration, with an environment override under the repository's own variable prefix                           |
| `worldManifest`               | `worldManifest({ worldId, worldTitle, worldDescription, systemId, systemVersion, coreVersion })`         | `object` — the world manifest                  | building the `world.json` a seeded world carries                                                                                                            |
| `gmDocument`                  | `gmDocument({ id, name, password, salt })`                                                               | `object` — the user document                   | building the seeded world's single Gamemaster user document                                                                                                 |
| `defaultSceneDocument`        | `defaultSceneDocument()`                                                                                 | `object` — the scene document                  | building the one pre-activated scene every seeded world carries                                                                                             |
| `moduleConfigurationDocument` | `moduleConfigurationDocument(packageId)`                                                                 | `object` — the setting document                | building the world setting that switches a module package on (a module must be activated; a system does not)                                                |
| `isWorldActive`               | `isWorldActive(body)`                                                                                    | `boolean`                                      | checking whether a `/join` response body shows a world that is actually active, not merely reachable                                                        |
| `resolveSweepVersion`         | `resolveSweepVersion(argv)`                                                                              | `string` — the exact build, trimmed            | reading the exact Foundry build a sweep was asked to run against; there is deliberately no default                                                          |
| `parseFastArgs`               | `parseFastArgs(argv, build)`                                                                             | `FastArgs`                                     | parsing the fast loop's CLI arguments against the repository's declared build table, in declaration order                                                   |
| `seedTestWorld`               | `async seedTestWorld({ config, packageJson, env = process.env, log = () => {} })`                        | `Promise<{worldDir: string, world: E2EWorld}>` | seeding the disposable world into the end-to-end stage's data root, wiping and rewriting the world directory each time                                      |
| `waitForWorld`                | `async waitForWorld({ url, container, stage, timeoutMs = 180_000, log = () => {} })`                     | `Promise<void>`                                | polling until a seeded world is active, or failing with a diagnosis (a licence failure is detected from the container log, not a timeout)                   |
| `suiteExecutables`            | `suiteExecutables(command)`                                                                              | `string[]`                                     | reading every executable a suite command needs to exist before it can run at all                                                                            |
| `findExecutable`              | `findExecutable(name, { cwd, env = process.env } = {})`                                                  | `string\|null`                                 | finding an executable the way the child process would (`node_modules/.bin` first, then `PATH`)                                                              |
| `missingExecutables`          | `missingExecutables({ command, cwd, env = process.env })`                                                | `string[]`                                     | checking which of a suite command's executables are not there — asked again mid-run, since an install can pull the runner out from under a run in progress  |
| `freshResults`                | `freshResults({ paths, since, cwd })`                                                                    | `string[]`                                     | finding which declared result paths a suite run actually wrote to since it was spawned (existence alone is not evidence)                                    |
| `suiteVerdict`                | `suiteVerdict({ status, vanished = [], declared = [], fresh = [] })`                                     | `SuiteVerdict`                                 | deciding what a finished suite run is worth given its exit status and what it left behind; can only ever downgrade a verdict, never upgrade one             |
| `runSuite`                    | `runSuite({ command, args = [], cwd, results = [], env = process.env, log = () => {} })`                 | `number` — the suite's exit status             | running the repository's suite, bracketed by before/after executable checks and a fresh-results check rather than trusting the exit status alone            |
| `suiteCommand`                | `suiteCommand(config, mode)`                                                                             | `string[]`                                     | reading the declared suite command for a mode (`"run"` or `"open"`), or failing clearly when none is declared                                               |
| `e2eRun`                      | `async e2eRun({ config, packageJson, mode = "run", suiteArgs = [], env = process.env, log = () => {} })` | `Promise<number>`                              | running a full, from-scratch end-to-end pass: deploy, reseed, recreate the container, wait, run the suite, tear down (or leave it serving in `"open"` mode) |
| `e2eFast`                     | `async e2eFast({ config, argv = [], env = process.env, log = () => {} })`                                | `Promise<number>`                              | iterating quickly during development: rebuild what changed, redeploy, cycle the world, wait, re-run                                                         |
| `e2eSweep`                    | `async e2eSweep({ config, packageJson, argv = [], env = process.env, log = () => {} })`                  | `Promise<number>`                              | running the full suite against a build the repository does not pin, to license moving `compatibility.verified` forward                                      |

## `./lang`

What a shippable Foundry localization file must satisfy. Every HeroicLands package ships `lang/*.json`, and each way it can be malformed fails silently at runtime rather than at build time: a file that is not a plain object, a dotted-prefix key collision that makes `foundry.utils.expandObject` throw and Foundry discard the entire file, a Handlebars placeholder that renders literally, or non-identifier data baked into a key segment. Both functions here are pure — source text in, findings out — leaving discovery, I/O and reporting to the caller.

```js
import { validateLangSource } from "@heroiclands/package-build/lang";

console.log(validateLangSource('{"SOHL": {"Name": "Test"}}'));
// -> []  (no findings: the file is valid)
```

| Export                 | Signature                    | Returns                                            | Use it when                                                                                                                                                  |
| ---------------------- | ---------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `findPrefixCollisions` | `findPrefixCollisions(json)` | `[string, string][]`                               | finding every `[prefixKey, leafKey]` pair where one key is a strict dotted prefix of another — the exact shape that makes `foundry.utils.expandObject` throw |
| `validateLangSource`   | `validateLangSource(raw)`    | `LangFinding[]` — empty when the file is shippable | validating one localization file's source text against every silent-failure shape at once                                                                    |

## `./manifest`

Building the Foundry package manifest — `system.json` or `module.json` — generated rather than hand-stamped from a template, so the pack list, the identity and the compatibility ranges are stated once, in the configuration, and never restated in a second format that can silently disagree. Three kinds of key end up in the result: declared (`packageBuild.manifest`, emitted unchanged), derived (identity, release addresses, version, compatibility, pack list — an authored copy of these is refused as an error), and computed (namespaced `flags`). The rules are pure functions over data; I/O is confined to `writeManifest`.

```js
import { normalizeRepoUrl } from "@heroiclands/package-build/manifest";

console.log(normalizeRepoUrl("git@github.com:HeroicLands/sohl.git"));
// -> "git@github.com:HeroicLands/sohl"
```

| Export                         | Signature                                                                           | Returns                                                                                                                 | Use it when                                                                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARTIFACTS`                    | `const ARTIFACTS`                                                                   | —                                                                                                                       | reading the two Foundry package kinds (`"system"`, `"module"`) as the artifact name their manifest and release archive are called                                                  |
| `normalizeRepoUrl`             | `normalizeRepoUrl(repository)`                                                      | `string` — normalised `https://` URL, no trailing slash                                                                 | normalising `package.json`'s `repository` field (object or shorthand string, `git+…git` or plain) to the exact URL Foundry fetches release assets from                             |
| `releaseUrls`                  | `releaseUrls({ repoUrl, version, artifact })`                                       | `{url: string, bugs: string, manifest: string, download: string}`                                                       | building the manifest's release addresses — `manifest` points at `releases/latest` so an installed package can discover updates, `download` is pinned to this version              |
| `metadataUrl`                  | `metadataUrl({ repoUrl, version, contentPackage })`                                 | `string` — the version-pinned asset URL                                                                                 | computing where this release publishes its content index, pinned to this version like `download` so a dependency's manifest and its fetched index always describe the same release |
| `manifestPacks`                | `manifestPacks(config)`                                                             | `object[]`                                                                                                              | deriving the manifest's `packs` array from the one pack list the build already has, in build order, companions flattened in                                                        |
| `packFolderFindings`           | `packFolderFindings({ packFolders, packs = [] })`                                   | `Array<{severity: "error"\|"warning", message: string, pack: string, folder?: string, keyPath: Array<string\|number>}>` | checking a declared `packFolders` against the derived pack list — a folder naming a pack that does not exist is an error, a pack no folder names is a warning                      |
| `BUILD_ONLY_RELATIONSHIP_KEYS` | `const BUILD_ONLY_RELATIONSHIP_KEYS`                                                | —                                                                                                                       | reading which `relationships` keys direct the build (e.g. `itemCatalog`) rather than describe the published package, so they can be filtered out of what ships                     |
| `publishedRelationships`       | `publishedRelationships(relationships)`                                             | `Record<string, unknown>`                                                                                               | producing the `relationships` block as it should be published, with `BUILD_ONLY_RELATIONSHIP_KEYS` dropped and everything else preserved in order                                  |
| `buildManifest`                | `buildManifest({ config, packageJson, artifact, flags })`                           | `object` — the manifest, ready to serialise                                                                             | assembling the full Foundry package manifest object from the resolved configuration, without writing it anywhere                                                                   |
| `writeManifest`                | `async writeManifest({ config, packageJson, artifact, outDir, flags, configFile })` | `Promise<{path: string, manifest: object}>`                                                                             | building the manifest and writing it into the staged package; refuses to write when `packFolders` names a pack the build does not produce                                          |

## `./release`

The release archive — the two (or three) files a Foundry package's GitHub Release carries: `<artifact>.zip` (the staged tree), `<artifact>.json` (the manifest, re-fetched by an already-installed package to notice updates), and, when the package ships content, a published content index other packages resolve addresses through. Kept apart from `stage.mjs` because this is the only part of assembly that needs a dependency (the zip archiver); a repository that never cuts a release from a local build pays nothing for it.

```js
import { packRelease } from "@heroiclands/package-build/release";

try {
  await packRelease({ stageDir: "build/stage", outDir: "build/dist" });
} catch (err) {
  // Thrown when the stage has no manifest — nothing has been built yet.
  console.log(err.message);
}
```

| Export        | Signature                                                                                                                                           | Returns                                                                                                                                                   | Use it when                                                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packRelease` | `async packRelease({ stageDir = "build/stage", outDir = "build/dist", artifact = "system", metadataDir = "build/content-index", pdf = true } = {})` | `Promise<{zip: string, manifest: string, metadata?: string, pdf?: string, pdfFindings: array, pdfSkipped: string\|null, bytes: number, version: string}>` | zipping the staged tree and placing the manifest (and, unless `pdf: false`, the book) beside the archive; throws when the stage has no manifest to release |

## `./stage`

The build stage — assembling the tree that becomes a Foundry package, and clearing it away again. A Foundry package is a manifest, some assets, compiled packs, and (if it ships code) a bundle; every HeroicLands repository assembles that directory the same way, so the copying, the cleaning and the archiving are one implementation driven by a per-repository _list_ rather than per-repository code. The missing-source guard fails loudly on a listed path that does not exist, rather than silently shipping a package with a missing `lang/` or `templates/`. The rules are pure functions over data; the functions that touch disk are named for the effect they have.

```js
import { missingSources } from "@heroiclands/package-build/stage";

console.log(missingSources([["does/not/exist", "x"]]));
// -> ["does/not/exist"]
```

| Export                | Signature                                                                    | Returns                            | Use it when                                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `BUILD_ARTIFACT_DIRS` | `const BUILD_ARTIFACT_DIRS`                                                  | —                                  | reading the directories every HeroicLands repository regenerates and none commits (`build`, `.vite`, `.vitepress`, `.rollup.cache`)        |
| `missingSources`      | `missingSources(entries, cwd = process.cwd())`                               | `string[]`                         | checking a whole `[source, dest]` list for absent sources up front, so every problem is reported at once rather than one rebuild at a time |
| `copyTree`            | `copyTree(src, dest, { transform } = {})`                                    | `number` — files written           | recursively copying a file or directory, optionally rewriting each file's content as it's staged instead of copying bytes verbatim         |
| `stageAssets`         | `stageAssets(entries, { cwd = process.cwd(), transform } = {})`              | `{entries: number, files: number}` | copying every listed `[source, dest]` pair into the stage, refusing to start at all if any source is absent                                |
| `cleanBuildArtifacts` | `cleanBuildArtifacts(root, { extra = [], includeNodeModules = false } = {})` | `string[]` — directories removed   | removing the build artefacts a repository regenerates, safely repeatable since an already-clean directory is not an error                  |

## `./templates`

Whether a template's user-visible text goes through localization at all — the reverse of `./coverage`, which walks key → file and cannot see a template that names no key whatsoever; this walks text → key, checking that every user-visible literal in the markup is a `{{localize}}` call rather than English sitting in the file. It also compiles every template, because the common way to break one while localizing it — nesting `{{localize …}}` inside another mustache — is a parse error only inside a helper's hash, so the mistake ships from a template that looks exactly like its working neighbour. Both functions are pure: source text in, findings out.

```js
import { VISIBLE_ATTRIBUTES } from "@heroiclands/package-build/templates";

console.log(VISIBLE_ATTRIBUTES);
// -> ["title", "placeholder", "aria-label", "alt", "data-tooltip", "data-title"]
```

| Export                     | Signature                                        | Returns                                                             | Use it when                                                                                                                                                           |
| -------------------------- | ------------------------------------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VISIBLE_ATTRIBUTES`       | `const VISIBLE_ATTRIBUTES`                       | —                                                                   | reading the template attributes whose value a user actually reads (tooltip, placeholder, screen-reader text), so their English is checked as strictly as heading text |
| `findHardcodedText`        | `findHardcodedText(source, { allow = [] } = {})` | `TemplateFinding[]`                                                 | finding every user-visible literal a template leaves untranslated; `allow` is the explicit, reasoned escape hatch for a literal that is deliberately not a key        |
| `findTemplateSyntaxErrors` | `findTemplateSyntaxErrors(source)`               | `TemplateFinding[]` — one finding when it does not parse, else none | checking whether Handlebars can parse a template at all, without needing any helper it calls to exist                                                                 |

## `./package.json`

Not a JavaScript module — this subpath entry exists so tooling (bundlers, `import.meta.resolve`, a script reading the installed version) can resolve the package's own `package.json` through Node's package-exports resolution instead of reaching outside the declared export map.
