---
"@heroiclands/package-build": patch
---

Hold `typescript` at major 6 in Dependabot, because TypeScript 7 removes the
compiler API `coverage.mjs` parses with.

Dependabot proposed 6.0.3 → 7.0.2 (#105). It cannot be taken.

**TypeScript 7 is the native port, and its npm package no longer ships the
JavaScript compiler API.** The `"."` export resolves to `lib/version.cjs`, whose
entire surface is `version` and `versionMajorMinor`.

`coverage.mjs` uses that API as a _parser_, not as a compiler: it reads
localization keys out of a consumer's `src/**/*.{ts,mjs}` by walking a real AST,
deliberately down one path so JavaScript and TypeScript cannot drift. Under 7.0.2
the AST **vocabulary** survives behind `typescript/unstable/ast` — `ScriptTarget`
and every `isX` guard the scan uses — but the three things that actually drive it
exist nowhere in the JS surface:

| Needed by `coverage.mjs`                                      | In 7.0.2                                   |
| ------------------------------------------------------------- | ------------------------------------------ |
| `createSourceFile`                                            | **missing** — only a factory of that name¹ |
| `forEachChild`                                                | **missing**                                |
| `flattenDiagnosticMessageText`                                | **missing**                                |
| `ScriptTarget`, `isStringLiteral`, `isPropertyDeclaration`, … | present, behind `unstable/ast`             |

¹ 7's `createSourceFile` assembles a SourceFile from statements already parsed.
It is not a parser.

**The gate this file predicted would catch it did not.** The previous comment in
`dependabot.yml` recorded no ignore entry on the reasoning that `build.yml`'s
"Declaration emit" step already guards a breaking `typescript` bump. That step
passes clean under 7.0.2 — `tsc` still emits every `.d.mts`. What failed was
`npm test`: 11 failures in `tests/coverage.test.ts`, all
`TypeError: Cannot read properties of undefined (reading 'Latest')`. A dependency
can be load-bearing in two unrelated ways at once, and the file named only one of
them. That correction is now written where the wrong prediction was.

**Why an ignore rather than a migration.** Parsing in 7 lives in the Go binary,
reachable only through `unstable/sync`'s Project/Program API. Adopting it would
put a subprocess and a virtual filesystem inside a module whose stated contract
is "everything here is pure — source text in, references or findings out", in
exchange for an API whose own export path says `unstable`. Acorn is not a
substitute either: the default scan glob is `src/**/*.{ts,mjs}`, and the largest
consumer's sources are TypeScript.

That migration is worth doing when the API stabilises. It is not a dependency
bump, and it should not arrive as one.

**Scope of the hold.** Majors only — minor and patch releases within 6 still
arrive on the weekly schedule. The entry names the two conditions that lift it:
a stable in-process parse entry point, or a `coverage.mjs` that no longer needs
one.

**Bump**

_Patch._ Nothing shipped changes. `.github/dependabot.yml` is this repository's
own automation and sits outside `files`; the `typescript` range in
`package.json` is untouched, because `^6.0.3` already excludes 7 — the entry
stops the pull request being reopened, it does not change what resolves.
