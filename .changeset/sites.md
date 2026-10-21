---
"@heroiclands/package-build": patch
---

**Sites**

- `package-build site build` renders every page, `404.html`, `sitemap.xml` and the search index, minified; `site serve` rebuilds a page when its note or the theme changes and reloads the browser.
- Blog posts are `doc` notes of `subType: post` with `data.date` and `data.author`, listed newest first and fed as Atom by `site.feed`; `site.sections` and `site.tags` add section and tag pages.
- `site.base: /` serves a site at its domain's root, where `site.sitemaps` and `site.mergeIndexes` extend its sitemap index, `robots.txt` and search across package sites.
- Search filters by package, type, subtype, culture, continent, region, author and tag, ranks a note's name first, shows its icon, and leaves out `.secret` sections.
