---
"@heroiclands/package-build": major
---

A section is a Hugo directory concept, and the note format no longer carries one
(#204). Content pages emit **flat** under the mount, named by their address; the
`README.md` landing convention, `sectionOf`, the `<section>/` output routing, and
the "no section, so nowhere to file the page" refusal are all gone.

**Why it goes.** Since #181 a page's URL _is_ its address,
`/<package>/<type>-<shortcode>/`, so a section appears in **no address at all**.
Its only remaining job was choosing the directory a page was written into, and
the only reason that mattered was Hugo's rule about what counts as a section —
`writeSectionLandings`'s own docstring said both of its jobs "exist because of
how Hugo decides what a section is". So the note format carried a filename
convention, a landing rule, a routing function and a refusal in order to satisfy
a rendering engine's directory semantics. #197 was the bill for that: `subType`
did double duty — a genre for an ordinary `doc`, a URL section for a `README` —
the two vocabularies collided, and it took #198, #200, #201 and a release to
settle by widening one of them rather than by removing the overload.

**A page that introduces the notes of a type is now an ordinary note**, named by
convention and with no build path of its own: `type: doc`, `subType: reference`,
`shortcode: <type>`, addressed `doc-<type>`. The package's own front page already
worked this way (`homepage-root`, #182).

| Surface                                | Before                                        | After                                             |
| -------------------------------------- | --------------------------------------------- | ------------------------------------------------- |
| A content page's file                  | `<mount>/<section>/<type>-<shortcode>.md`     | `<mount>/<type>-<shortcode>.md`                   |
| A content page's `url:`                | `/<package>/<type>-<shortcode>/`              | **unchanged**                                     |
| A `README.md` in the content tree      | its section's landing, addressed `<section>/` | an ordinary page, addressed `<type>-<shortcode>/` |
| A `doc` with no `subType`              | refused — "no section"                        | published, at `doc-<shortcode>/`                  |
| A `doc`'s `subType`                    | a genre, or a section address on a `README`   | a genre, closed to what the type declares         |
| `packageAddress(fm, { isReadme })`     | branched on the filename                      | a pure function of the frontmatter                |
| `sectionOf`                            | exported                                      | removed                                           |
| `declaredSections`                     | exported, fed the lint                        | removed — it had no other reader                  |
| `lintNote` / `lintFrontmatter` options | `landing`, `types`, `sections`                | removed                                           |

**`site.sections` is not retired — it is now the whole of what a section is.**
With no page filed into `<section>/`, nothing else makes
`/<package>/<prefix><section>/` exist at all, so `writeSectionLandings` stays and
its role changes from backfilling directories that pages created to _declaring_
the Hugo sections a site wants. Two consequences follow for a consuming site:

- **Declare every section the site links to.** A card, menu entry or breadcrumb
  pointing at an undeclared section is a 404.
- **A section landing lists no child pages.** Its directory holds only its own
  `_index.md`, so a layout reading `.Pages` finds nothing; one that queries
  `site.RegularPages` by `Params.type` is unaffected, and that is the shape a
  content catalog wants anyway — it groups by what a page _is_, not by where its
  file happened to be written.

**`publish.address.landing` is inert, and still accepted.** Both publishing
consumers declare `landing: readme`, which stated something true when they wrote
it; refusing it now would break them over a correct statement, and silently
ignoring it would be worse. It selects nothing and is deleted once no
configuration writes it — the third step, and a separate change. The retired
`collection` value stays refused by name (#202).

**Migration.** No note edit is required, and **no published URL moves** — an
address never contained a section. What a consuming site must check is its
layouts and its `site.sections`, per the two consequences above. Verified against
`sohl`, `sohl-thalorna` and `sohl-kethira-basic` at `origin/main`: `lint`,
`links`, `manifest` and `package compile` are byte-identical for all three (both
link manifests and every compiled pack document), and `sohl`'s emitted site is
byte-identical page for page, keyed by URL — all 1,606 addresses unchanged, 1,670
of 1,671 files identical. The one difference is a backfilled `kb/macro/_index.md`
that no longer exists, `macro` being the one section `sohl` did not declare;
nothing in its site or the shared theme links it.
