# Build a content website

`package-build site` turns the package's content notes into a Hugo source
tree. Hugo renders that tree with the shared theme. The build reads the same
note addresses used by content indexes and links, so a page's URL follows the
note it publishes.

The site has an authored homepage and, when `publish.site: content`, one page
for each publishable note. The [configuration reference](../configuration.md)
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

`publish.site` controls the rest of the site:

| Mode       | Pages                                   |
| ---------- | --------------------------------------- |
| `homepage` | The homepage only. This is the default. |
| `content`  | The homepage and the content pages.     |

The homepage-only mode does not walk and publish the note tree as web pages.
The content index is a separate build artifact and is still emitted by
`package-build content-index`.

## Configure the site frame

A site with content pages declares its publication mode, asset host, and
description. A documentation package can give the site its own title; a
Foundry package can use its manifest title:

```yaml
publish:
  site: content
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
can receive `contains` and `held_by` entries from place parents and
affiliation domains; affiliation pages can receive `holdings`. These values
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
