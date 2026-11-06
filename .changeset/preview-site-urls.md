---
"@heroiclands/package-build": patch
---

**Rendering and sites**

- Build a preview at another address with `site build --base-url` and serve its images from another asset root with `--assets`. Pages, links, script fonts and search use the preview prefix, while the package's authored configuration stays unchanged.
