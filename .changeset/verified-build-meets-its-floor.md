---
"@heroiclands/package-build": minor
---

**Configuration**

- A `compatibility.verified` build below the package's own `compatibility.minimum`
  is now reported instead of shipping a manifest that claims a build was verified
  against a floor it cannot install on.
- The same check applies to a declared system's and a related package's own
  `compatibility`, naming the file and line of the offending `verified`.
