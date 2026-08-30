---
"@heroiclands/package-build": minor
---

Derive the compile order from what each pass reads, instead of trusting the
order `packs:` happens to declare (#73).

`generatePacksJson` ran its passes in declaration order, but the actors pass
resolves each being's embedded items against the **output** of the item passes —
the JSON under `build/packs-json/`, not the content tree. A package declaring its
Actor pack first therefore compiled only where an earlier run had already left
that directory populated: green on every local tree that had built once, exit 1
on a cold one, over a message naming a missing directory rather than the ordering
that caused it.

`build/` is gitignored, so **every fresh checkout and every CI runner is cold**.
`sohl-kethira-basic` shipped exactly that list and its release path was broken;
the failure had not fired only because an unrelated lint failure exited first.

**What changed**

- A compiler declares the document types whose compiled output it reads —
  `static readsPackOutputOf` on `BasePackCompiler`, `["Item"]` on `Actors`. A
  consumer registering a compiler of its own declares its dependencies the same
  way.
- `orderPassesByDependency` (exported from `engine/generate.mjs`) schedules each
  pass after **every** pack of every type it names — a being addresses an item by
  `(type, shortcode)` without knowing which Item pack ships it, so waiting for
  one of several would resolve some beings and silently fail others. The
  reordering is the smallest one that works: the earliest declared pass whose
  dependencies have all run goes next, so a list already in a workable order is
  compiled exactly as declared. The build logs the derived order only when it
  differs from the declared one.
- **The declared list is untouched**, which is the point: it is also the
  manifest's `packs` array, and a consumer orders that for a reader browsing
  compendiums. The two are now allowed to disagree, so fixing a cold build no
  longer means reordering the shipped manifest away from its `packFolders`.
- The case ordering cannot answer — `content-build package compile <name>`, which
  runs one pass and no other — is now reported in this project's diagnostic form,
  naming the pack that waits, the pack it waits on and the fix, instead of
  throwing about a directory:

  ```text
  error: pack "characters" (Actor) reads the compiled output of the Item pack
         "characteristics", which this run does not compile and which
         build/packs-json/characteristics does not hold — compile the whole
         package, or compile "characteristics" first
  ```

**Bump**

_Minor, not patch, and not major._ Minor because it adds public surface: two
exports on `engine/generate.mjs` and a third documented static switch on
`BasePackCompiler`, which is the registration point for a consumer's own
compiler.

**No previously-passing consumer build starts failing.** The change is strictly
permissive — configurations that failed now succeed, and configurations that
succeeded compile the same documents. Of the four HeroicLands packages, three
(`sohl`, `sohl-thalorna`, `HarnMaster-3-FoundryVTT`) declare an order the
derivation returns unchanged; `sohl-kethira-basic` is the one that moves, and its
`build/packs-json` is **byte-identical** across the two orders — 385 documents,
`diff -r` exit 0. The new single-pack diagnostic replaces a throw on exactly the
runs that already failed.
