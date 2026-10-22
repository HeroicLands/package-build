---
"@heroiclands/package-build": patch
---

**Scripts**

- A `scroll` fence sets text in a script written in columns as a handscroll: columns read right to left, scrolling sideways on screen and continuing on panels in the book.
- A language note names the script it is written in with `data.writtenIn: { map, font }`, so text marked with the language alone is set in that script; a run's own `map=` or `font=` still chooses another.
