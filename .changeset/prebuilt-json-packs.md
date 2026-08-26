---
"@heroiclands/package-build": minor
---

Build a pack from JSON that is already built, and declare the system per pack.

The compile is two stages — content notes to `build/packs-json/<pack>/`, then
that directory to LevelDB — but only the first could feed the second. A package
whose packs are already Foundry JSON had no way in: generation runs first and
refuses an empty content tree, so a package with no `assets/content` threw
before the compile loop, and staging the files by hand did not survive
`generatePack`'s `rmSync` of its destination.

`packs[].prebuilt` names the directory a pack's per-document JSON already lives
in. Generation is skipped for it and the compile reads from there, so
`cleanPackEntry` and the Scene/Level integrity check still run — which is the
reason to route through this toolchain rather than call `compilePack` directly.
When every selected pack is prebuilt the content walk is skipped altogether.

`prebuilt` may not be combined with `folders`, `companions` or `default`, and
may not be declared on a companion. Each of those describes a generation pass,
and a prebuilt pack has none; refusing is better than ignoring a folder file
that can never be read.

Separately, `stats.systemId` is now optional and `packs[].system` declares it
per pack, falling back to the package-wide value and omitted from the manifest
when neither is set. Every pack used to be emitted with one system id, which no
package needing two could express. Foundry requires `system` on ActiveEffect,
Actor and Item packs and on no others, and an Adventure pack that declares one
is hidden from every other system.
