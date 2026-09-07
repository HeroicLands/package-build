---
"@heroiclands/package-build": patch
---

**The container's export is a git repository**, so a workflow step that shells
out to git behaves as it does on the runner.

`git archive HEAD` yields a bare directory with no `.git`. A step that asks git
something — `git ls-files` in a tracked-artifact check, for instance — then
fails for want of a repository, which reads as _the check failing_ rather than
as this harness lacking something the runner has. GitHub's own first step is a
**checkout**, so the faithful export is one too.

Found by `HarnMaster-3-FoundryVTT`, whose `check-no-compiled-packs.mjs` lists
tracked files that way: it passed on the host and failed in the container, and
the pre-push hook duly refused a push over a defect that was entirely this
harness's — exactly the false positive that teaches people to reach for
`--no-verify`.

Initialised and staged rather than committed: `git ls-files` reads the index, so
staging every extracted file reproduces exactly the set the runner would see,
and nothing needs a configured identity to commit with. Where `git init` cannot
run, it says so and carries on rather than pretending.
