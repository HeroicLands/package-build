---
"@heroiclands/package-build": major
---

**Building the site**

- Sites are built with `package-build site build` and previewed with `package-build site serve`, and Hugo is no longer installed or used.
- Point your `build:site` and `serve:site` scripts and your deploy workflows at `package-build site build` and `package-build site serve`, and drop the Hugo install step from your workflows.
- The bare `package-build site` command is gone.

**Configuration and notes**

- Remove `site.hugo` from `package-build.config.yaml`; the key is refused.
- A Hugo shortcode in a note is an error; write `[x]{.glyph}` or `[signs]{.cartouche}` instead.
