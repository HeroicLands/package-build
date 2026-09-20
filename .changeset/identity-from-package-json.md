---
"@heroiclands/package-build": minor
---

**A manifest's `description` comes from `package.json`.**
`packageBuild.manifest.description` is refused, the same way `id` and
`version` are — delete it; the manifest carries `package.json`'s own
`description`.

**`package.json`'s `homepage` and `author` are read and normalised.**
`homepage` names the address every package's site is served at — an
absolute URL ending `/<contentPackage>/` — and `author` is accepted in
either of npm's forms, a string or `{name, email, url}`, and normalised to
the object form.
