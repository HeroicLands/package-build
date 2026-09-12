---
"@heroiclands/package-build": patch
---

Restore the lockfile refresh to the release, and re-sync the lockfile 20.2.0
shipped without.

`changeset version` rewrites `package.json` and the CHANGELOG and never touches
`package-lock.json`, so the lockfile's root `version` keeps the previous
release's number. The `version-script` input is the only seam the changesets
action offers between versioning and committing, which is where the refresh has
to happen for it to land in the same commit.

That input was removed for one release on the theory that it was why `changeset
version` could not find its own binary. It was not: `node_modules` had been
committed as a symlink to an absolute path, and the action's `git reset --hard`
restored it over the install, so nothing resolved by any mechanism. With the
symlink gone the seam works again, and it is back.
