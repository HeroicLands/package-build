---
"@heroiclands/package-build": patch
---

**`package-build labels check` crashed for every consumer in 17.1.0.**
`labels.mjs` was added and not listed in `package.json` `files`, which is an
explicit whitelist, so the module never reached the tarball and the command
threw `ERR_MODULE_NOT_FOUND` on the import the release notes had just
announced.

Adds the module to `files`, and a guard so the class cannot recur: a new test
reads the root-relative imports out of `bin/` and requires each one to be
published, by name or by a containing directory entry. Verified by removing
`labels.mjs` from `files` again and watching it fail.

The failure could only appear in a consumer, after publish — locally the file
is simply there, so every check passed.
