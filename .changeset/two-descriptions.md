---
"@heroiclands/package-build": minor
---

**A package now describes itself once for Foundry and once for the site.** Foundry's package browser wants a pitch — HTML, any length — and a site's `<meta name="description">` wants one plain sentence; deriving both from `package.json`'s `description` forced one string onto both. Declare `packageBuild.manifest.descriptionHtml` in `package-build.config.yaml` for the Foundry pitch (HTML allowed, emitted as the manifest's `description`) and `site.description` for the site's meta description (plain text, required for `content-build site`). `package.json`'s own `description` is read by neither any more — a warning names both keys when one is still declared — and the field can be deleted.
