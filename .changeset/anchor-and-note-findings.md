---
"@heroiclands/package-build": minor
---

**Diagnostics**

- A dead `#anchor` now fails the website build, matching the compendium build
  and the link checker — a link that used to publish a dead section quietly now
  reports it.
- A note with more than one problem in its body now reports every one of them
  in a single build, instead of only the first.
