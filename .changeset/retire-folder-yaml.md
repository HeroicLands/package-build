---
"@heroiclands/package-build": major
---

**`folder:` and the `*-folders.yaml` schema are retired** (#260) — the last step
of #254, once every tree is green on the new spelling.

They go together. The `folder:` Foundry-id spelling had nothing left to resolve
against once the YAML was gone, and the YAML had no reader once the spelling was
refused. What replaces both landed in #255–#258: a folder is a note
(`type: folder`), `packFolder:` names one by **address**, the packs a folder
materialises in are derived from what references it, and its Foundry id is
hashed from its canonical address.

**What is gone**

| Removed                                                      | Replaced by                                                                  |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `*-folders.yaml`, five files per tree                        | `type: folder` notes, resolved through the address index                     |
| `loadFolders`, `buildFolderResolver` and its five invariants | `collectFolderNotes` / `buildFolderNoteIndex`                                |
| `writeFolderDocs`                                            | `writeFolderNoteDocs`, written after the pass that learns what it references |
| The `folders:` pack-configuration key                        | nothing — a pack materialises what its documents reference                   |
| `folder:` on a note                                          | `packFolder:`                                                                |

**Both are refused, not ignored.** A retired field left ignored reads to its
author as though it still works: the note says one thing and the build does
another, and nothing says so. A note that writes `folder:` fails the build
naming `packFolder` and the line to rewrite, and the frontmatter lint reports
every one of them in the tree at once — which is what a tree still to sweep
needs. A pack configuration that still names a `folders:` file is refused the
same way, saying where the folders went rather than merely "no such key".

**Presence is the whole test**, in both positions a note wrote it — top-level
and inside the `sohl:` block. An empty `folder:` parses as `null` and is still
the field, and a value that happens to match a folder note's id is still the
retired spelling. There is no value that makes writing it correct, so each
message says what to write instead rather than which value to change.

**Why this is a major.** A tree that has not swept goes red on adoption, by
design — that is the signal, and it is the reason the removal waited until the
support and the sweeps had landed. Removing either half earlier would have
broken a repository mid-migration, which is the failure the `image:` → `img:`
migration (#142, #149) was staged to avoid: read both, sweep, then remove.

_The adventure-configuration path is untouched here — see #259, deferred._
