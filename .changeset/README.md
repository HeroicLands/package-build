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

`npm run changeset:check` is what CI runs: it fails when the branch changes the
package but adds no changeset. An empty changeset satisfies it — that is the
"this needs no release" declaration, made explicitly rather than by omission.

## Which bump

This package builds and deploys a Foundry package for the repositories that
consume it, so read the bump from the **consumer's** point of view, not the
diff's size:

| Bump      | What it means here                                                                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **major** | A consumer must change something to upgrade — a removed export, a renamed `packageBuild:` key, a command-line flag that no longer means what it did. |
| **minor** | New capability a consumer can opt into; a raised floor on `@heroiclands/content-build` or any other dependency it also resolves.                     |
| **patch** | A fix that changes no interface — a wrong path corrected, a diagnostic clarified, a crash removed.                                                   |

Below 1.0.0 a **minor** is the breaking-change bump under a caret range: `^0.2.0`
never crosses to `0.3.0`, so a consumer's Dependabot offers it as a distinct pull
request. Use **major** anyway when the break is real; the changelog says so either
way.

**A raised dependency floor is a release note.** 0.2.0 began requiring
`@heroiclands/content-build >= 0.15.0` and said so nowhere a consumer would look.
When a change moves a floor, the changeset is where that gets recorded.

## Writing the summary

The summary becomes the `CHANGELOG.md` entry and the GitHub Release body, so write
it for someone deciding whether to upgrade — what changed for them, not what the
patch touched. Reference the issue. Do not use `#` headings inside a summary: it
is wrapped into a list item, so a heading breaks the document outline.
