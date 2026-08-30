---
"@heroiclands/package-build": patch
---

Stop `content-build lint` failing a homepage-only content tree (#77).

A package in `publish.site: homepage` mode may hold exactly one note, and a
homepage carries no `shortcode` **by design** — it is addressed by the package
rather than by a slug, so `HOMEPAGE_FIELDS` is empty. The vacuous-tree guard
keyed off the address map, so that tree produced no keys and was reported as a
missing checkout:

```text
assets/content: error: holds no keyed content, so every rule here is vacuous — check that the content tree is present and that this is its root
```

The tree was present, it was the root, and it held the one note the package is
meant to have. `harn-adventures` and `sohl-kethira-basic` both ship in that
mode, so for them the failure was permanent — and an expected failure trains its
author to stop reading the output, which is the one thing this guard needs them
to do.

The guard now reports an **empty walk** rather than an empty key set: a tree
holding notes is a tree, whatever they are keyed on, and only a tree holding
none is the absent one. Nothing about its strength changes — an empty tree, a
tree of untyped scaffolding, and a path that is not the content root each still
fail with the same diagnostic, now worded "holds no content notes".

`patch`, not `minor`: no tree that lints today reports anything different. The
only behaviour that changes is a false failure becoming a pass. The success line
gains its missing noun — `(0 address(es) across 1 note(s))` — since a
homepage-only pass is the first time it prints a zero.
