# Encoding text

An encoding is a `doc` note for one language in one font. `enc=` resolves its
Address with `doc` as the default type: `enc=aelwsemaronenc` selects
`doc-aelwsemaronenc`. The document's `data.language` is a configured language
alias and `data.font` is an installed font slug. Those values supply a run's
language and face; contradictory explicit values are errors. `enc=default`
leaves Roman text as written and requires no encoding document.

Fonts publish glyphs and their codes in `fonts.json`, under each family's
`codepoints`: `{codepoint: "U+F0230", code: "ANKRON_MIN", ...}`. Codes are
case-sensitive letters, digits and underscores, unique within that font.
Encoding documents refer to those codes in `data.mappings`; they do not copy
the font's code table. Each mapping value is one code or a list of codes.

```yaml
type: doc
subType: reference
shortcode: aelwsemaronenc
name: { full: Aelwythi in Semaron }
data:
  language: aelw
  font: semaron-kuriale
  mappings:
    a: ANKRON_MIN
    A: ANKRON_MAJ
    ch: CHEROLA_MIN
    Ch: CHEROLA_MAJ
  rules:
    normalization: NFC
    matching: longest-first
```

This is a small illustrative mapping, not the complete Aelwythi alphabet.
`data.accepts`, when supplied, is a list of Roman characters or ranges such as
`a-z`; otherwise the mapping sources determine the accepted letters.
`data.vowels` is a string of vowels used by contextual rules. A document's body
explains the spelling to its reader. Ordinary document metadata remains
available alongside the executable fields.

## Executable rules

`data.rules` has a closed vocabulary. Unknown keys and unsupported values are
errors at their source keys; explanatory rules do not silently authorize a
second behaviour.

| Rule                  | Values and effect                                                                                                                                                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `normalization`       | Required `NFC`; input is normalized before matching, with original source offsets retained.                                                                                                                                                           |
| `matching`            | Required `longest-first`.                                                                                                                                                                                                                             |
| `roundTrip`           | Optional `exact` (default) or `canonical`; canonical permits authored aliases and empty code sequences.                                                                                                                                               |
| `word-separators`     | Optional list of source word dividers that emit shared word spaces after contextual alternatives.                                                                                                                                                     |
| `case`                | `{single-letter: preserve, consonant-group: lowercase-or-initial-uppercase, other-group-cases: forbidden}`; single letters retain authored case, and groups use lowercase or an initial capital.                                                      |
| `stress`              | `{modifier, position: after-stressed-vowel, printing: false, effect: stress-only, changes-sound: false, changes-length: false, vowel-group-position: first-vowel}`; `modifier` names a font code and acute mappings append it to the unchanged vowel. |
| `vowel-groups`        | `{reading: established, allow-splitting: false, unrecognized-adjacent-vowels: separate, groups: [...]}`; the explicit group list determines where an acute belongs on its first vowel.                                                                |
| `diaeresis`           | `{allowed: boolean}` permits or forbids explicitly mapped diaeresis characters.                                                                                                                                                                       |
| `grave-accent`        | `{allowed: boolean}` permits or forbids explicitly mapped grave-accent characters.                                                                                                                                                                    |
| `contextual-mappings` | A list of `{match, emit, before?, at?}`; following-letter or source-position conditions precede unconditional mappings.                                                                                                                               |
| `y`                   | `{kind: consonant, sound: "y in yes", vowel-reading: false}`; y cannot also appear in `data.vowels`.                                                                                                                                                  |

The accent blocks accept an explicit Boolean `allowed`. False forbids that
accent; true permits it only where the character is accepted and mapped.
Omitting the block also permits such explicit mappings. Neither choice invents
an accent pronunciation or adds a character to the inventory.

`rules.roundTrip` is optional and defaults to `exact`. Exact mappings must be
uniquely decodable across adjacent mappings and spaces; ambiguous outputs and
empty code sequences are refused. This remains the default for Aelwythi.

An encoding whose orthography omits distinctions may explicitly state
`roundTrip: canonical`. Its mappings and conditional emissions may use `[]`
for an inherent vowel or deleted boundary marker, and different Roman sources
may name the same output. Decoding returns a conventional spelling. For an output it prefers the first
authored alias whose following-letter condition matches the decoded suffix,
with conditional rows before general mappings and longest complete native
matches first. When none applies, the first authored reading is retained:
an inherent vowel or deleted marker may have hidden the original condition. It does not invent characters for
empty outputs or store invisible metadata to restore the original spelling.
A language's authoritative vocabulary can recover fuller word spellings.
Shared word spaces remain spaces in both modes.

Contextual entries use `{match, emit, before?, at?}` and require at least one
condition. `before` is `vowel` or `consonant`; `at` is `start`, `end` or
`line-start`. `start` and `end` refer to word boundaries. A consonant is a
letter outside the declared `data.vowels`. Line start follows a newline or
verse slash and permits preceding indentation carets. Multiple conditions
combine with AND. Entries for the same source may use different conditions;
repeating the same source and condition tuple is an error. Equal-length
contextual matches retain authored order.

```yaml
rules:
  normalization: NFC
  matching: longest-first
  roundTrip: canonical
  contextual-mappings:
    - { match: e, before: consonant, emit: [] }
    - { match: e, at: end, emit: [] }
```

