---
"@heroiclands/package-build": patch
---

**A homepage note is no longer refused for an `id` it did not author** (#319).

`resolveNoteId` fills `fm.id` **in place**, so every downstream reader sees one
derived value — deliberate, and documented as such. The homepage refusal
iterated that same object, so a note that authors no `id` was reported with a
message telling the author to delete a field that is not in the file.

It was an **error**, so it failed `lint:addresses`, and `lint` heads the build
chain — which meant it failed every pull request opened against a repository
carrying a homepage note, whatever that pull request changed.

A refused field must now be one the note actually wrote. The caller already owns
the raw note text and already positions these findings with it, so it answers
which keys are declared at the note's own top level; `positionInFrontmatter`'s
`topLevel` option is the existing helper for exactly that question, so a nested
`id:` under some other key is not mistaken for the note's own. With no answer
supplied, every key in `fm` still counts — the previous behaviour, and the right
one for a caller holding authored frontmatter only.

Measured on `sohl`: `lint:addresses` goes from one error to **clean across all
1,685 notes**.
