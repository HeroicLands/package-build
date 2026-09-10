---
"@heroiclands/package-build": minor
---

**An asset path's first segment says which package owns it, and the rule is now
stated and tested** (#331).

`img:` and `portrait:` have always answered "which package holds this file?" in
their first segment, but nothing wrote the rule down and nothing asserted it —
the only way to confirm it was to compile a package and read `build/packs-json`.

| Authored path starts with | Owner                 | Emitted              |
| ------------------------- | --------------------- | -------------------- |
| `systems/`                | a separate **system** | unchanged            |
| `modules/`                | a separate **module** | unchanged            |
| anything else             | **this package**      | `<assetRoot>/<path>` |

**The third row is now true.** The translator prefixed `icons/…` and `images/…`
and passed everything else through — the same answer for every path any tree
authors today, and the wrong one for the next directory a package ships.
`sohl-kethira-basic` keeps art under `assets/artwork/`, so an authored
`artwork/deity.webp` would have shipped unprefixed: a 404 in Foundry, reported
by nothing. Ownership is the rule; the directory names inside a package's
`assets/` tree are that package's business.

An address naming no package — an absolute URL, a `data:` URI, a `/`-rooted
path — passes through, on the same rule rather than as an exception. `worlds/`
is deliberately not exempt: a package may not ship art out of a world.

**No compiled document changes.** Compiling `sohl-thalorna` and this system's
own tree before and after gives byte-identical `packs-json`; every path either
tree authors is `icons/`, `images/` or already `systems/`-rooted.

**`banner:` is a path that does not follow this rule, and is documented as
deliberate rather than reconciled.** It reaches no compiled document: it is a
top-level key the Hugo theme reads, and the theme prefixes a relative value with
`images/` and joins it onto `params.cdnBaseURL`. The two address different
places — `img:` a file Foundry serves, `banner:` a file the CDN serves.
