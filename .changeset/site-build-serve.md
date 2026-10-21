---
"@heroiclands/package-build": patch
---

**Sites**

- `package-build site build` renders a package's website with no other tool: every page, `404.html` and the search index, minified, under `build/site/`.
- `package-build site serve` serves the site locally, writes a page again when its note or the theme changes, and reloads the open browser.
- Headings carry ids the contents list links to, quotes and dashes are set typographically, and footnotes written in the sentence and `:icon …:` tokens render.
- A link of `site.notfound.links` to a page the site does not publish is left off the page-not-found page and reported as a warning at that entry.
- Tags on a package site are labels, so no page links to a tag page that does not exist.
