---
"@heroiclands/package-build": patch
---

- A deployment removes its previous package tree even when Foundry's container owns the files in it, and a tree that still cannot be removed is a warning naming the command that removes it rather than a failed deployment.
- A deployment also removes the `<id>.old-<pid>` trees earlier deployments left beside the package, which Foundry otherwise reports as invalid copies of it on every start.