Conditions govern forward matching. Inverse following-letter choices use the
visible decoded suffix; canonical mode keeps its authored fallback when that
suffix has lost an inherent vowel or marker. Position conditions govern only
forward matching. No mode invents deleted markers. Exact decoding retains
strict following-letter checks.

`rules.word-separators` lists source word dividers, such as `['-']`, that emit
the shared ASCII word space. Contextual rules take priority, so a canonical
note can emit `[]` for an edge hyphen and a word space for an internal hyphen.
These sources cannot also be ordinary mappings, replace shared punctuation,
or contain whitespace, literal markers or structural controls. Separator
sources participate in inferred `accepts`; no font SPACE code is invented.
Since a divider and an ordinary space share output, such a note selects
canonical round trips. Decoding keeps the shared space as a space.

A contextual match cannot contain whitespace, literal markers or forbidden
accents. Both modes enforce the same accepted characters, normalization,
case, stress, accent and literal-control rules. The compiler does not infer
linguistic vowel groups or silently add missing letter mappings.

Lint checks every authored word, variant and registered name for a language
with an encoding document, including unused entries. It also checks actual
name-list entries and name-element spellings and examples; patterns and
abstract roots are excluded. Bound-element edge hyphens mark joining positions.
These are bare Roman checks, so a native writing cannot bypass spelling rules.
Different case and multiword names retain their authored spelling.

A **codes-only** encoding accepts no letter: a script written entirely as
glyph codes, such as `⟦ONE⟧`, with no letter in its `accepts` or mappings. The
language's Roman words and names are not checked against it, since none of
them is written in it. Its own native writings are checked as any other
encoding's are: a code the font does not draw, or a second writing for one
encoding and face, is an error at the writing. A language holding both kinds of
encoding has its Roman forms checked against the lettered one only.

English names under a language's `data.names.en` are not encoded and are not
checked against any encoding.

Every encoding inherits the shared standard's Roman punctuation
mappings, verse and name controls, and literal boundaries. `‼` marks an
imperative and `!` an exclamation. An explicit mapping can give a standard
source its own font glyph. Other punctuation needs its own mapping.

## Conversion API

The pure engine works in browsers and Node and opens no files. The caller
supplies the selected font's resolved code-to-Unicode table separately:

```js
import {
  compileEncoding,
  encodePieces,
  encodeText,
  decodeText,
} from "@heroiclands/package-build/engine/encoding";

const encoding = compileEncoding(note.data, {
  codes: fontCodes,
  name: "thalorna-note-doc-aelwsemaronenc",
});
const native = encodeText(encoding, roman);
const reading = decodeText(encoding, native);
const pieces = encodePieces(encoding, roman);
```

`validateSource(encoding, text, options)` validates accepted Roman characters
and source rules without requiring an ordinary mapping for every letter;
authoritative lexical writings can supply that coverage. It throws the same
positioned errors as encoding and shares its source normalization.

Only the executable fields belong in the compiler's `data` argument: language,
font, mappings, rules, and optional accepts and vowels. A loader separates
ordinary document metadata. The closed public compiler accepts encoding-note
data; `compileRows` is an internal row-execution entry used by conformance
fixtures, not an authored input format.

`encodeText` and `decodeText` return strings. Unknown input throws
`EncodingError` and returns no partial text. `offset` is a zero-based UTF-16
offset into the input, suitable for composing with a Markdown offset map.
`line` and `column` are one-based Unicode code-point positions; schema errors
expose their `key`. Exact decoding resolves the complete unambiguous output sequence. Canonical
decoding selects the authored conventional reading.

`encodePieces` uses the same rules and returns `{from, to, start, end, row}`
records. `start` and exclusive `end` delimit original UTF-16 input, including
all whitespace consumed by a piece. A matched row identifies its source and
schema key. Literal syntax has a null row. Optional `start` and `end` bounds
retain surrounding source context while preventing matches beyond the bound.

Outside literal markers, Unicode Zs and U+0009 through U+000D normalize to one
space. Other whitespace needs a mapping. `⟦…⟧` reads the font's codes or strict
`U+XXXX` scalars, with four to six uppercase hex digits and no surrogates.
Whitespace between literal codes writes nothing. Literal payload occurrences
of the opening, closing or escape control are quoted with U+E0115; decoding
unquotes them before reading their codes. Unknown codes, malformed escapes,
nested markers and unmatched markers are errors.

The shared `\/` row writes the nonprinting U+E010F literal-slash mark and
decodes it to `\/`; `/` writes the distinct U+E010C line mark. Verse projection
retains the escape until encoding, including inside inline quotations. A row
program without a literal-slash row reports a source finding instead of
substituting a line control. Ordinary mappings cannot emit U+E010F.

`{verse: true}` handles line, stanza and canto structure. The encoder receives
`***` for a canto and decodes U+E010E back to `***`. Whitespace before the canto
still writes its stanza mark; following source whitespace adds no line mark.
The Markdown renderer additionally writes a boundary after every content line, including
the final line before a stanza or canto. Roman line layout is retained.

The internal row conformance fixtures cover their captured source programs;
they do not establish that every language has an authored encoding document.
The Aelwythi Semaron template is the public-note integration fixture.
