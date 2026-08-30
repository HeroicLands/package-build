---
"@heroiclands/package-build": patch
---

Make `lint:markdown` pass, and run it in CI (#92).

This repository provides `content-build markdown` and was the one repository that
never ran it. The script existed, failed, and was executed by nothing — no
aggregate `lint` script, and no workflow naming it.

**The finding count in the issue is wrong, and the correction changes the
decision.** 117 is what `npx markdownlint-cli2 CHANGELOG-content-build.md`
reports — markdownlint's _default_ rule set, which this toolchain deliberately
turns off (`default: false`, then each rule enabled by name). Under the rules the
repository actually uses, `npm run lint:markdown` reports **three**: two
`MD001` heading skips and one `MD034` bare URL. The issue's "fix it — 117
mechanical findings" and "exclude it — 117 is too many to fix" were both
arguments about a number that was never the repository's.

**Excluded anyway, and not because three is still too many.**
`CHANGELOG-content-build.md` is the published changelog of
`@heroiclands/content-build` — a **deprecated repository**, absorbed into this
one at 3.0.0 (#32). It is frozen, not merely generated: exactly one commit has
ever touched it, nothing regenerates it, and it ships only because `files` lists
it. Its three findings are facts about what content-build published. Rewriting
them would edit a historical record to satisfy a rule about prose nobody will
write again, and would put a style-only commit in the blame of a file whose whole
value is being what was published. It is the same class as `CHANGELOG.md`, which
the shared default already ignores for the weaker reason that the next release
rewrites it.

**Declared locally, so no consumer moves.** The exclusion is a new
`.markdownlint-cli2.jsonc` in this repository, not an entry added to the shared
`MARKDOWN_IGNORES`. One repository's retired filename does not belong in
configuration six repositories consume, and the shared rule set is unchanged for
all of them.

**What that file had to get right, and what it documents.** `content-build
markdown` passes the shared rules as markdownlint-cli2's `optionsDefault`, and a
consumer file merges over them **key by key, each key wholesale**:

| Declared locally | Effect on the shared default                                          |
| ---------------- | --------------------------------------------------------------------- |
| only `ignores`   | rule set survives intact — `default: false` and every per-rule option |
| `ignores`        | **replaces** `MARKDOWN_IGNORES`; it does not extend it                |

So the local file restates `CHANGELOG.md`. Verified rather than assumed — with
that entry dropped, `lint:markdown` reports ten findings in `CHANGELOG.md`; with
a probe file present, `MD049` still fires with its shared `underscore` option
while `MD013` stays silent, which is what proves the rule set was not replaced.

`engine/prose-lint.mjs` said a consumer config "replaces it", which is the
reading that would send the next person to add the ignore to the shared default
or to a full config copy. Its docstring now states the key-by-key rule and the
`ignores` trap by name.

**Wired as a separate CI step, not folded into the chain.** `npm run lint` is
added for running both checks locally in one command, but `build.yml` gets a
`Markdown` step of its own beside `Formatting`. The aggregate chains with `&&`,
so a formatting failure would short-circuit it and hide every markdown finding
behind it; as two steps the failing one is named in the checks UI.
`lint:markdown:fix` is added too — the issue referred to it, and it did not exist.

**The exclusion cannot rot silently.** If a future markdownlint-cli2 bump changes
those merge semantics, the restated `CHANGELOG.md` entry stops applying and its
ten findings reappear — in the CI step this change adds. The guard is checked by
the thing it guards.

**Bump**

_Patch._ Nothing a consumer imports, calls, or configures changes behaviour. The
one shipped file touched is a docstring in `engine/prose-lint.mjs`, which reaches
consumers through the emitted declarations; everything else — the workflow, the
local lint config, the scripts — is this repository's own plumbing and is outside
`files`.
