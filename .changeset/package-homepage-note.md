---
"@heroiclands/package-build": major
---

Every package publishes an authored homepage at `/<contentPackage>/`, and
`publish.site` becomes a mode rather than a boolean (#51, #55).

**A `type: homepage` note (#51)**

A new engine-level content type that compiles into a **page** rather than into a
compendium document. Its whole frontmatter envelope is `type` and an optional
`title`, defaulting to `packageBuild.manifest.title` so the package's name is not
written twice:

```markdown
---
type: homepage
title: HârnMaster Kethira Basic
---

What the module is, which system it needs, how to install it.
```

It compiles into no document, appears in no pack and in no link manifest, and is
addressed by the **package** — `/<contentPackage>/` — rather than by a slug
derived from its name, so `name.full`, `shortcode` and `id` decide nothing on it.
It is written at the root of `site.out`, one level above the content mount.

The page is _authored, not assembled_. Deriving it from the manifest, the release
address and `relationships` was the obvious shortcut and produces a page nobody
chose the contents of — it cannot express that Kethira requires buying the book
from Keléstia, or which of twenty sections a reader should start with.

It is declared in `engine/note-schemas.mjs` rather than in the `sohl` item
registry: the `engine/` ÷ `sohl/` line is note-format knowledge against
game-system knowledge, and a homepage carries no `system` block and mirrors no
item builder. Reachability is the symptom that makes it obvious —
`HarnMaster-3-FoundryVTT` declares no `itemBuilders` at all, so a type living in
the SoHL registry would be unavailable to HM3 and every HM3 module, which is most
of the packages that need a homepage and nothing else.

**`publish.site` is a mode (#55) — breaking**

| Was           | Write                              |
| ------------- | ---------------------------------- |
| `site: true`  | `site: content`                    |
| `site: false` | `site: homepage`                   |
| absent        | absent — the default is `homepage` |

`homepage` publishes the authored homepage and **no other page**; `content`
publishes it plus every page the content tree compiles to. There is no value
meaning "no web presence", because every package publishes its homepage.

Both booleans are **refused rather than mapped** onto the nearest mode, naming
the mode to write. `false` read as _this package has no web presence_, which
describes no package now, and a value silently reinterpreted reads to its author
as though it still means what it said.

**Homepage-only is a first-class mode, not an accommodation.**
`sohl-kethira-basic` (Keléstia Productions' Fan Material Guidelines) and
`harn-adventures` (HârnFanon under Lythia's terms) each publish a homepage and
nothing beneath it — two packages under two different fan-content licences. The
boundary is _published content_: journal text, artwork, item descriptions,
compiled notes. Because the failure mode is silent — a `site:` block added later
ships licensed content with nobody noticing — the mode **fences the content
surfaces off**: in `homepage` mode the tree is never walked for pages, and
`sections`, `trees`, `landing` and `backfillSections` emit nothing even when they
are declared. Measured against the real `sohl-kethira-basic` tree — 363 notes,
and a `site:` block deliberately declaring sections and a landing — the build
emits exactly one file.

`publish.manifests.publish` is a separate decision and stays `false` for both, for
an unrelated reason: a link manifest is the dependency edge that would stop a
module being withdrawable, and a homepage is one row in a routing table.

**Nothing else moves.** `publish.address`, `publish.manifests` and the whole
`site:` block are unchanged, and every address `sohl` already publishes is
byte-identical across the upgrade. Verified against the real tree: 1,669 emitted
files before, 1,670 after, the one addition being `kb/content/_index.md`; the
link manifest's 2,989 entries and all 3,126 compiled pack documents are
byte-identical with and without the homepage note.
