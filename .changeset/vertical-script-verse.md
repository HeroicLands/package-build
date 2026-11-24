---
"@heroiclands/package-build": minor
---

**Verse**

- Verse in a script written in vertical columns is set in columns read from the right on the site, in Foundry journals and in the book.
- Its lines, indents, stanza labels and paired versions are kept. Its Roman text stays in lines beside the columns, and its English version stays in lines.
- A line longer than 40 characters continues in the next column, on the site and in Foundry as in the book.
- An editorial gap (`lang=zxx`) in a verse line is one empty cell in a book column, so it does not lengthen the columns.
- A verse div that writes the class `verse-vertical` is refused with a finding at the class; the build writes it from the script's direction.
