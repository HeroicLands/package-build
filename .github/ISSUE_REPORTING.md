# Issue Reporting — package-build

This document defines how issues are created and classified in the
**`package-build`** repository, which ships `@heroiclands/package-build` — the
shared toolchain that compiles a HeroicLands package's content and builds,
releases, and deploys the package itself.

**This repository is its own tracker.** File toolchain work here, not in the
repository whose build surfaced it. See §7 for where a given piece of work
belongs.

The core discipline is simple — three axes, each answering a different question:

- **Type** — _"what shape of work is this?"_ One per issue, from a closed set of five.
- **Priority** — _"how soon and how badly does this need doing?"_ A GitHub issue field, one value, defaults to Medium.
- **Labels** — _"what is this about?"_ Categorization only, chosen **only** from the registry in §3. Never invent a label.

Type and priority are structured single values (one each). Labels stack. Keep the
roles separate: do not encode priority or work-shape as a label, and do not encode
subject matter as a type.

**There are no milestones here.** `sohl-thalorna` and the system repository use
milestones as capability gates, because they ship toward a beta. This package has
no such gates, and an empty milestone set is better than a decorative one.

## 1. Issue types

Exactly **one** type per issue. Do not leave an issue untyped.

Issue types are **organization-level** in the `HeroicLands` org, so the same five
types — and their definitions — are shared with every other repository in the
project. They are not redefined here.

| Type        | Use it when…                                                                                                            | Do **not** use it for…                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **bug**     | Shipped behaviour is wrong — a build errors, a note compiles into the wrong document, a diagnostic fires on good input. | Missing capability (a _feature_); a chore.                             |
| **feature** | A new capability that does not exist yet, deliverable as one shippable unit.                                            | Anything broken (_bug_); work needing many sub-issues (_epic_).        |
| **epic**    | A body of work that only makes sense decomposed into sub-issues.                                                        | Anything shippable as a single issue. No sub-issues means not an epic. |
| **task**    | Necessary work that is neither defect nor new capability: chores, refactors, CI, docs, releases.                        | Exploratory work with an uncertain outcome (_spike_).                  |
| **spike**   | A **timeboxed** investigation whose deliverable is a decision or recommendation — not shipped code.                     | Work whose steps are already known (a _task_).                         |

**Type rules**

- **MUST** assign exactly one type.
- A **bug** is _broken_; a **feature** is _missing_. Decide which word fits first.
- An **epic** MUST link its sub-issues and SHOULD carry little implementation
  detail of its own.
- A **spike** MUST state the question it answers and its timebox.
- A **refactor** changing no external behaviour is a **task**, tagged `tech-debt`.

**What "broken" means here.** A build that fails loudly is the easy case. The
costly failures in this repository are the **quiet** ones — a note whose
frontmatter did not parse, an undeclared field silently dropped, a document that
compiled but carries the wrong `_id` — because the build reports success and the
damage is only visible in the emitted pack. **A build that exits 0 and produces
the wrong output is a bug**, and the most valuable report says what the note said
and what the emitted document said, not merely that "the build passed."

## 2. Priority (GitHub issue field)

Priority is a native **Priority** field on the issue — an organization-level issue
field, **not** a label. Set it in the issue sidebar; the issue list filters on it
(`field.priority:high,medium`). One value per issue, from: **Urgent · High ·
Medium · Low**.

| Priority   | Means                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------- |
| **Urgent** | Consumers cannot build or release, or a build emits wrong output silently. Drop other work. |
| **High**   | A core build path is broken or badly degraded, with no reasonable workaround.               |
| **Medium** | The default. Worth doing; nothing is on fire.                                               |
| **Low**    | Nice to have; polish, or a rare edge.                                                       |

**Anything that emits wrong output without failing is Urgent**, regardless of how
narrow the trigger. Five packages compile through this toolchain and take its
output on trust; a silent wrong emission ships to a world.

## 3. Labels — the closed registry

Labels are **subject matter only**. The registry is `.github/labels.yml`, and it
is **closed**: a label not listed there is deleted from the repository, and from
every issue carrying it, on the next sync. Editing the registry means editing
both that file and this table — `package-build labels check` (run as
`npm run lint:labels`) fails when they disagree.

