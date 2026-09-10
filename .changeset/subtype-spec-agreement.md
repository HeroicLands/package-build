---
"@heroiclands/package-build": minor
---

**The specification's `subType` lists are compared to the declared vocabulary,
for every type** (#345).

`tests/content-format-agreement.test.ts` made `docs/content-format.md`
executable for the `data` property tables only. The other half of the same
vocabulary entry — a type's genres, which an author picks from and which a
note's `subType` is closed against — was prose that nothing read, free to
disagree with `note-vocabulary.mjs` in either direction. That is the drift #231
and #232 were filed about, on the half they did not reach. `gathering` (#333)
guarded `lore` alone, deliberately scoped to the type it changed.

**The five spellings converged on one first.** The document stated a type's
values as `subType`, `subType:`, `**subType**`, `**subType**:` and
`**subTypes**:`, and a reader that accepted every one of them would accept the
sixth by reading that section as declaring nothing — the exact failure the
comparison exists to catch. One shape is now stated in the specification and
enforced by the parser: `**subType**:` on its own line, then `- <value>` or
`- <value>: <definition>`, one bullet per value. A type with no `subType`, or
one whose values are not enumerated yet, writes no marker.

| Written                                      | Read as                                                     |
| -------------------------------------------- | ----------------------------------------------------------- |
| `**subType**:` + a bullet per value          | that type's closed value list, in document order            |
| no marker                                    | the type enumerates none — the ordinary case for nine types |
| any other spelling, or a marker with no list | a build error naming the line                               |

**What the comparison asks**, of every type rather than of `lore`: the values
the specification lists equal the values `NOTE_VOCABULARY` declares, in the same
order. `subTypes` stays three-valued — a list is closed, `null` is a `subType`
whose values are not enumerated, an absent key is a type with no `subType` at
all — and each reading is compared to what the document states. The `lore`-only
assertion is folded in.

Nothing that compiles changes: the values were already equal everywhere, in both
shapes, so this is about keeping them that way. `parseContentFormat` gains a
`subTypes` array per type, and throws on a marker it does not recognise —
reachable only through `content-format --spec <a copy of the document>`.
