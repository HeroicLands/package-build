---
"@heroiclands/package-build": patch
---

**Release from merged changesets instead of a remembered command**

Fixes [#4](https://github.com/HeroicLands/package-build/issues/4). Releasing was
hand-driven — bump `package.json` on a branch, merge, then remember
`gh release create`, because cutting the Release is what published. Nothing
enforced the last step, so a merged version could sit unpublished with no check
red; the sibling repository lost two versions that way.

- Every pull request now declares its bump as a `.changeset/*.md` file, and CI's
  **Changeset declared** job fails one that does not. `npx changeset add --empty`
  is how a change says it needs no release — explicitly, rather than by omission.
- Merging to `main` opens a **Version Packages** pull request carrying the bump
  and the rewritten `CHANGELOG.md`. An unreleased state is now a pull request
  waiting in the queue rather than nothing at all.
- Merging that runs `changeset publish`: npm publish, the `v<version>` tag, and
  the GitHub Release with the changelog section as its body. The OIDC Trusted
  Publishing step is unchanged and still last; there is still no `NPM_TOKEN`, and
  re-running on a published version is a no-op.
- `CHANGELOG.md` is seeded from the two hand-cut Releases so far and now ships
  with the package. A changeset is also where a raised dependency floor gets
  recorded — 0.2.0 raised one to `@heroiclands/content-build >= 0.15.0` and said
  so nowhere.
