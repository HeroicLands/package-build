---
"@heroiclands/package-build": patch
---

**The specification and four engine docblocks stated the retired folder model**
(#358).

The folder epic replaced a model wholesale — `folder:` named a Foundry id
resolved against a per-pack `*-folders.yaml`, and `packFolder` named a path.
None of that exists: `folder:` is refused, the YAML is gone, and `packFolder`
is a folder note's address. Six passages still described the old shape as the
live one.

**`docs/content-format.md` contradicted itself twice.** The shared-mappings
table — the one place eight rows common to all sixteen type tables are stated —
offered `` `packFolder` / `folder` ``, so a reader was told to write a value the
build rejects, 330 lines before the same document says it is retired. And the
argument for deriving a document id cited "`packFolder: <path>` above", where
above says address.

**Four docblocks described the retired resolution path**, and they publish:

| site                       | said                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `engine/generate.mjs`      | folder files "referenced from entry frontmatter via `sohl.folder: <id>`"            |
| `engine/journals.mjs`      | the target folder's id "from folders.yaml", resolved against a folders.yaml list    |
| `engine/base-compiler.mjs` | `folderResolver` "resolves a `sohl.folder` id against this pack's folder hierarchy" |
| `engine/frontmatter.mjs`   | `folderField` reads "two spellings", `packFolder` winning "where both are present"  |

The last two were the sharpest. `folderField` reads `packFolder` and nothing
else, so its docstring described a resolution the function cannot perform and
deferred to an issue that had closed. `generate.mjs` disagreed with itself
across one file: the module header named `sohl.folder`, while its `resolver`
states the rule correctly — "There is one spelling."

**Prose is the defect the epic was about.** Its argument against
`*-folders.yaml` was that a second, unchecked statement of one fact drifts from
the first, and nothing compares the two. These six passages were exactly that,
and nothing caught them: `lint:content-format` makes a claim only for a
`system.*` target, so a row mapping to core Foundry's `folder` yields none, and
the source side of a shared row is checked by nothing at all.

Two assertions now hold the specification to it — the shared-mappings sources
name no retired field, and the document never presents `packFolder` as holding
a path. The docblocks are held to review instead: a sentence describing
`folder:` as _retired_ is correct and must survive, and no assertion separates
that from one describing it as live without reading the prose.

No behaviour changes; the fix is what the documents say.
