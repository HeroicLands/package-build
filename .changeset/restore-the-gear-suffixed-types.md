---
"@heroiclands/package-build": minor
---

**The gear-suffixed note types are restored** — `armorgear`, `concoctiongear`
and `projectilegear` are the vocabulary again, reversing #78.

#78 renamed them to `armor`, `concoction` and `projectile`, on the argument that
the suffix named the _SoHL document subtype_ a note compiled into rather than
the thing the note is about. The argument had a cost the rename did not pay for.

**Nothing adopted the bare spellings.** Across all five content trees, every note
still authors the suffix — 331 `armorgear` and 18 `projectilegear` in `sohl`, 71
`concoctiongear` in `thalorna` — and **not one note anywhere** writes `armor`,
`concoction` or `projectile`. The rename produced **349 warnings and zero
adopters**, and it was those warnings that made `lint:addresses` noise on every
consumer that took 18.0.0.

**It also cost a property worth more than the argument.** `weapongear` and
`containergear` kept their suffix — SoHL and HM3 both call those documents that —
so the rename left three of the five gear types spelled one way and two the
other. With it reversed, every SoHL row of the note-type → document-subtype map
is the identity again, all fourteen of them, which is what lets two tests drop
their exception lists entirely.

`RENAMED_TYPES` is reversed rather than emptied, so the bare spellings are still
_read_ and _reported_ rather than refused — the same retirement window the
rename itself used, pointing the other way. `armorlocation`, the type #78 added,
is unaffected: it was new, not renamed.
