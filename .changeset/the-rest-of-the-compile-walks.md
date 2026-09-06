---
"@heroiclands/package-build": minor
---

**The rest of the compile reads the index too** (#243). With #300 this takes a
compile from **20 note reads each to 9**, and from ~10.5s to ~5.4s over `sohl`'s
1,685 notes — with all **3,091 emitted documents byte-identical** and the 33
diagnostics unchanged.

Four whole-tree walks go:

- **The scenes pass** collected every note to find map notes and item effects.
  It reads the shared corpus, and opens a file only for a map note's prose —
  three files in `sohl` rather than 1,685.
- **The unclaimed-type check** (`note-claims`) walked before any pass ran, so
  the check that reports "no pack claims this type" was answering about a
  different corpus from the one the passes then compiled.
- **The `sql` directive scan** discovered which notes carry a directive by
  walking. It still reads each body — the index carries no note text — but
  _which files_ is no longer a second answer.
- **The folder-note index**, which is the interesting one; see below.

**Three more ambient-configuration reads**, the same class as every one #243 has
turned up: the scenes pass built a fresh `packRouter()` twice rather than using
the compile's, and the folder-note index took its package from
`contentPackage()` rather than from the configuration the build resolved.

**A trap worth naming, because the next conversion will meet it.** A record's
`id` is not "the id the author wrote". The index fills one in for every
addressable note (#270), and `collectFolderNotes` treats `fm.id` as an
**authored pin** that wins over the id it derives under the folder namespace —
so handing it records would make every folder look pinned and file each one
under an id the packs do not address it by. `pack-folder` caught it. The index
cannot tell a pin from a derivation, so the folder notes are read from disk:
selected by the index, frontmatter from the file. That is the settled rule of
#298 doing real work — the file carries what the index deliberately normalises
away — and it is 79 reads, not 1,685.

`unclaimedNoteFindings` now requires the corpus its caller holds, like
`buildContentLinkIndex` and `collectContentDocs`.

_`collectFoundryEntries` keeps its walk deliberately: it has no production
caller — the link manifest it served was deleted in #271 — so converting it
would change an exported signature for no compile it takes part in._
