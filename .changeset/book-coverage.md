---
"@heroiclands/package-build": patch
---

- A run reports every printable note no book selects, as a warning by default; `pdf.coverage` makes it an error or silences it, and `pdf.unprinted` names notes that belong in no book.
- A note several books select prints in each; the summary names its home book, the first in the list.
- A section whose queries select nothing is left out of the book instead of failing the build; a book that selects nothing at all is an error.
- A book can open with a full-page cover image under its title, and its title page lists the authors and the copyright and licence.
