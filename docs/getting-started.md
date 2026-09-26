# Getting started

This is the path from an empty directory to a HeroicLands package that builds:
a repository whose notes compile into Foundry compendium packs, whose manifest
Foundry can install, and whose release archive is ready to attach to a tag.

It assumes you know the constellation's conventions — `~/dev/HeroicLands`, the
branch and pull request rules, the shared Prettier configuration, the git hooks
— and assumes nothing about this toolchain. Everything specific to
`@heroiclands/package-build` is stated here or linked.

The worked example builds a **module content package**: a Foundry module whose
whole substance is a content tree. That is the common case, and the shortest
path that exercises every stage of the build — the note format, the pack
compilers, the content index, the manifest and the release archive. A system
package (`packageKind: systems`) differs only in what its manifest is called and
where its version is derived from; a documentation package is a different shape
and is covered at the end.

You will need Node 24 or newer and npm. Nothing else: no Foundry install, no
credentials, no container.

## Where the reference material is

This document is about **order and motivation** — what to do first, and why the
next step needs the one before it. The detail lives in the references beside it,
and this tutorial links to them rather than repeating them:

| Document                                 | What it answers                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| [`commands.md`](commands.md)             | What each command does, its options, its exit codes.                            |
| [`configuration.md`](configuration.md)   | Every key of `package-build.config.yaml`, its type, its default, its refusals.  |
| [`content-format.md`](content-format.md) | What a note may declare, per note type, and what it compiles into.              |
| [`diagnostics.md`](diagnostics.md)       | How to read the `file:line:column: severity: message` output.                   |
| [`project-setup.md`](project-setup.md)   | The files a repository carries beyond the configuration, and the script wiring. |
| [`api.md`](api.md)                       | The programmatic surface, for a repository with a build script of its own.      |

## The shape of what you are building

Nine files, and a directory the build writes:

```text
acme-bestiary/
├── package.json                 # identity: the Foundry package id and the release addresses
├── package-build.config.yaml    # the build: what this package is, and what it compiles
├── prettier.config.js           # the shared formatting options
├── .gitignore                   # what is generated, so the checks skip it
├── README.md                    # shipped into the package
├── LICENSE.md                   # shipped into the package
├── lang/en.json                 # shipped into the package
├── assets/content/              # the notes — the only hand-authored content
│   ├── homepage.md
│   └── Bestiary/Marsh_Drake.md
└── build/                       # everything the build writes; never committed
```

Two facts govern the whole arrangement, and both are worth holding on to before
the first command.

**`package.json` is the package's identity.** The Foundry package id is its
`name`, verbatim; the manifest, download and bug addresses are derived from its
`repository.url`; a system's stamped version is its `version`. None of those is
transcribed into the build configuration, because a transcribed copy is free to
drift from what it copied.

**`package-build.config.yaml` is the build's single source.** The pack list, the
compatibility range, the manifest and the site layout are all declared there
once, and the generated `module.json` is derived from it. There is no
hand-authored manifest to keep in step.

**One thing about the examples.** Every block below is a real file or a real
transcript. Fenced examples render at the two-space indentation markdown itself
uses, which is not the four the shared Prettier configuration gives a `.json` or
`.yaml` file — so copy the content and let `content-build format --write` settle
the whitespace, rather than transcribing it. Step 6 is where that becomes part
of the routine.

## Step 1 — `package.json`

Create the directory and write `package.json` first, because the toolchain reads
it from the moment it is installed.

```bash
mkdir acme-bestiary
cd acme-bestiary
```

```json
{
  "name": "acme-bestiary",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "license": "GPL-3.0-or-later AND CC-BY-SA-4.0",
  "repository": {
    "type": "git",
    "url": "https://github.com/HeroicLands/acme-bestiary"
  },
  "engines": {
    "node": ">=24.0.0"
  },
  "scripts": {}
}
```

Five of those keys are load-bearing:

- **`name`** becomes the Foundry package id, read verbatim. It is what appears
  as `id` in the generated `module.json`, what a compendium UUID is addressed
  through (`Compendium.acme-bestiary.journals.…`), and what the served asset
  root is built from. Choose it once; renaming it later invalidates every UUID
  anything has stored.
- **`version`** is the release version. It appears in the manifest and in the
  pinned `download` address.
