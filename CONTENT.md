# Content authoring contract

See [the content format guide](docs/content-format.md) for the complete note
format and publishing behavior.

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

An `affiliation` note must declare `data.governance.ranks` with a rung at
`level: 0` and a rung at `level: 1`. Level 1 is the ordinary member; level 0
names those the body excludes, in that body's own word for them. Each rung
states `level`, `title`, and `description`. Those two rungs are the minimum;
add higher ones only where the body truly has them. A rung is a standing, what
a member is; an office in `governance.offices` is a post, what a member does,
and leadership is normally an office held by the top rank. A missing or empty
ladder, or one without level 0 or level 1, produces a located build error.
See [the affiliation reference](docs/reference/format-details.md#type-affiliation).

A place declares its government through `data.government`, an `Address` whose
default target type is `affiliation`. Explicit `null` means complete anarchy;
omission leaves government unknown. Governing bodies receive their place lists
from those references. See [place governments](docs/authoring/frontmatter.md#place-governments).

A being's `data.gender`, `data.frame`, `data.appearance.eye_color`,
`hair_color`, `skin_color` and `complexion` take their words from one closed
vocabulary, and any other value is a located build error naming the words the
field takes. `complexion` is a list, required once a being states an
appearance. `data.appearance.extra_features` lists the being's visible
physical marks, each a short plain description of one. See
[a being's look](docs/reference/format-details.md#a-beings-look).

A `lore` note of `subType: culture` may state `data.appearanceProfile`: words
of that vocabulary, each with a positive weight, for `frame`, `eye_color`,
`hair_color`, `skin_color` and `complexion`, and a `height` range for at least
`female` and `male`. `package-build npc new` draws a new npc of that culture
from it. See
[appearance profiles](docs/reference/format-details.md#appearance-profiles).

A culture may name the tongue its people speak in `data.language`, a `skill`
note of `subType: language`. That language may state `data.names`: a
`pattern` such as `"{given} {clan}"` — or a list of them, or a map of genders to
them — `given` names listed by gender, and every other list the patterns name. `package-build npc new` draws a culture's names
from them, and checks a name it is given against them. See
[name lists](docs/reference/format-details.md#name-lists).

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
`language`, else the affiliation's `data.language`, its parents' or its
culture's, else the culture's `data.language`. An entry that resolves to none
is a located build error. The `dictionary` relation lists every word under
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
