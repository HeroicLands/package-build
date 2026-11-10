# Encoding text

An encoding is a `doc` note for one language in one font. `enc=` resolves its
Address with `doc` as the default type. `data.language` names a configured
language, and `data.font` names its installed face. They supply a run's language
and font; contradictory explicit values are errors. `enc=default` keeps Roman
text and requires no encoding document.

Fonts publish named glyph codes in `fonts.json`. Encoding documents select
those codes in `data.mappings`; they do not copy font code tables.

## Exact sound encodings

Pronouncing Thalorna supplies the complete sound inventory and every Roman
spelling rule. A language note only selects a subset through
`data.sounds.letters`, a list of canonical guide spellings such as `[a, e, ai]`.
The registry supplies pronunciation and classification; the language does not
repeat them. Runtime inputs can also use complete guide rows, whose `letters`,
`ipa` and `kind` must agree with the guide. A language cannot add a
sound, change its spelling or pronunciation, or classify `y` as a vowel.
Knowing the guide is enough to pronounce any language's words.

The configured `languages.<key>.note` identifies the language note. An exact
encoding requires that note's explicit sound inventory. Missing inventories,
unknown sounds and altered spellings produce findings. Neither glyph names,
Roman character lists nor vocabulary provide a substitute inventory.

For example, a language selecting these three guide sounds states:

```yaml
sounds:
  letters: [a, i, ai]
```

Its encoding chooses exactly one form for each sound. Each mapping resolves
to one Unicode scalar: a visible glyph or that sound's shared invisible
character, published as a code by the selected font. A missing choice, two
sounds sharing an output, or a different sound's invisible character is an
error. A group sound needs its own form; the sequence of its component
vowels' glyphs is not a distinct form.

```yaml
type: doc
subType: reference
shortcode: examplesounds
name: { full: Example sound encoding }
data:
  language: example
  font: example-face
  mappings:
    a: LETTER_A
    i: LETTER_I
    ai: SOUND_AI
  rules:
    normalization: NFC
    matching: longest-first
    roundTrip: exact
```

The code names in this example stand for codes in the selected font's
manifest. `SOUND_AI` can resolve to the shared invisible form for /aɪ/.
Capital mappings such as `A: CAPITAL_A` are optional: case is not a sound.
Existing capital glyphs remain readable; a supplied capital mapping retains
its Roman case. Other capital input selects the same sound's ordinary form.
Mappings for digits may also select font glyphs.

### Executable rules

Sound encodings use only `normalization: NFC`, `matching: longest-first` and
optional `roundTrip: exact`, which is the default. They omit `accepts`,
`vowels` and additional rule blocks. Their spellings, groups, marks and
separators all follow the shared guide.

The encoder reads the longest **global guide token first**, then checks the
language's subset. Omitting /aɪ/ refuses `ai`; it does not reinterpret it as
/a/ followed by /i/. A diaeresis splits a vowel group, and an acute on a
second vowel both splits and stresses it. Thus `kau`, `kaü`, `káu` and `kaú`
retain their distinct readings. Graves retain their vowel quality, including
an acute above a grave. `y` is always consonantal; the guide's `iy` and `uy`
close on /j/ and do not group when a vowel follows the `y`.

A caron marks rising tone and a circumflex falling tone on the first letter
of held `aa`, `ii` or `uu`. Tone also marks stress unless an acute appears
elsewhere: `Kǎalara`, `Kâalara` and `Kǎalará` retain those distinct readings.
The codec records tone independently of an explicit acute; it adds no acute
for the stress implied by tone.

Stress uses the shared U+E0114 character after its sound. Authored hyphens use
the shared U+E0117 boundary character, including compound boundaries and
leading or trailing joining hyphens. Shared invisible sound characters use
U+E0118 through U+E0148. The registry exports `SHARED_SOUNDS`, keyed by IPA,
`SHARED_SOUND_CONTROLS` and `SHARED_SOUND_CODES` from
`engine/encoding-standard`. Rising and falling tone use U+E0149 and U+E014A.
`SHARED_SOUND_CODES` maps all sound aliases and `STRESS`, `SHORT`,
`COMPOUND_BOUNDARY`, `TONE_RISING` and `TONE_FALLING` to their allocated
characters. Each sound’s
`code` is its stable shared alias, such as `SOUND_AI`, `SOUND_A_GRAVE` or
`SOUND_CATCH`; fonts publish these names for the shared invisible forms.

### The diaeresis by rule

