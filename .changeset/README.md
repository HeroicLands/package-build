# Changesets

Every pull request declares its intended version bump here, as a file, before it
merges. That declaration is the whole release process: merging it to `main` opens
a **Version Packages** pull request, and merging _that_ versions the package,
rewrites `CHANGELOG.md`, tags the commit, cuts the GitHub Release, and publishes
to npm. Nothing is run by hand.

## Adding one

```bash
npx changeset              # pick major / minor / patch, write the summary
npx changeset add --empty  # this change ships nothing a consumer can see
```

Nothing requires one: a pull request that ships nothing a consumer meets carries
no changeset at all. Add `npx changeset add --empty` only for the record when
that is worth saying explicitly; otherwise write no file.

## Which bump

Read the bump from the point of view of a person who installs the package, not
the diff's size. Three rules decide it, and nothing else does:

| Bump      | When                                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **major** | Only on the owner's direct instruction, confirmed before it is written. It is never chosen from the nature of a change, however breaking it looks.               |
| **minor** | The change adds or removes **non-optional** user-visible functionality: something a user meets whether or not they went looking for it.                          |
| **patch** | Everything else, which is nearly everything — a fix, and anything optional however visible: a new flag, a new export, a new key a note may write, a new command. |

**A removal is a patch until it is enforced.** Retiring a key while input that
still states it is accepted breaks nobody; retiring it _and_ making it a finding
is a minor, because a package that changed nothing now fails. The question is
whether a package that did nothing now behaves differently.

**A raised install requirement is a release note.** When a change raises a
floor a consumer must meet, such as a dependency it also resolves, the changeset
says so.

## Writing the summary

The summary becomes the `CHANGELOG.md` entry and the GitHub Release body, so write
it for someone deciding whether to upgrade — what changed for them, not what the
patch touched. Symptom rather than mechanism, no verification, no commit hashes or
issue/pull-request numbers — a released package has no tracker for its reader to
open, and the pull request's own `Closes #<n>` line is where that reference
belongs.

**The shape is enforced.** A summary is one or more blocks. Each block is a
`**Label**` line on its own, then one to six bullets of one sentence each, and
nothing else: no lead paragraph, no prose between blocks, no `#` heading, no nested
list. A label is one of the `labels` in the changelog options of `.changeset/config.json`, or `Miscellaneous`,
which every repository has for a change that fits none of them and which a release
always lists last. `package-build changelog group` merges the blocks that share a
label across a release and removes the `### … Changes` headings Changesets writes,
so a label never needs to be repeated for fear of splitting a release.

A valid changeset with two blocks:

```markdown
---
"@heroiclands/package-build": patch
---

**Verse**

- A stanza break renders as a blank line.

**Rendering and sites**

- Every page carries its section in the contents list.
```

Each of these is refused by `package-build changelog check`:

```markdown
A lead paragraph before any label.
```

```markdown
- A bullet with no label above it.
```

```markdown
**Verse**

- A bullet.

A closing remark between or after blocks.
```

```markdown
**Verse**

- A bullet.
  - A nested bullet.
```

```markdown
## Verse

- A bullet under a heading.
```

```markdown
**Poems**

- A bullet under a label the repository does not declare.
```

`package-build changelog check` lints a pending changeset against these rules before it
merges; this repository's labels are in `config.json` here.
