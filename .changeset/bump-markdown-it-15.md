---
"@heroiclands/package-build": patch
---

Bump `markdown-it` from 14.3.0 to 15.0.0.

This package's entire use of the library is `markdownit({ html: true })` and
`md.render(body)`, at three call sites — `engine/helpers.mjs`,
`engine/journals.mjs` and `sohl/actors.mjs`. Nothing overrides a renderer rule,
installs a plugin, or reaches into the parser.

**Every breaking change in 15.0.0 lands outside that surface.**

| Breaking change                                                        | Why it does not reach here                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `linkify-it` → v6: no fuzzy links, no auth check, CJK link termination | `linkify` defaults to `false` and is never enabled, so the linkifier never runs |
| Package-internal subpath exports (`markdown-it/lib/*`) removed         | Only the package root is imported                                               |
| `validateLink`/`normalizeLink`/`normalizeLinkText` moved to prototype  | None is read, assigned, or overridden                                           |
| `StateBlock#ddIndent` removed                                          | No plugin is installed, `markdown-it-deflist` included                          |
| Root now resolves to prebuilt `dist/` rather than raw sources          | Import is by package name; the resolved path was never depended on              |

**Verified rather than assumed.** The same corpus was rendered through 14.3.0
and 15.0.0 and diffed byte-for-byte, covering exactly the constructs the release
touched — bare URLs, autolinks, email-shaped text, reference links and their
definitions, CJK adjacent to a URL, hard line breaks, raw HTML, tables, nested
lists, and both fenced and indented code. Output is identical. The repository's
1,642 tests pass unchanged.

**Bump**

_Patch, not minor._ No export, option, or emitted document changes shape, and no
behaviour a consumer can observe moves. The version is a major on the library's
own surface, none of which this package presents onward.