- **`repository.url`** is what the manifest's `url`, `bugs`, `manifest` and
  `download` addresses are derived from. Without it, `package-build manifest`
  refuses to write anything.
- **`type: "module"`** lets `prettier.config.js` be written as an ES module,
  which is how the shared configuration is re-exported.
- **`private: true`** because a package built by this toolchain ships as a
  Foundry release archive, not to npm.

Let `content-build format --write` set the indentation once this file exists:
npm matches `package.json`'s existing indentation when it writes
`package-lock.json`, so a formatted `package.json` produces a formatted
lockfile, and neither needs a `.prettierignore` entry for the life of the
repository.

## Step 2 — install the toolchain

```bash
npm install --save-dev @heroiclands/package-build
```

That installs `package-build`, the packaging half, and `content-build`, the
content half, into `node_modules/.bin`. Run them through `npx`, or wire them into npm scripts as
[`project-setup.md`](project-setup.md) describes.

**How it worked:** `npx package-build --version` prints the installed version.
`--version` and `--help` are the only invocations that do not read a
configuration file. Every other one resolves `package-build.config.yaml` first,
by walking up from the working directory, and fails loudly when it finds none:

```console
$ npx content-build package compile
[ERROR]: package-build: no package-build.config.yaml or package-build.config.yml or package-build.config.mjs found at or above /path/to/acme-bestiary, nor at or above /path/to/acme-bestiary/node_modules/@heroiclands/package-build/engine. A consuming repository declares its build in one file at its root; set PACKAGE_BUILD_CONFIG to name it elsewhere.
```

That is the next step.

## Step 3 — `.gitignore` and `prettier.config.js`

These come before the first check rather than after it, because the checks read
them.

`.gitignore` is what keeps generated trees out of the prose checks: both
`content-build format` and `content-build markdown` consult a repository's
ignore files, so a `build/` that is not named here is a build whose own output
gets reported as unformatted.

```text
node_modules
/build/
/nogit/
/.env.local
```

`node_modules` carries neither a leading nor a trailing slash, for a reason
[`project-setup.md`](project-setup.md) gives in full: a trailing slash matches a
directory only, and a worktree whose `node_modules` is a symlink then goes
unignored.

`prettier.config.js` re-exports the shared options:

```js
/**
 * The shared HeroicLands Prettier configuration.
 *
 * Every route to Prettier — the toolchain, an editor integration, a bare
 * `npx prettier` — resolves a config file, so re-exporting the shared options
 * here is what keeps those three from formatting the same tree three ways.
 *
 * @type {import("prettier").Config}
 */
export { default } from "@heroiclands/package-build/prettier";
```

`content-build format` applies the shared options whether or not this file
exists, so the lint chain is correct without it. Nothing else is: an editor's
format-on-save and a bare `npx prettier --write .` resolve a _config file_, and
finding none they fall back to Prettier's own defaults — a different print width
against the same tree, so the editor and the lint chain take turns rewriting
each other's work. The toolchain says so when the file is missing:

```console
$ npx content-build format
warning: this repository declares no Prettier configuration, so `content-build format` applies the shared conventions while an editor and a bare `npx prettier` apply Prettier's own to the same tree; declare them in a prettier.config.mjs — export { default } from "@heroiclands/package-build/prettier";
```

Any filename Prettier resolves works, `prettier.config.js` included; this is the
one every repository in the family carries.

## Step 4 — `package-build.config.yaml`

The build's declaration. This is the smallest one that compiles a module content
package:

```yaml
contentPackage: bestiary
packageKind: modules

compatibility:
  minimum: "14.359"
  verified: "14.364"

stats:
  lastModifiedBy: acmebuilder00000

packs:
  - { name: journals, label: Journals, type: JournalEntry }
```

Five keys, and each answers a question the build cannot answer for itself:

- **`contentPackage`** names the content package this repository single-sources
  — `bestiary` here, as `thalorna` and `kethira` name theirs. It is what a note's
  canonical address is scoped by and what the published content index is named
  for. **A note never declares its own package**; it belongs to this one, and a
  `package:` key in a note is a hard error.
- **`packageKind`** is `modules`, `systems` or `documentation`. It decides
  whether the manifest is written as `module.json` or `system.json`, where the
  served asset root is rooted, and where the stamped system version comes from.
