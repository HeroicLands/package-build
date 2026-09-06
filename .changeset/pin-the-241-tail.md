---
"@heroiclands/package-build": patch
---

**#241's closing note, checked and pinned.** It asked whether `vehicle` and
`armorlocation` were second instances of the trap it reported — a type declared
and validated that no pack can route. Neither is, and they are not the same case
as each other:

- **`armorlocation` is HM3's.** The specification says "HM3 only", it has no SoHL
  form, and `hm3/document-subtypes.mjs` maps it. A SoHL configuration claiming
  it would be wrong, so its absence from `SOHL_DOCUMENT_SUBTYPES` is the answer
  rather than a gap. Nothing asserted that, so nothing would have noticed a row
  appearing there by mistake; now something does.
- **`vehicle` is specified but not yet implemented, and says so.** A note of that
  type is already reported as _"the content format specifies `vehicle`, so the
  note is not wrong — this toolchain has not implemented the type yet … do not
  author the type until a release compiles it"_. That is the opposite of #241,
  where the failure was silent and misattributed to the note.

No behaviour change: this adds the two assertions and the reasoning, so the
next reader does not have to re-derive it from four files.
