---
"@heroiclands/package-build": minor
---

**`content-build pdf --version` is now `--book-version`.**

`--version` collided with yargs' own reserved top-level `--version`, so the
option could not actually take a value — passing one failed with
`Unknown argument`. `--book-version` stamps the title page and the file name
exactly as before; the plain `content-build --version` answers this package's
own version, unaffected.

**A thrown error from `content-build pdf` no longer crashes with a
`ReferenceError`.** It now reports the same located diagnostic and non-zero
exit every other command's catch block produces.
