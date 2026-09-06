---
"@heroiclands/package-build": minor
---

**A note declares the shortcode it used to be published under, so a rename stops
reading as a withdrawal (#278).**

`(type, shortcode)` is a published interface — every satellite declaring
`itemCatalog: true` assembles its beings out of those addresses — and
`content-build addresses diff` exists to report what a build stopped publishing
before a release does. To be useful it has to name where an address _went_, and
it told a **rename** from a **withdrawal** by matching document ids across two
releases.

#270 removed the property that rested on. An id is now derived from the
canonical address, which carries the shortcode, so renaming a shortcode moves the
id too: both sides of the join move together, the match finds nothing, and the
rename is reported as a withdrawal with no successor named. It stayed exact for a
note that **pins** an `id` — but a pin has to be written _before_ the rename, by
an author who does not yet know they will make one.

An author who has just renamed a shortcode does know, so they say so:

```yaml
type: weapongear
shortcode: Taburi
renamedFrom: Tabri
```

**One shortcode or a list**, because renames chain and a released baseline may
know an address by a name two renames ago. **Transient**: once every baseline a
build is compared against post-dates the rename, the declaration may be deleted —
which is what separates it from an `id:` pin, which is permanent. **One key per
note, at the top level**, however many systems the note compiles into, since a
shortcode is the note's rather than a system block's.

**The diagnostic reports which join it had**, because the two are not equally
checkable — a matched id is a fact a reader can verify in both artefacts, while a
declaration is the author's word:

```text
since sohl@0.8.2, weapongear:Tabri is no longer published; the note now
published as weapongear:Taburi declares it was renamed from Tabri. Every
package that resolves weapongear:Tabri breaks when it moves past sohl@0.8.2
```

Three joins are tried, in that order of authority: the document id, then a
declaration, then nothing — which remains **withdrawn**. Nothing infers a
successor from a similar-looking string; a wrong one sends the reader to the
wrong fix.

**`content-lint` holds a declaration to the rules a current address is held to.**
An entry must be a well-formed shortcode, must not be the note's own, and must
name an address the package actually vacated: an entry naming an address some
note still publishes is refused, as are two notes claiming one predecessor, since
an address had one holder and so has one successor. A repeated entry is a
warning — the declaration still works.

**Also fixed: `addresses diff` threw whenever it had a finding to place.** It
called `noteFilesById` without `skipDirectories`, which `walkMarkdownTree`
refuses (#243), so the command worked only when it had nothing to report — the
one path nobody notices. Both of its tree reads now state the scope from the
resolved configuration.
