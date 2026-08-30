---
"@heroiclands/package-build": patch
---

Render `[[target|]]` as the target's name on the web, as the packs already do
(#113).

A wikilink with an explicit but empty label produced an **empty anchor** —
`[](/rules/sohl-shock/)`, a link with no clickable text — silently, through
every site build:

```text
[[doc-shock]]             => [Shock](/rules/sohl-shock/)
[[doc-shock|]]            => [](/rules/sohl-shock/)      ← before
[[doc-shock|]]            => [Shock](/rules/sohl-shock/) ← after
[[#sec|]]                 => [](#sec)                    ← before
```

**The two resolvers had drawn the same line in two places, differently.**
`parseWikilink` distinguishes "no label" from "empty label" deliberately, and
its docstring says so — _"`null` and `""` differ: an author may write
`[[x|]]`"_. The packs resolver honoured that by testing falsiness. The web
resolver used `??`, which falls through on `null` only, so `""` survived to the
output at three sites: the same-page anchor, the resolved link, and the
unresolved link.

That is the third instance of exactly the drift `wikilink-syntax.mjs` was
created to stop — its module docstring opens on the two copies of the link
parser having already diverged. The parse was centralised; the _interpretation
of the parsed parts_ was not, and it drifted in the one case the docstring
names.

**So the reading is stated once.** `authoredLabel()` joins the syntax module and
both resolvers consult it, rather than each deciding what an empty label means.
`labelled` is untouched and still separates `[[x]]` from `[[x|]]`, which is what
#1409 actually depends on — an unlabelled `[[Shock State]]` still shows the
author's own prose rather than the canonical name.

**Why it is worth a release rather than waiting.** `[[x|]]` becomes load-bearing
under the four-segment address grammar (#59): the pipe is what distinguishes an
address lookup from an alias lookup, so `[[target|]]` is the canonical way to
write an address that displays its target's name — and the planned migration
rewrites every authored address link into that form. Converting the corpus into
a form that renders an empty anchor would be a corpus-wide regression, so this
has to land first.

**Bump**

_Patch._ A defect fix with no new surface. `authoredLabel` is exported because
both resolvers import it, not as a feature for consumers; no option, address, or
emitted document changes shape, and no link that renders correctly today renders
differently after.
