---
"@heroiclands/package-build": patch
---

**Languages and scripts**

- An encoding note takes `rules.word-spaces`, `space` by default or `none` for a script whose signs sit side by side.
- With `none`, a space, tab or line break between Roman words writes nothing.
- With `none`, decoding puts a space after each word and around marks, as in a spaced script.
- A note with `word-spaces: none` that states `word-separators` is refused.
