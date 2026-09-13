---
---

Composite `Map` keys inside the pack router are built with `JSON.stringify`
rather than by joining on a literal NUL byte. The routing decisions are
unchanged; the byte is gone from the source, so `engine/pack-router.mjs` is text
to git again and has a diff and a blame.
