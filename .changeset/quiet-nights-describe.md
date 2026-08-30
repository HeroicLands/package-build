---
"@heroiclands/package-build": minor
---

A section can now describe itself: `site.sections` and `site.readmeSections`
take a `description`, and it reaches the generated `_index.md` (#91).

A generated section landing is the only place a section can speak — a content
package authors no `_index.md` for `weapongear` or `affliction`, so the file the
theme reads is the one this build writes. Its vocabulary was two keys, and
`partials/hero-banner.html` has always rendered `description` as the hero
standfirst, so every generated landing rendered a heading with no standfirst and
could not be given one by any consumer, at any level.

**The pair was the defect, not a passthrough.** The vocabulary lived in two
places that had to be kept in step by hand: the schema that admits a key, and
the two writers that each transcribed `title` and `banner` by name. A key added
to the schema alone validated cleanly and then reached no page. So the writers
stop naming keys and emit what the section resolved to, `title` first, and the
schema is now the single place a section's vocabulary is decided.

**The bound stays.** An unrecognised key under a section is refused at config
load, by name, exactly as before — `site.sections.affliction.descrption is not a
recognized option (expected one of: title, banner, description)`. Passing
sections through unvalidated the way `site.landing` is was weighed and refused:
`landing` is written once, for the mount, in one landing template's vocabulary,
where a section entry is written fourteen to twenty times per build against a
contract every package shares. Unbounded, a mistyped `descrption:` would publish
into front matter, be read by nobody, and say nothing to anyone — which is the
failure this issue was filed about, one step downstream where no build can see
it.

Additive. `description` is optional and no consuming package declares one — none
could, since the loader has always refused it — so every generated landing is
byte-identical, verified across all six consuming packages.
