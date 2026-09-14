---
"@heroiclands/package-build": patch
---

**A being that declares no `sohl:` block no longer takes the site build down.**
`content-build site` failed with `unacceptable kind of an object to dump [object
Undefined]` for any `type: being` note whose front matter carried no `sohl:` key
at all, and the throw aborted the entire run rather than the one page. A note
carrying `sohl: null` had always been fine, so the failure only appeared once a
tree removed the empty key rather than emptying it. Both shapes now publish the
same page. Fixes HeroicLands/package-build#478.
