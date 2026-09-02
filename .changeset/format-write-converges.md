---
"@heroiclands/package-build": patch
---

**`content-build format --write` now formats to a fixpoint** (#125)

`--write` formatted each file exactly once and reported success. Prettier's
`format` is _assumed_ idempotent and is not guaranteed to be, so a single pass
could leave text the next pass would still change — and the run would call such
a file formatted while `prettier --check` still rejected it. Each file is now
formatted repeatedly until it stops changing, capped at three passes, so what
lands on disk is what a second run would have produced.

**A file that will not converge is reported, not written.** At the cap the file
is left exactly as it was and a diagnostic names it, because a formatting the
command cannot reproduce would otherwise churn the file on every run.

**`--write` now surfaces its findings and fails.** It collected them and threw
them away, so a run that could not parse a file still printed
`Formatted N of M file(s).` and exited 0. It now emits each diagnostic and exits
1, which is the same channel the non-convergence report uses.
