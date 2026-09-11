---
"@heroiclands/package-build": minor
---

**A note whose second document has no pack is reported, instead of compiling
half of itself in silence.**

A note is not one document. An item note compiles into an Item _and_, from its
prose, a JournalEntry; a `macro` note into a Macro and a JournalEntry; a map note
into a Scene and a JournalEntry; a `being` into an Actor and a JournalEntry.

The check added in #146 asks one question of the whole configuration — _does any
pack claim this type?_ — and a union over `packs:` answers it. That union is
blind to a note that lands **half** of itself, because one claiming pack
satisfies it however many documents the note produces. Every pass that runs
succeeds, no pass gets far enough to complain, and the build exits 0 with a
document missing.

Two live configurations already have the shape:

|                      | declares no           | a note of      | was silently lost    |
| -------------------- | --------------------- | -------------- | -------------------- |
| `sohl-thalorna`      | `Macro`, `Scene` pack | `macro`, `map` | the Macro, the Scene |
| `sohl-kethira-basic` | `JournalEntry` pack   | any item type  | the prose            |

The question is now asked **per note and per document** rather than per type, and
a lost document is an error naming the note, the document class, and what is
missing:

```text
assets/content/Kaldor.md:6:1: error: a note of type "map" compiles into a Scene,
and this configuration has nowhere to put it: `packs:` declares no Scene pack. It
still compiles a JournalEntry holding its prose, which is why the build reports
no other error. Declare one in package-build.config.yaml, or stop authoring the
type.
```

**Three remedies, told apart**, because only two are things a consumer can write
in `package-build.config.yaml`:

- _no pack of that class_ — declare one, or stop authoring what produces the
  document. For a documentation entry the second is real: a note with an empty
  body compiles no journal and loses nothing, and such a note is never reported.
- _packs of that class exist and none claims the type_ — today always the item
  registry, so the finding names `itemBuilders` rather than `packs:`.
- _this toolchain compiles no document of that class at all_ — a system map may
  name any Foundry document, and no pack list will help; a pack of that type
  would fail the build for want of a compiler.

**What stays silent.** A type one system maps and another does not produces
nothing for the system that does not map it, so it is reported for nothing —
#79's rule, preserved by taking the documents a note produces as the union across
the systems that map its type. And a note **no** pack claims is still #146's
finding, which says strictly more; the two checks partition the tree on that one
condition, so no note is reported twice.

**A consumer may have to act.** A repository authoring one of the combinations
above has been shipping incomplete packs and will now fail its build until it
declares the missing pack — which is the point: the document was being dropped
either way, and only the reporting changed.
