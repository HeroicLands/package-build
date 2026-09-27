# Compendium packs

A Foundry content package declares its compendiums in `packs:` in
`package-build.config.yaml`. Each entry names a pack and the Foundry document
class it holds. The build uses the same list for the manifest and for its
compilation passes. The [configuration reference](../configuration.md) defines
every pack key; this guide covers how to choose and route packs as a package
grows.

## Choose the pack layout

Start with one pack for each document class the notes produce. An Item, Actor,
Macro, Scene, or Adventure note can also produce a JournalEntry for its prose,
so a package with those notes generally needs a JournalEntry pack. A missing
pack for a document a note actually produces is a finding on that note. An
empty body produces no prose journal and needs no pack for it.

```yaml
packs:
  - { name: items, type: Item, label: Items }
  - { name: actors, type: Actor, label: Actors }
  - { name: journals, type: JournalEntry, label: Journals }
```

Item and Actor packs for a system also need the system selection and version
declarations described in [configuration](../configuration.md). A documentation
package has no Foundry packs or manifest; the
[getting started guide](../getting-started.md) shows that package kind.

A pack name forms part of a compendium UUID. Choose it as a stable identifier;
the label can change independently. Pack order in the configuration is the
order shown in the generated manifest. The compiler arranges its passes so a
pass that reads another pack's output runs after every pack of that document
class. In particular, Actor compilation follows the Item packs it reads.

## Route notes between packs of one class

Multiple packs may hold one document class. A single pack of a class is its
implicit default. With several, mark one `default: true` or give each relevant
note an explicit `data.pack`:

```yaml
packs:
  - { name: general, type: JournalEntry, default: true }
  - { name: mysteries, type: JournalEntry }
```

```yaml
shortcode: secondsight
name: { full: Second Sight }
type: doc
subType: concept
data: { pack: mysteries }
```

The note's pack declaration routes its own document. A derived prose journal
uses the default JournalEntry pack, so an Item note's `data.pack` routes its
Item and does not also route its prose. An unknown pack, a pack of another
document class, or a companion pack is an error. If a class has several packs
and no default, an unassigned note of that class is an error too.

For a page that belongs on the site and in the content index but in no
compendium, a journal-only note can declare `data: {pack: none}`. An Item,
Actor, Macro, Scene, or Adventure note cannot use that value because it would
drop the document the note creates. The
[content format](../content-format.md#the-pack-a-note-compiles-into) defines
this field and its placement.

## Build for more than one system

A pack can declare `system`, and the router chooses a default separately for
each document class and system. One Item pack for each system therefore needs
no `default: true` flag. A note with both system blocks produces a document
for each block, shaped by that system's item builder and stamped with that
system's version. A note with only one block produces only that system's
document.

```yaml
itemBuilders: [sohl, hm3]
systems:
  sohl: { compatibility: { verified: "0.9.0" } }
  hm3: { compatibility: { verified: "1.6.3" } }
packs:
  - { name: items-sohl, type: Item, system: sohl }
  - { name: items-hm3, type: Item, system: hm3 }
  - { name: actors-sohl, type: Actor, system: sohl }
  - { name: actors-hm3, type: Actor, system: hm3 }
  - { name: journals, type: JournalEntry }
```

A system block's `pack` selects that system's document pack. A block naming a
pack for another system is an error. A shared `data.pack` that names a pack
for one system does not route the other system into it; that system uses its
own default. A pack with no `system` may serve as a default for either.

The `itemBuilders` registry supplies the accepted item types and the builder
for each type. The named `sohl` and `hm3` registries ship with the package.
When both define a type, the build selects the builder for the pack's system.
The [configuration reference](../configuration.md) covers the version and
registry declarations.

## Supply a custom item builder

A package whose item builders are code uses `package-build.config.mjs` and
passes the builder table to `defineConfig`. Import `defineConfig` from the
`content-config` entry point so the configuration module loads independently
of the compilers:

```js
import { defineConfig } from "@heroiclands/package-build/content-config";
import { ITEM_BUILDERS } from "./build/item-builders.mjs";

export default defineConfig({
  rootDir: import.meta.dirname,
  contentPackage: "example",
  foundryPackage: "example-module",
  packageKind: "modules",
  compatibility: { minimum: "14.359", verified: "14.364" },
  stats: { lastModifiedBy: "examplebuilder000" },
  itemBuilders: ITEM_BUILDERS,
  packs: [{ name: "items", type: "Item" }],
});
```

This form supplies values that a YAML configuration derives from its location
and adjacent `package.json`. Declare one configuration file in the project:
the loader refuses a directory containing both YAML and MJS configurations.
The [API reference](../api.md) describes `defineConfig` and the builder
contract.

## Use prebuilt and companion packs

`prebuilt` points to per-document JSON that the package maintains as input.
The build compiles that JSON into LevelDB without running a note-generation
pass for the pack. A prebuilt pack cannot have a default or companions, and
cannot itself be a companion.

A companion is emitted by its parent's pass. For example, a Scene pass can
also write an Adventure pack that groups its scenes. Declare the companion
under the parent; no note routes directly into it:

```yaml
packs:
  - name: scenes
    type: Scene
    companions:
      - { name: adventures, type: Adventure }
```

The [pack configuration reference](../configuration.md) lists the remaining
constraints and fields.

## Compile and inspect

Run `package-build package compile` to compile every configured pack. Run it
with a pack name to compile one pack; if that pass reads another pack's output,
the needed output must already exist. The full compile orders those passes for
you. `package-build package unpack` reads a built pack back into JSON for
inspection. See the [command reference](../commands.md) for their arguments
and output paths.