- **`compatibility.minimum`** is the Foundry core version every compiled
  document is stamped with, and `verified` is the version the package is tested
  against. There is no default: a guessed floor is stamped into every document
  in the pack and stays invisible until something migrates on it.
- **`stats.lastModifiedBy`** is the sixteen-character Foundry user id stamped
  into every document's `_stats` block.
- **`packs`** is the compendium list, and it is the _only_ place packs are
  declared — the manifest's `packs` array is derived from it, so the two cannot
  disagree.

Everything omitted has a default, and the defaults are the conventional
HeroicLands layout: the content tree at `assets/content`, the compiled packs at
`build/stage/packs`, the intermediates and caches elsewhere under `build/`.
[`configuration.md`](configuration.md) documents all eighteen top-level keys,
what each refusal message means, and the five values that are derived rather
than authored.

**How it worked:** run a content command and watch the complaint move from the
configuration to the content tree.

```console
$ npx content-build package compile
[ERROR]: Content tree not found at /path/to/acme-bestiary/assets/content.
[ERROR]: Pack JSON generation reported 1 error(s); refusing to compile packs from incomplete output.
```

The configuration validated. There is simply nothing to compile yet.

## Step 5 — the content tree

Two notes: the package homepage, and one piece of content.

**Every package's tree holds exactly one `type: homepage` note.** It is the
package's front page, authored rather than generated, and `content-build lint`
requires it. It compiles to a page and to no Foundry document.

`assets/content/homepage.md`:

```markdown
---
type: homepage
shortcode: root
title: The Acme Bestiary
description: Creatures of the reed flats, their habits and their hides.
---

# The Acme Bestiary

What lives in the reed flats, what it eats, and what it is worth to the people
who hunt it.
```

`assets/content/Bestiary/Marsh_Drake.md`:

```markdown
---
type: lore
subType: bestiary
name:
  full: Marsh Drake
shortcode: marshdrake
description: A wingless drake of the reed flats, hunted for its hide and feared for its patience.
---

# Marsh Drake

The marsh drake is a wingless reptile of the reed flats, grown to the length of
a river barge. It hunts by stillness: it lies half-submerged for a day at a
time and takes whatever wades within reach.

## Habits

Drakes hold a stretch of water and defend it against their own kind. A stretch
that falls vacant is claimed within a season.
```

Four things about that frontmatter are the note format in miniature, and they
are worth reading closely because everything else in the tree is a variation on
them.

**`type:` routes the note, not its location.** `Bestiary/` is a folder for a
human's benefit. What makes this note a journal is `type: lore`; a note's
directory has no bearing on which pack it lands in. `subType:` narrows it —
`bestiary` is "a kind of creature that is not a people" — and the pair
`(type, subType)` is what each game system maps onto its own document type.

**`shortcode:` is the note's address.** Cross-references are written
`[[lore-marshdrake]]` — the type and the shortcode — and resolve to whatever
that note compiles into, in whatever system is being compiled. A shortcode is
identity: renaming one breaks every link into it.

**`name.full` is the document name and the published URL**, derived by one
shared rule. There is no authored slug anywhere in this toolchain.

**Frontmatter has three regions and only one of them is open.** Top-level keys
(`type`, `shortcode`, `description`, `tags`, and anything else) are copied into
the generated web page, so an unrecognised one is a theme parameter rather than
an error. A `data:` block and a `sohl:` / `hm3:` block are closed: a misspelled
key there is a finding that names the key you meant.
[`content-format.md`](content-format.md) is the specification.

An image stands in its own paragraph. Its directive accepts a named size and a
position together:

```markdown
![[icon-anubis|Anubis]]{size: medium, float: top-left}
```

