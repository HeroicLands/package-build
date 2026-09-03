---
"@heroiclands/package-build": major
---

**The package homepage becomes an ordinary addressed note** (#182).

A homepage declares a `shortcode` — conventionally `root` — and publishes at
its address, `/<package>/homepage-root/`, written by the same rule as every
other page. `[[homepage-root|Read the introduction]]` is an ordinary wikilink
now, resolving to the page the build actually writes.

**Why it was the exception, and why it is not one any more.** A page's URL used
to derive from `name.full` while a homepage's destination was fixed at
`_index.md`, so a `shortcode` on one put the note in the address index and
`[[homepage-<shortcode>]]` resolved _green_ to a page nothing wrote. That is
what `HOMEPAGE_REFUSED_FIELDS` refused, and the reason was entirely an artifact
of name-derived URLs. #181 removed the premise: the address a `shortcode`
computes is the address the build publishes.

**Breaking, two ways.**

- **Every homepage note must now declare a `shortcode`.** Without one the note
  has no address, and both `content-build lint` and `content-build site` refuse
  it, located at the `type:` value that makes it necessary. All six trees need
  the same one-line edit: `shortcode: root`.
- **The landing moves** from `/<package>/` to `/<package>/homepage-root/`.
  `/<package>/` becomes a `301` the package authors in its own `_redirects`,
  with a pinned `Cache-Control: max-age=3600` in `_headers` — Cloudflare Pages
  sets no `Cache-Control` on a redirect it generates, and an unpinned 301 is
  cacheable indefinitely under RFC 9111. See `CONTENT.md`.

| Field       | Was     | Now                                          |
| ----------- | ------- | -------------------------------------------- |
| `shortcode` | refused | **required**                                 |
| `name`      | refused | permitted, like any other note's             |
| `id`        | refused | refused — a homepage compiles to no document |

`id` is unaffected because its reason is: a homepage appears in no pack, and it
stays out of the **link manifest** for the same reason, now that a shortcode
alone would put it in.

**What is deleted.** `HOMEPAGE_DESTINATION`, and the comment describing the
homepage as "the one page for which neither addressing rule holds" — it no
longer is. `homepageDestination(fm)` replaces the constant, and
`homepageFrontmatter` takes a `base` so the emitted page can state its `url`.

**Singularity is now stated as a cardinality rule.** It used to rest on the
fixed destination every homepage shared — the second silently overwrote the
first — so the address rule enforced it as a side effect. Two homepages publish
two pages now and collide over nothing, so `checkHomepageCount` says what it
means: a package has one front page, and nothing here can decide which of two
`/<package>/` should redirect to.
