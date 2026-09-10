---
"@heroiclands/package-build": major
---

**A being's items entry names the item it copies with `model:`, an address**
(#334). The top-level `shortcode:` it replaces is retired.

```yaml
sohl:
  items:
    - { model: skill-wpnc, system: { masteryLevelBase: 52 } } # this package
    - { model: sohl-sohl-weapongear-dgr } # another one
```

The old key was doing two jobs badly. It **selected a template**, while the
`system.shortcode` beside it **was** the compiled item's identity — one word for
two things, which the compiler's own error messages had to keep explaining. And
it could not say **which package** the template came from: `loadItemsMap`
flattened every local Item pack and every dependency catalogue into one
`subType:shortcode` space where a local definition silently shadowed a foreign
one. In `sohl-thalorna`, 25,485 of 26,251 model references reach into `sohl` and
none of them said so; the day that repository ships its own `weapongear-dgr`,
every entry citing `dgr` would have retargeted with a green build and no
diagnostic.

**What changes for an author**

|                          | before                             | after                                          |
| ------------------------ | ---------------------------------- | ---------------------------------------------- |
| naming a template        | `{ shortcode: wpnc, type: skill }` | `{ model: skill-wpnc }`                        |
| reaching another package | impossible                         | `{ model: sohl-sohl-skill-wpnc }`              |
| `type:` beside it        | required                           | refused — the address names the type           |
| a custom item            | `name` + `type` + `system`         | unchanged, and `system.shortcode` now required |

A `model` is read by the same grammar every wikilink is (#336), so it is written
at whatever length says what it means and the system segment defaults from the
block the entry sits in — which is why the short form names an **Item** here
while the same string in body prose names a page.

**The catalogue is package-aware.** Every item is keyed under its own package as
well as unqualified, so a `model` that states a package resolves to that
package's item and nothing local can shadow it, while a `model` that states none
still resolves locally-first exactly as before. `foreignItemCatalogDirs` returns
`{ dir, package }` rather than a bare path.

**Consumer sweeps**: HeroicLands/Song-of-Heroic-Lands-FoundryVTT#1875 (95 beings,
1,557 entries) and HeroicLands/sohl-thalorna#176 (645 beings, 26,251 entries plus
938 shortcodes derived for custom gear).
