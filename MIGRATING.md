# Migrating to `@heroiclands/package-build` 2.0.0

`@heroiclands/content-build` and `@heroiclands/package-build` are one package.
The content half now ships inside `@heroiclands/package-build` at 2.0.0;
`@heroiclands/content-build` is deprecated and receives no further releases.

Nothing about how a build _works_ changed. This is a packaging change: the same
modules, the same CLI commands, the same configuration keys, reachable under one
name.

## Why

The two packages split by input — content-build read `assets/content/**`,
package-build read `lang/`, `styles/`, `src/` and the manifest template — on the
theory that a module would use one or the other. No consumer ever did. All three
installed both, and package-build depended on content-build besides, so the
packaging half dragged the content half in regardless.

What the boundary cost was real: one configuration file with two owners, two
CLIs with a colliding `manifest` command, and a two-repository dance for changes
that touched a single idea.

## 1. Dependencies

Drop `@heroiclands/content-build` and move to 2.0.0:

```diff
 "devDependencies": {
-  "@heroiclands/content-build": "^1.8.2",
-  "@heroiclands/package-build": "^0.6.1"
+  "@heroiclands/package-build": "^2.0.0"
 }
```

## 2. Import specifiers

Every `@heroiclands/content-build/*` specifier becomes
`@heroiclands/package-build/*`. Subpaths are otherwise unchanged — `engine/*`,
`sohl/*`, `prettier` and `markdownlint` all keep their names:

```diff
-import { positionOfLiteral } from "@heroiclands/content-build/engine/diagnostics";
+import { positionOfLiteral } from "@heroiclands/package-build/engine/diagnostics";
```

**One subpath moved.** Both packages exported a `./config`, meaning different
things, so the content one is now `./content-config`. `./config` remains the
packaging configuration it always was, and consumers of it need no change:

```diff
-import { defineConfig } from "@heroiclands/content-build/config";
+import { defineConfig } from "@heroiclands/package-build/content-config";
```

`defineConfig` is also re-exported from the package root, so
`import { defineConfig } from "@heroiclands/package-build"` works too.

A mechanical pass over a consumer:

```bash
git ls-files -z '*.mjs' '*.ts' | xargs -0 perl -pi -e \
  's{\@heroiclands/content-build/config}{\@heroiclands/package-build/content-config}g;
   s{\@heroiclands/content-build}{\@heroiclands/package-build}g'
```

Review the result rather than trusting it — a changelog or a historical comment
that names the old package is usually meant to keep naming it.

## 3. The CLI

**Both commands still exist and behave identically.** `content-build` and
`package-build` are both bin entries of the merged package, so scripts calling
either keep working:

```jsonc
"scripts": {
  "build:compiledb": "content-build package compile",  // unchanged
  "build:manifest": "package-build manifest"           // unchanged
}
```

Unifying the two into one noun-namespaced CLI — and resolving the `manifest`
collision, where `content-build manifest` emits the cross-package link manifest
and `package-build manifest` generates `module.json` — is deliberately _not_
part of this release. It is a behavior change and gets its own.

## 4. Rename the configuration file

**Required.** The config stem follows the package:

```bash
git mv content-build.config.yaml package-build.config.yaml   # or .yml / .mjs
```

The old stem is **not** accepted. A deprecation window would let a repository
sit indefinitely on a filename naming a package that no longer exists, and this
upgrade already requires touching the manifest and the imports — one more `git
mv` is not what makes it expensive.

If a build cannot find the file it says so by name:

```
package-build: no package-build.config.yaml or package-build.config.yml or
package-build.config.mjs found at or above …
```

Two configs in one directory is still an error rather than a precedence
question, so a half-finished rename fails loudly instead of quietly building
from the file you stopped editing.

**Every key inside the file is unchanged**, including the `packageBuild:`
section — which is no longer a block reserved for a separate toolchain, just a
section.

The `CONTENT_BUILD_CONFIG` environment variable, which names the file
explicitly when a repository keeps it somewhere else, is now
`PACKAGE_BUILD_CONFIG`. The old name is not read.

## What did not change

- Every configuration key, and the shape of the whole file — only its name moved.
- Every CLI command, flag and exit code.
- Every engine and `sohl` module, and what it exports.
- The Foundry manifest, the packs it declares, and every compiled document id.

A world that resolved `Compendium.<package>.<pack>.<Type>.<id>` before resolves
it after; nothing about compiled output moved.
