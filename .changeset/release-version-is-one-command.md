---
---

No release: nothing in the published package changes. The release workflow's
`version` step becomes a single npm script instead of a `&&` chain.

`changesets/action` **tokenizes and execs** that input rather than handing it to
a shell, so `npx changeset version && npm install --package-lock-only` is read
as one command with four arguments: `changeset` receives `--package-lock-only`,
cac rejects it as an unknown `packageLockOnly` option, and the step fails.

This repository has not felt it yet, which is the reason to fix it now rather
than later. The step is skipped whenever the only pending changesets are empty
("All changesets are empty; not creating PR"), and every release here since the
chain landed has been exactly that — so the broken command has never actually
run. The first pull request carrying a real bump would have failed instead, and
it would have looked like that pull request's fault.

`@heroiclands/content-build` shipped the identical chain and did feel it: three
merged pull requests published nothing while the registry sat on the previous
version (content-build#74).
