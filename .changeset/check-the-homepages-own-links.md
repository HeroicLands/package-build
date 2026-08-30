---
"@heroiclands/package-build": minor
---

Check the package homepage's own links (#54).

The homepage is the page a reader arrives at, and it was the one page nothing
checked. Every other note addresses the corpus with wikilinks, which
`content-build links` resolves; a landing addresses the web the way the web does
— markdown links and `landing:` `url` / `href` fields — and none of those went
through a checker at all. SoHL's landing pointed at `kb/creature/` and
`kb/character/` from the day those two types merged into `being`: two 404s on
the package's front page, surviving every build, found only by a person reading
the page.

**Both halves of the note are in scope, and the real pages are why.** Of the six
homepages authored today, four carry every link in the body as ordinary markdown
and two carry them in `landing:` front matter — and the one whose dead links
prompted this has an _empty body_. A body-only check would have found nothing on
the page it was written for. So `landing.install.url`, every card and card-link
`url` / `href`, the markdown links inside the prose fields (`lead`, `closing`,
`install.intro`, `install.note`, a card's `description`, a link's `note`) and the
body's own markdown links are all read.

**`url` and `href` are not the same address.** The theme resolves a `url`
against the site with `relURL`, so a package writes `kb/rules/` and is served
`/sohl/kb/rules/` without naming its own prefix; an `href` is an address that is
_already_ resolved and is used verbatim, which is what `cards.source: sections`
fills in. A leading `/` is therefore a defect in a `url` — Hugo prefixes it a
second time — and correct in an `href`, so the two are not checked the same way.

**What is reported**, each finding naming the form to write instead:

| Finding                      | Why                                                                        |
| ---------------------------- | -------------------------------------------------------------------------- |
| A **retired content type**   | `kb/creature/` after `creature` became `being` — the engine knows.         |
| A **hardcoded absolute URL** | Into this package's own prefix, or into one a vendored manifest names.     |
| A **root-relative `url:`**   | `relURL` prefixes it again. `href:` is exempt — verbatim is what it means. |
| A **wikilink**               | Nothing resolves one here: a homepage is published verbatim in every mode. |

That last one settles a question rather than deferring it. A homepage does
**not** get the wikilink resolution every other note body gets, because in
`homepage` mode the content tree is never walked — there is no index for a
wikilink to resolve against, and giving the page one would make the mode depend
on exactly the machinery its licensing fence exists to not build. A wikilink on
a landing is therefore reported, not resolved.

**What is deliberately not attempted.** Whether an external URL answers: there is
no network at build time and a build must not go red because a third party is
down. And whether a live in-site address names a page that exists: several
surfaces a landing routes to are produced by other tools entirely — generated API
documentation, hand-authored Hugo sections — so this build does not hold the set
of published pages and would report a working link as dead. A bare
`https://www.heroiclands.org/<package>/` is left alone for the same reason it
cannot be improved: a package homepage is in no link manifest, so there is no
better form to write.

**Minor rather than major, measured rather than assumed.** A new lint error that
fails a previously-passing consumer would be breaking. All six HeroicLands
content packages were run against it — `sohl`, `hm3`, `thalorna`, `kethira`,
`harnensemble`, `harnadventures`, including the two homepages that exist only in
open pull requests — and every one is clean; the four whose trees are checked out
in full pass `links` end to end. Run against SoHL's landing as it stood _before_
the port, the check reports both dead links, at their line and column.

It rides in the existing pass rather than beside it: no new command, no second
walk, and a consumer that already runs `content-build links` gets it with no
change.
