---
"@heroiclands/package-build": major
---

Let a note's art path say "unset" and "blank on purpose" with two different values.

`resolveImg` opened with `if (!raw) return ""`, and every caller then applied its
own default to the result with `||` — `resolveImg(fm.img) || itemArt(type)`. So
`""`, `null` and an absent key were one case: all three compiled to the type's
default art, and a note had no way to say _ship no image_ at all.

They are now three values with two meanings, the convention the project already
holds for an optional "not specified" DataModel string (`nullable, initial: null`,
so "unset" is one honest value rather than two):

| a note writes  | it means                             | it compiles with |
| -------------- | ------------------------------------ | ---------------- |
| nothing at all | _unset_ — name me no art             | the type default |
| `img: null`    | the same thing, said out loud        | the type default |
| `img: ""`      | _blank on purpose_ — I want no image | no image         |

**`resolveImg` returns `string | null`.** `null` for an unset path, `""` for a
deliberate blank, the translation half unchanged. Every caller pairs its default
with **nullish** coalescing: `sohl/items.mjs`, three in `sohl/actors.mjs` (`img`,
`portrait`, and the prototype token's `texture.src`), and `engine/macros.mjs`.
Not `||` — that collapses a deliberate blank back into the default and takes the
distinction away again, and it does so silently, because `""` is falsy.
`itemArt()` is unaffected: a registry entry with no art throws before the
translation, so its result is never the unset case.

**The default-art seam is a documented extension point, so this is the substance
of the change, not a detail.** A consuming repository that pairs art with its own
`itemBuilders` entry, or calls `resolveImg` from a builder of its own, gets the
new reading of `""` whether or not it asked for it — which is why the sweeps have
to come first. `sohl-thalorna` swept forty-five `img: ""` notes ahead of this
release (HeroicLands/sohl-thalorna#134) and `sohl-kethira-basic` eleven
`portrait: ""` beings (HeroicLands/sohl-kethira-basic#81); `sohl` authors neither,
and its 3,125 compiled documents are byte-identical across the change.

**Both art fields, because both go through `resolveImg`.** A being carries `img`
(its token art) and `portrait` (its sheet portrait) independently; `portrait` is
not a variant spelling of `img`, and the rule belongs to the translator rather
than to one of the keys reaching it. This is not theoretical: `sohl-kethira-basic`
writes `portrait: ""` on eleven beings and `img: ""` on none, so a change — or a
guard — keyed on `img` alone would have called that tree clean and dropped every
one of those portraits.

**A warning for the old spelling.** The frontmatter lint reports `img: ""` and
`portrait: ""` — in either authoring position — as the meaning-change they are, on
the pattern the `package:` and retired-alias sweeps set: a warning, because the
note still compiles, to a document that is merely iconless.

**`title` is deliberately not on this rule.** It reads as a general rule about
optional strings and it is not: on a `type: affiliation` note `title` is
_simultaneously_ a declared item field whose default is `""`
(`sohl/item-fields.mjs`), resolved from the very same shared top-level key the
site emitter reads as the page title. `title: null` therefore does not fall back —
it stringifies, and the compiled document ships the literal `"null"`. A `title` a
note does not want is written by omitting the key; the emitter's `fm.title ?? name`
is already correct and is untouched. The lint guard is `img`'s alone for the same
reason.

Delivers the `img` half of #218. The `title` half — the collision above — stays
open.
