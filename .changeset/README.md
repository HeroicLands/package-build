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
patch touched. One to six one-sentence bullets, symptom rather than mechanism, no
verification, no commit hashes or issue/pull-request numbers — a released package
has no tracker for its reader to open, and the pull request's own `Closes #<n>`
line is where that reference belongs. Do not use `#` headings inside a summary: it
is wrapped into a list item, so a heading breaks the document outline.

`package-build changelog check` lints a pending changeset against these rules
before it merges.
