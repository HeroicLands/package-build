---
"@heroiclands/package-build": minor
---

**The address lint reads the content index too** (#243) — so
`content-build lint` is now **one** derivation of the corpus rather than two.

The command already derived the index: its link check is built from it and its
`sql` tables select over it. Then it walked the whole tree a second time to
reach `lintContentTree`. One command, two answers to "which files are the
corpus?", and findings reported side by side that were drawn from different
ones. The records are now derived once by the command and handed to every pass
below it, this one included.

**It lints what the author wrote.** A record is the note's frontmatter plus the
keys the index derives, so the frontmatter is recovered with
`authoredFrontmatter` — handing a lint the derived keys would have it reasoning
about `address:` and `anchors:` as though someone had typed them.

**Faster, for the same reason it is more correct.** Over `sohl`'s 1,685 notes
`content-build lint` goes from about 1.9s to about 1.3s: the second whole-tree
walk is gone. Findings are byte-identical.

`lintContentTree` takes `config`, already-derived `records`, and the `problems`
collector, so a note the index cannot record is reported with its position and
the rest of the tree is still linted — the contract every converted reader now
shares. It refuses an unstated scope in the same words the others do.
