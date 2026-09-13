---
"@heroiclands/package-build": minor
---

**A reference for every subpath entry this package exports**

`docs/api.md` documents the whole programmatic surface — `engine`, `sohl`
and `hm3` included, on the same footing as the packaging half — organized by
how a consumer imports it: signature, what it returns, and when to reach
for it, with a runnable example per subpath. Most of it is pure — source
text or already-loaded data in, findings or values out, leaving discovery,
I/O and reporting to the caller — and the reference names the handful of
packaging functions that necessarily touch the filesystem or a subprocess.
