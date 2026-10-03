---
"@heroiclands/package-build": minor
---

**Named blocks**

- A `:::secret`, `:::info` or `:::warn` block now takes a title of its own, so a
  GM passage can say "For the GM" or "If they ask about the harbour" instead of
  one fixed word.
- A block also takes an id, classes and other attributes, so a note can link to
  one and a package can style a particular kind its own way.
- Without a title a block heads itself **Secret**, **Info** or **Warn**. A
  warning that used to head "Warning" now heads "Warn", and a secret that used to
  head "GM note" now heads "Secret"; writing `title="GM note"` keeps the old
  wording.
- A secret on a web page now opens with its own title rather than the word
  "Spoiler", and carries its kind so a site can style it.
- A block's colours come from a stylesheet rather than from the block itself,
  so a light panel no longer keeps a light background against dark page text.
- A misspelled block name is now reported instead of being left in the page as
  the literal `:::name` an author typed.
- One malformed block no longer stops every other block in the same note from
  rendering.
- A box written inside a GM-only section stays inside it, and a box inside
  another box says so rather than rendering as a muddle.