Decoding reverses the pair's selected forms directly, without a lexicon. It
writes each sound's guide spelling, inserts a diaeresis between vowels where
needed to avoid a different guide group, and inserts a hyphen where required
between other sound boundaries. Separate /s/ and /h/ read `s-h`; /ʃ/ reads
`sh`. An acute that already splits a vowel group needs no added diaeresis.
Literal code spans receive no spelling marks.

Directly typed native text without invisible characters decodes to its
plain sound skeleton. Vocabulary never supplies missing sounds or changes
that reading. Language-aware APIs use this same direct codec for sound
encodings; lexical native writings do not override its sound choices.

## Logographic encodings

A logographic encoding explicitly states `rules.roundTrip: none`. It makes no
round-trip promise. A sign can have several registered readings, and decoding
returns all distinct readings in authored order, written `[sun | day]` in the
text API. A single reading stays plain. This includes both mapping aliases
and readings registered in the language's lexical native writings.

Logographic mappings may write a code sequence or an empty sequence. Native
words, composed forms and grammatical endings supply their registered signs.
The longest matching native writing is selected; all readings of that writing
are returned. An unregistered sign in a codes-only script becomes literal
`⟦codes⟧` with a finding. The decoder does not recover missing sounds from
vocabulary skeletons.

Additional logographic glyph-selection rules use the closed vocabulary in
[the encoding note reference](reference/note-types.md#doc). `accepts` lists
source characters or ranges; `vowels` supplies glyph-selection categories.
`contextual-mappings` takes `{match, emit, after?, before?, at?}` with at least
one condition. `after` is one exact NFC letter, `vowel` or `consonant`;
`before` is `vowel` or `consonant`; `at` is `start`, `end` or `line-start`.
Conditions combine, and equal-length matches retain authored order. These
select writings, never a language's pronunciation. `word-separators` writes
source dividers as shared spaces. Structural punctuation cannot be a divider.

The language key `zxx` identifies literal codage, not an invented language.
Its mappings are empty, and `⟦CODE⟧` reads the selected font's codes without a
language sound inventory.

## Conversion API

The pure engine works in browsers and Node and opens no files. Callers supply
font codes and the language's declared guide subset:

```js
import {
  compileEncoding,
  encodePieces,
  encodeText,
  decodeText,
} from "@heroiclands/package-build/engine/encoding";

const encoding = compileEncoding(note.data, {
  codes: fontCodes,
  sounds: languageNote.data.sounds.letters,
  name: "demo-note-doc-examplesounds",
});
const native = encodeText(encoding, roman);
const reading = decodeText(encoding, native);
const pieces = encodePieces(encoding, roman);
```

`sounds` is required for exact sound encodings and omitted for logographs and
literal codage. `validateGuideSounds(letters)` checks inventory entries against
the shared registry and returns finding messages. Consumer guards read the
actual guide's `data.sounds.letters` at runtime before checking pair coverage.

`validateSource` applies the same guide and coverage checks for sound
encodings. For logographs it checks source spelling and literal syntax while
allowing registered native writings to provide mapping coverage.

Only executable fields belong in the compiler's `data`: language, font,
mappings, rules, and the logographic options accepts and vowels. `compileRows`
is an internal execution entry for generic conformance fixtures, not an
authored language or encoding format.

`encodeText` and `decodeText` return strings. Unknown input throws
`EncodingError` with no partial text. Its `offset` is a zero-based UTF-16
position; `line` and `column` are one-based, with columns counting code points.
Schema errors expose their `key`. NFC normalization preserves authored error
positions. `encodePieces` returns `{from, to, start, end, row}`; optional
`start` and `end` bounds retain source context and cannot split a combining
sequence.

The converter's format-2 encoding definitions contain `{data, codes, sounds}`
for sound pairs. Build-side resolution reads `sounds` from the configured
language note and transports it with the definition. Browser compilation
validates the same subset and mappings, without Node dependencies or files.

## Shared punctuation and literals

Every encoding uses the standard punctuation, verse and name controls.
`‼` closes an imperative and `!` an exclamation. Outside literal markers,
Unicode Zs and U+0009 through U+000D normalize to one space.

`⟦…⟧` contains font codes or strict `U+XXXX` scalars: four to six uppercase
hex digits, with no surrogates. Whitespace between codes writes nothing.
Literal payload occurrences of the opening, closing or escape control are
quoted with U+E0115. Unknown codes, malformed escapes, nested markers and
unmatched markers are errors.

`\/` writes the U+E010F literal-slash mark; `/` writes the distinct U+E010C
verse-line mark. `{verse: true}` handles line, stanza and canto structure.
The encoder receives `***` for a canto and decodes U+E010E to `***` followed
by a newline. The renderer writes a boundary after every content line.
