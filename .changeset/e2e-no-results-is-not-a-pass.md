---
"@heroiclands/package-build": minor
---

The e2e harness no longer reports a run that never started as green.

Observed against a licensed container: a concurrent `npm ci` removed
`node_modules` out from under a run in progress, Cypress died with
`Cannot find package '.../cypress/index.js'`, and `package-build e2e run`
**exited 0**. The concurrency was an operator's mistake; the exit code was not.
A scripted caller, or anyone reading the tail of a log, would have recorded the
suite as passing when nothing was executed — and the suite is what moves
`compatibility.verified`, so an exit code that says green when nothing ran makes
that evidence unfalsifiable in the one direction that matters.

The suite is now bracketed rather than trusted on its exit status:

| When   | Check                              | What it catches                                                                          |
| ------ | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| Before | Every executable the command names | The runner is not installed — an error naming it, before a container and a world.        |
| Before | The tool behind a package runner   | `npx cypress run` resolves **`cypress`**; `npx` is never missing, so it answers nothing. |
| After  | Those executables again            | The runner disappeared mid-run, which is the failure reported above.                     |
| After  | Results written since the spawn    | The suite started and produced nothing. Needs the new `results` key.                     |

**New: `packageBuild.e2e.results`.** One path, or a list of them, relative to
the repository root, naming where the suite writes its results:

```yaml
e2e:
  suite:
    run: [npx, cypress, run]
  results: [cypress/results]
```

Existence is not the test — a directory the _previous_ run left behind exists,
and reading that as evidence would make the check agree with exactly the thing
it was built to catch. What counts is a file modified since the suite was
spawned. Declaring nothing keeps the previous contract, in which the exit status
is taken at its word; declaring a path is what buys the distinction between _the
suite ran and passed_ and _the suite did not run_.

**What a consumer may notice.** A `run`, `fast` or `sweep` whose suite is not
installed now fails immediately with a diagnostic naming the missing program,
where before it stood a container up and failed later — or, in the reported
case, did not fail at all. The check only ever makes a verdict _worse_: a suite
that failed keeps its own exit status, so there is no new way for the harness to
report a result that did not happen. `open` is untouched, because a person
decides what to execute there and a session that ran no specs is not a fault.

Also exported from `@heroiclands/package-build/e2e`, for a repository that wants
the same rules elsewhere: `suiteExecutables`, `findExecutable`,
`missingExecutables`, `freshResults` and the pure `suiteVerdict`.
