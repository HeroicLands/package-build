---
"@heroiclands/package-build": patch
---

**Rendering and sites**

- `package-build site build` converts a package's Texinfo manuals to HTML under `texi/` in the site, reading the `texinfo` folder or the one `site.texinfo` names.
- The site carries a Texinfo stylesheet that follows the reader's light or dark preference and fits a phone; a package replaces it with a `texinfo.css` in its Texinfo folder.
- A package with Texinfo files and no `texi2any` on `PATH` fails the site build with an error that names the tool.
