---
"@heroiclands/package-build": patch
---

**Builds and commands**

- Pin and explicitly fetch verified public artwork for offline builds, with a clear fetch instruction when its cache is missing or damaged.
- Restore a pinned private Git LFS revision and check that its public images reproduce exactly without changing the lock or authored inputs.
