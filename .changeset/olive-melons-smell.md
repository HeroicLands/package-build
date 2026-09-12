---
"@heroiclands/package-build": patch
---

Stop shipping a `node_modules` symlink, which had broken every release for a
day.

A worktree's `node_modules` symlink — a 120000 blob holding one developer's
absolute path — was committed on 2026-09-11. `.gitignore` said
`/node_modules/`, and a trailing slash matches a directory rather than a
symlink, so nothing refused it.

The release job installs, runs the tests, and then hands over to the changesets
action, which does `git reset --hard` before versioning. That reset restored the
symlink over the top of the install, pointing at a path no runner has, so every
module became unresolvable and the release died on `changeset: not found`. The
tests had already passed, because they run before the reset.

The symlink is untracked, the ignore rule now matches a symlink at any depth,
and CI refuses a tracked `node_modules` path outright — the release is the only
thing this breaks, and no pull request check would otherwise notice.
