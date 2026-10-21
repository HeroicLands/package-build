---
shortcode: contentformat
name: { full: "Authoring HeroicLands content" }
type: doc
subType: userguide
---

# Authoring HeroicLands content

A content package begins with Markdown notes under `assets/content/`. Each note has YAML frontmatter describing its identity and data, followed by prose. Folder names beneath `assets/content/` are for authors; `type`, `subType`, and Addresses determine what the build creates.

Nonempty `data.words` on a language note (`type: skill`, `subType: language`), or `data.glossary` on a culture or affiliation, supplies page content without an authored body. Every other typed note requires a nonempty body, including drafts, folders and homepages. An empty or whitespace-only body is otherwise an error. A nonempty body with fewer than 25 prose words warns unless tagged `draft`; the tag never exempts an empty body. A `folder` note needs only a nonempty body: any content passes, with or without `draft`.

Start with [your first note](authoring/first-note.md). It explains the smallest valid note and shows the JournalEntry, web page, book entry, and content-index record made from it. Then use the chapters below in the order your note needs them.

| Need                                                      | Read                                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Frontmatter, `data`, system blocks, and infoboxes         | [Frontmatter](authoring/frontmatter.md)                                          |
| Addresses, links, anchors, fences, and inline expressions | [Links and markup](authoring/links-and-markup.md)                                |
| Images, icons, audio, provenance, and sidecars            | [Assets](authoring/assets.md)                                                    |
| Canonical dates, calendars, eras, and conversions         | [Dates and calendars](authoring/dates-and-calendars.md)                          |
| All accepted note types, subtypes, and fields             | [Note type reference](reference/note-types.md)                                   |
| Exact format details and system mappings                  | [Detailed reference](reference/format-details.md)                                |
| Optional readability and wording suggestions              | [Prose analysis](commands.md#package-build-prose-lint-path-and-prose-score-path) |

## The shared note

A nonempty note body creates one system-agnostic Foundry JournalEntry. Content before the first H1 becomes an introduction page; every H1 starts another JournalEntryPage. A lower-level heading with an explicit `{#anchor}` starts a page too, so a link can address it. The same prose becomes a web page and can be selected for a book. The content index records the note and its frontmatter for queries and navigation.

Leading `:` captions describe the next supported block; `:@` captions also number it. The optional type accepts `figure`, `table`, `verse`, `code`, `prose`, and `example`. Captions support identifiers, classes and named attributes; unsupported following blocks are errors. See [captions and numbered references](authoring/links-and-markup.md#captions-and-numbered-references).

A code fence with language `verse` keeps verse lines, stanza breaks and relative indentation. Its numbered caption uses the **Poem** label. Generic `:::` divs and `[inline spans]{.class}` accept attributes. See [verse](authoring/links-and-markup.md#verse), [fenced divs](authoring/links-and-markup.md#fenced-divs) and [inline spans](authoring/links-and-markup.md#inline-spans). `numstep=N` numbers every Nth line. `col1=` and `col2=` set the poem in at most two columns, each a `:`-joined stack of `language[/mapping[/font]]` entries, the first in the normal tone and the rest in grey; with columns, each blank-line group of `[text]{lang=…}` spans is one verse line, every entry sets the span in its language, and a `***` line breaks the stanza. See [verse in columns](authoring/links-and-markup.md#verse-in-columns).

A span, a generic div or a verse fence marks its text's language with `lang=`, the font it is set in with `font=` and a mapping with `map=`, each optional, and the runs inside a div or a fence inherit its keys. `lang=` is a name the package declares in `languages` or a BCP 47 tag, and gives the language tag alone. `font=` is a face of the installed `@heroiclands/fonts`, named by its class without `hl-`, or `mono`, `serif` or `sans`. `map=` names a mapping note: a `doc` note whose `data.map` lists the fonts it is drawn in and rows that rewrite the text before it is set, a font's own rows first. With `lang=` naming a language whose configured `note` names its language note, a word whose entry states a `native` form for the map is written by it, and the rows spell every other word. Every word of such a run is a lexicon form, a word of a name the language note's own register lists under a tongue other than `translation`, or a form a plural row, the verb pattern or an affix stating `replaces` derives from a lexicon form, and any other word is an error at the word. A character a face does not draw, after the map, is an error at the character it came from. Text with a font, a map or a declared language is plain. Every marked construct is a row of the `runs` relation, every mapping row of the `maps` relation, and every native form of the `natives` relation. See [marking language, font and mapping](authoring/links-and-markup.md#marking-language-font-and-mapping).

Mark a name without a note as `[Name]{.name data-type="being"}`; the optional
classification uses the declared note vocabulary. The [name-marking
guide](authoring/links-and-markup.md#marking-names-in-prose) explains its syntax,
index and grouped lint advice.

Body extensions use braces with space-separated `key=value` attributes:
`![[icon-harbor|Harbor]]{float=top-left size=medium}` and an SQL fence with
`{allow-empty=true}` are examples. Inline font glyphs use the package's icon
registry, as in `:icon warning:{size=lg}`; image icons use asset Addresses.
`:::info` and `:::warn` add labelled boxes within the prose. A
`pagelist` fence renders the pages carrying a tag as a list of links, so a
landing page states a group by intent rather than enumerating it. The
[links and markup guide](authoring/links-and-markup.md) gives the complete syntax.
Footnotes use `[^id]` references and `[^id]:` definitions, with numeric output
markers scoped to each note. Definition lists use a term followed by one or
more `: definition` lines. See [footnotes and definition lists](authoring/links-and-markup.md#footnotes-and-definition-lists)
for examples and placement in journals, web pages, and books.

An inline `{{sql "SELECT COUNT(*) FROM notes"}}` expression inserts one scalar query result. Use `{{words (sql "SELECT COUNT(*) FROM notes")}}` for a count in running prose, or `{{digits (sql "SELECT COUNT(*) FROM entries")}}` for grouped numerals. The query must return exactly one row and one column with a nonempty value; a mismatch is a located build error. Prefix `\{{` to show the syntax literally. The [expression reference](reference/format-details.md#dates-and-calendars) describes the helpers and the available SQL relations.

Add `gm` to `tags` for a GM-only note. Public site and book builds omit it;
Foundry compiles it only into private compendiums. Ordinary wikilinks to it
conceal the whole reference as a spoiler; `.show` reveals just the reference.
`[text]{.secret}` marks text itself as a spoiler. Neither changes the target's
access permissions. The [frontmatter guide](authoring/frontmatter.md#frontmatter-and-system-blocks)
explains routing for documents and their prose journals.

A note can also produce a system document: an Actor, Item, Scene, or Macro according to its type and system blocks. The `sohl:` and `hm3:` blocks supply game-specific mechanics and overrides; they do not create separate prose. The JournalEntry is shared between systems.

An `affiliation` note declares `data.governance.ranks` with at least two rungs:
`level: 0`, those the body excludes, and `level: 1`, its ordinary members. Every
body that can name its members can name those it shuts out, whether or not it
ever does, so both are required. Each rung states `level`, `title`, and
`description`, and the level-0 title is the body's own word for the excluded
rather than a generic "Excluded". A being's `data.affiliations` entry names a
rank on that body's ladder; level 1 is the ordinary standing when no higher
rank applies.

Add rungs above level 1 only where the body truly has them, generally no more
than five. A rung is a **standing**, what a member is; an entry in
`governance.offices` is a **post**, what a member does. Leadership is normally
an office held by the top rank rather than a rank above it, and a rank never
falls when an office is left: a bishop stays a bishop after being Presiding
Bishop.

```yaml
data:
  governance:
    ranks:
      - { level: 0, title: Apostate, description: Put out of the communion. }
      - { level: 1, title: Layman, description: A baptised member of the faith. }
      - { level: 2, title: Priest, description: Ordained to serve a parish. }
      - { level: 3, title: Bishop, description: Consecrated to oversee a diocese. }
    offices:
      Presiding Bishop: Chairs the synod of bishops for a term.
```

Missing ranks, an empty list, or a ladder without level 0 or level 1 are build
errors, reported at the `ranks` key.

| Authored section | SoHL Actor          | HM3 Actor            |
| ---------------- | ------------------- | -------------------- |
| `{#appearance}`  | `system.appearance` | `system.description` |
| `{#dossier}`     | `system.dossier`    | `system.biography`   |

An Item's `{#description}` page is its readable description. The note Address `<package>-note-<type>-<shortcode>#description` resolves to a JournalEntryPage UUID. The build writes the same `@UUID[...]` pointer to SoHL Item `system.docHtml` and HM3 Item `system.description`. An Item note without that anchor uses its first page as the description. Other pages and anchors remain available for links.

## Suggesting another note

State deliberate cross-references in `data.seeAlso`, in reading order:

```yaml
data:
  seeAlso:
    - address: lore-harborhistory
      gloss: The founding of the port
    - address: place-breakwater
    - address: thalorna-note-lore-searoutes
      gloss: Routes beyond the bay
```

Each `address` names a whole note; `gloss` optionally explains why to read it.
The first entry points to the port's history, the second to its breakwater,
and the third to a note in the declared `thalorna` dependency. An address must
resolve, and neither a duplicate destination nor the note itself is allowed.
The site shows the list ahead of other Related links, without repeating their
destinations. Journals and books append See also; an omitted or empty list adds
nothing. See [suggested reading](authoring/frontmatter.md#suggested-reading)
for the Address rules.

## File and folder names

Every character in the path of a content file or a picture is printable 7-bit ASCII, U+0020 to U+007E. The rule covers each file and folder name under the content tree and under the package's `icons/` and `images/` roots. Letters, digits, spaces, hyphens, underscores, dots and apostrophes are all inside it, so `Knight's_Shield.md` is a valid name. An accented letter, any other non-ASCII character, and a control character are outside it.

`package-build lint` reports each offending name as an error located at the path, with no line or column, and names the characters by code point:

```text
assets/content/Misc_Gear/Scribe/A_Sílhari_Manual.md: error: the path holds U+00ED (í), outside printable ASCII; rename the file using ASCII only
```

The fix is to rename the file, `A_Sílhari_Manual.md` to `A_Silhari_Manual.md`. A note's identity comes from its `shortcode`, and a picture's from its basename without the extension, so the rename changes no address and breaks no link. The accented spelling belongs in the note's `name`, where it displays as written.

## A complete minimal note

Place this at `assets/content/Places/Harbor.md`:

```markdown
---
shortcode: harbor
name: { full: Harbor }
type: lore
subType: concept
---

# Harbor

A sheltered place where ships load and unload.
```

The note's readable Address is `<package>-note-lore-harbor`. In prose, link to it with `[[lore-harbor|Harbor]]`. The package segment comes from `package-build.config.yaml`; a regular wikilink defaults to the readable `note` system. An image embed such as `![[icon-harbor|Harbor]]` defaults to `none` instead.

The [first-note guide](authoring/first-note.md) shows the build commands and how to add a system document. Use the [command reference](commands.md) for exact flags and the [diagnostics guide](diagnostics.md) for located errors.

Place notes may declare a governing affiliation with `data.government`, or explicit `null` for complete anarchy. Positive population with an omitted government produces an advisory. See [place governments](authoring/frontmatter.md#place-governments).

A region may list its settlements in a table under `## Settlements` — name, market, people and holder, one row each — tagged with the holding model it is written in. A row links the settlement's note where one exists, and `package-build lint` holds the two to agreement. See [a region's settlements table](reference/format-details.md#a-regions-settlements-table).

A being states its gender, frame and appearance in words from one closed vocabulary: `data.gender`, `data.frame`, and `data.appearance.eye_color`, `hair_color`, `skin_color` and `complexion` each take only the words listed for them, and any other value is an error at the value. `complexion` is a list, required once a being states an appearance. `data.appearance.extra_features` lists the being's visible physical marks, each a short plain description of one, and an entry stating a colour, a skin condition or anything that is not a mark is an error. See [a being's look](reference/format-details.md#a-beings-look).

A culture note may state what its people look like in `data.appearanceProfile`: weighted words for frame, eyes, hair, skin and complexion, and height ranges by gender, all from the same vocabulary. A culture names its tongue in `data.language`, and that language skill note may state `data.names`: the patterns its speakers' names are built by and the lists each part is drawn from. `package-build npc new` writes a complete npc note from a spec of a culture and a gender, drawing the name from those lists and everything else the spec leaves out from the profile. See [appearance profiles](reference/format-details.md#appearance-profiles), [name lists](reference/format-details.md#name-lists) and [the command](commands.md#package-build-npc-new).

A culture may name its larger cultures in `data.parents`. Each entry names a
culture lore note. Omitted `data.language` and `data.appearanceProfile` fields
inherit independently through those parents; the content-index JSONL contains
the resolved values, which `npc new` reads directly. A stated field wins over
its inherited value. See [culture parents](reference/format-details.md#culture-parents-and-inherited-fields)
for a complete example, parent ordering and findings.

Places, affiliations, lore and beings may name their culture in `data.culture`, and a `doc` of `subType: settingguide` must. A place or affiliation that names none inherits the culture of its parents. See [culture in the index](reference/format-details.md#culture-in-the-index).

An affiliation may name the trade, temple or order tongue it keeps in its own `data.language`. An affiliation that reaches no culture is a warning, in a tree holding a culture note. A language needs no culture and no affiliation. See [type: affiliation](reference/format-details.md#type-affiliation).

A language note (`type: skill`, `subType: language`) states its words in frontmatter: `data.words` states each word as a map of its form, class, field and gloss — one sense or a list of them, which a dictionary numbers — with its source, its variant forms, the pieces it is built from and a note, beside `data.classModifiers`, `data.fields` and `data.affixes`, each affix with the `kind` it makes, for a given name's ending who the name is `given` to, and the stem closes it is barred after; a zero affix states `zero: true` and no form. The notes a word is cited from are derived, not written: a note cites a word by marking it in italics in its prose, matched by form or a variant with diacritics and case set aside. The language of a word is the note it sits on, and none of it reaches the compiled Item. A daughter language names its parent in `data.family` and reads the parent's words as its own; the `language_lineage` relation joins a language to its ancestors. Classes come from the [master word classes](reference/format-details.md#word-classes). A culture or an affiliation states its own glossary entries in `data.glossary`: common words in its core vocabulary, dictionary words with a context meaning, or phrases, compounds and terms of art outside the dictionary with their own gloss. An entry naming a word of its resolved language takes the word's senses and class and links to its language entry; a `definition` supplies the entry's meaning instead. Common marks belong to the glossary's owner. A language note with nonempty `data.words` receives its full Dictionary section automatically: one alphabetical list with field tags and one key. A culture or affiliation with nonempty `data.glossary` receives only its explicitly declared entries in its Glossary section; ranks and offices stand in the affiliation's own sections. A note without the relevant frontmatter receives no such section. All surfaces show these sections after the authored text, or under an existing `{#dictionary}`, `{#lexicon}` or `{#glossary}` heading after its introduction. There are no setting-wide dictionary or glossary pages. Every entry resolves to a language — its own `language`, else the affiliation's, its parents' or its culture's, else the culture's — or is an error at the entry. The `words`, `affixes`, `fields`, `glossary` and `language_lineage` relations hold them for `sql` fences, the `dictionary` relation lists each word under every language that has it, inherited words included, and the `terms` relation each glossary entry, rank and office with its culture associations; a fence sets custom views with `layout=dictionary` or `layout=glossary`. A language note names the tag a dictionary prints for it in `data.abbreviation`. Every fact a check reads about a language's names, sounds and history is frontmatter too: `data.tongues` and `data.register` (every name the setting gives in the language's reach, the notes carrying each derived from the index, and a name tagged `other:<tongue>` or `exonym:<tongue>` one that the tongue's own language note registers under that tongue), `data.retired`, `data.scope`, `data.sounds` (letters with their place, word edges from a closed list, the cluster limit and the groups of clusters inside a word, the stress rule, syllable finals, syllable rules and vowel harmony with each vowel's front partner, the joining of parts, written marks, a root's skeleton vowel and frames, the spellings read past, and named mutations such as wearing and voicing), `data.soundChanges` (named sets of ordered steps), `data.elements` (each standing `opening`, `closing`, `either` or `link`, for one kind of name, with the word it is the stem of and its joining form), `data.roots`, `data.cognates` (with a reconstructed `proto` form), `data.callingNames`, `data.older` (the forms older than the rules), `data.negation` (the negative particle and the mutation it brings) and `data.naming` (how long each class of name runs, the edges names keep that words do not, the element kinds each kind of name draws on, what a place name takes from what it is held from, and the near name), each a relation — `sounds` as `letters`, `edges`, `clusters`, `cluster_groups`, `stress`, `finals`, `syllables`, `joining`, `joins`, `marks`, `skeleton`, `frames`, `read_past` and `mutations`, `soundChanges` as `sound_changes`, `callingNames` as `calling_names` — that a fence sets back on the page. A word's citations also come from a note whose name, alias or rank or office title spells it whole. See [a language's words](reference/format-details.md#a-languages-words), [a language's register, sounds and history](reference/format-details.md#a-languages-register-sounds-and-history), [glossary terms](reference/format-details.md#glossary-terms) and [dictionaries and glossaries](reference/format-details.md#dictionaries-and-glossaries).

Blockquote alerts use `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, or `[!]`, with optional attributes after the marker. They replace the former info and warn div fences; secret blocks remain supported. See [alerts](authoring/links-and-markup.md#alerts).
