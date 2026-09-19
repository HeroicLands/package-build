---
"@heroiclands/package-build": patch
---

**A package may ship assets and compile nothing.** `packs: []` is now a package
saying it has no documents, rather than one that forgot to say which, and a
package with no packs needs no content tree — its index is its asset records.
An alternative-art module is the case: the same addresses another package
publishes, resolving to different files when it is installed.

A package that _does_ declare packs is unchanged: a missing content tree is
still a misconfigured path and still fails, and an index that would state a
package has no content at all is still refused.
