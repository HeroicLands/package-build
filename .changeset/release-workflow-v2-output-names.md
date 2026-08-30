---
"@heroiclands/package-build": patch
---

Read the changesets action's `pr-number` output, so the step that marks the
Version Packages pull request stops being dead code (#84).

`release.yml` pins `changesets/action@v2` but read v1's `pullRequestNumber`. An
unset output evaluates to the empty string rather than erroring, so the guard was
`'' != ''` — always false. The step has never run once.

**The failure was silent by construction, which is why it survived three
releases.** A misspelled output does not fail a workflow; it disappears. `v3.4.0`,
`v4.0.0` and `v5.0.0` were all cut with this step skipped, and every run reported
green.

**Only one of the three names actually moved.** Checked against v2's own
`action.yml` rather than against the assumption that v2 kebab-cased everything:

| v1                  | v2                   | Used here                             |
| ------------------- | -------------------- | ------------------------------------- |
| `pullRequestNumber` | `pr-number`          | yes — the two lines this change fixes |
| `publishedPackages` | `published-packages` | no                                    |
| `hasChangesets`     | `has-changesets`     | no                                    |
| `published`         | `published`          | yes — **unchanged**, and left alone   |

`published` is the one name v2 kept. A blanket kebab-case sweep of this file —
the obvious reading of "rename the v1 outputs" — would have broken the one step
that was working.

**Bracket notation, not `outputs.pr-number`.** A hyphen is the subtraction
operator in an Actions expression, so the dotted form parses as
`outputs.pr - number`: a second silent-ish defect sitting directly behind the
first. `steps.changesets.outputs['pr-number']` is the form that means what it
reads as.

**What this repairs.** The Version Packages pull request is opened by
`GITHUB_TOKEN`, and GitHub deliberately starts no workflow runs from that token,
so the required `Changeset declared` context never reports on it. This step
exists to post that status. With it inert, every Version Packages pull request
has needed the check waived or force-merged by hand.

**Not yet demonstrated running, and stated rather than glossed.** The acceptance
criterion asks for a run where the step is not `skipped`, and that can only
happen on `main`, on the next release that opens a Version Packages pull request
— this change cannot produce one from a branch. The expression is verified by
parsing the workflow and by v2's manifest; the live proof arrives with the next
bump.

**Sibling repositories are fixed individually, not swept from here.** The same
defect is open on `harn-ensemble` (#13) and `HarnMaster-3-FoundryVTT` (#427),
where it is more severe — there the misspelling gates the release itself, and no
release is ever cut. Each repository owns its own copy of `release.yml`; this one
is not a reusable workflow. Turning it into one is a real improvement and a
separate change, and folding it into a two-line fix would put a shared release
pipeline into production on the back of a typo correction.

**Bump**

_Patch, not minor._ Nothing this package exports, emits, or documents for a
consumer changes. The file is this repository's own release plumbing, and it is
not shipped: `.github` is outside `files`.
