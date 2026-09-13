---
"@heroiclands/package-build": minor
---

**Getting started** — `docs/getting-started.md` walks an empty directory to a
package that builds: identity, configuration, a first note, the checks, the
compiled packs, the manifest, the content index and the release archive. Each
step says what it produces and how to tell it worked, with the output it
actually prints. It was written by walking it.

**Project setup** — `docs/project-setup.md` covers what a repository carries
beyond the build configuration: `package.json` and what each script in the chain
is _for_, the shared Prettier re-export and what `.prettierignore` is really
guarding, the packaged git hooks and their per-hook switches, `.changeset/` and
the four settings that are decisions rather than preferences, the label registry
pair, and the directory layout — what the build reads, and everything it writes
under `build/`.
