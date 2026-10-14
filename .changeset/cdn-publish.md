---
"@heroiclands/package-build": patch
---

- New `package-build cdn publish --set <file> --name <name>` uploads every icon and image a package has to its CDN folder, flat, and publishes the art the package leaves out as a named asset set a world can add.
- A second run uploads nothing, and `--dry-run` lists what would upload; the bucket is read from `CDN_ENDPOINT`, `CDN_BUCKET`, `CDN_ACCESS_KEY_ID` and `CDN_SECRET_ACCESS_KEY`.
