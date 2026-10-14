---
"@heroiclands/package-build": minor
---

**Provenance**

- Every icon and image must be covered by a provenance record, and every record must state `ai: true` or `ai: false`; a package missing either now fails its build until it adds them.

**What a Foundry package ships**

- A package ships only the icons and images whose provenance says `ai: false` under a public-domain, CC0, CC-BY, CC-BY-SA or Noun Project Pro licence; everything else stays in the repository.
- Shipped pictures sit flat at the package root as `icons/<file>` and `images/<file>`, and compendium documents and the website point there; remove any `packageBuild.assets` row copying `assets/icons` or `assets/images`, which is now refused.
- `asset-sets/default.json` in the package lists the shipped pictures, and each release attaches `icons.zip` and `images.zip`.
- A picture the package leaves out shows the package's `missing` stand-in, and every picture reference in a compiled document records which asset it is.
- Items created without art get their default icon again, at its flat `icons/` location.
- A package can ship pictures under further licences by listing them in `packageBuild.shippingLicenses`; the default list still applies and `ai: true` pictures never ship.
