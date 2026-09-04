---
"@heroiclands/package-build": minor
---

Publish the note tree as a queryable index, instead of throwing every build's walk away.

Every content build parses every note's frontmatter — the pack compilers, the site
build, and the content-table expander each do it — and every one of them discards
the result. Nothing outside a build could therefore ask a question about the
content: _which beings carry no `kbcat`_, _what does this table actually select_,
_did that type rename leave anything behind_ each needed a throwaway script that
re-walked the tree. Eight dead tables shipped for weeks behind exactly that gap.

`content-build content-index` emits one JSON Lines record per note — the whole
frontmatter, plus a derived `file` (`path`, `folder`, `name`) and the configured
`package` — so a question is one line of `jq`, and so an editor, a CI check, or
another package's build can read the content without re-deriving it.

**The record is the note, not a projection of it.** Nothing is selected, flattened,
or renamed; a reader addresses `sohl.body.weight.base` because that is what the note
says, which is also exactly what a `dataview` query writes. The refusal to impose a
schema is deliberate: `sohl`'s frontmatter spreads 242 distinct leaf paths unevenly
over 15 types, from 9 on a `macro` to 72 on a `being`, so a fixed column set would
turn ordinary authoring into a schema migration. `package` and `file` are the two
derived keys, and a note carrying either is an error rather than a silent overwrite.

**Derived, disposable, byte-stable.** It writes to the new `paths.contentIndex`
(`build/content-index/<package>.jsonl`) — never `paths.stage`, which is mirrored
into a Foundry data root — so nothing may be authored against it and it need never
be committed. Regenerating costs a frontmatter parse rather than a build, which is
why it is a command of its own; and because rebuilding is the intended use, records
are ordered by content path with the note id breaking ties and every object's keys
are sorted at every depth, so a rebuild over an unchanged tree is a no-op. A tree
that yields no note is an error, not an empty index: a reader takes the file as
authoritative, and "this package has no content" is indistinguishable from a
mis-pointed tree.

**Every note's address, and every anchor it defines.** A record states
`address.slug` (what goes inside `[[…]]` locally) and `address.canonical` (the
package-qualified key the manifest files it under), plus every `{#slug}` anchor the
body declares — each with its heading name, level, **line in the file**, and the
`slug#anchor` link that reaches it. Neither address is new information, since both
derive from `type` and `shortcode`; what the fields add is the rule, derived through
the same `addressSlug` and `canonicalKey` the manifest and site build use, so an
index cannot disagree with either about where a note lives. The payoff is that a
wikilink — anchor and all — becomes checkable by lookup rather than by re-parsing
the tree, and an editor can jump to a section instead of searching for it. What
counts as an anchor is kept identical to what `splitPages` matches, and a test
asserts the two agree.

`file.path` stays relative to the content root and is deliberately never absolute:
an absolute path is a fact about the machine that built the index, so it would break
byte-stability between checkouts and publish someone's home directory.

Closes #224.
