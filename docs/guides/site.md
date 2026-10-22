---
shortcode: guidessite
name: { full: "Build a content website" }
type: doc
subType: howto
---

# Build a content website

`package-build site build` renders the package's content notes as a website
with the shared theme. The build reads the same note addresses used by content
indexes and links, so a page's URL follows the note it publishes.

The site has an authored homepage and one page for each other publishable note
in the content tree. The [configuration reference](../configuration.md)
defines the site settings; the [command reference](../commands.md) lists the
build actions and options.

## Author the homepage

Every content package needs exactly one note with `type: homepage`. Its
`shortcode` makes it linkable from another note, while the site serves its
body at the package root:

```markdown
---
shortcode: root
name: { full: The Setting Guide }
type: homepage
---

# The Setting Guide

Start with [Introduction](doc-introduction/).
```

The homepage's body is published as Markdown. Write ordinary Markdown links
there, with addresses relative to the package root. Another note can refer to
it with `[[homepage-root|The Setting Guide]]`. The homepage creates no
Foundry compendium document and has no document ID. Its filename does not
decide its role; the frontmatter does.

The content tree controls the rest of the site. A tree containing only its
homepage publishes that page alone. Each additional publishable note becomes
its own page. The content index is a separate build artifact emitted by
`package-build content-index`.

Remove `publish.site` from package configurations. The presence of content
notes determines whether the site and book contain pages beyond the homepage.

## Configure the site frame

A site with content pages declares its asset host and description. A
documentation package can give the site its own title; a
Foundry package can use its manifest title:

```yaml
site:
  title: The Setting Guide
  assets: https://cdn.heroiclands.org
  description: A guide to the setting and its people.
```

