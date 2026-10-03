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

Record provenance for the assets you ship. Put `provenance.yaml` in an asset directory to describe files there and below, or put a YAML sidecar beside one asset to give that file its own record. A sidecar takes precedence over a directory record for that asset. An asset with no record still enters the index with blank provenance fields. Keep attribution with the authored asset so movement through the tree does not lose its source or license. See the [asset record reference](../reference/format-details.md#the-asset-record) for the accepted keys, inheritance, and examples.

A directory of portraits also states what the pictures in it are for:

```yaml
attribution: Tom Rodriguez
license: CC-BY-SA-4.0
role: portrait
```

**A hero image is 1792×768.** `data.banner` fills one fixed strip wherever it is drawn, so every banner is cut to that size and a picture of any other size is a finding naming both sizes — resize the picture to match. That is the one size any art field requires. An icon is drawn at a nominal size per medium whatever its file holds, a map's `bgImage` sets its own scene's dimensions, and a picture written in prose is fitted to the room it has, so none of those asks anything of a picture's dimensions.

`role` is one of `portrait`, `emblem`, `banner`, `plate` or `map`, and belongs to the `image` type only — declaring it in a `provenance.yaml` under `assets/icons` is a finding, since an icon carries one nominal size per medium whatever the file holds. Leave the key out for an ordinary picture; there is no default role name, only its absence.

The build writes transformed or optimized copies under `build/`; the authored file remains the input for the next build. Output paths are derived from the owning package, asset type, and build target. The [icon guide](../guides/icons.md) covers generated icon variants and placement in Foundry.
