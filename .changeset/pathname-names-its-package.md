---
"@heroiclands/package-build": major
---

**A pathname names the package that owns the file, and every surface derives its
own address from it.** A note states a file once — `img:`, `data.portrait:`, a
map's background, overlay, tile textures and ambient sounds, and the address of
every image in a body — and four surfaces resolve it: a Foundry install, the
repository's own tree, the website, and the book. The website used to publish
the address exactly as authored, so a picture that appeared in Foundry and in
the book 404'd on the page.

**What a pathname looks like now**

- `images/map.webp` — a file **this** package ships.
- `sohl/assets/icons/noun/shield.svg` — a file the `sohl` package ships. The
  first segment is the **content package**, never its Foundry id: `thalorna`,
  not `sohl-thalorna`.
- An absolute URL, a `data:` URI, a `//host/…` or a `/`-rooted path passes
  through untouched on every surface, which is how a note addresses core Foundry
  art or a package outside this constellation.

`thalorna` writing `images/map.webp` publishes
`modules/sohl-thalorna/assets/images/map.webp` in Foundry,
`https://cdn.heroiclands.org/thalorna/images/map.webp` on the web, and a copy
staged at `assets/images/map.webp` in the book.

**What every consuming repository must change**

- **Convert authored pathnames.** `systems/sohl/assets/X` becomes
  `sohl/assets/X`, and `systems/hm3/images/X` becomes `hm3/assets/images/X`.
  A Foundry-spelled pathname is now refused with a located error naming its
  replacement, so nothing converts silently and nothing is missed.
- **Set `site.assets`** in `package-build.config.yaml` to the host the site
  serves imagery from. A package-owned image on a page with none set is an
  error naming the key.
- **HM3 serves its pictures from `assets/images/`.** The default art this
  toolchain pairs with each HM3 item type addresses them there.
- **`DEFAULT_ITEM_ART` holds pathnames, not install paths.** A runtime reading
  the map directly resolves the pathname for itself.
- **A package addressed by a pathname must be one the build knows** — its own,
  a game system it compiles content for, or a package under `relationships`.
  Where another package's content name differs from its Foundry id, say so with
  `relationships.<kind>[].contentPackage`.

`banner:` is unchanged, and still not a pathname: it names a hero image on the
site's own asset host, reaches no compiled document and no book, and the Hugo
theme resolves it.
