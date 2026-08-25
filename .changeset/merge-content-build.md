---
"@heroiclands/package-build": major
---

Absorb `@heroiclands/content-build`. The two packages are one.

They split by input — content-build read `assets/content/**`, this package read
`lang/`, `styles/`, `src/` and the manifest template — on the theory that a
module would use one or the other. No consumer ever did: all three installed
both, and this package depended on the other besides. What the boundary cost was
a configuration file with two owners, two CLIs with a colliding `manifest`
command, and a two-repository dance for changes that touched a single idea.

Nothing about how a build works changed. Same modules, same CLI commands, same
configuration keys, one name.

**Breaking:**

- `@heroiclands/content-build/*` specifiers become `@heroiclands/package-build/*`.
- The content configuration contract moves from `./config` to `./content-config`,
  because both packages exported a `./config` meaning different things. This
  package's own `./config` is unchanged.
- **The configuration file is renamed**: `content-build.config.{yaml,yml,mjs}`
  becomes `package-build.config.{yaml,yml,mjs}`, matching the one package that
  now reads it. The old stem is not accepted — a deprecation window would let a
  repository sit on a filename naming a package that no longer exists. Every key
  inside the file is unchanged.
- `CONTENT_BUILD_CONFIG` becomes `PACKAGE_BUILD_CONFIG`. The old name is not read.
- `@heroiclands/content-build` is deprecated and gets no further releases.

**Unchanged:** every configuration key, every CLI command and flag — `content-build`
and `package-build` are both bin entries of the merged package — every engine and
`sohl` module export, and every compiled document id.

See `MIGRATING.md`.
