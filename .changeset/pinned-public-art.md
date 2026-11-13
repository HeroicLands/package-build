---
"@heroiclands/package-build": patch
---

**Builds and commands**

- Pin and explicitly fetch verified public artwork for offline builds, with a clear fetch instruction when its cache is missing or damaged.
- Restore a pinned private Git LFS revision, reuse verified sources offline, and check that public images reproduce exactly without changing the lock or authored inputs.
- Clear a damaged fetched source cache with the clean command while protecting configured master and component roots.
