---
"@heroiclands/package-build": patch
---

Bump `markdown-it` from 15.0.0 to 15.0.1 (#121).

The surface is unchanged from the 15.0.0 adoption: one constructor,
`markdownit({ html: true })` in `engine/helpers.mjs`, and three `md.render()`
call sites — `engine/helpers.mjs`, `engine/journals.mjs` and `sohl/actors.mjs`.
No plugin is installed, no renderer rule is overridden, and `linkify` is left at
its default `false`. That last fact decides most of this release.

**Two of the five changes cannot reach a build that never linkifies.**

| Release note                                              | Reaches here?                                                    |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| _Security:_ quadratic complexity replacing fuzzy links    | No — `linkify` is `false`, so the fuzzy-link replacer never runs |
| _Security:_ quadratic complexity in scheme backscan       | No — same; the rule is the inline **linkify** rule               |
| Preserve brackets around IPv6 literals in `normalizeLink` | Yes, in principle — no content in any consumer writes one        |
| Preserve spaces in all-space code spans (#1180)           | Yes, for runs of three or more spaces only                       |
| Code spans after unclosed link/image labels (#1201)       | Yes, for an unclosed `[` followed by an odd-length backtick run  |

Calling the first two "security" fixes is upstream's framing and the honest
reading of it here is that this package was never exposed: both are complexity
bounds on `linkify-it` code paths that are unreachable with the linkifier off.
Taking the bump is hygiene, not remediation.

**The three real fixes were measured, not assumed.** Both versions were rendered
through `markdownit({ html: true })` — this package's exact configuration — and
compared:

```text
a `   ` b   15.0.0 → <p>a <code> </code> b</p>      15.0.1 → <p>a <code>   </code> b</p>
[`a`b`      15.0.0 → <p>[`a`b`</p>                  15.0.1 → <p>[<code>a</code>b`</p>
[x](http://[::1]/)
            15.0.0 → href="http://%5B::1%5D/"       15.0.1 → href="http://[::1]/"
```

Each has a narrow trigger. The code-span fix moves output only at three spaces
or more — 15.0.0 stripped one space from each end of an all-space span, so one-
and two-space spans were already correct and stay byte-identical. The unclosed-
label fix needs the backtick run to be **odd**: `[Sword `hp`and`ac`` renders
the same on both, because its four backticks close. And the IPv6 fix only fires
on a bracketed address literal in a link, image or autolink destination, which
15.0.0 percent-encoded into a host no browser resolves.

**Verified against every consumer, and against a search rather than a guess.**
All 14,995 `.md` files across the six HeroicLands content repositories — `sohl`,
`hm3`, `thalorna`, `kethira`, `harnensemble` and `harnadventures` — were parsed
the way `parseMarkdownFile` parses them and rendered through both versions.
Every one is byte-identical. Scanning the same corpus explains why rather than
leaving it to luck: zero files contain an IPv6 URL, zero contain an all-space
code span of three or more spaces, and the 109 files that do use `` ` ` `` use
the one-space form the fix does not touch. Beyond the corpus, an exhaustive
render of all 488,280 strings up to eight characters over `[`, `]`, `` ` ``,
`x` and `!` — the alphabet the label-and-backtick fix is about — found the
divergence set to be exactly the shapes above and nothing else. The repository's
1,713 tests pass unchanged.

**Bump**

_Patch, not minor._ No export, option, or emitted document changes shape. The
only behaviour that moves is markdown that was rendered wrongly before, on
constructs no consumer writes, and the two changes advertised as security fixes
are unreachable from this configuration.
