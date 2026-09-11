---
"@heroiclands/package-build": major
---

**A map note's `image:` is no longer read** (#149). Its art is `img:`, as every
other note type's is.

This is the third and last step of the rename #142 began. Through the retirement
window both spellings were read, `img` won where a note carried both, and a note
still writing `image` got a located warning — it compiled to the byte-identical
document, so failing a build over it would have redded a tree that had done
nothing wrong. The trees have since been swept, so the alias has nothing left to
honour and is gone.

**No shipped tree is affected.** Every content tree was checked — `sohl`,
`sohl-thalorna`, `sohl-kethira-basic`, `harn-ensemble` and `harn-adventures` —
and none writes the retired spelling. The window did its job; this only closes
it.

**What an unswept note now sees.** Two errors rather than one warning, and it
stops compiling: `image` in a `sohl:` block is reported as a key the type does
not have, and the `img` the note therefore never declared is reported as
missing. The fix is the rename, and moving the key to the note's top level while
you are there — art is not system-specific, so it belongs beside every other
note's `img` rather than inside a system block.

**A tile's `image:` is untouched.** `sohl.tiles.<key>.image` is a nested
placeable's texture, not the note's own artwork, and was never the retired field:
the check reads the `sohl:` block's own keys and never descends into one.

**Nothing was added to refuse it.** The two findings above are the ordinary
unknown-key and required-field checks, which is the point of a rename's third
step — one that had to add a standing refusal would be one whose replacement
never arrived. No tombstone entry is kept: the absence of an alias is the record.
