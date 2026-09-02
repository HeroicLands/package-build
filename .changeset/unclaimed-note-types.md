---
"@heroiclands/package-build": minor
---

Report a note whose `type:` no configured pack claims, instead of compiling it into nothing in silence (#146, part of #127).

**The defect.** Every compile pass answers one question about a note — _is this mine?_ — and a note every pass answers "no" to is skipped as quietly as the thousands that legitimately belong to another pass. Where **no** pass would ever have said yes, that quiet was the whole of the report. `harn-ensemble` declares no `itemBuilders`, so its five `affiliation` notes were a type nothing selected: the journals pass rejected them, the Actor passes rejected them, and no Item pack existed to claim them. They vanished from the build with no error, no warning and no census line — while its 2,512 `being` notes each produced a routing error, which is the correct behaviour. The two cases differed only in whether some pass got far enough to complain, and the quieter one had no owner.

**The finding.** A note whose type no pack in the resolved configuration claims now fails the build, named and located at its `type:` key in the project's diagnostic form:

```text
assets/content/Affiliations/fff-901-pentacle.md:6:7: error: no configured pack claims a note of type "affiliation", so it compiles into nothing. The "sohl" system compiles it into an Item, but `packs:` declares no Item pack and no `itemBuilders` registry declares "affiliation" — declare both in package-build.config.yaml, or stop authoring the type.
```

**Two conditions, two fixes.** The **vocabulary** — what this toolchain and the systems it ships know a note type to be — is deliberately wider than any one repository's configuration. `affiliation` is a SoHL Item however a given repository is configured, so a tree of `affiliation` notes with no Item pack behind them is a repository that has not finished configuring itself, and the message says which piece is missing. A type in **no** vocabulary is the other finding — nothing anywhere compiles it, so the fix is the note's `type:`, not the configuration. Collapsing the two would have sent `harn-ensemble` to correct five perfectly good notes.

**#79's silence is preserved, and is why the question is asked once.** A markdown type with no mapping in a given system produces no document _for that system_, silently and correctly. A per-pass check would report every such type against every system that does not map it, which is exactly the noise that rule forbids — so the question is put once, to the whole configured pack list, and "no system claims it at all" is the only statement made. A type one system maps and another does not stays silent as long as some pack claims it.

`engine/note-claims.mjs` holds the claim table, which restates each pass's `selects` in the only form that can be asked of a pack the configuration does **not** declare; the suite compares the two for every type in the vocabulary, so they cannot drift apart. `homepage` is exempt by name: it compiles into a page rather than a compendium document, and its absence from every pack is the intended state.

**Measured before it became an error.** Against every content tree in the org, this adds findings to exactly one repository and exactly the notes it was filed for: `harn-ensemble` 2514 → 2519 errors, the five `affiliation` notes; `sohl-thalorna` 150 → 150; `sohl-kethira-basic` 0 → 0; `harn-adventures` 2 → 2; `Song-of-Heroic-Lands-FoundryVTT` 0 → 0, with its 3,126 compiled pack files and its whole diagnostic output byte-identical across the change.

**Bump**

_Minor._ No consumer that builds green today has to change anything to upgrade — the one repository that gains findings is already red for an unrelated reason, and its five findings are the defect this exists to surface rather than a new demand on it. A repository that was silently shipping nothing for a type will now be told so, which is the correction.
