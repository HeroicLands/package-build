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

Every record states `attribution`, `license` and `ai` — whether a machine made the file, as the YAML boolean `true` or `false`. A record that leaves `ai` out is an error at the record; it is never read as `false`.

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

## What the Foundry package ships

The repository keeps every picture; the Foundry package carries a filtered copy, laid out flat. A picture ships when its record says `ai: false` and its licence is one of `LicenseRef-PublicDomain`, `CC0-1.0`, `CC0`, `CC-BY-3.0`, `CC-BY-4.0`, `CC-BY-SA-4.0` or `LicenseRef-NounProject-Pro`, together with any licence the package adds under `packageBuild.shippingLicenses`. A shipped picture sits at `icons/<basename>` or `images/<basename>` at the package root, whatever directories it is kept in here, and the package's asset set, `asset-sets/default.json`, lists what it ships.

A note may still name a picture the package does not ship. Its compiled document draws the package's stand-in instead — `icons/missing.<ext>` or `images/missing.<ext>`, which you provide as an ordinary human-made picture licensed to ship, addressed `<package>-none-icon-missing` and `<package>-none-image-missing` — and keeps the real picture's address, so a world that holds the real file can point back at it. A package that leaves out a picture a note names, and ships no stand-in of that type, fails the build at the note. See [what a package ships](../reference/format-details.md#what-a-package-ships).

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
