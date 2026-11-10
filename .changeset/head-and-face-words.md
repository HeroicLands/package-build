---
"@heroiclands/package-build": patch
---

**Content and notes**

- A being's appearance takes words for hair texture, hair style, facial hair, face shape, nose, brow and mouth.
- A culture's appearance profile can weight those words, and `package-build npc new` draws them for each one the profile states.
- A being's `data.portrait.prompt` holds the exact text its portrait was generated from; a being with no portrait states no `portrait` block and is reported for nothing.
