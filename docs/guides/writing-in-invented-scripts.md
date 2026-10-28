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
markup](../authoring/links-and-markup.md#marking-language-font-and-encoding),
[format details](../reference/format-details.md#text-marked-with-a-language-font-or-encoding),
[commands](../commands.md#package-build-encode-text),
[configuration](../configuration.md#languages) and
[diagnostics](../diagnostics.md). This guide ties them into one account and
works one example through from start to finish.

The examples write Vylari, a tongue spelled in roman letters and drawn in the
Semaron script. The lexicon and the notes in them are the guide's own sample.

## The model

A language defines its words, meanings and pronunciation. An encoding defines
which source sequences write which characters. A face draws those characters.
Keeping these facts in their owning sources gives each passage one consistent
conversion on the site, in Foundry and in the book.

| Fact                       | Source                                    | Selection                      |
| -------------------------- | ----------------------------------------- | ------------------------------ |
| Language and vocabulary    | Configuration and language note           | `lang=`                        |
| Authored lexical spelling  | Word, affix or grammatical `native` entry | Encoding and optional face     |
| Encoding rows and controls | Encoding document frontmatter             | `enc=` document Address        |
| Font face                  | Installed `fonts.json`                    | `font=` or the encoding's font |

Language identification alone retains Roman text. `enc=` selects an encoding
document, which infers its language and font. Unknown source characters are
errors; a face drawing a character does not make it a spelling mapping.

An encoding uses exact round trips by default. If its script omits Roman
distinctions, its note can explicitly select `rules.roundTrip: canonical`.
Decoding then gives an authored conventional spelling; authoritative lexicon
entries can recover fuller word forms. The encoder adds no invisible metadata
to restore erased spelling. See the [canonical encoding contract](../encoding-core.md#executable-rules)
for aliases, inherent vowels and shared word separators.

## Language and native presentation

`enc=` names an encoding document, with `doc` as its default Address type:
`[say.]{enc=aelwsemaronenc}` selects `doc-aelwsemaronenc`. That document supplies
its configured `language` and single `font`; an explicit `lang=` must identify
the same language, and an explicit `font=` must be that font. Another face is
a separate encoding document.

`enc=default` leaves Roman text as written and is the default when no encoding
is selected. `lang=` still identifies the text and selects its language's
vocabulary; `font=mono`, `serif`, `sans` or an installed font selects its face
without encoding it. Language identification does not select an encoding.

```markdown
[say.]{enc=aelwsemaronenc}
[say.]{enc=doc-aelwsemaronenc lang=aelw font=semaron-kuriale}
[say.]{lang=aelw enc=default}
```

Class-only emphasis and name children belong to the parent's complete logical
text; encoding preserves their rendered wrappers. A child with its own run
keys makes a separate presentation choice. `enc=default` inside an encoded
parent keeps the inherited language but does not inherit its inferred script
face. An explicitly authored font remains a font choice.

Footnotes are not letters of the tongue. A defined `[^key]` in any encoded span
is removed before encoding and restored after the span, outside the script font.
In an encoded verse div, a reference appears only in the Roman column, beside
its authored word, with no duplicate number, definition or backlink. Footnotes
never change verse shape. See [footnotes in works and encoded spans](../authoring/links-and-markup.md#footnotes-in-works-and-encoded-spans).

A name's braces use the shared name controls. Resolved references encode only
their visible labels, retaining URLs and presentation cues. These keys apply
to spans, divs and scroll fences. A scroll's selected font must
belong to a script whose note declares `direction: vertical-rl`.

## Roman source and literal characters

Language-only text retains the exact spelling and surrounding prose font:

```markdown
[Zaron lonak]{lang=vyl enc=default}
[Zaron lonak]{lang=vyl font=serif}
```

The language note's `data.roman` lists additions to the shared standard:
letters in their accepted cases, accented letters, catch signs and digits.
List each character once in NFC spelling. Standard punctuation and whitespace
are supplied automatically. A language that lists uppercase letters accepts
them; the build changes no authored case.

The terminals are `.` for a statement, `?` for a question, `‼` for an imperative
and `!` for an exclamation. None is required. A comma pauses within a sentence;
use it instead of `;` or `:`, and use a period between complete sentences.
Quotation pairs alternate `«…»`, `‹…›`, then `«…»` at successive depths.
English double quotes, `<<` and `>>` are findings. A closing quote is not a
terminal for the enclosing sentence.

An em dash interrupts a sentence. An ellipsis at a sentence's start resumes
one; later it abandons one. An interruption or abandonment takes an immediate
terminal unless it ends the run. Write `…`, not three periods. Markdown
escapes are removed before encoding, and diagnostics retain the source position.

Every `Zs` space separator and U+0009 through U+000D count as whitespace. A run
of them is one word separator, which the encoding writes by its own rule.
Newlines join as whitespace. In a verse div, `/` ends a logical line,
blank lines or `//` end stanzas, and `--- {.canto}` after a blank line ends a canto. A literal
slash is written `\/`. Indentation at a logical line boundary is layout,
not a punctuation character added to the encoded words.

An encoded literal slash has its own invisible mark, distinct from the verse
line mark, and decodes to `\/`. It never ends the logical line.

A `.name` child in a language run reaches the encoding with standard `{…}`
name boundaries. An `.emph` child contributes the same letters with emphasis
presentation. Both inherit the surrounding native writing when they state no
run keys.

Write an exact native character through codage, such as `⟦U+F0230⟧`, or a name
that the chosen encoding defines. Literal codes are immutable; ordinary letter
and punctuation rules do not reinterpret their contents. A setting-script
character pasted directly into a configured language run is a finding. The
same restriction applies to a face that can draw it.

A `!` touching the `[` of another span is Markdown image syntax. Separate the
terminal from the following span, or escape the terminal.

## Encodings

An encoding is a `doc` note. Its `data.language` is a configured language
alias, `data.font` is one installed font slug, and `data.mappings` maps Roman
strings to a font glyph code or a sequence of codes. `data.rules` holds the
closed executable rules. Optional `data.accepts` states accepted characters
or ranges and `data.vowels` states contextual vowels. The note body explains
the spelling to a reader.

The font supplies each glyph's `code` beside its `codepoint` in `fonts.json`.
Codes belong to the selected font; the note never repeats a code table.
Unknown fields, glyph codes, languages and fonts are positioned findings.
An encoding's output must decode unambiguously, including across adjacent
mappings and spaces. The compiler refuses indistinguishable spellings rather
than choosing a guessed reading. See [the executable rules](../encoding-core.md).

Mappings match longest first; contextual before-vowel rules precede their
unconditional alternatives. A case rule may allow lowercase and initial-capital
groups while refusing other mixed or uppercase group spellings. Encoding keeps
authored case and never rewrites a word's Roman spelling.

Outside literal markers, a run of Unicode Zs characters or U+0009 through
U+000D writes one space. Other whitespace needs an explicit mapping. Standard
Roman punctuation, verse and name controls are inherited from the shared
standard; an explicit mapping can give a standard source its font glyph.

### Literal codes

Inside an encoded run, `⟦…⟧` writes the selected font's glyph codes or exact
Unicode scalars: `[⟦MAN⟧]{enc=khelzethuenc}` where `MAN` is defined, and
`[⟦U+00E1⟧]{enc=vylsemaronenc}` for an exact character. A Unicode code takes four to
six uppercase hexadecimal digits, U+0000 through U+10FFFF excluding
surrogates. Codes come only from the font; Unicode database
names are not inferred. Whitespace between codes writes nothing. Nested or
unmatched markers, unknown codes and standard marks absent from the font
code table are errors. Without an encoding, a literal marker is a finding.

Each outer marker writes its own invisible control. Payload occurrences of
those controls or the literal escape are quoted with U+E0115. Decoding
unquotes the payload before reading code rows and uses `U+XXXX` for scalars
with no code name. Variation selectors U+E0100 through U+E01EF are valid
encoded characters and carry distinctions the visible font does not draw.

## The dictionary first

A language's configured note supplies `data.words`, including the nearest
complete inherited definition from its `data.family` chain. Grammar and names
remain the current language's own. Native entries use `{enc, font?, text}`.

```yaml
words:
  - form: zaron
    class: n
    field: Law
    gloss: an oath
    native:
      - { enc: vylsemaronenc, text: "\U000F024F\U000F0230\U000F023F\U000F023C" }
```

Every encoding tries the word's own writing, then complete native parts,
affixes and explicitly named grammatical endings, then its rows. A face-specific
entry takes precedence. A native entry repeating what all applicable rows give
is redundant and is reported at that entry.

Exact case and exact variants are tried before folded lookup. A lowercase
native exception can take an initial capital where the rows identify its first
sound in both cases and its native text begins with the lowercase result.
That prefix is replaced by the capital result. An ambiguous or uninferable
capital needs an explicitly authored case-specific entry. Explicit entries
retain authority; their pronunciation or glyph choices are not inferred.

A derived form uses a native grammatical ending only when the complete stem
and ending writings exist. Otherwise the rows spell the complete form. Missing
parts never invent signs. A bare encoding without a language uses its rows and
inline codes alone.

## The checks

A run with `lang=`, whose language has a `note`, is checked word by
word. This applies to Roman language-only runs and native runs alike;
Encoding selection does not turn vocabulary checks off. The comparison is case folded and NFC, with `’` read as `'`. A word passes
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

**Encoding coverage** refuses an unknown character at its source position:

> ``"x" (U+0078) is not in the `semaron` encoding``

and a row that writes a code point the face lacks reports where it is applied:

> `` `ch` encodes to U+F0299 in `semaron`, which the font `semaron-kuriale` does not draw ``

**Keys that name nothing.** A key that names nothing is the one finding, and
the run is not then checked against a face or a lexicon it cannot reach.

> `` `semaron-kurial` is not a font: `font=` names an installed face, or `mono`, `serif` or `sans`; did you mean `semaron-kuriale`? ``

> `` `semron` is not an encoding document ``

> `` `q` is not a declared language (`languages` in package-build.config.yaml) or a BCP 47 tag ``

> `` `thuravark-carved` is not a font of encoding `semaron`; it is for `semaron-kuriale` ``

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
`package-build lexicon vyl --enc vylsemaronenc --derived`.

The keys are checked where they sit:

> `` `data.grammar.agreement.classes[0]` is `adjective`, which is not a word class; did you mean `adj`? ``

> `` `data.grammar.agreement.endings` must state at least two endings for a word to agree among ``

> `` `data.grammar.participles.affixes[2]` is `-zz`, which is not a suffix of `data.affixes` ``

> `` `data.grammar.participles.affixes[3]` is `an-`, a prefix; a participle is a suffix on the root ``

> `` `data.affixes[1].attachesTo[0]` is `verb`, which is not a word class; did you mean `v`? ``

## Native spellings and parts

Every encoding uses the same order for a language word: its own `native`
entry for that encoding and face; otherwise the writings of all its parts;
otherwise the encoding's rows. A face-specific entry precedes an entry for no
face. Exact lexical forms precede folded lookup, so separately authored
capitalized spellings keep their own native text. A flat variant is a lexical
form; it does not assign a grammatical role by itself.

```yaml
words:
  - form: halzi
    class: n
    gloss: heart
    field: Words
    native:
      - { enc: zethu, text: "\U0001EABB" }
  - form: halzunet
    class: n
    gloss: the account
    field: Words
    built: [halzi, -unet]
affixes:
  - form: -unet
    gloss: a thing made of
    native:
      - { enc: zethu, text: "\U0001EBC7" }
```

A built part is an exact word or affix, then the same form with joining
hyphens removed. Parts can themselves be built. A plural or present form can
use the stem's writing followed by its explicitly named ending from
`grammar.native`, whose entries use `{ending, enc, font?, text}`. These
writings work under every encoding. Missing parts do not invent signs, and
recursive parts terminate without a writing. Entries with genuinely different
writings remain an ambiguity naming every matching gloss.

An encoding accepting no letters, such as `zethu` or `chalish-pilam`, needs a
lexical writing or literal codes for a word. The refusal names the word,
language and encoding and points to that word.

### Reading script text

Without a language, decoding is exactly the encoding's longest-output match.
With a language, explicit native and composed writings are tried first,
longest first; a shared writing uses the first listed sense. Literal marker
spans decode through their inline codes. Unknown unmarked signs in a script
accepting no letters become `⟦codes⟧` with a finding.

For an unmarked word, the lexicon can recover its unwritten sounds from the
plain decoded skeleton. A unique skeleton gives its form; a shared skeleton
gives the first authored form. Each word's citation precedes its variants and derived forms, before the next word's citation. Registered names retain their authored order. Complete names are matched longest first across word separators and receive one pair of braces. A known ordinary word keeps its encoded case without a false unknown-word finding. An unknown skeleton keeps the
plain decoding and produces a located finding. This is decided per word: a
passage can mix typed words with encoded words. A word carrying any invisible
mark keeps exact decoding without skeleton recovery; an explicit authored
native exception still has precedence. Stress marks are preserved by exact
rows. Names are represented with braces according to the language's rules.

## Emphasis in a script

Inside a language run, mark a stressed word as `[word]{.emph}`. The span
inherits its surrounding language, face and encoding, so its letters follow
the same writing rules as the rest of the run. In English, `.emph` equals
`*…*`, and `.strong` equals `**…**`. Non-English spans refuse `.strong` and
Markdown emphasis. The build sets `.emph` by the language's or script's convention:

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
```

`fonts` lists the faces of the script (a face belongs to one script),
`emphasis` sets `.emph` and accepted English emphasis. A tongue that states
nothing takes its script's convention.

**Non-English spans do not take Markdown emphasis.** Bold and italic markup in
a span with an effective non-English language is an error, whether it has a
font or not, and whether its language is declared on that span or inherited.
English (`en`) and English BCP 47 tags remain eligible. Escaped literal
delimiters are not emphasis. This restriction applies throughout the note.

`data.emphasis: words` also makes emphasis an error: it says the language marks
stress with a word, so `.emph` and stars in its runs are refused:

> `` `ban` marks emphasis with a word, not a mark; write the word ``

A strikethrough is an error in a face. Mark a whole stressed word: a mark
inside a word splits the text, so a row or lexicon word crossing it cannot match.

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

### A poem in a verse div

A `.verse` div holds inline Markdown and explicit verse structure. It is opaque
to lists, headings, quotes and code-block syntax. Its source newlines join unless
`/` ends a logical line. The authoring formatter preserves the div's text,
spacing and attributes, and also preserves inline `.verse` quotations. Quote
and list containers remain intact, table columns use the quotation's authored
width, and verse follows the same configured line endings as surrounding prose.

```markdown
::: {.verse lang=vyl font=semaron-kuriale enc=vylsemaronenc}
Lokazor lonak./
.lokamen zaron.
:::
```

Quoted verse is a span within prose, such as
`[Lokazor lonak zaron./..Lokamen lonak zaron.//]{.verse lang=vyl}`.
A concrete `enc=` sets a quotation in script only, continuously in the prose.
Its `/` and `//` become the encoding's verse marks; only a div has paired script
and Roman columns. An unencoded quotation keeps Roman line and stanza layout.
Quotations take no `work=`, `form=`, `scan=`, labels or canto breaks.
A div's canto separator can carry a heading and an anchor:

```markdown
::: {.verse lang=en}
The watch arrives.

--- {.canto #choosing title="The Choosing"}
The captain answers.
:::
```

The title is shown once as heading text; the encoder receives its Roman `***`
canto control. Authored `***` inside verse is a finding. The canto stays within
the work and does not open a separate journal page.

The blank line before a canto retains its stanza mark in the encoded text.
Whitespace after the canto control adds no extra line mark.

### Versions of a work

`form=epic` records the author's literary form without inferring layout or metre.

A `.verse` div with a concrete `enc=` sets one original in its script on the
left and Roman on the right. The author writes the text once; the two
presentations align logical lines at full weight. `/` ends a logical line,
source newlines otherwise join, a blank line or `//` ends a stanza, and a line
of `--- {.canto}`, preceded by a blank line, ends a canto. Leading periods at a logical line boundary indent
that line. Use `\/` for a literal slash.

```markdown
::: {.verse work=walking lang=en}
He walks the oath road.

I walk the oath road.
:::

::: {.verse work=walking lang=vyl enc=vylsemaronenc}
Lokazor lonak zaron.

Lokamen lonak zaron.
:::
```

`work=` groups the versions within the page. Their stanza labels match, and the
build checks that their canto counts and stanza counts per canto agree. The
English div is one column, and `enc=default` also stays one Roman column.
The original's encoded and Roman presentations share one label per stanza.
Names, `⟦…⟧` codage, language gaps and other inline spans retain their meaning;
codage draws its glyphs on the left and appears as codage on the right. The
content index records the original once with its div language and encoding.
See [versions and stanza labels](../authoring/links-and-markup.md#versions-and-stanza-labels)
for poetry and prose examples, and [directions and speakers](../authoring/links-and-markup.md#directions-and-speakers)
for plain semantic span hooks.

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
not counted. A div that states `scan=` with the declared name and a `lang=`
whose language note states `data.sounds.stress` is counted line by line:

```markdown
::: {.verse lang=vyl scan=trimeter}
Lokazor lonak zaron./
Lokamen lonak zaron.
:::
```

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

**The check is author-side.** Readers see nothing of it: the rendered div
carries `data-metre` with the metre's name and nothing a reader sees. A div
without `scan=` is not counted. `scan=` is refused where it cannot mean
anything, each an error:

> `` `hexamter` is not a declared metre: `scan=` names the `name` of a `data.metres` entry of a `doc` note; did you mean `hexameter`? ``

> `` `scan=` counts beats by a language's stress rule: the div needs a `lang=` ``

> ``the language `vyl` states no `data.sounds.stress`, which `scan=` counts beats by``

> ``the language `vyl` is not a configured language with a `note`, so it has no stress rule for `scan=` to count beats by``

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
```scroll {rows=25 cols=12 lang=tsu enc=tsutengchouenc}
chen teng chou hing
tan tsou dou rou

gen chei chou tsuen
```
````

The Tantsou encoding document names its language and the `teng-chou` font;
its Address selects both. A language-only scroll keeps Roman text.

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
whose notes select no native face, ships none of it.

## The commands

`package-build encode --enc <name|file> [--in|-i <file>] [--out|-o <file>] [text..]`
encodes one string argument or the UTF-8 file named by `--in`; `--in -` reads
standard input. `package-build decode` takes the same options and reads code
points back through the encoding. An encoding is a document Address, with `doc` as the default type.
These commands apply the bare encoding. The [browser conversion API](../api.md#browser-conversion)
uses the same implementation with a language's vocabulary and lexical recovery.

```sh
package-build encode --enc vylsemaronenc "zaron lonak"
package-build encode --enc khelqalezuenc --in roman.txt --out native.txt
package-build decode --enc khelqalezuenc --in native.txt --out roman.txt
package-build encode --enc khelzethuenc "⟦MAN⟧"
```

`package-build lexicon <language> [--enc <name>] [--font <slug>] [--derived] [--json]`
lists every word of the language with its native form under the encoding, or under
the explicitly selected encoding document, tab-separated: the form,
the native form, `own`, `parts`, `rows` or `none`, the class and the gloss. `--derived`
adds the forms the language's rules derive, each with the word it comes from,
`--json` prints an array instead, and the third column
is `own`, `parts`, `none` or `ambiguous`.

```console
$ package-build lexicon vyl --enc vylsemaronenc | cut -f1,3-
zaron  own  n  an oath
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
linted, and the findings printed are the ones the lint reports. The sample selects the
installed Semaron encoding.

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
  roman: "ABDEFGHIKLMNOPRSTUVWYZabdefghiklmnoprstuvwyzÁÉÍÓÚÝáéíóúýËëÀà0123456789"
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
        - { enc: vylsemaronenc, text: "󰉆󰉈󰈿󰈽󰈼" }
    - { form: lonak, class: n, field: Law, gloss: a road, concept: road-noun }
    - { form: lokathen, class: v, field: Law, gloss: to walk, concept: walk-verb }
    - { form: alathos, class: pron, field: Law, gloss: "he, that one" }
---

The imperial tongue of the sample setting, written in the Semaron script and
read aloud at its court. The lexicon here is a small sample made for the guide.
```

**`assets/content/Docs/Vylari_Encoding.md`**

```markdown
---
type: doc
subType: reference
shortcode: vylsemaronenc
name:
  full: Vylari in Semaron
data:
  language: vyl
  font: semaron-kuriale
  accepts:
    - a-z
    - A-Z
    - 0-9
    - "'"
    - "-"
    - "`"
    - Á
    - É
    - Í
    - Ó
    - Ú
    - á
    - é
    - í
    - ó
    - ú
    - ’
  vowels: aeiouAEIOUáéíóúÁÉÍÓÚ
  mappings:
    "0": DIGIT_ZERO
    "1": DIGIT_ONE
    "2": DIGIT_TWO
    "3": DIGIT_THREE
    "4": DIGIT_FOUR
    "5": DIGIT_FIVE
    "6": DIGIT_SIX
    "7": DIGIT_SEVEN
    "8": DIGIT_EIGHT
    "9": DIGIT_NINE
    a: ANKRON_MIN
    A: ANKRON_MAJ
    e: ELZA_MIN
    E: ELZA_MAJ
    i: ILTHERA_MIN
    I: ILTHERA_MAJ
    o: ORNETHE_MIN
    O: ORNETHE_MAJ
    u: ULMERA_MIN
    U: ULMERA_MAJ
    b: BRUTHEKA_MIN
    B: BRUTHEKA_MAJ
    d: DEKAZU_MIN
    D: DEKAZU_MAJ
    f: FUNELA_MIN
    F: FUNELA_MAJ
    g: GULMOS_MIN
    G: GULMOS_MAJ
    h: HARLEN_MIN
    H: HARLEN_MAJ
    j: JA_MIN
    J: JA_MAJ
    k: KALPEZA_MIN
    K: KALPEZA_MAJ
    l: LIZELA_MIN
    L: LIZELA_MAJ
    m: MEZARA_MIN
    M: MEZARA_MAJ
    n: NELAMIS_MIN
    N: NELAMIS_MAJ
    p: POZERA_MIN
    P: POZERA_MAJ
    q: QORETHA_MIN
    Q: QORETHA_MAJ
    r: RONETHOS_MIN
    R: RONETHOS_MAJ
    s: SIRETHA_MIN
    S: SIRETHA_MAJ
    t: TALOTHOS_MIN
    T: TALOTHOS_MAJ
    v: VARTHOS_MIN
    V: VARTHOS_MAJ
    w: WA_MIN
    W: WA_MAJ
    y: YALZEMIS_MIN
    Y: YALZEMIS_MAJ
    z: ZARGON_MIN
    Z: ZARGON_MAJ
    ch: CHEROLA_MIN
    Ch: CHEROLA_MAJ
    sh: SHELMORA_MIN
    Sh: SHELMORA_MAJ
    th: THOLERA_MIN
    Th: THOLERA_MAJ
    dh: DHANETHE_MIN
    Dh: DHANETHE_MAJ
    kh: KHORVENA_MIN
    Kh: KHORVENA_MAJ
    gh: GHORMAS_MIN
    Gh: GHORMAS_MAJ
    zh: ZHAREVA_MIN
    Zh: ZHAREVA_MAJ
    ts: TSALEMA_MIN
    Ts: TSALEMA_MAJ
    ng: ENGARIS_MIN
    Ng: ENGARIS_MAJ
    .: POINT
    á:
      - ANKRON_MIN
      - STRESS
    é:
      - ELZA_MIN
      - STRESS
    í:
      - ILTHERA_MIN
      - STRESS
    ó:
      - ORNETHE_MIN
      - STRESS
    ú:
      - ULMERA_MIN
      - STRESS
    Á:
      - ANKRON_MAJ
      - STRESS
    É:
      - ELZA_MAJ
      - STRESS
    Í:
      - ILTHERA_MAJ
      - STRESS
    Ó:
      - ORNETHE_MAJ
      - STRESS
    Ú:
      - ULMERA_MAJ
      - STRESS
  rules:
    normalization: NFC
    matching: longest-first
    case:
      single-letter: preserve
      consonant-group: lowercase-or-initial-uppercase
      other-group-cases: forbidden
    stress:
      modifier: STRESS
      position: after-stressed-vowel
      printing: false
      effect: stress-only
      changes-sound: false
      changes-length: false
      vowel-group-position: first-vowel
    vowel-groups:
      reading: established
      allow-splitting: false
      unrecognized-adjacent-vowels: separate
      groups:
        - ai
        - au
        - ei
        - oi
        - ou
        - ae
        - ie
        - uo
        - aa
        - ii
        - uu
    diaeresis:
      allowed: false
    contextual-mappings:
      - match: ny
        before: vowel
        emit: NYELIS_MIN
      - match: Ny
        before: vowel
        emit: NYELIS_MAJ
    y:
      kind: consonant
      sound: y in yes
      vowel-reading: false
    grave-accent:
      allowed: false
---

These mappings write the sample vocabulary in Semaron Kuriale. They preserve its letter case and use the font's published glyph codes. Contextual groups take their stated before-vowel spelling, and stress is retained after the accented vowel so that the written distinction can be read back exactly.
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

[Lokazor lonak thiruthrimar. lokamen zaron.]{lang=vyl font=semaron-kuriale enc=vylsemaronenc}
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
  roman: "ABDEFGHIKLMNOPRSTUVWYZabdefghiklmnoprstuvwyzÁÉÍÓÚÝáéíóúýËëÀà0123456789"
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
        - { enc: vylsemaronenc, text: "󰉆󰉈󰈿󰈽󰈼" }
    - { form: lonak, class: n, field: Law, gloss: a road, concept: road-noun }
    - { form: lokathen, class: v, field: Law, gloss: to walk, concept: walk-verb }
    - { form: alathos, class: pron, field: Law, gloss: "he, that one" }
    - { form: thiruthrimar, class: n, field: Law, gloss: a sworn witness }
---

The imperial tongue of the sample setting, written in the Semaron script and
read aloud at its court. The lexicon here is a small sample made for the guide.
```

The lint is now clean, and the conversion can be read. `package-build encode`
checks a passage through the encoding's rows:

```sh
package-build encode --enc vylsemaronenc "Lokazor lonak. lokamen zaron."
```

The build also applies the language's recorded native writings when setting
its runs.

The site sets the run as

```html
<span class="script hl-semaron-kuriale" lang="art-x-vyl" data-pagefind-ignore="true"
  >󰈊󰈽󰈹󰈰󰉆󰈽󰈿 󰈺󰈽󰈼󰈰󰈹󰉨 󰈺󰈽󰈹󰈰󰈻󰈳󰈼 󰉆󰉈󰈿󰈽󰈼󰉨</span
>
```

where the characters are the code points above: `Lokazor` begins with the
capital `L` of the rows, `zaron` is the exception's long vowel, and each period
writes the script's pause point.

A work's English and original versions sit on one note. Its original is written
once and appears beside its Roman presentation; a separate div checks metre.

**`assets/content/Lore/Walking.md`**

```markdown
---
shortcode: walking
name: { full: The Walking }
type: lore
---

The walking of the oath road is sung in two settings. The first sets the poem
beside its translation, and the second keeps the metre that the court keeps, so
that a line with the wrong count is reported to the author who wrote it.

::: {.verse work=walking lang=en}
He walks the oath road.

I walk the oath road.
:::

::: {.verse work=walking lang=vyl enc=vylsemaronenc}
Lokazor lonak zaron.

Lokamen lonak zaron.
:::

::: {.verse lang=vyl scan=trimeter}
Lokazor lonak zaron./
Lokamen lonak zaron.
:::
```

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

[Lokazor lonak. zaron.]{lang=vyl font=semaron-kuriale enc=vylsemaronenc}
```

Finally, the core report lists what the language still lacks:

```console
$ package-build core --language vylarilng
Vylari Language (skill-vylarilng): 1 of 4 core concepts have no word
  senses: 1 of 1
    see-verb	to see
```

Everything in this package comes from the guide. A new script follows the same
steps: an encoding document for its language and font, `languages` entries for the languages
written in it, a language note with the dictionary, and runs marked with the
language key and native presentation class.
