---
"@heroiclands/package-build": minor
---

**An art slot now refuses a type it does not accept.** `icon`, `tokenIcon`, `bgImage` and `banner` all continue to take either an `icon` or an `image` address whichever one they default to, so a deity's profile art can still be a full illustration rather than a game icon. Naming any other type — an `audio` address among them — is now an error naming what the slot accepts, rather than a silent fall back to the document's default art.
