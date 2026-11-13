# Content authoring contract

See [the content format guide](docs/content-format.md) for the complete note
format and publishing behavior.

For a complete package build, `package-build content build --calendaria-version 1.4.2`
publishes fresh indexes, emits calendars, stages assets, checks content and links,
and compiles packs in one invocation. See the [command reference](docs/commands.md#package-build-content-build)
for ordering, publication readiness and failure behavior.

Private PNG and SVG art masters can be declared in `art.masterRoots`. Each
master carries its image Address and can state creator, rights, an exact
`hl:license` ID, optional `hl:ai` status and IPTC digital source type. Public
derivatives use the Address for their target;
see [masters and derivatives](docs/reference/format-details.md#masters-and-derivatives).
Unpublished source components belong in separate `art.componentRoots`. Their
embedded Addresses can appear in a master’s private ordered composition recipe;
components never enter public asset records or renders.
The note-rendering cache includes master and component fingerprints in its input key and
reuses the index only while those inputs remain unchanged.

A single note renders as the body of its site page with
`@heroiclands/package-build/note-page`. `renderNoteFile(path, { root })` needs
only the package's fetched dependency indexes (`package-build deps fetch`), and
names that command when one is missing. Links, `.name` spans, query fences,
verse and generated sections render as `package-build site build` renders them,
and `findings` holds what the site build would report for the note. The
content tree's records and the note's query answers are kept in
`build/cache/note-page/`, keyed by hashes of every input they were derived
from, and reused only while those are unchanged. See
[`./note-page`](docs/api.md#note-page).

SQL reads the content-index fields except the top-level `foundry` export and
the `file` block, for both local notes and dependencies. A query selects notes
by property, tag or address; one that names `file.path`, `file.folder` or
`file.name` is an error at its position in the note. Addresses are queryable strings;
`name`, `data`, `sohl` and other nested objects remain structs, including
`data.governance.offices`. Encoding documents expose `data.mappings` as a
list of `{from, codes}` records so source keys retain their case. SQL also
provides `nameSort` and the `entries` state; `notes` excludes stub entries.
The canonical pack index retains its complete Foundry export.

Each SQL database has a fixed `memory_limit` of **2 GB**, independent of host
memory. Load exhaustion reports `sql-memory-limit`, the limit, and the local
or dependency load that failed. There is no authored memory setting.
A content session loads the local and each dependency's JSON records once.
Public and complete preparations share those base tables, with separate
connections and catalogs preserving unqualified, `main.*` and dependency
schema names. Each audience derives its event, generator and lexical relations
separately: public inheritance can skip a GM-only ancestor's definition.
The session releases its database after both audience preparations settle,
or when disposed after pending preparations drain. A session preparing only
one audience keeps the database available for a later second audience.

Nonempty `data.words` on a language note, or `data.glossary` on a culture or
affiliation, supplies page content without an authored body. Every other
typed note must have a nonempty body after its frontmatter, including drafts,
folders and homepages. Empty or whitespace-only bodies are otherwise errors.
Nonempty bodies with fewer than 25 prose words warn unless tagged `draft`.
A folder note needs only a nonempty body: any content passes, tagged or not.
Lint and publishing commands enforce the error; a description is not a body.

Every character in the path of a content file or a picture is printable 7-bit
ASCII, U+0020 to U+007E; an apostrophe is inside the range and an accented
letter is not. Lint reports a path outside it as an error at the path, and the
fix is to rename the file: `A_Sílhari_Manual.md` becomes `A_Silhari_Manual.md`,
and no address changes, because the `shortcode` carries a note's identity. See
[file and folder names](docs/content-format.md#file-and-folder-names).

A note's `name` is `{full, <code>: [forms]}`. `full` is the English name the
page, the compendium entry and the index print. Every other name is listed
under the code of its language: a code `languages:` declares, or `en`. `full`
counts as an English form, so `en` never repeats it, and the first form of each
list is that language's standard form. Any other key under `name` is a located
build error. Names match whatever their case, and two notes whose forms differ
only by case are one ambiguous name. See
[frontmatter](docs/authoring/frontmatter.md).

Every note is in one language. `data.lang` states it as a code `languages:`
declares or `en`; a note that states none takes its culture's language, then
its parents', nearest first, then `en`. The content index publishes the result
on every record as `lang`. A `data.lang` naming no declared code, a culture that
resolves to no language, and each `data.parents` entry on a cycle are located
build errors.
See [a note's language](docs/reference/format-details.md#a-notes-language).

An `affiliation` note must declare `data.governance.ranks` with a rung at
`level: 0` and a rung at `level: 1`. Level 1 is the ordinary member; level 0
names those the body excludes, in that body's own word for them. Each rung
states `level`, `title`, and `description`. Those two rungs are the minimum;
add higher ones only where the body truly has them. A rung is a standing, what
a member is; an office in `governance.offices` is a post, what a member does,
and leadership is normally an office held by the top rank. A missing or empty
ladder, or one without level 0 or level 1, produces a located build error.
An ordinary member states a ladder rank; a declared officeholder may instead
hold the post by appointment, with no rank. A seatless affiliation can list
its geographic activity in optional `data.range`, which prints linked places
under **Active in** and is available in the content index and SQL. A body with
a seat states no range. See the [frontmatter guide](docs/authoring/frontmatter.md)
for examples and refusals, and the
[affiliation reference](docs/reference/format-details.md#type-affiliation).

A place declares its government through `data.government`, an `Address` whose
default target type is `affiliation`. Explicit `null` means complete anarchy;
omission leaves government unknown. Governing bodies receive their place lists
from those references. See [place governments](docs/authoring/frontmatter.md#place-governments).

A being lists the items it has, and a culture lore note the items its people
typically carry, in `data.items`. An entry is `{key?, model?, name?, img?, kind?,
chance?, system?: {subType?, quantity?, weight?}}`; with `model` alone, an item
note supplies the rest, and without `model` the entry states `name` and `kind`
and defines the item inline. `kind` is one of `weapon`, `armor`, `clothing`,
`container`, `miscgear`, `projectile`, `concoction`, `elixir`, `potion`, `simples`, `disease`, `poisontoxin`,
`maladiction`, `physcond`, `quirk`, `disorder`, `privation`, `fear`, `language`,
`script`, `arcaneability`, `spell`, `psychicgift`, `incantation` or
`divination`. A `model` must resolve to an item note of the note's own package or
of a package it requires as a module, directly or through the modules those
require, and never to a game system's item at any level. A `key` is unique
within `data.items` and within each system's `items` list. An item note
(`weapongear`, `armorgear`, `containergear`, `miscgear`, `projectilegear`,
`concoctiongear`, `affliction`, `trauma` or `mysticalability`) states the same
shape in its `data` block with `kind` required. See
[items in a note](docs/reference/format-details.md#items-in-a-note).

A being's entries compile into embedded Items for each supported system when
the model supplies that system's item type or a same-key system entry states
one. Model defaults and entry fields merge with the same-key system entry;
nested maps merge and lists replace. An item without a type for a system is
omitted from that system's actor.

A polity (`affiliation`, `subType: polity`) lists settlements without notes in
`data.settlements`. Each row names its settlement, polity, location, type,
fortification, stronghold, holder, population, market and short notes. Polity
and holder accept an Address with an explicit type or a plain name; location
is a place Address. Fortification and stronghold may be omitted or null.

A settlement with a note states its own facts in `data`, with `government`
naming its polity and `parents` naming its enclosing places. It has no authored
row in the polity. The build merges the two sources into a Settlements table
of direct subjects and a Settlement index of every settlement beneath the
polity. Direct subordinate polities appear through their seats, or as linked
polity summaries where no settlement seat is stated. All publishing surfaces
use the same generated tables.

`data.population` on an affiliation counts its members. A polity's separate
`data.territorial_population` counts inhabitants: listed and noted settlements
throughout its subordinate chain must not exceed that total. Towns and cities must not exceed the configured urban share, ten percent by default. Complete-table mode instead requires the listed total to be within five percent of the territorial total.
A polity with settlements, a seat, or subordinate polities requires this total.
Each polity declares at most one superior in `data.parents`.
Seats count once, and subordinate territorial totals are never added to the
settlement sum. Populations use at most two significant digits. Each settlement
has short `data.notes`; a populated settlement note also requires `data.type`,
a declared `data.market` label (such as `local`), and a `data.government` that resolves to a polity.
For an aggregate population finding, declare a reasoned settlement exemption for that polity in the [configuration](docs/configuration.md#settlement-exemptions).

```yaml
type: affiliation
subType: polity
shortcode: council
data:
  territorial_population: 100
  settlements:
    - settlement: East Farm
      polity: affiliation-council
      location: place-vale
      type: homestead
      fortification: null
      stronghold: null
      holder: The Council
      population: 100
      market: subsistence
      notes: A farm by the road.
```

See [polity settlement tables](docs/reference/format-details.md#a-politys-settlements-table).

A being's `data.gender`, `data.frame`, `data.appearance.eye_color`,
`hair_color`, `skin_color`, `complexion`, `hair_texture`, `hair_style`,
`facial_hair`, `face_shape`, `nose`, `brow` and `mouth` take their words from one
closed vocabulary, and any other value is a located build error naming the words the
field takes. `complexion` is a list, required once a being states an
appearance. `data.appearance.extra_features` lists the being's visible
physical marks, each a short plain description of one. See
[a being's look](docs/reference/format-details.md#a-beings-look).

A `lore` note of `subType: culture` may state `data.appearanceProfile`: words
of that vocabulary, each with a positive weight, for `frame`, `eye_color`,
`hair_color`, `skin_color` and `complexion`, optionally the head and face
features too, and a `height` range for at least `female` and `male`. `package-build npc new` draws a new npc of that culture
from it. See
[appearance profiles](docs/reference/format-details.md#appearance-profiles).

A culture's language is the tongue its people speak, and the note
`languages:` names for it may state `data.names`: a
`pattern` such as `"{given} {clan}"` — or a list of them, or a map of genders to
them — `given` names listed by gender, and every other list the patterns name. `package-build npc new` draws a culture's names
from them, and checks a name it is given against them. See
[name lists](docs/reference/format-details.md#name-lists).

A spelling guide can declare a pronunciation mark with
`kind: tone` in `data.sounds.marks`. It marks a rising or falling pitch.

A language note states its words in `data.words`, beside `data.names`, with
the `data.classModifiers`, `data.fields` and `data.affixes` they are read
against; each word's class comes from the master word classes, and none of it
reaches the compiled Item. A daughter language names its parent language in
`data.family` and reads the parent's words as its own. A language note with
`data.words` receives its full Dictionary section automatically on the site,
in the Foundry journal and in the book: one alphabetical list with field tags
and one key. A language with absent or empty `data.words` receives no Dictionary section.

A culture or affiliation with nonempty `data.glossary` receives a Glossary section
containing only that owner's declared entries. Ranks and offices have their
own affiliation sections and enter the glossary only through an explicit
entry. The glossary holds entries for common words in its core vocabulary, dictionary
words with a context meaning, and phrases, compounds or terms of art outside
the dictionary. An entry naming a dictionary word takes its senses and class
and links to its language entry; an entry's `definition` supplies its meaning
instead. Common marks belong to the owner's glossary, and a word may be
common in one glossary and absent from another. Dictionaries and glossaries
have no setting-wide pages. Every entry resolves to a language: its own
`language`, else the note `languages:` names for the language of the note it
is written on. An entry that resolves to none is a located build error. The `dictionary` relation lists every word under
each language that has it, inherited words included, and the `terms` relation
every glossary entry, rank and office with its culture associations; an `sql`
fence sets a custom view with `layout=dictionary` or `layout=glossary`.
The default sections follow the authored text, or fill an existing
`{#dictionary}`, `{#lexicon}` or `{#glossary}` heading after its authored
introduction. `package-build content-index` writes both relations beside the
index. See
[a language's words](docs/reference/format-details.md#a-languages-words),
[glossary terms](docs/reference/format-details.md#glossary-terms) and
[dictionaries and glossaries](docs/reference/format-details.md#dictionaries-and-glossaries).

A span, div or scroll fence selects an encoding document with `enc=`;
its default Address type is `doc`. The document's language and single font
supply those defaults, and explicit selections must agree. `enc=default`
leaves Roman text as written. Language word-book validation applies to both
Roman and encoded text, and native spellings and complete parts precede rows.

Encoding documents state `data.language`, `font`, `mappings` and `rules`, with
optional `accepts` and `vowels`. Fonts publish glyph codes in `fonts.json`;
`⟦codes⟧` reads those codes or strict `U+XXXX` scalars. Unknown input is a
located error. Invisible U+E0100 through U+E01EF marks preserve punctuation,
spelling and stress distinctions, while every visible output must be drawn.

Decoding can use a language's lexicon to recover unmarked words, with longest
native writing and first-listed ties. Marked words keep exact decoding.
See [encodings](docs/reference/format-details.md#encodings) and
[native spellings and parts](docs/reference/format-details.md#native-spellings-and-parts).
