---
"@heroiclands/package-build": patch
---

**Builds and commands**

- A package can pin the published index of a picture package and use its pictures, naming each by its own address.
- Fetching dependencies downloads each pinned picture index and refuses one that does not match its checksum.
- Those pictures ship in the package under `images/<package>/` and `icons/<package>/`, so their names never collide with the package's own.
- A picture whose creator, license, AI status or size differs from its pinned index stops the build at that picture.
