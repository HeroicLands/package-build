---
shortcode: guidesinventedscripts
name: { full: "Write in invented languages and scripts" }
type: doc
subType: howto
---

# Write in invented languages and scripts

A setting with invented languages needs three things from its notes: text that
reads as the language, text that is drawn in the language's own letters, and a
way to keep both honest. This guide explains how the toolchain does that, from
the model underneath to every finding it can report, for human authors and for
agents. The reference pages state each rule exactly: [links and
markup](../authoring/links-and-markup.md#marking-language-font-and-mapping),
[format details](../reference/format-details.md#text-marked-with-a-language-a-font-or-a-map),
[commands](../commands.md#package-build-transliterate-map-text),
[configuration](../configuration.md#languages) and
[diagnostics](../diagnostics.md). This guide ties them into one account and
works one example through from start to finish.

The examples write Vylari, a tongue spelled in roman letters and drawn in the
Semaron script. The lexicon and the notes in them are the guide's own sample.

## The model

These ideas carry everything else.

1. **A note records Unicode characters, and nothing else.** Which keyboard
   typed them is the author's business. The markdown and the build neither
   know nor care.
2. **A font draws glyphs for code points.** A code point a font lacks draws a
   box, so the build refuses it before a box reaches a reader. A font states no
   sounds and no spelling, just as a Unicode block chart states none.
3. **Each script has code points of its own,** as Runic and Ogham have their
   own Unicode blocks. Semaron's `a` is not U+0061. Every face of one script
   draws the same code points, so changing the face changes only the look. The
   left-to-right scripts sit in plane 15, the Supplementary Private Use Area-A
   (Semaron from U+F0200). The right-to-left scripts sit in unassigned code
   points of plane 1 whose default direction is right to left, so their text
   runs right to left in any editor, browser or typesetter with no control
   characters.
4. **Sounds and spelling belong to the language.** A script is not a language:
   several languages are written in one script, as many Earth languages share
   the Latin alphabet. A mapping therefore belongs to a script and serves every
   language written in it. What differs between languages is their dictionaries.
5. **Language and presentation are separate.** `lang=` identifies the
   language, retaining the authored Roman spelling and the surrounding prose
   font. Language and vocabulary checks still apply.
6. **`.nativefont` requests native presentation.** It requires an explicit
   `lang=` on that same span, div or fence, then selects the language's
   configured native map and font. Each marked child makes its own choice;
   native presentation is not inherited by a language-only child.
7. **`font=` and `map=` override independently.** A native run takes any
   missing half from the language's `data.writtenIn`; if neither the run nor
   its language provides a font, the build reports the needed `font=` override.
   When the language supplies no map, native code points can be typed directly.
   A native font or map without `.nativefont` is an error. Ordinary Roman
   `font=mono`, `serif` and `sans` remain available without native opt-in.
8. **Native mapping uses the dictionary first.** A word the dictionary does
   not write is spelled by the mapping's rows. Every word must belong to the
   language where its configured note supplies a dictionary.

A script that writes meanings rather than sounds is **logographic**. It has no
sound rules, so every word is written from the dictionary and never guessed;
see [logographic scripts](#logographic-scripts).

One code path serves the build and its users. `package-build transliterate`
converts a passage exactly as the build does, and `package-build lexicon` lists
every word of a language with its native form; see
[the commands](#the-commands).

The pipeline for one marked run reads left to right:

| Stage         | Reads                                | Reports                                    |
| ------------- | ------------------------------------ | ------------------------------------------ |
| Keys          | `lang=`, `font=`, `map=`             | an unknown language, font or map           |
| Dictionary    | the language's `data.words[].native` | a native form the rows cannot capitalise   |
| Rows          | the mapping's `data.map.rows`        | nothing: a character with no row passes on |
| Lexicon check | the language's words and register    | a word the language does not hold          |
| Face coverage | the face's `fonts.json` code points  | a character the face does not draw         |
| Element       | the face, the tag and the direction  | nothing                                    |

## Language and native presentation

The keys go in the attribute block that a span, a fenced div or a `verse`
fence already takes:

| Written                                                                | Meaning                                                                          |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `[Daimela, helthos.]{lang=vyl}`                                        | Vylari in authored Roman spelling and the page's font, with language validation. |
| `[Zaron lonak]{lang=vyl .nativefont}`                                  | Vylari mapped and drawn with its configured native defaults.                     |
| `[Zaron lonak]{lang=vyl .nativefont font=semaron-kuriale map=semaron}` | Native Vylari with both defaults explicitly overridden.                          |
| `[ad astra]{lang=la font=serif}`                                       | A real language's BCP 47 tag, in the reader's serif.                             |
| `::: {lang=vyl .nativefont}` … `:::`                                   | Native presentation for a passage's unmarked paragraphs.                         |
| a `verse` fence opened with `{lang=vyl .nativefont}`                   | Native presentation for a poem's unmarked lines.                                 |

The class is explicit on each construct. `[Zaron]{.nativefont}` is an error
even inside a passage marked `lang=vyl`: add `lang=vyl` to that span. A native
font such as `font=semaron-kuriale`, or any `map=`, requires `.nativefont`.
Generic Roman `font=serif`, `sans` and `mono` do not.

**`lang=`** is read in this order. First a short name declared in the
configuration's `languages`; then a BCP 47 language tag for a real language
(`la`, `grc`, `en-GB`), checked for its form alone. A declared name wins over a
tag spelled the same way. A well-formed tag one edit from a declared name draws
a warning that names the declared one, since `vly` is a valid tag for another
language than `vyl`.

**`font=`** is a face of `@heroiclands/fonts`, named by its class without
`hl-` (`hl-semaron-kuriale` is `font=semaron-kuriale`), or one of the generic
families `mono`, `serif` and `sans`. A package that sets text in a face adds the
fonts to its own development dependencies:

```bash
npm install --save-dev @heroiclands/fonts
```

The installed package's `fonts.json` lists every face and every code point it
draws, which is the list to write a mapping from. This prints Semaron Kuriale's:

```bash
jq -r '.families[] | select(.class == "hl-semaron-kuriale") | .codepoints[] | [.codepoint, .kind, .glyph, .name] | @tsv' \
  node_modules/@heroiclands/fonts/fonts.json
```

Each line is a code point, its kind (`letter`, `digraph`, `numeral`, `point`, `mark`
or `sign`), the glyph's name and the character's name; the glyph named `a` is the
letter that writes the sound `a`, and `a.long` the long vowel. Those names are
what a mapping's rows are written from.

On the site `serif` and `mono` are the site's own body and code faces and
`sans` is the reader's sans-serif; in Foundry they are the reader's generic
families; in a book they are the book's own serif, sans and mono. The generic
families are not checked for coverage.

**`map=`** is the `data.map.name` of a [mapping note](#mapping-notes). It
rewrites the run before anything else; a run's `font=` is then one of the faces
the mapping lists.

The `languages` block of `package-build.config.yaml` declares the short names:

```yaml
languages:
  vyl: { tag: art-x-vyl, note: skill-vylarilng }
  khel: { tag: art-x-khel, note: skill-khelathlng }
```

A name is lowercase letters, digits and hyphens, starting with a letter. `tag`
is a BCP 47 tag; a constructed language takes `art-x-<name>`. `note` is the
address of the language's `skill` note of `subType: language`, whose
`data.words` is the dictionary and whose `data.register` is the names register.
Without `note`, `lang=` only tags: there is no dictionary and no lexicon check.
`package-build lint` checks at the key that `note` names a language note.

**A language names its script.** Most tongues are written in one script, so the
language note says which, as one map and one face:

```yaml
data:
  writtenIn: { map: semaron, font: semaron-kuriale }
```

A language-only run stays Roman: `[Zaron lonak]{lang=vyl}`. Add
`.nativefont` to select both defaults:

```markdown
[Zaron lonak]{lang=vyl .nativefont}
[Zaron lonak]{lang=vyl .nativefont font=semaron-kuriale map=semaron}
```

Those two spans display the same native text. `font=` replaces only the font;
`map=` replaces only the map. A missing font default produces an error naming the
needed `font=` override, and incompatible map/font pairs are errors. A map
is optional when the language supplies none; directly typed signs then
reach the selected font unchanged. The build does
not discard a default to make an override fit. This applies to spans, divs,
verse fences, scroll fences and standalone wikilinks. The language note's
keys are checked at their values:

> `` `data.writtenIn.map` is `semoran`, which no mapping note's `data.map.name` declares; did you mean `semaron`? ``

> `` `data.writtenIn.font` is `teng-chou`, which the map `semaron` is not drawn in; it is drawn in `semaron-kuriale` ``

**Unmarked text follows its passage; marked children choose their own
presentation.** A language-only child stays Roman, even in the same language
as its native parent:

```markdown
::: {lang=vyl .nativefont}
Zaron lonak, [Zaron lonak]{lang=vyl}, lokamen zaron.
[Gar-Anlagh]{lang=khel .nativefont font=qalezu-hand map=qalezu}
:::
```

The first Vylari phrase and the unmarked text use Semaron; the language-only
span gives the Roman reading. The Khelathi span opts in independently and uses
its own map and font. Qalezu runs right to left inside the left-to-right line
with no `dir=` written. An English gloss, `[an oath]{lang=en font=serif}`,
uses the page's serif. A child's own native defaults and overrides are used;
the parent's explicit map and font are not copied into the child.

**References make the same choice.** The first name below stays Roman; the
second uses Vylari's native defaults:

```markdown
[[lore-marendasdty|Marendas]]{lang=vyl}
[[lore-marendasdty|Marendas]]{lang=vyl .nativefont}
```

Only the displayed name is mapped and set in the native face. The destination,
spoiler and `.show` behavior, draft cue and book page references are preserved.
Keep adjacent prose and its spaces in sibling spans; a longer native passage
cannot contain an embedded link.

**What a run may hold.** A marked span or verse line is plain text: no
emphasis (other than the stars a face's run takes, see [emphasis in a
script](#emphasis-in-a-script)), link, image, footnote, wikilink, code or HTML.
A standalone resolved reference may carry the language and native class, as
above; only its label is set. A marked div holds paragraphs and line breaks only. The text is read as written,
so `[`, `]`, `"`, `<<`, `>>`, `!` and `@ # $ % ^ &` are characters; a bracket
pair is markup only when `(` makes a link, `{` a span or a second `[` a
wikilink, and an unbalanced bracket takes a backslash, `\[`. A code fence is
verbatim: `[…]{…}` inside it stays literal text. Text marked with a real
language's tag alone keeps its Markdown when that language is English; a span
with a non-English effective language cannot contain actual bold or italic
markup, even when the language is real.

The language, font and map keys are errors on a named block such as a secret block. Put a marked
div inside the block instead.

## Roman text and directly typed signs

Language-only text retains its spelling and the surrounding prose font:

```markdown
[Zaron lonak]{lang=vyl}
[Zaron lonak]{lang=vyl font=serif}
```

The second span explicitly chooses the ordinary serif. Neither selects the
language's native defaults. A configured language's existing vocabulary and
language checks still apply; presentation does not turn those checks off.

Text already typed in a script's code points also opts in explicitly:

```markdown
The lintel is cut with [󰈹󰈰]{lang=und .nativefont font=semaron-kuriale}.
```

Here `und` identifies an unspecified language with no configured map. The
font receives the typed code points unchanged. If a map is selected, rows
leave characters with no matching row unchanged. The selected face must draw
every resulting character, except whitespace, or the build
reports the source character. Keyboard layouts and Emacs input methods for
the scripts ship under the fonts package's `keyboards/`; an editor font that
carries the script draws its code points where they are typed. Typing Roman
and mapping it keeps the source readable and diffable.

## Mapping notes

A mapping note is a `doc` note whose `data.map` lists the rewrites. **There is
one mapping per script,** serving every language written in it. The note below
is complete; the rows are the Semaron letters this guide's sample uses.

**`assets/content/Lore/Semaron_Spelling.md`**

```markdown
---
shortcode: mapsemaron
name: { full: Semaron Spelling }
type: doc
subType: reference
data:
  map:
    name: semaron
    vowels: "aeiou"
    rows:
      - ["a", "󰈰"] # U+F0230
      - ["d", "󰈲"] # U+F0232
      - ["e", "󰈳"] # U+F0233
      - ["h", "󰈶"] # U+F0236
      - ["i", "󰈷"] # U+F0237
      - ["k", "󰈹"] # U+F0239
      - ["l", "󰈺"] # U+F023A
      - ["m", "󰈻"] # U+F023B
      - ["n", "󰈼"] # U+F023C
      - ["o", "󰈽"] # U+F023D
      - ["r", "󰈿"] # U+F023F
      - ["s", "󰉀"] # U+F0240
      - ["t", "󰉁"] # U+F0241
      - ["u", "󰉂"] # U+F0242
      - ["z", "󰉆"] # U+F0246
      - ["aa", "󰉈"] # U+F0248
      - ["th", "󰉐"] # U+F0250
      - ["Th", "󰉑"] # U+F0251
      - ["L", "󰈊"] # U+F020A
      - ["T", "󰈑"] # U+F0211
      - ["Z", "󰈖"] # U+F0216
      - { from: "y", to: "󰉅", before: vowel } # U+F0245
      - ["y", "󰈷"] # U+F0237
      - [".", "󰉨"] # U+F0268
      - [",", "󰉨"] # U+F0268
    fonts: [{ font: semaron-kuriale }]
---

Semaron Spelling writes roman spelling in the Semaron script. A passage marked with
`map=semaron` is converted by the rows of this note before it is set, so the note's
source stays in roman letters and the page shows the script. Every language written
in Semaron shares these rows.
```

The keys of `data.map`:

| Key           | Meaning                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------- |
| `name`        | What `map=` names it by: lowercase letters, digits and `-`, unique in the package. Required. |
| `rows`        | The rewrites, in authored order. Required.                                                   |
| `fonts`       | The faces the mapping is drawn in, each by its slug, at least one. Required.                 |
| `vowels`      | The characters that `before: vowel` reads as vowels. Any other letter is a consonant.        |
| `logographic` | `true` for a script that writes meanings; see [logographic scripts](#logographic-scripts).   |

**Rows.** A row is `[from, to]`, or `{ from, to, before, at }` with the two
conditions optional. `from` is one or more characters; `to` is any number of
them, none included. A mapping that drops a language's vowels writes `[a, ""]`.
`rows` is a list, never a keyed map, so `A` and `a` are two rows.

**How a mapping reads text.**

- **The longest match wins.** In the note above `th` is one letter, and `t` and
  `h` are read only where `th` does not match. Among rows of one length, a row
  whose condition holds comes before a row with none, and otherwise the earlier
  row wins.
- **A row whose condition fails is skipped.** `before: vowel` holds when the next
  character is one of `vowels`; `before: consonant` when it is any other
  letter; neither holds at the end of the text. `at: start` holds at the first
  character of the run or after white space or punctuation; `at: end` holds at
  the last character or before white space or punctuation. In the note above,
  `y` is the consonant letter before a vowel and the vowel `i` elsewhere.
- **Capitals and marks need rows of their own.** A row matches the character as
  written, so `L` and `l` are two rows, and a script with no capitals gives both
  the same code point. The full stop and the comma are characters too: a run
  that holds one needs a row for it, or the face-coverage check reports it.
- **A character no row matches passes through unchanged,** and the face-coverage
  check then reports it. A mapping for a face that draws nothing on roman code
  points lists every letter the spelling uses.

**Fonts.** `fonts` lists each face the mapping may be used with, as a list of
`{ font, rows }`. A face may carry rows of its own, which a run in that face
tries first (longest match among them) before the shared rows. That is the way
to write a sound differently in a variant face. The generic families `mono`,
`serif` and `sans` are not listed. The lint checks that every listed face draws
every code point that its own rows, the shared rows it can reach and the
lexicons' native forms for it write.

**Code points above U+FFFF in YAML.** A double-quoted YAML string writes a
code point by its escape, and the left-to-right scripts sit in plane 15, so
they take the eight-digit `\U`: `"\U000F0230"` is U+F0230, and the four-digit
`\u` reaches only code points up to U+FFFF. Both forms mean the same thing.
`package-build format --write` (Prettier) rewrites such an escape into the
character itself, so a mapping note on disk usually holds the raw Private Use
characters, as the note above does. Those read only in one of the fonts
package's faces or its editor fonts, and elsewhere show as boxes. The
convention is a trailing comment, `# U+F0230`, on every row, which keeps the
note readable in any editor and survives formatting. A row that writes several
code points lists them all in its comment.

**Where the checks sit.** Every key is checked at its own line and column:

> `` `data.map.name` is `Vyl_Semaron`; a map's name is lowercase letters, digits and `-` ``

> `` `data.map.rows[4]` has `before: consonant`, and the map states no `vowels` to read it by ``

> `` `data.map.rows[1]` has an empty `from`; a row matches one or more characters ``

> `` `data.map.fonts` is empty; a map lists each face it is drawn in ``

> `` `data.map.rows[5]` writes U+F0239, which the font `semaron-kuriale`, listed in `data.map.fonts`, does not draw ``

A row with a fault is left out of the map and the rest apply.

## How a mapping treats punctuation

The toolchain is used with one convention for marks: **mood, questions and
quotation are carried by words, not marks,** unless a language's note rules
otherwise. A mapping therefore lists the marks its script has and nothing more.
In the sample, a comma and a full stop are the script's one point:

```yaml
- [".", "\U000F0268"] # U+F0268
- [",", "\U000F0268"] # U+F0268
```

(Formatting rewrites the escapes, as above.) A character with no row passes
through unchanged, and the face does not draw it, so a question mark in a
mapped run is an error that names the mark and the mapping:

> `` `?` (U+003F) is not drawn by the font `semaron-kuriale`, and the map `semaron` has no row for it ``

The remedy is to write the question or the quotation in words, as the language
does, and leave the mark out of the run. A language whose note rules
otherwise gets rows for its marks in the mapping, and the check stops
reporting them. The same holds for the digits, the hyphen and the catch: a row
for each makes the mark part of the script; none leaves it out.

## The dictionary first

The sound rules belong to the script and the exceptions belong to the language.
With `lang=` naming a language that has a `note`, the build reads the
language's `data.words` before the rows.

**How a run is split into words.** A word is a run of letters, combining marks
and digits, with an apostrophe (`'` or `’`), a hyphen or an en dash joining two
such runs into one word. `k'aralzon` is one word and `zaron-lonak` is one word
for lookup. Everything between words is spelled by the rows.

**How a word is written.** The word is looked up as written, and then in
lowercase. A word that states a `native` form for the run's mapping (for the
run's face where an entry names one, else the one for no face) is written by it
whole. Every other word, with every derived form of an exception word, is
spelled by the rows. There are no stem-level exceptions: the plural of an
exception word is another word, and the rows spell it.

**A native form states only an exception.** `native` is a list of
`{ map, font, text }` on a word:

```yaml
- form: zaron
  class: n
  field: Law
  gloss: an oath
  native:
    - { map: semaron, text: "\U000F0246\U000F0248\U000F023F\U000F023D\U000F023C" }
```

`map` is the mapping's `name`, `font` optionally limits the form to one face, and
`text` is the word as the script writes it. A form that the rows already give is
redundant, and the lint says so:

> `` `data.words[0].native[0]` states what the rows already give: the map `semaron` spells `zaron` so in the font `semaron-kuriale`; a native form is stated only where the rows spell the word differently ``

so a dictionary holds its exceptions and nothing else. The other checks of a
native form (an unknown map, a face the map is not for, a second form for one
map, a character the face does not draw) report at the entry:

> `` `data.words[0].native[0].map` is `semron`, which is not a map: a native form names the `data.map.name` of a mapping note; did you mean `semaron`? ``

> `` `data.words[0].native[2]` states a second native form for the map `semaron`; the first is `data.words[0].native[0]` ``

> `` `data.words[0].native[0]` holds U+F024F, which the font `semaron-kuriale`, listed in the map `semaron`, does not draw ``

**Capitals.** A capitalised word that is found only in lowercase takes its
capital from the rows: the rows spell the first sound as written and in
lowercase, and where the native form begins with the lowercase spelling, that
beginning is replaced by the capital. A native form that does not begin the way
the rows begin the word cannot be capitalised, and the capitalised word is an
error at its place in the run:

> `` `Orlan` is capitalised, and the native form the lexicon of `vyl` states for `orlan` under the map `semaron` does not begin as the rows spell its first letter, so the rows cannot capitalise it; state `Orlan` as a word of its own with its native form ``

The fix is the one the message names: a lexicon word `Orlan` with its own
native form, which the lookup as written finds first.

A character the face does not draw inside a native form reports at the word:

> `` `zaron` is written U+F024F by the lexicon of `vyl` for the map `semaron`, which the font `semaron-kuriale` does not draw ``

A native run whose explicit `lang=` is a bare BCP 47 tag, and a declared
language with no `note` are spelled by the rows alone.

## The checks

A run with `lang=`, whose language has a `note`, is checked word by
word. This applies to Roman language-only runs and native runs alike;
`.nativefont` selects presentation and does not turn vocabulary checks off. The comparison is case folded and NFC, with `’` read as `'`. A word passes
when it is any of these:

1. **A lexicon word:** a `data.words[].form` of the language. A form listed in a
   word's `variants` is a known word too. A multi-word or compound form
   contributes each of its parts.
2. **A word of a registered name:** a word of a `name` in the language note's own
   `data.register`, under any `tongue` but `translation`, which stands for an
   English rendering and never counts. A name of several words is checked word
   by word.
3. **A regular form of a lexicon word,** made by one rule the language states:
   - a noun's plural, its own `plural` or the first `data.grammar.plural` row
     that fits;
   - a verb's form with one ending of `data.grammar.verbs.persons`, which takes
     the place of a closing `data.grammar.verbs.replaces` where the pattern
     states one;
   - a suffix of `data.affixes` that states `replaces`, or its `front` form;
   - an agreeing form or a participle; see
     [agreement, participles and affixes](#agreement-participles-and-affixes).

A compound that is not a word whole is split at its hyphens and en dashes and
each part is checked, so `zaron-lonak` passes when `zaron` and `lonak` do. A
word with no letter, such as a numeral, is skipped. A prefix, and an affix that
states no `replaces`, make no form: `attaches` is prose.

Any other word is an error at its first character, reported once per run, and
it names the language as `lang=` writes it:

> `` `thiruthrimar` is not a word of the `vyl` lexicon, a registered name, or a regular form of one; coin it in the lexicon (or register the name) first ``

**Fix: coin the word,** add it to the language note's `data.words` with its
class, field and gloss, after the invented-word rules of the setting (palette,
Earth collisions and readability) have approved it:

```yaml
words:
  - form: thiruthrimar
    class: n
    field: Law
    gloss: a sworn witness
```

**or register the name** with its tongue in the language's `data.register`:

```yaml
register:
  - { name: Revothar Baremzator, tongue: vylari }
```

**Foreign names.** A foreign name used in a Vylari run is first listed in
Vylari's own register as `other:<tongue>` or `exonym:<tongue>`, and that row is
checked against the tongue's own register in turn: the language note that a
`data.tongues` entry names by its `language` must list the same name under its
own tongue. A misspelt foreign name is caught where it is listed:

> `` `Dunharra` is registered as `other:vylari`, but the register of Vylari Language (skill-vylarilng) lists no `vylari` name `Dunharra`; correct the spelling, or register the name there first ``

Bare `other`, `kept`, `ancient` and `translation` rows are not checked.

**Nothing requires a form.** The check recognises forms and never demands one: a
noun stated with its own plural and the plural the rule gives both pass, and no
check asks that a word takes the right ending.

**Face coverage** follows the mapping. A character left over after the rows
reports once per run, at the start of the matched `from`:

> `` `x` (U+0078) is not drawn by the font `semaron-kuriale`, and the map `semaron` has no row for it ``

and a row that writes a code point the face lacks reports where it is applied:

> `` `ch` maps to U+F0299 in the map `semaron`, which the font `semaron-kuriale` does not draw ``

**Keys that name nothing.** A key that names nothing is the one finding, and
the run is not then checked against a face or a lexicon it cannot reach.

> `` `semaron-kurial` is not a font: `font=` names an installed face, or `mono`, `serif` or `sans`; did you mean `semaron-kuriale`? ``

> `` `semron` is not a map: `map=` names the `data.map.name` of a mapping note; did you mean `semaron`? ``

> `` `q` is not a declared language (`languages` in package-build.config.yaml) or a BCP 47 tag ``

> `` `thuravark-carved` is not a font of the map `semaron`; it is for `semaron-kuriale` ``

> `` `semaron-kuriale` is not a font: `font=` names `mono`, `serif` or `sans`, or a face of @heroiclands/fonts, which this package has not installed ``

The last one means `@heroiclands/fonts` is not installed. A near miss of a
declared language is a warning that fails nothing:

> `` `vly` is read as a BCP 47 tag; did you mean the declared language `vyl`? ``

## Agreement, participles and affixes

Three optional pieces of a language note let the word check accept more forms.
None is required, and none makes any check demand a form.

**Agreement** states which classes agree with a noun and the singular endings
they agree by, one per gender. A word of one of `classes` that closes on one of
`endings` (the longest that leaves a stem) also has that ending swapped for each
other one, and each of those forms takes the `plural` rule:

```yaml
grammar:
  plural:
    - { ending: os, becomes: oi }
    - { ending: on, becomes: oi }
    - { ending: a, becomes: ai }
  agreement:
    classes: [adj, pron]
    endings: [os, a, on]
```

**Participles** attach to the verb root, which is the citation form less its
infinitive ending. A verb closing on one of `root` drops it, and each suffix of
`data.affixes` that `affixes` names attaches to what is left, as its own
`replaces` says or whole where it states none. A participle that closes on an
agreement ending agrees:

```yaml
affixes:
  - { form: "-andar", gloss: "doing it: the present participle", replaces: vowel }
  - { form: "-thos", gloss: "done, suffered: the past participle" }
grammar:
  participles:
    root: [athen, ethen]
    affixes: ["-andar", "-thos"]
```

**`attachesTo`** limits a suffix to words of the classes it lists, as in
`attachesTo: [n, adj]`; a suffix that states none attaches to a word of every
class. `replaces: vowel` takes the place of a closing vowel, letters such as
`replaces: a` take the place of those letters, and a stem that closes otherwise
takes the suffix whole.

With the note above, a run accepts:

| Lexicon word      | Rule        | Forms accepted                                    |
| ----------------- | ----------- | ------------------------------------------------- |
| _alathos_, pron.  | agreement   | _alatha_, _alathon_, _alathoi_, _alathai_         |
| _lokathen_, v.    | participles | _lokandar_, _lokthos_                             |
| _lokathen_, v.    | both        | _loktha_, _lokthon_, _lokthoi_, _lokthai_         |
| _marendos_, n. m. | neither     | _marendoi_ by the plural rule alone; no _marenda_ |

A near miss such as _alathe_ is still an unknown word. To see every form the
rules give, each beside the word it comes from, run
`package-build lexicon vyl --map semaron --derived`.

The keys are checked where they sit:

> `` `data.grammar.agreement.classes[0]` is `adjective`, which is not a word class; did you mean `adj`? ``

> `` `data.grammar.agreement.endings` must state at least two endings for a word to agree among ``

> `` `data.grammar.participles.affixes[2]` is `-zz`, which is not a suffix of `data.affixes` ``

> `` `data.grammar.participles.affixes[3]` is `an-`, a prefix; a participle is a suffix on the root ``

> `` `data.affixes[1].attachesTo[0]` is `verb`, which is not a word class; did you mean `v`? ``

## Logographic scripts

**A script that writes meanings is written from the dictionary, never by
sound.** Its mapping note states `logographic: true`, and every word of a run
under it comes from the language's lexicon. The rows write only the text
between words: spaces, points and anything else with no letter. A word never
falls through to the rows, so a word the lexicon gives no writing is an error
rather than a guess.

A word is written by the first of these that gives a writing, matched case
folded because the script has no capitals:

1. **Its own `native` entry** for the map (the run's face where an entry names
   one, else the one for no face), or the entry of a set compound written its
   own way.
2. **Its parts, joined.** The roots of the entry's `built` list in order; each
   piece is a lexicon word or an affix of `data.affixes` with a `native` entry of
   its own, resolved the same way down. A noun's plural and a verb's present
   forms are the stem's writing followed by the ending's, which
   `data.grammar.native` states once per ending: `plural`, or one of the persons
   `I`, `you`, `heShe`, `we`, `youAll` and `they`.
3. **Its hyphenated parts,** each by these same steps, so `Gar-halzunet` is
   `Gar-`'s writing followed by `halzunet`'s.
4. **Otherwise an error** at the word.

Forms outside the parts rule (a suffix that replaces a vowel, an agreeing form,
a participle) have no writing of their own. They are coined as lexicon words
with a writing, or written in signs.

```yaml
affixes:
  - form: "-unet"
    gloss: "a thing made of"
    native:
      - { map: zethu, text: "𞯇" }
grammar:
  plural:
    - { ending: "", becomes: "im" }
  native:
    - { ending: plural, map: zethu, text: "𞯡" }
words:
  - form: halzi
    class: n
    field: The body
    gloss: heart
    native:
      - { map: zethu, text: "𞪻" }
  - form: halzunet
    class: n
    field: The body
    gloss: the account
    built: [halzi, -unet]
```

`[halzi halzunet halziim]{lang=khel font=khelathi-zethu-glyphs map=zethu .nativefont}` is
written U+1EABB, then U+1EABB U+1EBC7, then U+1EABB U+1EBE1, with the spaces the
rows write between them. An affix's `native` and `data.grammar.native` are read
only under a logographic map; naming any other map is an error at the entry.

**Ambiguity.** One roman form that stands for entries written differently is an
error naming every entry's gloss, and so is one form with a writing for one
sense and none for another. Nothing is guessed. List the words with
`package-build lexicon khel --map zethu`: the third column says where each
writing comes from, `own` for a stored writing, `parts` for one the pieces give,
`none` for a word with no writing, and `ambiguous` for a form a run cannot
write. An ambiguous word's second column is still that entry's own writing, so
pick the entry by its gloss and write those signs directly in the run. Signs
typed in a run hold no letter, so they are no word and pass through as typed.

**Foreign names.** A registered name is written like any other word, so a name
with no writing is an error. A foreign name is written deliberately: its signs
typed directly, or through a mapping whose rows read a sign-by-sign notation
(sign ids and joiners, as in Manuel de Codage input), which an author writes the
way any other mapping is written. A native run with an explicit bare BCP 47
tag such as `lang=und` has no configured dictionary and uses the rows alone;
it still needs `.nativefont`, an explicit map for conversion and an explicit
font where no language default supplies one.

**An unknown word gets two errors:** the lexicon check reports it is no word of
the language, and the writing check reports it has no writing.

> `` `zamlu` has no `zethu` writing in the `khel` lexicon, and its parts do not give one; state one, or write the word directly in signs ``

> `` `nelgir` stands for 2 words of the `khel` lexicon that the map `zethu` writes differently, “a god” and “god”; write the word directly in signs, choosing by its sense in `package-build lexicon khel --map zethu` ``

> `` `halzi` has no `zethu` writing: the map `zethu` is logographic, and the run names no `lang=` whose lexicon writes it; mark the run with its language, or write the word directly in signs ``

> `` `data.grammar.native[3]` writes the ending `they`, and `data.grammar.verbs` states no `persons` ``

## Emphasis in a script

Inside a run set in a face, `*…*` and `**…**` are written as in English. No
script marks a stressed word by a bold or a slant, so the build sets emphasis by
the scribal convention the text's language or script states:

| Convention | Site and Foundry                                   | Book                  |
| ---------- | -------------------------------------------------- | --------------------- |
| `rubric`   | `<em class="emph-rubric">`, in red                 | in the book's red ink |
| `overline` | `<em class="emph-overline">`, with a line above it | under an overline     |
| none       | `<em>` with no class, in the face's Regular        | in the face's Regular |

`**…**` gives a `<strong>` in the same way. The element stays an `<em>` or a
`<strong>`, so a screen reader and a copied passage keep the emphasis. The face
keeps its Regular: no slant and no added weight. `_…_` is emphasis equal to
`*…*`, and `__…__` equal to `**…**`; a strikethrough is an error in a face.

**The convention is the language's, else the script's.** A language note may
state `data.emphasis` as `rubric`, `overline` or `words`. Otherwise the script
note that lists the run's face states it in `data.script`; otherwise there is
none. A script note is a `skill` note of `subType: script`:

```yaml
data:
  script:
    fonts: [semaron-kuriale]
    emphasis: rubric
    strongEmphasis: overline
```

`fonts` lists the faces of the script (a face belongs to one script),
`emphasis` sets both `*…*` and `**…**`, and `strongEmphasis` optionally sets
`**…**` alone. A tongue that states nothing takes its script's convention.

**Non-English spans do not take Markdown emphasis.** Bold and italic markup in
a span with an effective non-English language is an error, whether it has a
font or not, and whether its language is declared on that span or inherited.
English (`en`) and English BCP 47 tags remain eligible. Escaped literal
delimiters are not emphasis. This restriction applies throughout the note.

`data.emphasis: words` also makes emphasis an error: it says the language marks
stress with a word, so stars in its runs are refused:

> `` `ban` marks emphasis with a word, not a mark; write the word ``

Underscores and strikethrough are errors in a face. A stressed word is best
enclosed whole: a star inside a word splits it, so a row or lexicon word that
crosses the star is not matched.

**The `--rubric` token.** The theme's `--rubric` is a warm red for its dark
ground, and the book prints its own. A rubric carries emphasis by colour alone,
so a contrast guard holds it to 4.5:1 against every ground the text sits on and
1.75:1 against the body text, so a reader who cannot see the hue still sees a
lighter or darker word. A site that overrides `--rubric` keeps both ratios.

The keys are checked where they sit:

> `` `data.script.emphasis` should be `rubric` or `overline`, but reads "rubrik". Did you mean "rubric"? ``

> `` `data.script.fonts` is empty; a script lists each face it is written in ``

> `` `data.emphasis` states how a language marks emphasis, and this note's `subType` is not `language` ``

## Verse

### A poem in a verse fence

A poem is written in a `verse` fence, whose lines and stanzas the build
preserves. The keys of the previous sections go on the fence. Prettier leaves
the contents of a fence byte for byte, which is why a poem is a fence and not
paragraphs: indentation, line breaks and spans survive formatting untouched.

````markdown
```verse {lang=vyl font=semaron-kuriale map=semaron .nativefont}
Lokazor lonak,
  lokamen zaron.
```
````

### Verse in columns

`form=epic` records the poem's kind without inferring its layout or metre.
`cols` is a positive whole number, defaulting to `1`. A single-column poem
uses its physical lines without numeric prefixes. With `cols` above one,
every content line starts with a column number and one or more spaces.
Blank lines separate logical verse rows, and `***` separates stanzas.

Numbers are in `1..cols` and nondecreasing within a row. Skip a number to
leave that cell empty. Repeat a number for as many readings as the column
needs: its first reading is foreground, and all its later readings are grey.
That choice is independent for each column and resets at each new row.

Here is a sparse three-column poem. The first row omits column two. The next
fills it, and the last row begins a new stanza:

````markdown
```verse {numstep=1 lang=vyl cols=3}
1 [Lokazor lonak zaron.]{lang=vyl .nativefont}
3 [He walks the oath road.]{lang=en}
3 [Lokazor lonak zaron.]{lang=vyl}

1 [Lokamen lonak zaron.]{lang=vyl .nativefont}
2 [Nothing to say]{lang=en}
3 [I walk the oath road.]{lang=en}
3 [Lokamen lonak zaron.]{lang=vyl}

***

1 [alathos lokazor.]{lang=vyl .nativefont}
3 [That one walks.]{lang=en}
3 [alathos lokazor.]{lang=vyl}
```
````

Each native span opts in explicitly and uses the Vylari note's configured
map and font. Each Roman repeat is authored separately and stays Roman.
`lang=` identifies the language without choosing a column; number prefixes
alone place the readings. Inline links, language changes and authored spaces
remain inside the chosen reading. Leading periods indent that reading.

`numstep=N` counts logical rows, so repeated readings and empty cells do not
advance its counter. Every target aligns each row's cells at the top, and
narrow web or Foundry displays stack the cells in numbered order. A
right-to-left reading stays in its cell and follows its own script's direction.
Invalid counts and prefixes are located at the authored value or number;
missing prefixes are located at the line's first content character.

### Metre

`scan=` turns on a beat check. It names a metre declared once in the package,
as an entry of a `doc` note's `data.metres`:

```yaml
data:
  metres:
    - { name: trimeter, beats: 3, kind: accentual }
```

`name` is lowercase letters, digits and `-`, unique in the package; `beats` is
the beats of one line, a whole number above zero; `kind` is `accentual`, the
only kind: a beat falls on a stressed syllable and the length of a syllable is
not counted. A fence that states `scan=` with the declared name and a `lang=`
whose language note states `data.sounds.stress` is counted line by line:

````markdown
```verse {lang=vyl scan=trimeter}
Lokazor lonak zaron.
Lokamen lonak zaron.
```
````

**The stress rule** is `data.sounds.stress`, `{ two, longer, mark }`. `two`
(`first` or `last`) places the stress in a word of two syllables; `longer`
(`first`, `antepenultimate`, `penultimate` or `final`) places it in a word of
three or more, on its first syllable or counted from its end; `mark` (`acute`, `grave` or `circumflex`) is a
diacritic that moves the stress to the syllable it sits on. Syllables are vowel
groups: a vowel is a letter whose base is `a`, `e`, `i`, `o` or `u`, and a pair
that the language lists in `data.sounds.syllables.vowelPairs` is one syllable.

**The beat convention, in plain words:**

- Every word of two or more syllables has one beat, on its stressed syllable.
- A one-syllable noun, verb, adjective, numeral or name has a beat. A
  one-syllable particle, preposition, conjunction, adverb or pronoun has none.
  The lexicon entry's class decides, and a form that the language's rules derive
  takes its word's class. A word whose entries differ in class is a beat that
  may be left out.
- A one-syllable word the lexicon does not hold is a content word and has a
  beat; the word check reports the word separately.
- A word of four or more syllables may take a second, lighter beat on its first
  syllable where the line needs it, unless its stress is already there.
- The caesura is not written.

A line scans when its count can be the metre's, choosing second beats as
needed. A line that cannot is a warning at that line, giving the count without
the second beats and, in brackets, with all of them:

> ``this line has 4 beats (5 with secondary beats); the metre `hexameter` has 6``

**The check is author-side.** Readers see nothing of it: the rendered fence
carries `data-metre` with the metre's name and nothing a reader sees. A fence
without `scan=` is not counted. `scan=` is refused where it cannot mean
anything, each an error:

> `` `hexamter` is not a declared metre: `scan=` names the `name` of a `data.metres` entry of a `doc` note; did you mean `hexameter`? ``

> `` `scan=` counts beats by a language's stress rule: the fence needs a `lang=` ``

> ``the language `vyl` states no `data.sounds.stress`, which `scan=` counts beats by``

> ``the language `vyl` is not a configured language with a `note`, so it has no stress rule for `scan=` to count beats by``

> `` `scan=` counts the beats of one language's lines; a verse with cols>1 groups independent physical lines ``

A repeated metre name is an error too:

> `` `data.metres[1].name` is `trimeter`, which this note declares twice; a metre's name is unique ``

## Scripts written in columns

A script written in vertical columns, read from the right, states it on its
script note:

```yaml
data:
  script:
    fonts: [teng-chou]
    emphasis: rubric
    direction: vertical-rl
```

A passage in that script goes in a `scroll` fence. Its lines are joined into
paragraphs, and each paragraph starts at the top of a fresh column. `rows=`
sets the characters in a column and `cols=` the columns in a panel:

````markdown
```scroll {rows=25 cols=12 lang=tsu map=tengchou .nativefont}
chen teng chou hing
tan tsou dou rou

gen chei chou tsuen
```
````

Where the Tantsou note states `writtenIn: { map: tengchou, font: teng-chou }`,
` ```scroll {rows=25 cols=12 lang=tsu .nativefont} ` is enough.

The site, the preview and Foundry set it in columns, in a panel that scrolls
sideways from the right. The book draws it as panel images from the face's
outlines, each with its roman text as alt text. A span in the same script stays
horizontal, inline in its line. A `scroll` fence in a script that states no
direction is an error. See
[scrolls](../authoring/links-and-markup.md#scrolls) for every attribute, the
defaults on each target and the errors.

## The core vocabulary

A setting can name the concepts every one of its languages has a word for, and
measure each language against them from data. Three keys carry it:

| Key                    | On              | Meaning                                                                              |
| ---------------------- | --------------- | ------------------------------------------------------------------------------------ |
| `data.concepts`        | a `doc` note    | The concept list: `{ id, gloss, group }` entries, in the order the report lists them |
| `data.core`            | a language note | `true` where the language must cover the list                                        |
| `data.words[].concept` | a word          | The id of the concept the word serves, or a list of ids for a word serving several   |

**The list lives in the same package as the words that use it.** An `id` is
lowercase letters, digits and `-`, unique in the package; `gloss` and `group`
are not blank. A word's `concept` that names no entry of a list is an error at
the id, with the nearest id offered:

> `` `smel-noun` is not a core concept; did you mean `smell-noun`? ``

A daughter language reads the words of its `data.family` chain as its own, so a
parent's tagged word covers the daughter's concept. `data.core` is not
inherited: each language that must cover the list states it.

`package-build core [--language <name>] [--json]` reports, for each language
that states `core: true`, the concepts it has no word for, grouped and counted;
`--language` reports one language by name, shortcode or reference whether or
not it states `core`, and `--json` serves an agent working through it. **A
missing concept is never a lint failure:** the report is the work list, and the
exit status stays 0.

## Rendering and delivery

One pre-pass rewrites marked text at the head of every target: the site, the
Foundry compile, the book and the preview. It wraps the converted run in the
face's class (or a generic-family class), gives it the `lang` from the language's
tag, and gives a block in a right-to-left face `dir="rtl"`. It never writes
`<bdo>`, `<bdi>` or a Unicode direction control, because Foundry's editor strips
the first two and a right-to-left face carries its direction in its code points.
A run converted for a right-to-left face is hidden from the site's search index.

| Target  | What a marked run becomes                                                                  |
| ------- | ------------------------------------------------------------------------------------------ |
| Site    | `<span class="script hl-semaron-kuriale" lang="art-x-vyl" data-pagefind-ignore="true">`    |
| Foundry | the same classes and `lang`, with the font stylesheet in the module's `styles`             |
| Book    | the text set in the face; a real language's tag sets hyphenation, an invented tag does not |

Readers install nothing. When a note uses a face, the fonts are served from the
package's own output: the site copies `fonts.css`, the WOFF2 files and the
licence to `fonts/heroiclands/<version>/` beside the pages and links them from
every page; Foundry stages the same files; the book adds the TrueType files to
the typesetter's font search path. A package that has not installed the fonts, or
whose notes set no text in a face, ships none of it.

## The commands

`package-build transliterate <map> [--lang <language>] [--font <slug>] [--hex] [text..]`
maps a passage exactly as the build maps a run marked
`lang=<language> .nativefont map=<map> font=<slug>`. The text is the words given; `-` or none reads standard input.
`--font` defaults to the language's `writtenIn` face where the mapping is drawn
in it, and is otherwise required when the mapping lists more than one face.
`--hex` prints `U+XXXX` code points separated by spaces.

```console
$ package-build transliterate semaron --lang vyl --hex zaron lonak
U+F0246 U+F0248 U+F023F U+F023D U+F023C U+0020 U+F023A U+F023D U+F023C U+F0230 U+F0239
$ package-build transliterate semaron --hex zaron
U+F0246 U+F0230 U+F023F U+F023D U+F023C
```

The first run writes `zaron` by its exception, and the second, with no
`--lang`, spells it by the rows.

`package-build lexicon <language> [--map <map>] [--font <slug>] [--derived] [--json]`
lists every word of the language with its native form under the map, or under
the language's `writtenIn` script when `--map` is left out, tab-separated: the form,
the native form, `exception` or `rows`, the class and the gloss. `--derived`
adds the forms the language's rules derive, each with the word it comes from,
`--json` prints an array instead, and under a logographic map the third column
is `own`, `parts`, `none` or `ambiguous`.

```console
$ package-build lexicon vyl --map semaron | cut -f1,3-
zaron  exception  n  an oath
lonak  rows  n  a road
lokathen  rows  v  to walk
alathos  rows  pron  he, that one
thiruthrimar  rows  n  a sworn witness
```

`package-build core [--language <name>] [--json]` reports the core vocabulary
(see [the core vocabulary](#the-core-vocabulary)).

## A worked example

This builds a small package from nothing: a language, a script, a couplet and a
poem. It is the guide's own test: every file below is written into a project and
linted, and the findings printed are the ones the lint reports. The mapping note
is the one from [mapping notes](#mapping-notes).

Install the fonts, then write the configuration. A package that declares
dependencies in its configuration fetches their indexes with
`package-build deps fetch` before it lints; the sample declares none.

Install the fonts, then write the configuration:

```bash
npm install --save-dev @heroiclands/fonts
```

**`package-build.config.yaml`**

```yaml
contentPackage: demo
packageKind: modules
compatibility:
  minimum: "14.359"
stats:
  lastModifiedBy: demobuilder0000
packs:
  - { name: journals, label: Journals, type: JournalEntry, default: true }
languages:
  vyl: { tag: art-x-vyl, note: skill-vylarilng }
```

The concepts and the metre the sample uses live on a `doc` note:

**`assets/content/Docs/Core_Concepts.md`**

```markdown
---
shortcode: coreconcepts
name: { full: Core Concepts }
type: doc
subType: reference
data:
  concepts:
    - { id: walk-verb, gloss: to walk, group: motion }
    - { id: road-noun, gloss: a road, group: places }
    - { id: oath-noun, gloss: an oath, group: law }
    - { id: see-verb, gloss: to see, group: senses }
  metres:
    - { name: trimeter, beats: 3, kind: accentual }
---

The concepts every language of the sample setting has a word for, and the metres
its poems keep. This note is the guide's own sample and carries no canon beyond
what the guide's examples need to run.
```

The language note holds the dictionary, the grammar, the stress rule and the
core flag:

**`assets/content/Skills/Vylari.md`**

```markdown
---
shortcode: vylarilng
name: { full: Vylari Language }
type: skill
subType: language
data:
  writtenIn: { map: semaron, font: semaron-kuriale }
  core: true
  fields:
    - { name: Law, holds: "Oaths, seals and roads." }
  affixes:
    - {
        form: "-andar",
        gloss: "doing it: the present participle",
        replaces: vowel,
        attachesTo: [v],
      }
    - { form: "-thos", gloss: "done, suffered: the past participle" }
  grammar:
    plural:
      - { ending: os, becomes: oi }
      - { ending: on, becomes: oi }
      - { ending: a, becomes: ai }
      - { ending: "", becomes: oi }
    verbs:
      replaces: then
      persons: { I: men, you: zen, heShe: zor, we: mar, youAll: zar, they: zoi }
    agreement:
      classes: [adj, pron]
      endings: [os, a, on]
    participles:
      root: [athen, ethen]
      affixes: ["-andar", "-thos"]
  sounds:
    stress: { two: first, longer: penultimate }
    syllables:
      vowelPairs: [ai, au]
  words:
    - form: zaron
      class: n
      field: Law
      gloss: an oath
      concept: oath-noun
      native:
        - { map: semaron, text: "󰉆󰉈󰈿󰈽󰈼" }
    - { form: lonak, class: n, field: Law, gloss: a road, concept: road-noun }
    - { form: lokathen, class: v, field: Law, gloss: to walk, concept: walk-verb }
    - { form: alathos, class: pron, field: Law, gloss: "he, that one" }
---

The imperial tongue of the sample setting, written in the Semaron script and
read aloud at its court. The lexicon here is a small sample made for the guide.
```

A note with a run. The couplet uses a word the lexicon does not hold:

**`assets/content/Lore/Oath_Road.md`**

```markdown
---
shortcode: oathroad
name: { full: The Oath Road }
type: lore
---

The lintel over the door of the oath road is cut with a couplet, and the
stonecutter set the couplet in the script of the court, so that every traveller
could read it as the court reads it.

[Lokazor lonak thiruthrimar, lokamen zaron.]{lang=vyl font=semaron-kuriale map=semaron .nativefont}
```

Linting reports the unknown word, at its first character:

```text
assets/content/Lore/Oath_Road.md:11:16: error: `thiruthrimar` is not a word of the `vyl` lexicon, a registered name, or a regular form of one; coin it in the lexicon (or register the name) first
```

The word is a coinage. It goes into the dictionary before it is used, so the
language note gains an entry:

**`assets/content/Skills/Vylari.md`**

```markdown
---
shortcode: vylarilng
name: { full: Vylari Language }
type: skill
subType: language
data:
  writtenIn: { map: semaron, font: semaron-kuriale }
  core: true
  fields:
    - { name: Law, holds: "Oaths, seals and roads." }
  affixes:
    - {
        form: "-andar",
        gloss: "doing it: the present participle",
        replaces: vowel,
        attachesTo: [v],
      }
    - { form: "-thos", gloss: "done, suffered: the past participle" }
  grammar:
    plural:
      - { ending: os, becomes: oi }
      - { ending: on, becomes: oi }
      - { ending: a, becomes: ai }
      - { ending: "", becomes: oi }
    verbs:
      replaces: then
      persons: { I: men, you: zen, heShe: zor, we: mar, youAll: zar, they: zoi }
    agreement:
      classes: [adj, pron]
      endings: [os, a, on]
    participles:
      root: [athen, ethen]
      affixes: ["-andar", "-thos"]
  sounds:
    stress: { two: first, longer: penultimate }
    syllables:
      vowelPairs: [ai, au]
  words:
    - form: zaron
      class: n
      field: Law
      gloss: an oath
      concept: oath-noun
      native:
        - { map: semaron, text: "󰉆󰉈󰈿󰈽󰈼" }
    - { form: lonak, class: n, field: Law, gloss: a road, concept: road-noun }
    - { form: lokathen, class: v, field: Law, gloss: to walk, concept: walk-verb }
    - { form: alathos, class: pron, field: Law, gloss: "he, that one" }
    - { form: thiruthrimar, class: n, field: Law, gloss: a sworn witness }
---

The imperial tongue of the sample setting, written in the Semaron script and
read aloud at its court. The lexicon here is a small sample made for the guide.
```

The lint is now clean, and the conversion can be read. `package-build transliterate`
prints the code points the build writes for the couplet:

```console
$ package-build transliterate semaron --lang vyl --hex "Lokazor lonak, lokamen zaron."
U+F020A U+F023D U+F0239 U+F0230 U+F0246 U+F023D U+F023F U+0020 U+F023A U+F023D U+F023C U+F0230 U+F0239 U+F0268 U+0020 U+F023A U+F023D U+F0239 U+F0230 U+F023B U+F0233 U+F023C U+0020 U+F0246 U+F0248 U+F023F U+F023D U+F023C U+F0268
```

The site sets the run as

```html
<span class="script hl-semaron-kuriale" lang="art-x-vyl" data-pagefind-ignore="true"
  >󰈊󰈽󰈹󰈰󰉆󰈽󰈿 󰈺󰈽󰈼󰈰󰈹󰉨 󰈺󰈽󰈹󰈰󰈻󰈳󰈼 󰉆󰉈󰈿󰈽󰈼󰉨</span
>
```

where the characters are the code points above: `Lokazor` begins with the
capital `L` of the rows, `zaron` is the exception's long vowel, and the comma
and full stop are the script's one point.

A poem in columns and a poem with its metre checked sit on one note. Both parse
with no finding: the first sets native Vylari in column one and English over Roman
Vylari in column three, with a sparse middle cell, and the second's lines each carry three beats.

**`assets/content/Lore/Walking.md`**

````markdown
---
shortcode: walking
name: { full: The Walking }
type: lore
---

The walking of the oath road is sung in two settings. The first sets the poem
beside its translation, and the second keeps the metre that the court keeps, so
that a line with the wrong count is reported to the author who wrote it.

```verse {numstep=1 lang=vyl cols=3}
1 [Lokazor lonak zaron.]{lang=vyl .nativefont}
3 [He walks the oath road.]{lang=en}
3 [Lokazor lonak zaron.]{lang=vyl}

1 [Lokamen lonak zaron.]{lang=vyl .nativefont}
2 [Nothing to say]{lang=en}
3 [I walk the oath road.]{lang=en}
3 [Lokamen lonak zaron.]{lang=vyl}

***

1 [alathos lokazor.]{lang=vyl .nativefont}
3 [That one walks.]{lang=en}
3 [alathos lokazor.]{lang=vyl}
```

```verse {lang=vyl scan=trimeter}
Lokazor lonak zaron.
Lokamen lonak zaron.
```
````

A script note gives Semaron its emphasis convention, and a run with double stars then
sets them in red:

**`assets/content/Skills/Scripts/Semaron.md`**

```markdown
---
shortcode: semaronscrpt
name: { full: Semaron Script }
type: skill
subType: script
data:
  script:
    fonts: [semaron-kuriale]
    emphasis: rubric
---

The Semaron script, as the sample setting writes it. It marks a stressed word in
red ink, the rubric of its scribes, and the guide's emphasis example depends on it.
```

**`assets/content/Lore/Marked_Door.md`**

```markdown
---
shortcode: markeddoor
name: { full: The Marked Door }
type: lore
---

The door is marked with the same words as the lintel. Although Semaron's
convention is rubric, this Vylari span uses no Markdown emphasis: spans with a
non-English language cannot contain bold or italic markup.

[Lokazor lonak, zaron.]{lang=vyl font=semaron-kuriale map=semaron .nativefont}
```

Finally, the core report lists what the language still lacks:

```console
$ package-build core --language vylarilng
Vylari Language (skill-vylarilng): 1 of 4 core concepts have no word
  senses: 1 of 1
    see-verb	to see
```

Everything in this package comes from the guide. A new script follows the same
steps: a mapping note for its face, `languages` entries for the languages
written in it, a language note with the dictionary, and runs marked with the
language key and native presentation class.
