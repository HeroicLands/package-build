---
"@heroiclands/package-build": minor
---

**A package site is its homepage and its pages.** The `type: homepage` note is
published at `/<package>/` itself — it is written as the mount's `_index.md`,
and `[[homepage-root|…]]` resolves there — and every other note is one page at
`/<package>/<type>-<shortcode>/`. Nothing is generated between them: no section
directory, no listing of a type, no tag page. An index of what a package
publishes is a `doc` note carrying a content table, authored and linked like
any other page.

**What a consumer changes**

- Delete `site.sections`, `site.landing` and `site.backfillSections` from
  `package-build.config.yaml`; each is refused by name with a message saying an
  index is a `doc` note.
- Delete the `landing:` block from the homepage note; it is refused. The
  homepage is a page with a body, and its links are markdown links in that
  body.
- Delete any root redirect the repository authors itself: `site-root` writes
  `_headers` only, and removes a `_redirects` left beside the site.

**What stops answering**

- `/<package>/<section>/` for every declared section, `/<package>/tags/` and
  every tag page, and `/<package>/homepage-root/`. The generated Hugo
  configuration disables the `section`, `taxonomy`, `term` and `RSS` kinds on
  every site.

**API**

- `HOMEPAGE_DESTINATION` names the homepage's file; `homepageDestination`,
  `writeSectionLandings`, `sectionFrontmatter`, `pluralTitle`, `landingPath`,
  `redirects`, `HOMEPAGE_ADDRESS_KEYS` and `hasAnyTag` are gone.
  `homepageAddresses` takes the body alone, `hugoConfig` and
  `generateHugoConfig` take no `hasTags`, and `buildSite` reports none.
