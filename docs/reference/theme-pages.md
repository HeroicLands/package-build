---
shortcode: referencethemepages
name: { full: "What the theme draws" }
type: doc
subType: reference
---

# What the theme draws

`package-build site build` settles a page's front matter and body; the shared
site theme draws the page around them. This reference describes that second
half —
the infobox rail, the hero band, the generated sections, the related card,
search, and the markup an image or a figure renders as — and names the
classes a consumer styles against.

**None of the sections below is an authoring instruction.** `infoboxes`,
`related`, `package`, `slug`, `url`
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
built from. On the website, the `infobox` partial draws the whole list by
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
          - label: Homes
            kind: links
            value:
              - text: Vylar
                url: /thalorna/place-vylar/
      - id: affiliations
        label: Affiliations
        layout: list
        entries:
          - lead: "Captain, Blade (4), of "
            text: The Silent Talon Company
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
An entry of a `runin` group or a `list` section is `{lead, text, url}`: `lead`,
where present, is plain text set before the link, so a membership line —
`Captain, Blade (4), of The Silent Talon Company` — links the body's name and
nothing else. A being's memberships arrive as a `list` section of their own,
one entry per membership, because a line already holds commas.

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

Nearly every page opens with a hero band, and the `hero-banner` partial
decides what sits behind it. A page arrives with its hero image stated in one
of two ways, and the difference is who resolved it: a content page carries
`data.banner`, which the build resolved from the asset Address the note
declared into the address its asset host serves; a hand-authored page carries
a top-level `banner:`, which the theme resolves against `params.cdnBaseURL`
(see [`params.cdnBaseURL`](../configuration.md#what-the-site-build-reads)).

**Resolution order.**

1. `data.banner` — a note's own hero image, used exactly as given, because the
   build resolved it against a real asset record and dropped one nothing
   answered. A blank is a note naming no hero image on purpose and declines
   one; an unset or `null` value carries on to the next step.
2. `banner:` at the top level. `none` (or `false`) declines a hero image; a
   full URL is used as-is; anything else is a fragment under `images/`.
3. `images/banners/{name}.webp`, where the name comes from the kind mapping
   described below: the banner the page's `type` and `subType` map to, or its
   `category` for a `type: doc` page.
4. `images/banners/default.webp` — when the page has no type, **and** whenever
   the name picked by 2 or 3 is not in the declared inventory.

**Why step 4 is a declaration, not a test.** The build cannot ask a remote
host whether a URL exists, so a banner that was never drawn would 404 in
silence — the band renders with its title, palette and gradient intact behind
a dead URL, and nothing fails: not the build, not the deploy guard.
`banners.yaml` is the declaration that stands in for the test the template
cannot make. A name listed in its `available` is asserted to exist; a resolved
name that is absent falls back to `fallback`, and the build reports one
deduplicated warning naming the missing banner and the first page that wanted
it. The fallback applies only to a relative path landing directly in the
declared `dir` — an absolute URL, and a fragment pointing anywhere else under
`images/`, pass through untouched, because the theme has no inventory for
either and must not second-guess an address it cannot know about. A step 1
address is not checked for the same reason: the question has already been
answered upstream.

**The kind mapping.** `banner-kinds.yaml` declares, once, which banner a
page of each note `type` opens with. A type maps to one banner name for all of
its subTypes, or to a table that names a banner for every subType the note
vocabulary declares for it:

```yaml
categoryTypes:
  - doc
kinds:
  skill: skills-attributes
  being:
    character: character
    creature: creature
    npc: character
```

`default` names the default banner as a deliberate choice, and emits no
warning. A type missing from the file resolves to its own name, so a kind with
no declared art still produces the missing-banner warning. The lint check and
the test suite fail on a mapped name that `banners.yaml` does not declare, and
on a type or subType of the note vocabulary that the mapping omits.

**One resolver.** The order above lives in one function of the engine, which
returns a URL or an empty string; the `hero-banner` partial is given the
result.

**Keeping the inventory honest.** The lint check over `banners.yaml` fetches
every declared name from the asset host and fails on any non-200 response, so
a name added optimistically is caught here rather than on a published page.

**Declining a hero image.** `banner: none` on a hand-authored page, and a
blank `data.banner` on a note (which the build emits for `data.banner: none`),
render the band with no image at all — the
title, the palette and the `.hero-with-image` gradient, which is what gives
the band its presence. A package may have a standing editorial reason to
publish no imagery, and falling back to a default for those would substitute
artwork where the considered answer was "none". See
[images, icons, audio, and provenance](../authoring/assets.md) for how a note
declines one with `data.banner: none`.

## Generated sections

The build appends sections to the end of a note's body before the page is
written: what lies within a place, who governs it and what an affiliation
governs, the events concerning the note, the works naming it, and the map
from a place. Each is an H1 with a fixed anchor followed by ordinary
Markdown, so the theme draws it as it draws any authored section — a heading
in the page, an entry in the table of contents — and no partial, class or
front-matter key is involved. The same Markdown is a page of the Foundry
journal and a section of the book.

They follow the author's text in this order, each only where it has
something to show:

| Section           | Anchor           | On                                                     | Shows                                                                                        |
| ----------------- | ---------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Within            | `within`         | a place                                                | the places whose `data.parents` names it, a paragraph to each kind of place                  |
| Governed by       | `governedby`     | a place                                                | the affiliation its `data.government` names, with that affiliation's kind                    |
| Governed places   | `governedplaces` | an affiliation                                         | the places whose `data.government` names it, a paragraph to each kind of place               |
| Chronology        | `chronology`     | a place                                                | the [event views](format-details.md#event-views)                                             |
| Events            | `events`         | a being, an affiliation or a people                    | the event views                                                                              |
| Accounts          | `accounts`       | an affiliation, a place or a people                    | the event views                                                                              |
| What followed     | `followed`       | a note holding events                                  | the event views                                                                              |
| In song and story | `insongandstory` | any note a work names                                  | the `literature` works whose `data.subjects` name the note or one of its events, with a form |
| From here         | `fromhere`       | a place that states, or is named in, a border or route | the map drawn from the place                                                                 |

An entry naming a note with a page links to it and shows the note's name; an
entry naming a stub, which publishes no page, is its name as plain text.

**The map is set inline.** The website places the drawing inside the **From
here** section as an SVG within a `figure.note-image.note-image-full-width`,
so its place names stay links to their pages. The drawing fits the content
column and scrolls sideways on a narrow screen. `site.maps: false` in the
configuration gives no place the section.

**An author's own section replaces a generated one.** A note whose body
declares a prose anchor with a section's slug — a heading such as
`# Within {#within}`, or a block or span with that `id` — gets no generated
section for it, and its own section is published exactly as written. This
is the way to choose different contents for one, or to turn one off.

## The related card

The `related` partial renders a bordered "Related" card below the body,
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
[captions and numbered references](../authoring/links-and-markup.md#captions-and-numbered-references)
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

## Verse

A `verse` fence reaches the page as `.verse`, with one `.verse-stanza` per
stanza and `.verse-line` per logical line. Indentation uses `i1` through `i8`;
deeper levels carry their complete `--verse-indent`. `.verse-canto-break`
separates cantos. A work-labelled fence adds `.verse-labelled`, and each stanza
opens with a small `.verse-label` shared across its presentations.

A concrete fence encoding adds `.verse-paired`. Each `.verse-row` aligns one
`.verse-native` cell with one `.verse-roman` cell at full weight. The script is
on the left; its direction applies within its cell. A narrow container stacks
the native presentation before the Roman presentation. An unencoded fence or
`enc=default` is one Roman column. See [versions of a work](../authoring/links-and-markup.md#versions-and-stanza-labels).

| Class                | Meaning                                        |
| -------------------- | ---------------------------------------------- |
| `.verse`             | A version of a work                            |
| `.verse-stanza`      | One stanza or prose paragraph                  |
| `.verse-line`        | One logical line                               |
| `.verse-labelled`    | A version carrying automatic stanza labels     |
| `.verse-label`       | The stanza number or canto:stanza label        |
| `.verse-paired`      | Script and Roman presentations of one original |
| `.verse-row`         | Matching logical lines in both presentations   |
| `.verse-native`      | Encoded text on the left                       |
| `.verse-roman`       | Roman text on the right                        |
| `.verse-canto-break` | A canto boundary                               |
| `.direction`         | An instruction, inside or outside verse        |
| `.speaker`           | A speaker label, inside or outside verse       |

Direction and speaker classes have plain defaults. The book preserves the same
classes through `book-span`, with plain `book-direction` and `book-speaker`
hooks for their presentation.

## Emphasis in a script

Emphasis inside a run set in a face stays an `<em>` or a `<strong>`, and its
class names the convention its language or script states (see
[script notes and emphasis](format-details.md#script-notes-and-emphasis)):

| class            | drawn as                      |
| ---------------- | ----------------------------- |
| `.emph-rubric`   | the text in `var(--rubric)`   |
| `.emph-overline` | the text with a line above it |

`.script em` and `.script strong` keep the face's Regular: no slant, no added
weight, and `font-synthesis: none`. A script whose notes state no convention
gives a bare `<em>` or `<strong>`, which therefore looks like the text around
it.

The theme's `--rubric` is `#e0705f`, a warm red for its dark ground. Because a
rubric carries emphasis by colour alone, it holds 4.5:1 against `--bg`,
`--bg-card` and `--surface`, and 1.75:1 against `--text`, so a reader who
cannot see its hue still sees a lighter or darker word. A site that overrides
`--rubric` keeps both. Foundry's base stylesheet sets the same classes from
`--pb-rubric`, `light-dark(#9c281b, #e0705f)`, against Foundry's journal page in
each theme, and the book prints its rubric in `#9c281b` on its paper.

## Search

`params.search = true` renders a search box in the header; left unset (or
`false`), the `search` partial renders nothing. The box, and everything it
opens, is the theme's own — the index it reads is not.

**Where the index comes from.** `package-build site build` writes a
[Pagefind](https://pagefind.app) index at `pagefind/` beside the rendered
pages, when `site.search` in `package-build.config.yaml` is left at its
default of `true` (see [`site.search`](../configuration.md#site) and
[`package-build site-root`](../commands.md#package-build-site-root)).
Pagefind's own UI — `pagefind-ui.js` and `pagefind-ui.css` — ships inside that
generated directory, so the theme carries no copy and is pinned to no
Pagefind version. Turning `params.search` on without `site.search` indexing
the site (or with it set `false`) shows an empty results box that never finds
anything — the two settings are independent, and a consumer sets both.

Both files are addressed relative to the site's base, so a package served
under a prefix (`/thalorna/pagefind/…`) finds its own index rather than
another package's, and the theme carries no address of its own.

**Why a header box and not a `/search/` page.** A site is its homepage and
its pages, with nothing generated between them — a results page would need a
note at that address. Pagefind's own panel UI needs no page of its own: the
header button opens it in place.

**What is indexed.** `data-pagefind-body` on a page's prose scopes indexing to
it; the theme's own chrome carries `data-pagefind-ignore` — the header, the
footer, the infobox rail, the table of contents, the Related card, and the
hero banner's title and tagline.

**What a page tells the search.** Each page carries hidden metadata the
search reads: its title, its filters, its aliases, its picture and, for a
post, its date.

| Filter      | Values                                       |
| ----------- | -------------------------------------------- |
| `package`   | the package that publishes the note          |
| `type`      | the note's `type`                            |
| `subtype`   | the note's `subType`                         |
| `culture`   | the name of the culture `data.culture` names |
| `continent` | the continent the note lies in               |
| `region`    | the outermost region beneath that continent  |

A post carries `author` and `tags` filters and sorts by its `date`. A note's
name and its aliases count ten times a word of its body, so a search for a name
opens that note first and a search for an alias finds it. A result shows the
note's `data.icon`, or its hero banner where it has none. A note's tags and its
draft state are not filters. Secret blocks, inline secrets and `.secret`
sections are kept out of the index. [The site guide](../guides/site.md#search)
says where a note lies and how a merged search reads other sites' indexes.

**Classes added:** `.site-search`, `.search-toggle`, `.search-panel`,
`.search-panel-inner`, and `.header-actions` (the header's nav/search/toggle
group). `.search-panel-inner` carries Pagefind's own `--pagefind-ui-*`
theming variables, set from the theme's own tokens so results match the
chrome around them.

## What a page, a homepage and a listing carry

### A page

The `page` layout draws every note that is not the homepage: the hero, the
infobox rail, the body, any `related:` block, and prev/next links through the
page's own catalog.

**Emitted.** A note's page arrives with `title` (the note's name), `type`,
`subType`, `description` and `tags` already set, and `data.banner` resolved.
The form below is the hand-written one, which is what a curated landing
carries: `title`, `date` and a top-level `banner:` are keys the content build
never writes, and a note's page therefore has no `date` and no meta-line date
at all.

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
  compiles from a note's classification) or, failing that, `category`. A page
  with no `type` has no catalog.
- **`date`**, **`tags`** — each optional and shown only when present, in a
  meta line above the body. A tag links to `tags/<tag>/` where the site writes
  a page for each tag (`site.tags`), and is plain text otherwise.
- **`subType`** — shown as a plain label for `type: being` pages. It does not
  create a tag.

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
- The mark is Font Awesome, which the base layout already loads; the sentence
  reads on its own where it does not arrive.
- The sentence is an `em`: the label is the page's own voice naming the
  state, and the sentence is the page speaking about itself.
- A page carrying the notice also carries **`.single-with-notice`** on its
  article, which is what moves a two-column page's content and rail below it.

**Prev/next.** The links walk the pages of the site in the order a reader
walks them. A site holding more than one catalog narrows the walk to the pages
sharing this page's catalog key, so reading through the afflictions does not
surface a skill; a site holding a single catalog is untouched.

### A post

A note of `type: doc` and `subType: post` is drawn by the `blog-post` layout:
the post's title, its date and writer, its series where it states one, its
tags, and its body. Posts are listed newest first on the page of the section
`site.feed` names, and the site writes an Atom feed beside that page.

### The homepage

A package's home page is the `type: homepage` note, drawn by the `home`
layout at the package root. The layout selects between two shapes by what the
page carries.

**`type: homepage`** renders the page through the same structure a note gets
from the `page` layout — the hero from its `banner:`, then its body —
sharing the markup through the `page-body` partial so a homepage and a page
read as one family:

```yaml
---
type: homepage
title: Song of Heroic Lands # hero heading
description: A classless, skill-based fantasy system … # hero standfirst

# The hero image. The same `banner:` every other page in this theme uses,
# resolved in the documented order and through `params.cdnBaseURL` — see "The
# hero banner" above. With none set, the subtype default lands on
# `images/banners/homepage.webp`, since the subtype default is keyed on the
# page's `type`. `banner: none` declines a hero image entirely.
banner: brand/sohl-banner.webp
---
Everything published for the system lives under this address …
```

The home page declares no `infoboxes:`, `related:`, `date:` or `tags:`, so
those pieces of a page stay silent.

**No `type` at all** — a site whose home page is a set of entry points into
everything it publishes — renders the featured grid from `params.home`: a hero
(`heroimage`, `herotitle`, `herotagline`), the section headings, and a card for
each entry of `cards`, each with a title, an address, a line of text and an
optional image.

### A listing

The `list` layout draws a page that lists other pages: a section a note
stands for (`site.sections`), and the tag pages `site.tags` writes. It opens
with the hero and any authored body, then lists the members the body does not
already link, directly or transitively, under a heading when the body links
some of them, or plainly when it links none. A tag's page lists the pages
carrying it; the tag index lists every tag with its page count. A row is a
linked title and, when the page carries one, its description.

## Alerts

The content renderer emits an `aside` with `alert` and `alert-note`, `alert-tip`, `alert-important`, `alert-warning` classes. The `alert-title` header contains a Font Awesome icon and the type's label. Shared styles supply a colored left rule, colored header, tinted background and readable body text. The website uses the dark palette; Foundry selects a light or dark palette from its color scheme. Alerts do not use `details` and never start collapsed. Authored identifiers, additional classes and named attributes belong to the entire aside. Secret blocks retain their separate expandable presentation on the website.
