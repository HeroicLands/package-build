---
"@heroiclands/package-build": patch
---

**Content format** — An asset's address is derived from where its file sits.
Three roots, one per type — `assets/icons`, `assets/images` and `assets/audio` —
and any file with a matching extension anywhere beneath one is an asset of that
type, however deep. The filename is the shortcode, the
extension is not part of the address, and the directories in between are the
package's own business.

A root's shortcodes are one flat namespace, so two files under one root sharing
a basename are a build error naming both. Across roots they are different
addresses: `icon-anvil` and `image-anvil` name different pictures for different
purposes.

A font is not an asset and has no address. Nothing names a typeface the way a
note names a picture, and neither consumer of a font could use an address
anyway: a stylesheet wants a relative `url()` and the book wants a family name.
Fonts stay ordinary files a package ships and points a tool at.
