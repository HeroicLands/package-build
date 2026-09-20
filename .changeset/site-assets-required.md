---
"@heroiclands/package-build": minor
---

**`content-build site` refuses to generate a configuration with no `site.assets`.** The theme resolves every relative asset — the brand logo, the 404 hero, every CDN-resolved image — against `site.assets`, and there is no defensible default: a package that built a site with the key absent published every one of those as a broken relative path. Declare `site.assets` — the `https://` host every package's imagery is served from — in `package-build.config.yaml` for any package that publishes a site.