The site title is the title of every page. `site.description`
is plain text for the page's metadata. `site.assets` is an absolute HTTP or
HTTPS host for imagery. `package.json` supplies the homepage URL; it must
agree with the content package's address. The
[configuration reference](../configuration.md#site) covers the other site
keys, including `base`, `packages`, and `notfound`.

The menu comes from the navigation fetched by `package-build deps fetch`.
The site build reads that cached navigation and reports a missing cache.

## Make entry pages and indexes

Each content note publishes one page at its Address-derived path. A `doc`
note can serve as a reader-facing index, with links and a SQL content table
over the notes it introduces:

````markdown
---
shortcode: beings
name: { full: Beings }
type: doc
subType: concept
data: { pack: none }
---

# Beings

People and creatures of the setting.

```sql
SELECT address.slug AS _ref, name.full AS "Name"
FROM notes
WHERE type = 'being'
ORDER BY name.full
```
````

Link that page from the homepage. `data.pack: none` keeps this journal-only
note out of Foundry compendiums while leaving its web page and content-index
record available. A SQL fence queries the content index; the
[content format](../content-format.md) defines its result columns and fence
options.

The build writes no automatic type or listing pages between the homepage and
the authored pages: a package's navigation above individual notes is a set of
authored pages, each choosing its own contents. A site writes tag pages only
with `site.tags`, and section pages only for the sections `site.sections` and
`site.feed` name.

## Write a blog

A blog is a section of posts. A post is a `doc` note of `subType: post`, which
states the day it was published and may name who wrote it; its `tags` are the
ones any note carries:

```markdown
---
type: doc
subType: post
shortcode: welcome
name: { full: Welcome to Heroic Lands }
description: A first post, and a short note on what this blog is for.
tags: [meta, announcements]
data:
  date: 2026-04-15
  author: Tom Rodriguez
---

The first post.
```

A post that names no `data.author` carries the site's byline, the first entry
of `authors`. `site.feed` names the section the posts are published in, and
`site.sections` can give that section a page of its own, a `doc` note whose
title and body introduce the list:

```yaml
site:
  sections:
    blog: doc-blog
  feed: blog
  tags: true
```

The section's page at `/blog/` lists every post newest first, and
`/blog/atom.xml` feeds them. A post publishes at its own address,
`/doc-welcome/`, like any note, and a link to `doc-blog` reaches `/blog/`. With
`site.tags`, each tag a page carries links to a page listing every page that
carries it. See [where a site is served, and what it
lists](../configuration.md#where-a-site-is-served-and-what-it-lists) for every
key.

## Use links, relations, and maps

Wikilinks resolve through the address index. Each emitted page receives
derived `related` entries for the links its author wrote and the backlinks
other authors wrote to it.

A wikilink to a GM-only note or secret heading conceals its whole reference in
an inline show/hide spoiler. `.show` reveals the reference without changing the
destination's audience. GM-only pages remain omitted, so references to them
have no link; published secret sections retain theirs. Spoiler text remains in
the generated HTML and is readable in page source. See
[secret references](../authoring/links-and-markup.md#references-to-secret-subjects).

What lies within a place, who governs it, what an affiliation governs, the
works naming a note and the map from a place reach the page as
[generated sections](../reference/format-details.md#generated-sections): H1
sections after the author's text, the same Markdown the Foundry journal and
the book receive. The map from a place is set inline in its **From here**
section, so its place names link to their pages; set `site.maps: false` to
draw none. The [book guide](book.md) covers the book, and the
[packs guide](packs.md) covers documents compiled for Foundry.

A package with a named `site.pass` can apply its own body transformation
before wikilinks resolve. The pass runs inside code-fence protection, so a
fenced example remains literal. `site.passOptions` supplies that named pass's
options. This is a package-specific extension point; keep the general note
format and link behavior in the [content format](../content-format.md).

## What an emitted page carries

A page is drawn from its front matter: the note's own
front matter, plus the values the build derives. Which is which matters,
because an authored value under a derived key is discarded.

The build always writes `title`, `slug`, `url`, `kbfolder`, `package` and
`infoboxes`. `title` is the note's name, `url` is the page's address, and
`slug` is that address's last segment. `package` names the package shipping the
note. `infoboxes` is assembled from the note's own fields, so no note authors
it and nothing in the note format accepts it.

The build writes `resolvedDates` and `related` only when it has something to
write. A page with no links either way carries no `related`.

An authored `aliases` or `related` is dropped. Each states a fact about the whole
tree rather than about one note, so the build replaces whatever a note wrote.

Artwork addresses are rewritten in place under `data`. A page's `data.icon`,
`data.tokenIcon` and `data.banner` carry the URLs the site serves rather than the
addresses the note authored, and there are five cases to tell apart:

| The note writes              | The page carries |
| ---------------------------- | ---------------- |
| an address something answers | the resolved URL |
| an address nothing answers   | no key at all    |
| `null`                       | `null`           |
| `""`                         | `""`             |
| `data.banner: none`          | `""`             |

An address nothing answers is deleted rather than written through, so an absent
key is the ordinary case for a theme to render nothing against, and no page
reaches a reader carrying a broken image source. The two empties are distinct
and both survive: `null` is a note naming no art, where a default may apply,
and `""` is a note refusing art, where no default may replace it. A note
writes `none` to refuse a hero image, since `""` is an error in authored
frontmatter.

The build writes these keys; [what the theme draws](../reference/theme-pages.md)
describes the panel each one feeds — the infobox, the hero band, the related
card, and search — and the generated sections the theme draws as any other.

## Decide which pages a reader finds

Every note is written as a page, linked or not, and a page is served at its
address. What a reader can find is what the homepage leads to: the sitemap and
the site search cover the pages reachable from the homepage, directly or
through the pages it links, and no others.

Reachability is read from the links the rendered pages carry, never from the
notes' sources. A page is reachable when an authored link leads to it:

- a link in the homepage or in the body of a reachable note, including the
  links a `pagelist` or a `sql` table writes into the body;
- a link in the menu or the rest of the site chrome;
- a link in a listing: the pages of a section page, a tag page, and the posts
  an Atom feed lists, once a reachable page links the section, the tag or the
  feed. A tag chip on a reachable page links its tag page when `site.tags` is
  on, so every page carrying the tag is then reachable.

The links the build generates do not make a page reachable. These are the
Related card, the previous and next links, the infobox links, and the sections
generated after a note's text (Within, Governed by, Governed places,
Chronology, Events, Accounts, What followed, In song and story). Each is drawn
without a link to a page outside the reachable set, and a section left with
nothing under it is not drawn. An infobox value that names an unreachable page
is set as plain text. So is a link in a dictionary or glossary entry, whether
it names a word's entry, cites a note or sits in a gloss; it does not make its
target reachable. A link written in prose or produced by a query is kept
wherever it points, and it is what makes its target reachable.

A page that is not reachable is the way to preview a page in place. Write the
note, build the site, and read the page at its address on the live site; link
it from the homepage or from a linked page when it is ready to publish. For a
note `doc-charlie` in the package `setting`:

1. Add `doc-charlie` to the content tree. It is written at
   `/setting/doc-charlie/` and appears in neither the sitemap nor the search.
2. Read it at `/setting/doc-charlie/`.
3. Link it, for example `[[doc-charlie|Charlie]]` in a linked note, to publish
   it. The next build lists it in the sitemap and the search.

An address is a short code and the site serves no directory listing, so an
unlinked page is found only by someone who knows its address. The content
index that `package-build content-index` writes is a release asset and is not
part of the site.

## Show marked text in its font

A site shows text marked with `font=` and one of the faces of
`@heroiclands/fonts` in that face once the package installs the fonts package
in `devDependencies`, as the
[authoring guide](../authoring/links-and-markup.md#marking-language-font-and-mapping)
describes. Nothing else is configured: the build reads which faces the notes use
from their `font=` keys.

`package-build site build` copies the font stylesheet, the WOFF2 files and the
licence to a path that names the fonts package's version,
`fonts/heroiclands/<version>/` beside the pages, and the theme links the
stylesheet from every page. The copied stylesheet lists only the WOFF2
sources, since the TrueType files are not copied. `package-build site-root` gives that path a
one-year, immutable cache lifetime in `_headers`. A package that has not
installed the fonts, or whose notes set no text in a face, ships no font files
and its pages carry no link. `font=serif`, `sans` and `mono` need no fonts
package.

## Build and serve

```bash
package-build deps fetch
package-build content-index
package-build site build
```

`package-build site build` renders every page and writes the site under
`build/site/<contentPackage>/`: the pages, `404.html`, `sitemap.xml`, the
theme's files and the script fonts, then `_headers` beside it and the search
index inside it. Nothing else renders the pages: the body of each is the same
HTML the Foundry journals and the editor preview read, drawn into the site
theme's layouts and minified.

```bash
package-build site serve
```

`package-build site serve` builds the site the same way and serves it at
`http://127.0.0.1:1313/<contentPackage>/`. Edit a note and its page is written
again and the browser reloads; edit the theme and every page is drawn again.
A change that moves, renames or adds a note builds the whole site again. See
[`site serve`](../commands.md#package-build-site-serve) for the whole table.

A package created by `package-build init` includes `npm run build:site` for
`site build` and `npm run serve:site` for `site serve`, each preceded by the
dependency and content-index steps. Neither needs anything installed beyond
the project's dependencies.

## Search

A site whose `site.search` is left on carries a search box in its header and a
[Pagefind](https://pagefind.app) index beside its pages. A search can be
narrowed by what each page tells it:

| Filter      | Values                                       |
| ----------- | -------------------------------------------- |
| `package`   | the package that publishes the note          |
| `type`      | the note's `type`                            |
| `subtype`   | the note's `subType`                         |
| `culture`   | the name of the culture `data.culture` names |
| `continent` | the continent the note lies in               |
| `region`    | the outermost region beneath that continent  |

A place lies where its `parents` lead, a being where its `data.homes` are, and
a scenario where its `data.locations` are. A continent is a `place/region`
whose parent is the world, and the region a note is found under is the region
directly beneath its continent, however deep the note sits: a settlement in a
valley in a march is found under the march. A note that lies in more than one
place carries every continent and region it reaches, so a being with a home in
each of two regions is found under both.

A note's name and its aliases count ten times a word of its body, so a search
for a name opens that note first and a search for an alias finds it. A result
shows the note's `data.icon`, or its hero banner where it has none. A note's
tags and its draft state are not filters. Secret blocks, inline secrets and
`.secret` sections are kept out of the index.

A post carries `author` and `tags` filters and sorts by its `date`. A site's
search can read other sites' indexes beside its own: given each package site in
[`site.mergeIndexes`](../configuration.md#where-a-site-is-served-and-what-it-lists),
the search box finds every site's pages from one box. Each index is read from
`/<package>/pagefind/` on the site's own origin, so the merged search works
where the sites share an origin and finds only the site's own pages under
`package-build site serve`.
