---
shortcode: authoringassets
name: { full: "Images, icons, audio, and provenance" }
type: doc
subType: howto
---

# Images, icons, audio, and provenance

An addressable file lives under one of three roots. Subdirectories beneath each root are for author organization and can change without changing the asset Address.

| Root            | Address type | Typical use                          |
| --------------- | ------------ | ------------------------------------ |
| `assets/images` | `image`      | Maps, portraits, and illustrations.  |
| `assets/icons`  | `icon`       | Item and being icons.                |
| `assets/audio`  | `audio`      | Sound attached to content or scenes. |

The file's name without its extension is its shortcode; the root determines the type. Asset Addresses use system `none`. A regular link defaults to `note`, but `![[icon-harbor|Harbor emblem]]` defaults to `none`. Image and icon addresses used by `data.icon`, `data.banner`, and other art fields also default to `none`. Those fields name the asset as a bare Address, without wikilink brackets.

```markdown
![[image-harbor-map|Map of the harbor]]{size=large}
![[icon-harbor|Harbor emblem]]{float=top-left size=medium}
```

The embed's label is alternative text. `![[icon-harbor|]]` is decorative. `size=auto` follows the file's natural size; named sizes let web, Foundry, and book choose suitable dimensions. Use `.full-width` for an image intended to span the available measure. The [image reference](../reference/format-details.md#images) lists the closed directive values.

## Ownership and source records

Every asset is covered by a provenance record. Put `provenance.yaml` in an asset directory to describe files there and below, or put a YAML sidecar named for the whole filename — `anvil.svg.yaml` — beside one asset to give that file its own record. A sidecar replaces the directory record for that asset; otherwise the nearest `provenance.yaml` in the file's directory or one above it, up to the type root, answers. Each file resolves on its own, so a directory may hold files its `provenance.yaml` covers beside files a sidecar answers for. A file no record covers is an error at the file. Keep attribution with the authored asset so movement through the tree does not lose its source or license. See the [asset record reference](../reference/format-details.md#the-asset-record) for the accepted keys, inheritance, and examples.

Write sidecar `attribution` as a single text string, even when it credits several contributors. The indexed attribution is a list containing that complete text as one entry. Every record states `attribution`, `license` and `ai` — whether a machine made the file, as the YAML boolean `true` or `false`. A record that leaves `ai` out is an error at the record; it is never read as `false`.

```yaml
attribution: Tom Rodriguez
license: CC-BY-SA-4.0
ai: false
```

A directory of portraits also states what the pictures in it are for:

```yaml
attribution: Tom Rodriguez
license: CC-BY-SA-4.0
ai: false
role: portrait
```

## Master generation status

A master may declare AI generation with the optional boolean `hl:ai`. An absent
value leaves the status unknown unless its recognized IPTC source type states it.
`trainedAlgorithmicMedia` and `compositeWithTrainedAlgorithmicMedia` conflict
with `ai: false`; `digitalCreation` conflicts with `ai: true`. Other source types
do not settle AI status. Derivatives repeat `hl:ai` only when the master
explicitly declares it. The build admits only non-AI assets with an allowed
license.

## Non-AI alternatives

Every known-AI master declares its non-AI alternative in `hl:nonAiAlternative`.
Use a complete asset Address with system `none` and type `image` or `icon`, such
as `sample-none-icon-placeholder`. A target may belong to the artwork package
or a declared artwork dependency; several AI images may share the same suitable
target. The generated public JSONL row carries it as `asset.nonAiAlternative`.
The canonical PNG or SVG master supplies this fact; no sidecar supplies it.

Use the provenance API's `nonAiAlternative` field to edit the embedded value:
a string sets or replaces it, `undefined` preserves it, and `null` removes it.
Raw reads and edits allow an absent field so an incomplete master remains
editable. Master collection reports a missing alternative for known-AI masters,
including AI status established by the IPTC source type. Unknown AI status stays
unknown. A present value must have the complete asset Address shape.

Every operation that builds the content index validates alternatives after
collecting local assets and loading dependency indexes: `package-build content-index`, `package-build content build`, `package-build site build`,
`package-build pdf`, `package-build lint`, `package-build links`, and
`package-build addresses diff`, as well as SQL-table preparation. `package-build manifest`
also validates when `packageBuild.converterData` is set.
Website and PDF builds refuse missing or invalid alternatives even though their
output uses the original illustrations. Every declared target must resolve to an explicitly
non-AI image or icon that can ship under the existing Foundry license policy.
A target may be in this package or a required content dependency declared under
`relationships.systems` or `relationships.requires`. Optional `recommends`
packages cannot supply a required alternative. A missing
target, an undeclared dependency, self-reference, an AI target (including a cycle)
or unknown AI status prevents publication. Fix the Address in the master, supply
the target's indexed artwork and documented non-AI status, or choose an eligible
target. A dependency target also needs a declared Foundry package relationship.

Foundry references use that exact target's installed path and retain the original
artwork Address in their asset flags. Image and icon targets follow the existing
picture policy; they need not have the source's type. Website and PDF references
keep the original illustration. A non-AI or unknown-status master may carry an
alternative and its target must pass the same checks. Selection uses it only
when excluding known-AI artwork.

Existing artwork requires an assignment and backfill before publication: choose
an appropriate non-AI target for each AI master, embed its Address, and resolve
all findings. Field support alone does not complete that artwork work. Public
index rows carry the alternative as a canonical Address string, or `null` when
absent. Derivative image metadata omits it; the provenance audit refuses the
field on a derivative. See the [provenance API](../api.md#engineart-provenance)
for editing and checking records.

## Which note an image shows

A master's embedded provenance may carry `hl:name` and `hl:primarynote`: a name for the image's subject and the Address of its note. Both are optional and independent. When a being or an affiliation is the only such note naming a picture, through an art slot, an embed or a body image, the build fills both from that note (the content index records which notes name which pictures), using its `name.full` and its Address, so a portrait found on its own traces back to its character. A note with no `name.full` supplies only the Address. A picture named by several beings or affiliations, or by none, gets nothing filled in. On any other picture the fields are written as given and survive a rewrite. See [the note an embedded image shows](../reference/format-details.md#the-note-an-embedded-image-shows).

A master creator is one plain text property, one creator attribute on an RDF description, or an ordered RDF `Seq` of plain text `li` entries. Text may carry language tags, which remain in the master during unrelated edits; public derivatives retain the credit text without those tags. Resource-valued, nested, numbered, mixed, duplicate or other unsupported creator structures are errors. A master is a PNG or an SVG, and a derivative is a WebP, SVG or JPEG rendered from it, possibly at another size. They are one image with one `hl:address`, and the master is the canonical version. A derivative carries `hl:derived` with the value `true`, the address and, by default, the copyright, license and attribution; its other properties are the master's, found by address. Other repeated properties match the master. The parent trace names the master Address; `hl:name` and `hl:primarynote` may use current public indexed note values. Checking an override requires the primary-note index, which also verifies note visibility. Prompts and generation details never reach a derivative. Writing a derivative discards embedded metadata and editor markup, while retaining drawing content and color profiles. SVG resource references accept fragments and absolute HTTP or HTTPS URLs without user information; embedded data and local paths are refused. An address has exactly one master and any number of derivatives; a derivative with no master, two masters for one address, a WebP without `hl:derived`, a PNG with it, and a repeated property without matching master or indexed public-note authority are findings. Canonical-master audits still report stale source names separately. See [masters and derivatives](../reference/format-details.md#masters-and-derivatives).

## Book images

Screen books reuse the same JPEG, WebP and SVG artwork files as Foundry. An opaque PNG master, including an opaque icon or a PNG with an unused alpha channel, produces JPEG; a PNG with any transparent pixel produces WebP. SVG remains vector. A print book rendered from masters produces JPEGs at 300 DPI and quality 82, using sRGB and flattening transparency onto white. Raster masters are never enlarged; SVG masters render at the placement resolution. Each JPEG carries its image Address, creator, rights, license, declared AI status and the master Address as `hl:derivedFrom`. Its name and primary note appear only when the indexed note is public. Prompts, generation details and foreign metadata are omitted. The provenance check requires the JPEG's derivative marker and master trace and refuses fields outside this public set.

## What the Foundry package ships

The repository keeps every picture; the Foundry package carries a filtered copy, laid out flat. A picture ships when its record says `ai: false` and its licence is one of `LicenseRef-PublicDomain`, `CC0-1.0`, `CC0`, `CC-BY-3.0`, `CC-BY-4.0`, `CC-BY-SA-4.0` or `LicenseRef-NounProject-Pro`, together with any licence the package adds under `packageBuild.shippingLicenses`. A shipped picture sits at `icons/<basename>` or `images/<basename>` at the package root, whatever directories it is kept in here, and the package's asset set, `asset-sets/default.json`, lists what it ships. A `packageBuild.assets` row may copy other files under `icons/` or `images/`; the shipped pictures are written beside them, and a row's file at the same path as a shipped picture is an error.

A note may still name a picture the package does not ship. For known-AI masters, its compiled document draws the declared non-AI alternative. Other exclusions, such as a human-made picture whose license does not permit shipping, use the package's stand-in — `icons/missing.<ext>` or `images/missing.<ext>`, which you provide as an ordinary human-made picture licensed to ship, addressed `<package>-none-icon-missing` and `<package>-none-image-missing` — and keeps the real picture's address, so a world that holds the real file can point back at it. A picture requiring a stand-in fails the build at the note when its package ships no stand-in of that type. See [what a package ships](../reference/format-details.md#what-a-package-ships).

**A hero image is 1792×768.** `data.banner` fills one fixed strip wherever it is drawn, so every banner is cut to that size and a picture of any other size is a finding naming both sizes — resize the picture to match. That is the one size any art field requires.

`data.banner` reads in one of three states:

| A note writes      | The page draws                                     |
| ------------------ | -------------------------------------------------- |
| an asset Address   | that picture                                       |
| `none`             | no picture, on purpose, and no default replaces it |
| nothing, or `null` | a default picture chosen by the note's `type`      |

Omitting the key does not mean "no hero image" — it means artwork chosen for
the author, which inverts the ordinary reading of an absent key. **A note
declines with `none`, and with nothing else.** `none` is a keyword, never an
asset shortcode, so it is not looked up. A blank (`""`) is an error, and
`null` is the same as omitting the key. An Address that names no image in
this package or a declared dependency is a finding at its line and column;
write `data.banner: none` when the page is meant to carry no hero image.

```yaml
data:
  banner: none
```

`role` is one of `portrait`, `emblem`, `banner`, `plate` or `map`, and belongs to the `image` type only — declaring it in a `provenance.yaml` under `assets/icons` is a finding, since an icon carries one nominal size per medium whatever the file holds. Leave the key out for an ordinary picture; there is no default role name, only its absence.

**A role decides how large a picture written in prose draws, when nothing else states a size.** Each medium maps a role to a maximum, and the drawn size is the smaller of that slot and what the file's own pixels support — see [what a role draws at](../reference/format-details.md#what-a-role-draws-at). A named `size=` beside the embed still overrides it outright; an icon draws at the medium's nominal icon size whatever role it might otherwise have had, because `role` never reaches an icon address at all.

The build writes transformed or optimized copies under `build/`; the authored file remains the input for the next build. Output paths are derived from the owning package, asset type, and build target. The [icon guide](../guides/icons.md) covers generated icon variants and placement in Foundry.

## Derived image cache

Master-derived public images and book JPEGs reuse `build/.cache/art`. Changing a
master, its public note identity, the output profile or the renderer invalidates
the matching entry. An unreadable or corrupt entry is regenerated. The cache is
disposable: deleting it changes rendering time, not the generated bytes. Keep
private master directories separate from this cache and every other build output.

## Artwork archives

Declare original PNG and SVG archives in [`art.archives`](../configuration.md#artarchives).
Each entry names an HTTPS URL and SHA-256 digest. Builds verify the shared cached
archive and extract private originals for the content session. Public outputs are
derived under `build/`; local notes remain authoritative. AI assets name explicit
eligible non-AI alternatives by address, and unknown AI status remains unknown.
An archive may also contain root-level `README.md` and `CHANGELOG.md`. These
files count toward archive safety limits and are checked for corruption; they
are not artwork inputs. Other non-image files are refused. Archive inputs and
local master or component roots are separate modes.
