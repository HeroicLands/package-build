---
"@heroiclands/package-build": patch
---

Move the release workflow to `changesets/action@v2`.

v2 renamed four of the inputs this workflow passes — `version` →
`version-script`, `publish` → `publish-script`, `commit` → `commit-message`,
`title` → `pr-title` — and **rejects the old names outright** rather than
warning and carrying on. So the bump and the rename have to land in the same
commit.

Taken deliberately rather than waiting for Dependabot, because Dependabot bumps
the pin without touching the inputs, and that combination has already broken the
release pipeline in three sibling repositories:
Song-of-Heroic-Lands-FoundryVTT#1729, sohl-thalorna#71 and
sohl-kethira-basic#42. In the first of those it went unnoticed for over two
weeks — a failing release job looks exactly like a repository nobody has
released lately.

Nothing else had to move: `version-script` already calls an npm script (#25), and
one command is what v2's tokenized, never-shelled input requires.
