---
"@heroiclands/package-build": patch
---

**A build now reads the configuration of the tree it was run in.**

The configuration was located by walking up from the installed package's own
directory. That is the same file as the working directory's in every ordinary
install — and a different one in a git worktree nested under its parent checkout
with no `node_modules` of its own. Node's resolution walks parent directories,
so such a worktree resolves `@heroiclands/package-build` out of the _parent's_
`node_modules`; the walk started inside the parent and landed on the parent's
`package-build.config.yaml`. The build then compiled the parent's content tree
into the parent's `build/`, said so only in absolute paths that are easy to read
past, and exited 0.

Resolution now starts at `process.cwd()` and falls back to the installed
package's directory only when that finds nothing.

| running `content-build package compile` in   | before                  | after            |
| -------------------------------------------- | ----------------------- | ---------------- |
| a repository, or any directory below it      | that repository         | unchanged        |
| a nested worktree that has had `npm ci` run  | the worktree            | unchanged        |
| a nested worktree with **no `node_modules`** | _the parent checkout_   | **the worktree** |
| a directory outside any repository           | the installed package's | unchanged        |
| anywhere, with `PACKAGE_BUILD_CONFIG` set    | the file it names       | unchanged        |

Nothing about "a build reads one tree however it was launched" changes: the walk
climbs, so every directory inside a repository still resolves that repository's
single configuration.

When both walks find a configuration and they disagree, the working directory's
is read and the ignored one is named in a warning on stderr. The disagreement is
worth hearing on its own — it is the cheapest signal that this tree is building
on another checkout's `node_modules`, which is also a masked missing dependency.
`npm ci` in the worktree silences it properly.

**Why this was worth a fix rather than a note.** A silent wrong-tree build does
not merely fail to prove what was wanted, it produces confident evidence for the
wrong tree — and on an output-preserving sweep there is no observation that
distinguishes success from it. The usual tell is a zero diff where a change was
expected; a sweep that expects zero differences has no tell at all.

`resolveConfigFile()` is exported from
`@heroiclands/package-build/engine/pack-config`, reporting the chosen file and
each walk's own answer, so a caller can ask which tree it is about to compile
without re-deriving the resolution and risking disagreement with the loader.
