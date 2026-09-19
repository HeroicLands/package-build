---
"@heroiclands/package-build": minor
---

**The book sets in the faces the build carries, not the ones the machine has.**
Headings, running heads, table labels and captions are set in _Libertinus Sans_
— the toolchain ships it, so a book sets the same way on any machine, and the
sans no longer comes out in the body face because nothing could resolve it.
_Libertinus Mono_ is shipped beside it for a package that sets its code spans in
it; the default mono is unchanged.

**A face that resolves to nothing is reported.** A compile that cannot find a
family still writes a book, set in whatever the fallback reached — a wrong face
that nobody sees. The compiler's warnings are now findings like any other, with
the file, the line and the column.
