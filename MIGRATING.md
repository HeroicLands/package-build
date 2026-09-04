# Migrating to `@heroiclands/package-build` 15.0.0

**Three unrelated changes ship in this major, and they ask different
repositories for different things.** A page's `url:` front matter is now stated
relative to the **site root** (#217), which a site-publishing repository answers
by deleting one line; an empty art path now means the opposite of an absent one
(#218), which a content tree answers by sweeping `img: ""` and `portrait: ""` to
`null`; and a note's own `title` no longer reaches an `affiliation` item's
`system.title` (#218), which asks nothing of any repository that exists today.

Route yourself by what you have. A repository that publishes no site skips
§1–§2. One that authors no empty art path skips §3–§4. One with no
`type: affiliation` notes skips §6 — and §5, which is only the seam between the
two halves of #218.

## 1. Drop the `site.base: "/"` stopgap (#217)

If your repository set it to stop every page publishing at
`/<package>/<package>/<address>/`, delete the line — the default,
`/<contentPackage>/`, is now right for both halves:

```yaml
site:
  out: kb/content
  # base: "/"   ← delete this
```

Keeping it is no longer harmless: the addresses stay correct either way, but
every same-package link this build renders into a page body stays short
(`/doc-skills/` rather than `/sohl/doc-skills/`) and 404s.

A repository that is genuinely served somewhere other than
`/<contentPackage>/` still says so here, and that value still reaches every
`href`.

## 2. What the `url:` change does _not_ touch

- No note edits, and no configuration key added or removed.
- Every link-manifest entry, including each entry's `path`, is byte-identical.
- Every compiled compendium document is unchanged.
- `trees` pages and section landings state no `url:` and do not move.

The published address of every content page **does** move — from
`/<package>/<package>/<address>/`, where nothing linked, to
`/<package>/<address>/`, which is what the link manifest, the sitemap and every
inbound link already named.

## 3. Sweep `img: ""` and `portrait: ""` to `null` (#218)

`resolveImg` opened with `if (!raw) return ""`, and every caller applied its own
default to the result with `||`. So `""`, `null` and an absent key were one
case: all three compiled to the type's default art, and a note had no way to say
"ship no image" at all.

They are now three values with two meanings:

| a note writes  | it means                             | it compiles with |
| -------------- | ------------------------------------ | ---------------- |
| nothing at all | _unset_ — name me no art             | the type default |
| `img: null`    | the same thing, said out loud        | the type default |
| `img: ""`      | _blank on purpose_ — I want no image | no image         |

So a note still carrying `img: ""` **loses its default art**. The same holds for
`portrait:`, which a being carries independently of `img` and which resolves
through the same function. Find them both:

```bash
grep -rnE '^[[:space:]]*(img|portrait):[[:space:]]*""[[:space:]]*$' assets/content --include='*.md'
```

and write `null` in each — unless the document really is meant to have no image,
which is what `""` now says. Before this release `sohl-thalorna` swept forty-five
`img: ""` notes and `sohl-kethira-basic` eleven `portrait: ""` beings; `sohl`
authors neither.

The frontmatter lint reports every one that is left, as a warning:

```
Note.md:9:1: warning: `img: ""` means "ship no art at all" — it no longer falls
back to this type's default. Write `img: null` for a note that simply names
none; keep `""` only where the document is meant to have no image
```

## 4. Custom callers pair their default with `??`, not `||`

`resolveImg` returns `string | null` now: `null` for an unset path, `""` for a
deliberate blank. A consumer that calls it directly — a custom item builder, a
compiler of its own — must switch:

```diff
-img: resolveImg(fm.img) || MY_DEFAULT,
+img: resolveImg(fm.img) ?? MY_DEFAULT,
```

`||` still compiles and still looks right; it silently reinstates the old
conflation, because `""` is falsy. Every caller in this package moved:
`sohl/items.mjs`, three in `sohl/actors.mjs` (`img`, `portrait`, and the
prototype token's `texture.src`), and `engine/macros.mjs`.

`itemArt()` is unaffected — a registry entry with no art throws before the
translation, so its result is never the unset case.

## 5. `title` is **not** on the art rule

`resolveImg`'s rule reads as a general one about optional strings, and it is
not — it belongs to the function, and `title` never goes through it. So do not
extend §3's sweep to `title`, and do not read the table in §3 as saying anything
about it.

**The reason has changed since this section was first written, and the earlier
one is no longer true.** It used to be that a note's top-level `title` was
_simultaneously_ the page's heading and the shared source for an `affiliation`
item's `system.title`, so `title: null` did not fall back — it stringified, and
the compiled document shipped the literal string `"null"`. That collision is what
§6 removes: the top-level key is no longer a source for the item field at all.

So `title: null` is now simply a note declining to state a heading, and the site
emitter's `fm.title ?? name` falls back to `name.full` as it always did. It
reaches no document field and stringifies nothing.

`title: ""` still publishes a **deliberately blank heading** — which is what cost
fifteen `sohl-thalorna` notes their names (HeroicLands/sohl-thalorna#129) — and
nothing warns about it yet. Whether the frontmatter lint should is #218's, still
open, and deliberately not settled by the art-field warning in §3.

## 6. A note's own `title` no longer fills `system.title` (#218)

**No note edit, no URL change, and no compiled document moves.** An
`affiliation` item's `system.title` stops falling back to the note's own
top-level `title`. The two were never the same quantity — a note's `title` is
the heading its page publishes under, while `system.title` is the style of
address an office carries, Ajaw or Warden — and no note in any content tree
relied on the fallback, so `content-build package compile` emits byte-identical
`build/packs-json` for every consumer.

Only a `type: affiliation` note is affected, and only if it carries a top-level
`title` it meant as the item's field rather than as the page's heading:

```bash
grep -rl '^type: affiliation' assets/content --include='*.md' \
  | xargs grep -l '^title:'
```

Anything that turns up wanted one of the two positions that describe the
_document_ rather than the note — `sohl.system.title`, or `sohl.title`, the
legacy in-block key most trees already write. A membership's title belongs on
the entry in the being's `sohl.items`, as `system.title`.

`data: { title: ... }` is not a position and never was: `title` is not a `data:`
property any note type declares, so `content-build lint` refuses it.

### Regenerate the item field reference

The generated page now prints, under each affected type's table, what the
top-level key of a non-shared field means instead — so an author reading the
table learns that writing `title:` at the top of a note will not fill this
field. Re-run the generator and commit the result, or a repository that checks
the page for staleness reports it stale:

```bash
npx content-build docs item-fields --out <the path your repo uses>
```

### Declaring your own non-shared field

A field in an `itemBuilders` `fields:` declaration may now carry
`topLevelMeans`, whose value is _what the note's top-level key of that name
means instead_. Declaring it removes the shared top-level position from that
field's resolution order:

```js
{
    name: "title",
    to: "title",
    ...STRING,
    default: "",
    topLevelMeans: "the note's own title — the heading its page is published under",
    describe: "The style of address the office carries.",
}
```

The value is the reason rather than a bare flag on purpose: the next person
adding a field needs to know the question exists, and a boolean with a comment
beside it is two statements of one rule.

# Migrating to `@heroiclands/package-build` 12.0.0

**No note edit, no URL change, and one thing to check in the Hugo layer.** A
section is a Hugo directory concept that the note format no longer carries
(#204): content pages are written **flat** under the content mount, named by
their address, instead of into a `<section>/` directory.

## 1. Nothing in the content tree changes

A page's address never contained a section, so **no published URL moves**. A
`README.md` in the content tree stops being its section's landing and becomes an
ordinary page addressed `<type>-<shortcode>/` like every other note; if a tree
still has one that was serving as a landing, it now publishes at its own address.
No tree in this project had one.

A `doc` with no `subType` used to be refused ("no section, so there is nowhere to
file the page") and now publishes. Its `subType` is a **genre** again — closed to
`rules`, `userguide`, `reference` — because it no longer doubles as a section
address on a `README`. That closed check runs after the two #206 added ahead of
it: a retired spelling is a warning naming its replacement, a hyphenated value
is an error, and only then is the type's own list the reason.

## 2. Declare every section your site links to

`site.sections` is now the whole of what a section is. No page is filed into a
section directory any more, so nothing else makes `/<package>/<prefix><section>/`
exist:

```yaml
site:
  sections:
    being: { title: Beings, banner: banners/creature.webp }
    weapongear: { title: Weapons, banner: banners/weapons.webp }
```

A card, menu entry or breadcrumb pointing at a section nobody declares is a 404.

## 3. Check how a section landing lists its members

A declared section's directory holds only its own `_index.md`, so a layout
reading `.Pages` renders an empty listing. Query the site instead, on the page's
own `type`:

```go-html-template
{{- $pages := where site.RegularPages "Type" "weapongear" -}}
```

That is the shape a content catalog wants regardless — it groups by what a page
_is_ rather than by where its file happened to be written — and it is what
`sohl`'s catalog layouts already do.

A site rendering through a **shared theme** has no layout of its own to edit. As
of 13.1.0 the section declares its query instead, and the theme runs it:

```yaml
sections:
  weapongear: { title: Weapons, listType: weapongear }
  user-guide: { title: User Guide, listType: doc, listSubType: userguide }
```

`listType` is the content type, not the section's name — the two need not agree,
and `listSubType` narrows a type whose genres share it. See
[What a section may declare](CONTENT.md#what-a-section-may-declare).

## What did not change

- Every content page's `url:`, and so every published address.
- Every link-manifest entry, including each entry's `path`.
- Every compiled compendium document.
- `site.sections` / `site.readmeSections` and what an entry may declare.

# Migrating to `@heroiclands/package-build` 11.0.0

**Two edits, and the second is one line per repository.** Every published page
moves to its address (#181), and the package homepage becomes an ordinary
addressed note (#182).

## 1. A page's URL is its address

Every content page now serves at `/<package>/<type>-<shortcode>/` rather than at
a slug derived from `name.full`. No content edit is required for it — the
address is computed from fields every note already declares — but **every
published URL moves**, so anything holding one (an external link, a bookmark, a
citation in another repository) has to be re-derived.

## 2. Give the homepage a `shortcode`

The homepage used to **refuse** `shortcode` and `name`, because a URL derived
from a display name while a homepage's destination was fixed. That premise is
gone, so both fields are permitted and `shortcode` is **required**:

```markdown
---
type: homepage
shortcode: root
title: HârnMaster Kethira Basic
---
```

`root` is the convention, not a rule. Without one, `content-build lint` and
`content-build site` both refuse the note:

```text
assets/content/homepage.md:3:7: error: a `type: homepage` note declares a `shortcode`, like every other note: it is addressed as `homepage-<shortcode>` and published at `/<package>/homepage-<shortcode>/`, which is where `[[homepage-<shortcode>|Text]]` lands. Write `shortcode: root` — the package landing is `homepage-root` in every package
```

`id` is still refused, on ground this does not touch: a homepage compiles into
no compendium document.

## 3. Author the `/<package>/` redirect

The landing is published at `/<package>/homepage-root/`, and nothing is written
at `/<package>/` any more. Add the redirect to the repository's own
`_redirects`, and pin its lifetime in `_headers` — Cloudflare Pages sets no
`Cache-Control` on a redirect it generates, and an unpinned 301 is cacheable
indefinitely:

```text
# _redirects
/sohl/   /sohl/homepage-root/   301
/sohl    /sohl/homepage-root/   301
```

```text
# _headers
/sohl/
  Cache-Control: max-age=3600
/sohl
  Cache-Control: max-age=3600
```

Both path forms, because Pages matches the raw path and `/sohl` and `/sohl/` are
distinct keys. See `CONTENT.md` for why the pairing works and how to verify it
after a deploy.

# Migrating to `@heroiclands/package-build` 6.0.0

**No configuration change to make, and one build check that may now fail.**
`packageBuild.manifest.packFolders` is compared against the `packs[]` the build
derives, and a folder naming a pack the package does not ship is an error.

## 1. Check what `package-build manifest` says

Nothing to edit up front — run it, and the build names anything wrong:

```text
package-build.config.yaml:164:23: error: packFolders: folder "HârnMaster 3 System" names pack "character", which this package does not ship (packs: items, system-help)
```

Every name in a folder's `packs` must appear in the top-level `packs:` list —
companions included, since Foundry sees no difference. Delete a name that no
longer resolves, or correct it. An error stops the manifest being written, so
nothing half-right reaches the stage.

## 2. The advisory needs no action

A pack no folder names is a **warning**, and the build continues:

```text
package-build.config.yaml:162:13: warning: packFolders: pack "items" is named by no folder, so it ships outside every folder this package declares
```

Shipping one pack at the root can be deliberate, so this is not an error. But a
package that bothered to declare a folder rarely meant to leave one out — that
is exactly how `HarnMaster-3-FoundryVTT` shipped 1,577 of 1,597 documents loose
beside its folder. Add the pack to a folder, or leave it and take the advisory.

A package that declares no `packFolders` at all is unaffected, and says nothing.

## 3. Nothing else

- **No configuration key changed**, and no CLI command, flag or exit code beyond
  `manifest` failing on the error above.
- `writeManifest` takes an optional `configFile`, so a finding names the line it
  is about. Omitting it costs the position, not the finding.

# Migrating to `@heroiclands/package-build` 5.0.0

**One configuration change: `publish.site` is a mode, not a boolean.** And one
new authoring capability that needs no migration: a `type: homepage` note.

## 1. Respell `publish.site`

```yaml
publish:
  site: content # was `site: true`
```

```yaml
publish:
  site: homepage # was `site: false`, or absent
```

`homepage` is the default, so a repository that never set the key needs no edit.
A repository that set it to either boolean gets a `TypeError` at load naming the
mode to write:

```text
package-build config: `publish.site` is no longer a boolean — write `site: content`. Every package publishes an authored homepage at /<contentPackage>/, so no value means "no web presence": `homepage` publishes that page and nothing else, and `content` publishes it plus every page the content tree compiles to.
```

Both spellings are **refused rather than mapped** onto the nearest mode. `false`
read as _this package has no web presence_, which now describes no package at
all, and a value silently reinterpreted reads to its author as though it still
means what it said.

Nothing else about publishing moved: `publish.address`, `publish.manifests` and
the whole `site:` block are unchanged, and every address `sohl` and `thalorna`
already publish is byte-identical across the upgrade.

## 2. Author a homepage (optional here, required by #52)

Every package is reachable at `https://www.heroiclands.org/<contentPackage>/`,
and the page there is a note in the content tree:

```markdown
---
type: homepage
title: HârnMaster Kethira Basic # optional; defaults to packageBuild.manifest.title
---

What the module is, which system it needs, how to install it.
```

It compiles into no compendium document, appears in no pack and in no link
manifest, and is addressed by the package rather than by its own name. It is
written to the root of `site.out`, one level above the content mount.

A repository with no homepage note publishes none, and the site build says so in
its count. Requiring exactly one is a separate change (#52).

## 3. What homepage-only means

`homepage` mode does not merely leave the content configuration unused — it
**fences the content surfaces off**. The tree is never walked for pages, and
`site.sections`, `site.trees`, `site.landing` and `site.backfillSections` emit
nothing even when they are declared.

That is deliberate, and it is a licensing requirement rather than a preference.
`sohl-kethira-basic` (Keléstia Productions' Fan Material Guidelines) and
`harn-adventures` (HârnFanon under Lythia's terms) publish a homepage and no
other page; the failure mode is silent — a `site:` block added later ships
licensed content with nobody noticing — so the property is asserted by the code
path rather than left to configuration.

`publish.manifests.publish` is a separate decision and stays `false` for both: a
link manifest is the dependency edge that would stop a module being withdrawable,
and a homepage is not.

# Migrating to `@heroiclands/package-build` 4.0.0

**One authoring change: delete `package:` from every content note.** A note's
package is the repository's configured `contentPackage`, and declaring the field
is now a build error rather than a redundancy the build tolerated.

## 1. Sweep the content tree

The field is a whole line, and nothing else reads it:

```bash
find assets/content -name '*.md' -print0 | xargs -0 sed -i '' '/^package: /d'
```

(GNU `sed`: `sed -i '/^package: /d'`.) Then compile — `content-build package
compile` must produce byte-identical output to the run before the sweep, because
the value the build derives is the value the notes restated.

A note that still carries the field fails the build where it is:

```text
assets/content/Gear/Axe.md:12:1: error: `package: sohl` is a retired frontmatter field — delete it. A note's package is this repository's configured `contentPackage` ("sohl", in package-build.config.yaml), and every note in the tree belongs to it.
```

`content-build lint` reports every one of them in a single pass, so the sweep can
be checked before it is compiled.

## 2. Nothing else

- **`contentPackage` stays**, and is unchanged. It is the address namespace —
  the first segment of every canonical key, the name of the emitted link
  manifest, and the package a cross-package wikilink writes. Every address in
  every manifest is identical across this upgrade.
- **A generated table's `WHERE … and package = "<pkg>"` clause keeps matching.**
  The package is synthesised into what the table search sees, from
  `contentPackage`; it was never the authored field that answered the clause
  after 3.3.0.
- **No configuration key changed**, and no CLI command, flag or exit code.

## What this replaced

A note used to be _selected_ by the field: it compiled when `package:` matched
`contentPackage` and was skipped, silently and as "belongs to another pass",
when it did not. A tree whose notes named a package no configuration answered to
compiled **zero notes and exited 0** (#56). 3.3.0 made the field optional so
every repository could be swept on a non-breaking version; this major removes it.

# Migrating to `@heroiclands/package-build` 3.0.0

`@heroiclands/content-build` and `@heroiclands/package-build` are one package.
The content half now ships inside `@heroiclands/package-build` at 3.0.0;
`@heroiclands/content-build` is deprecated and receives no further releases.

Nothing about how a build _works_ changed. This is a packaging change: the same
modules, the same CLI commands, the same configuration keys, reachable under one
name.

## Why

The two packages split by input — content-build read `assets/content/**`,
package-build read `lang/`, `styles/`, `src/` and the manifest template — on the
theory that a module would use one or the other. No consumer ever did. All three
installed both, and package-build depended on content-build besides, so the
packaging half dragged the content half in regardless.

What the boundary cost was real: one configuration file with two owners, two
CLIs with a colliding `manifest` command, and a two-repository dance for changes
that touched a single idea.

## 1. Dependencies

Drop `@heroiclands/content-build` and move to 3.0.0:

```diff
 "devDependencies": {
-  "@heroiclands/content-build": "^1.8.2",
-  "@heroiclands/package-build": "^0.6.1"
+  "@heroiclands/package-build": "^3.0.0"
 }
```

## 2. Import specifiers

Every `@heroiclands/content-build/*` specifier becomes
`@heroiclands/package-build/*`. Subpaths are otherwise unchanged — `engine/*`,
`sohl/*`, `prettier` and `markdownlint` all keep their names:

```diff
-import { positionOfLiteral } from "@heroiclands/content-build/engine/diagnostics";
+import { positionOfLiteral } from "@heroiclands/package-build/engine/diagnostics";
```

**One subpath moved.** Both packages exported a `./config`, meaning different
things, so the content one is now `./content-config`. `./config` remains the
packaging configuration it always was, and consumers of it need no change:

```diff
-import { defineConfig } from "@heroiclands/content-build/config";
+import { defineConfig } from "@heroiclands/package-build/content-config";
```

`defineConfig` is also re-exported from the package root, so
`import { defineConfig } from "@heroiclands/package-build"` works too.

A mechanical pass over a consumer:

```bash
git ls-files -z '*.mjs' '*.ts' | xargs -0 perl -pi -e \
  's{\@heroiclands/content-build/config}{\@heroiclands/package-build/content-config}g;
   s{\@heroiclands/content-build}{\@heroiclands/package-build}g'
```

Review the result rather than trusting it — a changelog or a historical comment
that names the old package is usually meant to keep naming it.

## 3. The CLI

**Both commands still exist and behave identically.** `content-build` and
`package-build` are both bin entries of the merged package, so scripts calling
either keep working:

```jsonc
"scripts": {
  "build:compiledb": "content-build package compile",  // unchanged
  "build:manifest": "package-build manifest"           // unchanged
}
```

Unifying the two into one noun-namespaced CLI — and resolving the `manifest`
collision, where `content-build manifest` emits the cross-package link manifest
and `package-build manifest` generates `module.json` — is deliberately _not_
part of this release. It is a behavior change and gets its own.

## 4. Rename the configuration file

**Required.** The config stem follows the package:

```bash
git mv content-build.config.yaml package-build.config.yaml   # or .yml / .mjs
```

The old stem is **not** accepted. A deprecation window would let a repository
sit indefinitely on a filename naming a package that no longer exists, and this
upgrade already requires touching the manifest and the imports — one more `git
mv` is not what makes it expensive.

If a build cannot find the file it says so by name:

```
package-build: no package-build.config.yaml or package-build.config.yml or
package-build.config.mjs found at or above …
```

Two configs in one directory is still an error rather than a precedence
question, so a half-finished rename fails loudly instead of quietly building
from the file you stopped editing.

**Every key inside the file is unchanged**, including the `packageBuild:`
section — which is no longer a block reserved for a separate toolchain, just a
section.

The `CONTENT_BUILD_CONFIG` environment variable, which names the file
explicitly when a repository keeps it somewhere else, is now
`PACKAGE_BUILD_CONFIG`. The old name is not read.

## What did not change

- Every configuration key, and the shape of the whole file — only its name moved.
- Every CLI command, flag and exit code.
- Every engine and `sohl` module, and what it exports.
- The Foundry manifest, the packs it declares, and every compiled document id.

A world that resolved `Compendium.<package>.<pack>.<Type>.<id>` before resolves
it after; nothing about compiled output moved.
