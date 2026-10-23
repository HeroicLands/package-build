---
"@heroiclands/package-build": minor
---

Language annotations retain authored spelling and the surrounding prose font. Native script presentation now requires `.nativefont` together with an explicit `lang=` on each marked construct. Native maps and fonts require that opt-in; `map=` and `font=` override their language defaults independently, with a missing required font reported as an error. Roman serif, sans and mono choices remain independent. Update authored native-script runs and parallel verse readings to opt in explicitly; language-only names and Roman repeats remain Roman.
