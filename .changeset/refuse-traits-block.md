---
"@heroiclands/package-build": major
---

A top-level `traits:` block is refused (#291).

#128 moved a being's description — `gender`, `species`, `age`, `birthday`, `height`,
`weight`, `frame` and `appearance.*` — out of a top-level `traits:` block and into
the closed `data:` container the content format declares. **2,533 notes across four
repositories** have landed, and every content tree now carries zero. This is the third
and last step of that retirement.

**Refusing it matters more than refusing an ordinary dead key.** Top level is
_deliberately open_: an unrecognised key there is passed straight through to Hugo. So
a stray `traits:` would not be ignored loudly — it would arrive on the published page
as a theme parameter, checked by nothing, reading to its author as though it still
worked. The whole argument for `data:` being closed is the argument for refusing this.

The message states the **mapping**, not just the destination, because three of the
keys reshaped as well as moved: `traits.height.m` → `data.height` (metres),
`traits.weight.kg` → `data.weight` (kilograms), `traits.build.frame` → `data.frame`.
A bare _"write `data:` instead"_ would send an author to write `data.height: {m: 1.78}`
— a declared key holding an undeclared shape.

**`sohl.traits` is untouched.** It is a different field that shares the name —
`projectilegear` declares one and the theme's gear sidebar reads it — so the refusal
is anchored at column 1 and never reaches inside a system block.

Refused from the same two compile paths as `draft:`, `aliases:` and `section:`, and
reported by the frontmatter lint alongside them.
