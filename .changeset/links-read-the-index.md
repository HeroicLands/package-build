---
"@heroiclands/package-build": minor
---

**The link check reads the content index instead of walking the tree itself**
(#243) — the first reader converted, and the one #243 nominated.

`buildLinkIndex` answered "which files are the content?" for itself: its own
walk, its own frontmatter parse, its own address derivation. That is the shape
#243 is closing — ten passes each deriving the corpus independently, agreeing
only by inspection. It now reads
{@link module:engine/content-index.indexRecordsFor}, the same derivation the
published artifact, the `sql` tables and the compilers already run on.

**It still opens each note — for its prose, and nothing else.** The index
deliberately carries no body, and a link lives in the body. Everything _about_
the note is in the record. That is one read per note rather than two: the walk
read the file, and this module then read it again for the raw text.

**Two defects go with it.**

- _The package a local address carries came from the ambient configuration._
  `buildLinkIndex` was handed a `config` and then called `contentPackage()`,
  which resolves `loadPackConfig()` from the working directory. The two are the
  same object in an ordinary build and different ones under
  `PACKAGE_BUILD_CONFIG`, in a worktree, or in a test — so the checker could
  build canonical addresses for one package while the manifest it was checking
  built them for another, and every cross-package link would resolve nowhere for
  no visible reason. The package now comes from the configuration the caller
  passed.
- _Each command derived the corpus twice._ `lint`, `links` and `reachability`
  each built a link index _and_ prepared their `sql` tables, and both walked. The
  records are now derived once per command and handed to both, so a table and a
  wikilink cannot disagree about which notes exist. `reachability` also resolved
  its configuration twice and passed neither to the passes below it; it resolves
  one and passes it on.

**Findings are unchanged, and their order is now stable.** Over `sohl`'s 1,685
notes the `links` findings are identical as a set and `lint`'s output is
identical byte for byte; what moved is that diagnostics now come out in content
path order rather than directory-read order, which was never a fact about the
content.

`indexRecordsFor` takes the walk's scope as an argument, so a caller that was
handed one passes it on rather than having it replaced by whichever its
configuration carries; `prepareTreeSqlTables` and `buildLinkIndex` take
already-derived `records`. `authoredFrontmatter` and `isNoteRecord` are exported
beside `DERIVED_KEYS`: a record is a note's frontmatter _plus_ the derived keys,
and a note authoring one of them fails the walk, so recovering what the author
wrote is exact rather than best-effort — which is what lets a pass read the
corpus from the index and still lint what was typed.
