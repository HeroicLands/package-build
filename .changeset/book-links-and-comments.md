---
"@heroiclands/package-build": minor
---

**The book**

- A page link in a book now goes where it says, and one into a package the book
  depends on reaches that package's pages; the address they are built from is
  `package.json`'s `homepage`, which a book now needs.
- A note written for the next author — a `markdownlint` pragma, an aside about a
  quoted notice — no longer appears on the page.
- A box written inside a GM-only section prints as a box, and a box's title
  prints as it was written: emphasis stays emphasis, and a title carrying a
  bracket, a `#` or a `$` no longer stops the book being made.
- Two captions sharing one id each print their own block once, under their own
  number.
- A link that resolves nowhere now fails the book build, as it already fails the
  compendium and website builds, and the book is still written so the page
  carrying the link can be found.
- Markup the book cannot set is reported at the file and line it is written on
  rather than printed on the page, in a title page and a prose file as well as in
  a note.
