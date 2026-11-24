---
"@heroiclands/package-build": patch
---

**Builds and commands**

- `package-build docs` and `package-build content-index` refuse `--seed`: the option did nothing, and passing it is now an unknown-argument error.
- `package-build release --no-pdf` skips the content-tree book; the flag is accepted and shown in `--help` as the negation of `--pdf`.
- `package-build settlement --help` and the `settlement` command page say which options naming settlements needs: the `--checks-*` options, `--seed` and `--name-limit` with `--checks-module`.
