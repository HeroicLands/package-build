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
| `case`                | `{single-letter: preserve, consonant-group: lowercase-or-initial-uppercase, other-group-cases: forbidden}`; single letters retain authored case, and groups use lowercase or an initial capital.                                                      |
| `stress`              | `{modifier, position: after-stressed-vowel, printing: false, effect: stress-only, changes-sound: false, changes-length: false, vowel-group-position: first-vowel}`; `modifier` names a font code and acute mappings append it to the unchanged vowel. |
| `vowel-groups`        | `{reading: established, allow-splitting: false, unrecognized-adjacent-vowels: separate, groups: [...]}`; the explicit group list determines where an acute belongs on its first vowel.                                                                |
| `diaeresis`           | `{allowed: false}` forbids diaeresis mappings.                                                                                                                                                                                                        |
| `grave-accent`        | `{allowed: false}` forbids grave-accent mappings.                                                                                                                                                                                                     |
| `contextual-mappings` | A list of `{match, before: vowel, emit}`; the contextual mapping precedes an unconditional mapping and `emit` names one code or a sequence.                                                                                                           |
| `y`                   | `{kind: consonant, sound: "y in yes", vowel-reading: false}`; y cannot also appear in `data.vowels`.                                                                                                                                                  |

A contextual match cannot contain whitespace, literal markers or forbidden
accents. Mapping outputs must be uniquely decodable across arbitrary adjacent
mappings and spaces; ambiguous concatenations are refused. The compiler does
not infer linguistic vowel groups or silently add missing letter mappings.

Lint checks every authored word, variant and registered name for a language
with an encoding document, including unused entries. It also checks actual
name-list entries and name-element spellings and examples; patterns and
abstract roots are excluded. Bound-element edge hyphens mark joining positions.
These are bare Roman checks, so a native writing cannot bypass spelling rules.
Different case and multiword names retain their authored spelling.

Every encoding inherits the shared standard's fifteen Roman punctuation
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
expose their `key`. Decoding resolves the complete unambiguous output sequence.

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

`{verse: true}` handles authored stanza and canto structure. The Markdown
renderer additionally writes a boundary after every content line, including
the final line before a stanza or canto. Roman line layout is retained.

The internal row conformance fixtures cover their captured source programs;
they do not establish that every language has an authored encoding document.
The Aelwythi Semaron template is the public-note integration fixture.
