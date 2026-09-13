---
"@heroiclands/package-build": minor
---

**A `doc` has two more genres to choose from**

`subType: howto` and `subType: concept` join `rules`, `userguide` and
`reference`:

- **`howto`** — a task with an outcome, written as the steps that reach it.
- **`concept`** — an explanation of how something works and why it is shaped
  that way, read to understand rather than to follow.

Between them they cover the prose a package writes about itself, which had no
genre to declare and was left to a directory name to imply.

`subType` stays _a genre and only a genre_: it says what kind of page this is,
never who reads it. A page written for a developer is a `howto` or a `concept`
like any other, and the audience is the section it sits in.

Both spellings are one word, as `userguide` is: a `subType` is held to the
address charset, so `how-to` is refused for its hyphen.
