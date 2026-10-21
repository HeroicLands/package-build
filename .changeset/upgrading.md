---
"@heroiclands/package-build": major
---

**Upgrading**

- Build and preview sites with `package-build site build` and `package-build site serve`; Hugo is no longer used, so update your scripts and workflows and drop its install step.
- Remove `site.hugo` from `package-build.config.yaml`, and write `[x]{.glyph}` or `[signs]{.cartouche}` where a note used a Hugo shortcode.
- Describe a verse's metre, rhyme or syllable pattern in prose, since `meter=`, `rhyme=` and `syllables=` are errors; write a language's `stress` as a map, `{ two: first, longer: penultimate, mark: acute }`.
- Use `engine.wikilinks` in place of `engine.webWikilinks`, and copy the new `assets/preview/gitea.ini` into the Gitea renderer's `app.ini`.
