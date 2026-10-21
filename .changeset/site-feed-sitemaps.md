---
"@heroiclands/package-build": patch
---

**Sites**

- Every site writes a `sitemap.xml` of its pages.
- A blog post is a `doc` note of `subType: post`, stating its day in `data.date` and its writer in `data.author`; one naming no writer carries the site's byline.
- `site.feed` names the section a site's posts are listed in, newest first, and fed as Atom at `/<section>/atom.xml`.
- `site.sections` publishes a note at `/<section>/` as that section's page, and `site.tags` writes a page for each tag.
- `site.base: /` serves a site at its domain's root, where `site.sitemaps` and `site.mergeIndexes` name the package sites its sitemap index, `robots.txt` and search cover.
- A homepage with no name of its own takes `site.title` when the package has no manifest title.
