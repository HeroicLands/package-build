---
"@heroiclands/package-build": patch
---

**The generated item-frontmatter examples no longer author an `id:`** (#314).

`content-build docs item-fields` emitted `id: <16-character id>` in the worked
example for every item type — thirteen of them in the `sohl` tree. Since #270
and #277 a note's document `_id` derives from its canonical address, and the
authored field is the escape hatch for keeping a document's identity across a
shortcode rename, not part of the envelope every note carries.

The example is the block an author copies as a template, and the page is the
per-type reference they read while writing the note, so the one place the field
survived a tree's sweep was the document teaching them to write it. It is now
omitted, as every other optional envelope field already was; the `type` and
`shortcode` the derivation reads are unchanged.

Consumers should regenerate their item frontmatter reference to drop the line.
