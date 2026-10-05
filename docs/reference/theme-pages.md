---
shortcode: referencethemepages
name: { full: "What the theme draws" }
type: doc
subType: reference
---

# What the theme draws

`package-build site` writes a page's front matter; the shared Hugo theme reads
it and draws the page around it. This reference describes that second half —
the infobox rail, the hero band, the holdings and related cards, the place
map, search, and the markup an image or a figure renders as — and names the
classes a consumer styles against.

**None of the sections below is an authoring instruction.** `infoboxes`,
`related`, `contains`, `held_by`, `holdings`, `map`, `package`, `slug`, `url`
and `title` cannot be written by a note at all: a note's top-level region is
closed and does not admit them, so each arrives already resolved by the time
the theme sees it. Read this page when a panel is missing or a class needs
styling. [Frontmatter](../authoring/frontmatter.md) and the
[note-type reference](note-types.md) describe what a note itself carries;
[what an emitted page carries](../guides/site.md#what-an-emitted-page-carries)
describes the keys the build writes from it.

## The infobox

A place’s Government row links to its authored governing affiliation. Explicit `data.government: null` produces a text row saying “Complete anarchy”; an omitted government produces no row. The same distinction is retained in the page’s `data` metadata.

The toolchain settles what each box holds and in what order — see
[the infobox](format-details.md#the-infobox) for the field semantics, the
three states a system box can say, and the four section layouts a box is
built from. On the website, `partials/infobox.html` draws the whole list by
switching on a section's `layout` and a value's `kind`, never on a note type
or a field name:

```yaml
---
infoboxes:
  - id: note
    kind: note
    title: Profile
    sections:
      - id: profile
        layout: rows
        rows:
          - label: Name
            kind: text
            value: Brànwâal Dôrgaar
          - label: Affiliations
            kind: links
            value:
              - text: The Silent Talon Company
                url: /thalorna/affiliation-slntlncmpny/
  - id: sohl
    kind: system
    system: sohl
    title: SoHL
    available: true
    sections:
      - id: attributes
        label: Attributes
        layout: grid
        cells:
          - label: STR
            value: 14
  - id: hm3
    kind: system
    system: hm3
    title: HM3
    available: false
    sections: []
---
```

Each layout draws under its own class:

| `layout` | drawn as                                      |
| -------- | --------------------------------------------- |
| `rows`   | `.info-profile-grid`                          |
| `grid`   | `.info-attrs-grid` / `.info-attr`             |
| `runin`  | `.info-skill-line` / `.skill-cat`             |
| `list`   | `.info-mystical-list` / `.info-mystical-item` |

A `link` value renders as an anchor where the build reached the page, and as
its own words where it did not; a whole `number` is set with digit grouping.

**How the boxes are drawn.**

- Each box is a `<details>` disclosure, **open by default** — native,
  accessible, no JavaScript. Closed, a box is one summary line, which is what
  lets a note box and one box per system stack without burying the prose.
- The boxes sit in a **rail on wide screens and inline on narrow ones**. The
  rail is written first in the markup, because the infobox is content
  prepended before the prose: when the grid collapses, the boxes land above
  the text they summarise.
- A page carrying boxes takes the `.single-with-sidebar` grid, and its
  contents list — where it has more than three `<h2>`s — joins the foot of the
  same rail. A page with a contents list and no boxes takes `.single-with-toc`
  and its narrower column, exactly as before.
- **A box carries no image.** A picture is authored in the page body, where
  its position in the prose governs what follows it.
- A system box with nothing to show carries a `statement`, drawn in place of
  its sections — see
  [the three states of a system box](format-details.md#the-three-states-of-a-system-box)
  for which one applies and why.

A page whose front matter declares no `infoboxes:` renders no rail.

## The hero banner

Nearly every page opens with a hero band, and `partials/hero-banner.html`
decides what sits behind it. A page arrives with its hero image stated in one
of two ways, and the difference is who resolved it: a content page carries
`data.banner`, which the build resolved from the asset Address the note
declared into the address its asset host serves; a hand-authored page carries
a top-level `banner:`, which the theme resolves against `params.cdnBaseURL`
(see [`params.cdnBaseURL`](../configuration.md#what-a-consumer-must-supply)).

**Resolution order.**

1. `data.banner` — a note's own hero image, used exactly as given, because the
   build resolved it against a real asset record and dropped one nothing
   answered. A blank is a note naming no hero image on purpose and declines
   one; an unset or `null` value carries on to the next step.
2. `banner:` at the top level. `none` (or `false`) declines a hero image; a
   full URL is used as-is; anything else is a fragment under `images/`.
3. `images/banners/{subtype}.webp`, where the subtype is the page's `category`
   for a `type: doc` page and its `type` otherwise.
4. `images/banners/default.webp` — when the page has no type, **and** whenever
   the name picked by 2 or 3 is not in the declared inventory.

**Why step 4 is a declaration, not a test.** Hugo cannot ask a remote host
whether a URL exists, so a banner that was never drawn would 404 in silence —
the band renders with its title, palette and gradient intact behind a dead URL,
and nothing fails: not the build, not Hugo, not the deploy guard.
`data/banners.yaml` is the declaration that stands in for the test the
template cannot make. A name listed in its `available` is asserted to exist; a
resolved name that is absent falls back to `fallback`, and Hugo logs one
deduplicated warning naming the missing banner and the first page that wanted
it. The fallback applies only to a relative path landing directly in the
declared `dir` — an absolute URL, and a fragment pointing anywhere else under
`images/`, pass through untouched, because the theme has no inventory for
either and must not second-guess an address it cannot know about. A step 1
address is not checked for the same reason: the question has already been
answered upstream.

**One resolver.** The order above lives in `partials/banner-url.html`, which
returns a URL or an empty string; `hero-banner.html` calls it with the page's
subtype, for step 2.

**Keeping the inventory honest.** The lint check over `data/banners.yaml`
fetches every declared name from the asset host and fails on any non-200
response, so a name added optimistically is caught here rather than on a
published page. A consumer publishing its own artwork set replaces the whole
list by shipping its own `data/banners.yaml`, which Hugo reads in preference
to the theme's bundled one, and can run the same check against it.

**Declining a hero image.** `banner: none` on a hand-authored page, and a
blank `data.banner` on a note, render the band with no image at all — the
title, the palette and the `.hero-with-image` gradient, which is what gives
the band its presence. A package may have a standing editorial reason to
publish no imagery, and falling back to a default for those would substitute
artwork where the considered answer was "none". See
[images, icons, audio, and provenance](../authoring/assets.md) for how a note
declines one; the spelling differs from the hand-authored page's, and the two
are not interchangeable.

## The holdings card

`partials/holdings.html` renders a bordered card below the body and above the
Related card, holding up to three small tables. The build derives this front
matter from what every _other_ page says, so the three keys are refused in a
note and dropped if one carries them:

```yaml
---
contains: [{ title: …, url: …, type: place, subType: … }] # places within this one
held_by: [{ title: …, url: …, type: affiliation, subType: … }] # affiliations holding this place
holdings: [{ title: …, url: …, type: place, subType: … }] # places this affiliation holds
---
```

A place page carries `contains` and/or `held_by`; an affiliation page carries
`holdings`. Each key is tested for independently — a page carrying none of the
three renders no card, and a page carrying one renders one table.

**`url` is absent for an entry with no page of its own** — a stub note with an
empty body, which still appears in the lists of the pages that name it. Such
an entry's title renders as plain text; every other entry renders as a link.
`partials/holdings/entry.html` carries the guard, the same one
`partials/infobox/entry.html` already applies to its own `{text, url}` shape.

**Within** (`contains`) and **Holdings** (`holdings`) list places, and each is
broken into groups by `subType`, in the closed order region, settlement, site,
structure, feature — a `subType` outside that order, or missing entirely,
groups last, alphabetically by its rendered label. **Held by** (`held_by`)
lists affiliations, whose kinds have no fixed hierarchy to group by, so it
stays one flat grid with the kind printed beside each name.

Every grid is `repeat(auto-fill, minmax(14em, 1fr))`, the one the Related card
uses, so a region with forty settlements stays scannable.

| class                   | drawn as                                                             |
| ----------------------- | -------------------------------------------------------------------- |
| `.holdings`             | the card                                                             |
| `.holdings-table`       | one of the three tables, label and body together                     |
| `.holdings-table-label` | "Within" / "Held by" / "Holdings"                                    |
| `.holdings-table-grid`  | the grid of entries (Held by; the innermost grid of Within/Holdings) |
| `.holdings-kind-group`  | one kind's block within Within or Holdings                           |
| `.holdings-kind-label`  | the kind label heading a group                                       |
| `.holdings-entry-name`  | an entry's title, linked or plain                                    |
| `.holdings-entry-kind`  | the kind printed beside a Held by entry                              |

A page whose front matter declares none of `contains`, `held_by` or
`holdings` renders no card at all.

## The place map

A place page with `map: from-<shortcode>.svg` displays a **From here** panel
between Holdings and Related. The map is a page-bundle SVG the build draws
from the place's authored borders and routes, and `map:` is not a key a note
may write. Its place names link to their pages. A page with no `map` value or
no matching bundle resource displays no panel.

The drawing fits the content column and scrolls horizontally when the
available width is narrow. The relevant classes are `.place-map`,
`.place-map-heading`, and `.place-map-drawing`.

## The related card

`partials/related.html` renders a bordered "Related" card below the body,
listing the pages connected to this one. The build emits this front matter on
every content page; what links to a page is a fact about every other page, so
an authored `related:` is refused and dropped:

```yaml
---
related:
  backlinks: [{ title: …, url: …, type: … }] # pages that link here
  mentions: [{ title: …, url: …, type: … }] # pages this page links to
---
```

Both directions are merged into a single pool, deduped by `url`, and grouped
by the referenced page's `type`. Each group is a labelled block, its entries a
CSS grid (`repeat(auto-fill, minmax(14em, 1fr))`) that reflows its own column
count from the available width with no media query — two or three columns on
a desktop, one on a phone. An entry is the linked page title.

| class                  | drawn as                                  |
| ---------------------- | ----------------------------------------- |
| `.related`             | the card                                  |
| `.related-heading`     | the "Related" heading                     |
| `.related-group`       | one type's block, label and grid together |
| `.related-group-label` | the type label heading a group            |
| `.related-group-grid`  | the grid of linked entries                |

A page whose `related` carries neither list, or whose two lists are both
empty, renders no card at all.

## Images in note prose

The content renderer emits a `figure.note-image` for a Markdown image that
stands in its own paragraph. An image with no `size:` uses its natural width,
bounded by the content column. `size: small`, `medium`, `large`, and
`xlarge` set maximum widths of 64, 128, 256, and 512 CSS pixels. `size:
full-width` fills the content column; `.full-width` gives the figure the same
column width. When `.full-width` and a bounded size appear together, the
image keeps its named width inside the full-width figure. The image height
follows its aspect ratio.

A picture's declared role carries a maximum of its own, so pictures of one
kind draw at one measure across every page. `portrait` and `emblem` take half
the content column; `banner`, `plate`, and `map` take the whole of it. Each
slot is a maximum rather than a target: the drawn width is the smaller of the
slot and what the file's own pixels support, so a picture is never stretched
past the size it was made at. A named `size:` or `.full-width` overrides a
role's slot outright, and a vector — which states no pixel count — draws at
the slot. On a narrow column every slot opens to the full measure. The role
vocabulary is the one the content toolchain declares, and a role added there
fails this theme's own check until the slot table gives it a maximum.

`float: top-left` and `bottom-left` wrap prose to the right; `top-right` and
`bottom-right` wrap it to the left. `float: center` centers the figure without
wrapping. On narrow screens, figures remain in document order without text
wrapping. An image's label is alternative text, carried on the image itself
for a reader who cannot see it, and is not drawn beneath the picture. See
[figures and numbered references](../authoring/links-and-markup.md#figures-and-numbered-references)
for how an author writes `size`, `float` and a role.

## A numbered figure

A leading caption wraps the next supported item in a referable block; `:@` also numbers it. The content build decides which from
the next item, counts each kind separately, and emits the block with
its label beneath whatever it holds:

```html
<div id="harbour-at-dusk" class="content-figure content-figure-figure">
  <figure class="note-image note-image-role-map">…</figure>
  <p class="content-figure-label">Figure 3: The harbour at dusk</p>
</div>
```

The kind is `code`, `table`, `figure`, `map`, `poem`, `prose` or `example`, labelled **Code**,
**Table**, **Figure**, **Map**, **Poem**, **Prose** and **Example**. Every kind is drawn alike — the
block carries the spacing, its contents add none of their own at the edges,
and the label reads as a caption rather than as another paragraph of the body
— so a kind added to the vocabulary arrives styled. A caption carrying an `id`
is a cross-reference target and takes the same scroll offset a heading does.

Caption classes are unrestricted. The built-in `border` class draws the block as a boxed aside. Unnumbered captions use the same wrapper and show caption text without a numbered label.

| class                    | drawn as                                   |
| ------------------------ | ------------------------------------------ |
| `.content-figure`        | the block                                  |
| `.content-figure-<kind>` | the kind, for a consumer wanting one apart |
| `.content-figure-label`  | the label, number and caption together     |
| `.border`                | the block as a boxed aside                 |

## Search

`params.search = true` renders a search box in the header; left unset (or
`false`), `partials/search.html` renders nothing. The box, and everything it
opens, is the theme's own — the index it reads is not.

**Where the index comes from.** `package-build site-root` writes a
[Pagefind](https://pagefind.app) index at `pagefind/` beside the rendered
pages, when `site.search` in `package-build.config.yaml` is left at its
default of `true` (see [`site.search`](../configuration.md#site) and
[`package-build site-root`](../commands.md#package-build-site-root)).
Pagefind's own UI — `pagefind-ui.js` and `pagefind-ui.css` — ships inside that
generated directory, so the theme carries no copy and is pinned to no
Pagefind version. Turning `params.search` on without `site.search` indexing
the site (or with it set `false`) shows an empty results box that never finds
anything — the two settings are independent, and a consumer sets both.

Both files are referenced the same way every other theme-bundled asset is —
`relURL`, the same resolution `"css/style.css" | relURL` uses in
`baseof.html` — so a package served under a prefix (`/thalorna/pagefind/…`)
finds its own index rather than another package's, and the theme carries no
address of its own.

**Why a header box and not a `/search/` page.** A site is its homepage and
its pages, with nothing generated between them — a results page would need a
consumer content file at that address, which the theme has no way to
conjure. Pagefind's own panel UI needs no page of its own: the header button
opens it in place.

**What is indexed.** `data-pagefind-body` on `.single-body` scopes indexing to
a page's prose; the theme's own chrome carries `data-pagefind-ignore` — the
header, the footer, the infobox rail, the table of contents, the Related
card, and the hero banner's title and tagline. `_default/single.html` also
tags every page with `data-pagefind-filter="type"` and
`data-pagefind-filter="package"`, read from the page's own `type` and
`package` front matter, so a search can be narrowed to one catalog or one
package without either value appearing in the page itself.

**Classes added:** `.site-search`, `.search-toggle`, `.search-panel`,
`.search-panel-inner`, and `.header-actions` (the header's nav/search/toggle
group). `.search-panel-inner` carries Pagefind's own `--pagefind-ui-*`
theming variables, set from the theme's own tokens so results match the
chrome around them.

## What a page, a homepage and a section landing carry

### A page

`_default/single.html` renders every page that is not the homepage: the hero,
the infobox rail, the body, any `related:` block, and prev/next links through
the page's own catalog.

**Emitted.** A note's page arrives with `title` (the note's name), `type`,
`subType`, `description` and `tags` already set, and `data.banner` resolved.
The form below is the hand-written one, which is what a blog post or a
curated landing carries: `title`, `date` and a top-level `banner:` are keys
the content build never writes, and a note's page therefore has no `date` and
no meta-line date at all.

```yaml
---
# A hand-written page. A note's page carries the emitted form instead.
title: Brànwâal Dôrgaar
type: being # the page's catalog — see "Prev/next" below
subType: character # a being's classification; shown as a plain label
banner: being/dorgaar.webp
date: 2024-03-01 # optional; shown in the page meta line
tags: [archetype, mercantyl] # optional; shown in the page meta line
---
```

- **`type`** is the page's catalog key, unless it is `doc` — prose rather than
  a catalog of its own — in which case the key is `subType` (what the build
  compiles from a note's classification) or, failing that, `category` (what a
  hand-mounted documentation tree carries). A page with no `type` has no
  catalog.
- **`date`**, **`tags`** — each optional and shown only when present, in a
  meta line above the body. A tag links to `tags/<tag>/`.
- **`subType`** — shown as a plain label for `type: being` pages. It does not
  create a tag or taxonomy term.

**The draft notice.** A page tagged `draft` states that its content is not
settled, at the head of the article — above the infobox rail and above the
prose, at every width. The tag is a state rather than a subject, so it is kept
out of the meta line's tag row and said here instead.

```html
<aside class="draft-notice">
  <i class="fa-solid fa-circle-exclamation draft-notice-icon" aria-hidden="true"></i>
  <p class="draft-notice-text"><strong class="draft-notice-label">Draft.</strong> <em>…</em></p>
</aside>
```

- **`params.notfound`** wording is separate; **`params.draftNotice`** replaces
  the draft sentence above. The default reads _This entry is unfinished. What
  it states may change, and nothing in it is settled._
- **`.draft-notice`**, **`.draft-notice-icon`**, **`.draft-notice-text`** and
  **`.draft-notice-label`** are the classes a consumer styles against.
- The mark is Font Awesome, which `baseof.html` already loads; the sentence
  reads on its own where it does not arrive.
- The sentence is an `em`: the label is the page's own voice naming the
  state, and the sentence is the page speaking about itself.
- A page carrying the notice also carries **`.single-with-notice`** on its
  article, which is what moves a two-column page's content and rail below it.

**Prev/next.** `.PrevInSection` / `.NextInSection` walk every page under the
site's content mount, since the build emits every note flat there rather than
filing it into a directory named for its catalog. A mount holding more than
one catalog narrows the walk to the pages sharing this page's catalog key, so
reading through the afflictions does not surface a skill; a mount holding a
single catalog is untouched, because `.PrevInSection` already walks exactly
that catalog there.

### The homepage

A package's home page is `content/_index.md`, mounted at the package's own
prefix. `layouts/index.html` selects between two shapes by what it carries.

**`type: homepage`** renders the page through the same structure a note gets
from `_default/single.html` — the hero from its `banner:`, then its body —
sharing the markup through `partials/page-body.html` so a homepage and a page
read as one family:

```yaml
---
type: homepage
title: Song of Heroic Lands # hero heading
description: A classless, skill-based fantasy system … # hero standfirst

# The hero image. The same `banner:` every other page in this theme uses,
# resolved by `partials/hero-banner.html` in the documented order and through
# `params.cdnBaseURL` — see "The hero banner" above. With none set, the
# subtype default lands on `images/banners/homepage.webp`, since the subtype
# default is keyed on the page's `type`. `banner: none` declines a hero image
# entirely.
banner: brand/sohl-banner.webp
---
Everything published for the system lives under this address …
```

The home page declares no `infoboxes:`, `related:`, `date:` or `tags:`, so
those pieces of a page stay silent.

**No `type` at all** — a site whose home page is a set of entry points into
everything it publishes — renders the featured grid documented under
[`params.home`](../configuration.md#what-a-consumer-must-supply).

### A section landing

**Hand-written.** `_default/list.html` renders whatever a consumer still
gives Hugo's `section`, `taxonomy` or `term` kinds to render — a
hand-curated landing at a real subdirectory, and Hugo's own tag pages. A
`package-build` site disables all three (`disableKinds`), so this layout
never runs for one; a site that keeps them enabled still needs a landing, and
this is it.

It opens with the hero and any authored body, then auto-lists the section's
members (`.Pages`) as a gap-filler: a member the body already links,
directly or transitively, is not repeated, and the rest appear under
"Orphaned Pages" when the body links some of them, or plainly when it links
none. A tag's term page lists the pages carrying it; the tag index itself
lists every tag with its page count.

```yaml
---
# content/projects/_index.md — a hand-curated landing, no `type:` at all
title: Projects
description: Foundry VTT systems, modules, and reference content …
---
Each section below has its own landing page.

# [Song of Heroic Lands](/projects/song-of-heroic-lands/)
…
```

A row is a linked title and, when the page carries one, its description.

## Alerts

The content renderer emits an `aside` with `alert` and `alert-note`, `alert-tip`, `alert-important`, `alert-warning` classes. The `alert-title` header contains a Font Awesome icon and the type's label. Shared styles supply a colored left rule, colored header and ordinary readable body; alerts do not use `details` and never start collapsed. Authored identifiers, additional classes and named attributes belong to the entire aside. Secret blocks retain their separate expandable presentation on the website.
