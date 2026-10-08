---
shortcode: guidesreferencepages
name: { full: "Reference pages and content indexes" }
type: doc
subType: howto
---

# Reference pages and content indexes

A reference page gives readers an entry point into a group of notes. Author it
as a normal content note, so it has a stable Address, can link to its subjects,
and can be selected for the site or book. The JSON Lines content index serves a
different reader: build passes and tools use it to find notes, assets, names,
relationships, and generated document destinations.

The [content format](../content-format.md) defines note types, Address fields,
and links. The [command reference](../commands.md) gives the index and generated
page commands; [configuration](../configuration.md) defines their paths.

## Author an entry page

Use `type: doc` and `subType: reference` for an out-of-world lookup page. A
page introducing a content type conventionally uses that type as its
shortcode. Its body supplies the explanation, links, and any SQL tables a
reader needs:

````markdown
---
shortcode: affiliation
name: { full: Affiliations }
type: doc
subType: reference
data: { pack: none }
---

# Affiliations

Affiliations describe the groups a person belongs to and the offices they may
hold. Start with [[affiliation-watch|The Watch]] for a local example.

```sql
SELECT address.slug AS _ref, name.full AS "Name"
FROM notes
WHERE type = 'affiliation'
```
````

Where the page introduces a _group_ rather than a type, a `pagelist` fence
states the group by its tag and lists the pages carrying it:

````markdown
```pagelist {tag="key-concept" descriptions=true}

```
````

That keeps the entry page true as notes are written: a page joins the list by
carrying the tag, so nobody has to remember to add it here. A tag no page
carries is a build error naming the tag. See
[page lists](../authoring/links-and-markup.md#page-lists) for the attributes it
takes.

`data.pack: none` is appropriate when the page belongs on the site and in the
index but does not need a Foundry compendium entry. A documentation package
has no packs at all. A page with an empty body is a stub: it remains in the
index for data references, but publishes no page address or anchors. Write a
description for a stub and leave off the `draft` tag; use `draft` for a page
with prose still in progress. The [stub rules](../reference/format-details.md#a-stub-is-a-note-with-an-empty-body)
and [pack routing](packs.md) cover these cases.

## Link to the intended target

An Address identifies a package, system, type, and shortcode. In a normal
`[[link|label]]`, an omitted package means the current package and an omitted
system means `note`, the readable content. For example,
`[[affiliation-watch|The Watch]]` names the local readable note. An explicit
game system names an Actor or Item, and `none` names a systemless asset,
Scene, Macro, or Folder. A link to another package states all four segments:
`[[thalorna-note-affiliation-watch|The Watch]]`.

An image embed `![[image-watchcrest|Watch crest]]` defaults to system `none`.
Frontmatter Address fields take the defaults declared for their position; an
image field defaults to `none`, while most shared `data:` references default
to `note`. Use a complete Address in generated content and SQL comparisons:
`thalorna-note-affiliation-watch`, rather than its bare `watch` shortcode.
The [Address reference](../reference/format-details.md#addresses) lists the accepted
short forms and defaults.

## Generate a field reference from item builders

A package with Item builders can generate its Item frontmatter page from the
builder field declarations. Set `docs.itemFields` to give the page its title,
destination, and introductory prose:

```yaml
docs:
  itemFields:
    title: Item Fields
    out: assets/content/Reference/Item_Fields.md
    preamble:
      - These tables list the fields accepted by the configured Item builders.
```

```bash
package-build docs item-fields
package-build docs item-fields --check
```

When the output is under `paths.content`, the generator writes a complete
`doc/reference` note with a shortcode derived from the output filename, a
title in `name.full`, and `data.pack: none`. `docs.itemFields.frontmatter` can
add or override its envelope. Outside the content tree, the output is a
standalone Markdown page without note frontmatter. `--check` compares the
whole generated file with the committed copy and exits unsuccessfully when
they differ. A documentation package cannot declare Item builders or this
reference generator.

## Use the content index

Run the index command in a content package to produce
`build/content-index/<contentPackage>-metadata.jsonl`, or use the configured
`paths.contentIndex` directory:

```bash
package-build content-index
jq -r 'select(.type == "affiliation") | .name.full' \
  build/content-index/thalorna-metadata.jsonl
```

Each note record carries its authored frontmatter together with derived
`package`, `file`, `address`, `anchors`, and document destinations. It also has
ASCII-folded `nameAscii` and `aliasesAscii` for searching names typed without
diacritics. Asset files under `assets/icons`, `assets/images`, and
`assets/audio` have records in the same index, identified by an `asset` block.
The index is disposable build output; regenerate it from the authored tree
when the content changes.

The record's `address.canonical` is the full Address. Its `address.slug` is a
local web link target. Each entry of `anchors` carries its `slug`, `name`, `line`,
`link` and `kind` — `heading`, `caption`, `block`, `alert`, `poem`, `span` or
`event` — and a note's event `id`s are listed there beside its body anchors. A
dependency's events are resolved through this list and through each event's
resolved date under `resolvedDates.events`. A stub has `address: null` and `anchors: null`; its
frontmatter remains queryable. An Item or Actor note can have both a readable
`note` record and a game-system document destination. A generated
`documentation` pointer connects a system document to its readable note.
Consumers can use the index's own addresses and file paths rather than
reconstructing them from filenames.

## Resolve another package

In a Foundry package, declare a content-bearing dependency under
`relationships`, then fetch its published index before a build that links into
it:

```bash
package-build deps fetch
```

The fetch stores the versioned metadata in `paths.metadataCache`. A local
dependency build can be read with `package-build deps fetch --from <path>`.
The dependency's published manifest advertises its metadata URL. A build
reports a missing index instead of downloading it while rendering. A
relationship with `contentIndex: false` is for a Foundry dependency whose
content is not addressable from this package. See the
[dependency configuration](../configuration.md#relationships) for the
declaration and cache rules.