| Label             | Use it for                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `documentation`   | The README, CONTENT.md, MIGRATING.md, JSDoc, process.                                    |
| `devops`          | Build, tooling, CI, release, repo config.                                                |
| `tests`           | The vitest suite, its fixtures, and the e2e harness this package ships to consumers.     |
| `security`        | Evaluating untrusted note content, path traversal, subprocess handling.                  |
| `tech-debt`       | Restructuring or cleanup of working code; refactors.                                     |
| `regression`      | Something that previously worked and stopped. Pairs with type **bug**.                   |
| `breaking-change` | Alters the configuration contract, a CLI, an emitted document shape, or the note format. |
| `blocked`         | Cannot proceed until an external dependency or another issue clears.                     |
| `duplicate`       | Already exists.                                                                          |
| `question`        | Further information is requested.                                                        |
| `wontfix`         | Will not be worked on.                                                                   |

There is **no** `bug` or `enhancement` label — work shape is a _type_, so
filtering on such a label returns nothing.

There is also no `content` or `system` label. This repository holds no compendium
content and no game system: an issue about what a note _says_ belongs to the
repository shipping that note, and only an issue about what the toolchain _does
with_ it belongs here.

## 4. Body structure by type

### Bug

```text
## Summary
## Steps to reproduce
## Expected vs. actual
## Which consumers are affected
## Acceptance criteria
## Environment      (package-build version, Node version, the consumer's config)
## Notes
```

### Feature

```text
## Problem / motivation
## Proposed solution
## Acceptance criteria
```

### Task

```text
## What needs doing
## Why
## Acceptance criteria
```

### Spike

```text
## Question
## Timebox
## What a conclusion looks like
```

**Root cause goes in a comment, not the body.** The body is the problem
statement — symptoms, reproduction, expectation. What is actually wrong, and the
proposed fix, belong in a comment, so the issue reads as a report rather than as a
half-finished diagnosis.

**Say which tree you saw it on.** Five packages consume this toolchain, and the
difference between "one tree is wrong" and "every tree is wrong" is usually the
difference between a content bug over there and a toolchain bug here. Naming the
tree — and, where you checked, the trees that were fine — is the single most
useful line in a report.

## 5. Pull requests

- Branch as `<type>/<issue_#>_<short-kebab-summary>`, or `chore/<slug>` for
  issue-free housekeeping.
- `main` is protected: pull request, one approving review, **squash merge only**.
- The PR description says what changed and why; it becomes the squash commit
  message.
- A change to behaviour carries a `.changeset/` entry. This package is consumed
  from the registry, so a change nobody records is a change no consumer learns
  about.
- **No AI or assistant attribution** in a commit message, PR title, or PR body.
  The `.githooks/commit-msg` hook refuses such a commit locally (activated by
  `npm install`), and the **No Attribution** check fails the pull request.

## 6. Verification

"Done" is what the repository's own scripts assert:

- `npm run lint` — formatting, markdown, YAML, the content-format declarations,
  and the label registry against §3 above
- `npm test` — the vitest suite
- `npm run build:types` — the published `.d.mts` surface compiles

A change that alters what consumers see updates the documentation that describes
it: **README.md** for the packaging half, **CONTENT.md** for the content half and
the note format, and **MIGRATING.md** when a consumer has to do something.

**Changing the toolchain is not the same as proving it.** A behaviour change here
is only really verified when a consumer tree compiles through it — see the
regression harness described in CONTENT.md, which diffs `build/packs-json` before
and after against a real tree.

## 7. Which repository does an issue belong in?

File where the diff will land, not where the symptom shows.

| The change is to…                                                      | File it in                         |
| ---------------------------------------------------------------------- | ---------------------------------- |
| The note format, a compiler pass, a diagnostic, a CLI, the e2e harness | **here**                           |
| A content note — wrong data, a dead link, a stale query                | the repository that ships the note |
| System code, sheets, rules automation                                  | `Song-of-Heroic-Lands-FoundryVTT`  |
| A page's layout or styling on the sites                                | `heroiclands-hugo-theme`           |
| An Emacs command, the authoring mode, the manual                       | `heroiclands-emacs`                |
| A shared GitHub Action — labels, no-attribution, todos                 | `HeroicLands/.github`              |

The discriminator is the one in §4: **if only one consuming tree is wrong, it is
usually that tree's**; if every tree is wrong the same way, it is usually ours.
