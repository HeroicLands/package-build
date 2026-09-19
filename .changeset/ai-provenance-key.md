---
"@heroiclands/package-build": patch
---

**A provenance record may state `ai`.** It says whether the file is
machine-generated, and like every provenance key it is optional — a record that
omits it is unchanged, and nothing reads it yet. It exists so a package can
record the fact where the fact belongs, rather than in a key that means
something else.

**`attribution` is the person, not the tool.** It names whoever holds the rights
and is legally due the credit. Its description said a tool could go there, which
is what `ai` is for.
