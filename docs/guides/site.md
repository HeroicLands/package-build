---
shortcode: guidessite
name: { full: "Build a content website" }
type: doc
subType: howto
---

# Build a content website

`package-build site` turns the package's content notes into a Hugo source
tree. Hugo renders that tree with the shared theme. The build reads the same
note addresses used by content indexes and links, so a page's URL follows the
note it publishes.

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

The site title goes into Hugo's generated configuration. `site.description`
is plain text for the page's metadata. `site.assets` is an absolute HTTP or
HTTPS host for imagery. `package.json` supplies the homepage URL; it must
agree with the content package's address. The
[configuration reference](../configuration.md#site) covers the other site
keys, including `base`, `packages`, `notfound`, and `hugo`.

`site.hugo` can add Hugo options the build does not derive. Keys the build
owns, such as `baseURL`, `title`, and the generated menu, are refused there.
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

The build writes no automatic section, type, tag, or listing pages between
the homepage and the authored pages. Hugo's section, taxonomy, term, and RSS
kinds are disabled for these sites. A package's navigation above individual
notes is therefore a set of authored pages, each choosing its own contents.

## Use links, relations, and maps

Wikilinks resolve through the address index. Each emitted page receives
derived `related` entries for its outgoing links and backlinks. Place pages
can receive `contains` from place parents and `governed_by` from their own explicit
`data.government`; affiliation pages can receive `governed_places` from resolved government references. These values
come from the content graph and should be read as generated page metadata.

Place relationships can also produce a map alongside the page. The page
links to that map as a local page resource; a place with no applicable
relationship has no map. Set `site.maps: false` to omit these drawings. The
[book guide](book.md) covers full-page maps in PDF, and the
[packs guide](packs.md) covers documents compiled for Foundry.

A package with a named `site.pass` can apply its own body transformation
before wikilinks resolve. The pass runs inside code-fence protection, so a
fenced example remains literal. `site.passOptions` supplies that named pass's
options. This is a package-specific extension point; keep the general note
format and link behavior in the [content format](../content-format.md).

## What an emitted page carries

A theme reads the front matter `package-build site` writes: the note's own
front matter, plus the values the build derives. Which is which matters,
because an authored value under a derived key is discarded.

The build always writes `title`, `slug`, `url`, `kbfolder`, `package` and
`infoboxes`. `title` is the note's name, `url` is the page's address, and
`slug` is that address's last segment. `package` names the package shipping the
note. `infoboxes` is assembled from the note's own fields, so no note authors
it and nothing in the note format accepts it.

The build writes `resolvedDates`, `related`, `contains`, `governed_by`, `governed_places`
and `map` only when it has something to write. A page with no links either way
carries no `related`, and a place with no drawing carries no `map`.

An authored `aliases`, `related`, `contains`, `governed_by`, `governed_places` or `map` is
dropped. Each states a fact about the whole tree rather than about one note, so
the build replaces whatever a note wrote.

Artwork addresses are rewritten in place under `data`. A page's `data.icon`,
`data.bgImage` and `data.banner` carry the URLs the site serves rather than the
addresses the note authored, and there are four cases to tell apart:

| The note writes              | The page carries |
| ---------------------------- | ---------------- |
| an address something answers | the resolved URL |
| an address nothing answers   | no key at all    |
| `null`                       | `null`           |
| `""`                         | `""`             |

An address nothing answers is deleted rather than written through, so an absent
key is the ordinary case for a theme to render nothing against, and no page
reaches a reader carrying a broken image source. The two empties are distinct
and both survive: `null` is a note naming no art, where a default may apply,
and `""` is a note refusing art, where no default may replace it.

The build writes these keys; [what the theme draws](../reference/theme-pages.md)
describes the panel each one feeds — the infobox, the hero band, the government
and related cards, the place map, and search.

## Build and serve

```bash
package-build deps fetch
package-build content-index
package-build site
hugo --source build/hugo
```

`package-build site` writes `build/hugo/hugo.toml` and its content mount
under `build/hugo/content/`. Hugo writes rendered pages under `build/site/`.
`package-build site-root` adds the root headers and search index after Hugo
runs. The output under `build/` is disposable; a site build replaces its
content mount so a deleted note cannot leave a page behind.

A package created by `package-build init` includes `npm run build:site` for
this sequence and `npm run serve:site` for a local Hugo server. The site
requires Hugo Extended and the shared theme in the project's dependencies.