The accepted sizes are `auto`, `small`, `medium`, `large`, `xlarge`, and
`full-width`. Omitting `size:` means `auto`. The build checks the name, but
`size:` does not change the displayed dimensions on the website, in Foundry, or
in the book. See [Images](content-format.md#images) for the rendering rules.

## Step 6 — check the tree

Four checks, and they are quick enough to run continuously while authoring.

```bash
npx content-build lint      # addresses and frontmatter
npx content-build links     # every wikilink resolves
npx content-build format    # the shared Prettier options
npx content-build markdown  # the shared markdownlint rule set
```

**How it worked:**

```console
$ npx content-build lint
[INFO]: Addresses and frontmatter are well-formed (2 address(es) across 2 note(s)).

$ npx content-build links
[INFO]: 2 notes: every link is a labelled address, every anchor link lands and every address resolves (0 cross-package reference(s) via manifest), no wikilink in frontmatter, every homepage address resolvable.

$ npx content-build markdown
[INFO]: Markdown is clean.
```

`content-build format` reports rather than fixes, which is what a CI gate wants;
`--write` is the fixing form. Transcribe a file's whitespace by hand and the
reporting form names it:

```console
$ npx content-build format
package-build.config.yaml: error: is not formatted; run `content-build format --write` to fix it
[ERROR]: 1 of 6 file(s) are not formatted.

$ npx content-build format --write
[INFO]: Formatted 1 of 6 file(s).

$ npx content-build format
[INFO]: Formatting is clean (6 file(s)).
```

Both forms walk the whole repository, not only the content tree — the
configuration, the scripts and the prose are all held to the same options.

Every finding these commands emit starts with the path of the file that is
wrong, followed by a line, a column, a severity and a message — the contract
[`diagnostics.md`](diagnostics.md) describes. A field that cannot be known is
dropped rather than guessed, so a finding about a whole file names only the file.

Forget the homepage and `content-build lint` says so by name:

```console
$ npx content-build lint
assets/content: error: holds no `type: homepage` note, so package "bestiary" publishes nothing at its own address /bestiary/ — a package's front page is one authored note in this tree, routed by `type:` rather than by filename
[ERROR]: 1 finding(s) across 1 note(s).
```

## Step 7 — compile the packs

```bash
npx content-build package compile
```

```console
[INFO]: Content tree: 2 note(s) at /path/to/acme-bestiary/assets/content
[INFO]: Pack journals: /path/to/acme-bestiary/assets/content → /path/to/acme-bestiary/build/packs-json/journals
[INFO]: Compiled 1 journal entry (0 documentation entries)
[INFO]: Pack journals: compiling to LevelDB at /path/to/acme-bestiary/build/stage/packs/journals
[INFO]: Pack compilation complete.
```

Two notes, one journal entry: the homepage compiles to a page and to no Foundry
document, which is why the counts differ.

The compile runs in two passes, and the intermediate is worth knowing about
because it is where you look when a document is not what you expected.
`build/packs-json/journals/Marsh_Drake_72d497c6a8e57f57.json` is the compiled
document as JSON, before it is written into the LevelDB pack — shown here with
the page's HTML elided, and otherwise entire:

```json
{
  "name": "Marsh Drake",
  "pages": [
    {
      "_id": "2ecce29fd1c5578f",
      "name": "Marsh Drake",
      "type": "text",
      "title": { "show": true, "level": 1 },
      "text": { "format": 1, "content": "…" },
      "_key": "!journal.pages!72d497c6a8e57f57.2ecce29fd1c5578f"
    }
  ],
  "folder": null,
  "sort": 0,
  "ownership": { "default": 0 },
  "flags": {},
  "_id": "72d497c6a8e57f57",
  "_stats": {
    "systemId": null,
    "systemVersion": null,
    "coreVersion": "14.359",
    "createdTime": 0,
    "modifiedTime": 0,
    "lastModifiedBy": "acmebuilder00000"
  },
  "_key": "!journal!72d497c6a8e57f57"
}
```

The body has become one text page, because a journal's pages are cut at its `#`
headings: this note has one, so the whole body is one page named for it. A
second `#` would produce a second page; anything before the first becomes a
leading page named "Introduction". A heading at any level carrying an
`{#anchor}` suffix also starts a page, because a Foundry UUID can address a page
and nothing smaller — which is how a link to a section inside a note resolves at
all. `_key` is the LevelDB key the entry is stored under, which is why the
intermediate carries it.

`coreVersion` is the `compatibility.minimum` from step 4 and `lastModifiedBy` is
the `stats.lastModifiedBy`. `systemId` and `systemVersion` are `null` because
this module declares no game system: it ships journals, which every system can
read. A module shipping Actors or Items declares the system it ships for, and
those two fields are stamped from it — see
[`systems`](configuration.md#systems).

`_id` is derived from the note's canonical address, so it is stable across
builds: recompiling does not renumber anything, and a world that imported
yesterday's pack still resolves against today's.

**A build that exits 0 and produces the wrong output is a bug.** The compile is
the stage where that matters most, so read the counts: "2 note(s)" and "Compiled
1 journal entry" are the two numbers that say what the tree held and what came
out of it.

### Cross-references, and what they compile into

Add a second note and link to it. `assets/content/Bestiary/Fen_Adder.md`:

```markdown
---
type: lore
subType: bestiary
name:
  full: Fen Adder
shortcode: fenadder
description: A small venomous snake of the standing water, more feared than the drake.
---

# Fen Adder

A hand-long snake that lies under the surface scum. Its venom kills slowly and
reliably, which is why the reed-cutters fear it more than the drake.
```

Then, in `Marsh_Drake.md`:

```markdown
Drakes hold a stretch of water and defend it against their own kind. A stretch
that falls vacant is claimed within a season. Reed-cutters working a drake's
water fear the [[lore-fenadder|fen adder]] more.
```

```console
$ npx content-build links
[INFO]: 3 notes: every link is a labelled address, every anchor link lands and every address resolves (0 cross-package reference(s) via manifest), no wikilink in frontmatter, every homepage address resolvable.

$ npx content-build package compile
[INFO]: Compiled 2 journal entries (0 documentation entries)
```

And in the compiled journal, the wikilink has become a Foundry reference:

```text
@UUID[Compendium.acme-bestiary.journals.JournalEntry.c7c3488c3e2a9282]{fen adder}
```

That is the whole point of addressing notes by shortcode rather than by
filename or by id: one authored link, resolved at build time into the reference
each surface needs — a `@UUID` in a compendium journal, a relative URL on the
website. A link that resolves to nothing is an error naming the note, never a
blank.

## Step 8 — what the package ships

The packs are compiled but the package is not yet assembled. A Foundry package
is a staged directory — a manifest, the packs, and whatever files the manifest
points at — and the configuration declares both halves.

Write the three files the manifest will name:

`README.md`:

```markdown
# Acme Bestiary

Creatures of the reed flats, as compendium journals for Foundry VTT.
```

`LICENSE.md`:

```markdown
# License

Code: GPL-3.0-or-later. Content: CC-BY-SA-4.0.
```

`lang/en.json`:

```json
{
  "ACMEBESTIARY": {
    "Title": "Acme Bestiary"
  }
}
```

Then add the `packageBuild:` section to `package-build.config.yaml`. It is the
packaging half's reserved section — validated separately from everything above
it, and documented under
[the `packageBuild` section](configuration.md#the-packagebuild-section):

```yaml
packageBuild:
  assets:
    - { from: README.md, to: README.md }
    - { from: LICENSE.md, to: LICENSE.md }
    - { from: lang, to: lang }

  manifest:
    title: Acme Bestiary
    description: Creatures of the reed flats, as compendium journals.
    authors:
      - name: Acme
    license: LICENSE.md
    readme: README.md
    languages:
      - lang: en
        name: English
        path: lang/en.json
    packFolders:
      - name: Acme Bestiary
        sorting: m
        packs:
          - journals
```

`assets:` is a copy list, from the repository into the stage. `manifest:` is
everything about the manifest that cannot be derived from `package.json` or from
the keys above — the human-facing identity, and the files Foundry links to.
`title` is required by Foundry and has no derivation; supply it.

`packFolders` may name only packs this package ships, and the build compares the
two lists rather than trusting them to agree:

```console
$ npx package-build manifest
package-build.config.yaml:36:21: error: packFolders: folder "Acme Bestiary" names pack "items", which this package does not ship (packs: journals)
package-build: packFolders names 1 pack this package does not ship (reported above). Foundry skips a name it cannot resolve, so the folder would ship missing those packs — correct `packageBuild.manifest.packFolders`.
```

That is the shape of the checks throughout: Foundry's own behaviour on bad input
is to skip it silently, so the build refuses to emit input Foundry would skip.

Stage the files:

```console
$ npx package-build assets
✅ Static assets staged (3 entries, 3 files).
```

Name a path that is not there and it says so before copying anything:

```console
$ npx package-build assets
package-build: Cannot stage assets — these paths do not exist:
   README.md
   LICENSE.md
   lang
```

## Step 9 — generate the manifest

```console
$ npx package-build manifest
✅ Wrote build/stage/module.json (16 keys, 1 packs).
```

`build/stage/module.json` is the file Foundry installs:

```json
{
  "id": "acme-bestiary",
  "title": "Acme Bestiary",
  "description": "Creatures of the reed flats, as compendium journals.",
  "version": "0.1.0",
  "authors": [{ "name": "Acme" }],
  "license": "LICENSE.md",
  "readme": "README.md",
  "flags": {
    "metadataUrl": "https://github.com/HeroicLands/acme-bestiary/releases/download/v0.1.0/bestiary-metadata.jsonl"
  },
  "compatibility": { "minimum": "14.359", "verified": "14.364" },
  "languages": [{ "lang": "en", "name": "English", "path": "lang/en.json" }],
  "packFolders": [{ "name": "Acme Bestiary", "sorting": "m", "packs": ["journals"] }],
  "packs": [
    {
      "label": "Journals",
      "type": "JournalEntry",
      "name": "journals",
      "path": "packs/journals",
      "private": false
    }
  ],
  "url": "https://github.com/HeroicLands/acme-bestiary",
  "bugs": "https://github.com/HeroicLands/acme-bestiary/issues",
  "manifest": "https://github.com/HeroicLands/acme-bestiary/releases/latest/download/module.json",
  "download": "https://github.com/HeroicLands/acme-bestiary/releases/download/v0.1.0/module.zip"
}
```

Read it against what you authored, because the derivations are the part worth
checking:

- `id` is `package.json`'s `name`, verbatim.
- `version` and the pinned `download` address are its `version`.
- `url`, `bugs`, `manifest` and `download` are all built from its
  `repository.url`. Omit that and the command refuses rather than writing an
  unpublishable manifest:

  ```console
  $ npx package-build manifest
  package-build: package.json declares no `repository.url`, so the manifest has no release addresses to advertise. Add it.
  ```

- `packs` is the `packs:` list from step 4, with `path` and `private` filled in.
  It is never declared twice.
- `manifest` points at `releases/latest`, while `download` and `flags.metadataUrl`
  are pinned to this version. That asymmetry is deliberate: the manifest address
  must keep resolving as new releases land, and the download must not move under
  a world that installed it.

## Step 10 — publish the content index

```console
$ npx content-build content-index
[INFO]: bestiary → build/content-index/bestiary-metadata.jsonl (3 notes, 1 KiB)
```

This is the file `flags.metadataUrl` advertises, and it is how packages address
each other. One JSON object per note, carrying the note's canonical address, its
name, its description and the Foundry UUID it compiles to:

```text
{"address":{"canonical":"bestiary-none-lore-marshdrake","slug":"lore-marshdrake"},"aliasesAscii":[],"anchors":[],"description":"A wingless drake of the reed flats, hunted for its hide and feared for its patience.","documentation":null,"file":{"folder":"Bestiary","name":"Marsh_Drake","path":"Bestiary/Marsh_Drake.md"},"foundry":{"none":{"uuid":"Compendium.acme-bestiary.journals.JournalEntry.72d497c6a8e57f57"}},"id":"72d497c6a8e57f57","name":{"full":"Marsh Drake"},"nameAscii":"Marsh Drake","package":"bestiary","shortcode":"marshdrake","subType":"bestiary","type":"lore"}
```

A downstream package that declares a dependency on this one fetches this file
for the release it pins, and `[[lore-marshdrake]]` written in _its_ tree resolves
through it to that UUID. The homepage's entry carries `"foundry": null` — it
compiles to a page, so there is no document to address.

The index is derived and disposable; it is written under `build/` and rebuilt
from the tree every time.

## Step 11 — the release archive

```console
$ npx package-build release
✅ Packaged 0.1.0 for release: build/dist/module.zip (0.0 MB)
```

`build/dist/` then holds the three files a GitHub release needs, and the archive
is named from `packageKind` — a module ships `module.zip`, a system
`system.zip` — so no repository states it a second time:

```console
$ ls build/dist
bestiary-metadata.jsonl
module.json
module.zip
```

The manifest and the content index sit beside the archive rather than only
inside it, because that is where the addresses in the manifest point: a
consumer reads `module.json` from the release without downloading the zip, and
then fetches the index it names.

The archive itself is `build/stage/` verbatim — the manifest at the root, the
LevelDB packs under `packs/`, and the files the assets step put there. `unzip
-l build/dist/module.zip` is worth reading once, because it is the only view of
what a player actually installs.

That is the whole build. From an empty directory: identity, configuration,
notes, checks, packs, stage, manifest, index, archive.

## Putting it in order

The eleven steps above are the order you need them the _first_ time. Thereafter
the build is one chain, and this is the order it runs in:

```bash
npx content-build format        # the prose checks
npx content-build markdown
npx content-build lint          # the content checks
npx content-build links
npx content-build content-index # the index the manifest advertises
npx package-build assets        # the stage: the shipped files
npx content-build package compile
npx package-build manifest      # the stage: the manifest
npx package-build release       # the archive
```

Only one of those orderings is enforced, and it is worth knowing which.
`package-build release` refuses to pack an archive whose manifest advertises a
content index the tree never wrote:

```console
$ npx package-build release
package-build: the manifest advertises bestiary-metadata.jsonl as `flags.metadataUrl` but no such file exists — looked in …/build/stage/bestiary-metadata.jsonl and …/build/content-index/bestiary-metadata.jsonl. Build the content index before packing the release.
```

The rest of the chain is order-independent: `assets`, `compile` and `manifest`
each write their own part of `build/stage/` and none clobbers another's. They
are written in this order because it is the order that reads as an assembly —
the files, then the packs, then the manifest describing both — and because
everything that reads the tree runs before everything that writes the stage.

[`project-setup.md`](project-setup.md) turns this into npm scripts, and covers
everything a repository carries beyond the build itself: the git hooks, the
changeset directory, the label registry, and what each script in the chain is
for.

## What comes next

Four capabilities are configuration away, and each has its own guide material.
None of them is needed to build a package.

**A website.** Every package publishes one — at the least, the homepage note
from step 5 — at `https://www.heroiclands.org/<contentPackage>/`. Add that
address to `package.json` as `homepage`, with a `description` and an `author`
beside it; add `@heroiclands/hugo-theme` under `devDependencies`; and add a
`packageBuild.manifest.title`. Then `content-build deps fetch` caches the
organisation's navigation, and `content-build site` writes the whole Hugo
source tree under `build/hugo/` — the configuration generated from those
values, and the content mount — for `hugo --source build/hugo` to render
into `build/site/<contentPackage>/`. There is no Hugo configuration to
write: the file is generated on every run, and what is genuinely the
package's own — the wording of its "page not found" page — goes in the
`site:` block as `site.notfound`. Set `publish.site: content`, and the same
command publishes the content tree's every page beside the homepage — one
page per note, and nothing generated between them; an index of what the
package publishes is a `doc` note carrying a content table.
[`project-setup.md`](project-setup.md) gives the npm scripts.

**Another package's content.** Declare a dependency under `relationships`, and
`content-build deps fetch` caches that release's published content index so
`[[…]]` links into it resolve. A relationship marked `itemCatalog: true` also
caches the release's Item packs, which is what lets a being embed items by
`(type, shortcode)`. Fetching never happens during a compile: a cold cache
fails naming `deps fetch` rather than reaching the network.

**A game system's documents.** A module shipping Actors or Items names its
`itemBuilders` registry — `sohl` or `hm3` — and declares the system under
`systems:`. That is what maps a note's `(type, subType)` onto a system's own
document type, and what supplies the `_stats.systemVersion` every document is
stamped with.

**Deploying and testing.** `package-build deploy <stage>` pushes a staged
package to a Foundry data directory or a remote host; `package-build container`
runs a licensed Foundry in Docker; `package-build e2e` drives the Cypress suite
against it. All three need a Foundry install, credentials, or both — see
[`commands.md`](commands.md).

## A documentation package

`packageKind: documentation` is the third kind, and it is a different shape
rather than a smaller one: a package that publishes a content tree as a website
and a book, and compiles no Foundry documents at all.

Everything in steps 4 and 8 that exists to describe a Foundry package is
**refused** there rather than ignored, each with a message saying why:
`foundryPackage`, `stats`, `packs`, `itemBuilders`, `compatibility`,
`relationships`, `systems`, `requiresSystem` and `docs`. In exchange, `publish`
becomes required, with `site: content` — publishing the tree is the whole of
what the package does.

So a documentation package's configuration is steps 1 through 6 with a different
`packageKind`, plus a `site:` block, and then `content-build site` in place of
steps 7 through 11. [`configuration.md`](configuration.md) carries the refusal
message for every key; [`commands.md`](commands.md) covers the two commands such
a package lives on, `content-build site` and `content-build pdf`.
