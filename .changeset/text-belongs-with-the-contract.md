---
"@heroiclands/package-build": minor
---

**`text.mjs` is deleted; the one implementation lives with the diagnostics
contract it serves.**

`locateInText` and `positionOf` computed which line and column a substring sits
on. `@heroiclands/content-build` computes the same thing in
`engine/diagnostics.mjs` as `positionOfLiteral`, and has said so in a comment
for some time:

> That is a duplicate worth naming: unlike the diagnostic _format_ or a
> validation _rule_, "which line and column is this substring on" has exactly
> one correct answer and cannot drift into disagreement. The tidier arrangement
> is for that package to re-export this one — the dependency runs that way — and
> it should, next time either is touched.

This is that time. Rather than re-export, the module is removed outright: the
`./text` subpath was a library surface with one internal caller (`lang.mjs`) and
one external one, and this package's job is a command line, not a text-utility
grab bag.

**Breaking for anyone importing `@heroiclands/package-build/text`.** Import
`positionOfLiteral` from `@heroiclands/content-build/engine/diagnostics`
instead; it is the same arithmetic, and returns `{}` rather than `undefined`
when the literal is absent — the shape the diagnostics contract already spreads.
`locateInText` had no callers anywhere and is simply gone.
