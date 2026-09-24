---
"@heroiclands/package-build": patch
---

**A being's age can be computed rather than written.** Beside a dated `born` and no authored `age`, the age follows from the birth date and the package's declared present — a birthday later in the year counts one less than plain subtraction would.

**The present is declared on the world's own `place` note**, in `data.present`. A package that states none computes no age and says nothing about it.

**`content-build lint` warns when an authored `age` disagrees** with what a dated `born` computes to, naming both values; it stays silent beside `born: unknown` or an absent `born`.

**An estimated age keeps its `~` in the compiled document**, with the plain number carried beside it as `ageYears`.
