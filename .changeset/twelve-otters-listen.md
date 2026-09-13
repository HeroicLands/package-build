---
"@heroiclands/package-build": minor
---

**A full command reference**

`docs/commands.md` documents every command both binaries expose — `package-build`
and `content-build`, 25 commands between them — with what each reads, what it
writes, its options and their defaults, its exit codes, and a worked example.

Several corners never had a home before this: `content-build pdf`, and the
options `--coverage`, `--doc`, `--fields`, `--id`, `--references`, `--registry`
and `--root`.

The document is checked against the actual `yargs` definitions in both
binaries, so an option or an action added to either one and left undocumented
fails the build.
